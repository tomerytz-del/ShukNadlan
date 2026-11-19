// ============================================================================
// שם נרדף לרחוב, מאותה טבלה שהטופס והייבוא כבר מתרגמים לפיה
//
// ‏street_registry_aliases היא (עיר, כינוי) → השם הרשמי שב-street_registry.
// המפתח הוא street_name_key, ולכן "קק״ל", "קק"ל", "קק'ל" ו"קקל" הם אותו
// כינוי. רחוב אמיתי גובר: אם המפתח הוא של רחוב שברשימה, לא מתרגמים.
// כינוי מצביע רק על שם שקיים ברשימה הפעילה של אותה עיר.
//
// גבריאלה לא עברה כאן עד עכשיו: הטופס והייבוא כן, הגאוקוד והכלים לא.
// ‏docs/street-registry.md, "שמות נרדפים".
// ============================================================================

import "../search-core.js";

// deno-lint-ignore no-explicit-any
const SearchCore = (globalThis as any).SearchCore;

export function streetKey(name: string): string {
  const fn = SearchCore?.streetNameKey;
  if (typeof fn !== "function") return "";
  return String(fn(name) || "");
}

export interface StreetNameRow {
  city: string;
  name: string;
  active?: boolean;
}

export interface StreetAliasRow {
  city: string;
  alias: string;
  name: string;
}

/** עיר → (מפתח → השם שמוצגים ושומרים). הרשימה נכתבת קודם, והכינוי לא דורס. */
export function streetCanonIndex(
  registry: StreetNameRow[],
  aliases: StreetAliasRow[],
): Map<string, Map<string, string>> {
  const names = new Set<string>();
  const byCity = new Map<string, Map<string, string>>();
  for (const row of registry) {
    if (row.active === false) continue;
    const city = String(row.city || "").trim();
    const name = String(row.name || "").trim();
    if (!city || !name) continue;
    names.add(`${city}|${name}`);
    let keys = byCity.get(city);
    if (!keys) byCity.set(city, keys = new Map());
    const key = streetKey(name);
    if (key && !keys.has(key)) keys.set(key, name);
  }
  for (const row of aliases) {
    const city = String(row.city || "").trim();
    const alias = String(row.alias || "").trim();
    const name = String(row.name || "").trim();
    const keys = byCity.get(city);
    if (!keys || !alias || !names.has(`${city}|${name}`)) continue;
    const key = streetKey(alias);
    if (key && !keys.has(key)) keys.set(key, name);
  }
  return byCity;
}

