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
import { airLivingFilterGroups } from "../_shared/air-living.ts";

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

export interface ResolvedCity {
  /** מה שהוקלד. לא מוחלף בשם קנוני, כדי לא לנתק השוואת טקסט. */
  raw: string;
  /** השם ברישום, או שם הקבוצה (חבל תענך) כשיש יותר מעיר אחת. */
  name: string;
  /** מזהה יחיד. ריק לקבוצת יישובים, כדי שלא יישמר כעיר אחת. */
  id: string | null;
  /** מזהה אחד לעיר, או כל חברי הקבוצה. */
  ids: string[];
  /** שמות היישובים כשהתוצאה היא קבוצה. */
  memberNames: string[];
  /** true כש-city_ids_for_name החזיר יותר ממזהה אחד. */
  group: boolean;
}

const CITY_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asUuidList(data: unknown): string[] {
  if (Array.isArray(data)) {
    return data.map((x) => String(x || "")).filter((s) => CITY_ID_RE.test(s));
  }
  if (typeof data === "string" && CITY_ID_RE.test(data)) return [data];
  if (typeof data === "string" && data.startsWith("{")) {
    const inner = data.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((s) => s.replace(/"/g, "").trim()).filter((s) => CITY_ID_RE.test(s));
  }
  return [];
}

function asTextList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((x) => String(x || "").trim()).filter(Boolean);
}

function looseName(value: string): string {
  return value.replace(/[־–—-]/g, " ").replace(/\s+/g, " ").trim();
}

/** city_id_for_name, כש-city_ids_for_name עוד לא עלתה. */
async function canonicalCityLegacy(
  supabase: SupabaseClient,
  raw: string,
): Promise<ResolvedCity> {
  const { data, error } = await supabase.rpc("city_id_for_name", { p_name: raw });
  if (error || !data) return { raw, name: raw, id: null, ids: [], memberNames: [], group: false };
  const id = String(data);
  const { data: city, error: cityErr } = await supabase.from("cities").select("name").eq("id", id).maybeSingle();
  const cityName = !cityErr && city?.name ? String(city.name) : raw;
  return { raw, name: cityName, id, ids: [id], memberNames: [cityName], group: false };
}

/**
 * עיר או קבוצת יישובים דרך city_ids_for_name. עיר אחת נשארת כמו
 * city_id_for_name. יותר ממזהה אחד הוא קבוצה: השם שנשמר הוא שם האזור
 * (חבל תענך), לא רשימת היישובים. בלי התאמה נשאר מה שהוקלד והמזהה ריק,
 * כדי שהסינון לא ייעלם.
 */
export async function canonicalCity(
  supabase: SupabaseClient,
  name: string | null | undefined,
): Promise<ResolvedCity | null> {
  const raw = text(name);
  if (!raw) return null;
  const { data, error } = await supabase.rpc("city_ids_for_name", { p_name: raw });
  // הפונקציה עולה דקות אחרי הקוד. עד אז city_id_for_name, שכבר בפרודקשן.
  if (error) return canonicalCityLegacy(supabase, raw);
  const ids = asUuidList(data);
  if (ids.length === 0) {
    return { raw, name: raw, id: null, ids: [], memberNames: [], group: false };
  }
  if (ids.length === 1) {
    const id = ids[0];
    const { data: city, error: cityErr } = await supabase.from("cities").select("name").eq("id", id).maybeSingle();
    const cityName = !cityErr && city?.name ? String(city.name) : raw;
    return { raw, name: cityName, id, ids, memberNames: [cityName], group: false };
  }
  const { data: groups, error: groupErr } = await supabase.rpc("city_groups_public");
  const needle = looseName(raw);
  let groupName = raw;
  let memberNames: string[] = [];
  if (!groupErr && Array.isArray(groups)) {
    for (const row of groups) {
      const g = row as { name?: string; aliases?: unknown; member_names?: unknown };
      const aliases = asTextList(g.aliases);
      const names = [String(g.name || ""), ...aliases].map(looseName).filter(Boolean);
      if (!names.includes(needle)) continue;
      groupName = String(g.name || raw);
      memberNames = asTextList(g.member_names);
      break;
    }
  }
  if (memberNames.length !== ids.length) {
    const { data: cities, error: citiesErr } = await supabase.from("cities").select("name").in("id", ids);
    if (!citiesErr && cities?.length) memberNames = cities.map((c) => String(c.name || "")).filter(Boolean);
  }
  return { raw, name: groupName, id: null, ids, memberNames, group: true };
}

/** שם אחד לכרטיס. קבוצה נשמרת כשם האזור, בלי להתרחב ליישובים. */
export async function collapseCityNames(
  supabase: SupabaseClient,
  names: readonly string[],
): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const canon = await canonicalCity(supabase, raw);
    if (!canon) continue;
    const key = canon.group ? `g:${canon.name}` : (canon.id || canon.raw);
    if (seen.has(key)) continue;
    seen.add(key);
    const stored = canon.group ? canon.name : (canon.raw || canon.name);
    if (stored && !out.includes(stored)) out.push(stored);
  }
  return out;
}

