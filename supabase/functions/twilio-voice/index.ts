import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { authorizeInternalCaller } from "../_shared/cron-auth.ts";
import { noLongDash } from "../_shared/marketing-copy.ts";

// ============================================================================
// ‏twilio-voice — יומן שיחות: ניתוב, הקלטה, תמלול, סיכום (פיילוט)
//
// לקוח/ה מתקשר/ת למספר של Twilio שמשויך לסוכן/ת (`agent_phone_lines`).
// Twilio שואלת את הפונקציה מה לעשות, ואנחנו עונים ב-TwiML: הודעה שהשיחה
// מוקלטת, וניתוב לנייד של הסוכן/ת עם הקלטה. בסוף השיחה מגיעים שני דיווחים:
//
//   ?event=incoming   — שיחה נכנסת. יוצרת שורה ב-agent_calls ומחזירה TwiML.
//   ?event=dial       — ה-action של <Dial>: נענתה או לא. שיחה שלא נענתה
//                       מקבלת הודעה ללקוח/ה ("נחזור אליכם") והתראה לסוכן/ת.
//   ?event=recording  — ההקלטה מוכנה. עוברת אלינו (דלי call-recordings),
//                       נמחקת מ-Twilio, מתומללת ב-Whisper ומסוכמת ב-Claude,
//                       והסוכן/ת מקבל/ת בוואטסאפ את הסיכום ואת ההקלטה.
//   ?task=cleanup     — cron יומי: מחיקת הקלטות בנות 90 יום.
//
// ‏verify_jwt = false: את הפונקציה קוראת Twilio, בלי JWT. האימות הוא חתימת
// ‏X-Twilio-Signature מול TWILIO_AUTH_TOKEN, ובלעדיה כל מי שיודע את הכתובת
// היה יכול לייצר שיחות מדומות ביומן של סוכן/ת. ה-cron מאומת בנפרד.
//
// הכול כבוי עד שמוגדרים הסודות ומשויך מספר: מספר בלי שורה פעילה עונה
// בהודעה ומנתק. docs/call-tracking.md.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// ‏trim: סוד שהודבק עם רווח או שורה חדשה בסוף נראה זהה במסך ומפיל כל חתימה
// (4.10.2026: השיחות הראשונות למספר האמיתי נדחו כולן ב-403).
const TWILIO_SID = (Deno.env.get("TWILIO_ACCOUNT_SID") || "").trim();
const TWILIO_TOKEN = (Deno.env.get("TWILIO_AUTH_TOKEN") || "").trim();
const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const CLAUDE_MODEL = Deno.env.get("CALL_SUMMARY_MODEL") || Deno.env.get("CLAUDE_MODEL") ||
  "claude-sonnet-5";

const GRAPH_VERSION = Deno.env.get("WHATSAPP_GRAPH_VERSION") || "v23.0";
const WA_TOKEN = Deno.env.get("WHATSAPP_TOKEN") || "";
const WA_PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || "";
const WA_TEMPLATE = Deno.env.get("WHATSAPP_NOTIFY_TEMPLATE") || "";
const WA_TEMPLATE_LANG = Deno.env.get("WHATSAPP_NOTIFY_TEMPLATE_LANG") || "he";

// הכתובת שאליה Twilio פונה, כפי שהיא רואה אותה. ‏req.url בתוך ה-Edge Runtime
// אינו בהכרח זהה (סכימה ונתיב פנימיים), והחתימה מחושבת על הכתובת החיצונית.
const PUBLIC_BASE = `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/twilio-voice`;

const BUCKET = "call-recordings";
const RETENTION_DAYS = 90;
const DIAL_TIMEOUT_SEC = 25;
// ‏Whisper מקבל עד 25MB. מעבר לזה אין תמלול, וההקלטה עדיין נשמרת ונשלחת.
const WHISPER_MAX_BYTES = 25 * 1024 * 1024;
// ‏WhatsApp מקבל קובץ שמע עד 16MB. מעבר לזה - קישור להאזנה ב-CRM.
const WA_AUDIO_MAX_BYTES = 16 * 1024 * 1024;

const VOICE = 'voice="Google.he-IL-Standard-A" language="he-IL"';
const MSG_RECORDED = "שלום, הגעתם לשוק נדל״ן. השיחה מוקלטת לשיפור השירות.";
const MSG_MISSED = "לא הצלחנו לענות כרגע. נחזור אליכם בהקדם. תודה.";
const MSG_UNASSIGNED = "המספר אינו פעיל כרגע. תודה.";

const SITE = (Deno.env.get("SITE_BASE_URL") || "https://shuknadlan.co.il").replace(/\/+$/, "");

const supabase = createClient(supabaseUrl, serviceRoleKey);

// ‏waitUntil של ה-Edge Runtime: עונים ל-Twilio מיד וממשיכים לעבד ברקע.
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

// ---------------------------------------------------------------------------
// עזרים
// ---------------------------------------------------------------------------

function xml(body: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function escXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** ‏+972521234567 → 0521234567 (לתצוגה). */
function localPhone(e164: string): string {
  const d = String(e164 || "").replace(/\D/g, "");
  return d.startsWith("972") ? "0" + d.slice(3) : d;
}

function phoneKey(raw: unknown): string {
  return String(raw ?? "").replace(/\D/g, "").slice(-9);
}

function e164(raw: string): string {
  const d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("972")) return "+" + d;
  if (d.startsWith("0")) return "+972" + d.slice(1);
  return "+" + d;
}

function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * חתימת Twilio: ‏HMAC-SHA1 של הכתובת המלאה ואחריה כל הפרמטרים, ממוינים לפי
 * שם, כל אחד כ-שם+ערך בלי מפריד. ‏base64. ‏
 * https://www.twilio.com/docs/usage/security#validating-requests
 */
async function validSignature(url: string, params: URLSearchParams, signature: string): Promise<boolean> {
  if (!TWILIO_TOKEN || !signature) return false;
  const keys = [...new Set([...params.keys()])].sort();
  let data = url;
  for (const k of keys) for (const v of params.getAll(k)) data += k + v;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(TWILIO_TOKEN), { name: "HMAC", hash: "SHA-1" }, false, ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  const expected = btoa(String.fromCharCode(...mac));
  return secretsMatch(expected, signature);
}

function twilioAuth(): string {
  return "Basic " + btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`);
}

async function findClient(agentId: string, fromNumber: string) {
  const key = phoneKey(fromNumber);
  if (key.length !== 9) return null;
  const { data } = await supabase
    .from("agent_clients")
    .select("id, full_name, phone, status, deal_type, cities, min_rooms, max_price")
    .eq("agent_id", agentId)
    .not("phone", "is", null)
    .limit(2000);
  return (data || []).find((c) => phoneKey(c.phone) === key) || null;
}

// ---------------------------------------------------------------------------
// וואטסאפ לסוכן/ת
//
// בתוך חלון 24 השעות (הסוכן/ת כתב/ה לעוזר לאחרונה): טקסט חופשי וקובץ שמע.
// מחוצה לו: התבנית של ההתראות (שם + שורת תקציר + כפתור ל-CRM), כי Meta
// אינה מתירה הודעה חופשית - ותבנית אינה יכולה לשאת שמע, ולכן ההקלטה
// מחכה בכרטיס. אותה החלטה כמו ב-notification-push.
// ---------------------------------------------------------------------------

async function inWindow(agentId: string): Promise<boolean> {
  const { data } = await supabase
    .from("whatsapp_conversations")
    .select("last_message_at")
    .eq("agent_id", agentId)
    .maybeSingle();
  const at = data?.last_message_at ? Date.parse(data.last_message_at) : 0;
  return at > Date.now() - 23.5 * 60 * 60 * 1000;
}

async function waSend(payload: Record<string, unknown>): Promise<void> {
  if (!WA_TOKEN || !WA_PHONE_ID) throw new Error("whatsapp not configured");
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${WA_PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
  });
  if (!res.ok) throw new Error(`whatsapp ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

/** שאלה עם כפתורי תשובה מהירה, אחרי הסיכום וההקלטה - כדי שתהיה הדבר האחרון
 *  במסך. הלחיצה חוזרת לבוט ככותרת הכפתור, כאילו נכתבה ביד (ראו sendButtons
 *  ב-whatsapp-webhook/whatsapp.ts), ולכן הכותרת היא ההוראה עצמה. */
export type CallAction = { body: string; buttons: string[] };

function waBody(s: string): string {
  return noLongDash(s).replace(/\*\*([^*\n]+?)\*\*/g, "*$1*");
}

async function notifyAgent(
  agent: { id: string; display_name: string | null; phone_e164: string | null },
  text: string,
  oneLine: string,
  audioUrl: string | null,
  opts: { action?: CallAction | null; urlSuffix?: string } = {},
): Promise<void> {
  const to = agent.phone_e164;
  if (!to) return;
  const body = waBody(text).slice(0, 4000);
  const action = opts.action && opts.action.body ? opts.action : null;

  if (await inWindow(agent.id) || !WA_TEMPLATE) {
    await waSend({ recipient_type: "individual", to, type: "text", text: { preview_url: false, body } });
    if (audioUrl) await waSend({ recipient_type: "individual", to, type: "audio", audio: { link: audioUrl } });
    if (action) {
      const buttons = action.buttons.slice(0, 3);
      try {
        if (!buttons.length) throw new Error("no buttons");
        await waSend({
          recipient_type: "individual",
          to,
          type: "interactive",
          interactive: {
            type: "button",
            body: { text: waBody(action.body).slice(0, 1000) },
            action: {
              buttons: buttons.map((t, i) => ({
                type: "reply",
                // ‏Array.from: אימוג'י הוא שתי יחידות UTF-16, וחיתוך באמצעו נדחה
                reply: { id: `call_${i}`, title: Array.from(t).slice(0, 20).join("") },
              })),
            },
          },
        });
      } catch (err) {
        if (buttons.length) console.error("call action buttons failed", err);
        await waSend({ recipient_type: "individual", to, type: "text", text: { preview_url: false, body: waBody(action.body) } });
      }
    }
    return;
  }

  const first = String(agent.display_name || "").trim().split(/\s+/)[0] || "שלום";
  await waSend({
    to,
    type: "template",
    template: {
      name: WA_TEMPLATE,
      language: { code: WA_TEMPLATE_LANG },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: first.slice(0, 60) },
            // ‏Meta דוחה פרמטר עם שורה חדשה, טאב או ארבעה רווחים רצופים
            {
              type: "text",
              text: noLongDash(oneLine).replace(/\s*[\r\n\t]+\s*/g, " ").replace(/ {4,}/g, "   ").slice(0, 900),
            },
          ],
        },
        {
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [{ type: "text", text: opts.urlSuffix || "/crm?goto=accClients" }],
        },
      ],
    },
  });
}

