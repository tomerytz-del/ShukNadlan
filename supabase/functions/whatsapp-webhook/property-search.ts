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
// הכללים המשותפים לאתר ולבוטים - מה נחשב "יש בנכס", המילים, עסקה מתוך
// תקציב. עותק זהה של assets/search-core.js (‏check_search_core.py).
import "../_shared/search-core.js";

// deno-lint-ignore no-explicit-any
export const SearchCore = (globalThis as any).SearchCore;

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

// מפתח ההשוואה לשמות אזורים (‏"סי 1" = C1) - ‏SearchCore.areaKey, משותף לאתר.

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
  /* מה נחשב "יש בנכס" - מאותה טבלה שהאתר מסנן לפיה (‏SearchCore.featureFilter):
     מרפסת ← גם מרפסת שמש, ממ״ד ← גם mamad_location = 'unit'. כל "או" כזה
     נכנס ל-groups - `or` אחד בלבד בבקשה (ראו למעלה). */
  const feats = Array.isArray(args.features)
    ? args.features.map((f) => text(f)).filter((f): f is string => !!f).slice(0, 8)
    : [];
  const ff = SearchCore.featureFilter(feats) as { strict: string[]; groups: string[][] };
  if (ff.strict.length) query = query.contains("features", ff.strict);
  ff.groups.forEach((g) => groups.push(g));

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

  return { query, parsed };
}

/**
 * סינון השכונה על שורות שכבר נשלפו - **באותו מפענח של האתר**
 * (‏SearchCore.findAreas / inAreas, ‏_shared/search-core.js, docs/search-core.md).
 *
 * עד 21.10.2026 היה כאן מפענח משלו, והוא נפרד מזה של האתר בשלושה מקומות:
 *
 *   ‏• **`sales_area` כ-substring.** הוא טקסט חופשי של הסוכן/ת - "מרכז העיר"
 *     כתוב על נכסים באזור התעשייה, "אזור עפולה והעמקים" על חצי עיר - וחיפוש
 *     "מרכז העיר" החזיר אותם. עכשיו השכונה של נכס היא `neighborhood_id`,
 *     ו-`sales_area` נקרא רק כשאין שכונה, ורק דרך אותו מפענח שמות.
 *   ‏• **כינויים.** כאן - מהטבלה; באתר - רשימה בקוד. עכשיו הטבלה לשניהם.
 *   ‏• **"כינוי מדויק גובר".** עכשיו: ההתאמה הארוכה כמילה שלמה, ובשוויון
 *     השם על הכינוי - "מרכז עפולה עלית" הוא עפולה עלית, "מרכז" הוא מרכז העיר.
 *
 * שם שאינו שכונה (רחוב, יישוב, שם פרויקט) - ‏SearchCore.textMatches, כמו
 * ‎text:‎ באתר: כותרת, רחוב, כתובת, עיר, שכונה ו-`sales_area`. כאן נשארת התאמה חלקית לשם השכונה (‏partial: "המורה" ←
 * גבעת המורה), כי `area` של הכלי הוא שם של אזור ולא משפט שלם.
 *
 * השכונות נטענות רק לערים של השורות שכבר נשלפו: "מרכז העיר" קיים בעשרות
 * ערים, ושכונה מעיר אחרת אינה יכולה להיות התשובה.
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
  if (!SearchCore.areaKey(area)) return { rows: [], hint: {} };

  // deno-lint-ignore no-explicit-any
  const cities = [...new Set(rows.map((p) => String((p as any).city || "")).filter(Boolean))].slice(0, 30);
  let hq = supabase.from("neighborhoods").select("id, name, city");
  if (city) hq = hq.ilike("city", likeSafe(city));
  else if (cities.length) hq = hq.in("city", cities);
  const [{ data: hoods }, { data: aliases }] = await Promise.all([
    hq.limit(1000),
    supabase.from("neighborhood_aliases").select("neighborhood_id, alias"),
  ]);
  const byHood: Record<string, string[]> = {};
  for (const a of aliases || []) {
    const id = String(a.neighborhood_id);
    (byHood[id] = byHood[id] || []).push(String(a.alias));
  }
  const index = SearchCore.areaIndex((hoods || []).map((h) => ({
    target: String(h.id), label: String(h.name), aliases: byHood[String(h.id)] || [],
  })), { stop: city ? [city, ...cities] : cities }); // שם העיר אינו מילה מזהה של שכונה

  const hit = SearchCore.findAreas(area, index, { partial: true }) as { targets: string[] } | null;
  let out: T[];
  if (hit) {
    out = rows.filter((p) => SearchCore.inAreas(p, hit.targets, index));
  } else {
    out = rows.filter((p) => SearchCore.textMatches(p, area));
  }

  if (out.length || !opts.withHint || hit) return { rows: out, hint: {} };

  /* שם שאינו שכונה, כינוי, רחוב או יישוב, ולא נמצא דבר - לדוח "שמות שלא
     זוהו" (‏area_name_misses). מנהל/ת מאשר/ת אותו ככינוי ב-CRM, ומאותו רגע
     גבריאלה והאתר מזהים אותו (‏docs/search-core.md, "הלולאה"). כשל ברישום
     אינו מפיל את החיפוש. */
  const phrase = area.trim().replace(/\s+/g, " ");
  if (phrase.length >= 2 && phrase.length <= 60 && !phrase.includes("@") && !/[0-9]{9,}/.test(phrase)) {
    try {
      await supabase.from("area_name_misses").insert({
        phrase, city: city ? city.slice(0, 60) : null, source: "whatsapp", result_count: 0,
      });
    } catch (_e) { /* מדידה, לא תקלה */ }
  }

  const names = [...new Set((hoods || []).map((n) => String(n.name)))];
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