export function canonicalStreet(
  index: Map<string, Map<string, string>>,
  city: string,
  typed: string,
): string {
  const raw = String(typed ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  const hit = index.get(String(city || "").trim())?.get(streetKey(raw));
  return hit || raw;
}

/** המפתח שהוקלד, מפתח השם הרשמי, וכל כינוי של אותו רחוב באותה עיר. */
export function equivalentStreetKeys(
  index: Map<string, Map<string, string>>,
  city: string,
  typed: string,
): string[] {
  const raw = String(typed ?? "").replace(/\s+/g, " ").trim();
  const typedKey = raw ? streetKey(raw) : "";
  const keys = new Set<string>();
  if (typedKey) keys.add(typedKey);
  const cityMap = index.get(String(city || "").trim());
  if (!cityMap || !typedKey) return [...keys];
  const display = cityMap.get(typedKey);
  if (!display) return [...keys];
  for (const [key, name] of cityMap) if (name === display) keys.add(key);
  return [...keys];
}

/**
 * שם להצגה בגאוקוד, רק כשהכינוי מצביע על רחוב gis שכבר נטען.
 * מפתח של רחוב אמיתי אינו כינוי. רשימת gis ריקה (עיר בלי השכבה) → null,
 * כדי שעיר אחרת לא תקבל כאן תרגום.
 */
export function aliasDisplayName(
  city: string,
  typed: string,
  officialNames: string[],
  aliasRows: Array<{ alias: string; name: string }>,
): string | null {
  const raw = String(typed ?? "").replace(/\s+/g, " ").trim();
  if (!raw || !officialNames.length || !aliasRows.length) return null;
  const key = streetKey(raw);
  if (!key) return null;
  if (officialNames.some((name) => streetKey(name) === key)) return null;
  const index = streetCanonIndex(
    officialNames.map((name) => ({ city, name })),
    aliasRows.map((row) => ({ city, alias: row.alias, name: row.name })),
  );
  const hit = index.get(String(city || "").trim())?.get(key);
  if (!hit || hit === raw || !officialNames.includes(hit)) return null;
  return hit;
}

/** שם אחד כשכל הערים שנשאלו מסכימות. ערים שונות לא נמרחות זו על זו. */
export function aliasStreetLabel(
  index: Map<string, Map<string, string>>,
  cities: string[],
  area: string,
  askedCity: string | null,
): string | null {
  const raw = String(area || "").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  const look = askedCity ? [askedCity] : cities;
  const names = new Set<string>();
  for (const city of look) {
    const hit = canonicalStreet(index, city, raw);
    if (hit && hit !== raw) names.add(hit);
  }
  return names.size === 1 ? [...names][0] : null;
}

/** נכס שמור באחת הצורות של אותו רחוב. בלי כינוי (מפתח אחד) אין הרחבה. */
export function storedStreetMatches(
  index: Map<string, Map<string, string>>,
  city: string,
  storedStreet: string,
  area: string,
): boolean {
  const keys = equivalentStreetKeys(index, city, area);
  if (keys.length < 2) return false;
  const key = streetKey(storedStreet);
  return !!key && keys.includes(key);
}

// deno-lint-ignore no-explicit-any
type Sb = { from: (table: string) => any };

const RESOLVE_TTL_MS = 10 * 60 * 1000;
const resolveCache = new Map<string, { at: number; display: string; keys: string[] }>();

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * השם הרשמי לשמירה ולהצגה, ומפתחות שמוצאים גם רשומה שנשמרה בכינוי.
 * כשל או טבלה שטרם עלתה: השם כמו שהוקלד, בלי זריקה.
 */
export async function resolveStreetAlias(
  supabase: Sb | null | undefined,
  city: string,
  typed: string,
): Promise<{ display: string; keys: string[] }> {
  const raw = clean(typed);
  const cityName = clean(city);
  const key = raw ? streetKey(raw) : "";
  const fallback = { display: raw, keys: key ? [key] : [] as string[] };
  if (!supabase || !cityName || !raw || !key) return fallback;
  const cacheKey = `${cityName}|${key}`;
  const cached = resolveCache.get(cacheKey);
  if (cached && Date.now() - cached.at < RESOLVE_TTL_MS) {
    return { display: cached.display, keys: cached.keys };
  }
  try {
    const reg = await supabase.from("street_registry").select("name")
      .eq("city", cityName).eq("active", true).eq("name_key", key).limit(1);
    if (reg.error) return fallback;
    let display = reg.data?.[0]?.name ? String(reg.data[0].name) : "";
    // אותו מפתח הוא כתיב, לא כינוי. משאירים את מה שהוקלד: property_text_key
    // בעסקאות אינו מכווץ יו"ד כפולה, והחלפה הייתה מפסידה עסקאות.
    const sameKey = !!display;
    if (!display) {
      const alias = await supabase.from("street_registry_aliases").select("name")
        .eq("city", cityName).eq("alias_key", key).limit(1);
      if (alias.error || !alias.data?.[0]?.name) return fallback;
      const name = String(alias.data[0].name);
      const ok = await supabase.from("street_registry").select("name")
        .eq("city", cityName).eq("active", true).eq("name", name).limit(1);
      if (ok.error || !ok.data?.[0]?.name) return fallback;
      display = String(ok.data[0].name);
    }
    const sibs = await supabase.from("street_registry_aliases").select("alias, name")
      .eq("city", cityName).eq("name", display).limit(30);
    const aliasRows: StreetAliasRow[] = sibs.error ? [] : (sibs.data || []).map((row: { alias: string; name: string }) => ({
      city: cityName, alias: String(row.alias), name: String(row.name),
    }));
    const index = streetCanonIndex([{ city: cityName, name: display }], aliasRows);
    const keys = equivalentStreetKeys(index, cityName, raw);
    const value = { display: sameKey ? raw : display, keys: keys.length ? keys : [key] };
    resolveCache.set(cacheKey, { at: Date.now(), ...value });
    return value;
  } catch {
    return fallback;
  }
}

function pgQuote(value: string): string {
  return `"${value.replace(/"/g, "")}"`;
}

/**
 * תנאי or לחיפוש הנכסים של הסוכן/ת: כינוי בעיר מוצא את השם הרשמי של אותה
 * עיר, והשם הרשמי מוצא כינוי שנשמר. העיר בתנאי, כדי שכינוי של עיר אחרת
 * לא ימשוך רחוב שלה.
 */
export async function aliasMatchFilters(
  supabase: Sb | null | undefined,
  query: string,
): Promise<string[]> {
  const raw = clean(query);
  const key = raw ? streetKey(raw) : "";
  if (!supabase || !key) return [];
  try {
    const [aliasRes, regRes] = await Promise.all([
      supabase.from("street_registry_aliases").select("city, alias, name").eq("alias_key", key).limit(40),
      supabase.from("street_registry").select("city, name").eq("active", true).eq("name_key", key).limit(40),
    ]);
    if (aliasRes.error || regRes.error) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    const add = (city: string, streetKeyValue: string) => {
      if (!city || !streetKeyValue || streetKeyValue === key) return;
      const fragment = `and(city.eq.${pgQuote(city)},street_key.eq.${pgQuote(streetKeyValue)})`;
      if (seen.has(fragment)) return;
      seen.add(fragment);
      out.push(fragment);
    };
    const aliasRows = (aliasRes.data || []) as Array<{ city: string; name: string }>;
    const names = [...new Set(aliasRows.map((row) => clean(row.name)).filter(Boolean))];
    const confirmed = new Set<string>();
    if (names.length) {
      const cities = [...new Set(aliasRows.map((row) => clean(row.city)).filter(Boolean))];
      const ok = await supabase.from("street_registry").select("city, name")
        .eq("active", true).in("city", cities).in("name", names).limit(80);
      if (!ok.error) {
        for (const row of ok.data || []) confirmed.add(`${clean(row.city)}|${clean(row.name)}`);
      }
    }
    for (const row of aliasRows) {
      const city = clean(row.city);
      const name = clean(row.name);
      if (!confirmed.has(`${city}|${name}`)) continue;
      add(city, streetKey(name));
    }
    const regRows = (regRes.data || []) as Array<{ city: string; name: string }>;
    const regNames = [...new Set(regRows.map((row) => clean(row.name)).filter(Boolean))];
    if (regNames.length) {
      const cities = [...new Set(regRows.map((row) => clean(row.city)).filter(Boolean))];
      const sibs = await supabase.from("street_registry_aliases").select("city, alias, name")
        .in("city", cities).in("name", regNames).limit(80);
      if (!sibs.error) {
        for (const row of sibs.data || []) add(clean(row.city), streetKey(String(row.alias)));
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** אינדקס לחיפוש אזור: רק הערים שבתוצאות, ורק המפתח של מה שהוקלד. */
export async function areaAliasIndex(
  supabase: Sb | null | undefined,
  area: string,
  cities: string[],
): Promise<Map<string, Map<string, string>>> {
  const empty = new Map<string, Map<string, string>>();
  const raw = clean(area);
  const key = raw ? streetKey(raw) : "";
  const cityList = [...new Set(cities.map((city) => clean(city)).filter(Boolean))].slice(0, 30);
  if (!supabase || !key || !cityList.length) return empty;
  try {
    const [aliasRes, regRes] = await Promise.all([
      supabase.from("street_registry_aliases").select("city, alias, name")
        .eq("alias_key", key).in("city", cityList).limit(40),
      supabase.from("street_registry").select("city, name")
        .eq("active", true).eq("name_key", key).in("city", cityList).limit(40),
    ]);
    if (aliasRes.error || regRes.error) return empty;
    const names = [...new Set([
      ...(aliasRes.data || []).map((row: { name: string }) => clean(row.name)),
      ...(regRes.data || []).map((row: { name: string }) => clean(row.name)),
    ].filter(Boolean))];
    if (!names.length) return empty;
    const confirmed = await supabase.from("street_registry").select("city, name")
      .eq("active", true).in("city", cityList).in("name", names).limit(80);
    if (confirmed.error) return empty;
    const sibs = await supabase.from("street_registry_aliases").select("city, alias, name")
      .in("city", cityList).in("name", names).limit(80);
    const aliases: StreetAliasRow[] = (sibs.error ? aliasRes.data || [] : [...(aliasRes.data || []), ...(sibs.data || [])])
      .map((row: { city: string; alias: string; name: string }) => ({
        city: clean(row.city), alias: clean(row.alias), name: clean(row.name),
      }));
    return streetCanonIndex(confirmed.data || [], aliases);
  } catch {
    return empty;
  }
}

// אותם גרשיים ש-street_name_key מוריד (העותק ב-search-core.js). בלי דגל g,
// כדי ש-test לא יזיז lastIndex.
const STREET_QUOTE = /['"`׳״‘’“”]/;
const STREET_PREFIX = /^(?:רחוב|רח|שדרות|שדרת|שד)\s+/;

function isHebrewLetter(ch: string | undefined): boolean {
  return !!ch && ch >= "א" && ch <= "ת";
}

/** הטקסט בלי הגרשיים, עם המיקום המקורי של כל תו שנשאר. */
function withoutStreetQuotes(s: string): { text: string; map: number[] } {
  const map: number[] = [];
  let text = "";
  for (let i = 0; i < s.length; i++) {
    if (STREET_QUOTE.test(s[i])) continue;
    map.push(i);
    text += s[i];
  }
  return { text, map };
}

/**
 * מחליף את הרחוב בתוך הכתובת המוצגת גם כשהגרשיים או תחילית "רח" אינם
 * כמו בעמודת הרחוב. "קק"ל 12" ו-"רח' קק״ל 12" הופכים ל-"קרן קיימת לישראל 12".
 * ההשוואה היא אחרי הורדת אותם גרשיים ש-street_name_key מוריד. מילה ארוכה
 * יותר (הקקלון) לא נתפסת, ומספר הבית נשאר.
 */
export function replaceStreetInAddress(address: string, street: string, shown: string): string {
  if (!address || !street || !shown || street === shown) return address;

  const bare = withoutStreetQuotes(street).text.replace(/\s+/g, " ").trim().replace(STREET_PREFIX, "");
  if (!bare) return address;
  const { text: hay, map } = withoutStreetQuotes(address);
  const spans: Array<{ start: number; end: number }> = [];
  let from = 0;
  while (from <= hay.length - bare.length) {
    const idx = hay.indexOf(bare, from);
    if (idx < 0) break;
    const after = idx + bare.length;
    const bounded = (idx === 0 || !isHebrewLetter(hay[idx - 1]))
      && (after === hay.length || !isHebrewLetter(hay[after]));
    if (!bounded) {
      from = idx + 1;
      continue;
    }
    let start = idx;
    const head = hay.slice(0, idx);
    const pref = head.match(/(?:רחוב|רח|שדרות|שדרת|שד)\s+$/);
    if (pref) {
      const prefStart = idx - pref[0].length;
      if (prefStart === 0 || !isHebrewLetter(hay[prefStart - 1])) start = prefStart;
    }
    spans.push({ start: map[start], end: map[after - 1] + 1 });
    from = after;
  }
  if (!spans.length) return address;
  let out = "";
  let cursor = 0;
  for (const span of spans) {
    out += address.slice(cursor, span.start) + shown;
    cursor = span.end;
  }
  return out + address.slice(cursor);
}

/** בכרטיס: רחוב שנשמר ככינוי מוצג בשם הרשמי של העיר שלו. כשל אינו משנה שורות. */
export async function applyShownStreets<T extends Record<string, unknown>>(
  supabase: Sb | null | undefined,
  rows: T[],
): Promise<T[]> {
  if (!supabase || !rows.length) return rows;
  const cities = [...new Set(rows.map((row) => clean(row.city)).filter(Boolean))];
  const keys = [...new Set(rows.map((row) => streetKey(clean(row.street))).filter(Boolean))];
  if (!cities.length || !keys.length) return rows;
  try {
    const aliasRes = await supabase.from("street_registry_aliases").select("city, alias, name")
      .in("city", cities).in("alias_key", keys).limit(80);
    if (aliasRes.error || !(aliasRes.data || []).length) return rows;
    const names = [...new Set((aliasRes.data || []).map((row: { name: string }) => clean(row.name)).filter(Boolean))];
    const confirmed = await supabase.from("street_registry").select("city, name")
      .eq("active", true).in("city", cities).in("name", names).limit(80);
    if (confirmed.error) return rows;
    const index = streetCanonIndex(
      confirmed.data || [],
      (aliasRes.data || []).map((row: { city: string; alias: string; name: string }) => ({
        city: clean(row.city), alias: clean(row.alias), name: clean(row.name),
      })),
    );
    return rows.map((row) => {
      const street = clean(row.street);
      const shown = canonicalStreet(index, clean(row.city), street);
      if (!street || shown === street) return row;
      const address = typeof row.address === "string"
        ? replaceStreetInAddress(row.address, street, shown)
        : row.address;
      return { ...row, street: shown, address };
    });
  } catch {
    return rows;
  }
}