async function loadAgent(agentId: string) {
  const { data } = await supabase
    .from("agency_members")
    .select("id, display_name, phone, phone_e164")
    .eq("id", agentId)
    .maybeSingle();
  return data as { id: string; display_name: string | null; phone: string | null; phone_e164: string | null } | null;
}

/**
 * ההודעות האלה יוצאות מכאן ולא מהבוט, ולכן גבריאלה לא ראתה אותן: "כן" או
 * לחיצה על "קבע פגישה" היו מגיעים אליה בלי הקשר. הן נכנסות להיסטוריה של
 * השיחה כזוג user/assistant (כדי שהסדר יישאר תקין), בלי לגעת ב-
 * last_message_at - הוא מודד את חלון 24 השעות לפי מה שהסוכן/ת כתב/ה.
 */
async function rememberForBot(agentId: string, text: string): Promise<void> {
  try {
    const { data } = await supabase.from("whatsapp_conversations")
      .select("history").eq("agent_id", agentId).maybeSingle();
    if (!data) return;
    const history = Array.isArray(data.history) ? data.history : [];
    const next = [
      ...history,
      { role: "user", content: "[הודעת מערכת, לא נכתבה בידי הסוכן/ת: נשלחה לסוכן/ת הודעה על שיחת טלפון]" },
      { role: "assistant", content: noLongDash(text).slice(0, 3000) },
    ].slice(-12);
    await supabase.from("whatsapp_conversations").update({ history: next }).eq("agent_id", agentId);
  } catch (err) {
    console.error("remember for bot failed", err);
  }
}

// ---------------------------------------------------------------------------
// שיחה נכנסת
// ---------------------------------------------------------------------------

async function onIncoming(p: URLSearchParams): Promise<Response> {
  const callSid = p.get("CallSid") || "";
  const from = p.get("From") || "";
  const to = p.get("To") || "";

  const { data: line } = await supabase
    .from("agent_phone_lines")
    .select("id, agent_id, forward_to, active, label")
    .eq("twilio_number", to)
    .maybeSingle();
  if (!line || !line.active) {
    return xml(`<Say ${VOICE}>${escXml(MSG_UNASSIGNED)}</Say><Hangup/>`);
  }

  const agent = await loadAgent(line.agent_id);
  const target = e164(line.forward_to || agent?.phone || "");
  if (!target) {
    console.error("no forward target", line.id);
    return xml(`<Say ${VOICE}>${escXml(MSG_MISSED)}</Say><Hangup/>`);
  }

  const client = await findClient(line.agent_id, from);
  const { error } = await supabase.from("agent_calls").upsert({
    agent_id: line.agent_id,
    line_id: line.id,
    twilio_call_sid: callSid,
    direction: "inbound",
    from_number: from,
    to_number: to,
    client_id: client?.id ?? null,
    status: "ringing",
  }, { onConflict: "twilio_call_sid" });
  if (error) console.error("call insert failed", error);

  // לקוח/ה מהקובץ: הכרטיס מגיע לוואטסאפ בזמן שהנייד מצלצל
  if (client && agent) EdgeRuntime.waitUntil(notifyRinging(agent, client, from, line.label || ""));

  const dialAction = escXml(`${PUBLIC_BASE}?event=dial`);
  const recCb = escXml(`${PUBLIC_BASE}?event=recording`);
  // ‏callerId = המתקשר/ת: הסוכן/ת רואה בנייד את מי שמתקשר, לא את המספר שלנו.
  // מתקשר/ת מחו"ל או חסוי/ה: callerId = המספר שלנו. Twilio מתמחרת את הרגל לנייד
  // לפי ה-caller ID - ‏$0.0646 לדקה ממספר ישראלי מול $0.1868 מכל מספר אחר, פי
  // שלושה על אותה שיחה. המתקשר/ת עדיין מופיע/ה בסיכום בוואטסאפ.
  // ‏answerOnBridge: הלקוח/ה שומע/ת צלצול עד שהסוכן/ת עונה, ולא שקט.
  const callerId = from.startsWith("+972") ? from : to;
  return xml(
    `<Say ${VOICE}>${escXml(MSG_RECORDED)}</Say>` +
      `<Dial callerId="${escXml(callerId)}" timeout="${DIAL_TIMEOUT_SEC}" answerOnBridge="true" ` +
      `record="record-from-answer-dual" recordingStatusCallback="${recCb}" ` +
      `recordingStatusCallbackEvent="completed" action="${dialAction}" method="POST">` +
      `<Number>${escXml(target)}</Number></Dial>`,
  );
}

// ---------------------------------------------------------------------------
// סוף הניתוב
// ---------------------------------------------------------------------------

async function onDial(p: URLSearchParams): Promise<Response> {
  const callSid = p.get("CallSid") || "";
  const dialStatus = p.get("DialCallStatus") || "";
  const duration = Number(p.get("DialCallDuration") || 0) || null;
  const answered = dialStatus === "completed" || dialStatus === "answered";
  const status = answered ? "answered" : dialStatus === "busy" ? "busy" : dialStatus === "failed" ? "failed" : "missed";

  const { data: call } = await supabase
    .from("agent_calls")
    .update({ status, duration_sec: duration })
    .eq("twilio_call_sid", callSid)
    .select("id, agent_id, from_number, client_id")
    .maybeSingle();

  if (!answered && call) EdgeRuntime.waitUntil(notifyMissed(call));

  return answered ? xml("<Hangup/>") : xml(`<Say ${VOICE}>${escXml(MSG_MISSED)}</Say><Hangup/>`);
}

/** "מי מתקשר/ת עכשיו" - שם, מה מחפש/ת, ומה דובר בשיחה הקודמת, עם קישור
 *  שפותח את הכרטיס ב-CRM. דפדפן אינו יכול להקפיץ חלון על מסך השיחה בנייד,
 *  ולכן ההתראה של וואטסאפ היא ה"קפיצה". */