/** שדות החיפוש אחרי הפענוח. קבוצה נקראת בשם האזור. */
export function citySearchArgs(canon: ResolvedCity | null, raw: string): Record<string, unknown> {
  if (!canon) return { city: raw, city_raw: raw, city_id: null, city_ids: [], member_names: [], city_group: null };
  return {
    city: canon.name,
    city_raw: canon.raw,
    city_id: canon.id,
    city_ids: canon.ids,
    member_names: canon.memberNames,
    city_group: canon.group ? canon.name : null,
  };
}

export function groupAreaNote(name: string | null | undefined): string | null {
  const area = text(name);
  if (!area) return null;
  return `החיפוש הוא באזור ${area}. לנקוב בשם האזור, לא ברשימת היישובים.`;
}

export async function canonicalCityName(
  supabase: SupabaseClient,
  name: string | null | undefined,
): Promise<string | null> {
  const city = await canonicalCity(supabase, name);
  return city ? city.name : null;
}

/**
 * התאמת עיר ב-PostgREST. עיר אחת: city_id, ואז כתיב שהוקלד, ואז השם
 * הקנוני. קבוצה (יותר ממזהה אחד): city_id.in עם כל החברים, וגם תבנית
 * שם לכל יישוב. "קריית מלאכי" ו-"קרית מלאכי" נפגשים ב-city_id.
 */
export function cityMatchGroup(
  raw: string | null | undefined,
  canonicalName: string | null | undefined,
  cityId: string | null | undefined,
  ids?: readonly string[] | null,
  memberNames?: readonly string[] | null,
): string[] {
  const many = (ids || []).filter((id) => CITY_ID_RE.test(id));
  if (many.length > 1) {
    const parts = [`city_id.in.(${many.join(",")})`];
    for (const name of memberNames || []) {
      const pat = cityPattern(name);
      if (pat && !parts.includes(pat)) parts.push(pat);
    }
    return parts;
  }
  const parts: string[] = [];
  if (cityId && CITY_ID_RE.test(cityId)) parts.push(`city_id.eq.${cityId}`);
  for (const name of [raw, canonicalName]) {
    const pat = name ? cityPattern(name) : null;
    if (pat && !parts.includes(pat)) parts.push(pat);
  }
  return parts;
}

/** חיפוש בלי מאגר (ors ריק) אינו "אפס תוצאות" שרושמים. */
export function shouldLogSearchMiss(total: number, searched: boolean): boolean {
  return searched && !total;
}

