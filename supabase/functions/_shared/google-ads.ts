// ============================================================================
// Google Ads API — לקוח מינימלי ב-REST (docs/marketing-console.md, שלב 7)
//
// שני דברים בלבד: access token מ-refresh token, ושאילתת GAQL ב-searchStream.
// בלי ספריית לקוח — הספרייה הרשמית היא gRPC ואינה רצה ב-Edge Runtime.
//
// ‏**הסודות** (Supabase → Edge Functions → Secrets):
//   GOOGLE_ADS_DEVELOPER_TOKEN      ממרכז ה-API בחשבון המנהל
//   GOOGLE_ADS_CLIENT_ID / _SECRET  לקוח OAuth מסוג Web application
//   GOOGLE_ADS_REFRESH_TOKEN        מ-OAuth Playground, scope adwords
//   GOOGLE_ADS_LOGIN_CUSTOMER_ID    חשבון המנהל (MCC), ספרות בלבד
//   GOOGLE_ADS_CUSTOMER_ID          חשבון הפרסום, ספרות בלבד
//   GOOGLE_ADS_API_VERSION          אופציונלי. גוגל סוגרת גרסה כשנה אחרי
//                                   שיצאה; גרסה שנסגרה מחזירה 404, ואז
//                                   מעדכנים כאן בלי פריסה.
//
// ‏**מסך ההסכמה חייב להיות In production.** אפליקציה במצב Testing מבטלת את
// ה-refresh token אחרי 7 ימים, והשגיאה (invalid_grant) נראית כמו טוקן שגוי.
// ============================================================================

export const DEFAULT_API_VERSION = "v25";

export type GoogleAdsConfig = {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  loginCustomerId: string;
  customerId: string;
  version: string;
};

const ENV_KEYS = {
  developerToken: "GOOGLE_ADS_DEVELOPER_TOKEN",
  clientId: "GOOGLE_ADS_CLIENT_ID",
  clientSecret: "GOOGLE_ADS_CLIENT_SECRET",
  refreshToken: "GOOGLE_ADS_REFRESH_TOKEN",
  loginCustomerId: "GOOGLE_ADS_LOGIN_CUSTOMER_ID",
  customerId: "GOOGLE_ADS_CUSTOMER_ID",
} as const;

// מספר חשבון נכתב בממשק עם מקפים (168-584-7742); ה-API רוצה ספרות בלבד.
const digits = (s: string) => s.replace(/\D/g, "");

export function googleAdsConfig(env: (k: string) => string | undefined): { config: GoogleAdsConfig | null; missing: string[] } {
  const raw: Record<string, string> = {};
  const missing: string[] = [];
  for (const [field, key] of Object.entries(ENV_KEYS)) {
    const v = (env(key) || "").trim();
    if (!v) missing.push(key);
    raw[field] = v;
  }
  if (missing.length) return { config: null, missing };
  return {
    config: {
      developerToken: raw.developerToken,
      clientId: raw.clientId,
      clientSecret: raw.clientSecret,
      refreshToken: raw.refreshToken,
      loginCustomerId: digits(raw.loginCustomerId),
      customerId: digits(raw.customerId),
      version: (env("GOOGLE_ADS_API_VERSION") || DEFAULT_API_VERSION).trim(),
    },
    missing,
  };
}

// ‏code = המפתח הראשון שגוגל מחזירה: invalid_grant מה-OAuth, או למשל
// authorizationError:USER_PERMISSION_DENIED מה-API. ‏message לבן אדם.
export class GoogleAdsError extends Error {
  constructor(public status: number, public code: string, message: string, public details: GoogleAdsErrorDetail[] = []) {
    super(message);
  }
}

// כל שגיאה ברשימה, ולא רק הראשונה: בבקשת mutate אחת לקמפיין שלם, גוגל
// מחזירה שגיאה לכל מילה או כותרת שנדחתה, ו-trigger הוא הטקסט שנדחה.
export type GoogleAdsErrorDetail = { code: string; message: string; trigger: string | null; field: string | null };

let cachedToken: { value: string; expires: number; key: string } | null = null;

async function accessToken(cfg: GoogleAdsConfig): Promise<string> {
  const key = cfg.clientId + "|" + cfg.refreshToken.slice(-8);
  if (cachedToken && cachedToken.key === key && cachedToken.expires > Date.now() + 60_000) return cachedToken.value;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new GoogleAdsError(401, String(data.error || "token_error"), String(data.error_description || data.error || res.status));
  }
  cachedToken = { value: data.access_token, expires: Date.now() + Number(data.expires_in || 3600) * 1000, key };
  return data.access_token;
}

