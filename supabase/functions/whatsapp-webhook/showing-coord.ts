// ============================================================================
// תיאום ביקור עם הבעלים והמתווכים - לסיור שלקוח/ה ביקש/ה במיניסייט.
//
// ‏pg_cron קורא ל-`whatsapp-webhook?task=showing-coord` כל דקה, רק כש-
// ‏`showing_coord_ready()` אומרת שיש מה לעשות. שני שלבים בכל סבב:
//
//   1. **ההצעה לסוכן/ת** (‏`showing_coord_offer_claim`): "דנה ביקשה סיור
//      ב-3 נכסים - לשלוח לכולם בקשת תיאום?" עם כן/לא. רק בתוך חלון 24
//      השעות - הודעת כפתורים מחוצה לו נדחית, ואין תבנית לזה.
//   2. **הבקשות** (‏`showing_coord_claim`): לכל בעלים / מתווך/ת הודעה עם
//      שלושה כפתורים. בתוך החלון - כפתורים רגילים; מחוצה לו - תבנית
//      ‏`WHATSAPP_SHOWING_COORD_TEMPLATE`; בלי שתיהן - `no_channel`, והפאנל
//      ב-CRM נותן קישור וואטסאפ עם אותו נוסח לשליחה ידנית.
//
// ## שני סוגי כפתורים, ושניהם נתפסים לפני המודל
//
//   ‏`scoord:<y|n>:<meeting_id>` - הסוכן/ת עונה להצעה. נבדק בענף `interactive`
//   של הסוכן/ת ב-index.ts, לפני הכותרת.
//   ‏`scr:<a|p|d>:<token>` - הבעלים / המתווך/ת עונה לבקשה. נבדק ב-handleMessage
//   **לפני זיהוי השולח/ת**, כמו `mtg:` - בעלים אינו סוכן/ת, ומתווך/ת בשת"פ
//   הוא/היא סוכן/ת שהלחיצה שלו/ה אסור שתגיע למודל כאילו נכתבה ביד.
//
// **הסדר של הכפתורים הוא חוזה עם Meta** (הסקיל meeting-followup): בתבנית
// הכותרות קבועות שם, והקוד שולח payload לפי האינדקס.
//
// הפרטים, כולל נוסח התבנית: docs/showing-coordination.md
// ============================================================================

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { formatForWhatsapp, sendButtons } from "./whatsapp.ts";
import {
  firstName,
  IL_TZ,
  inWindow,
  kickNotificationPush,
  oneLine,
  phoneE164,
  WA_OPTED_OUT,
  WaError,
} from "../_shared/meeting-client.ts";

const GRAPH_VERSION = Deno.env.get("WHATSAPP_GRAPH_VERSION") || "v23.0";
const WA_TOKEN = Deno.env.get("WHATSAPP_TOKEN") || "";
const WA_PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || "";
// {{1}} שם · {{2}} שורה אחת · שלושה כפתורי quick reply בסדר של COORD_BUTTONS
const COORD_TEMPLATE = Deno.env.get("WHATSAPP_SHOWING_COORD_TEMPLATE") || "";
const COORD_TEMPLATE_LANG = Deno.env.get("WHATSAPP_SHOWING_COORD_TEMPLATE_LANG") || "he";

export type CoordAnswer = "confirmed" | "postpone" | "declined";

// עד 20 תווים ו-20 יחידות UTF-16 (נמדד). ‏"לא מתאים, מועד אחר" בלי אימוג'י:
// עם 📆 הוא 21 יחידות, ו-Meta דוחה את ההודעה כולה.
export const COORD_BUTTONS: Array<{ code: string; value: CoordAnswer; title: string }> = [
  { code: "a", value: "confirmed", title: "✅ מאשר/ת" },
  { code: "p", value: "postpone", title: "🕒 מבקש/ת לדחות" },
  { code: "d", value: "declined", title: "לא מתאים, מועד אחר" },
];
export const OFFER_YES = "📨 כן, לשלוח לכולם";
export const OFFER_NO = "לא, אתאם בעצמי";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const COORD_RE = /^scr:([apd]):([0-9a-f]{48})$/;
const OFFER_RE = new RegExp(`^scoord:([yn]):(${UUID})$`, "i");