/** שורת לוג לחיפוש בלי תוצאות. רק שדות החיפוש, בלי הערות ובלי טלפון. */
function withoutPhone(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value.replace(/(?:\+?\d[\d\-\s().]{7,}\d)/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || null;
}

export function searchMissRow(
  agentId: string,
  args: Record<string, unknown>,
): { agent_id: string; city: string | null; area: string | null; deal_type: string | null } {
  return {
    agent_id: agentId,
    city: withoutPhone(text(args.city)),
    area: withoutPhone(text(args.area)),
    deal_type: withoutPhone(text(args.deal_type)),
  };
}

export function searchMissStoreMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code || "");
  return code === "42P01" || code === "PGRST204" || code === "PGRST205";
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
): { query: any; parsed: ParsedFilters; unknown: { types: string[]; features: string[] } } {
  const groups = orGroups.filter((g) => g.length);
  const dealType = text(args.deal_type);
  if (dealType && DEAL_TYPES.includes(dealType)) query = query.eq("deal_type", dealType);

  const category = text(args.category);
  if (category && CATEGORIES.includes(category)) query = query.eq("category", category);

  const city = text(args.city);
  const cityIds = Array.isArray(args.city_ids) ? args.city_ids.map((id) => String(id || "")) : [];
  const memberNames = Array.isArray(args.member_names) ? args.member_names.map((n) => String(n || "")) : [];
  const cityGroup = cityMatchGroup(
    text(args.city_raw) || city,
    city,
    text(args.city_id),
    cityIds,
    memberNames,
  );
  if (cityGroup.length) groups.push(cityGroup);
  if (Array.isArray(args.cities)) {
    const pats = args.cities.map((c) => text(c)).filter((c): c is string => !!c)
      .slice(0, 8).map(cityPattern).filter((c): c is string => !!c);
    if (pats.length) groups.push(pats);
  }

  /* סוג הנכס - באותן קבוצות של האתר (‏SearchCore.botTypes, 24.10.2026): "וילה"
     הוא בית פרטי, "דירה" כוללת דופלקס וסטודיו. עד אז מה שהמודל כתב נשלח כ-ilike
     חלקי, ו"וילה" החזיר אפס. מה שאינו ערך במסד ואין לו מילה - ‏unknown.types,
     לדוח "מילים שלא זוהו". */
  const unknown: { types: string[]; features: string[] } = { types: [], features: [] };
  if (Array.isArray(args.property_types)) {
    const asked = args.property_types.map((t) => text(t)).filter((t): t is string => !!t).slice(0, 6);
    const bt = SearchCore.botTypes(asked) as { types: string[]; unknown: string[] };
    unknown.types = bt.unknown;
    const patterns = bt.types.slice(0, 12).map(typePattern).filter((t): t is string => !!t);
    if (patterns.length) groups.push(patterns);
  }
  /* מה נחשב "יש בנכס" - מאותה טבלה שהאתר מסנן לפיה (‏SearchCore.featureFilter):
     מרפסת ← גם מרפסת שמש, ממ״ד ← גם mamad_location = 'unit'. כל "או" כזה
     נכנס ל-groups - `or` אחד בלבד בבקשה (ראו למעלה).
     ‏**קוד שאינו קיים בשום נכס יורד מהסינון** (‏SearchCore.knownFeature): מודל
     ששלח "garden" קיבל `contains {garden}` ואפס תוצאות, והבוט אמר "אין". */
  const feats0 = Array.isArray(args.features)
    ? args.features.map((f) => text(f)).filter((f): f is string => !!f).slice(0, 8)
    : [];
  const feats = feats0.filter((f) => SearchCore.knownFeature(f));
  unknown.features = feats0.filter((f) => !SearchCore.knownFeature(f));
  const ff = SearchCore.featureFilter(feats) as { strict: string[]; groups: string[][] };
  if (ff.strict.length) query = query.contains("features", ff.strict);
  ff.groups.forEach((g) => groups.push(g));
  // נכס בלי כיוון או בלי שטח סלון עובר. רק נתון שמולא ולא מתאים יורד.
  // הקבוצה חייבת להיכנס לפני ה-or: אחריו הדחיפה לא מגיעה לשאילתה.
  for (const group of airLivingFilterGroups(args)) groups.push(group);

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
  // ‏price_total: מחיר למ״ר כפול השטח - אחרת חנות ב-140 ₪ למ״ר עונה על "עד 5,000" (docs/price-unit.md)
  if (parsed.minPrice !== null) query = query.gte("price_total", parsed.minPrice);
  if (parsed.maxPrice !== null) query = query.lte("price_total", parsed.maxPrice);
  if (parsed.minRooms !== null) query = query.gte("rooms", parsed.minRooms);
  if (parsed.maxRooms !== null) query = query.lte("rooms", parsed.maxRooms);
  if (parsed.minSize !== null) query = query.gte("size_sqm", parsed.minSize);
  if (parsed.maxFloor !== null) query = query.lte("floor", parsed.maxFloor);

  return { query, parsed, unknown };
}

