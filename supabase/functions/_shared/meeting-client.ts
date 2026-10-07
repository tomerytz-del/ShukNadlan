// ============================================================================
// פולואפ ללקוח/ה על פגישה - מה שמשותף ל-meeting-client ול-whatsapp-webhook.
//
//   ‏meeting-client   שולח מהתור (אישור, עדכון, ביטול, תזכורת שעה לפני),
//                    ומגיש את דף הפגישה ואת קובץ ה-‎.ics‎.
//   ‏whatsapp-webhook מקבל את הלחיצה על כפתור בתזכורת (‏`mtg:<c|x|r>:<token>`)
//                    ועונה ללקוח/ה.
//
// ‏**למה תבנית.** הלקוח/ה של הסוכן/ת כמעט אף פעם לא כתב/ה למספר של שוק
// נדל״ן, ו-Meta מרשה לפתוח שיחה עם מי שלא כתב/ה ב-24 השעות האחרונות **רק**
// בתבנית מאושרת. בלי תבנית נשלח טקסט חופשי רק בתוך החלון, ואחרת השורה
// נרשמת `no_channel` - כדי שהסוכן/ת יראה/תראה שזה לא יצא, במקום כשל שקט.
// אותו מבנה בדיוק של client-showcase/wa.ts.
//
// הפרטים, כולל נוסח התבניות שצריך לאשר ב-Meta: docs/meeting-client-followup.md
// ============================================================================

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { noLongDash } from "./marketing-copy.ts";

const GRAPH_VERSION = Deno.env.get("WHATSAPP_GRAPH_VERSION") || "v23.0";
const WA_TOKEN = Deno.env.get("WHATSAPP_TOKEN") || "";
const WA_PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || "";

// {{1}} שם פרטי · {{2}} שורה אחת · כפתור URL דינמי (‏meeting?t=…)
const MEETING_TEMPLATE = Deno.env.get("WHATSAPP_MEETING_TEMPLATE") || "";
// {{1}} שם פרטי · {{2}} שורה אחת · שלושה כפתורי quick reply: אישור / ביטול / מועד אחר
const REMINDER_TEMPLATE = Deno.env.get("WHATSAPP_MEETING_REMINDER_TEMPLATE") || "";
const TEMPLATE_LANG = Deno.env.get("WHATSAPP_MEETING_TEMPLATE_LANG") || "he";

export const SITE = "https://shuknadlan.co.il";
export const IL_TZ = "Asia/Jerusalem";

// ‏131050: הנמען/ת ביקש/ה מ-Meta להפסיק לקבל הודעות מהעסק
export const WA_OPTED_OUT = 131050;

export type MeetingResponse = "confirmed" | "canceled" | "reschedule";

// הכפתורים בתזכורת. בתבנית הכותרות קבועות ב-Meta, ורק ה-payload נשלח מכאן;
// בטקסט חופשי (בתוך חלון 24 השעות) הן נשלחות מכאן - עד 20 תווים.
export const REMINDER_BUTTONS: Array<{ code: string; response: MeetingResponse; title: string }> = [
  { code: "c", response: "confirmed", title: "✅ אישור הגעה" },
  { code: "x", response: "canceled", title: "❌ ביטול הפגישה" },
  { code: "r", response: "reschedule", title: "📆 לשנות מועד" },
];

const PAYLOAD_RE = /^mtg:([cxr]):([0-9a-f]{48})$/;

/** ‏`mtg:c:<token>` → התשובה והטוקן. כל דבר אחר → null (ההודעה ממשיכה לבוט). */
export function parseMeetingPayload(value: unknown): { response: MeetingResponse; token: string } | null {
  const m = typeof value === "string" ? value.trim().match(PAYLOAD_RE) : null;
  if (!m) return null;
  const b = REMINDER_BUTTONS.find((x) => x.code === m[1]);
  return b ? { response: b.response, token: m[2] } : null;
}

export function meetingPayload(code: string, token: string): string {
  return `mtg:${code}:${token}`;
}

export class WaError extends Error {
  constructor(message: string, public code: number | null) {
    super(message);
  }
}

export function waConfigured(): boolean {
  return !!(WA_TOKEN && WA_PHONE_ID);
}
export function meetingTemplateConfigured(): boolean {
  return !!MEETING_TEMPLATE;
}
export function reminderTemplateConfigured(): boolean {
  return !!REMINDER_TEMPLATE;
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

export function firstName(full: unknown): string {
  return String(full || "").trim().split(/\s+/)[0] || "";
}

/** "יום שלישי 14.10 בשעה 17:00" */
export function meetingWhenText(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("he-IL", { timeZone: IL_TZ, weekday: "long" });
  const date = d.toLocaleDateString("he-IL", { timeZone: IL_TZ, day: "numeric", month: "numeric" })
    .replace(/\//g, ".");
  const time = d.toLocaleTimeString("he-IL", { timeZone: IL_TZ, hour: "2-digit", minute: "2-digit" });
  return `${day} ${date} בשעה ${time}`;
}

export function meetingNoun(kind: string): string {
  return kind === "showing" ? "סיור בנכס" : kind === "signing" ? "פגישת חתימה" : "פגישה";
}

/**
 * פרמטר של תבנית: שורה אחת. Meta דוחה פרמטר עם שורה חדשה, טאב או יותר
 * מארבעה רווחים רצופים - ההסבר המלא ב-docs/whatsapp-setup.md ("התבנית ב-Meta").
 */
export function oneLine(s: string, max: number): string {
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

/** אישור / עדכון / ביטול: שורה אחת וכפתור לדף הפגישה. */
export function sendMeetingTemplate(to: string, name: string, line: string, token: string) {
  return post({
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: MEETING_TEMPLATE,
      language: { code: TEMPLATE_LANG },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: oneLine(name || "שלום", 60) },
            { type: "text", text: oneLine(line, 600) },
          ],
        },
        // הסיומת בלבד: הבסיס בתבנית הוא https://shuknadlan.co.il/
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: `meeting?t=${token}` }] },
      ],
    },
  });
}

