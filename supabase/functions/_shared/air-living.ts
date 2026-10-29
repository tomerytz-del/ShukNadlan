/** כיווני אוויר ושטח סלון.
 *  הערכים במסד: צפון, דרום, מזרח, מערב. ספירה נגזרת, לא נשמרת.
 *  "סלון גדול" אצל קונה הוא קיצור ל-30 מ"ר, בלי עמודה נפרדת.
 */

export const AIR_ORDER = ["צפון", "דרום", "מזרח", "מערב"] as const;
export type AirDir = (typeof AIR_ORDER)[number];

const AIR_WORDS: Record<string, AirDir> = {
  צפון: "צפון", צ: "צפון", n: "צפון", north: "צפון",
  דרום: "דרום", ד: "דרום", s: "דרום", south: "דרום",
  מזרח: "מזרח", מז: "מזרח", e: "מזרח", east: "מזרח",
  מערב: "מערב", מע: "מערב", w: "מערב", west: "מערב",
};

/** קיצור "סלון גדול" בכרטיס הקונה. לא נשמר כדגל. */
export const LARGE_LIVING_ROOM_SQM = 30;
export const LIVING_MIN = 4;
export const LIVING_MAX = 150;

export function parseAirDirections(value: unknown): AirDir[] {
  const raw = Array.isArray(value) ? value.join(" ") : String(value ?? "");
  const parts = raw.split(/[\s,/|+]+/).map((p) => p.trim()).filter(Boolean);
  const out: AirDir[] = [];
  for (const part of parts) {
    const key = part.toLowerCase();
    const dir = AIR_WORDS[part] || AIR_WORDS[key];
    if (dir && !out.includes(dir)) out.push(dir);
  }
  return AIR_ORDER.filter((d) => out.includes(d));
}

