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
 * שלד להשוואת שם: אותיות סופיות, בלי ניקוד וגרשיים, ו"ו כפולה לו אחת,
 * כ/ק לאות אחת, ט/ת לאות אחת, ובלי י'. "קלפון" ו"כלפון" יוצאים זהים,
 * וכך גם "דויד"/"דוד" ו"וייצמן"/"ויצמן".
 */
export function nameSkeleton(raw: unknown): string {
  let s = String(raw ?? "").normalize("NFKC");
  s = s.replace(/[֑-ׇ]/g, "").replace(/["'״׳`]/g, "");
  s = s.replace(/[םןץףך]/g, (c) => FINALS[c] || c);
  s = s.replace(/[^א-תA-Za-z0-9\s]/g, " ");
  s = s.replace(/ו{2,}/g, "ו");
  s = s.replace(/[כק]/g, "ק").replace(/[טת]/g, "ת");
  s = s.replace(/י/g, "");
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function tokens(skeleton: string): string[] {
  return skeleton.split(" ").filter((w) => w.length >= 3);
}

/**
 * אותו אדם בסבירות גבוהה: שלד זהה (מאורך 2, כדי ש"דן" יתפוס את עצמו),
 * או שכל מילה מובהקת בשם הקצר נמצאת בארוך ("כלפון" בתוך "משפחת כלפון").
 */
export function namesLikelySame(a: unknown, b: unknown): boolean {
  const sa = nameSkeleton(a);
  const sb = nameSkeleton(b);
  if (!sa || !sb) return false;
  const ca = sa.replace(/ /g, "");
  const cb = sb.replace(/ /g, "");
  if (sa === sb && ca.length >= 2) return true;
  const ta = tokens(sa);
  const tb = tokens(sb);
  if (!ta.length || !tb.length) return false;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return short.every((w) => long.includes(w));
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
