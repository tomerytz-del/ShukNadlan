// קישור פגישה לכרטיס לקוח/ה או לליד: רק לפי מה שהסוכן/ת אמר/ה.
// docs/meeting-client-followup.md, "קישור הפגישה לכרטיס".
//
// הכשל (24.11.2026): הסוכן/ת ביקש/ה לקבוע חתימת הסכם עם "אברהים". המודל חיפש בקובץ, מצא כרטיס אחר עם
// שם דומה (לא אותו אדם), קישר אליו את הפגישה, ובגלל הקישור יצא אליו אישור בוואטסאפ. ביטול אחר כך שולח
// לאותו אדם הודעה נוספת, כך שאי אפשר לתקן בלי לפגוע שוב. לכן הבדיקה כאן **לפני** הכתיבה, בקוד, ולא רק
// בהנחיה: היא לא תלויה בשיקול דעת של המודל.
//
// הכלל: מקשרים בלי לשאול רק כשכל מילות השם בכרטיס נאמרו בהודעות האחרונות של הסוכן/ת. שם פרטי בלבד
// ("אברהים") מול כרטיס "אברהים זועבי" אינו מספיק. אחרת שואלים "לקשר לכרטיס של <שם>?", ורק אחרי "כן"
// קוראים שוב עם client_confirmed.
//
// בקובץ נפרד מ-agent.ts כדי שהבדיקה תרוץ בלי לטעון את כל העוזרת.

const NIQQUD = /[֑-ׇ]/g;

/** אותיות וספרות בלבד, אות קטנה, בלי ניקוד ובלי גרשיים: "ג'ורג'" ו"גורג" זהים. */
export function normalizeName(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(NIQQUD, "")
    .replace(/["'`´׳״]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * האם כל מילות השם (שתי אותיות ומעלה) מופיעות בדברי הסוכן/ת. בדיקת הכלה ולא שוויון מילה, כי בעברית
 * קידומת נדבקת ("לאברהים", "עם־אברהים"). שם בלי מילים שאפשר לבדוק אינו נחשב נתמך.
 */
export function nameSupportedByWords(fullName: unknown, texts: readonly string[]): boolean {
  const tokens = normalizeName(fullName).split(" ").filter((t) => Array.from(t).length >= 2);
  if (!tokens.length) return false;
  const haystack = normalizeName(texts.join(" "));
  return tokens.every((t) => haystack.includes(t));
}

/** מה שהסוכן/ת כתב/ה בתור הזה ובכמה התורים שלפניו (ההיסטוריה שומרת טקסט בלבד). */
export function recentAgentWords(
  history: readonly { role?: string; content?: unknown }[] | undefined,
  current: string,
  lastTurns = 6,
): string[] {
  const past = (history || [])
    .filter((m) => m && m.role === "user" && typeof m.content === "string")
    .slice(-lastTurns)
    .map((m) => m.content as string);
  return [...past, current];
}

export type LinkGuard = { ok: false; error: "needs_link_confirmation"; linked_name: string; guidance: string };

/**
 * null = מותר לקשר. אחרת מחזירים את התשובה לכלי, בלי לכתוב כלום. `confirmed` הוא ה-`client_confirmed` שהמודל
 * שולח אחרי שהסוכן/ת אישר/ה במפורש בהודעה נפרדת.
 */
export function linkGuard(
  name: unknown,
  words: readonly string[],
  confirmed: unknown,
): LinkGuard | null {
  if (confirmed === true) return null;
  const label = String(name ?? "").trim();
  if (label && nameSupportedByWords(label, words)) return null;
  const shown = label || "הכרטיס";
  return {
    ok: false,
    error: "needs_link_confirmation",
    linked_name: shown,
    guidance:
      `לא נקבע כלום ולא נשלח כלום. הסוכן/ת לא אמר/ה את השם המלא "${shown}", ולכן אסור לקשר את הפגישה לכרטיס הזה ` +
      `(קישור שולח אישור בוואטסאפ לאדם שבכרטיס, וביטול שולח לו עוד הודעה). שאל/י בשורה אחת: ` +
      `"לקשר לכרטיס של ${shown}?" ועצור/עצרי. אחרי "כן" מפורש בהודעה נפרדת: אותה קריאה שוב עם client_confirmed true. ` +
      `אחרי "לא", או אם אין כרטיס כזה: בלי client_id ובלי lead_id (הפגישה נשארת ביומן בלי לקוח/ה, והתזכורת רק אליו/ה). ` +
      `לעולם לא להגיד "קבעתי" לפני שהקריאה הצליחה.`,
  };
}
