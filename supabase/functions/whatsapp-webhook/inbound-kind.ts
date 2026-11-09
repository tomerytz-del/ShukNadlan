/** תגובת אימוג'י על הודעה (type reaction). אין תשובה ואין קריאה למודל. */
export function isReactionMessage(msg: { type?: unknown } | null | undefined): boolean {
  return String(msg?.type || "") === "reaction";
}

/** שימוש הוגן ב-PROFESSIONAL: מה נספר. רק מה שהסוכן/ת יזם/ה וכתב/ה או הקליט/ה
 *  לגבריאלה - טקסט והודעה קולית (Meta שולחת `audio`, ו-handleMessage מקבל גם
 *  `voice`). לא לחיצה על כפתור שגבריאלה שלחה (היא תשובה לה, לא בקשה חדשה), ולא
 *  תמונות: עשר תמונות של נכס אחד הן בקשה אחת. **כיתוב על תמונה כן נספר** - הוא
 *  טקסט שהסוכן/ת כתב/ה, ו-logInbound שומר אותו ב-body של שורת התמונה; לכן
 *  FAIR_USE_CAPTION_TYPES נספרים רק כשיש להם body. הסוגים כפי שהם ב-msg_type. */
export const FAIR_USE_COUNTED_TYPES: readonly string[] = ["text", "audio", "voice"];
export const FAIR_USE_CAPTION_TYPES: readonly string[] = ["image"];

/** לחיצה על כפתור (button / interactive). בשימוש ההוגן היא אינה נספרת, ומתחת
 *  לתקרה הקשיחה אינה נעצרת: היא המשך של פעולה שגבריאלה כבר התחילה - אישור,
 *  בחירה מרשימה, "כן, לפרסם" - וחסימה שלה משאירה את הפעולה חצי עשויה. מעל
 *  הקשיחה היא עוברת רק בתוך שיחה פעילה, כי לחיצה על התראה ישנה היא תור מלא
 *  של המודל (index.ts, השער של שימוש הוגן). */
export function isButtonReply(msg: { type?: unknown } | null | undefined): boolean {
  return FAIR_USE_BUTTON_TYPES.includes(String(msg?.type || ""));
}

/** כפתורים - הסוגים שאינם פותחים "שיחה פעילה" גם כשהם עוברים את השער: לחיצה
 *  על כפתור ישן בהתראה מלפני יומיים אינה אמורה להדליק חצי שעה בלי תקרה. */
export const FAIR_USE_BUTTON_TYPES: readonly string[] = ["button", "interactive"];

/** ההכרעה של שער השימוש ההוגן, כפונקציה טהורה שנבדקת בלי מסד.
 *  ‏"ok" - מתחת לרכה: הכול עובר. ‏"soft" - בין הרכה לקשיחה: נעצרת רק פתיחה של
 *  שיחה חדשה, וכפתור עובר תמיד. ‏"hard" - מעל הקשיחה: נעצר הכול, חוץ מכפתור
 *  בתוך שיחה פעילה (הוא מסיים פעולה פתוחה; כפתור ישן בהתראה הוא תור חדש). */
export function fairUseBlocks(level: "ok" | "soft" | "hard", button: boolean, activeSession: boolean): boolean {
  if (level === "ok") return false;
  if (level === "soft") return !button && !activeSession;
  return !(button && activeSession);
}
