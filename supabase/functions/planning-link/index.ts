// ============================================================================
// planning-link - דף הבדיקה התכנונית (/plan?k=) מול המסד
//
// גבריאלה לא יכולה לשאול את GovMap מהשרת (מפ"י: צד לקוח בלבד), ולכן היא
// שולחת קישור לדף קטן שעושה את זה בדפדפן של הסוכן/ת. הפונקציה הזו:
//
//   open      - הכתובת של הקישור (‏planning_link_open). קישור לא תקין / שפג -> 404.
//   complete  - התוצאה מהדפדפן: נשמרת במטמון של גבריאלה (‏planning_link_complete
//               -> _govmap_address_store) ונשלחת לסוכן/ת בוואטסאפ.
//
// **ההרשאה היא הקישור:** 32 תווים אקראיים, 7 ימים, ותוצאה אחת. בלי חשבון -
// אחרת חזרנו להתחברות, וזו כל הסיבה לדף. ‏docs/govmap.md, "דף הבדיקה".
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { noLongDash } from "../_shared/marketing-copy.ts";
import { summarize, targetLabel, whatsappMessage } from "./summary.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE = (Deno.env.get("SITE_BASE_URL") || "https://shuknadlan.co.il").replace(/\/$/, "");
const WA_TOKEN = Deno.env.get("WHATSAPP_TOKEN") || "";
const WA_PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || "";
const GRAPH_VERSION = Deno.env.get("WHATSAPP_GRAPH_VERSION") || "v23.0";

const TOKEN_RE = /^[0-9a-f]{32}$/;
const MAX_BODY = 60_000;

function cors() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: cors() });
}
const gone = () =>
  json({ error: "not_found", message: "הקישור פג תוקף או שכבר אינו תקין. בקש/י מגבריאלה קישור חדש." }, 404);

/** ‏null = נשלח. אחרת - למה לא (נשמר ב-notify_error). */
async function sendWhatsapp(to: string, body: string): Promise<{ id: string | null; error: string | null }> {
  if (!WA_TOKEN || !WA_PHONE_ID) return { id: null, error: "whatsapp not configured" };
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${WA_PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp", recipient_type: "individual", to, type: "text",
      text: { preview_url: false, body: noLongDash(body).slice(0, 4000) },
    }),
  });
  const data = await res.json().catch(() => ({}));
  // ‏131047 = מחוץ לחלון 24 השעות: הסוכן/ת פתח/ה את הקישור אחרי יותר מיממה.
  // התוצאה כבר שמורה, והיא מוצגת בדף - ההודעה היא תוספת.
  if (!res.ok) return { id: null, error: `${res.status} ${JSON.stringify(data?.error ?? data).slice(0, 300)}` };
  return { id: data?.messages?.[0]?.id ?? null, error: null };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ error: "too_large" }, 413);
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return json({ error: "bad_json" }, 400); }

  const k = String(body.k || "");
  if (!TOKEN_RE.test(k)) return json({ error: "unauthorized" }, 401);
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  if (body.action === "open") {
    const { data, error } = await supabase.rpc("planning_link_open", { p_id: k });
    if (error) return json({ error: "server", message: "תקלה זמנית. נסה/י שוב בעוד רגע." }, 500);
    return data ? json({ link: data }) : gone();
  }

  if (body.action === "complete") {
    const summary = summarize(body.record);
    const { data, error } = await supabase.rpc("planning_link_complete", {
      p_id: k, p_record: summary ? body.record : null, p_result: summary,
    });
    if (error) {
      console.warn("planning-link complete:", error.message);
      // שדה שהמסד פסל (‏bad_gush וכו') - לא תקלה זמנית; הדף מציג את מה שמצא
      return json({ error: "rejected", message: "לא הצלחנו לשמור את התוצאה, אבל היא מוצגת כאן." }, 422);
    }
    if (!data) return gone();
    const row = data as Record<string, string>;
    let sent = false;
    if (row.phone) {
      const message = whatsappMessage(row, summary, `${SITE}/plan?k=${k}`);
      const res = await sendWhatsapp(row.phone, message);
      sent = !!res.id;
      // כל הודעה יוצאת נרשמת ביומן - מעקב מסירה (docs/whatsapp-setup.md)
      await supabase.from("whatsapp_messages").insert({
        wa_message_id: res.id, direction: "out", wa_phone: row.phone, agent_id: row.agent_id,
        msg_type: "text", body: noLongDash(message).slice(0, 2000), status: res.id ? "sent" : null,
        error: res.error,
      });
      await supabase.from("planning_links").update({
        notified_at: res.id ? new Date().toISOString() : null, notify_error: res.error,
      }).eq("id", k);
    }
    console.log("planning-link:", targetLabel(row), row.status, sent ? "sent" : "not sent");
    return json({ ok: true, status: row.status, sent });
  }

  return json({ error: "bad_action" }, 400);
});