/** ‏`scr:a:<token>` → מה נלחץ והטוקן. כל דבר אחר → null. */
export function parseCoordPayload(value: unknown): { answer: CoordAnswer; token: string } | null {
  const m = typeof value === "string" ? value.trim().match(COORD_RE) : null;
  if (!m) return null;
  const b = COORD_BUTTONS.find((x) => x.code === m[1]);
  return b ? { answer: b.value, token: m[2] } : null;
}

function ilDateKey(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: IL_TZ });
}

function ilTime(d: Date): string {
  return d.toLocaleTimeString("he-IL", { timeZone: IL_TZ, hour: "2-digit", minute: "2-digit" });
}

/** ‏"היום" / "מחר" / "ביום שלישי 14.10" */
export function dayText(iso: string): string {
  const d = new Date(iso);
  const key = ilDateKey(d);
  if (key === ilDateKey(new Date())) return "היום";
  if (key === ilDateKey(new Date(Date.now() + 86400_000))) return "מחר";
  const day = d.toLocaleDateString("he-IL", { timeZone: IL_TZ, weekday: "long" });
  const date = d.toLocaleDateString("he-IL", { timeZone: IL_TZ, day: "numeric", month: "numeric" })
    .replace(/\//g, ".");
  return `ב${day} ${date}`;
}

/** ‏"17:00-18:00" - שעה מהמועד שנקבע לסוכן/ת. */
export function windowText(iso: string): string {
  const d = new Date(iso);
  return `${ilTime(d)}-${ilTime(new Date(d.getTime() + 3600_000))}`;
}

type ClaimRow = {
  request_id: string;
  token: string;
  target: "owner" | "agent";
  target_name: string | null;
  target_phone: string | null;
  window_start: string;
  agent_id: string;
  agent_name: string | null;
  agent_gender: string | null;
  agency_name: string | null;
  property_line: string | null;
};

/**
 * הבקשה עצמה, בגוף ראשון של הסוכן/ת - כך ביקש/ה המשתמש/ת שהגדיר/ה אותה.
 * בלי שם הלקוח/ה ובלי שאר הנכסים בסיור: הנמען/ת צריך/ה לדעת מי, איפה ומתי.
 */
export function coordLine(
  r: Pick<ClaimRow, "agent_name" | "agency_name" | "property_line" | "window_start"> & { agent_gender?: string | null },
  nudge = false,
): string {
  const who = [r.agent_name, r.agency_name].filter(Boolean).join(" מ");
  const where = r.property_line ? ` ב${r.property_line}` : "";
  return `${nudge ? "תזכורת קטנה: " : ""}${who ? `כאן ${who}. ` : ""}אני ${r.agent_gender === "male" ? "מבקש" : r.agent_gender === "female" ? "מבקשת" : "מבקש/ת"} לתאם איתך ביקור בנכס${where} עם לקוחות, ` +
    `${dayText(r.window_start)} בסביבות השעה ${windowText(r.window_start)}.`;
}

export function coordText(r: ClaimRow, nudge = false): string {
  const hi = firstName(r.target_name);
  return `שלום${hi ? " " + hi : ""}, ${coordLine(r, nudge)}\nהאם זה מתאפשר לך? אשמח לאישור הביקור.`;
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

function sendCoordTemplate(to: string, name: string, line: string, token: string) {
  return post({
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: COORD_TEMPLATE,
      language: { code: COORD_TEMPLATE_LANG },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: oneLine(name || "שלום", 60) },
            { type: "text", text: oneLine(line, 600) },
          ],
        },
        ...COORD_BUTTONS.map((b, i) => ({
          type: "button",
          sub_type: "quick_reply",
          index: String(i),
          parameters: [{ type: "payload", payload: `scr:${b.code}:${token}` }],
        })),
      ],
    },
  });
}

/**
 * בקשה אחת: ערוץ, שליחה, רישום ביומן ועדכון השורה. מחזירה את הסטטוס.
 *
 * ‏`nudge` - התזכורת למי שלא ענה/תה. אותם כפתורים ואותו טוקן, אבל **השורה
 * אינה מתעדכנת**: הבקשה המקורית כבר הגיעה, ותזכורת שנכשלה אינה הופכת אותה
 * ל-failed. ‏nudged_at נכתב ב-claim, לפני השליחה.
 */
