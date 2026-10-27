// דרישות מטקסט חופשי בכרטיס לקוח/ה.
// מאפיין מהערות הוא דירוג (preferred_features), לא סינון קשיח.
// required_features נכתב רק כשהסוכן/ת אישר/ה. עיר ותקציב לא מנוחשים.

import "../_shared/search-core.js";

// deno-lint-ignore no-explicit-any
const SearchCore = (globalThis as any).SearchCore;

export interface ClientRequirementState {
  deal_type?: string | null;
  category?: string | null;
  cities?: readonly string[] | null;
  min_price?: number | null;
  max_price?: number | null;
  required_features?: readonly string[] | null;
}

export function requirementsFromNotes(
  notes: string,
  existing: ClientRequirementState,
): { features: string[]; ask: string[] } {
  const have = (existing.required_features || []).map(String).filter(Boolean);
  const found = have.length
    ? []
    : (SearchCore.featuresIn(String(notes || ""), {
      residential: String(existing.category || "residential") !== "commercial",
    }) as string[]);
  const ask: string[] = [];
  if (!existing.deal_type) ask.push("עסקה");
  if (!(existing.cities || []).some((c) => String(c || "").trim())) ask.push("עיר");
  if (existing.min_price == null && existing.max_price == null) ask.push("תקציב");
  return { features: found, ask };
}

export function clientColumnMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code || "");
  return code === "42703" || code === "PGRST204";
}

export const CLIENT_CITY_CAP = 8;

/** מעבר ל-8 ערים לא נזרק בשקט. */
export function capCities<T>(cities: readonly T[]): { kept: T[]; dropped: number } {
  if (cities.length <= CLIENT_CITY_CAP) return { kept: [...cities], dropped: 0 };
  return { kept: cities.slice(0, CLIENT_CITY_CAP), dropped: cities.length - CLIENT_CITY_CAP };
}

export function featuresInNotes(notes: string, category?: string | null): string[] {
  return (SearchCore.featuresIn(String(notes || ""), {
    residential: String(category || "residential") !== "commercial",
  }) as string[]).map(String).filter(Boolean);
}

/**
 * מה לכתוב בכרטיס. הערות שנשלחו באותו עדכון הופכות לדירוג, לא לחובה.
 * שאלה על עסקה/עיר/תקציב רק ביצירה, לא בכל עדכון.
 */
export function featureWritePlan(opts: {
  isCreate: boolean;
  notesSent: boolean;
  notes: string;
  requiredSent: boolean;
  category?: string | null;
  deal_type?: string | null;
  cities?: readonly string[] | null;
  min_price?: number | null;
  max_price?: number | null;
}): { preferred: string[] | undefined; ask: string[] | undefined; suggested: string[] } {
  const suggested = opts.notesSent ? featuresInNotes(opts.notes, opts.category) : [];
  const preferred = opts.notesSent && !opts.requiredSent ? suggested : undefined;
  const asked = requirementsFromNotes(opts.notesSent ? opts.notes : "", {
    deal_type: opts.deal_type,
    category: opts.category,
    cities: opts.cities,
    min_price: opts.min_price,
    max_price: opts.max_price,
    required_features: opts.requiredSent ? ["confirmed"] : undefined,
  });
  return {
    preferred,
    ask: opts.isCreate && asked.ask.length ? asked.ask : undefined,
    suggested,
  };
}

export interface HoodCity {
  city: string | null;
  city_id: string | null;
}

export interface NamedCity {
  name: string;
  id: string | null;
}

/** שכונה שייכת לאחת מערים של הלקוח/ה, לפי city_id ואז לפי שם. */
export function hoodBelongsToCities(hood: HoodCity, cities: readonly NamedCity[]): boolean {
  if (!cities.length) return true;
  return cities.some((c) => {
    if (c.id && hood.city_id && c.id === hood.city_id) return true;
    if (c.name && hood.city && c.name === hood.city) return true;
    return false;
  });
}

/**
 * האם הנכס עובר את סינון השכונה. שכונה שלא שייכת לאף עיר של הלקוח/ה
 * לא מסתירה התאמות. שכונה ששייכת לעיר אחת לא חוסמת עיר אחרת.
 */
export function neighborhoodAllows(opts: {
  clientHoodId: string | null;
  hoodBelongs: boolean;
  propertyInHoodCity: boolean;
  propertyHoodId: string | null;
}): boolean {
  if (!opts.clientHoodId) return true;
  if (!opts.hoodBelongs) return true;
  if (!opts.propertyInHoodCity) return true;
  return opts.propertyHoodId === opts.clientHoodId;
}

/** שינוי ערים בלי שם שכונה חדש מוחק שכונה שכבר לא שייכת. כשל בפענוח לא מוחק. */
export function shouldClearNeighborhood(opts: {
  citiesChanged: boolean;
  neighborhoodSent: boolean;
  hasHood: boolean;
  belongs: boolean;
  resolved: boolean;
}): boolean {
  if (opts.neighborhoodSent || !opts.citiesChanged || !opts.hasHood) return false;
  if (!opts.resolved) return false;
  return !opts.belongs;
}
