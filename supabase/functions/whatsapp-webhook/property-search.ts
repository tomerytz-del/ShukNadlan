// ============================================================================
// חיפוש נכסים - הסינון המשותף לשני הבוטים
//
// ‏`search_properties` של הבוט הציבורי ו-`search_properties` של העוזרת של
// הסוכנים מסננים באותה דרך בדיוק: סוג נכס בהתאמה חלקית, שכונה מנורמלת,
// וכינויי שכונה מ-`neighborhood_aliases`. שני עותקים היו נפרדים תוך שבוע -
// ואז "סי 1" היה מוצא את C1 אצל גולש ולא אצל מתווך/ת. ההבדל בין הבוטים
// הוא **המאגר** (מה מותר לראות), לא הסינון. ‏docs/whatsapp-public-bot.md,
// "שכונה וסוג נכס".
// ============================================================================

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const DEAL_TYPES = ["sale", "rent"];
export const CATEGORIES = ["residential", "commercial"];

/**
 * ‏400 מכסה בנוחות את כל הלוח בהיקף הנוכחי. סינון האזור נעשה אחרי השליפה,
 * ולכן שליפה לפי אזור חייבת להיות רחבה; אם הלוח יגדל בסדר גודל, זו הנקודה
 * שבה הסינון צריך לרדת ל-SQL (RPC עם join לשכונות).
 */
export const AREA_SCAN_LIMIT = 400;

/**
 * מחרוזת נקייה בתקרת אורך. ברירת המחדל 80 מתאימה לשמות, ערים ומזהים —
 * **לא** לשדות חופשיים.
 */
export function text(value: unknown, maxLen = 80): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  return s ? s.slice(0, maxLen) : null;
}

/** התאמה חלקית ב-PostgREST. ‏% ו-_ בקלט של משתמש חייבים בריחה. */
export function likeSafe(value: string): string {
  return `%${value.replace(/[%_\\]/g, "\\$&")}%`;
}

/**
 * מפתח השוואה לשם שכונה/אזור. גולשים כותבים "סי 1", "C-1", "שכונת c1" על
 * מה שבמסד הוא "לב העמק C1", והשוואת substring גולמית החזירה 0 בזמן שארבע
 * דירות 5 חדרים חיו שם (‏4.10.2026). לכן: אותיות לטיניות שנכתבו בעברית
 * חוזרות ללטינית, ורווחים, מקפים וגרשים נמחקים משני הצדדים.
 */
