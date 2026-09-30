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
const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID") || "";
const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
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

async function notifyAgent(
  agent: { id: string; display_name: string | null; phone_e164: string | null },
  text: string,
  oneLine: string,
  audioUrl: string | null,
): Promise<void> {
  const to = agent.phone_e164;
  if (!to) return;
  const body = noLongDash(text).replace(/\*\*([^*\n]+?)\*\*/g, "*$1*").slice(0, 4000);

  if (await inWindow(agent.id) || !WA_TEMPLATE) {
    await waSend({ recipient_type: "individual", to, type: "text", text: { preview_url: false, body } });
    if (audioUrl) await waSend({ recipient_type: "individual", to, type: "audio", audio: { link: audioUrl } });
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
          parameters: [{ type: "text", text: "/crm?goto=accClients" }],
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

// ---------------------------------------------------------------------------
// שיחה נכנסת
// ---------------------------------------------------------------------------

async function onIncoming(p: URLSearchParams): Promise<Response> {
  const callSid = p.get("CallSid") || "";
  const from = p.get("From") || "";
  const to = p.get("To") || "";

  const { data: line } = await supabase
    .from("agent_phone_lines")
    .select("id, agent_id, forward_to, active")
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

  const dialAction = escXml(`${PUBLIC_BASE}?event=dial`);
  const recCb = escXml(`${PUBLIC_BASE}?event=recording`);
  // ‏callerId = המתקשר/ת: הסוכן/ת רואה בנייד את מי שמתקשר, לא את המספר שלנו.
  // ‏answerOnBridge: הלקוח/ה שומע/ת צלצול עד שהסוכן/ת עונה, ולא שקט.
  return xml(
    `<Say ${VOICE}>${escXml(MSG_RECORDED)}</Say>` +
      `<Dial callerId="${escXml(from)}" timeout="${DIAL_TIMEOUT_SEC}" answerOnBridge="true" ` +
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

async function notifyMissed(call: { id: string; agent_id: string; from_number: string | null; client_id: string | null }) {
  try {
    const agent = await loadAgent(call.agent_id);
    if (!agent) return;
    const phone = localPhone(call.from_number || "");
    let who = phone || "מספר חסוי";
    let extra = "המספר אינו בקובץ הלקוחות. להוסיף אותו? כתבו לי \"תוסיף את " + phone + " כלקוח\".";
    if (call.client_id) {
      const { data: c } = await supabase.from("agent_clients")
        .select("full_name, deal_type, cities, min_rooms, max_price").eq("id", call.client_id).maybeSingle();
      if (c) {
        who = `${c.full_name} (${phone})`;
        extra = "לקוח/ה מהקובץ" + needsLine(c);
        await supabase.from("whatsapp_conversations")
          .update({ last_client_id: call.client_id }).eq("agent_id", call.agent_id);
      }
    }
    const text = `📞 *שיחה שלא נענתה* מ-${who}\n${extra}\nלחיוג חוזר: ${phone}`;
    await notifyAgent(agent, text, `שיחה שלא נענתה מ-${who}`, null);
    await supabase.from("agent_calls").update({ notified_at: new Date().toISOString() }).eq("id", call.id);
  } catch (err) {
    console.error("missed notify failed", err);
    await supabase.from("agent_calls").update({ error: String((err as Error)?.message || err).slice(0, 500) })
      .eq("id", call.id);
  }
}

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
    // 1. הורדה מ-Twilio
    const audioRes = await fetch(`${r.recordingUrl}.mp3`, { headers: { Authorization: twilioAuth() } });
    if (!audioRes.ok) throw new Error(`recording download ${audioRes.status}`);
    const bytes = new Uint8Array(await audioRes.arrayBuffer());

    // 2. אלינו
    const path = `${call.agent_id}/${call.id}.mp3`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, bytes, {
      contentType: "audio/mpeg",
      upsert: true,
    });
    if (upErr) throw new Error(`upload: ${upErr.message}`);
    await supabase.from("agent_calls").update({
      recording_sid: r.recordingSid,
      recording_path: path,
      recording_duration: r.duration,
    }).eq("id", call.id);

    // 3. מחיקה מ-Twilio: העותק היחיד נשאר אצלנו, עם תאריך תפוגה אחד.
    fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Recordings/${encodeURIComponent(r.recordingSid)}.json`,
      { method: "DELETE", headers: { Authorization: twilioAuth() } },
    ).catch((e) => console.warn("twilio recording delete failed", e));

    // 4. תמלול
    const transcript = bytes.byteLength <= WHISPER_MAX_BYTES ? await transcribe(bytes) : null;

    // 5. סיכום
    const client = call.client_id
      ? (await supabase.from("agent_clients").select("full_name, deal_type, cities, min_rooms, max_price")
        .eq("id", call.client_id).maybeSingle()).data
      : null;
    const summary = transcript ? await summarize(transcript, client?.full_name ?? null) : null;

    await supabase.from("agent_calls").update({
      transcript,
      summary: summary?.summary ?? null,
      extracted: summary ?? null,
      processed_at: new Date().toISOString(),
    }).eq("id", call.id);

    // 6. לסוכן/ת
    const agent = await loadAgent(call.agent_id);
    if (!agent) return;
    const phone = localPhone(call.from_number || "");
    const who = client?.full_name ? `${client.full_name} (${phone})` : (summary?.caller_name
      ? `${summary.caller_name} (${phone})`
      : phone || "מספר חסוי");
    const mins = r.duration ? `${Math.max(1, Math.round(r.duration / 60))} דק׳` : "";

    const lines = [`📞 *סיכום שיחה* עם ${who}${mins ? ` · ${mins}` : ""}`];
    if (summary?.summary) lines.push("", summary.summary);
    else lines.push("", transcript ? "לא הצלחתי לסכם את השיחה." : "לא הצלחתי לתמלל את השיחה.");
    if (summary?.needs_text) lines.push("", `*מחפש/ת:* ${summary.needs_text}`);
    if (summary?.next_step) lines.push(`*להמשך:* ${summary.next_step}`);
    if (!client) {
      lines.push("", `המספר אינו בקובץ. להוסיף? כתבו לי "תוסיף את ${phone} כלקוח"` +
        (summary?.needs_text ? " והדרישות יתווספו." : "."));
    } else {
      await supabase.from("whatsapp_conversations")
        .update({ last_client_id: call.client_id }).eq("agent_id", call.agent_id);
    }
    lines.push("", `התמלול המלא בכרטיס: ${SITE}/crm?goto=accClients`);

    let audioUrl: string | null = null;
    if (bytes.byteLength <= WA_AUDIO_MAX_BYTES) {
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
      audioUrl = signed?.signedUrl ?? null;
    }
    await notifyAgent(agent, lines.join("\n"), `סיכום שיחה עם ${who}: ${summary?.summary || ""}`, audioUrl);
    await supabase.from("agent_calls").update({ notified_at: new Date().toISOString() }).eq("id", call.id);
  } catch (err) {
    console.error("recording processing failed", err);
    await supabase.from("agent_calls").update({ error: String((err as Error)?.message || err).slice(0, 500) })
      .eq("id", call.id);
  }
}

async function transcribe(bytes: Uint8Array<ArrayBuffer>): Promise<string | null> {
  if (!OPENAI_KEY) return null;
  try {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: "audio/mpeg" }), "call.mp3");
    form.append("model", "whisper-1");
    form.append("language", "he");
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_KEY}` },
      body: form,
    });
    if (!res.ok) {
      console.error("whisper failed", res.status, (await res.text()).slice(0, 300));
      return null;
    }
    return (((await res.json())?.text as string) || "").trim() || null;
  } catch (err) {
    console.error("transcription failed", err);
    return null;
  }
}

