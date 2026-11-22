// הנמען/ת של פולואפ פגישה כותב/ת "הסר" וכדומה: עוצרים את ההודעות הממתינות ומעדכנים
// את הסוכן/ת. docs/meeting-client-followup.md, "הנמען/ת מבקש/ת להפסיק".
//
// בקובץ נפרד מ-index.ts כדי שהבדיקה תרוץ בלי לטעון את כל הוובהוק.

/**
 * מילים של בקשה להפסיק. כל ההודעה, לא מילה בתוך משפט, ועד 40 תווים: "לא רלוונטי"
 * בתוך הודעה ארוכה על נכס אינו בקשה להסיר.
 * בלי \b ובלי \W: בעברית הם אינם עובדים (כל אות עברית נחשבת "לא מילה"), לכן הפיסוק
 * מופיע במפורש.
 */
const PUNCT = "[\\s.,!?:;\"'()\\-]";
const OPT_OUT_RE = new RegExp(
  `^${PUNCT}*` +
    "(?:" +
    "ת?הסר(?:ה|ו|י|ת)?|הסירו|הסירי|תסיר(?:ו|י)?|" +
    "לא\\s+רלוונטי(?:ת)?|" +
    "לא\\s+מעוניי(?:ן|נת)|" +
    "stop|unsubscribe" +
    ")" +
    `(?:${PUNCT}+(?:אותי|אותנו|את\\s+המספר\\s+הזה|מהרשימה|בבקשה|תודה))*` +
    `${PUNCT}*$`,
  "i",
);

export function isMeetingOptOutText(value: unknown): boolean {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > 40) return false;
  return OPT_OUT_RE.test(text);
}

// ---------------------------------------------------------------------------
// נוסחים: אושרו בידי גבריאלה, מנהלת קשרי הלקוחות (22.11.2026). שינוי בהם הוא שינוי בקובץ הזה
// בלבד, בלי מיגרציה.
// ---------------------------------------------------------------------------

export type StoppedItem = {
  item_id: string;
  agent_id: string;
  title: string | null;
  due_at: string | null;
  contact_name: string | null;
  cancelled: number;
};

/**
 * התשובה לנמען/ת, פעם אחת על ההודעה שלו/ה, ורק כשנעצרה לפחות הודעה אחת (`stoppedItems` הוא
 * מספר הפגישות שנעצרו). אחרי 131050 לא עונים, כי Meta כבר אמרה שאין לשלוח לו/ה.
 */
export function meetingStopCustomerReply(stoppedItems: number): string {
  return stoppedItems > 1
    ? "בסדר, לא נשלח לך עוד הודעות על הפגישות שנקבעו 🙏"
    : "בסדר, לא נשלח לך עוד הודעות על הפגישה הזו 🙏";
}

/**
 * ההתראה לסוכן/ת. הכותרת עד 200 תווים והגוף עד 400, כמו ב-agent_agenda_client_respond.
 * הנוסח המאושר: "🚫 {שם} לא רוצה לקבל עוד הודעות על הפגישה ב-{תאריך ושעה}. התזכורות נעצרו.
 * כדאי לברר איתו אם הפגישה עדיין עומדת."
 */
export function agentStopNotification(item: StoppedItem, whenText: string): { title: string; body: string } {
  const name = String(item.contact_name || "").trim() || "הלקוח/ה";
  const at = whenText ? ` ב-${whenText}` : "";
  return {
    title: `🚫 ${name} לא רוצה לקבל עוד הודעות על הפגישה${at}.`.slice(0, 200),
    body: "התזכורות נעצרו. כדאי לברר איתו אם הפגישה עדיין עומדת.",
  };
}

/** פגישה בטווח הזה מהיום עוקפת את שעות השקט: ההתראה חשובה לפני שהיא מתקיימת. */
export const NEAR_MEETING_HOURS = 12;

/**
 * `created_at` של ההתראה לסוכן/ת. התראת `agenda_reminder` עוקפת שעות שקט רק בחצי השעה
 * הראשונה (`notif_push_urgent_fresh_minutes`), ותזכורת ישנה יותר ממתינה לסוף השקט
 * (`notification_push_stale_in_quiet`, 72 שעות מבט לאחור, כך שהיא שורדת גם שבת). לכן:
 *  · פגישה ב-12 השעות הקרובות: נוצרת עכשיו, ועוקפת את השקט.
 *  · כל השאר (רחוקה יותר, או שכבר התחילה): נוצרת "ישנה" בדקה אחת מעבר לחצי השעה, וממתינה
 *    לסוף השקט. מחוץ לשעות השקט היא יוצאת מיד כמו כל התראה. המחיר: בפעמון היא מוצגת
 *    כמי שנוצרה לפני כחצי שעה.
 */
export function stopNotificationCreatedAt(dueAt: string | null, now: Date, freshMinutes: number): string {
  const due = dueAt ? Date.parse(dueAt) : NaN;
  const ahead = due - now.getTime();
  const near = Number.isFinite(ahead) && ahead >= 0 && ahead <= NEAR_MEETING_HOURS * 3600_000;
  return near ? now.toISOString() : new Date(now.getTime() - (freshMinutes + 1) * 60_000).toISOString();
}