const HEB_LATIN: [RegExp, string][] = [
  [/(^|[^א-ת])סי(?=[\s\-]*\d)/g, "$1c"],
  [/(^|[^א-ת])בי(?=[\s\-]*\d)/g, "$1b"],
  [/(^|[^א-ת])די(?=[\s\-]*\d)/g, "$1d"],
  [/(^|[^א-ת])אי(?=[\s\-]*\d)/g, "$1a"],
];
export function areaKey(value: string): string {
  let s = value.toLowerCase();
  for (const [re, to] of HEB_LATIN) s = s.replace(re, to);
  return s.replace(/[^0-9a-zא-ת]/g, "");
}
/** "שכונת C1" → "C1": המילה הכללית אינה חלק מהשם שבמסד. */
export function areaNeedle(value: string): string {
  return areaKey(value.replace(/^\s*(שכונת|שכונה|שכ'|אזור|איזור|באזור|בשכונת)\s+/, ""));
}

/**
 * סוגי הנכס במסד אינם אחידים ("מגרש" ו-"מגרשים", "גג/פנטהאוז"), ו-`in`
 * מדויק החמיץ אותם. התאמה חלקית על הגזע: סיומת רבים יורדת, וכל שאר
 * התווים שאינם אות או רווח נמחקים - כך שהערך אינו יכול לשבור את תחביר
 * ה-`or` של PostgREST.
 */
export function typePattern(value: string): string | null {
  const stem = value.replace(/[^א-תa-zA-Z\s]/g, " ").trim()
    .replace(/(ים|ות)$/, "").replace(/\s+/g, "*");
  return stem.length >= 2 ? `property_type.ilike.*${stem}*` : null;
}

/** עיר בתוך `or` של PostgREST - אותו ניקוי, מאותה סיבה. */
function cityPattern(value: string): string | null {
  const s = value.replace(/[^א-תa-zA-Z0-9'\s\-]/g, " ").trim().replace(/\s+/g, "*");
  return s.length >= 2 ? `city.ilike.*${s}*` : null;
}

export interface ParsedFilters {
  city: string | null;
  minPrice: number | null;
  maxPrice: number | null;
  minRooms: number | null;
  maxRooms: number | null;
  minSize: number | null;
  maxFloor: number | null;
}

/**
 * כל הסינונים שאינם שכונה, על שאילתת `properties` קיימת. ‏`cities` (מערך)
 * הוא לדרישות של לקוח/ה מהקובץ, שיכולות למנות כמה ערים.
 *
 * ‏**`or` אחד בלבד בבקשה.** כמה קבוצות "או" (מאגרים, ערים, סוגי נכס) נכתבות
 * כ-`and(or(...),or(...))` בפרמטר יחיד, ולא כשני פרמטרי `or` שאין ערובה
 * שיוחלו שניהם. ‏`orGroups` - קבוצות של הקורא (המאגרים של הסוכן/ת).
 */
export function applyPropertyFilters(
  // deno-lint-ignore no-explicit-any
  query: any,
  args: Record<string, unknown>,
  orGroups: string[][] = [],
  // deno-lint-ignore no-explicit-any
): { query: any; parsed: ParsedFilters } {
  const groups = orGroups.filter((g) => g.length);
  const dealType = text(args.deal_type);
  if (dealType && DEAL_TYPES.includes(dealType)) query = query.eq("deal_type", dealType);

  const category = text(args.category);
  if (category && CATEGORIES.includes(category)) query = query.eq("category", category);

  const city = text(args.city);
  if (city) query = query.ilike("city", likeSafe(city));
  if (Array.isArray(args.cities)) {
    const pats = args.cities.map((c) => text(c)).filter((c): c is string => !!c)
      .slice(0, 8).map(cityPattern).filter((c): c is string => !!c);
    if (pats.length) groups.push(pats);
  }

  if (Array.isArray(args.property_types)) {
    const patterns = args.property_types
      .map((t) => text(t))
      .filter((t): t is string => !!t)
      .slice(0, 6)
      .map(typePattern)
      .filter((t): t is string => !!t);
    if (patterns.length) groups.push(patterns);
  }
  if (groups.length === 1) query = query.or(groups[0].join(","));
  else if (groups.length > 1) {
    query = query.or(`and(${groups.map((g) => g.length === 1 ? g[0] : `or(${g.join(",")})`).join(",")})`);
  }

  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const parsed: ParsedFilters = {
    city,
    minPrice: num(args.min_price),
    maxPrice: num(args.max_price),
    minRooms: num(args.min_rooms),
    maxRooms: num(args.max_rooms),
    minSize: num(args.min_size_sqm),
    maxFloor: num(args.max_floor),
  };
  if (parsed.minPrice !== null) query = query.gte("price", parsed.minPrice);
  if (parsed.maxPrice !== null) query = query.lte("price", parsed.maxPrice);
  if (parsed.minRooms !== null) query = query.gte("rooms", parsed.minRooms);
  if (parsed.maxRooms !== null) query = query.lte("rooms", parsed.maxRooms);
  if (parsed.minSize !== null) query = query.gte("size_sqm", parsed.minSize);
  if (parsed.maxFloor !== null) query = query.lte("floor", parsed.maxFloor);

  if (Array.isArray(args.features)) {
    const feats = args.features
      .map((f) => text(f))
      .filter((f): f is string => !!f)
      .slice(0, 8);
    if (feats.length) query = query.contains("features", feats);
  }
  return { query, parsed };
}

/**
 * סינון השכונה על שורות שכבר נשלפו (עם `neighborhoods(name)` ו-`sales_area`).
 *
 * השכונה יושבת בטבלה אחרת ואזור המכירה בעמודת טקסט חופשי; סינון על שתיהן
 * בשאילתה אחת דורש embed מסוג inner, שמפיל נכסים בלי שכונה משויכת.
 *
 * כינויים שנקבעו בהכרעה (‏`neighborhood_aliases`): "C1" ו"לב העמק" הם
 * "לב העמק C1". ‏"ברובע" / "במרכז" - אות היחס נופלת לפני ההשוואה לכינוי.
 *
 * **כינוי מדויק גובר על ה-substring.** "מרכז" הוא מרכז העיר בעפולה
 * (‏5.10.2026), אבל כ-substring הוא תפס גם את "מרכז עפולה עלית" ב-
 * `sales_area` של בית בעפולה עלית, ו"מרכז עפולה" תפס **רק** אותו. כשהשם
 * הוא כינוי במדויק - מתאימים רק לשכונות של הכינוי (בשם השכונה או
 * ב-`sales_area` שכתוב בשם הזה), ולא בהתאמה חלקית.
 *
 * ‏`hint` חוזר כשהשם עצמו אינו מוכר: 0 תוצאות אז אינו "אין נכסים שם" אלא
 * "לא הבנתי איפה" - ובלי הרמז הבוט אמר "לא מצאתי ב-21" כאילו בדק.
 */
export async function filterByArea<T>(
  supabase: SupabaseClient,
  rows: T[],
  area: string,
  city: string | null,
  opts: { withHint: boolean },
): Promise<{ rows: T[]; hint: Record<string, unknown> }> {
  const needle = areaNeedle(area) || areaKey(area);
  if (!needle) return { rows: [], hint: {} };
  const bare = needle.replace(/^(וב|ב|ה)(?=.{3})/, "");

  const aliasHoods = new Set<string>();
  let exactAlias = false;
  const { data: aliases } = await supabase
    .from("neighborhood_aliases")
    .select("alias, neighborhoods(name, city)");
  for (const a of aliases || []) {
    // deno-lint-ignore no-explicit-any
    const n = (a as any).neighborhoods;
    if (!n?.name || (city && !String(n.city || "").includes(city))) continue;
    const k = areaKey(String(a.alias));
    if (!k) continue;
    const exact = k === needle || k === bare;
    if (exact || k.includes(needle)) aliasHoods.add(areaKey(n.name));
    if (exact) exactAlias = true;
  }

  const out = rows.filter((p) => {
    // deno-lint-ignore no-explicit-any
    const hood = areaKey((p as any).neighborhoods?.name || "");
    // deno-lint-ignore no-explicit-any
    const sales = areaKey((p as any).sales_area || "");
    if (exactAlias) return aliasHoods.has(hood) || aliasHoods.has(sales);
    return hood.includes(needle) || sales.includes(needle) || aliasHoods.has(hood);
  });

  if (out.length || !opts.withHint || aliasHoods.size) return { rows: out, hint: {} };

  let hoods = supabase.from("neighborhoods").select("name");
  if (city) hoods = hoods.ilike("city", likeSafe(city));
  let sales = supabase.from("properties").select("sales_area")
    .eq("status", "active").not("sales_area", "is", null);
  if (city) sales = sales.ilike("city", likeSafe(city));
  const [{ data: known }, { data: salesRows }] = await Promise.all([
    hoods.limit(200),
    sales.limit(AREA_SCAN_LIMIT),
  ]);
  const names = [...new Set((known || []).map((n) => String(n.name)))];
  const salesAreas = (salesRows || []).map((r) => String(r.sales_area));
  if ([...names, ...salesAreas].some((n) => areaKey(n).includes(needle))) {
    return { rows: out, hint: {} };
  }
  return {
    rows: out,
    hint: {
      area_not_recognized: true,
      known_neighborhoods: names.slice(0, 40),
      area_note:
        "השכונה שהתבקשה אינה מוכרת במאגר בשם הזה. לא לומר \"לא מצאתי ב...\" " +
        "כאילו נבדק - לשאול לאיזו מהשכונות ב-known_neighborhoods הכוונה, " +
        "או לחפש שוב עם השם הנכון.",
    },
  };
}
