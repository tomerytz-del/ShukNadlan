// ============================================================================
// קוד חד-פעמי בוואטסאפ — לחותם/ת על הסכם
//
// **למה תבנית אימות (AUTHENTICATION) ולא טקסט.** הלקוח/ה שמקבל/ת קוד כמעט
// אף פעם לא כתב/ה לעסק — הסוכן/ת העביר/ה את הקישור מהמספר הפרטי שלו/ה —
// ולכן השליחה היא **מחוץ לחלון 24 השעות, תמיד**, וטקסט חופשי נדחה שם.
// ‏Meta מחייבת לקודים קטגוריה משלה: תבנית AUTHENTICATION, שגופה קבוע
// ("‎{{1}}‎ הוא קוד האימות שלך") ושיש לה כפתור "העתקת קוד". שם התבנית
// נקבע ב-`WHATSAPP_OTP_TEMPLATE` — הנוסח וההגדרה ב-`docs/client-agreements.md`.
//
// **שני פרמטרים, ושניהם הקוד.** ב-API של Meta, כפתור "העתקת קוד" הוא
// רכיב `button` מסוג `url` שמקבל את הקוד כפרמטר — לא רכיב `copy_code`
// כמו שאפשר לנחש. בלי הרכיב הזה ההודעה כולה נדחית.
//
// בלי תבנית מוגדרת נשלח טקסט חופשי, מאותה סיבה שב-`whatsapp-invite.ts`:
// זה עובד מול מספר שכבר בשיחה איתנו (בדיקה), ובכל מקרה אחר נכשל עם שגיאה
// שנרשמת — והקורא עובר למייל אם יש.
// ============================================================================

import { toWhatsappMsisdn, type WhatsappSendResult } from "./whatsapp-invite.ts";

const GRAPH_VERSION = Deno.env.get("WHATSAPP_GRAPH_VERSION") || "v23.0";
const WA_TOKEN = Deno.env.get("WHATSAPP_TOKEN") || "";
const WA_PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || "";
const OTP_TEMPLATE = Deno.env.get("WHATSAPP_OTP_TEMPLATE") || "";
const OTP_TEMPLATE_LANG = Deno.env.get("WHATSAPP_OTP_TEMPLATE_LANG") || "he";

export { toWhatsappMsisdn };

/** ‏***-***-3466 — מספיק כדי לדעת לאן הקוד הלך, לא מספיק כדי לגלות למי. */
export function maskPhone(phone: string | null | undefined): string {
  const d = String(phone ?? "").replace(/\D/g, "");
  if (d.length < 4) return "";
  return `***-***-${d.slice(-4)}`;
}

/** ‏`to` הוא מספר מנורמל מ-`toWhatsappMsisdn`. */
export async function sendWhatsappOtp(to: string, code: string): Promise<WhatsappSendResult> {
  if (!WA_TOKEN || !WA_PHONE_ID) return { sent: false, error: "whatsapp_not_configured" };

  const payload = OTP_TEMPLATE
    ? {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: OTP_TEMPLATE,
        language: { code: OTP_TEMPLATE_LANG },
        components: [
          { type: "body", parameters: [{ type: "text", text: code }] },
          { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
        ],
      },
    }
    : {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: {
        preview_url: false,
        body: `קוד האימות שלך לחתימה על ההסכם: ${code}\nהקוד תקף ל-15 דקות. אל תמסרו אותו לאיש.`,
      },
    };

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${WA_PHONE_ID}/messages`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    if (!res.ok) {
      const raw = await res.text();
      return { sent: false, error: `whatsapp ${res.status}: ${raw.slice(0, 300)}` };
    }
    return { sent: true, error: null };
  } catch (err) {
    return { sent: false, error: `whatsapp_network: ${(err as Error).message}`.slice(0, 300) };
  }
}