/** התזכורת: שורה אחת ושלושה כפתורי quick reply, שה-payload שלהם נושא את הטוקן. */
export function sendReminderTemplate(to: string, name: string, line: string, token: string) {
  return post({
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: REMINDER_TEMPLATE,
      language: { code: TEMPLATE_LANG },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: oneLine(name || "שלום", 60) },
            { type: "text", text: oneLine(line, 600) },
          ],
        },
        ...REMINDER_BUTTONS.map((b, i) => ({
          type: "button",
          sub_type: "quick_reply",
          index: String(i),
          parameters: [{ type: "payload", payload: meetingPayload(b.code, token) }],
        })),
      ],
    },
  });
}

export function sendText(to: string, body: string) {
  return post({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { preview_url: true, body: noLongDash(body).slice(0, 4000) },
  });
}

/** התזכורת בתוך חלון 24 השעות: אותם שלושה כפתורים, כהודעה אינטראקטיבית. */
export function sendReminderButtons(to: string, body: string, token: string) {
  return post({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: noLongDash(body).slice(0, 1000) },
      action: {
        buttons: REMINDER_BUTTONS.map((b) => ({
          type: "reply",
          reply: { id: meetingPayload(b.code, token), title: b.title },
        })),
      },
    },
  });
}

/** האם הלקוח/ה כתב/ה למספר ב-23 השעות האחרונות - כלומר מותר טקסט חופשי. */
export async function inWindow(supabase: SupabaseClient, to: string): Promise<boolean> {
  const since = new Date(Date.now() - 23 * 3600_000).toISOString();
  const { data } = await supabase
    .from("whatsapp_messages").select("id")
    .eq("wa_phone", to).eq("direction", "in").gte("created_at", since)
    .limit(1);
  return !!data?.length;
}

/**
 * מעיר את notification-push מיד, כדי שתשובה של לקוח/ה ("ביטלתי") תגיע
 * לסוכן/ת עכשיו ולא בסבב של חמש הדקות. כשל כאן אינו מפיל דבר - הסבב הרגיל
 * ישלח אותה.
 */
export async function kickNotificationPush(): Promise<void> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return;
  try {
    await fetch(`${url}/functions/v1/notification-push`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    console.error("notification-push kick failed", err);
  }
}

/**
 * תשובה של לקוח/ה (כפתור בוואטסאפ או בדף הפגישה): נרשמת ב-
 * `agent_agenda_client_respond`, שמתריעה לסוכן/ת. מחזירה את הנוסח לתשובה
 * ללקוח/ה - בלשון נקבה, כי מי שעונה מהמספר הזה היא גבריאלה.
 */
export async function respondToMeeting(
  supabase: SupabaseClient,
  token: string,
  response: MeetingResponse,
): Promise<{ ok: boolean; error?: string; already?: boolean; reply: string }> {
  const { data, error } = await supabase.rpc("agent_agenda_client_respond", {
    p_token: token,
    p_response: response,
  });
  if (error) {
    console.error("meeting respond failed", error);
    return { ok: false, error: "db_error", reply: "משהו השתבש אצלי כרגע. אפשר לנסות שוב בעוד רגע." };
  }
  const res = (data || {}) as Record<string, unknown>;

  const { data: item } = await supabase
    .from("agent_agenda_items")
    .select("kind, due_at, location, agent_id")
    .eq("client_token", token)
    .maybeSingle();
  let agentName = "הסוכן/ת";
  let agentPhone: string | null = null;
  if (item?.agent_id) {
    const { data: agent } = await supabase
      .from("agency_members").select("display_name, phone").eq("id", item.agent_id).maybeSingle();
    agentName = agent?.display_name || agentName;
    agentPhone = phoneE164(agent?.phone);
  }
  const contact = agentPhone ? ` אפשר גם לכתוב ישירות: https://wa.me/${agentPhone}` : "";
  const noun = meetingNoun(String(item?.kind || "meeting"));

  if (res.error === "canceled") {
    return { ok: false, error: "canceled", reply: `ה${noun} הזו כבר בוטלה. לתיאום מועד חדש אפשר לפנות ל${agentName}.${contact}` };
  }
  if (res.error === "past") {
    return { ok: false, error: "past", reply: `ה${noun} הזו כבר עברה. לכל שאלה אפשר לפנות ל${agentName}.${contact}` };
  }
  if (res.error) {
    return { ok: false, error: String(res.error), reply: "לא מצאתי את הפגישה הזו. אפשר לפנות ישירות לסוכן/ת שקבע/ה אותה." };
  }

  if (!res.already) await kickNotificationPush();

  const when = item?.due_at ? meetingWhenText(String(item.due_at)) : "";
  const where = item?.location ? `, ${item.location}` : "";
  const reply = response === "confirmed"
    ? `תודה! עדכנתי את ${agentName} שמגיעים 🙌 נתראה ${when}${where}.`
    : response === "canceled"
    ? `ה${noun} בוטלה, ועדכנתי את ${agentName}. כשתרצו לקבוע מועד חדש - ${agentName} ישמח/תשמח לתאם.${contact}`
    : `עדכנתי את ${agentName} שצריך מועד אחר, והוא/היא יחזור/תחזור אליך לתיאום.${contact}`;
  return { ok: true, already: !!res.already, reply };
}