async function sendOne(supabase: SupabaseClient, r: ClaimRow, nudge = false): Promise<string> {
  const done = async (status: string, wamid: string | null = null, error: string | null = null) => {
    if (nudge) return status;
    await supabase.from("showing_coord_requests").update({
      status,
      wa_message_id: wamid,
      error: error ? error.slice(0, 500) : null,
      sent_at: status === "sent" ? new Date().toISOString() : null,
    }).eq("id", r.request_id);
    return status;
  };

  const to = phoneE164(r.target_phone);
  if (!to) return await done("no_phone");

  const text = coordText(r, nudge);
  const open = await inWindow(supabase, to);
  if (!open && !COORD_TEMPLATE) {
    // תזכורת שלא יצאה נרשמת ביומן עם הסיבה, כמו כל הודעה יוצאת. עד 27.10.2026
    // היא חזרה כאן בלי שורה, ו-nudged_at (שנכתב ב-claim) נראה כמו "נשלחה".
    if (nudge) {
      await supabase.from("whatsapp_messages").insert({
        direction: "out", wa_phone: to, msg_type: "template",
        body: formatForWhatsapp(text).slice(0, 2000),
        error: "no_channel: חלון 24 השעות נסגר ואין תבנית מאושרת (WHATSAPP_SHOWING_COORD_TEMPLATE)",
      });
    }
    return await done("no_channel");
  }

  try {
    const wamid = open
      ? await sendButtons(to, text, COORD_BUTTONS.map((b) => ({ id: `scr:${b.code}:${r.token}`, title: b.title })))
      : await sendCoordTemplate(to, r.target_name || "", coordLine(r, nudge), r.token);
    // כל הודעה יוצאת נרשמת ביומן (הסקיל whatsapp-bots). ‏agent_id ריק: השיחה
    // היא עם הנמען/ת, לא עם הסוכן/ת - גם כשהנמען/ת מתווך/ת בעצמו/ה.
    await supabase.from("whatsapp_messages").insert({
      wa_message_id: wamid,
      direction: "out",
      wa_phone: to,
      msg_type: open ? "interactive" : "template",
      body: formatForWhatsapp(`${text} [${COORD_BUTTONS.map((b) => b.title).join(" | ")}]`).slice(0, 2000),
      status: wamid ? "sent" : null,
    });
    return await done("sent", wamid);
  } catch (e) {
    const err = e as WaError;
    await supabase.from("whatsapp_messages").insert({
      direction: "out", wa_phone: to, msg_type: open ? "interactive" : "template",
      body: formatForWhatsapp(text).slice(0, 2000), error: String(err.message || e).slice(0, 500),
    });
    return await done(err.code === WA_OPTED_OUT ? "opted_out" : "failed", null, String(err.message || e));
  }
}

/** שולחת את מה שממתין - כולו, או רק של סיור אחד (אחרי "כן" בוואטסאפ). */
export async function sendPendingCoord(supabase: SupabaseClient, meetingId: string | null = null) {
  const { data, error } = await supabase.rpc("showing_coord_claim", { p_meeting_id: meetingId, p_limit: 30 });
  if (error) return { error: error.message, results: [] as Array<{ name: string | null; line: string | null; status: string }> };
  const results: Array<{ name: string | null; line: string | null; status: string }> = [];
  // בטור: לרוב שלוש-ארבע הודעות, ו-Meta מגבילה קצב לכל מספר.
  for (const r of (data || []) as ClaimRow[]) {
    results.push({ name: r.target_name, line: r.property_line, status: await sendOne(supabase, r) });
  }
  return { results };
}

type OfferRow = {
  meeting_id: string;
  agent_id: string;
  wa_phone: string;
  display_name: string | null;
  client_name: string | null;
  starts_at: string;
  targets: Array<{ line: string; target: "owner" | "agent"; name: string | null; has_phone: boolean }>;
};

