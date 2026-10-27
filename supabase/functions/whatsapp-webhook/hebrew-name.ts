// חיפוש לקוחות סלחני: כ/ק, ט/ת, ו/וו, וי"ד חסרה, וטלפון בלי קשר לקידומת.
//
// ilike על השם תופס רק את הכתיב שנשמר. "קלפון" לא מוצא "כלפון", ונפתח
// כרטיס שני ואחריו טיוטות הסכם. כאן ההשוואה היא אחרי נרמול, לא במקום
// ה-ilike: התאמה מדויקת נשארת ראשונה, וזה רק מה ש-ilike מפספס.

const FINALS: Record<string, string> = { "ם": "מ", "ן": "נ", "ץ": "צ", "ף": "פ", "ך": "כ" };

/** ספרות בלבד, 972 הופך ל-0, ותשע הספרות האחרונות. קצר מ-9 = אין מפתח. */
export function phoneKey(raw: unknown): string {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.startsWith("972")) d = "0" + d.slice(3);
  if (d.length === 9 && d.startsWith("5")) d = "0" + d;
  return d.length >= 9 ? d.slice(-9) : "";
}

export function phonesMatch(a: unknown, b: unknown): boolean {
  const ka = phoneKey(a);
  const kb = phoneKey(b);
  return ka.length >= 9 && ka === kb;
}

/**
 * י' באמצע המילה יורדת ("דויד"/"דוד"). י' בראש המילה ו-י' בסופה נשארות:
 * מחיקה של כולן הפכה את "ישי לוי" ל"לו" ואת "רוני" ל"רון".
 * אותו כלל ב-client_name_skeleton במיגרציה 20271027150100.
 */
function stripMedialYod(word: string): string {
  if (word.length <= 2) return word;
  const mid = word.slice(1, -1).replace(/י/g, "");
  return word[0] + mid + word[word.length - 1];
}

/**
 * שלד להשוואת שם: אותיות סופיות, בלי ניקוד וגרשיים, ו"ו כפולה לו אחת,
 * כ/ק לאות אחת, ט/ת לאות אחת, ובלי י' באמצע המילה. "קלפון" ו"כלפון"
 * יוצאים זהים, וכך גם "דויד"/"דוד" ו"וייצמן"/"ויצמן".
 */
export function nameSkeleton(raw: unknown): string {
  let s = String(raw ?? "").normalize("NFKC");
  s = s.replace(/[֑-ׇ]/g, "").replace(/["'״׳`]/g, "");
  s = s.replace(/[םןץףך]/g, (c) => FINALS[c] || c);
  s = s.replace(/[^א-תA-Za-z0-9\s]/g, " ");
  s = s.replace(/ו{2,}/g, "ו");
  s = s.replace(/[כק]/g, "ק").replace(/[טת]/g, "ת");
  s = s.split(" ").map(stripMedialYod).join(" ");
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function tokens(skeleton: string): string[] {
  // מאורך 2, כדי ששם פרטי קצר אחרי הורדת י' ("דני" -> "דנ") לא ייעלם
  // וישאיר רק את שם המשפחה. "דני כהן" ו"רון כהן" אינם אותו אדם.
  return skeleton.split(" ").filter((w) => w.length >= 2);
}

/**
 * אותו אדם בסבירות גבוהה.
 * שני שמות מלאים: השם הפרטי חייב להתאים, וגם מילה נוספת (שם משפחה).
 * שם של מילה אחת: רק אם הוא השם הפרטי, או מילה של 4 אותיות ומעלה
 * ("כלפון" בתוך "משפחת כלפון"). "כהן" לבדו אינו תופס את "דני כהן".
 */
export function namesLikelySame(a: unknown, b: unknown): boolean {
  const ta = tokens(nameSkeleton(a));
  const tb = tokens(nameSkeleton(b));
  if (!ta.length || !tb.length) return false;
  if (ta.length >= 2 && tb.length >= 2) {
    if (ta[0] !== tb[0]) return false;
    return ta.slice(1).some((w) => tb.slice(1).includes(w));
  }
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (short.length === 1 && long.length >= 2) {
    const w = short[0];
    if (w === long[0]) return true;
    return w.length >= 4 && long.includes(w);
  }
  return short[0] === long[0];
}

/**
 * אותו שם משפחה, שם פרטי אחר. לא חוסמים יצירה - שואלים את הסוכן/ת.
 * טלפון זהה נשאר חסימה נפרדת, ב-phonesMatch.
 */
export function namesNeedConfirm(a: unknown, b: unknown): boolean {
  const ta = tokens(nameSkeleton(a));
  const tb = tokens(nameSkeleton(b));
  if (ta.length < 2 || tb.length < 2) return false;
  if (ta[0] === tb[0]) return false;
  const lastA = ta[ta.length - 1];
  const lastB = tb[tb.length - 1];
  return lastA.length >= 3 && lastA === lastB;
}

/** חיפוש: שם סלחני, או טלפון כשיש לפחות 7 ספרות בשאילתה. */
export function clientMatchesQuery(
  query: string,
  client: { full_name?: unknown; phone?: unknown },
): boolean {
  const q = query.trim();
  if (!q) return false;
  const digits = q.replace(/\D/g, "");
  if (digits.length >= 7 && phonesMatch(q, client.phone)) return true;
  if (namesLikelySame(q, client.full_name)) return true;
  const sq = nameSkeleton(q);
  const sn = nameSkeleton(client.full_name);
  if (sq.replace(/ /g, "").length >= 3 && sn.includes(sq)) return true;
  return false;
}
