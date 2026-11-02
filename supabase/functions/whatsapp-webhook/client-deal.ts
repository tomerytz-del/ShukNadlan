// צד העסקה בכרטיס לקוח/ה.
// בעל/ת נכס בלי sale/rent נשמר/ת בלי צד. לא אומרים מוכר/ת ולא משכיר/ה.

export const OWNER_DEAL_ASK = "מוכר או משכיר?";
export const SEEKER_DEAL_ASK = "קנייה או שכירות?";

export function statedDeal(value: unknown): "sale" | "rent" | null {
  return value === "sale" || value === "rent" ? value : null;
}

export type OwnerDealWrite = {
  deal_type: null;
  ask: typeof OWNER_DEAL_ASK;
};

/**
 * בעל/ת נכס בלי sale/rent מפורש בקריאה הזו.
 * null = לא לגעת בצד השמור (כבר בעל/ת נכס עם צד, והקריאה לא שלחה עסקה).
 */
export function ownerDealWrite(
  input: Record<string, unknown>,
  existing?: { client_kind?: string | null; deal_type?: string | null } | null,
): OwnerDealWrite | null {
  const kind = input.client_kind === "owner" || input.client_kind === "seeker"
    ? input.client_kind
    : (existing?.client_kind ?? "seeker");
  if (kind !== "owner") return null;
  if (statedDeal(input.deal_type)) return null;
  const becomingOwner = input.client_kind === "owner" && existing?.client_kind !== "owner";
  const creating = !existing;
  const explicitEmpty = Object.prototype.hasOwnProperty.call(input, "deal_type") &&
    !statedDeal(input.deal_type);
  if (creating || becomingOwner || explicitEmpty || !statedDeal(existing?.deal_type)) {
    return { deal_type: null, ask: OWNER_DEAL_ASK };
  }
  return null;
}

/**
 * מחפש/ת בלי sale/rent אי אפשר לשמור (ה-check). גם מעבר מבעל/ת נכס בלי צד
 * ל-seeker בלי עסקה. null = יש צד, או שזו אינה שמירה של מחפש/ת.
 */
export function seekerDealAsk(
  input: Record<string, unknown>,
  existing?: { client_kind?: string | null; deal_type?: string | null } | null,
): string | null {
  if (input.client_kind === "owner") return null;
  const creatingSeeker = !existing && input.client_kind !== "owner";
  const stayingSeeker = !!existing && existing.client_kind !== "owner" && input.client_kind !== "owner";
  const switchingToSeeker = input.client_kind === "seeker" && existing?.client_kind === "owner";
  if (!creatingSeeker && !stayingSeeker && !switchingToSeeker) return null;
  if (statedDeal(input.deal_type)) return null;
  if (statedDeal(existing?.deal_type)) return null;
  return SEEKER_DEAL_ASK;
}

/** שורת הדרישות בעברית. צד שלא נאמר לא מוצג כמוכר/ת, משכיר/ה, קונה או שוכר/ת. */
export function clientNeeds(c: Record<string, unknown>): string {
  const parts: string[] = [];
  if (c.client_kind === "owner") {
    if (c.deal_type === "rent") parts.push("בעל/ת נכס - משכיר/ה");
    else if (c.deal_type === "sale") parts.push("בעל/ת נכס - מוכר/ת");
    else parts.push("בעל/ת נכס");
    if (c.category === "commercial") parts.push("מסחרי");
    return parts.join(" · ");
  }
  if (c.deal_type === "rent") parts.push("מחפש/ת לשכור");
  else if (c.deal_type === "sale") parts.push("מחפש/ת לקנות");
  else parts.push("מחפש/ת נכס");
  if (c.category === "commercial") parts.push("מסחרי");
  const types = (c.property_types as string[]) || [];
  if (types.length) parts.push(types.join("/"));
  const cities = (c.cities as string[]) || [];
  if (cities.length) parts.push(cities.join("/"));
  if (c.min_rooms || c.max_rooms) {
    parts.push(`${c.min_rooms ?? ""}${c.min_rooms && c.max_rooms ? "-" : ""}${c.max_rooms ?? ""} חד׳`);
  }
  if (c.min_price || c.max_price) {
    const from = c.min_price ? Number(c.min_price).toLocaleString("he-IL") : "";
    const to = c.max_price ? Number(c.max_price).toLocaleString("he-IL") : "";
    parts.push(from && to ? `₪${from}-${to}` : from ? `מ-₪${from}` : `עד ₪${to}`);
  }
  if (c.min_size_sqm || c.max_size_sqm) {
    const lo = c.min_size_sqm, hi = c.max_size_sqm;
    parts.push(lo && hi ? `${lo}-${hi} מ״ר` : lo ? `מ-${lo} מ״ר` : `עד ${hi} מ״ר`);
  }
  if (c.max_floor !== null && c.max_floor !== undefined) parts.push(`עד קומה ${c.max_floor}`);
  if (Array.isArray(c.required_directions) && c.required_directions.length) {
    parts.push(`אוויר: ${c.required_directions.join(" + ")}`);
  }
  if (c.min_air_directions) parts.push(`${c.min_air_directions}+ כיווני אוויר`);
  if (c.min_living_room_sqm) parts.push(`סלון ${c.min_living_room_sqm}+ מ"ר`);
  const feats = (c.required_features as string[]) || [];
  if (feats.length) parts.push(`חובה: ${feats.join(", ")}`);
  return parts.join(" · ");
}

/** עמודה שעוד not null (הפונקציה עלתה לפני המיגרציה). לא נופלים ל-sale. */
export function dealNullRejected(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const blob = `${error.code || ""} ${error.message || ""}`;
  return (/23502/.test(blob) || /23514/.test(blob)) &&
    /deal_type|deal_present_unless_owner/.test(blob);
}
