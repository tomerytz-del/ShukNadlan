// דיוק הפין כפי שהגאוקוד החזיר, לא כפי שהקורא מנחש.
// rooftop עם מספר בית הוא exact. רחוב בלי מספר, או מרכז יישוב, אינם exact.

export type StoredLocationPrecision = "exact" | "parcel" | "street" | "neighborhood" | "city";

export function locationPrecisionFromHit(
  precision: string | null | undefined,
  houseNumber: string | null | undefined,
): StoredLocationPrecision | null {
  const house = String(houseNumber || "").trim();
  const p = String(precision || "").trim();
  if (!house) {
    if (p === "street") return "street";
    if (p === "neighborhood") return "neighborhood";
    if (p === "parcel") return "parcel";
    if (p === "locality" || p === "city") return "city";
    return null;
  }
  if (p === "locality" || p === "city") return "city";
  if (p === "rooftop" || p === "exact") return "exact";
  if (p === "parcel") return "parcel";
  if (p === "street") return "street";
  if (p === "neighborhood") return "neighborhood";
  return null;
}
