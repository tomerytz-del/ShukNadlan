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
 * שלושת ניסיונות ה-insert של ליד מדף. כולם נושאים source.
 * ניסיון בלי source היה שומר ליד של דף עם source ריק, והוא נראה אחר כך
 * כמו ליד פלטפורמה ויכול לבלוע פנייה. הסוג יורד ל-owner_inbound רק
 * בניסיון האחרון, אם property_inquiry אינו ערך חוקי בסביבה.
 */
export function pageLeadInsertAttempts(
  baseRow: Record<string, unknown>,
  preferredType: string,
  pageSource: string,
): Record<string, unknown>[] {
  return [
    { ...baseRow, lead_type: preferredType, source: pageSource },
    { ...baseRow, lead_type: preferredType, source: pageSource },
    { ...baseRow, lead_type: "owner_inbound", source: pageSource },
  ];
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
