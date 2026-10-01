// ============================================================================
// אימות חותם/ת על הסכם בהודעה נכנסת בוואטסאפ
//
// ‏**למה הודעה נכנסת ולא קוד יוצא.** קוד שהעסק שולח ללקוח/ה שמעולם לא
// כתב/ה לו חייב תבנית AUTHENTICATION, ו-Meta פותחת אותה רק לעסק מאומת עם
// נפח שליחה גבוה. הודעה שהלקוח/ה שולח/ת **לנו** אינה צריכה שום תבנית,
// והיא גם פותחת את חלון 24 השעות — כך שמותר לענות לה בטקסט חופשי.
//
// ‏**וזה חזק יותר מקוד, לא חלש יותר.** קוד מוכיח שמישהו ראה אותו. כאן
// ‏Meta עצמה מוסרת את המספר שממנו נשלחה ההודעה (`from`), והאימות עובר רק
// כשהוא הנייד שבכרטיס החותם/ת. מי שקיבל/ה קישור שהועבר הלאה ולחץ/ה על
// הכפתור — שולח/ת ממספר אחר, ונדחה/ית.
//
// ‏שני צדדים: `agreement-sign` יוצר את ה-nonce ומחזיר קישור wa.me עם
// ההודעה המוכנה, ו-`whatsapp-webhook` קורא כאן לכל הודעת טקסט נכנסת
// **לפני** זיהוי הסוכן/ת — אחרת לקוח/ה שאינו/ה סוכן/ת היה/הייתה מקבל/ת
// "איני מזהה את מספר הטלפון שלך".
// ============================================================================

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { toWhatsappMsisdn } from "./whatsapp-invite.ts";

export const WA_VERIFY_TTL_MINUTES = 30;
export const WA_VERIFY_PREFIX = "אימות חתימה";

/** המספר העסקי, כמו ב-assets/bot-link.js. ‏env גובר — למקרה של החלפת מספר. */
export const BUSINESS_WA_NUMBER =
  (Deno.env.get("WHATSAPP_BUSINESS_NUMBER") || "972532494740").replace(/\D/g, "");

// ‏גמיש בכוונה: רווחים, שורה חדשה, או ספרות בלבד אחרי הקידומת. מקלדות
// מוסיפות לפעמים סימן כיווניות לפני הספרות.
const VERIFY_RE = /אימות\s*חתימה[\s‎‏:#-]*(\d{6})/;

export function waVerifyText(nonce: string): string {
  return `${WA_VERIFY_PREFIX} ${nonce}`;
}

export function waVerifyUrl(nonce: string): string {
  return `https://wa.me/${BUSINESS_WA_NUMBER}?text=${encodeURIComponent(waVerifyText(nonce))}`;
}

/**
 * ‏null = ההודעה אינה הודעת אימות, וה-webhook ממשיך כרגיל. מחרוזת =
 * התשובה לשלוח לשולח/ת, וה-webhook עוצר כאן.
 */
export async function handleWaSignVerify(
  db: SupabaseClient,
  from: string,
  text: string,
): Promise<string | null> {
  const m = VERIFY_RE.exec(text || "");
  if (!m) return null;
  const nonce = m[1];

  const since = new Date(Date.now() - WA_VERIFY_TTL_MINUTES * 60_000).toISOString();
  const { data, error } = await db
    .from("agreement_signers")
    .select("id, phone, otp_verified_at, signed_at")
    .eq("wa_verify_nonce", nonce)
    .gte("wa_verify_requested_at", since);

  if (error) {
    console.error("wa sign verify lookup failed", error.message);
    return "לא הצלחנו לאמת כרגע. נסו לשלוח שוב בעוד דקה.";
  }

  const rows = (data || []) as { id: string; phone: string | null; otp_verified_at: string | null; signed_at: string | null }[];
  if (!rows.length) {
    return "הקוד פג או שאינו מוכר. חזרו לדף ההסכם ולחצו שוב על \"אימות בוואטסאפ\".";
  }

  // שש ספרות יכולות לחזור אצל שני חותמים — המספר שממנו נשלח הוא המכריע
  const mine = rows.find((r) => toWhatsappMsisdn(r.phone) === from);
  if (!mine) {
    console.warn("wa sign verify phone mismatch", { nonce, from_tail: from.slice(-4) });
    return "ההודעה נשלחה ממספר שאינו המספר שרשום אצל הסוכן/ת. " +
      "שלחו אותה מהטלפון שאליו נשלח הקישור, או פנו לסוכן/ת.";
  }

  if (!mine.otp_verified_at && !mine.signed_at) {
    const { error: updErr } = await db.from("agreement_signers").update({
      otp_verified_at: new Date().toISOString(),
      wa_verify_nonce: null,
      otp_hash: null,
      otp_expires_at: null,
      otp_attempts: 0,
    }).eq("id", mine.id);
    if (updErr) {
      console.error("wa sign verify update failed", updErr.message);
      return "לא הצלחנו לאמת כרגע. נסו לשלוח שוב בעוד דקה.";
    }
  }

  return "אומת ✅ אפשר לחזור לדף ההסכם - הוא ייפתח לבד בתוך כמה שניות.";
}
