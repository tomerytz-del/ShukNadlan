// ============================================================================
// ההחלטה אם פנייה מצטרפת לליד פתוח, בלי jsr, כדי שהבדיקה ב-node תוכל לייבא.
//
// הקליטה הציבורית (verify_jwt = false) מקבלת את אותו גוף. מיזוג רק כש-
// isInternalCaller אימת את מפתח ה-service role. אחרת התוכנית היא null,
// attachToOpenLead אינו נקרא, והתשובה היא ה-insert הרגיל: success ו-lead_id
// של השורה החדשה, בלי duplicate ובלי מזהה של ליד אחר.
// ============================================================================

import { parseAddressIdentity, type AttachInput } from "./lead-dedupe.ts";

export function duplicateLeadBody(leadId: string): {
  success: true;
  duplicate: true;
  lead_id: string;
} {
  return { success: true, duplicate: true, lead_id: leadId };
}

export type OwnerAttachContext = {
  trusted: boolean;
  insertedType: string;
  phone: string;
  agencyId: string | null;
  agentId: string | null;
  city: string | null;
  address: string | null;
  source: string | null;
  externalRef: string | null;
  message: string | null;
  sourceLabel: string | null;
};

/**
 * owner_inbound בלבד. מחשבון תשואה הוא property_inquiry בלי נכס.
 * בלי כתובת (עיר + רחוב) אין לאיזה נכס להצמיד, ופנייה על נכס שני היתה
 * נבלעת בראשון. משרד בלי סוכן/ת אינו שולחן.
 */
export function ownerPhoneAttach(ctx: OwnerAttachContext): AttachInput | null {
  if (!ctx.trusted) return null;
  if (ctx.insertedType !== "owner_inbound") return null;
  if (ctx.agencyId && !ctx.agentId) return null;
  if (!parseAddressIdentity(ctx.city, ctx.address)) return null;
  return {
    phone: ctx.phone,
    leadType: "owner_inbound",
    matchProperty: false,
    matchAddress: true,
    city: ctx.city,
    address: ctx.address,
    agencyId: ctx.agencyId,
    agentId: ctx.agentId,
    source: ctx.source,
    externalRef: ctx.externalRef,
    message: ctx.message,
    sourceLabel: ctx.sourceLabel,
    internal: true,
  };
}

export type PropertyAttachContext = {
  trusted: boolean;
  phone: string;
  propertyId: string | null;
  agencyId: string | null;
  agentId: string | null;
  source: string | null;
  externalRef: string | null;
  message: string | null;
  sourceLabel: string | null;
};

/**
 * ניסיונות ה-insert של ליד מדף. כולם נושאים source.
 * ניסיון בלי source היה שומר ליד של דף עם source ריק.
 * הסוג יורד ל-owner_inbound רק בניסיון האחרון, אם property_inquiry
 * אינו ערך חוקי בסביבה. כשהסוג המועדף כבר owner_inbound אין ניסיון שני:
 * הוא היה זהה לראשון.
 *
 * הקורא היחיד הוא הלולאה ב-owner-lead-intake. השורה הכפולה שהייתה כאן
 * נתנה לה ניסיון שני על כל שגיאה, כולל חולפת. הניסיון החולף יושב עכשיו
 * ב-leadInsertRetryable, לא בשורה זהה בתוכנית.
 */

/**
 * ניסיון insert שני של אותה שורה, רק כשה-SQLSTATE ברשימה החולפת.
 * בלי SQLSTATE (נפילת רשת, 502, 504) אין ניסיון: ה-insert אולי כבר נשמר,
 * וליד מדף בלי external_ref היה נכפל, והטריגר היה שולח new_lead שני.
 * מחלקה 23 (unique, check, FK, not null) אינה ברשימה.
 */
const TRANSIENT_INSERT_CODES = new Set([
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  "55P03", // lock_not_available
  "53300", // too_many_connections
  "57014", // query_canceled
  "57P03", // cannot_connect_now
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
]);

export function leadInsertRetryable(code: string | null | undefined): boolean {
  return !!code && TRANSIENT_INSERT_CODES.has(code);
}

export function pageLeadInsertAttempts(
  baseRow: Record<string, unknown>,
  preferredType: string,
  pageSource: string,
): Record<string, unknown>[] {
  const full = { ...baseRow, lead_type: preferredType, source: pageSource };
  if (preferredType === "owner_inbound") return [full];
  return [full, { ...baseRow, lead_type: "owner_inbound", source: pageSource }];
}

/** פנייה על נכס: אותו נכס ואותו שולחן. בלי סוכן/ת או בלי משרד אין למי להצמיד. */
export function propertyPhoneAttach(ctx: PropertyAttachContext): AttachInput | null {
  if (!ctx.trusted || !ctx.propertyId || !ctx.agencyId || !ctx.agentId) return null;
  return {
    phone: ctx.phone,
    leadType: "property_inquiry",
    matchProperty: true,
    propertyId: ctx.propertyId,
    agencyId: ctx.agencyId,
    agentId: ctx.agentId,
    source: ctx.source,
    externalRef: ctx.externalRef,
    message: ctx.message,
    sourceLabel: ctx.sourceLabel,
    internal: true,
  };
}
