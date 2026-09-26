// ============================================================================
// רחובות מ-data.gov.il - "רשימת רחובות בישראל" (רשות האוכלוסין)
//
// קובץ טהור, בלי ייבוא: הוא נבדק ב-node (scripts/street_gov_test.ts) ורץ
// ב-Deno בתוך street-registry-sync. ‏docs/street-registry.md, "מקור שני".
//
// ## למה הורדה מלאה ולא שאילתה לכל עיר
//
// שמות היישובים במאגר כתובים בכתיב של הלמ"ס ("קרית ביאליק"), לפעמים עם
// רווחים בסוף, ושאילתת `filters` היא התאמה מדויקת - כלומר "קריית ביאליק"
// שלנו לא הייתה מוצאת כלום, בשקט. לכן מורידים את כל הקובץ (כ-60 אלף שורות,
// שלוש-ארבע בקשות) ומתאימים אצלנו, באותו מפתח שמשווה שמות ערים בכל האתר.
//
// ## הכלל: הורדה חלקית אינה סנכרון
//
// אותו כלל של סריקת ה-WFS: אם לא הגיעו כל השורות שהמאגר מצהיר עליהן
// (`total`), או שהמאגר קטן בהרבה מהצפוי - זו תקלה, ואף עיר לא נקלטת.
// ============================================================================

export const DEFAULT_RESOURCE_ID = "9ad3862c-8391-4b2f-84a4-2d4c68625f4b";
export const API = "https://data.gov.il/api/3/action/datastore_search";
// ‏data.gov.il דורש User-Agent מזוהה מלקוחות שאינם דפדפן (אחרת 403).
export const USER_AGENT = "datagov-external-client";
// המאגר מחזיק כ-60 אלף רחובות. פחות מזה הוא תשובה שבורה, לא ארץ שהתכווצה.
export const MIN_TOTAL_ROWS = 40_000;
export const PAGE = 32_000;

/** מפתח השוואה לשם יישוב: אותם צירים של city_name_key במסד - רווחים,
    מקף כרווח, גרשיים לצורה אחת, יו"ד ווי"ו כפולות. */
export function settlementKey(s: unknown): string {
  return String(s ?? "")
    .replace(/[׳`']/g, "'").replace(/[״"]/g, '"')
    .replace(/[־\-–]/g, " ")
    .replace(/\s+/g, " ").trim()
    .replace(/י{2,}/g, "י").replace(/ו{2,}/g, "ו");
}

/** מפתח לרחוב, רק לזיהוי "הרחוב הוא שם היישוב עצמו". */
function looseKey(s: unknown): string {
  return settlementKey(s).replace(/['"]/g, "");
}

export type FieldNames = { settlement: string; street: string };

/** שמות השדות מתוך הרשומה הראשונה - "שם_ישוב" ו"שם_רחוב", בכל כתיב של
    רווח/קו תחתון. זורקת אם אינם שם: פורמט שהשתנה הוא תקלה, לא "אין רחובות". */
export function detectFields(record: Record<string, unknown>): FieldNames {
  const keys = Object.keys(record || {});
  const find = (word: string) =>
    keys.find((k) => k.replace(/[\s_]+/g, "_").trim() === word) ??
    keys.find((k) => k.replace(/[\s_]+/g, "_").includes(word));
  const settlement = find("שם_ישוב");
  const street = find("שם_רחוב");
  if (!settlement || !street) {
    throw new Error("data.gov.il: unexpected fields: " + keys.join(","));
  }
  return { settlement, street };
}

/**
 * הרחובות של כל עיר שביקשנו, מתוך כל שורות המאגר.
 *
 * ‏`cities` הם השמות **שלנו** (cities.name), והמפתחות בתוצאה הם אותם שמות -
 * כך שהשורות נכתבות ל-street_registry בדיוק בשם שהטופס שואל עליו.
 *
 * ביישוב בלי רחובות עם שם, המאגר רושם "רחוב" אחד בשם היישוב עצמו (בדרך כלל
 * סמל 9000). זה אינו רחוב ואינו נכנס לרשימה.
 */
export function streetsByCity(
  rows: Array<Record<string, unknown>>,
  cities: string[],
): Map<string, string[]> {
  const out = new Map<string, Set<string>>();
  const want = new Map<string, string>();
  for (const c of cities) {
    want.set(settlementKey(c), c);
    out.set(c, new Set());
  }
  if (!rows.length) return new Map(cities.map((c) => [c, []]));
  const f = detectFields(rows[0]);
  for (const r of rows) {
    const ours = want.get(settlementKey(r[f.settlement]));
    if (!ours) continue;
    const street = String(r[f.street] ?? "").replace(/\s+/g, " ").trim();
    if (street.length < 2) continue;
    if (looseKey(street) === looseKey(r[f.settlement])) continue;
    out.get(ours)!.add(street);
  }
  return new Map([...out].map(([c, s]) => [c, [...s].sort((a, b) => a.localeCompare(b, "he"))]));
}

/** כל שורות המאגר, בעמודים. זורקת אם לא הגיע כל מה שהמאגר מצהיר עליו. */
export async function fetchAllRows(
  fetchFn: typeof fetch,
  resourceId: string,
  deadline: number,
): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  let total = -1;
  for (let offset = 0; total < 0 || offset < total; offset += PAGE) {
    if (Date.now() > deadline) throw new Error("deadline_exceeded after " + rows.length + " rows");
    const url = `${API}?resource_id=${encodeURIComponent(resourceId)}&limit=${PAGE}&offset=${offset}`;
    const res = await fetchFn(url, { headers: { "User-Agent": USER_AGENT, "Accept": "application/json" } });
    if (!res.ok) throw new Error("data.gov.il request failed: " + res.status);
    const data = await res.json() as { success?: boolean; result?: { total?: number; records?: unknown[] } };
    if (!data?.success || !Array.isArray(data.result?.records)) {
      throw new Error("data.gov.il returned a payload with no records");
    }
    if (total < 0) total = Number(data.result!.total ?? -1);
    const page = data.result!.records as Array<Record<string, unknown>>;
    rows.push(...page);
    if (!page.length) break;
  }
  if (total < MIN_TOTAL_ROWS) throw new Error("data.gov.il: total " + total + " below " + MIN_TOTAL_ROWS);
  if (rows.length < total) throw new Error("data.gov.il: got " + rows.length + " of " + total + " rows - partial");
  return rows;
}