/** "3 כיווני אוויר" בלי שמות אינו רשימת כיוונים. */
export function airCountOnly(value: unknown): number | null {
  const raw = Array.isArray(value) ? "" : String(value ?? "").trim();
  if (!raw || parseAirDirections(raw).length) return null;
  const m = raw.match(/([1-4])\s*כיוו/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 2 && n <= 4 ? n : null;
}

export function airCountPhrase(n: number): string {
  if (n === 1) return "כיוון אוויר אחד";
  return `${n} כיווני אוויר`;
}

export function formatSqm(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "";
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

/** 🟡 דף הנכס. כיוון אחד ביחיד, משניים ברבים. ריק = לא מציגים. */
export function customerAirLine(value: unknown): string {
  const dirs = parseAirDirections(value);
  if (!dirs.length) return "";
  if (dirs.length === 1) return `כיוון אוויר: ${dirs[0]}`;
  return `כיווני אוויר: ${dirs.join(", ")}`;
}

/** 🟡 דף הנכס. מספר מדוד בלבד, בלי "סלון גדול". */
export function customerLivingLine(sqm: unknown): string {
  const n = formatSqm(sqm);
  if (!n) return "";
  return `גודל הסלון: כ־${n} מ״ר`;
}

/** 🟡 משפט אחד לתיאור המטא. בלי שינוי כותרת. */
export function metaAirLivingClause(dirs: unknown, sqm: unknown): string {
  const list = parseAirDirections(dirs);
  const n = formatSqm(sqm);
  const parts = [
    list.length ? airCountPhrase(list.length) : "",
    n ? `סלון של כ־${n} מ״ר` : "",
  ].filter(Boolean);
  return parts.join(", ");
}

export function jsonLdAirLiving(dirs: unknown, sqm: unknown): Array<Record<string, unknown>> {
  const list = parseAirDirections(dirs);
  const out: Array<Record<string, unknown>> = [];
  if (list.length) {
    out.push({ "@type": "PropertyValue", name: "כיווני אוויר", value: list.join(", ") });
    out.push({ "@type": "PropertyValue", name: "מספר כיווני אוויר", value: list.length });
  }
  const n = Number(sqm);
  if (Number.isFinite(n) && n > 0) {
    out.push({ "@type": "PropertyValue", name: "גודל סלון", value: n, unitCode: "MTK" });
  }
  return out;
}

/** 🟡 כרטיס קונה כשמוצג ללקוח. */
export function customerSeekAir(value: unknown): string {
  const dirs = parseAirDirections(value);
  if (!dirs.length) return "";
  return `מחפשים כיווני אוויר: ${dirs.join(", ")}`;
}

export function customerSeekLiving(sqm: unknown): string {
  const n = formatSqm(sqm);
  if (!n) return "";
  return `גודל סלון מינימלי: ${n} מ״ר`;
}

/** שורת התאמה ללקוח: רק שדה שמתאים. לא מדגישים פער. */
export function customerMatchLines(
  wantDirs: unknown,
  haveDirs: unknown,
  minSqm: unknown,
  haveSqm: unknown,
): string[] {
  const want = parseAirDirections(wantDirs);
  const have = parseAirDirections(haveDirs);
  const lines: string[] = [];
  if (want.length && have.length && want.every((d) => have.includes(d))) {
    lines.push(customerAirLine(have));
  }
  const min = Number(minSqm);
  const got = Number(haveSqm);
  if (Number.isFinite(min) && min > 0 && Number.isFinite(got) && got >= min) {
    const line = customerLivingLine(got);
    if (line) lines.push(line);
  }
  return lines.filter(Boolean);
}

/** המשפט לפונה כשביקש/ה כיוון או סלון והנתון חסר בתוצאות. */
export const AIR_LIVING_GAP_NOTE =
  "ברוב הנכסים עדיין לא מעודכנים כיווני האוויר וגודל הסלון, אז הנה נכסים שמתאימים לשאר מה שביקשתם. את הפרטים האלה אפשר לברר מול הסוכן המטפל.";

function askedAir(args: { air_directions?: unknown }): AirDir[] {
  return parseAirDirections(args.air_directions);
}

function askedLiving(args: { min_living_room_sqm?: unknown }): number | null {
  if (args.min_living_room_sqm === null || args.min_living_room_sqm === undefined || args.min_living_room_sqm === "") {
    return null;
  }
  const n = Number(args.min_living_room_sqm);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** נכס בלי הנתון נשאר. נכס עם נתון שלא מתאים יורד. */
export function airLivingRowKept(
  row: { air_directions?: unknown; living_room_sqm?: unknown },
  args: { air_directions?: unknown; min_living_room_sqm?: unknown },
): boolean {
  const want = askedAir(args);
  const have = parseAirDirections(row.air_directions);
  if (want.length && have.length && !want.every((d) => have.includes(d))) return false;
  const min = askedLiving(args);
  if (min !== null && row.living_room_sqm !== null && row.living_room_sqm !== undefined && row.living_room_sqm !== "") {
    const got = Number(row.living_room_sqm);
    if (Number.isFinite(got) && got < min) return false;
  }
  return true;
}

export function airLivingGapNote(
  rows: Array<{ air_directions?: unknown; living_room_sqm?: unknown }>,
  args: { air_directions?: unknown; min_living_room_sqm?: unknown },
): string | null {
  if (!askedAir(args).length && askedLiving(args) === null) return null;
  if (!rows.length) return null;
  const missing = rows.some((row) => {
    if (askedAir(args).length && !parseAirDirections(row.air_directions).length) return true;
    if (askedLiving(args) !== null && (row.living_room_sqm === null || row.living_room_sqm === undefined || row.living_room_sqm === "")) {
      return true;
    }
    return false;
  });
  return missing ? AIR_LIVING_GAP_NOTE : null;
}

/** "3 כיווני אוויר" אינו מערך. אחרי pickWritable המחרוזת נשארת ושוברת את השמירה. */
export function writeAirDirections(
  payload: Record<string, unknown>,
  raw: unknown,
  client = false,
): void {
  if (raw === undefined) return;
  const dirs = parseAirDirections(raw);
  const key = client ? "required_directions" : "air_directions";
  if (dirs.length) {
    payload[key] = dirs;
    return;
  }
  if (!client && airCountOnly(raw)) {
    delete payload.air_directions;
    return;
  }
  payload[key] = null;
}

const MASC_SG =
  "ה?(?:גדול|מרווח|ענק|עצום|רחב\\s+ידיים)";
const MASC_PL =
  "ה?(?:גדולים|מרווחים|ענקיים|עצומים)";
const WORD_SG = "[\\u0590-\\u05FF]+(?<!ים)(?<!ות)";

/**
 * טענה על גודל הסלון. תואר שמתאים לשם אחר ("מרפסת גדולה", "חדרים מרווחים") לא נספר.
 */
export function mentionsLivingSizeClaim(s: string): boolean {
  const text = String(s || "");
  const head = `(?:^|[^\\u0590-\\u05FF])[ובלמשכה]{0,4}`;
  const end = `(?=$|[^\\u0590-\\u05FF])`;
  const patterns = [
    `${head}סלון[\\s־-]+(?:הוא\\s+)?${MASC_SG}${end}`,
    `${head}סלונים[\\s־-]+${MASC_PL}${end}`,
    `${head}סלון\\s+${WORD_SG}\\s*[,ו]?\\s*${MASC_SG}${end}`,
    `${head}סלון\\s+ו\\s*${WORD_SG}\\s+${MASC_PL}${end}`,
  ];
  return patterns.some((p) => new RegExp(p, "u").test(text));
}

const AIR_LIVING_UNSAVED =
  "כיווני אוויר וגודל סלון עדיין לא נשמרים בהתראות, אז כדאי לבדוק אותם בעמוד של כל נכס.";

/** המשפט אחרי שמירת חיפוש, רק על מה שנשמר באמת. */
export function savedSearchAirLivingLine(labels: string[]): string {
  const items = labels.map((s) => s.trim()).filter(Boolean);
  let head = "שמרתי את החיפוש";
  if (items.length === 1) head = `שמרתי את החיפוש לפי ${items[0]}`;
  else if (items.length === 2) head = `שמרתי את החיפוש לפי ${items[0]} ו${items[1]}`;
  else if (items.length > 2) {
    head = `שמרתי את החיפוש לפי ${items.slice(0, -1).join(", ")} ו${items[items.length - 1]}`;
  }
  return `${head}. ${AIR_LIVING_UNSAVED}`;
}

/** הפונה ביקש/ה כיוון אוויר או גודל סלון, לא "דירה מרווחת". */
export function visitorAskedAirOrLiving(text: string): boolean {
  const s = String(text || "");
  if (/כיוו(?:ן|ני|נות)(?:\s+ה)?\s*אוויר/.test(s)) return true;
  if (askedAirPair(s)) return true;
  if (/(?:ל)?(?:שני|שתיים|שלושה|שלוש|ארבעה|ארבע|\d+)\s+כיוונים/.test(s)) return true;
  if (/גודל\s+ה?סלון|שטח\s+ה?סלון|סלון\s+מינימ/.test(s)) return true;
  return mentionsLivingSizeClaim(s);
}

/** זוג כיוונים. "בצפון מערב העיר" הוא מקום, לא בקשת אוויר. */
function askedAirPair(s: string): boolean {
  const re = /(צפון|דרום|מזרח|מערב)(?:\s+|[-־/])(צפון|דרום|מזרח|מערב)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const before = s.slice(Math.max(0, m.index - 1), m.index);
    const after = s.slice(m.index + m[0].length);
    const inPlace = before === "ב" && /^\s*(?:העיר|שכונ|האזור|הרחוב)/.test(after);
    if (inPlace) continue;
    return true;
  }
  return false;
}

function labelValues(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v || "").trim()).filter(Boolean);
}

