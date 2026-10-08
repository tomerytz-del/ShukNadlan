import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { authorizeInternalCaller } from "../_shared/cron-auth.ts";
import {
  feedbackTemplateConfigured, feedbackToMeeting, firstName, inWindow, kickNotificationPush, type MeetingFeedback,
  meetingNoun, meetingTemplateConfigured, meetingWhenText, type MeetingResponse, phoneE164,
  reminderTemplateConfigured, respondToMeeting, sendButtonsTemplate, sendButtonsText, sendMeetingTemplate,
  sendText, SITE, IL_TZ, waConfigured, WaError, WA_OPTED_OUT,
} from "../_shared/meeting-client.ts";

// ============================================================================
// פולואפ ללקוח/ה על פגישה שנקבעה דרך גבריאלה — meeting.html ↔ כאן ↔
// ‏agent_agenda_items / agent_agenda_client_messages.
//
// ‏verify_jwt=false, ושלושה סוגי קוראים:
//
//   ‏· **ה-cron** (‏`meeting-client-dispatch`, כל דקה כשיש מה לשלוח) —
//     ‏`dispatch`, מאומת ב-`authorizeInternalCaller`.
//   ‏· **הלקוח/ה** — אין חשבון. הטוקן מהקישור (‏`t`) הוא המפתח לפגישה אחת:
//     ‏`view`, ‏`respond` ו-`feedback` (‏POST מהדף), וקובץ היומן (‏GET ‎?t=…&ics=1‎).
//
// הדף מקבל רק מה שהלקוח/ה ממילא יודע/ת: מתי, איפה, עם מי. לא הערות
// הסוכן/ת (‏`notes` נכתבות לעצמו/ה), לא שם הלקוח/ה המלא ולא נכס.
// הפרטים: docs/meeting-client-followup.md
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const TOKEN_RE = /^[0-9a-f]{48}$/;
const BATCH = 30;
const RESPONSES: MeetingResponse[] = ["confirmed", "canceled", "reschedule"];
const FEEDBACKS: MeetingFeedback[] = ["liked", "unsure", "not_for_me"];

function corsHeaders(contentType = "application/json") {
  return {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: corsHeaders() });
}

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  if (req.method === "GET") {
    const url = new URL(req.url);
    const token = url.searchParams.get("t") || "";
    if (!TOKEN_RE.test(token) || url.searchParams.get("ics") !== "1") return json({ error: "not_found" }, 404);
    return await handleIcs(supabase, token);
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Row = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const action = String(body.action ?? "view");

  if (action === "dispatch") {
    const auth = authorizeInternalCaller(req);
    if (!auth.ok) return json({ error: auth.error, detail: auth.detail }, auth.status);
    return await handleDispatch(supabase);
  }

  const token = String(body.t ?? "");
  if (!TOKEN_RE.test(token)) return json({ error: "not_found" }, 404);

  if (action === "view") return await handleView(supabase, token);
  if (action === "respond") {
    const response = String(body.response ?? "") as MeetingResponse;
    if (!RESPONSES.includes(response)) return json({ error: "bad_response" }, 400);
    const res = await respondToMeeting(supabase, token, response);
    if (!res.ok && res.error === "db_error") return json({ error: "db_error" }, 500);
    if (!res.ok) return json({ error: res.error, message: res.reply }, 409);
    return json({ ok: true, already: res.already, message: res.reply });
  }
  if (action === "feedback") {
    const feedback = String(body.feedback ?? "") as MeetingFeedback;
    if (!FEEDBACKS.includes(feedback)) return json({ error: "bad_feedback" }, 400);
    const res = await feedbackToMeeting(supabase, token, feedback);
    if (!res.ok && res.error === "db_error") return json({ error: "db_error" }, 500);
    if (!res.ok) return json({ error: res.error, message: res.reply }, 409);
    return json({ ok: true, already: res.already, message: res.reply });
  }
  return json({ error: "unknown_action" }, 400);
});