async function notifyRinging(
  agent: { id: string; display_name: string | null; phone_e164: string | null },
  client: Record<string, any>,
  from: string,
  label = "",
): Promise<void> {
  try {
    const { data: last } = await supabase.from("agent_calls")
      .select("summary, created_at").eq("client_id", client.id).not("summary", "is", null)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    const link = `/crm?goto=accClients&client=${client.id}`;
    const lines = [`📞 *${client.full_name} מתקשר/ת עכשיו* (${localPhone(from)})`];
    if (label) lines.push(`דרך: ${label}`);
    const needs = needsLine(client).replace(/^:\s*/, "");
    if (needs) lines.push(`מחפש/ת: ${needs}`);
    if (last?.summary) {
      const when = new Date(last.created_at).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric" });
      lines.push(`בשיחה הקודמת (${when}): ${last.summary}`);
    }
    lines.push("", `הכרטיס: ${SITE}${link}`);
    await notifyAgent(agent, lines.join("\n"), `${client.full_name} מתקשר/ת עכשיו`, null, { urlSuffix: link });
    await supabase.from("whatsapp_conversations")
      .update({ last_client_id: client.id }).eq("agent_id", agent.id);
  } catch (err) {
    console.error("ringing notify failed", err);
  }
}

async function notifyMissed(call: { id: string; agent_id: string; from_number: string | null; client_id: string | null }) {
  try {
    const agent = await loadAgent(call.agent_id);
    if (!agent) return;
    const phone = localPhone(call.from_number || "");
    let who = phone || "מספר חסוי";
    let extra = "";
    let action: CallAction | null = phone ? { body: NOT_IN_LIST, buttons: ["כן, תוסיף"] } : null;
    if (call.client_id) {
      const { data: c } = await supabase.from("agent_clients")
        .select("full_name, deal_type, cities, min_rooms, max_price").eq("id", call.client_id).maybeSingle();
      if (c) {
        who = `${c.full_name} (${phone})`;
        extra = "לקוח/ה מהקובץ" + needsLine(c);
        action = { body: `לחזור ל${c.full_name}? אקבע לך תזכורת.`, buttons: ["תזכורת לחזור"] };
        await supabase.from("whatsapp_conversations")
          .update({ last_client_id: call.client_id }).eq("agent_id", call.agent_id);
      }
    }
    const label = await lineLabelForCall(call.id);
    const text = `📞 *שיחה שלא נענתה* מ-${who}${label ? `\nדרך: ${label}` : ""}${extra ? "\n" + extra : ""}\nלחיוג חוזר: ${phone}`;
    await notifyAgent(agent, text, `שיחה שלא נענתה מ-${who}`, null, { action });
    await rememberForBot(call.agent_id, action ? `${text}\n\n${action.body}` : text);
    await supabase.from("agent_calls").update({ notified_at: new Date().toISOString() }).eq("id", call.id);
  } catch (err) {
    console.error("missed notify failed", err);
    await supabase.from("agent_calls").update({ error: String((err as Error)?.message || err).slice(0, 500) })
      .eq("id", call.id);
  }
}

/** הכינוי של המספר שדרכו הגיעה השיחה ("השלט באורנים 13") - כדי שהסוכן/ת
 *  יידע/תדע מאיזה ערוץ הגיעה הפנייה. ריק כשאין כינוי או כשהשיחה מסימולציה. */
async function lineLabelForCall(callId: string): Promise<string> {
  const { data: c } = await supabase.from("agent_calls").select("line_id").eq("id", callId).maybeSingle();
  if (!c?.line_id) return "";
  const { data: l } = await supabase.from("agent_phone_lines").select("label").eq("id", c.line_id).maybeSingle();
  return String(l?.label || "").trim();
}

const NOT_IN_LIST = "הלקוח לא ברשימת הלקוחות שלך, תרצה להוסיף אותו עכשיו?";

function needsLine(c: Record<string, any>): string {
  const parts: string[] = [];
  if (c.deal_type) parts.push(c.deal_type === "rent" ? "שכירות" : "קנייה");
  if (Array.isArray(c.cities) && c.cities.length) parts.push(c.cities.join(", "));
  if (c.min_rooms) parts.push(`${c.min_rooms}+ חדרים`);
  if (c.max_price) parts.push(`עד ${Number(c.max_price).toLocaleString("he-IL")} ₪`);
  return parts.length ? `: ${parts.join(" · ")}` : "";
}

// ---------------------------------------------------------------------------
// ההקלטה: אחסון, תמלול, סיכום, התראה
// ---------------------------------------------------------------------------

async function onRecording(p: URLSearchParams): Promise<Response> {
  if ((p.get("RecordingStatus") || "completed") !== "completed") return json({ ok: true, skipped: true });
  // עונים מיד: Twilio מנסה שוב אחרי 15 שניות, והעיבוד לוקח יותר.
  EdgeRuntime.waitUntil(processRecording({
    callSid: p.get("CallSid") || "",
    recordingSid: p.get("RecordingSid") || "",
    recordingUrl: p.get("RecordingUrl") || "",
    duration: Number(p.get("RecordingDuration") || 0) || null,
  }));
  return json({ ok: true });
}

async function findCallForRecording(callSid: string) {
  const sel = "id, agent_id, from_number, client_id, recording_path, duration_sec";
  const { data } = await supabase.from("agent_calls").select(sel).eq("twilio_call_sid", callSid).maybeSingle();
  if (data) return data;
  // הקלטה של <Dial> עשויה לשאת את ה-SID של הרגל היוצאת. אז שואלים את Twilio
  // מי השיחה-האם שלה.
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Calls/${encodeURIComponent(callSid)}.json`,
    { headers: { Authorization: twilioAuth() } },
  );
  if (!res.ok) return null;
  const parent = (await res.json())?.parent_call_sid;
  if (!parent) return null;
  const { data: byParent } = await supabase.from("agent_calls").select(sel).eq("twilio_call_sid", parent).maybeSingle();
  return byParent;
}

async function processRecording(r: { callSid: string; recordingSid: string; recordingUrl: string; duration: number | null }) {
  const call = await findCallForRecording(r.callSid);
  if (!call) {
    console.error("recording for unknown call", r.callSid, r.recordingSid);
    return;
  }
  if (call.recording_path) return; // משלוח חוזר של Twilio

  try {
    // הורדה מ-Twilio
    const audioRes = await fetch(`${r.recordingUrl}.mp3`, { headers: { Authorization: twilioAuth() } });
    if (!audioRes.ok) throw new Error(`recording download ${audioRes.status}`);
    const bytes = new Uint8Array(await audioRes.arrayBuffer());
    await analyzeCall(call, bytes, "audio/mpeg", r.duration, r.recordingSid);

    // מחיקה מ-Twilio: העותק היחיד נשאר אצלנו, עם תאריך תפוגה אחד.
    fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Recordings/${encodeURIComponent(r.recordingSid)}.json`,
      { method: "DELETE", headers: { Authorization: twilioAuth() } },
    ).catch((e) => console.warn("twilio recording delete failed", e));
  } catch (err) {
    console.error("recording processing failed", err);
    await supabase.from("agent_calls").update({ error: String((err as Error)?.message || err).slice(0, 500) })
      .eq("id", call.id);
  }
}

const AUDIO_EXT: Record<string, string> = {
  "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav",
  "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/webm": "webm", "audio/aac": "aac",
};

/**
 * הצינור המשותף לשיחה אמיתית ולסימולציה: אחסון, תמלול, סיכום, התראה.
 * זורקת בכשל - הקורא רושם את השגיאה בשורה.
 */