function offerBody(o: OfferRow): string {
  const hi = firstName(o.display_name);
  const client = firstName(o.client_name) || "הלקוח/ה";
  const list = (o.targets || []).map((t) => {
    const who = t.target === "owner"
      ? `בעלים: ${t.name || "לא רשום/ה בנכס"}`
      : `מתווך/ת: ${t.name || "לא ידוע"}`;
    return `• ${t.line || "נכס"} (${who}${t.has_phone ? "" : ", אין טלפון"})`;
  }).join("\n");
  return `${hi ? hi + ", " : ""}${client} ביקש/ה במיניסייט סיור ${dayText(o.starts_at)} ב-${windowText(o.starts_at).slice(0, 5)}:\n` +
    `${list}\n\nלשלוח לכל הבעלים והמתווכים בקשה לתאם ביקור בסביבות ${windowText(o.starts_at)}? ` +
    "כל אחד/ת יקבל/תקבל כפתורים לאשר, לדחות או לבקש מועד אחר. אעדכן אותך על כל תשובה, " +
    "אזכיר למי שלא ענה/תה, ושעתיים לפני הסיור אשלח לך סיכום מי אישר/ה ומי לא.";
}

async function sendOffers(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("showing_coord_offer_claim", { p_limit: 20 });
  if (error) return { error: error.message };
  let sent = 0, failed = 0;
  for (const o of (data || []) as OfferRow[]) {
    const body = offerBody(o);
    let waId: string | null = null;
    let err: string | null = null;
    try {
      waId = await sendButtons(o.wa_phone, body, [
        { id: `scoord:y:${o.meeting_id}`, title: OFFER_YES },
        { id: `scoord:n:${o.meeting_id}`, title: OFFER_NO },
      ]);
    } catch (e) {
      err = String((e as Error)?.message || e);
      console.error("showing coord offer failed", o.meeting_id, err);
    }
    await supabase.from("whatsapp_messages").insert({
      wa_message_id: waId,
      direction: "out",
      wa_phone: o.wa_phone,
      agent_id: o.agent_id,
      msg_type: "interactive",
      body: formatForWhatsapp(`${body} [${OFFER_YES} | ${OFFER_NO}]`).slice(0, 2000),
      status: waId ? "sent" : null,
      error: err,
    });
    if (!waId) {
      await supabase.from("client_showcase_meetings").update({ coord_offer: "failed" }).eq("id", o.meeting_id);
      failed++;
    } else sent++;
  }
  return { offered: sent, offer_failed: failed };
}

/**
 * תזכורת אחת למי שלא ענה/תה - באמצע הדרך לסיור, 08:00-21:00 (הבחירה
 * ב-showing_coord_nudge_claim). הסיכום לסוכן/ת לפני הסיור אינו כאן: הוא
 * התראה רגילה, ונכתב במסד (showing_coord_briefs).
 */
async function sendNudges(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("showing_coord_nudge_claim", { p_limit: 30 });
  if (error) return { nudge_error: error.message };
  const counts: Record<string, number> = {};
  let alerted = 0;
  for (const r of (data || []) as ClaimRow[]) {
    const st = await sendOne(supabase, r, true);
    counts[st] = (counts[st] || 0) + 1;
    if (st !== "sent" && await alertNudgeFailed(supabase, r, st)) alerted++;
  }
  if (alerted) await kickNotificationPush();
  return { nudged: counts, nudge_alerts: alerted };
}

const NUDGE_FAIL_REASON: Record<string, string> = {
  no_phone: "אין לו/ה טלפון",
  no_channel: "עברו יותר מ-24 שעות מאז שכתב/ה לנו, ואין לנו תבנית מאושרת לשלוח מחוץ לחלון",
  failed: "השליחה נכשלה",
  opted_out: "חסם/ה הודעות מהעסק",
};

/**
 * ‏**תזכורת שלא יצאה - הסוכן/ת יודע/ת** (27.10.2026). ‏nudged_at נכתב ב-claim
 * לפני השליחה, ולכן תזכורת שלא יצאה נראתה בדיוק כמו תזכורת שיצאה: ב-24.10
 * שתי תזכורות לסיור של 27.10 "נשלחו" בלי הודעה אחת, ואיש לא ידע שהבעלים
 * ומתווך השת"פ לא שמעו שוב. התראה לסוכן/ת עם הטלפון, כדי להתקשר.
 */
