// אישור ותזכורת לפגישה עם ליד מ"הלידים שלי", בלי כרטיס לקוח/ה.
// docs/meeting-client-followup.md, "ליד מ'הלידים שלי'".
//
// הכלל: טלפון של ליד משמש לשליחה רק כשהליד של הסוכן/ת הזה/זו ופתוח
// (status = 'unlocked'). ליד נעול מוסתר ב-leads_masked, ושליחה אליו עוקפת את
// הנעילה. אותה בדיקה יושבת גם במסד (agent_agenda_contact), כך שגם פריט שנכתב
// מ-CRM או מהבוט בלי הבדיקה הזו לא ישלח לליד נעול.
//
// בקובץ נפרד מ-agent.ts כדי שהבדיקה תרוץ בלי לטעון את כל העוזרת.

import { phoneE164 } from "../_shared/projects.ts";

export type OwnLead = {
  id: string;
  raw_name: string | null;
  raw_phone: string | null;
  status: string;
};

export type FollowupPlan = { notify: boolean; note?: string };

// deno-lint-ignore no-explicit-any
export type LeadSb = { from: (table: string) => any };

/**
 * האם `meeting-client` ישלח למספר הזה. אותה נורמליזציה של השולח (phoneE164), כדי
 * שהבוט לא יגיד "נשלח" על מספר שהשולח ידחה כ-no_phone.
 */
function sendable(value: unknown): boolean {
  return phoneE164(typeof value === "string" ? value : null) !== null;
}

/**
 * מספר שהסוכן/ת אמר/ה: ספרות ומפרידים בלבד. "050-123-4567 או 052-111-2222" ו"בית 12, 050123456"
 * יש בהם מספיק ספרות, ולכן הבדיקה לבדה אינה מספיקה.
 */
function dictatedPhoneOk(value: string): boolean {
  return /^[\d\s\-+().]+$/.test(value) && sendable(value);
}

/** הליד של הסוכן/ת הזה/זו בלבד. ליד של אחר/ת, או שאינו קיים - null. */
export async function fetchOwnLead(sb: LeadSb, agentId: string, leadId: string): Promise<OwnLead | null> {
  if (!leadId) return null;
  const { data } = await sb.from("leads")
    .select("id, raw_name, raw_phone, status")
    .eq("id", leadId).eq("agent_id", agentId).maybeSingle();
  return (data as OwnLead | null) || null;
}

/**
 * האם לשלוח לליד אישור ותזכורת, ומה לומר על זה לסוכן/ת.
 * `phoneInput` הוא מספר שהסוכן/ת אמר/ה עכשיו לליד שאין לו טלפון. הוא נשמר על
 * הליד של הסוכן/ת עצמו/ה. אסור לנחש מספר, ואסור לשמור מספר שאינו תקין.
 */
export async function leadFollowupPlan(
  sb: LeadSb,
  agentId: string,
  lead: OwnLead | null,
  phoneInput: unknown,
): Promise<FollowupPlan> {
  if (!lead) {
    return {
      notify: false,
      note: "הליד לא נמצא ב\"הלידים שלי\" של הסוכן/ת, ולכן לא יישלחו אישור ותזכורת. " +
        "לחפש אותו ב-list_leads ולא להמציא מזהה.",
    };
  }
  // ליד נעול: בלי שם. ‏list_leads קורא מ-leads_masked בדיוק כדי שהשם המלא לא יגיע לצ'אט.
  if (lead.status !== "unlocked") {
    return {
      notify: false,
      note: "הליד עוד נעול ב\"הלידים שלי\", ואין לי גישה לשם ולטלפון שלו/ה, ולכן לא יישלחו אישור ותזכורת. " +
        "אחרי שהליד נפתח אפשר agenda_update עם notify_client.",
    };
  }
  const name = String(lead.raw_name || "").trim() || "הליד";

  let ok = sendable(lead.raw_phone);
  const given = String(phoneInput ?? "").trim();
  if (!ok && given) {
    if (!dictatedPhoneOk(given)) {
      return {
        notify: false,
        note: "המספר שנמסר אינו מספר טלפון תקין, ולכן לא יישלחו אישור ותזכורת. " +
          "לבקש מהסוכן/ת מספר מלא. לא לנחש ספרות.",
      };
    }
    const { error } = await sb.from("leads")
      .update({ raw_phone: given.slice(0, 40) })
      .eq("id", lead.id).eq("agent_id", agentId).eq("status", "unlocked");
    if (error) {
      return {
        notify: false,
        note: "לא הצלחתי לשמור את המספר בליד, ולכן לא יישלחו אישור ותזכורת. אפשר לנסות שוב.",
      };
    }
    ok = true;
  }

  if (!ok) {
    return {
      notify: false,
      note: `ל${name} אין טלפון ב"הלידים שלי", ולכן לא יישלחו אישור ותזכורת. ` +
        "לשאול את הסוכן/ת מה המספר שלו/ה. לא לנחש. אחרי שנאמר, לקרוא שוב עם lead_phone והמספר.",
    };
  }
  return { notify: true };
}