async function analyzeCall(
  call: { id: string; agent_id: string; from_number: string | null; client_id: string | null },
  bytes: Uint8Array<ArrayBuffer>,
  mime: string,
  duration: number | null,
  recordingSid: string | null,
) {
  // 1. אלינו
  const ext = AUDIO_EXT[mime] || "mp3";
  const path = `${call.agent_id}/${call.id}.${ext}`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType: mime,
    upsert: true,
  });
  if (upErr) throw new Error(`upload: ${upErr.message}`);
  await supabase.from("agent_calls").update({
    recording_sid: recordingSid,
    recording_path: path,
    recording_duration: duration,
  }).eq("id", call.id);

  // 2. תמלול
  const places = await agentPlaces(call.agent_id);
  const hint = places ? `${WHISPER_DOMAIN} מקומות: ${places}.` : WHISPER_DOMAIN;
  const transcript = bytes.byteLength <= WHISPER_MAX_BYTES ? await transcribe(bytes, mime, ext, hint) : null;

  // 3. סיכום
  const client = call.client_id
    ? (await supabase.from("agent_clients").select("full_name, deal_type, cities, min_rooms, max_price")
      .eq("id", call.client_id).maybeSingle()).data
    : null;
  const summary = transcript ? await summarize(transcript, client?.full_name ?? null, places) : null;

  await supabase.from("agent_calls").update({
    transcript,
    summary: summary?.summary ?? null,
    extracted: summary ?? null,
    processed_at: new Date().toISOString(),
    error: transcript ? null : (OPENAI_KEY ? "transcription_failed" : "transcription_not_configured"),
  }).eq("id", call.id);

  // 4. לסוכן/ת
  const agent = await loadAgent(call.agent_id);
  if (!agent) return;
  const phone = localPhone(call.from_number || "");
  const who = client?.full_name ? `${client.full_name} (${phone})` : (summary?.caller_name
    ? `${summary.caller_name}${phone ? ` (${phone})` : ""}`
    : phone || "מספר חסוי");
  const mins = duration ? `${Math.max(1, Math.round(duration / 60))} דק׳` : "";
  const hasNeeds = !!summary?.needs && Object.keys(summary.needs).length > 0;

  const lines = [`📞 *סיכום שיחה* עם ${who}${mins ? ` · ${mins}` : ""}`];
  const viaLabel = await lineLabelForCall(call.id);
  if (viaLabel) lines.push(`דרך: ${viaLabel}`);
  if (summary?.summary) lines.push("", summary.summary);
  else lines.push("", transcript ? "לא הצלחתי לסכם את השיחה." : "לא הצלחתי לתמלל את השיחה.");
  if (summary?.needs_text) lines.push("", `*מחפש/ת:* ${summary.needs_text}`);
  if (summary?.next_step) lines.push(`*להמשך:* ${summary.next_step}`);
  // השאלות והכפתורים - הודעה נפרדת אחרי ההקלטה, כדי שיהיו הדבר האחרון במסך
  const asks: string[] = [];
  const buttons: string[] = [];
  if (!client) {
    if (phone) {
      asks.push(NOT_IN_LIST + (hasNeeds ? " הדרישות מהשיחה ייכנסו לכרטיס." : ""));
      buttons.push("כן, תוסיף");
    }
  } else {
    if (hasNeeds) {
      asks.push(`לעדכן את הכרטיס של ${client.full_name} בדרישות מהשיחה?`);
      buttons.push("כן, תעדכן");
    }
    await supabase.from("whatsapp_conversations")
      .update({ last_client_id: call.client_id }).eq("agent_id", call.agent_id);
  }
  const tasks = summary?.tasks || [];
  if (tasks.length) {
    asks.push("", "*משימות מהשיחה - אשמח לעזור:*", ...tasks.map((t) => `• ${t.text}`));
    for (const t of tasks) {
      const b = TASK_BUTTON[t.kind];
      if (b && !buttons.includes(b)) buttons.push(b);
    }
  }
  lines.push("", `התמלול וההקלטה בכרטיס: ${SITE}/crm?goto=accClients${call.client_id ? `&client=${call.client_id}` : ""}`);

  let audioUrl: string | null = null;
  if (bytes.byteLength <= WA_AUDIO_MAX_BYTES) {
    const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
    audioUrl = signed?.signedUrl ?? null;
  }
  const text = lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
  const action = asks.length ? { body: asks.join("\n").trim(), buttons } : null;
  await notifyAgent(agent, text, `סיכום שיחה עם ${who}: ${summary?.summary || ""}`, audioUrl, {
    action,
    urlSuffix: `/crm?goto=accClients${call.client_id ? `&client=${call.client_id}` : ""}`,
  });
  await rememberForBot(call.agent_id, action ? `${text}\n\n${action.body}` : text);
  await supabase.from("agent_calls").update({ notified_at: new Date().toISOString() }).eq("id", call.id);
}

/** ‏Whisper מקבל את הקובץ לפי הסיומת, וקובץ m4a מטלפון (מכשירי הקלטה,
 *  Voice Memos) נדחה לפעמים ב-"Invalid file format" למרות שהוא תקין - נצפה
 *  ב-1.10.2026 בסימולציה הראשונה. לכן בדחייה כזו מנסים שוב באותם בתים עם
 *  שם וסוג חלופיים, לפי מה שהבתים עצמם אומרים. */
const WHISPER_RETRY: Record<string, Array<[string, string]>> = {
  m4a: [["mp4", "audio/mp4"], ["mp4", "video/mp4"]],
  mp4: [["m4a", "audio/mp4"]],
  aac: [["m4a", "audio/mp4"], ["mp4", "audio/mp4"]],
  webm: [["ogg", "audio/ogg"]],
  ogg: [["oga", "audio/ogg"], ["webm", "audio/webm"]],
};

function findAscii(bytes: Uint8Array, s: string): boolean {
  const c = [...s].map((ch) => ch.charCodeAt(0));
  outer: for (let i = 0; i <= bytes.length - c.length; i++) {
    for (let j = 0; j < c.length; j++) if (bytes[i + j] !== c[j]) continue outer;
    return true;
  }
  return false;
}

/** הקודק בתוך מעטפת mp4/3gp, לפי ה-sample entry ב-stsd. */
function mp4Codec(bytes: Uint8Array): string {
  if (findAscii(bytes, "mp4a")) return "aac";
  if (findAscii(bytes, "samr")) return "amr";
  if (findAscii(bytes, "sawb")) return "amr-wb";
  return "?";
}

/** ‏ftyp עם מותג 3gp (‏3gp4 - נצפה בהקלטה מטלפון אנדרואיד ב-1.10.2026) נדחה
 *  ב-Whisper גם בשם m4a וגם בשם mp4, אף שהשמע בפנים הוא AAC רגיל. המותג הוא
 *  רק תווית בקופסה הראשונה, ולכן מחליפים אותו בעותק ל-"M4A " (ותאימויות 3g*
 *  ל-"isom") ומנסים שוב. ב-AMR זה לא יעזור - Whisper אינו מכיר את הקודק. */
function rebrandFtyp(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> | null {
  const ascii = (a: number, b: number) => String.fromCharCode(...bytes.slice(a, b));
  if (ascii(4, 8) !== "ftyp" || !ascii(8, 10).startsWith("3g")) return null;
  const size = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0);
  if (size < 16 || size > 256 || size > bytes.length) return null;
  const out = bytes.slice();
  const put = (at: number, s: string) => [...s].forEach((ch, i) => (out[at + i] = ch.charCodeAt(0)));
  put(8, "M4A ");
  for (let at = 16; at + 4 <= size; at += 4) if (ascii(at, at + 2) === "3g") put(at, "isom");
  return out;
}

