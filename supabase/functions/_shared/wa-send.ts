// ============================================================================
// שליחה לוואטסאפ דרך Cloud API, לקריאות שאינן הבוט.
//
// הבוט נשאר ב-whatsapp-webhook/whatsapp.ts (sendText / sendNotifyTemplate).
// כאן אותו חוזה, בלי היסטוריית שיחה: טקסט חופשי, או תבנית. כל תשובה שאינה
// 2xx נזרקת - הקורא (alertLead) רושם אותה ואינו מעביר אותה הלאה.
//
// **פרמטר של תבנית הוא שורה אחת.** Meta דוחה שורה חדשה, טאב, או יותר
// משלושה רווחים רצופים. אותו כלל כמו templateSummary ב-notification-push.
// ============================================================================

import { paceRecipient } from "./wa-pair-pace.ts";
import {
  ctaPayload,
  deliverWaPayloads,
  logWaUrlGuard,
  payloadsForText,
  planWaText,
  WA_CTA_BODY_MAX,
  WA_EMPTY_BODY,
  WA_NO_BUTTON,
} from "./wa-url-guard.ts";

const MAX_TEXT = 4096;

type DenoEnv = { env: { get(name: string): string | undefined } };

function env(name: string, fallback = ""): string {
  const deno = (globalThis as { Deno?: DenoEnv }).Deno;
  const v = deno?.env.get(name);
  return v == null || v === "" ? fallback : v;
}

/** כמו noLongDash ב-marketing-copy.ts. מועתק כדי לא לטעון את מודול הקופי לתוך הוובהוק. */
function stripLongDash(s: string): string {
  return s.replace(/[\u2014\u2013\u2015]/g, "-");
}

function clipCodePoints(s: string, max: number): string {
  const chars = Array.from(s);
  if (chars.length <= max) return s;
  return chars.slice(0, Math.max(0, max - 1)).join("") + "…";
}

/**
 * פרמטר לתבנית: שורה אחת, בלי מקף ארוך, חתוך בגבול תו (לא באמצע אימוג'י).
 * מחרוזת ריקה הופכת ל-"-" - Meta דוחה פרמטר ריק.
 */
export function flattenTemplateParam(s: string, max = 900): string {
  const flat = stripLongDash(String(s ?? ""))
    .replace(/\s*[\r\n\t]+\s*/g, " ")
    .replace(/ {4,}/g, "   ")
    .trim();
  return clipCodePoints(flat, max) || "-";
}

export function clipWhatsappText(s: string, max = MAX_TEXT): string {
  return clipCodePoints(stripLongDash(s), max);
}

export type WaTemplateEnv = {
  leadTemplate?: string;
  notifyTemplate?: string;
  notifyLang?: string;
};

const NOTIFY_BUTTON = "crm?goto=accNotifPrefs";

/**
 * גוף הבקשה לתבנית. WHATSAPP_LEAD_ALERT_TEMPLATE: חמישה פרמטרים בגוף,
 * עברית, בלי פרמטר לכפתור (הכפתור בתבנית סטטי). אחרת תבנית ההתראות:
 * {{1}} תומר, {{2}} חמשת הפרמטרים בשורה אחת, וכפתור עם סיומת קבועה.
 */
export function leadAlertTemplateMessage(
  to: string,
  params: readonly string[],
  cfg: WaTemplateEnv,
): Record<string, unknown> {
  const five = [0, 1, 2, 3, 4].map((i) => flattenTemplateParam(params[i] ?? "", i === 4 ? 700 : 240));
  if (cfg.leadTemplate) {
    return {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: cfg.leadTemplate,
        language: { code: "he" },
        components: [{
          type: "body",
          parameters: five.map((text) => ({ type: "text", text })),
        }],
      },
    };
  }
  if (!cfg.notifyTemplate) {
    throw new Error("WHATSAPP_LEAD_ALERT_TEMPLATE / WHATSAPP_NOTIFY_TEMPLATE is not configured");
  }
  return {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: cfg.notifyTemplate,
      language: { code: cfg.notifyLang || "he" },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: flattenTemplateParam("תומר", 60) },
            { type: "text", text: flattenTemplateParam(five.join(" · "), 900) },
          ],
        },
        {
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [{ type: "text", text: NOTIFY_BUTTON }],
        },
      ],
    },
  };
}

async function graphMessages(payload: Record<string, unknown>): Promise<void> {
  return paceRecipient(String(payload.to || ""), () => graphMessagesNow(payload));
}

async function graphMessagesNow(payload: Record<string, unknown>): Promise<void> {
  const token = env("WHATSAPP_TOKEN");
  const phoneId = env("WHATSAPP_PHONE_NUMBER_ID");
  const version = env("WHATSAPP_GRAPH_VERSION", "v23.0");
  if (!token || !phoneId) {
    throw new Error("WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID is not configured");
  }
  const res = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 500);
    throw new Error(`whatsapp send failed ${res.status}: ${detail}`);
  }
}

/** הודעת טקסט. מותרת רק בתוך חלון 24 השעות; מחוץ לו Meta דוחה והקורא נופל לתבנית.
 *  כתובת בגוף יוצאת ככפתור. */
export async function waText(to: string, body: string): Promise<void> {
  const plan = planWaText(body);
  if (plan.stripped) logWaUrlGuard("waText", plan);
  const planned = payloadsForText(to, body);
  const raw = (plan.text || planned.visibleText || "").trim();
  const plain = !raw || raw === WA_EMPTY_BODY ? "" : raw;
  await deliverWaPayloads(planned.payloads, (payload) => graphMessages(payload).then(() => null), () => ({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { preview_url: false, body: clipWhatsappText(plain || WA_NO_BUTTON) },
  }), planned.visibleText);
}

export async function waCta(to: string, body: string, label: string, url: string): Promise<void> {
  const plan = planWaText(body);
  if (plan.stripped) logWaUrlGuard("waCta", plan);
  const raw = (plan.text || "").trim();
  const plain = !raw || raw === WA_EMPTY_BODY ? "" : raw;
  const textMessage = (text: string) => ({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { preview_url: false, body: clipWhatsappText(text) },
  });
  let sentText = false;
  try {
    if (plain.length > WA_CTA_BODY_MAX) {
      await graphMessages(textMessage(plain));
      sentText = true;
      await graphMessages(ctaPayload(to, label || "לפתיחה", label, url));
      return;
    }
    await graphMessages(ctaPayload(to, plain || label || "לפתיחה", label, url));
  } catch (err) {
    console.error("wa-url-guard cta failed, text without url", err);
    if (sentText) return;
    await graphMessages(textMessage(plain || WA_NO_BUTTON));
  }
}

/** תבנית ליד (חמישה פרמטרים) או נפילה לתבנית ההתראות. זורקת על שאינו 2xx. */
export async function waTemplate(to: string, params: readonly string[]): Promise<void> {
  const payload = leadAlertTemplateMessage(to, params, {
    leadTemplate: env("WHATSAPP_LEAD_ALERT_TEMPLATE"),
    notifyTemplate: env("WHATSAPP_NOTIFY_TEMPLATE"),
    notifyLang: env("WHATSAPP_NOTIFY_TEMPLATE_LANG", "he"),
  });
  await graphMessages(payload);
}
