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

/** "מרווח" כמילה שלמה, כולל נטיות. לא משנה את הטקסט. */
export function mentionsMaruah(s: string): boolean {
  return /(?:^|[^\u0590-\u05FF])מרווח(?:ה|ים|ות|ת)?(?=$|[^\u0590-\u05FF])/u.test(String(s || ""));
}

export function livingInRange(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  const n = Number(value);
  return Number.isFinite(n) && n >= LIVING_MIN && n <= LIVING_MAX;
}
