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
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

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
    const first = d?.errors?.[0];
    if (first?.errorCode) {
      const [k, v] = Object.entries(first.errorCode)[0] || ["", ""];
      return new GoogleAdsError(status, `${k}:${v}`, String(first.message || err?.message || status));
    }
  }
  return new GoogleAdsError(status, String(err?.status || status), String(err?.message || status));
}

// שאילתת GAQL על חשבון הפרסום. ‏searchStream מחזיר מערך של מנות, כל אחת
// עם results; מחזירים את כולן כרשימה אחת.
export async function gaql(cfg: GoogleAdsConfig, query: string): Promise<any[]> {
  const token = await accessToken(cfg);
  const url = `https://googleads.googleapis.com/${cfg.version}/customers/${cfg.customerId}/googleAds:searchStream`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "developer-token": cfg.developerToken,
      "login-customer-id": cfg.loginCustomerId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw parseApiError(res.status, data);
  return (Array.isArray(data) ? data : []).flatMap((batch: any) => batch?.results || []);
}

// ‏micros → יחידות מטבע. ‏int64 מגיע כמחרוזת ב-JSON.
export const fromMicros = (v: unknown) => Number(v || 0) / 1_000_000;
