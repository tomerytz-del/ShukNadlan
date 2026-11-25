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

// אותיות שנדבקות בראש מילה בעברית: ו, ה, ב, כ, ל, מ, ש ("ולאברהים" = ו + ל + אברהים). עד שתיים.
const HEBREW_PREFIX = /^[והבכלמש]{1,2}$/u;

/** האם המילה מהטקסט היא מילת השם, עם קידומת עברית או בלעדיה. הכלה בתוך מילה אינה נחשבת ("בר" בתוך "אברהים"). */
function wordMatches(word: string, token: string): boolean {
  if (word === token) return true;
  // מילת שם קצרה (שתי אותיות) רק בהתאמה מלאה: "מה" ו"של" נדבקות לכל מילה
  if (Array.from(token).length < 3 || !word.endsWith(token)) return false;
  return HEBREW_PREFIX.test(word.slice(0, word.length - token.length));
}

/**
 * האם כל מילות השם (שתי אותיות ומעלה) נאמרו בדברי הסוכן/ת, כמילים שלמות ובאותה הודעה. שם בלי מילים שאפשר לבדוק אינו נחשב נתמך.
 */
export function nameSupportedByWords(fullName: unknown, texts: readonly string[]): boolean {
  const tokens = normalizeName(fullName).split(" ").filter((t) => Array.from(t).length >= 2);
  if (!tokens.length) return false;
  // כל חלקי השם באותה הודעה: "משה" על אחד ו"כהן" על אחר, בשתי הודעות, אינם "משה כהן"
  return texts.some((text) => {
    const words = normalizeName(text).split(" ").filter(Boolean);
    return tokens.every((t) => words.some((w) => wordMatches(w, t)));
  });
}

// מה שלא נכתב בידי הסוכן/ת: תמלול הקלטה או מסמך שהועברו אליי (media-intake.ts), והודעה מועברת.
const THIRD_PARTY_BLOCK = /\[(?:הקלטת שיחה - תמלול|מסמך שהתקבל)[^\]\n]*\]\n[\s\S]*?\n\[סוף הקובץ\]/g;
const FORWARDED_MARK = "[הודעה מועברת - נכתבה במקור על ידי מישהו אחר]";

/** רק מה שהסוכן/ת כתב/ה: בלי בלוקי תמלול ומסמך, ובלי הודעה מועברת (שנכתבה בידי אחר/ת). */
export function agentOwnWords(text: string): string {
  if (text.startsWith(FORWARDED_MARK)) return "";
  return text.replace(THIRD_PARTY_BLOCK, " ");
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
    .map((m) => agentOwnWords(m.content as string));
  return [...past, agentOwnWords(current)];
}

export type LinkGuard = { ok: false; error: "needs_link_confirmation"; linked_name: string | null; guidance: string };

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
  const shown = label || "";
  return {
    ok: false,
    error: "needs_link_confirmation",
    linked_name: shown || null,
    guidance:
      `לא נקבע כלום ולא נשלח כלום. הסוכן/ת לא אמר/ה את השם המלא${shown ? ` "${shown}"` : " שבכרטיס"}, ולכן אסור לקשר את הפגישה לכרטיס הזה ` +
      `(קישור שולח אישור בוואטסאפ לאדם שבכרטיס, וביטול שולח לו עוד הודעה). שאל/י בשורה אחת: ` +
      `${shown ? `"לקשר לכרטיס של ${shown}?"` : `"לקשר לכרטיס או לליד שמצאתי? (אין לו שם שמור, אציין את הטלפון או מה שיש)"`} ועצור/עצרי. אחרי "כן" מפורש בהודעה נפרדת: אותה קריאה שוב עם client_confirmed true. ` +
      `אחרי "לא", או אם אין כרטיס כזה: בלי client_id ובלי lead_id (הפגישה נשארת ביומן בלי לקוח/ה, והתזכורת רק אליו/ה). ` +
      `לעולם לא להגיד "קבעתי" לפני שהקריאה הצליחה.`,
  };
}
