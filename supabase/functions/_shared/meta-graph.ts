// ============================================================================
// לקוח Graph API מינימלי לחשבון המודעות — הגרסה ב-Deno של
// ‎.claude/skills/meta-ads/scripts/meta_client.py‎.
//
// משותף ל-ads-admin ול-ads-leads-webhook (שלב 4).
//
// ההבדלים מהסקיל, ולמה:
//   - אין המתנה על rate limit. בסקיל זה sleep של דקה; כאן פונקציית Edge
//     שישנה דקה נחתכת. השגיאה עולה עם rateLimited=true, והקורא מחזיר 429.
//   - appsecret_proof נשלח כשיש META_APP_SECRET. אפליקציה שהודלק בה
//     "Require App Secret" דוחה כל קריאה בלעדיו, ובלי ההגדרה הוא מתעלם ממנו.
//   - הטוקן לעולם אינו נכתב ליומן: שגיאה נושאת את גוף התשובה של מטא בלבד,
//     ולא את הכתובת (שבה יושב access_token).
// ============================================================================

const GRAPH_BASE = "https://graph.facebook.com";

// ‏v26.0 כמו בסקיל. הפרסום האורגני הקיים עובד על FACEBOOK_GRAPH_VERSION
// ‏(v23.0) ואינו נוגע כאן — הקונסולה עם גרסה משלה (docs/marketing-console.md).
export const META_VERSION = Deno.env.get("META_API_VERSION") || "v26.0";

// אותן שלוש תת-שגיאות של הסקיל, ועוד קודי ה-throttling הכלליים.
const RATE_LIMIT_SUBCODES = new Set([1487742, 2446079, 1487390]);
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80000, 80003, 80004]);

export type MetaErrorBody = {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_user_msg?: string;
  fbtrace_id?: string;
};

export class MetaError extends Error {
  status: number;
  meta: MetaErrorBody;
  rateLimited: boolean;
  tokenInvalid: boolean;
  constructor(status: number, meta: MetaErrorBody) {
    super(`Meta API ${status} (code=${meta.code ?? "?"}, subcode=${meta.error_subcode ?? ""}): ${meta.message ?? "unknown"}`);
    this.status = status;
    this.meta = meta;
    this.rateLimited = RATE_LIMIT_CODES.has(meta.code ?? -1) || RATE_LIMIT_SUBCODES.has(meta.error_subcode ?? -1);
    // ‏190 = טוקן פג / בוטל / שגוי. זה מה שהסוכן התפעולי צריך לראות (שלב 6).
    this.tokenInvalid = meta.code === 190;
  }
}

async function hmacHex(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class MetaClient {
  private token: string;
  private appSecret: string;
  private proof: string | null = null;

  constructor(token: string, appSecret = "") {
    this.token = token;
    this.appSecret = appSecret;
  }

  private async authParams(): Promise<Record<string, string>> {
    const p: Record<string, string> = { access_token: this.token };
    if (this.appSecret) {
      this.proof ??= await hmacHex(this.appSecret, this.token);
      p.appsecret_proof = this.proof;
    }
    return p;
  }

  private async send(url: string, init: RequestInit): Promise<any> {
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      throw new MetaError(0, { message: `network: ${(e as Error).message}` });
    }
    const text = await res.text();
    let body: any;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { error: { message: text.slice(0, 300) || `HTTP ${res.status}` } };
    }
    if (!res.ok || body?.error) throw new MetaError(res.status, body?.error ?? { message: `HTTP ${res.status}` });
    return body;
  }

  async get(path: string, params: Record<string, string | number> = {}): Promise<any> {
    const u = new URL(`${GRAPH_BASE}/${META_VERSION}/${path.replace(/^\/+/, "")}`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
    for (const [k, v] of Object.entries(await this.authParams())) u.searchParams.set(k, v);
    return this.send(u.toString(), { method: "GET" });
  }

  async post(path: string, data: Record<string, string | number>): Promise<any> {
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(data)) form.set(k, String(v));
    for (const [k, v] of Object.entries(await this.authParams())) form.set(k, v);
    return this.send(`${GRAPH_BASE}/${META_VERSION}/${path.replace(/^\/+/, "")}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
  }

  // כל הדפים של edge. ‏paging.next כבר נושא את הטוקן ואת שאר הפרמטרים.
  // ‏maxPages הוא בלם: חשבון של משרד אחד אינו מגיע לשם, ולולאה אינסופית
  // על cursor שבור הייתה שורפת את מכסת הקריאות של החשבון.
  async getAll(path: string, params: Record<string, string | number> = {}, maxPages = 20): Promise<any[]> {
    const out: any[] = [];
    let page = await this.get(path, params);
    for (let i = 0; ; i++) {
      out.push(...(page?.data ?? []));
      const next: string | undefined = page?.paging?.next;
      if (!next || i + 1 >= maxPages) break;
      page = await this.send(next, { method: "GET" });
    }
    return out;
  }
}

// ‏act_ הוא חלק מהמזהה ב-Graph, אבל account_id של אובייקט חוזר בלעדיו.
export function normalizeAccountId(raw: string): { act: string; bare: string } {
  const bare = raw.trim().replace(/^act_/, "");
  return { act: `act_${bare}`, bare };
}

// סכום פעולות מסוג מסוים מתוך מערך actions של insights. מטא מחזירה ערכים
// כמחרוזות, ופעולה שלא קרתה פשוט חסרה במערך.
export function actionCount(actions: unknown, types: string[]): number {
  if (!Array.isArray(actions)) return 0;
  let n = 0;
  for (const a of actions) {
    if (a && types.includes(a.action_type)) n += Number(a.value) || 0;
  }
  return n;
}
