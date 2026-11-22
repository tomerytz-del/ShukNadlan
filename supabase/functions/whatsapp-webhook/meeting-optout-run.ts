// הצד של ההרצה: מסד, התראה לסוכן/ת ותשובה לנמען/ת. הטקסטים והזיהוי ב-meeting-optout.ts.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { kickNotificationPush, meetingWhenText } from "../_shared/meeting-client.ts";
import {
  agentStopNotification, meetingStopCustomerReply, stopNotificationCreatedAt, type StoppedItem,
} from "./meeting-optout.ts";

/**
 * "הסר" מנמען/ת של פולואפ פגישה. מחזירה true רק אם נעצרה לפחות פגישה אחת, כלומר
 * ההודעה הייתה תשובה להודעה שלנו. אחרת false וההודעה ממשיכה לבוט הרגיל.
 */
export async function stopMeetingFollowups(
  supabase: SupabaseClient,
  from: string,
  reply: (text: string) => Promise<void>,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("agent_agenda_client_stop", {
    p_phone: from, p_require_sent: true,
  });
  if (error) {
    console.error("meeting stop failed", error.message);
    return false;
  }
  const items = (data || []) as StoppedItem[];
  if (!items.length) return false;

  // כמה זמן התראת agenda_reminder נחשבת "טרייה" ועוקפת שקט (ברירת מחדל 30). כשל בקריאה אינו מונע את ההתראה.
  const { data: cfg } = await supabase.from("pricing_config").select("value")
    .eq("key", "notif_push_urgent_fresh_minutes").maybeSingle();
  const freshMinutes = Number.parseInt(String(cfg?.value ?? ""), 10) || 30;
  const now = new Date();

  // התראה אחת לכל פגישה שנעצרה, בקריאה אחת. suppress_push מפורש: הסוכן/ת צריך/ה לשמוע על
  // זה גם כשהוא/היא לא מסתכל/ת. עקיפת השקט רק לפגישה ב-12 השעות הקרובות (created_at).
  const { error: insErr } = await supabase.from("notifications").insert(items.map((item) => {
    const note = agentStopNotification(item, item.due_at ? meetingWhenText(item.due_at) : "");
    return {
      agent_id: item.agent_id,
      type: "agenda_reminder",
      title: note.title,
      body: note.body,
      related_agenda_item_id: item.item_id,
      suppress_push: false,
      created_at: stopNotificationCreatedAt(item.due_at, now, freshMinutes),
    };
  }));
  if (insErr) console.error("meeting stop notification failed", insErr.message);
  await kickNotificationPush();
  await reply(meetingStopCustomerReply(items.length));
  return true;
}
