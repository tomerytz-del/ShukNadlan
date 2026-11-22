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
// נוסחים: טיוטה. ממתינים לאישור של גבריאלה, מנהלת קשרי הלקוחות, לפני שמקבעים אותם.
// הנוסח מוצג בתיאור ה-PR. שינוי נוסח הוא שינוי בקובץ הזה בלבד, בלי מיגרציה.
// ---------------------------------------------------------------------------

export type StoppedItem = {
  item_id: string;
  agent_id: string;
  title: string | null;
  due_at: string | null;
  contact_name: string | null;
  cancelled: number;
};

/** DRAFT: התראה לסוכן/ת. כותרת עד 200 תווים וגוף עד 400, כמו ב-agent_agenda_client_respond. */
export function agentStopNotification(item: StoppedItem, whenText: string): { title: string; body: string } {
  const name = String(item.contact_name || "").trim() || "הלקוח/ה";
  return {
    title: `🚫 ${name} ביקש/ה להפסיק לקבל הודעות`.slice(0, 200),
    body: [
      item.title,
      whenText,
      "ההודעות הממתינות על הפגישה בוטלו, והפגישה נשארה ביומן. כדאי ליצור קשר ישירות.",
    ].filter(Boolean).join(" · ").slice(0, 400),
  };
}

/** DRAFT: אישור לנמען/ת. */
export const MEETING_STOP_CUSTOMER_REPLY = "בסדר, הסרתי אותך. לא נשלח עוד הודעות על הפגישה.";