type CallSummary = {
  summary: string;
  caller_name: string | null;
  needs_text: string | null;
  next_step: string | null;
};

const SUMMARY_PROMPT = [
  "את/ה מסכם/ת שיחת טלפון בין מתווך/ת נדל\"ן ללקוח/ה, מתוך תמלול אוטומטי בעברית.",
  "התמלול עשוי להכיל שגיאות. אל תמציא/י פרטים שלא נאמרו.",
  "החזר/י JSON בלבד, בלי טקסט נוסף, בשדות:",
  "summary - שניים עד ארבעה משפטים קצרים: מה הלקוח/ה רצה ומה סוכם.",
  "caller_name - שם הלקוח/ה אם נאמר בשיחה, אחרת null.",
  "needs_text - מה הלקוח/ה מחפש/ת בשורה אחת (קנייה או שכירות, עיר, חדרים, תקציב, מועד כניסה), או null אם לא עלה.",
  "next_step - הצעד הבא שסוכם או שכדאי לעשות, במשפט אחד, או null.",
  "כתוב/כתבי בעברית, עם מקף רגיל (-) ולא מקף ארוך.",
].join("\n");

async function summarize(transcript: string, knownName: string | null): Promise<CallSummary | null> {
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
        max_tokens: 1200,
        system: SUMMARY_PROMPT,
        messages: [{
          role: "user",
          content: (knownName ? `הלקוח/ה המוכר/ת: ${knownName}\n\n` : "") +
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
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);
    const clean = (v: unknown) => (typeof v === "string" && v.trim() ? noLongDash(v.trim()) : null);
    const summary = clean(parsed?.summary);
    if (!summary) return null;
    return {
      summary,
      caller_name: clean(parsed?.caller_name),
      needs_text: clean(parsed?.needs_text),
      next_step: clean(parsed?.next_step),
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
Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

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
  if (!(await validSignature(publicUrl, params, req.headers.get("x-twilio-signature") || ""))) {
    return new Response("invalid signature", { status: 403 });
  }
  if (params.get("AccountSid") && params.get("AccountSid") !== TWILIO_SID) {
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