// ---------------------------------------------------------------------------
// גבריאלה לומדת מהחיפושים (24.10.2026, ‏20270814090000_search_learning.sql)
//
// כל חיפוש מול גולש/ת נרשם ל-`bot_search_events`, מה שקרה אחריו מסומן ב-
// `bot_search_outcome`, ומילים שלא זוהו נכנסות ל-`search_word_misses`. משם
// מנהל/ת הפלטפורמה רואה ביקוש שאין לו מלאי ומה לא הבנו (‏docs/search-core.md).
// **כשל ברישום לעולם אינו מפיל את החיפוש** - זו מדידה.
// ---------------------------------------------------------------------------

/** ‏sha-256 של מספר הוואטסאפ, 16 תווים - לא הטלפון עצמו. */
export async function visitorHash(phone: string | null | undefined): Promise<string | null> {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 7) return null;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(digits));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

const safeWord = (s: string) =>
  s.length >= 2 && s.length <= 40 && !s.includes("@") && !/[0-9]{9,}/.test(s);

export async function logWordMisses(
  supabase: SupabaseClient,
  unknown: { types: string[]; features: string[] },
  city: string | null,
  visitor: string | null,
): Promise<void> {
  const rows = [
    ...unknown.features.map((w) => ({ kind: "feature", phrase: w })),
    ...unknown.types.map((w) => ({ kind: "type", phrase: w })),
  ].map((r) => ({ ...r, phrase: r.phrase.trim().replace(/\s+/g, " ") }))
    .filter((r) => safeWord(r.phrase))
    .slice(0, 6)
    .map((r) => ({
      ...r, source: "whatsapp", city: city ? city.slice(0, 60) : null,
      visitor: visitor ? `wa_${visitor}` : null,
    }));
  if (!rows.length) return;
  try {
    await supabase.from("search_word_misses").insert(rows);
  } catch (_e) { /* מדידה, לא תקלה */ }
}

export async function logBotSearch(
  supabase: SupabaseClient,
  row: {
    visitor: string | null; args: Record<string, unknown>; parsed: ParsedFilters;
    types: string[]; features: string[]; area: string | null; areaRecognized: boolean | null;
    results: number; close: number;
  },
): Promise<void> {
  const area = row.area ? row.area.trim().slice(0, 80) : null;
  try {
    await supabase.from("bot_search_events").insert({
      visitor_hash: row.visitor,
      city: row.parsed.city ? row.parsed.city.slice(0, 60) : null,
      area: area && !area.includes("@") && !/[0-9]{9,}/.test(area) ? area : null,
      area_recognized: area ? row.areaRecognized : null,
      deal_type: text(row.args.deal_type, 20),
      category: text(row.args.category, 20),
      property_types: row.types.slice(0, 12).map((t) => t.slice(0, 40)),
      features: row.features.slice(0, 12).map((f) => f.slice(0, 40)),
      min_price: row.parsed.minPrice,
      max_price: row.parsed.maxPrice,
      min_rooms: row.parsed.minRooms,
      max_rooms: row.parsed.maxRooms,
      result_count: Math.min(row.results, 100000),
      close_count: Math.min(row.close, 100000),
    });
  } catch (_e) { /* מדידה, לא תקלה */ }
}

/** מה קרה אחרי החיפוש האחרון של הפונה: similar / saved / contact. */
export async function markSearchOutcome(
  supabase: SupabaseClient,
  visitor: string | null,
  outcome: "similar" | "saved" | "contact",
): Promise<void> {
  if (!visitor) return;
  try {
    await supabase.rpc("bot_search_outcome", { p_visitor: visitor, p_outcome: outcome });
  } catch (_e) { /* מדידה, לא תקלה */ }
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
  opts: { withHint: boolean; cityId?: string | null; cityIds?: readonly string[] | null; memberNames?: readonly string[] | null },
): Promise<{ rows: T[]; hint: Record<string, unknown> }> {
  if (!SearchCore.areaKey(area)) return { rows: [], hint: {} };

  // deno-lint-ignore no-explicit-any
  const cities = [...new Set(rows.map((p) => String((p as any).city || "")).filter(Boolean))].slice(0, 30);
  let hq = supabase.from("neighborhoods").select("id, name, city");
  const hoodCity = cityMatchGroup(city, city, opts.cityId, opts.cityIds, opts.memberNames);
  if (hoodCity.length) hq = hq.or(hoodCity.join(","));
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
