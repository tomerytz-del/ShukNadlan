// ============================================================================
// וואטסאפ ללקוח/ה של המיניסייט: "הסוכן/ת ענה/תה לך", "הסיור אושר".
//
// ‏**למה תבנית.** הלקוח/ה כמעט אף פעם לא כתב/ה למספר של שוק נדל״ן - הוא/היא
// מדבר/ת עם הסוכן/ת. Meta מרשה לעסק לפתוח שיחה עם מי שלא כתב/ה אליו ב-24
// השעות האחרונות **רק** בתבנית מאושרת, ולכן ברירת המחדל היא
// ‏`WHATSAPP_SHOWCASE_TEMPLATE`:
//
//   {{1}} שם פרטי · {{2}} שורת עדכון אחת · כפתור URL דינמי לעמוד (‏showcase?t=…)
//
// בלי תבנית נשלח טקסט חופשי **רק** כשהלקוח/ה כתב/ה למספר ב-23 השעות האחרונות
// (‏`whatsapp_public_conversations`). אחרת לא נשלח כלום, והסטטוס נרשם
// ‏`no_channel` - כדי שהסוכן/ת יראה/תראה ב-CRM שהעדכון לא יצא, במקום כשל שקט.
//
// עותק מקומי ולא import מ-whatsapp-webhook: הפריסה מעדכנת רק פונקציות
// שהשתנו, ושינוי שם לא היה מגיע לכאן. אותו נימוק של saved-search-notify.
// ============================================================================

import { noLongDash } from "../_shared/marketing-copy.ts";

const GRAPH_VERSION = Deno.env.get("WHATSAPP_GRAPH_VERSION") || "v23.0";
const WA_TOKEN = Deno.env.get("WHATSAPP_TOKEN") || "";
const WA_PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || "";
const TEMPLATE = Deno.env.get("WHATSAPP_SHOWCASE_TEMPLATE") || "";
const TEMPLATE_LANG = Deno.env.get("WHATSAPP_SHOWCASE_TEMPLATE_LANG") || "he";

// ‏131050: הנמען/ת ביקש/ה מ-Meta להפסיק לקבל הודעות מהעסק
export const WA_OPTED_OUT = 131050;

export class WaError extends Error {
  constructor(message: string, public code: number | null) {
    super(message);
  }
}

export function waConfigured(): boolean {
  return !!(WA_TOKEN && WA_PHONE_ID);
}
export function templateConfigured(): boolean {
  return !!TEMPLATE;
}

/** אותה נרמול של phoneE164 ב-_shared/projects.ts. */
export function phoneE164(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let digits = value.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = "972" + digits.slice(1);
  else if (!digits.startsWith("972") && digits.length <= 10) digits = "972" + digits;
  return digits.length >= 11 && digits.length <= 15 ? digits : null;
}

/**
 * פרמטר של תבנית: שורה אחת. Meta דוחה פרמטר עם שורה חדשה, טאב או יותר
 * מארבעה רווחים רצופים - ההסבר המלא ב-docs/whatsapp-setup.md ("התבנית ב-Meta").
 */
function oneLine(s: string, max: number): string {
  return noLongDash(s).replace(/\s*[\r\n\t]+\s*/g, " ").replace(/ {4,}/g, "   ").trim().slice(0, max);
}

async function post(payload: Record<string, unknown>): Promise<string | null> {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${WA_PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) {
    let code: number | null = null;
    try {
      code = JSON.parse(text)?.error?.code ?? null;
    } catch {
      /* גוף שאינו JSON */
    }
    throw new WaError(`HTTP ${res.status}: ${text.slice(0, 300)}`, code);
  }
  try {
    const id = JSON.parse(text)?.messages?.[0]?.id;
    return typeof id === "string" ? id : null;
  } catch {
    return null;
  }
}

export function sendShowcaseTemplate(to: string, firstName: string, line: string, urlSuffix: string) {
  return post({
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: TEMPLATE,
      language: { code: TEMPLATE_LANG },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: oneLine(firstName || "שלום", 60) },
            { type: "text", text: oneLine(line, 600) },
          ],
        },
        // הסיומת בלבד: הבסיס בתבנית הוא https://shuknadlan.co.il/
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: urlSuffix }] },
      ],
    },
  });
}

export function sendShowcaseText(to: string, body: string) {
  return post({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { preview_url: true, body: noLongDash(body).slice(0, 4000) },
  });
}
