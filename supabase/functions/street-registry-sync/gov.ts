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
// ## המאגר: רחובות **ושמות נרדפים** (resource bf185c7f-…)
//
// המאגר המורחב נושא את 63 אלף הרחובות הרשמיים (street_name_status =
// official) ועוד 88 אלף שמות נרדפים ("synonym of <סמל>" - "הרצל" → "שד
// הרצל" בקריית ביאליק, "האירוס" → "אירוס" בגן נר). הורדה אחת נותנת את
// שניהם: הרשמיים נכנסים ל-street_registry, והנרדפים ל-street_registry_aliases,
// וכך מה שסוכן/ת מקליד/ה מתורגם לשם הרשמי. המאגר הבסיסי (9ad3862c-…, בלי
// סטטוס) עדיין נתמך - אז כל השורות רשמיות ואין נרדפים.
//
// ## הכלל: הורדה חלקית אינה סנכרון
//
// אותו כלל של סריקת ה-WFS: אם לא הגיעו כל השורות שהמאגר מצהיר עליהן
// (`total`), או שהמאגר קטן בהרבה מהצפוי - זו תקלה, ואף עיר לא נקלטת.
// ============================================================================

export const DEFAULT_RESOURCE_ID = "bf185c7f-1a4e-4662-88c5-fa118a244bda";
export const API = "https://data.gov.il/api/3/action/datastore_search";
// ‏data.gov.il דורש User-Agent מזוהה מלקוחות שאינם דפדפן (אחרת 403).
export const USER_AGENT = "datagov-external-client";
// המאגר המורחב מחזיק כ-152 אלף שורות (הבסיסי כ-63 אלף). פחות מ-40 אלף הוא
// תשובה שבורה בכל אחד מהם, לא ארץ שהתכווצה.
export const MIN_TOTAL_ROWS = 40_000;
export const PAGE = 32_000;

/** מפתח השוואה לשם יישוב: אותם צירים של city_name_key במסד - רווחים,
    מקף כרווח, גרשיים לצורה אחת, יו"ד ווי"ו כפולות - ובלי סוגריים: המאגר
    המורחב כותב אותם הפוכים (")מושב(" - שארית ייצוא מימין לשמאל), ו"מרחביה
    (מושב)" שלנו לא הייתה מוצאת כלום. */