async function alertNudgeFailed(supabase: SupabaseClient, r: ClaimRow, status: string): Promise<boolean> {
  // שאילתות נפרדות ולא embed: אין מפתח זר בין הטבלאות, ו-embed היה נופל
  const { data: q } = await supabase.from("showing_coord_requests")
    .select("meeting_id").eq("id", r.request_id).maybeSingle();
  const { data: meeting } = q?.meeting_id
    ? await supabase.from("client_showcase_meetings")
      .select("agenda_item_id, showcase_id").eq("id", q.meeting_id).maybeSingle()
    : { data: null };
  const { data: showcase } = meeting?.showcase_id
    ? await supabase.from("client_showcases").select("client_id").eq("id", meeting.showcase_id).maybeSingle()
    : { data: null };
  const who = (r.target_name || "").trim() || (r.target === "agent" ? "המתווך/ת" : "הבעלים");
  const where = r.property_line ? ` (${r.property_line})` : "";
  const title = `⚠️ לא הצלחתי להזכיר ל${who}${where} על הסיור ${dayText(r.window_start)} ב-${ilTime(new Date(r.window_start))}`;
  const phone = (r.target_phone || "").trim();
  const body = `${NUDGE_FAIL_REASON[status] || "התזכורת לא יצאה"}. הבקשה המקורית עוד לא נענתה` +
    (phone ? ` - כדאי להתקשר: ${phone}` : " - כדאי ליצור קשר ישירות") + ".";
  const { error } = await supabase.from("notifications").insert({
    agent_id: r.agent_id,
    type: "agenda_reminder",
    title: title.slice(0, 200),
    body: body.slice(0, 400),
    related_client_id: showcase?.client_id ?? null,
    related_agenda_item_id: meeting?.agenda_item_id ?? null,
  });
  if (error) console.error("nudge failed alert insert failed", error);
  return !error;
}

/** סבב ה-cron: הצעות לסוכנים, הבקשות שממתינות, והתזכורות. */
export async function runShowingCoord(supabase: SupabaseClient) {
  const offers = await sendOffers(supabase);
  const sends = await sendPendingCoord(supabase);
  const counts: Record<string, number> = {};
  for (const r of sends.results) counts[r.status] = (counts[r.status] || 0) + 1;
  const nudges = await sendNudges(supabase);
  return { ...offers, sent: counts, ...nudges, ...(sends.error ? { error: sends.error } : {}) };
}

const STATUS_TEXT: Record<string, string> = {
  sent: "נשלח",
  no_phone: "אין טלפון",
  no_channel: "לא נשלח - אין ערוץ (התבנית עוד לא אושרה)",
  failed: "השליחה נכשלה",
  opted_out: "חסם/ה הודעות מהעסק",
};

/**
 * הסוכן/ת לחץ/ה על כפתור בהצעה. ‏null - זה לא כפתור של ההצעה. אחרת - תשובה
 * קבועה, בלי מודל: "כן" יוצר את הבקשות ושולח אותן מיד, ומסכם מה יצא.
 */