/** סוג הקובץ לפי הבתים הראשונים - בשביל הלוג, כשהסיומת משקרת. */
function sniff(bytes: Uint8Array): string {
  const ascii = (a: number, b: number) => String.fromCharCode(...bytes.slice(a, b));
  if (ascii(4, 8) === "ftyp") return `mp4(${ascii(8, 12)},${mp4Codec(bytes)})`;
  if (ascii(0, 4) === "OggS") return "ogg";
  if (ascii(0, 4) === "RIFF") return "wav";
  if (ascii(0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return "mp3";
  if (bytes[0] === 0x1a && bytes[1] === 0x45) return "webm";
  if (ascii(0, 6) === "#!AMR\n") return "amr";
  return [...bytes.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join(" ");
}

/** ‏Whisper שומע שמות מקומות לפי מה שהוא מכיר: בסימולציה הראשונה שעברה,
 *  "רובע יזרעאל" (שכונה בעפולה שבה יש לסוכן שלושה נכסים) יצא "ברוב הישראל",
 *  ו"לשכור" יצא "לזכור". ה-prompt של Whisper הוא רמז אוצר מילים: מילות
 *  התחום, ואחריהן הערים והשכונות של הסוכן/ת - מהנכסים ומהלקוחות שלו/ה,
 *  לפי שכיחות. ‏Whisper קורא רק את ~224 הטוקנים האחרונים, ולכן החיתוך.
 *  אותה רשימה עוברת גם לסיכום, כדי ש-Claude יתקן שם שבכל זאת השתבש. */
const WHISPER_DOMAIN = "שיחת נדל״ן בין מתווך ללקוח: שכירות, לשכור, קנייה, לקנות, מכירה, דירה, חדרים, מ״ר, " +
  "קומה, מעלית, חניה, ממ״ד, מרפסת, תקציב, מיליון, אלף שקל, משכנתא, בלעדיות, פינוי, כניסה.";
const WHISPER_HINT_MAX = 500;

async function agentPlaces(agentId: string): Promise<string> {
  const count = new Map<string, number>();
  const add = (s: unknown, w = 1) => {
    const k = typeof s === "string" ? s.trim() : "";
    if (k) count.set(k, (count.get(k) || 0) + w);
  };
  try {
    const [{ data: props }, { data: clients }] = await Promise.all([
      supabase.from("properties").select("city, neighborhood_id").eq("agent_id", agentId).limit(1000),
      supabase.from("agent_clients").select("cities").eq("agent_id", agentId).limit(1000),
    ]);
    const nbIds = [...new Set((props || []).map((p) => p.neighborhood_id).filter(Boolean))];
    const { data: nbs } = nbIds.length
      ? await supabase.from("neighborhoods").select("id, name").in("id", nbIds)
      : { data: [] as Array<{ id: string; name: string }> };
    const nbName = new Map((nbs || []).map((n) => [n.id, n.name]));
    for (const p of props || []) {
      add(p.city, 2);
      add(nbName.get(p.neighborhood_id));
    }
    for (const c of clients || []) for (const city of (c.cities || []) as string[]) add(city);
  } catch (err) {
    console.error("vocabulary hint failed", err);
  }
  let places = "";
  for (const [name] of [...count].sort((a, b) => b[1] - a[1])) {
    // "לב העמק C1" -> "לב העמק": קוד המתחם אינו מה שאומרים בטלפון
    const spoken = name.replace(/\s+[A-Z]\d*$/, "").replace(/\s*\(.*?\)\s*/g, " ").trim();
    if (!spoken || places.includes(spoken)) continue;
    const next = places ? `${places}, ${spoken}` : spoken;
    if (WHISPER_DOMAIN.length + next.length + 8 > WHISPER_HINT_MAX) break;
    places = next;
  }
  return places;
}

async function whisperOnce(bytes: Uint8Array<ArrayBuffer>, mime: string, ext: string, hint: string) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mime }), `call.${ext}`);
  form.append("model", "whisper-1");
  form.append("language", "he");
  if (hint) form.append("prompt", hint);
  return await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}` },
    body: form,
  });
}

async function transcribe(
  bytes: Uint8Array<ArrayBuffer>,
  mime = "audio/mpeg",
  ext = "mp3",
  hint = WHISPER_DOMAIN,
): Promise<string | null> {
  if (!OPENAI_KEY) return null;
  // לפי הבתים ולא לפי מה שהדפדפן אמר: ‏ftyp הוא mp4/m4a גם אם הקובץ נקרא אחרת
  const kind = sniff(bytes);
  if (kind.startsWith("mp4(") && ext !== "m4a" && ext !== "mp4") ext = "m4a";
  const attempts: Array<[Uint8Array<ArrayBuffer>, string, string]> =
    [[ext, mime] as [string, string], ...(WHISPER_RETRY[ext] || [])].map(([e, m]) => [bytes, e, m]);
  // מותג 3gp נדחה בכל שם - העותק עם המותג המתוקן קודם לכל השאר
  const rebranded = rebrandFtyp(bytes);
  if (rebranded) attempts.unshift([rebranded, "m4a", "audio/mp4"]);
  try {
    for (const [b, e, m] of attempts) {
      const res = await whisperOnce(b, m, e, hint);
      if (res.ok) return (((await res.json())?.text as string) || "").trim() || null;
      const body = (await res.text()).slice(0, 300);
      console.error("whisper failed", res.status, `as .${e} (${m})${b === bytes ? "" : " rebranded"}`,
        `sniff=${kind}`, body);
      // רק דחיית פורמט שווה ניסיון נוסף; מכסה, מפתח או תקלה - לא
      if (res.status !== 400 || !/file format/i.test(body)) return null;
    }
    return null;
  } catch (err) {
    console.error("transcription failed", err);
    return null;
  }
}

/** הדרישות בשדות של agent_clients - רק מה שנאמר. ‏מפתח חסר = לא עלה. */
export type CallNeeds = {
  deal_type?: "sale" | "rent";
  cities?: string[];
  min_rooms?: number;
  min_price?: number;
  max_price?: number;
};

type CallTask = { kind: "meeting" | "send_material" | "call_back" | "other"; text: string };

type CallSummary = {
  summary: string;
  caller_name: string | null;
  needs_text: string | null;
  next_step: string | null;
  needs: CallNeeds;
  tasks: CallTask[];
};

/** כפתור לכל סוג משימה. הכותרת היא מה שגבריאלה מקבלת כשלוחצים, ולכן היא
 *  ההוראה עצמה (ראו "יומן שיחות" ב-SYSTEM_STATIC של agent.ts). ‏other בלי
 *  כפתור - היא מוצגת ברשימה, והסוכן/ת כותב/ת מה לעשות. */
const TASK_BUTTON: Record<CallTask["kind"], string | null> = {
  meeting: "קבע פגישה",
  send_material: "שלח חומר ללקוח",
  call_back: "תזכורת לחזור",
  other: null,
};

function cleanTasks(raw: unknown): CallTask[] {
  if (!Array.isArray(raw)) return [];
  const kinds = new Set(["meeting", "send_material", "call_back", "other"]);
  return raw
    .filter((t) => t && typeof t === "object" && kinds.has((t as any).kind) && String((t as any).text || "").trim())
    .map((t) => ({ kind: (t as any).kind, text: noLongDash(String((t as any).text).trim()).slice(0, 200) }))
    .slice(0, 4) as CallTask[];
}

function cleanNeeds(raw: unknown): CallNeeds {
  const n = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: CallNeeds = {};
  if (n.deal_type === "sale" || n.deal_type === "rent") out.deal_type = n.deal_type;
  if (Array.isArray(n.cities)) {
    const cities = n.cities.map((c) => String(c ?? "").trim()).filter(Boolean).slice(0, 6);
    if (cities.length) out.cities = cities;
  }
  const num = (v: unknown, min: number, max: number) => {
    const x = Number(v);
    return Number.isFinite(x) && x >= min && x <= max ? x : undefined;
  };
  const rooms = num(n.min_rooms, 1, 12);
  if (rooms !== undefined) out.min_rooms = Math.round(rooms * 2) / 2;
  const lo = num(n.min_price, 500, 100_000_000);
  const hi = num(n.max_price, 500, 100_000_000);
  if (lo !== undefined) out.min_price = Math.round(lo);
  if (hi !== undefined) out.max_price = Math.round(hi);
  if (out.min_price !== undefined && out.max_price !== undefined && out.min_price > out.max_price) {
    delete out.min_price;
  }
  return out;
}

const SUMMARY_PROMPT = [
  "את/ה מסכם/ת שיחת טלפון בין מתווך/ת נדל\"ן ללקוח/ה, מתוך תמלול אוטומטי בעברית.",
  "התמלול עשוי להכיל שגיאות. אל תמציא/י פרטים שלא נאמרו.",
  "החזר/י JSON בלבד, בלי טקסט נוסף, בשדות:",
  "summary - שניים עד ארבעה משפטים קצרים: מה הלקוח/ה רצה ומה סוכם.",
  "caller_name - שם הלקוח/ה אם נאמר בשיחה, אחרת null.",
  "needs_text - מה הלקוח/ה מחפש/ת בשורה אחת (קנייה או שכירות, עיר, חדרים, תקציב, מועד כניסה), או null אם לא עלה.",
  "next_step - הצעד הבא שסוכם או שכדאי לעשות, במשפט אחד, או null.",
  "needs - אובייקט עם מה שהלקוח/ה מחפש/ת, **רק שדות שנאמרו במפורש** (שדה שלא נאמר - לא לכלול):",
  "  deal_type: \"sale\" (קנייה) או \"rent\" (שכירות); cities: מערך שמות ערים בעברית -",
  "  ערים בלבד, לא שכונות ולא רחובות (שכונה או רחוב שנאמרו נכנסים ל-needs_text);",
  "  min_rooms: מספר החדרים המינימלי (\"4 חדרים\" = 4); min_price / max_price: בשקלים",
  "  (\"עד 2 מליון\" = max_price 2000000; בשכירות - מחיר חודשי). אם לא עלה כלום - {}.",
  "  אם הלקוח/ה מוכר/ת או משכיר/ה נכס ואינו/ה מחפש/ת - {}.",
  "tasks - משימות לסוכן/ת שעלו בשיחה: מה שהסוכן/ת הבטיח/ה (\"אשלח לך\", \"נקבע סיור\", \"אחזור אלייך\")",
  "  או מה שהלקוח/ה ביקש/ה. kind: meeting = לקבוע פגישה, סיור או צפייה בנכס; send_material = לשלוח",
  "  נכסים, פרטים, תמונות או מסמכים; call_back = לחזור ללקוח/ה; other = כל משימה אחרת. text - משפט",
  "  קצר בעברית, עם שם הלקוח/ה ומועד אם נאמר (\"לקבוע עם אריאל סיור ביום ג׳\"). אין משימות - [].",
  "כתוב/כתבי בעברית, עם מקף רגיל (-) ולא מקף ארוך.",
  // ‏structured outputs: מירכאה רגילה בתוך ערך סוגרת את המחרוזת, וכך יצא
  // "4,500 ש" בשיחה של 4.10.2026. סכום נכתב עם ₪, וראשי תיבות עם ״ העברי.
  "סכומים - במספר ואחריו ₪ (\"4,500 ₪\"), לא ש\"ח. אל תשתמש/י במירכאות רגילות בתוך הטקסט;",
  "ראשי תיבות נכתבים עם ״ (גרשיים עבריים), למשל ממ״ד.",
].join("\n");

/** ‏structured outputs: בשיחה האמיתית הראשונה (4.10.2026) המודל הוסיף טקסט
 *  אחרי ה-JSON, ו-JSON.parse נפל - הסוכן קיבל "לא הצלחתי לסכם" על שיחה תקינה.
 *  כמו ב-generateMarketingCopy (‏#529): הסכימה מחייבת JSON תקין, וכל שדה
 *  נוכח - null כשלא נאמר, ו-cleanNeeds מסנן אותו. */
const NULLABLE_STR = { anyOf: [{ type: "string" }, { type: "null" }] };
const NULLABLE_NUM = { anyOf: [{ type: "number" }, { type: "null" }] };
const SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    caller_name: NULLABLE_STR,
    needs_text: NULLABLE_STR,
    next_step: NULLABLE_STR,
    needs: {
      type: "object",
      properties: {
        deal_type: { anyOf: [{ type: "string", enum: ["sale", "rent"] }, { type: "null" }] },
        cities: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }] },
        min_rooms: NULLABLE_NUM,
        min_price: NULLABLE_NUM,
        max_price: NULLABLE_NUM,
      },
      required: ["deal_type", "cities", "min_rooms", "min_price", "max_price"],
      additionalProperties: false,
    },
    tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["meeting", "send_material", "call_back", "other"] },
          text: { type: "string" },
        },
        required: ["kind", "text"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "caller_name", "needs_text", "next_step", "needs", "tasks"],
  additionalProperties: false,
};

/** האובייקט המאוזן הראשון בטקסט - גיבוי למקרה שהתשובה לא הגיעה דרך הסכימה.
 *  ‏regex חמדני (`\{[\s\S]*\}`) תופס גם טקסט שבא אחרי ה-JSON ומכיל "}". */
function firstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

async function summarize(transcript: string, knownName: string | null, places = ""): Promise<CallSummary | null> {
  if (!ANTHROPIC_KEY) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        // ‏8000: max_tokens כולל גם את החשיבה הנסתרת של המודל, ובתקרה נמוכה
        // התשובה חוזרת ריקה (ראו generateMarketingCopy, 1.10.2026).
        max_tokens: 8000,
        system: SUMMARY_PROMPT,
        output_config: { format: { type: "json_schema", schema: SUMMARY_SCHEMA } },
        messages: [{
          role: "user",
          content: (knownName ? `הלקוח/ה המוכר/ת: ${knownName}\n\n` : "") +
            // התמלול משבש שמות מקומות ("ברוב הישראל" במקום "רובע יזרעאל")
            (places
              ? `המקומות שהסוכן/ת עובד/ת בהם: ${places}. אם מילה בתמלול נשמעת כמו אחד מהם, ` +
                `כנראה שזה הוא; מקום שאינו דומה לאף אחד - לא לנחש.\n\n`
              : "") +
            `תמלול השיחה:\n${transcript.slice(0, 60000)}`,
        }],
      }),
    });
    if (!res.ok) {
      console.error("claude failed", res.status, (await res.text()).slice(0, 300));
      return null;
    }
    const data = await res.json();
    // deno-lint-ignore no-explicit-any
    const text = (data?.content ?? []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("")
      .trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    const obj = firstJsonObject(text);
    if (!obj) {
      console.error("summary: no JSON in response", data?.stop_reason, text.slice(0, 200));
      return null;
    }
    const parsed = JSON.parse(obj);
    const clean = (v: unknown) => (typeof v === "string" && v.trim() ? noLongDash(v.trim()) : null);
    const summary = clean(parsed?.summary);
    if (!summary) return null;
    return {
      summary,
      caller_name: clean(parsed?.caller_name),
      needs_text: clean(parsed?.needs_text),
      next_step: clean(parsed?.next_step),
      needs: cleanNeeds(parsed?.needs),
      tasks: cleanTasks(parsed?.tasks),
    };
  } catch (err) {
    console.error("summary failed", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// מחיקה אחרי 90 יום
// ---------------------------------------------------------------------------

async function cleanup(sb: SupabaseClient): Promise<Response> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from("agent_calls")
    .select("id, recording_path")
    .not("recording_path", "is", null)
    .lt("created_at", cutoff)
    .limit(500);
  if (error) return json({ error: error.message }, 500);
  const rows = data || [];
  if (!rows.length) return json({ removed: 0 });

  const { error: rmErr } = await sb.storage.from(BUCKET).remove(rows.map((r) => r.recording_path as string));
  if (rmErr) return json({ error: rmErr.message }, 500);
  const { error: upErr } = await sb.from("agent_calls")
    .update({ recording_path: null })
    .in("id", rows.map((r) => r.id));
  if (upErr) return json({ error: upErr.message }, 500);
  return json({ removed: rows.length });
}

// ---------------------------------------------------------------------------
// סימולציה - כל הצינור על הקלטה שמעלים, בלי Twilio
//
// מנהל/ת הפלטפורמה בלבד, מה-CRM. נועדה לבדוק את התמלול, הסיכום וההודעה
// בוואטסאפ עוד לפני שיש מספר, ולהפריד אחר כך בין תקלה אצלנו לתקלה בטלפוניה.
// השורה נרשמת ב-agent_calls של מי שהעלה/תה, עם `twilio_call_sid` שמתחיל
// ב-SIM-, ונמחקת אחרי 90 יום כמו כל שיחה.
// ---------------------------------------------------------------------------

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const SIM_MAX_BYTES = 25 * 1024 * 1024;

function corsJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

/**
 * מחיקת שיחות - ההקלטה מהדלי והשורה מ-agent_calls. מהכפתור ב-CRM (‏JWT:
 * רק שיחות של הסוכן/ת עצמו/ה), או בקריאה פנימית (‏service_role / סוד ה-cron)
 * לניקוי חד-פעמי, כמו שיחות הניסיון של הפיילוט. ההקלטה נמחקת דרך ה-Storage
 * API ולא ב-SQL, כי מחיקת שורה מ-storage.objects משאירה את הקובץ יתום.
 */
async function deleteCalls(req: Request): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const ids = (Array.isArray(body?.call_ids) ? body.call_ids : [])
    .map((x: unknown) => String(x)).filter((x: string) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 200);
  if (!ids.length) return corsJson({ error: "no_ids" }, 400);

  let q = supabase.from("agent_calls").select("id, recording_path").in("id", ids);
  if (!authorizeInternalCaller(req).ok) {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const { data: userData } = token ? await supabase.auth.getUser(token) : { data: null };
    const uid = userData?.user?.id;
    if (!uid) return corsJson({ error: "unauthorized" }, 401);
    const { data: me } = await supabase.from("agency_members")
      .select("id").eq("user_id", uid).eq("active", true).maybeSingle();
    if (!me) return corsJson({ error: "forbidden" }, 403);
    q = q.eq("agent_id", me.id);
  }
  const { data: rows, error } = await q;
  if (error) return corsJson({ error: error.message }, 500);
  const paths = (rows || []).map((r) => r.recording_path).filter(Boolean) as string[];
  if (paths.length) {
    const { error: rmErr } = await supabase.storage.from(BUCKET).remove(paths);
    if (rmErr) return corsJson({ error: rmErr.message }, 500);
  }
  const found = (rows || []).map((r) => r.id);
  if (found.length) {
    const { error: delErr } = await supabase.from("agent_calls").delete().in("id", found);
    if (delErr) return corsJson({ error: delErr.message }, 500);
  }
  return corsJson({ deleted: found.length, recordings: paths.length });
}

// ---------------------------------------------------------------------------
// מספרי מעקב: הזמנה מהארנק, ביטול וחידוש
//
// הסדר בהזמנה הוא החלק החשוב: קודם מוצאים מספר פנוי (בלי לחייב), אחר כך
// order_phone_line מנכה ופותחת שורה pending, ורק אז קונים ב-Twilio. קנייה
// שנכשלה - phone_line_order_failed מחזירה את הכסף. ההפך (לקנות ואז לחייב)
// היה משאיר אצלנו מספרים קנויים של מי שאין לו/ה יתרה.
// ---------------------------------------------------------------------------

const TW_API = () => `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}`;
const LINE_SOURCES = new Set(["sign", "yad2", "facebook", "instagram", "google", "website", "newspaper", "flyer", "other"]);
// קידומות קוויות שאפשר להזמין. נייד בכוונה לא: ללקוחות שרואים מספר נייד יש
// נטייה לשלוח וואטסאפ, וההודעה לא מגיעה לאף אחד (docs/call-tracking.md).
const LINE_AREAS = new Set(["2", "3", "4", "8", "9", "72", "73", "74", "76", "77"]);

/** מספר ישראלי (ניתוב או מספר קיים) - אותו כלל של phone_line_set_details במסד.
 *  ניתוב לחו"ל היה עולה לנו כסף בלי תקרה. */
function ilPhone(raw: unknown): string | null | false {
  const v = String(raw ?? "").replace(/[^0-9+]/g, "");
  if (!v) return null;
  return /^(\+?972[1-9]\d{7,8}|0[1-9]\d{7,8})$/.test(v) ? v : false;
}

async function agentFromJwt(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const { data: userData } = await supabase.auth.getUser(token);
  const uid = userData?.user?.id;
  if (!uid) return null;
  const { data: me } = await supabase.from("agency_members")
    .select("id, credit_balance").eq("user_id", uid).eq("active", true).maybeSingle();
  return me;
}

async function findAvailableNumber(area: string): Promise<string | null> {
  const res = await fetch(`${TW_API()}/AvailablePhoneNumbers/IL/Local.json?VoiceEnabled=true&PageSize=50`, {
    headers: { Authorization: twilioAuth() },
  });
  if (!res.ok) {
    console.error("twilio available numbers failed", res.status, (await res.text()).slice(0, 300));
    return null;
  }
  const list = ((await res.json())?.available_phone_numbers || []) as Array<{ phone_number: string }>;
  const hit = list.find((n) => n.phone_number.startsWith(`+972${area}`));
  return hit?.phone_number ?? null;
}

async function linesAgentTask(req: Request, task: string): Promise<Response> {
  const me = await agentFromJwt(req);
  if (!me) return corsJson({ error: "unauthorized" }, 401);
  if (!TWILIO_SID || !TWILIO_TOKEN) return corsJson({ error: "not_configured" }, 503);
  const body = await req.json().catch(() => ({}));

  if (task === "lines-available") {
    const area = String(body?.area || "4");
    if (!LINE_AREAS.has(area)) return corsJson({ error: "bad_area" }, 400);
    // המסלול לפני Twilio: מי שאינו/ה רשאי/ת להזמין לא מחפש/ת מספר בכלל
    const { data: quota } = await supabase.rpc("phone_line_quota", { p_agent_id: me.id });
    if (quota && !quota.can_order) {
      return corsJson({ error: "tier_required", required_tier: "premium", quota }, 403);
    }
    const number = await findAvailableNumber(area);
    return corsJson({
      number,
      price: Number(quota?.next_price ?? 89),
      monthly_price: Number(quota?.price ?? 89),
      included: Number(quota?.next_price) === 0,
      balance: Number(me.credit_balance || 0),
    });
  }

  if (task === "lines-release") {
    const { data: line } = await supabase.from("agent_phone_lines")
      .select("id, twilio_sid, status, twilio_number").eq("id", String(body?.line_id || "")).eq("agent_id", me.id).maybeSingle();
    if (!line || line.status === "released") return corsJson({ error: "not_found" }, 404);
    // מספר בלי twilio_sid ניתן בידי הפלטפורמה (כמו מספר הפיילוט) - לא משתחרר מכאן
    if (!line.twilio_sid) return corsJson({ error: "managed_by_platform" }, 409);
    const del = await fetch(`${TW_API()}/IncomingPhoneNumbers/${line.twilio_sid}.json`, {
      method: "DELETE",
      headers: { Authorization: twilioAuth() },
    });
    if (!del.ok && del.status !== 404) {
      return corsJson({ error: "twilio_release_failed", status: del.status }, 502);
    }
    // הסיומת מפנה את ה-unique: Twilio עשויה למכור את המספר שוב, גם לסוכן/ת אחר/ת אצלנו
    await supabase.from("agent_phone_lines").update({
      status: "released",
      active: false,
      released_at: new Date().toISOString(),
      twilio_number: `${line.twilio_number}#released-${line.id.slice(0, 8)}`,
    }).eq("id", line.id);
    return corsJson({ released: true });
  }

  // lines-order
  const area = String(body?.area || "4");
  const source = body?.source_type ? String(body.source_type) : null;
  const label = String(body?.label || "").trim().slice(0, 80);
  const propertyId = body?.property_id ? String(body.property_id) : null;
  if (!LINE_AREAS.has(area)) return corsJson({ error: "bad_area" }, 400);
  if (source && !LINE_SOURCES.has(source)) return corsJson({ error: "bad_source" }, 400);
  if (!label) return corsJson({ error: "label_required" }, 400);
  const forwardTo = ilPhone(body?.forward_to);
  const externalNumber = ilPhone(body?.external_number);
  if (forwardTo === false) return corsJson({ error: "bad_forward_to" }, 400);
  if (externalNumber === false) return corsJson({ error: "bad_external_number" }, 400);
  if (propertyId) {
    const { data: prop } = await supabase.from("properties")
      .select("id").eq("id", propertyId).eq("agent_id", me.id).maybeSingle();
    if (!prop) return corsJson({ error: "property_not_yours" }, 403);
  }

  const number = await findAvailableNumber(area);
  if (!number) return corsJson({ error: "no_number_available" }, 409);

  const { data: order, error: orderErr } = await supabase.rpc("order_phone_line", {
    p_agent_id: me.id, p_number: number, p_label: label, p_source: source, p_property_id: propertyId,
  });
  if (orderErr) return corsJson({ error: orderErr.message }, 500);
  if (order?.error) {
    const status = order.error === "insufficient_balance" ? 402 : order.error === "tier_required" ? 403 : 400;
    return corsJson(order, status);
  }

  const form = new URLSearchParams({
    PhoneNumber: number,
    FriendlyName: `${label} (${me.id.slice(0, 8)})`.slice(0, 64),
    VoiceUrl: `${PUBLIC_BASE}?event=incoming`,
    VoiceMethod: "POST",
  });
  const buy = await fetch(`${TW_API()}/IncomingPhoneNumbers.json`, {
    method: "POST",
    headers: { Authorization: twilioAuth(), "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  if (!buy.ok) {
    const detail = (await buy.text()).slice(0, 300);
    console.error("twilio buy failed", buy.status, detail);
    await supabase.rpc("phone_line_order_failed", { p_line_id: order.line_id });
    return corsJson({ error: "purchase_failed", detail, refunded: true }, 502);
  }
  const bought = await buy.json();
  await supabase.from("agent_phone_lines").update({
    twilio_sid: bought?.sid ?? null,
    status: "active",
    active: true,
    forward_to: forwardTo,
    external_number: externalNumber,
  }).eq("id", order.line_id);
  return corsJson({
    success: true, line_id: order.line_id, number, balance: order.balance,
    price: order.price_charged, included: !!order.included,
  });
}

/** מספר וירטואלי לפי מסלול: Elite - אחד כלול ונוספים בתשלום; האחרים - אחד
 *  בתשלום. הסבב רץ לפני החידוש, כי הוא שממיר מספר כלול של מי שירד/ה לבתשלום
 *  (phone_line_tier_sweep, docs/call-tracking.md). */
function tierSweepNotes(sweep: Record<string, any> | null) {
  const ils = (d: string) => new Date(d).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" });
  const name = (r: Record<string, any>) => `${localPhone(r.number)}${r.label ? ` (${r.label})` : ""}`;
  const rows = (k: string) => (sweep?.[k] || []) as Array<Record<string, any>>;
  return [
    ...rows("warn").map((r) => ({
      agent_id: r.agent_id,
      type: "system",
      title: "מסלול Elite מסתיים בקרוב - מה קורה למספרים הווירטואליים",
      body: `המסלול מסתיים ב-${ils(r.ends_at)}. אם לא יחודש, יישאר לך מספר וירטואלי אחד לבחירתך ` +
        "ב-89 ₪ לחודש, והשאר ישוחררו 7 ימים אחרי הירידה. חידוש המנוי שומר את כל המספרים.",
    })),
    ...rows("included").map((r) => ({
      agent_id: r.agent_id,
      type: "system",
      title: "המספר הווירטואלי שלך כלול עכשיו ב-Elite",
      body: `המספר ${name(r)} מתחדש מעכשיו בלי חיוב, כל עוד המסלול Elite.`,
    })),
    ...rows("choose").map((r) => ({
      agent_id: r.agent_id,
      type: "system",
      title: "בחרו איזה מספר וירטואלי נשאר",
      body: `המסלול כבר אינו Elite, ובו אפשר להחזיק מספר וירטואלי אחד. יש לך ${r.count} מספרים: ` +
        `עד ${ils(r.deadline)} בחרו ב-CRM איזה נשאר (89 ₪ לחודש), או שדרגו חזרה ל-Elite. ` +
        "בלי בחירה יישאר המספר שקיבל הכי הרבה שיחות.",
    })),
    ...rows("converted").map((r) => ({
      agent_id: r.agent_id,
      type: "system",
      title: "המספר הווירטואלי עובר לתשלום",
      body: `המספר ${name(r)} נשאר שלך, ב-${r.price} ₪ לחודש מהארנק החל מ-${ils(r.paid_until)}.`,
    })),
    ...rows("released").map((r) => ({
      agent_id: r.agent_id,
      type: "system",
      title: "המספר שוחרר",
      body: `המספר ${name(r)} שוחרר עם הירידה מ-Elite. השיחות וההקלטות שלו נשארות ביומן.`,
    })),
  ];
}

async function renewLines(): Promise<Response> {
  const { data: sweep, error: sweepErr } = await supabase.rpc("phone_line_tier_sweep");
  if (sweepErr) console.error("phone line tier sweep failed", sweepErr);
  const { data, error } = await supabase.rpc("claim_due_phone_line_renewals");
  if (error) return json({ error: error.message }, 500);
  const failed = (data?.payment_failed || []) as Array<Record<string, any>>;
  const released = (data?.released || []) as Array<Record<string, any>>;
  const tierReleased = (sweep?.released || []) as Array<Record<string, any>>;

  for (const r of [...released, ...tierReleased]) {
    if (r.twilio_sid) {
      const del = await fetch(`${TW_API()}/IncomingPhoneNumbers/${r.twilio_sid}.json`, {
        method: "DELETE",
        headers: { Authorization: twilioAuth() },
      }).catch(() => null);
      if (del && !del.ok && del.status !== 404) console.error("twilio release failed", r.line_id, del.status);
    }
  }
  const notes = [
    ...failed.map((r) => ({
      agent_id: r.agent_id,
      type: "system",
      title: "המספר לא חודש - אין מספיק יתרה בארנק",
      body: `המספר ${localPhone(r.number)}${r.label ? ` (${r.label})` : ""} ממשיך לעבוד עוד 7 ימים. ` +
        `טעינת ${r.price} ₪ לארנק תחדש אותו אוטומטית.`,
    })),
    ...released.map((r) => ({
      agent_id: r.agent_id,
      type: "system",
      title: "המספר שוחרר",
      body: `המספר ${localPhone(r.number)}${r.label ? ` (${r.label})` : ""} שוחרר אחרי 7 ימים בלי תשלום. ` +
        "השיחות וההקלטות שלו נשארות ביומן.",
    })),
    ...tierSweepNotes(sweep),
  ];
  if (notes.length) {
    const { error: nErr } = await supabase.from("notifications").insert(notes);
    if (nErr) console.error("renewal notifications failed", nErr);
  }
  return json({
    renewed: (data?.renewed || []).length,
    payment_failed: failed.length,
    released: released.length,
    tier: sweep ? Object.fromEntries(Object.entries(sweep).map(([k, v]) => [k, (v as unknown[]).length])) : null,
  });
}

async function simulate(req: Request): Promise<Response> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return corsJson({ error: "unauthorized" }, 401);
  const { data: userData } = await supabase.auth.getUser(token);
  const uid = userData?.user?.id;
  if (!uid) return corsJson({ error: "unauthorized" }, 401);
  const { data: me } = await supabase.from("agency_members")
    .select("id, is_platform_admin").eq("user_id", uid).eq("active", true).maybeSingle();
  if (!me?.is_platform_admin) return corsJson({ error: "forbidden" }, 403);

  const form = await req.formData().catch(() => null);
  const file = form?.get("audio");
  if (!(file instanceof File) || !file.size) return corsJson({ error: "no_audio" }, 400);
  if (file.size > SIM_MAX_BYTES) return corsJson({ error: "too_large" }, 413);
  // הודעה קולית של וואטסאפ יורדת לפעמים כ-.opus בלי סוג, או כ-audio/opus.
  // שם הסוג נגזר אז מהסיומת - Whisper ו-Storage מכירים אותה כ-ogg.
  const byExt: Record<string, string> = {
    opus: "audio/ogg", ogg: "audio/ogg", oga: "audio/ogg", mp3: "audio/mpeg", m4a: "audio/mp4",
    mp4: "audio/mp4", wav: "audio/wav", webm: "audio/webm", aac: "audio/aac",
  };
  let mime = (file.type || "").split(";")[0].trim().toLowerCase();
  if (mime === "audio/opus" || mime === "video/ogg") mime = "audio/ogg";
  if (!AUDIO_EXT[mime]) mime = byExt[(file.name.split(".").pop() || "").toLowerCase()] || mime;
  if (!AUDIO_EXT[mime]) return corsJson({ error: "unsupported_type", detail: mime || file.name }, 415);

  const from = e164(String(form?.get("from") || ""));
  const client = from ? await findClient(me.id, from) : null;
  const { data: call, error } = await supabase.from("agent_calls").insert({
    agent_id: me.id,
    twilio_call_sid: `SIM-${crypto.randomUUID()}`,
    direction: "inbound",
    from_number: from || null,
    to_number: "simulation",
    client_id: client?.id ?? null,
    status: "answered",
  }).select("id, agent_id, from_number, client_id").single();
  if (error || !call) return corsJson({ error: "db_error", detail: error?.message }, 500);

  const bytes = new Uint8Array(await file.arrayBuffer());
  EdgeRuntime.waitUntil(analyzeCall(call, bytes, mime, null, null).catch(async (err) => {
    console.error("simulation failed", err);
    await supabase.from("agent_calls").update({ error: String((err as Error)?.message || err).slice(0, 500) })
      .eq("id", call.id);
  }));
  return corsJson({ ok: true, call_id: call.id });
}

// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  if (url.searchParams.get("task") === "simulate") {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return corsJson({ error: "method_not_allowed" }, 405);
    return await simulate(req);
  }

  const linesTask = url.searchParams.get("task") || "";
  if (linesTask === "lines-order" || linesTask === "lines-release" || linesTask === "lines-available") {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return corsJson({ error: "method_not_allowed" }, 405);
    return await linesAgentTask(req, linesTask);
  }
  if (linesTask === "lines-renew") {
    const auth = authorizeInternalCaller(req);
    if (!auth.ok) return json({ error: auth.error, detail: auth.detail }, auth.status);
    return await renewLines();
  }

  if (url.searchParams.get("task") === "delete") {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return corsJson({ error: "method_not_allowed" }, 405);
    return await deleteCalls(req);
  }

  if (url.searchParams.get("task") === "cleanup") {
    const auth = authorizeInternalCaller(req);
    if (!auth.ok) return json({ error: auth.error, detail: auth.detail }, auth.status);
    return await cleanup(supabase);
  }

  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  if (!TWILIO_SID || !TWILIO_TOKEN) {
    console.error("TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not configured");
    return new Response("not configured", { status: 503 });
  }

  const params = new URLSearchParams(await req.text());
  const publicUrl = PUBLIC_BASE + url.search;
  const signature = req.headers.get("x-twilio-signature") || "";
  if (!(await validSignature(publicUrl, params, signature))) {
    // בלי הסוד עצמו: רק מה שמבחין בין טוקן של חשבון אחר לבין כתובת שאינה זהה
    console.error("twilio webhook rejected: invalid signature", JSON.stringify({
      url: publicUrl,
      account_sid_matches: params.get("AccountSid") === TWILIO_SID,
      matches_req_url: await validSignature(req.url, params, signature),
      has_signature: !!signature,
    }));
    return new Response("invalid signature", { status: 403 });
  }
  if (params.get("AccountSid") && params.get("AccountSid") !== TWILIO_SID) {
    console.error("twilio webhook rejected: wrong account", params.get("AccountSid")?.slice(0, 8));
    return new Response("wrong account", { status: 403 });
  }

  switch (url.searchParams.get("event")) {
    case "incoming":
      return await onIncoming(params);
    case "dial":
      return await onDial(params);
    case "recording":
      return await onRecording(params);
    default:
      return new Response("unknown event", { status: 400 });
  }
});
