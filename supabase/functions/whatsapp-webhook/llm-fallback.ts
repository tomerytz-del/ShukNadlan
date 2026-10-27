// כשקריאת המודל נכשלת, הסוכן/ת עדיין מקבל/ת תשובה, ומנהל/ת הפלטפורמה התראה.
// יתרת Anthropic שנגמרה אינה "נסו שוב בעוד רגע": ניסיון חוזר לא יעזור,
// והסוכן/ת נשאר/ה בלי מענה אם לא נשלח כאן טקסט.

export type LlmFailureKind = "billing" | "transient" | "other";

export function llmErrorText(err: unknown): string {
  const e = err as { message?: string; status?: number; error?: { message?: string } };
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

export function fallbackReply(kind: LlmFailureKind, siteBase: string): string {
  const crm = `${siteBase.replace(/\/$/, "")}/crm`;
  if (kind === "billing") {
    return "אני לא זמינה לרגע בגלל תקלה אצלי, וההודעה שלך נשמרה. " +
      `אפשר להמשיך בינתיים מהאזור האישי: ${crm}\nאחזור לענות ברגע שזה יסתדר.`;
  }
  return "משהו השתבש אצלי רגע לפני שעניתי, וההודעה שלך נשמרה. " +
    `אפשר לשלוח אותה שוב, או להמשיך מהאזור האישי: ${crm}`;
}

/** שאילתות שהוובהוק ממלא מול supabase. הקובץ עצמו לא מייבא את הלקוח. */
export interface AdminAlertDb {
  /** כמה התראות מאותו סוג נכתבו מאז `since`. */
  recentCount(type: string, sinceIso: string): Promise<number>;
  adminIds(): Promise<string[]>;
  insert(rows: { agent_id: string; type: string; title: string; body: string }[]): Promise<string | null>;
}

/**
 * התראה אחת למנהלי הפלטפורמה, לא בכל הודעה. כפילות ב-6 שעות נבלעת.
 * יתרה שנגמרה הולכת ל-budget_alert; שאר הכשלים ל-ops_alert. שניהם סוגים
 * קיימים, בלי סוג התראה חדש.
 */
export async function alertPlatformAdmins(
  db: AdminAlertDb,
  kind: LlmFailureKind,
  detail: string,
): Promise<void> {
  const type = kind === "billing" ? "budget_alert" : "ops_alert";
  const title = kind === "billing"
    ? "גבריאלה: יתרת המודל נגמרה"
    : "גבריאלה: קריאת המודל נכשלה";
  const since = new Date(Date.now() - 6 * 3600_000).toISOString();
  try {
    if (await db.recentCount(type, since) > 0) return;
    const ids = await db.adminIds();
    if (!ids.length) return;
    const body = detail.replace(/\s+/g, " ").slice(0, 300);
    const err = await db.insert(ids.map((agent_id) => ({ agent_id, type, title, body })));
    if (err) console.error("gabriela admin alert failed", err);
  } catch (err) {
    console.error("gabriela admin alert failed", err);
  }
}