function labelNumber(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false;
  return Number.isFinite(Number(value));
}

/** רק שדות שנשמרו. שכונה שלא זוהתה אינה "האזור". */
export function savedSearchLabelList(saved: {
  cities?: unknown;
  neighborhoodIds?: unknown;
  minRooms?: unknown;
  maxRooms?: unknown;
  minPrice?: unknown;
  maxPrice?: unknown;
  propertyTypes?: unknown;
  minSize?: unknown;
  features?: unknown;
}): string[] {
  const labels: string[] = [];
  if (labelValues(saved.cities).length || labelValues(saved.neighborhoodIds).length) labels.push("האזור");
  if (labelNumber(saved.minRooms) || labelNumber(saved.maxRooms)) labels.push("החדרים");
  if (labelNumber(saved.minPrice) || labelNumber(saved.maxPrice)) labels.push("התקציב");
  if (labelValues(saved.propertyTypes).length) labels.push("סוג הנכס");
  if (labelNumber(saved.minSize)) labels.push("השטח");
  if (labelValues(saved.features).length) labels.push("המאפיינים");
  return labels;
}

/** סינון חיפוש: נכס בלי נתון עובר. נכס עם נתון שלא מתאים לא. */
export function airLivingFilterGroups(args: {
  air_directions?: unknown;
  min_living_room_sqm?: unknown;
}): string[][] {
  const groups: string[][] = [];
  const air = parseAirDirections(args.air_directions);
  if (air.length) {
    const list = air.map((d) => `"${d}"`).join(",");
    groups.push(["air_directions.is.null", `air_directions.cs.{${list}}`]);
  }
  const min = askedLiving(args);
  if (min !== null) groups.push(["living_room_sqm.is.null", `living_room_sqm.gte.${min}`]);
  return groups;
}

/** מינימום מספר כיוונים. מערך ריק או null עובר. */
export function minAirCountKept(dirs: unknown, min: number): boolean {
  if (!Array.isArray(dirs) || dirs.length === 0) return true;
  return dirs.length >= min;
}

export function livingInRange(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  const n = Number(value);
  return Number.isFinite(n) && n >= LIVING_MIN && n <= LIVING_MAX;
}