// שגיאת API של Google Ads: ‏error.details[].errors[].errorCode הוא אובייקט
// עם מפתח אחד (‏{"authorizationError":"DEVELOPER_TOKEN_NOT_APPROVED"}).
function parseApiError(status: number, data: any): GoogleAdsError {
  const err = Array.isArray(data) ? data[0]?.error : data?.error;
  for (const d of err?.details || []) {
    const errors = Array.isArray(d?.errors) ? d.errors : [];
    if (errors[0]?.errorCode) {
      const details = errors.map((x: any) => {
        const [k, v] = Object.entries(x?.errorCode || {})[0] || ["", ""];
        const path = (x?.location?.fieldPathElements || []).map((f: any) => f?.fieldName + (f?.index != null ? `[${f.index}]` : "")).join(".");
        return { code: `${k}:${v}`, message: String(x?.message || ""), trigger: x?.trigger?.stringValue ?? null, field: path || null };
      });
      return new GoogleAdsError(status, details[0].code, String(errors[0].message || err?.message || status), details);
    }
  }
  return new GoogleAdsError(status, String(err?.status || status), String(err?.message || status));
}

// קריאה ל-API בשם חשבון הפרסום. ‏path אחרי /customers/{id} - למשל
// "/googleAds:searchStream" או ":generateKeywordIdeas".
async function post(cfg: GoogleAdsConfig, path: string, body: unknown): Promise<any> {
  const token = await accessToken(cfg);
  const url = `https://googleads.googleapis.com/${cfg.version}/customers/${cfg.customerId}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "developer-token": cfg.developerToken,
      "login-customer-id": cfg.loginCustomerId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw parseApiError(res.status, data);
  return data;
}

// שאילתת GAQL על חשבון הפרסום. ‏searchStream מחזיר מערך של מנות, כל אחת
// עם results; מחזירים את כולן כרשימה אחת.
export async function gaql(cfg: GoogleAdsConfig, query: string): Promise<any[]> {
  const data = await post(cfg, "/googleAds:searchStream", { query });
  return (Array.isArray(data) ? data : []).flatMap((batch: any) => batch?.results || []);
}

// כתיבה אטומית: כל הפעולות עוברות או שאף אחת לא. ‏validateOnly בודק מול
// גוגל את כל הבקשה - מדיניות, אורכים, מילים - בלי ליצור דבר; זה ה-dry_run
// של גוגל, והוא אמיתי יותר משלנו כי הכללים שלה. שמות משאב זמניים (‏-1, ‏-2)
// מקשרים בין פעולות באותה בקשה.
export async function mutate(cfg: GoogleAdsConfig, operations: unknown[], validateOnly: boolean): Promise<any> {
  return await post(cfg, "/googleAds:mutate", { mutateOperations: operations, validateOnly, partialFailure: false });
}

export const customerPath = (cfg: GoogleAdsConfig) => `customers/${cfg.customerId}`;
export const toMicros = (v: number) => String(Math.round(v * 1_000_000));

// עברית ב-Google Ads, וישראל כמדינה. מזהים קבועים של גוגל.
export const LANG_HEBREW = "languageConstants/1027";
export const GEO_ISRAEL = "geoTargetConstants/2376";

export type KeywordIdea = {
  text: string;
  searches: number | null;      // ממוצע חודשי, 12 החודשים האחרונים
  competition: string | null;   // LOW / MEDIUM / HIGH
  bid_low: number | null;       // הצעה לראש העמוד, במטבע החשבון
  bid_high: number | null;
};

// רעיונות ונפחים מ-Keyword Planner. עד 20 מונחי זרע בבקשה (מגבלה של גוגל).
// בקשה אחת = פעולה אחת מהמכסה היומית.
export async function keywordIdeas(cfg: GoogleAdsConfig, seeds: string[], geo: string[] = [GEO_ISRAEL]): Promise<KeywordIdea[]> {
  const data = await post(cfg, ":generateKeywordIdeas", {
    language: LANG_HEBREW,
    geoTargetConstants: geo,
    keywordPlanNetwork: "GOOGLE_SEARCH",
    includeAdultKeywords: false,
    keywordSeed: { keywords: seeds.slice(0, 20) },
    pageSize: 500,
  });
  const n = (v: unknown) => (v == null ? null : Number(v));
  return (data?.results || []).map((r: any) => {
    const m = r.keywordIdeaMetrics || {};
    return {
      text: String(r.text || ""),
      searches: n(m.avgMonthlySearches),
      competition: m.competition || null,
      bid_low: m.lowTopOfPageBidMicros != null ? fromMicros(m.lowTopOfPageBidMicros) : null,
      bid_high: m.highTopOfPageBidMicros != null ? fromMicros(m.highTopOfPageBidMicros) : null,
    };
  });
}

// ‏micros → יחידות מטבע. ‏int64 מגיע כמחרוזת ב-JSON.
export const fromMicros = (v: unknown) => Number(v || 0) / 1_000_000;
