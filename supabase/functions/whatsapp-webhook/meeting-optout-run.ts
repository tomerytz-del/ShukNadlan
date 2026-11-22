// הצד של ההרצה: מסד, התראה לסוכן/ת ותשובה לנמען/ת. הטקסטים והזיהוי ב-meeting-optout.ts.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { kickNotificationPush, meetingWhenText } from "../_shared/meeting-client.ts";
import { agentStopNotification, MEETING_STOP_CUSTOMER_REPLY, type StoppedItem } from "./meeting-optout.ts";

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

  // התראה אחת לכל פגישה שנעצרה, בקריאה אחת. suppress_push מפורש: הסוכן/ת צריך/ה לשמוע
  // על זה גם כשהוא/היא לא מסתכל/ת.
  const { error: insErr } = await supabase.from("notifications").insert(items.map((item) => {
    const note = agentStopNotification(item, item.due_at ? meetingWhenText(item.due_at) : "");
    return {
      agent_id: item.agent_id,
      type: "agenda_reminder",
      title: note.title,
      body: note.body,
      related_agenda_item_id: item.item_id,
      suppress_push: false,
    };
  }));
  if (insErr) console.error("meeting stop notification failed", insErr.message);
  await kickNotificationPush();
  await reply(MEETING_STOP_CUSTOMER_REPLY);
  return true;
}
