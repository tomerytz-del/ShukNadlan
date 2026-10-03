// ============================================================================
// ניקוי טקסט של נכס בשת"פ לפני שהוא מגיע ללקוח/ה.
//
// התיאור הוא טקסט חופשי שהמשרד המפרסם כתב, ומשרדים כותבים בו את עצמם:
// "לפרטים: רונית, תיווך הצפון 050-1234567", "www.office.co.il", "בבלעדיות
// משרדנו". המיניסייט מציג את הנכס בשם הסוכן/ת ששלח/ה אותו, ושורה כזו היא
// בדיוק הדרך לעקוף אותו/ה.
//
// הכלל: **שורה** שיש בה פרט מזהה יורדת כולה, ולא רק המספר שבה. "לפרטים:
// רונית, תיווך הצפון" בלי הטלפון עדיין מזהה את המשרד. ובתוך שורה שנשארת,
// מספר טלפון, מייל וכתובת אתר נמחקים בכל מקרה (רשת ביטחון לשורה ארוכה שבה
// הפרט נבלע באמצע פסקה).
//
// מה שאינו נתפס כאן, ונאמר במסמך: שם משרד שנכתב בכתיב אחר מזה שבמסד, ותמונה
// שמופיעה גם בדף הנכס הציבורי (חיפוש תמונה הפוך). ‏docs/client-showcase.md
// ============================================================================

const PHONE = /(?:\+?972[\s-]?|0)(?:[2-9]|5\d|7\d)(?:[\s-]?\d){6,8}/g;
const STAR_PHONE = /\*\d{3,5}\b|\b1[\s-]?[5-9]00[\s-]?\d{2,3}[\s-]?\d{3}\b/g;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const URL_RE = /(?:https?:\/\/|www\.)\S+|\b[\w-]+\.(?:co\.il|org\.il|com|net|info|biz)\b\S*/gi;

// מילים שמסגירות שהנכס אצל משרד אחר, גם בלי שם
const AGENCY_WORDS = /בלעדיות|משרדנו|המשרד שלנו|תיווך\s+\S+|נדל["״]ן\s+\S+\s+(?:בע["״]מ)|לפרטים|ליצירת קשר|צרו קשר|התקשרו/;

function testReset(re: RegExp, s: string): boolean {
  re.lastIndex = 0;
  const hit = re.test(s);
  re.lastIndex = 0;
  return hit;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** מוחק מספר בית מטקסט — אותו כלל של maskHouseNumber ב-assets/property.js. */
export function maskHouseNumber(text: string, houseNumber: string | null | undefined): string {
  const hn = String(houseNumber ?? "").trim();
  if (!text || !hn) return text;
  const re = new RegExp("(^|[^\\d])" + escapeRe(hn) + "(?!\\d)", "g");
  return text.replace(re, "$1").replace(/[ \t]+/g, " ").replace(/ ([,.])/g, "$1").trim();
}

/**
 * מנקה תיאור של נכס בשת"פ. ‏names — שם המשרד המפרסם, שם הסוכן/ת שלו
 * ו-agent2_name; כל שורה שמכילה אחד מהם יורדת.
 */
export function scrubPartnerText(text: string | null | undefined, names: Array<string | null | undefined>): string {
  if (!text) return "";
  const needles = names
    .map((n) => String(n ?? "").trim())
    .filter((n) => n.length >= 2)
    .map((n) => n.toLowerCase());

  const kept = String(text)
    .split(/\r?\n/)
    .filter((line) => {
      const low = line.toLowerCase();
      if (needles.some((n) => low.includes(n))) return false;
      if (testReset(PHONE, line) || testReset(STAR_PHONE, line)) return false;
      if (testReset(EMAIL, line) || testReset(URL_RE, line)) return false;
      if (AGENCY_WORDS.test(line)) return false;
      return true;
    })
    .map((line) => line.replace(PHONE, "").replace(STAR_PHONE, "").replace(EMAIL, "").replace(URL_RE, ""));

  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
