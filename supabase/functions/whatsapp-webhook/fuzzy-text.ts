// ---------------------------------------------------------------------------
// התאמת טקסט סלחנית לחיפוש נכס לפי מילים (list_properties)
//
// ‏ilike מוצא רק תת-מחרוזת מדויקת, ולכן נכס שנשמר בשגיאת כתיב נעלם מהחיפוש
// לתמיד. כך "מנחם אושיסקין 18" (ש ו-י הפוכות) לא נמצא ב-12.10.2026 לא
// כשהסוכן כתב "אוסישקין" ולא כשכתב "אושיסקין" - המודל מתקן את הכתיב לפני
// שהוא קורא לכלי. כאן כל מילה בשאילתה צריכה להתאים למילה כלשהי בנכס, עם
// מרחק עריכה שתלוי באורך המילה. מספרים (מספר בית) - רק בהתאמה מדויקת.
// ---------------------------------------------------------------------------

const FINALS: Record<string, string> = { "ם": "מ", "ן": "נ", "ץ": "צ", "ף": "פ", "ך": "כ" };

/** אותיות סופיות לרגילות, בלי ניקוד וגרשיים, אותיות קטנות. */
export function normalizeWord(w: string): string {
  return w
    .toLowerCase()
    .replace(/[֑-ׇ]/g, "")
    .replace(/["'״׳`]/g, "")
    .replace(/[םןץףך]/g, (c) => FINALS[c]);
}

/**
 * ו ו-י הן אמות קריאה: "ויצמן"/"וייצמן" ו"יהושע"/"יהושוע" הם אותו רחוב. אבל
 * רק הוספה או השמטה שלהן - "החורש" ו"החריש" נבדלים ב-ו מול י, והם שני רחובות.
 */
function sameUpToMatres(a: string, b: string): boolean {
  if (a === b) return true;
  const [long, short] = a.length >= b.length ? [a, b] : [b, a];
  let i = 0, j = 0;
  while (i < long.length) {
    if (j < short.length && long[i] === short[j]) { i++; j++; continue; }
    if (long[i] === "ו" || long[i] === "י") { i++; continue; }
    return false;
  }
  return j === short.length;
}

export function words(text: string): string[] {
  return text
    .split(/[\s,.\-–—/()]+/)
    .map(normalizeWord)
    .filter(Boolean);
}

function levenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** ה הידיעה: "החסידה" ו"חסידה" הם אותו רחוב. */
function dropArticle(w: string): string {
  return w.length > 3 && w.startsWith("ה") ? w.slice(1) : w;
}

/**
 * מרחק עריכה רק במילים ארוכות. נמדד מול כל 92 הרחובות שבמסד: במילים של 4-6
 * אותיות שגיאה אחת כבר מחברת רחובות שונים ("רימון" ל"יסמין", "החורש" ל"החריש"),
 * ובמילים של 7 ומעלה שתיים עדיין לא.
 */
function allowance(len: number): number {
  return len >= 7 ? 2 : 0;
}

export function wordMatches(q: string, w: string): boolean {
  if (q === w) return true;
  if (/^\d+$/.test(q) || /^\d+$/.test(w)) return false;
  if (q.length >= 4 && w.startsWith(q)) return true;
  // ו, י ו-ה הידיעה - בהשוואה מדויקת בלבד, לא בתוך מרחק העריכה
  const qa = dropArticle(q), wa = dropArticle(w);
  if (qa.length >= 3 && sameUpToMatres(qa, wa)) return true;
  // ‏"אוסישקין"/"אושיסקין" - שתי אותיות שהתחלפו, באותו אורך. בין אורכים שונים
  // שתי עריכות כבר מחברות שמות אחרים ("יקינטון" ל"קינמון").
  const max = q.length === w.length ? allowance(q.length) : 0;
  return max > 0 && levenshtein(q, w, max) <= max;
}

/** כל מילה בשאילתה מתאימה למילה כלשהי בטקסט. */
export function fuzzyMatches(query: string, haystack: string): boolean {
  const qs = words(query);
  if (!qs.length) return false;
  const hs = words(haystack);
  return qs.every((q) => hs.some((w) => wordMatches(q, w)));
}
