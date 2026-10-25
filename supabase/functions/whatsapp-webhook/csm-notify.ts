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
import { formatForWhatsapp, notifyTemplateConfigured, sendAudio, sendNotifyTemplate, sendText } from "./whatsapp.ts";
import { callAnalysisText, type CallAnalysis } from "../_shared/csm-call-format.ts";
import { callFollowupHint, kindTipLine } from "./csm-tips.ts";
import { csmMentorTip } from "../_shared/coach/csm.ts";

const SITE_BASE = (Deno.env.get("SITE_BASE_URL") || "https://shuknadlan.co.il").replace(/\/+$/, "");
const HISTORY_KEEP = 16;
// ‏WhatsApp מקבל קובץ שמע עד 16MB; מעל זה - הקישור לאזור בלבד
const WA_AUDIO_MAX_BYTES = 16 * 1024 * 1024;

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

export function csmNotifyText(n: Pick<Claimed, "title" | "body" | "kind">): string {
  const tip = kindTipLine(n.kind);
  return [`*${n.title}*`, n.body || "", tip ? "\n" + tip : "", "", `באזור ההטמעה: ${SITE_BASE}/csm?tab=notifications`]
    .filter((l, i) => (i !== 1 && i !== 2) || l).join("\n");
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

/* הקלטה שהסתיימה: בתוך החלון - הסיכום המלא (callAnalysisText) במקום השורה
   הקצרה, וההקלטה עצמה אחריו. מהמספר הווירטואלי שלה זה כל העניין: הסיכום
   וההקלטה מגיעים אליה בלי לפתוח את האזור. */
async function callExtras(supabase: SupabaseClient, notificationId: string) {
  const { data: n } = await supabase.from("csm_notifications").select("call_id").eq("id", notificationId).maybeSingle();
  if (!n?.call_id) return null;
  const { data: call } = await supabase.from("csm_calls")
    .select("id, title, status, analysis, audio_path, agent_id").eq("id", n.call_id).maybeSingle();
  const draft = (call?.analysis as CallAnalysis | null)?.message_draft;
  if (!call || call.status !== "done" || !call.analysis) return null;
  let agentName: string | null = null;
  if (call.agent_id) {
    const { data: a } = await supabase.from("agency_members").select("display_name").eq("id", call.agent_id).maybeSingle();
    agentName = a?.display_name ?? null;
  }
  let audioUrl: string | null = null;
  if (call.audio_path) {
    const dir = call.audio_path.split("/").slice(0, -1).join("/");
    const name = call.audio_path.split("/").pop();
    const { data: info } = await supabase.storage.from("csm-calls").list(dir, { search: name });
    const size = Number(info?.[0]?.metadata?.size || 0);
    if (size && size <= WA_AUDIO_MAX_BYTES) {
      const { data: signed } = await supabase.storage.from("csm-calls").createSignedUrl(call.audio_path, 60 * 60);
      audioUrl = signed?.signedUrl ?? null;
    }
  }
  return {
    callId: call.id as string,
    text: [callAnalysisText(call.analysis as CallAnalysis, agentName), "",
      // ‏"שלחי לו" מגיע ל-csm_send_to_agent עם call_id (ה-call_id בהיסטוריה, למטה)
      ...(call.agent_id && draft ? [callFollowupHint(agentName), ""] : []),
      kindTipLine("call_ready"), "",
      `ההקלטה והתמלול באזור ההטמעה: ${SITE_BASE}/csm?tab=calls`].join("\n"),
    audioUrl,
  };
}

export async function runCsmNotify(supabase: SupabaseClient): Promise<{ sent: number; failed: number }> {
  const { data, error } = await supabase.rpc("csm_notify_wa_claim", { p_limit: 20 });
  if (error) throw new Error(error.message);
  let sent = 0, failed = 0;
  for (const n of (data ?? []) as Claimed[]) {
    const extras = n.kind === "call_ready" && n.in_window ? await callExtras(supabase, n.id).catch(() => null) : null;
    const text = extras?.text || csmNotifyText(n);
    let waId: string | null = null;
    let err: string | null = null;
    try {
      if (!n.phone_e164) throw new Error("no_phone");
      if (n.in_window) {
        waId = await sendText(n.phone_e164, formatForWhatsapp(text));
        if (extras?.audioUrl) {
          // ההקלטה אחרי הסיכום. כשל כאן אינו כשל של ההתראה - הסיכום כבר יצא
          await sendAudio(n.phone_e164, extras.audioUrl).catch((e) => console.warn("csm audio send failed", String(e)));
        }
      } else if (notifyTemplateConfigured()) {
        const first = String(n.display_name || "").trim().split(/\s+/)[0] || "שלום";
        waId = await sendNotifyTemplate(n.phone_e164, first, `${n.title} · ${n.body || ""}`,
          n.kind === "call_ready" ? "/csm?tab=calls" : "/csm?tab=notifications");
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
    // ‏call_id בהיסטוריה: "תעדכני את השלב" אחרי הסיכום מגיע ל-csm_link_call
    await appendToHistory(supabase, n.staff_id, text + (extras?.callId ? `\ncall_id=${extras.callId}` : "")).catch((e) => console.error("csm notify history", e));
  }
  return { sent, failed };
}

/* העצה היומית מהמנטור: ‏whatsapp-webhook?task=csm-mentor-tips (cron כל 10 דקות,
   רק כש-csm_mentor_tip_ready). התפיסה מסמנת last_tip_on לפני המודל - כשל של
   המודל מוותר על העצה של היום ולא מנסה שוב כל 10 דקות. ההתראה עוברת לפעמון
   ולוואטסאפ כמו כל השאר (csm-notify, הדקה הבאה). */
export async function runCsmMentorTips(supabase: SupabaseClient): Promise<{ tips: number }> {
  const { data, error } = await supabase.rpc("csm_mentor_tip_claim");
  if (error) throw new Error(error.message);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  let tips = 0;
  for (const s of (data ?? []) as Array<{ staff_id: string }>) {
    const tip = await csmMentorTip(supabase, s.staff_id).catch((e) => { console.error("csm tip", e); return null; });
    if (!tip) continue;
    const { error: nErr } = await supabase.rpc("_csm_notify", {
      p_staff: s.staff_id, p_kind: "mentor_tip", p_title: "עצה מהמנטור להיום", p_body: tip.slice(0, 2500),
      p_agent: null, p_call: null, p_event: null, p_dedupe: "tip:" + day,
    });
    if (nErr) console.error("csm tip notify failed", nErr.message);
    else tips++;
  }
  return { tips };
}
