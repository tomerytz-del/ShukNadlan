// דרישות מטקסט חופשי בכרטיס לקוח/ה. ממלאים רק שדה ריק. לא דורסים.
// עיר ותקציב לא מנוחשים מכאן: גבריאלה שואלת.

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