export async function coordOfferButtonReply(
  supabase: SupabaseClient,
  agentId: string,
  buttonId: string,
): Promise<string | null> {
  const m = OFFER_RE.exec(buttonId || "");
  if (!m) return null;
  const [, answer, meetingId] = m;

  if (answer === "n") {
    // רק סיור של הסוכן/ת שלחץ/ה
    const { data: own } = await supabase.from("client_showcase_meetings")
      .select("id, client_showcases!inner(agent_id)").eq("id", meetingId)
      .eq("client_showcases.agent_id", agentId).maybeSingle();
    if (own) await supabase.from("client_showcase_meetings").update({ coord_offer: "no" }).eq("id", meetingId);
    return "בסדר, לא שלחתי. אם תרצה/י אחר כך - יש כפתור \"📨 תיאום עם הבעלים והמתווכים\" ליד בקשת הסיור בפאנל המיניסייט של הלקוח/ה.";
  }

  const { data: start, error } = await supabase.rpc("agent_showing_coord_start", {
    p_agent_id: agentId,
    p_meeting_id: meetingId,
  });
  if (error) {
    console.error("showing coord start failed", error);
    return "משהו השתבש אצלי כרגע. אפשר לנסות שוב בעוד רגע, או מהפאנל של המיניסייט ב-CRM.";
  }
  const res = (start || {}) as Record<string, unknown>;
  if (res.error === "not_found") return "לא מצאתי את בקשת הסיור הזו אצלך.";
  if (res.error === "meeting_closed") return "בקשת הסיור הזו כבר בוטלה או נדחתה, אז לא שלחתי כלום.";
  if (res.error === "too_late") return "הסיור מתחיל בעוד פחות מרבע שעה - עדיף להתקשר ישירות.";
  if (res.error === "tier_required") return "תיאום ביקורים זמין במסלולים PROFESSIONAL ו-Elite.";
  if (res.error) return "לא הצלחתי לפתוח את הבקשות. אפשר לנסות מהפאנל של המיניסייט ב-CRM.";

  const { results } = await sendPendingCoord(supabase, meetingId);
  const { data: rows } = await supabase.from("showing_coord_requests")
    .select("target_name, target_phone, status, property_id, properties(street, house_number, city)")
    .eq("meeting_id", meetingId);

  const lines = (rows || []).map((r: Record<string, any>) => {
    const p = Array.isArray(r.properties) ? r.properties[0] : r.properties;
    const where = [[p?.street, p?.house_number].filter(Boolean).join(" "), p?.city].filter(Boolean).join(", ");
    const st = STATUS_TEXT[r.status] || (r.status === "pending" || r.status === "sending" ? "בשליחה" : r.status);
    return `• ${r.target_name || "ללא שם"} - ${where || "נכס"}: ${st}`;
  });
  const missed = (rows || []).filter((r: Record<string, any>) => ["no_phone", "no_channel", "failed", "opted_out"].includes(r.status));
  const sentNow = results.filter((r) => r.status === "sent").length;
  return [
    sentNow ? `שלחתי ${sentNow === 1 ? "בקשת תיאום אחת" : `${sentNow} בקשות תיאום`} 📨` : "לא יצאה אף בקשה חדשה.",
    ...lines,
    missed.length
      ? "\nלמי שלא קיבל/ה - בפאנל המיניסייט ב-CRM יש לכל אחד/ת כפתור וואטסאפ עם אותו נוסח, לשליחה ממך."
      : "",
    "אעדכן אותך על כל תשובה, ושעתיים לפני הסיור אשלח סיכום מי אישר/ה ומי לא.",
  ].filter(Boolean).join("\n");
}

/**
 * הבעלים / המתווך/ת לחץ/ה כפתור. מחזירה את הנוסח לתשובה - בלשון נקבה, כי
 * מי שעונה מהמספר הזה היא גבריאלה.
 */
export async function respondToCoord(supabase: SupabaseClient, token: string, answer: CoordAnswer): Promise<string> {
  const { data, error } = await supabase.rpc("showing_coord_respond", { p_token: token, p_answer: answer });
  if (error) {
    console.error("showing coord respond failed", error);
    return "משהו השתבש אצלי כרגע. אפשר לנסות שוב בעוד רגע.";
  }
  const res = (data || {}) as Record<string, unknown>;

  let agentName = "המתווך/ת";
  let contact = "";
  if (res.agent_id) {
    const { data: agent } = await supabase.from("agency_members")
      .select("display_name, phone").eq("id", String(res.agent_id)).maybeSingle();
    agentName = agent?.display_name || agentName;
    const phone = phoneE164(agent?.phone);
    if (phone) contact = ` אפשר גם לכתוב ישירות: https://wa.me/${phone}`;
  }

  if (res.error === "canceled") return `הביקור הזה כבר בוטל - אין צורך לעשות דבר. תודה! 🙏`;
  if (res.error === "past") return `מועד הביקור הזה כבר עבר. לכל שאלה אפשר לפנות ל${agentName}.${contact}`;
  if (res.error) return "לא מצאתי את בקשת הביקור הזו.";

  if (!res.already) await kickNotificationPush();
  const when = res.window_start
    ? `${dayText(String(res.window_start))} בסביבות ${windowText(String(res.window_start))}`
    : "";
  return answer === "confirmed"
    ? `תודה! עדכנתי את ${agentName} שהביקור מאושר 🙌${when ? ` נתראה ${when}.` : ""}`
    : answer === "postpone"
    ? `תודה, עדכנתי את ${agentName} שעדיף מעט מאוחר יותר, והוא/היא יחזור/תחזור אליך לתאם שעה.${contact}`
    : `תודה, עדכנתי את ${agentName} שהמועד לא מתאים, והוא/היא יחזור/תחזור אליך לתאם מועד אחר.${contact}`;
}
