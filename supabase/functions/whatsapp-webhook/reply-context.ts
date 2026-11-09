// טוען את ההקשר שהמודל לא ראה: תשובה להודעה, והתראות שיצאו בשעתיים האחרונות.
// עמודה או טבלה שחסרה (הפונקציה עלתה לפני המיגרציה) - בלי הקשר, לא בלי תשובה.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { ilShort, inboundReplyId, recentPushesNote, replyPrefix } from "./wa-reply-context.ts";

export async function rememberReplyTo(
  supabase: SupabaseClient,
  waMessageId: string,
  msg: { context?: { id?: string; forwarded?: boolean; frequently_forwarded?: boolean } | null },
): Promise<void> {
  const replyTo = inboundReplyId(msg);
  if (!replyTo || !waMessageId) return;
  const { error } = await supabase.from("whatsapp_messages")
    .update({ reply_to_wa_id: replyTo })
    .eq("wa_message_id", waMessageId);
  if (error && !String(error.message || "").includes("reply_to_wa_id")) {
    console.error("reply context save failed", error.message);
  }
}

export async function loadReplyPrefix(
  supabase: SupabaseClient,
  agentId: string,
  msg: { context?: { id?: string; forwarded?: boolean; frequently_forwarded?: boolean } | null },
): Promise<string> {
  const id = inboundReplyId(msg);
  if (!id) return "";
  try {
    const { data: log } = await supabase.from("notification_push_log")
      .select("notification_ids")
      .eq("agent_id", agentId)
      .eq("wa_message_id", id)
      .limit(1)
      .maybeSingle();
    const ids = (log?.notification_ids as string[] | undefined) || [];
    if (ids.length) {
      const { data: notes } = await supabase.from("notifications")
        .select("title, body")
        .eq("agent_id", agentId)
        .in("id", ids.slice(0, 8));
      const first = (notes || [])[0] as { title?: string; body?: string } | undefined;
      const prefix = replyPrefix(first || null);
      if (prefix) return prefix;
    }
    const { data: prior } = await supabase.from("whatsapp_messages")
      .select("body")
      .eq("wa_message_id", id)
      .eq("agent_id", agentId)
      .limit(1)
      .maybeSingle();
    return replyPrefix(prior?.body ? { title: String(prior.body).slice(0, 400) } : null);
  } catch (err) {
    console.error("reply lookup failed", err);
    return "";
  }
}

export async function loadRecentPushesNote(
  supabase: SupabaseClient,
  agentId: string,
): Promise<string> {
  const since = new Date(Date.now() - 2 * 3600_000).toISOString();
  try {
    const { data, error } = await supabase.from("notification_push_log")
      .select("notification_ids, created_at")
      .eq("agent_id", agentId)
      .eq("whatsapp_status", "sent")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(8);
    if (error || !data?.length) return "";
    const ids = data.flatMap((r) => (r.notification_ids as string[]) || []).slice(0, 24);
    if (!ids.length) return "";
    const { data: notes } = await supabase.from("notifications")
      .select("id, title, body")
      .eq("agent_id", agentId)
      .in("id", ids);
    const byId = new Map((notes || []).map((n) => [String(n.id), n]));
    const items: { at: string; text: string }[] = [];
    for (const row of data) {
      const at = ilShort(String(row.created_at));
      for (const nid of (row.notification_ids as string[]) || []) {
        const n = byId.get(String(nid));
        if (!n) continue;
        items.push({ at, text: [n.title, n.body].filter(Boolean).join(" - ") });
      }
    }
    return recentPushesNote(items);
  } catch (err) {
    console.error("recent pushes failed", err);
    return "";
  }
}
