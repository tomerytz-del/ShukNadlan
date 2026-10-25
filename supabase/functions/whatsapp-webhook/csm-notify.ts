// ============================================================================
// csm-notify.ts — ההתראות של צוות ההטמעה בוואטסאפ (docs/csm-adoption.md, "התראות")
//
// ‏pg_cron (‏csm-notify, כל דקה) מריץ csm_notify_run() במסד ומעיר את
// ‏whatsapp-webhook?task=csm-notify רק כש-csm_notify_wa_ready(). כאן רק השליחה:
// מה לשלוח, למי, ומתי מותר - כבר הוחלט במסד (‏csm_notify_wa_claim: ערוץ
// דלוק, נייד, שעות השקט שלה).
//
// טקסט חופשי בתוך 24 השעות מההודעה האחרונה שלה (‏in_window, מ-
// ‏csm_whatsapp_conversations.last_inbound_at), ומחוץ להן - התבנית של
// ‏notification-push, עם כפתור ל-/csm. בלי תבנית מוגדרת - failed ביומן, ולא
// טקסט שייכשל אצל Meta.
//
// ההתראה נכנסת גם להיסטוריה של גבריאלה מולה, כדי ש"מי זו?" או "תזיזי אותה
// למחר" אחרי תזכורת יידעו על מה מדובר.
// ============================================================================
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { formatForWhatsapp, notifyTemplateConfigured, sendNotifyTemplate, sendText } from "./whatsapp.ts";

const SITE_BASE = (Deno.env.get("SITE_BASE_URL") || "https://shuknadlan.co.il").replace(/\/+$/, "");
const HISTORY_KEEP = 16;

type Claimed = {
  id: string;
  staff_id: string;
  phone_e164: string | null;
  display_name: string | null;
  kind: string;
  title: string;
  body: string | null;
  in_window: boolean;
};

type Msg = { role: "user" | "assistant"; content: string };

export function csmNotifyText(n: Pick<Claimed, "title" | "body">): string {
  return [`*${n.title}*`, n.body || "", "", `באזור ההטמעה: ${SITE_BASE}/csm?tab=notifications`]
    .filter((l, i) => i !== 1 || l).join("\n");
}

async function appendToHistory(supabase: SupabaseClient, staffId: string, text: string) {
  const { data } = await supabase.from("csm_whatsapp_conversations").select("history").eq("staff_id", staffId).maybeSingle();
  const history = Array.isArray(data?.history) ? (data!.history as Msg[]) : [];
  if (!history.length) return; // היסטוריה מתחילה תמיד בהודעה שלה; בלעדיה אין לאן לצרף
  const last = history[history.length - 1];
  const note = `[התראה שנשלחה: ${text}]`;
  const next = last.role === "assistant"
    ? [...history.slice(0, -1), { role: "assistant" as const, content: last.content + "\n\n" + note }]
    : [...history, { role: "assistant" as const, content: note }];
  await supabase.from("csm_whatsapp_conversations")
    .update({ history: next.slice(-HISTORY_KEEP), updated_at: new Date().toISOString() }).eq("staff_id", staffId);
}

export async function runCsmNotify(supabase: SupabaseClient): Promise<{ sent: number; failed: number }> {
  const { data, error } = await supabase.rpc("csm_notify_wa_claim", { p_limit: 20 });
  if (error) throw new Error(error.message);
  let sent = 0, failed = 0;
  for (const n of (data ?? []) as Claimed[]) {
    const text = csmNotifyText(n);
    let waId: string | null = null;
    let err: string | null = null;
    try {
      if (!n.phone_e164) throw new Error("no_phone");
      if (n.in_window) {
        waId = await sendText(n.phone_e164, formatForWhatsapp(text));
      } else if (notifyTemplateConfigured()) {
        const first = String(n.display_name || "").trim().split(/\s+/)[0] || "שלום";
        waId = await sendNotifyTemplate(n.phone_e164, first, `${n.title} · ${n.body || ""}`, "/csm?tab=notifications");
      } else {
        throw new Error("outside_window_no_template");
      }
    } catch (e) {
      err = String((e as Error)?.message || e).slice(0, 500);
    }
    await supabase.rpc("csm_notify_wa_mark", { p_id: n.id, p_ok: !err, p_error: err });
    await supabase.from("whatsapp_messages").insert({
      wa_message_id: waId, direction: "out", wa_phone: n.phone_e164, agent_id: null,
      msg_type: n.in_window ? "text" : "template", body: formatForWhatsapp(text),
      status: waId ? "sent" : null, error: err,
    });
    if (err) {
      failed++;
      console.error("csm notify failed", n.id, err);
      continue;
    }
    sent++;
    await appendToHistory(supabase, n.staff_id, text).catch((e) => console.error("csm notify history", e));
  }
  return { sent, failed };
}