export function settlementKey(s: unknown): string {
  return String(s ?? "")
    .replace(/[׳`']/g, "'").replace(/[״"]/g, '"')
    .replace(/[()]/g, " ")
    .replace(/[־\-–]/g, " ")
    .replace(/\s+/g, " ").trim()
    .replace(/י{2,}/g, "י").replace(/ו{2,}/g, "ו");
}

/** מפתח לרחוב, רק לזיהוי "הרחוב הוא שם היישוב עצמו". */
function looseKey(s: unknown): string {
  return settlementKey(s).replace(/['"]/g, "");
}

export type FieldNames = {
  settlement: string; street: string;
  // רק במאגר המורחב
  status?: string; cityCode?: string; streetCode?: string; officialCode?: string;
};

/** שמות השדות מתוך הרשומה הראשונה - בעברית (המאגר הבסיסי: "שם_ישוב",
    "שם_רחוב") או באנגלית (המורחב: city_name, street_name, street_name_status,
    city_code, street_code, official_code). זורקת אם אינם שם: פורמט שהשתנה
    הוא תקלה, לא "אין רחובות". */
export function detectFields(record: Record<string, unknown>): FieldNames {
  const keys = Object.keys(record || {});
  const norm = (k: string) => k.replace(/[\s_]+/g, "_").trim().toLowerCase();
  const find = (...words: string[]) => {
    for (const w of words) {
      const hit = keys.find((k) => norm(k) === w) ?? keys.find((k) => norm(k).includes(w));
      if (hit) return hit;
    }
    return undefined;
  };
  const settlement = find("שם_ישוב", "city_name");
  const street = find("שם_רחוב", "street_name");
  if (!settlement || !street) {
    throw new Error("data.gov.il: unexpected fields: " + keys.join(","));
  }
  return {
    settlement, street,
    status: keys.find((k) => norm(k) === "street_name_status"),
    cityCode: keys.find((k) => norm(k) === "city_code"),
    streetCode: keys.find((k) => norm(k) === "street_code"),
    officialCode: keys.find((k) => norm(k) === "official_code"),
  };
}

export type CityStreets = { streets: string[]; aliases: Array<{ alias: string; name: string }> };

/* שם כפי שיישמר: רווחים מכווצים, וסוגריים הפוכים (")א ק(") מיושרים - אותה
   שארית ייצוא שב-settlementKey, רק שכאן השם מוצג לסוכן/ת ולכן מתוקן ולא נמחק. */
const clean = (v: unknown) => String(v ?? "")
  .replace(/\)([^()]*)\(/g, "($1)")
  .replace(/\s+/g, " ").trim();

/**
 * הרחובות - והשמות הנרדפים - של כל עיר שביקשנו, מתוך כל שורות המאגר.
 *
 * ‏`cities` הם השמות **שלנו** (cities.name), והמפתחות בתוצאה הם אותם שמות -
 * כך שהשורות נכתבות ל-street_registry בדיוק בשם שהטופס שואל עליו.
 *
 * ביישוב בלי רחובות עם שם, המאגר רושם "רחוב" אחד בשם היישוב עצמו (בדרך כלל
 * סמל 9000). זה אינו רחוב ואינו נכנס לרשימה - וגם שם נרדף שמצביע עליו לא.
 *
 * שם נרדף נכנס רק כשהרחוב הרשמי שלו נמצא (לפי סמל יישוב + official_code),
 * ורק כשהוא שונה ממנו - "הרצל" → "שד הרצל" כן, "הרצל" → "הרצל" לא.
 */
export function streetsByCity(
  rows: Array<Record<string, unknown>>,
  cities: string[],
): Map<string, CityStreets> {
  const streets = new Map<string, Set<string>>();
  const aliases = new Map<string, Map<string, string>>();
  const want = new Map<string, string>();
  for (const c of cities) {
    want.set(settlementKey(c), c);
    streets.set(c, new Set());
    aliases.set(c, new Map());
  }
  const done = () => new Map(cities.map((c) => [c, {
    streets: [...streets.get(c)!].sort((a, b) => a.localeCompare(b, "he")),
    aliases: [...aliases.get(c)!].map(([alias, name]) => ({ alias, name }))
      .sort((a, b) => a.alias.localeCompare(b.alias, "he")),
  }]));
  if (!rows.length) return done();
  const f = detectFields(rows[0]);
  const isOfficial = (r: Record<string, unknown>) =>
    !f.status || clean(r[f.status]).toLowerCase() === "official";

  // הרחובות הרשמיים, וטבלת סמל → שם לתרגום הנרדפים
  const officialByCode = new Map<string, string>();
  for (const r of rows) {
    if (!isOfficial(r)) continue;
    const ours = want.get(settlementKey(r[f.settlement]));
    if (!ours) continue;
    const street = clean(r[f.street]);
    if (street.length < 2) continue;
    if (looseKey(street) === looseKey(r[f.settlement])) continue;
    streets.get(ours)!.add(street);
    if (f.cityCode && f.streetCode) {
      officialByCode.set(clean(r[f.cityCode]) + "|" + clean(r[f.streetCode]), street);
    }
  }

  if (f.status && f.cityCode && f.officialCode) {
    for (const r of rows) {
      if (isOfficial(r)) continue;
      const ours = want.get(settlementKey(r[f.settlement]));
      if (!ours) continue;
      const name = officialByCode.get(clean(r[f.cityCode]) + "|" + clean(r[f.officialCode]));
      const alias = clean(r[f.street]);
      if (!name || alias.length < 2 || looseKey(alias) === looseKey(name)) continue;
      if (!aliases.get(ours)!.has(alias)) aliases.get(ours)!.set(alias, name);
    }
  }
  return done();
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
