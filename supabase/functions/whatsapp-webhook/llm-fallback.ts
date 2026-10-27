// כשקריאת המודל נכשלת, הפונה עדיין מקבל/ת תשובה, ומנהל/ת הפלטפורמה התראה.
// יתרת Anthropic שנגמרה אינה "נסו שוב בעוד רגע": ניסיון חוזר לא יעזור.
// אין כאן תור שמעבד מחדש הודעה שנשמרה, ולכן הנוסח לא מבטיח שנחזור אליה.

export type LlmFailureKind = "billing" | "transient" | "other";
export type FallbackAudience = "agent" | "visitor";

export function llmErrorText(err: unknown): string {
  const e = err as { message?: string; status?: number; error?: { message?: string; type?: string } };
  return String(e?.error?.message || e?.message || err || "");
}

export function llmFailureKind(err: unknown): LlmFailureKind {
  const msg = llmErrorText(err);
  const status = (err as { status?: number })?.status;
  if (/credit balance|billing|insufficient.credits|purchase credits/i.test(msg)) return "billing";
  if (status === 408 || status === 409 || status === 429 || status === 529 || (typeof status === "number" && status >= 500)) {
    return "transient";
  }
  if (/overloaded|rate_limit|timeout|timed out|ECONNRESET|fetch failed|network/i.test(msg)) return "transient";
  return "other";
}

/**
 * כשל של קריאת המודל, לא כל חריגה. שגיאת מסד (קוד PostgREST, בלי סטטוס
 * של Anthropic) אינה "קריאת המודל נכשלה" ואינה בולעת התראות אמיתיות.
 */
export function isModelCallError(err: unknown): boolean {
  if (llmFailureKind(err) === "billing") return true;
  const e = err as { name?: string; status?: number; error?: { type?: string } };
  const name = String(e?.name || "");
  if (/Anthropic|APIError|RateLimit|InternalServerError|APIConnectionError/i.test(name)) return true;
  const type = String(e?.error?.type || "");
  if (/invalid_request_error|authentication_error|permission_error|not_found_error|rate_limit_error|api_error|overloaded_error/.test(type)) {
    return true;
  }
  if (e?.status === 529) return true;
  const msg = llmErrorText(err);
  if (/anthropic|claude|credit balance|overloaded_error/i.test(msg)) return true;
  return false;
}

/** המסך שנפתח מהכפתור כשהמודל לא ענה. לא כתובת בגוף ההודעה. */
export const FALLBACK_AGENT_PATH = "/crm?goto=bell";

export function fallbackReply(kind: LlmFailureKind, audience: FallbackAudience, siteBase: string): string {
  const site = siteBase.replace(/\/$/, "");
  if (audience === "agent") {
    if (kind === "billing") {
      return "אני לא זמינה לרגע בגלל תקלה אצלי, וההודעה שלך נשמרה. " +
        "אפשר להמשיך בינתיים מהאזור האישי.\nאפשר לשלוח לי שוב כשזה יסתדר.";
    }
    return "משהו השתבש אצלי רגע לפני שעניתי, וההודעה שלך נשמרה. " +
      "אפשר לשלוח אותה שוב, או להמשיך מהאזור האישי.";
  }
  if (kind === "billing") {
    return "אני לא זמינה לרגע בגלל תקלה אצלי. " +
      `אפשר לנסות שוב מאוחר יותר, או להמשיך באתר: ${site}`;
  }
  return "משהו השתבש אצלי רגע לפני שעניתי. אפשר לשלוח את ההודעה שוב.";
}

/** כותרת נפרדת לכל סוג, כדי שספירת כפילויות לא תבלע התראה ממקור אחר. */
export function adminAlertTitle(kind: LlmFailureKind): string {
  if (kind === "billing") return "גבריאלה: יתרת המודל נגמרה";
  if (kind === "transient") return "גבריאלה: קריאת המודל נכשלה זמנית";
  return "גבריאלה: קריאת המודל נכשלה";
}

/** שאילתות שהוובהוק ממלא מול supabase. הקובץ עצמו לא מייבא את הלקוח. */
export interface AdminAlertDb {
  /** כמה התראות מאותו סוג ואותה כותרת נכתבו מאז `since`. */
  recentCount(type: string, title: string, sinceIso: string): Promise<number>;
  adminIds(): Promise<string[]>;
  insert(rows: { agent_id: string; type: string; title: string; body: string }[]): Promise<string | null>;
}

/**
 * התראה אחת למנהלי הפלטפורמה, לא בכל הודעה. כפילות של אותה כותרת ב-6 שעות
 * נבלעת. יתרה שנגמרה הולכת ל-budget_alert; כשל מודל אחר ל-ops_alert.
 * התראת ops_alert ממקור אחר, עם כותרת אחרת, לא נספרת כאן.
 */
export async function alertPlatformAdmins(
  db: AdminAlertDb,
  kind: LlmFailureKind,
  detail: string,
): Promise<void> {
  const type = kind === "billing" ? "budget_alert" : "ops_alert";
  const title = adminAlertTitle(kind);
  const since = new Date(Date.now() - 6 * 3600_000).toISOString();
  try {
    if (await db.recentCount(type, title, since) > 0) return;
    const ids = await db.adminIds();
    if (!ids.length) return;
    const body = detail.replace(/\s+/g, " ").slice(0, 300);
    const err = await db.insert(ids.map((agent_id) => ({ agent_id, type, title, body })));
    if (err) console.error("gabriela admin alert failed", err);
  } catch (err) {
    console.error("gabriela admin alert failed", err);
  }
}
