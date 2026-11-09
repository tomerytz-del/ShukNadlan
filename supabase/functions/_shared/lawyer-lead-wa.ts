// ============================================================================
// אימות ליד "שאלה לעו"ד" בהודעה נכנסת בוואטסאפ ("אימות שאלה 482193")
//
// אותו עיקרון כמו אימות חתימה על הסכם (agreement-wa-verify.ts): הפונה שולח/ת **לנו** הודעה, ו-Meta מוסרת את המספר שממנו
// נשלחה (`from`). האימות עובר רק כשהוא הנייד שהוזן בטופס. הבדיקה עצמה (הקוד, התוקף והמספר) במסד, ב-lawyer_lead_wa_verify,
// כי היא מעלה את הליד למדף ורושמת ניתוב והתראה באותה טרנזקציה.
//
// ‏whatsapp-webhook קורא כאן לכל הודעת טקסט נכנסת **לפני** זיהוי הסוכן/ת: הפונה אינו/ה סוכן/ת, ובלי זה היה/הייתה מקבל/ת
// "איני מזהה את מספר הטלפון שלך". הסקיל professional-leads.
// ============================================================================

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { BUSINESS_WA_NUMBER } from "./agreement-wa-verify.ts";

export const LAWYER_VERIFY_PREFIX = "אימות שאלה";

// גמיש בכוונה: רווחים, נקודותיים, או סימן כיווניות לפני הספרות
const VERIFY_RE = /אימות\s*שאלה[\s‎‏:#-]*(\d{6})/;

export function lawyerVerifyText(nonce: string): string {
  return `${LAWYER_VERIFY_PREFIX} ${nonce}`;
}

export function lawyerVerifyUrl(nonce: string): string {
  return `https://wa.me/${BUSINESS_WA_NUMBER}?text=${encodeURIComponent(lawyerVerifyText(nonce))}`;
}

/** null = ההודעה אינה הודעת אימות והוובהוק ממשיך. מחרוזת = התשובה לשולח/ת, והוובהוק עוצר. */
export async function handleLawyerLeadVerify(
  db: SupabaseClient,
  from: string,
  text: string,
): Promise<string | null> {
  const m = VERIFY_RE.exec(text || "");
  if (!m) return null;

  const { data, error } = await db.rpc("lawyer_lead_wa_verify", { p_nonce: m[1], p_from: from });
  if (error) {
    console.error("lawyer lead wa verify failed", error.message);
    return "לא הצלחנו לאמת כרגע. נסו לשלוח שוב בעוד דקה.";
  }
  const reply = data && typeof data === "object" ? (data as { reply?: unknown }).reply : null;
  return typeof reply === "string" && reply ? reply : "לא הצלחנו לאמת כרגע. נסו לשלוח שוב בעוד דקה.";
}