// ---------------------------------------------------------------------------
// הפגישה, כמו שהלקוח/ה רואה אותה
// ---------------------------------------------------------------------------
async function loadMeeting(supabase: SupabaseClient, token: string): Promise<Row | null | "error"> {
  const { data: item, error } = await supabase
    .from("agent_agenda_items")
    .select("id, kind, title, due_at, ends_at, location, status, client_notify, client_response, client_feedback, client_id, agent_id, updated_at")
    .eq("client_token", token)
    .maybeSingle();
  if (error) return "error";
  if (!item || !item.client_notify) return null;

  const [{ data: agent }, { data: client }] = await Promise.all([
    supabase.from("agency_members")
      .select("display_name, photo_url, phone, slug, agencies!agency_members_agency_id_fkey(name, logo_url)")
      .eq("id", item.agent_id).maybeSingle(),
    item.client_id
      ? supabase.from("agent_clients").select("full_name").eq("id", item.client_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return { item, agent: agent || {}, client: client || {} };
}

async function handleView(supabase: SupabaseClient, token: string) {
  const m = await loadMeeting(supabase, token);
  if (m === "error") return json({ error: "db_error" }, 500);
  if (!m) return json({ error: "not_found" }, 404);
  const { item, agent, client } = m;
  const agency = Array.isArray(agent.agencies) ? agent.agencies[0] : agent.agencies;
  const phone = phoneE164(agent.phone);
  const past = !item.due_at || Date.parse(item.due_at) < Date.now() - 30 * 60_000;
  return json({
    ok: true,
    meeting: {
      kind: item.kind,
      noun: meetingNoun(item.kind),
      starts_at: item.due_at,
      ends_at: item.ends_at || (item.due_at ? new Date(Date.parse(item.due_at) + 3600_000).toISOString() : null),
      when_text: item.due_at ? meetingWhenText(item.due_at) : null,
      location: item.location,
      status: item.status === "canceled" ? "canceled" : past ? "past" : item.status === "open" ? "open" : "closed",
      client_response: item.client_response,
      // משוב: רק אחרי סיור שהתקיים (לא בוטל)
      feedback_open: item.kind === "showing" && item.status !== "canceled" && !!item.due_at &&
        Date.parse(item.due_at) < Date.now() && Date.parse(item.due_at) > Date.now() - 14 * 864e5,
      client_feedback: item.client_feedback,
    },
    client_first_name: firstName(client.full_name),
    agent: {
      name: agent.display_name || null,
      photo_url: agent.photo_url || null,
      phone,
      page_url: agent.slug ? `${SITE}/agent?slug=${encodeURIComponent(agent.slug)}` : null,
      agency_name: agency?.name || null,
      agency_logo_url: agency?.logo_url || null,
    },
  });
}

// ---------------------------------------------------------------------------
// קובץ היומן (‎.ics‎) - Apple, ‏Outlook וכל יומן אחר. ‏Google מקבל קישור
// מהדף עצמו (calendar.google.com/calendar/render), כי בטלפון אנדרואיד קובץ
// ‎.ics‎ יורד כקובץ ולא נפתח ביומן.
// ---------------------------------------------------------------------------
function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}
function icsDate(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
/** קיפול שורות ל-75 בתים (RFC 5545), בלי לחתוך תו UTF-8 באמצע. */
function icsFold(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of Array.from(line)) {
    const n = enc.encode(ch).length;
    if (bytes + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

async function handleIcs(supabase: SupabaseClient, token: string) {
  const m = await loadMeeting(supabase, token);
  if (m === "error") return json({ error: "db_error" }, 500);
  if (!m || !m.item.due_at) return json({ error: "not_found" }, 404);
  const { item, agent } = m;
  const agentName = agent.display_name || "הסוכן/ת";
  const phone = phoneE164(agent.phone);
  const start = item.due_at as string;
  const end = item.ends_at || new Date(Date.parse(start) + 3600_000).toISOString();
  const canceled = item.status === "canceled";
  const desc = [
    `${meetingNoun(item.kind)} עם ${agentName}`,
    phone ? `טלפון: +${phone}` : "",
    `${SITE}/meeting?t=${token}`,
  ].filter(Boolean).join("\n");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//shuknadlan.co.il//meeting//HE",
    "CALSCALE:GREGORIAN",
    `METHOD:${canceled ? "CANCEL" : "PUBLISH"}`,
    "BEGIN:VEVENT",
    `UID:${item.id}@shuknadlan.co.il`,
    // ‏SEQUENCE עולה בכל עדכון, כדי שיומן שכבר מחזיק את האירוע יחליף אותו
    `SEQUENCE:${Math.floor(Date.parse(item.updated_at || start) / 1000) % 2_000_000_000}`,
    `DTSTAMP:${icsDate(new Date().toISOString())}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsEscape(`${meetingNoun(item.kind)} עם ${agentName}`)}`,
    item.location ? `LOCATION:${icsEscape(item.location)}` : "",
    `DESCRIPTION:${icsEscape(desc)}`,
    `STATUS:${canceled ? "CANCELLED" : "CONFIRMED"}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsEscape(meetingNoun(item.kind))}`,
    "TRIGGER:-PT60M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean).map(icsFold);

  return new Response(lines.join("\r\n") + "\r\n", {
    headers: {
      ...corsHeaders("text/calendar; charset=utf-8"),
      "Content-Disposition": 'attachment; filename="meeting.ics"',
      "Cache-Control": "no-store",
    },
  });
}

// ---------------------------------------------------------------------------
// התור היוצא
// ---------------------------------------------------------------------------
async function handleDispatch(supabase: SupabaseClient) {
  const { data: batch, error } = await supabase.rpc("agent_agenda_client_claim", { p_limit: BATCH });
  if (error) return json({ error: "db_error", detail: error.message }, 500);
  const results: Record<string, number> = {};
  let alerts = 0;
  for (const row of (batch || []) as Row[]) {
    // ‏noreply כבר טופלה במסד (התראה לסוכן/ת) - כאן רק מעירים את המשלוח
    if (row.kind === "noreply") {
      alerts++;
      continue;
    }
    const status = await sendOne(supabase, row);
    results[status] = (results[status] ?? 0) + 1;
  }
  if (alerts) await kickNotificationPush();
  return json({ ok: true, processed: (batch || []).length, results, noreply_alerts: alerts });
}

function lineFor(row: Row): string {
  const noun = meetingNoun(row.item_kind);
  const agent = row.agent_name || "הסוכן/ת";
  const withWho = row.agency_name ? `${agent} (${row.agency_name})` : agent;
  const when = meetingWhenText(row.due_at);
  const where = row.location ? `, ב${row.location}` : "";
  const phone = phoneE164(row.agent_phone);
  switch (row.kind) {
    case "confirm":
      return `נקבעה לך ${noun} עם ${withWho} ל${when}${where}. אפשר להוסיף אותה ליומן בכפתור למטה, ושעה לפני אשלח תזכורת.`;
    case "update":
      return `המועד של ה${noun} עם ${withWho} עודכן: ${when}${where}. כדאי לעדכן גם ביומן - בכפתור למטה.`;
    case "cancel":
      return `ה${noun} עם ${withWho} שנקבעה ל${when} בוטלה. לתיאום מועד חדש אפשר לפנות ל${agent}` +
        (phone ? ` ב-wa.me/${phone}.` : ".");
    case "reminder_day":
      return `תזכורת: מחר יש לך ${noun} עם ${withWho}, ${when}${where}. נשמח לדעת שזה בתוקף.`;
    case "feedback": {
      const at = row.location ? ` ב${row.location}` : "";
      return `איך היה ה${noun}${at}? נשמח לשמוע - זה עוזר ל${agent} להתאים לך את ההמשך.`;
    }
    default: {
      const time = new Date(row.due_at).toLocaleTimeString("he-IL", { timeZone: IL_TZ, hour: "2-digit", minute: "2-digit" });
      return `תזכורת: ${noun} עם ${withWho} היום בשעה ${time}${where}. נשמח לדעת שזה בתוקף.`;
    }
  }
}

async function sendOne(supabase: SupabaseClient, row: Row): Promise<string> {
  const done = async (status: string, mode: string | null, err: string | null, wamid: string | null = null) => {
    await supabase.from("agent_agenda_client_messages").update({
      status,
      mode,
      error: err ? err.slice(0, 500) : null,
      wa_message_id: wamid,
      sent_at: new Date().toISOString(),
    }).eq("id", row.message_id);
    return status;
  };

  const to = phoneE164(row.client_phone);
  if (!to) return await done("no_phone", null, "אין ללקוח/ה מספר טלפון תקין בכרטיס");
  if (!waConfigured()) return await done("failed", null, "WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID לא מוגדרים");

  // שלוש צורות: אישור/עדכון/ביטול (כפתור לדף), תזכורת (אישור/ביטול/מועד אחר), משוב
  const buttons: "reminder" | "feedback" | null =
    row.kind === "reminder" || row.kind === "reminder_day" ? "reminder"
    : row.kind === "feedback" ? "feedback"
    : null;
  const name = firstName(row.client_name);
  const line = lineFor(row);
  const templateOk = buttons === "reminder" ? reminderTemplateConfigured()
    : buttons === "feedback" ? feedbackTemplateConfigured()
    : meetingTemplateConfigured();
  const templateEnv = buttons === "reminder" ? "WHATSAPP_MEETING_REMINDER_TEMPLATE"
    : buttons === "feedback" ? "WHATSAPP_MEETING_FEEDBACK_TEMPLATE"
    : "WHATSAPP_MEETING_TEMPLATE";

  // ערוץ: טקסט חופשי כשהלקוח/ה בתוך חלון 24 השעות (הוא חינמי ומאפשר
  // כפתורים), ואחרת תבנית. בלי שניהם - לא נשלח כלום, וזה נרשם.
  let mode: "template" | "text" | null = (await inWindow(supabase, to)) ? "text" : null;
  if (!mode && templateOk) mode = "template";
  if (!mode) {
    return await done("no_channel", null,
      `${templateEnv} לא מוגדר, ` +
        "והלקוח/ה לא כתב/ה למספר ב-24 השעות האחרונות");
  }

  const link = `${SITE}/meeting?t=${row.token}`;
  const text = `שלום ${name || ""}`.trim() + ",\n" + line +
    (row.kind === "cancel" || buttons ? "" : `\n\nלפרטים ולהוספה ליומן: ${link}`);

  try {
    let wamid: string | null;
    if (mode === "template") {
      wamid = buttons
        ? await sendButtonsTemplate(buttons, to, name, line, row.token)
        : await sendMeetingTemplate(to, name, line, row.token);
    } else {
      wamid = buttons ? await sendButtonsText(buttons, to, text, row.token) : await sendText(to, text);
    }
    // כל הודעה יוצאת נרשמת ביומן - מעקב מסירה (docs/whatsapp-setup.md)
    await supabase.from("whatsapp_messages").insert({
      wa_message_id: wamid, direction: "out", wa_phone: to,
      msg_type: mode === "template" ? "template" : buttons ? "interactive" : "text",
      body: (mode === "template" ? line : text).slice(0, 2000),
      status: wamid ? "sent" : null,
    });
    return await done("sent", mode, null, wamid);
  } catch (e) {
    const err = e as WaError;
    await supabase.from("whatsapp_messages").insert({
      direction: "out", wa_phone: to, msg_type: mode, body: line.slice(0, 2000), error: err.message.slice(0, 500),
    });
    return await done(err.code === WA_OPTED_OUT ? "opted_out" : "failed", mode, err.message);
  }
}
