// אישור ותזכורת לפגישה עם ליד מ"הלידים שלי", בלי כרטיס לקוח/ה.
// docs/meeting-client-followup.md, "ליד מ'הלידים שלי'".
//
// הכלל: טלפון של ליד משמש לשליחה רק כשהליד של הסוכן/ת הזה/זו ופתוח
// (status = 'unlocked'). ליד נעול מוסתר ב-leads_masked, ושליחה אליו עוקפת את
// הנעילה. אותה בדיקה יושבת גם במסד (agent_agenda_contact), כך שגם פריט שנכתב
// מ-CRM או מהבוט בלי הבדיקה הזו לא ישלח לליד נעול.
//
// בקובץ נפרד מ-agent.ts כדי שהבדיקה תרוץ בלי לטעון את כל העוזרת.

export type OwnLead = {
  id: string;
  raw_name: string | null;
  raw_phone: string | null;
  status: string;
};

export type FollowupPlan = { notify: boolean; note?: string };

// deno-lint-ignore no-explicit-any
export type LeadSb = { from: (table: string) => any };

const MIN_PHONE_DIGITS = 9;

function digitsOf(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
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
  const name = String(lead.raw_name || "").trim() || "הליד";
  if (lead.status !== "unlocked") {
    return {
      notify: false,
      note: `${name} עוד נעול/ה ב"הלידים שלי", ואין לי גישה לטלפון שלו/ה, ולכן לא יישלחו אישור ותזכורת. ` +
        "אחרי שהליד נפתח אפשר agenda_update עם notify_client.",
    };
  }

  let digits = digitsOf(lead.raw_phone);
  const given = String(phoneInput ?? "").trim();
  if (digits.length < MIN_PHONE_DIGITS && given) {
    if (digitsOf(given).length < MIN_PHONE_DIGITS) {
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
    digits = digitsOf(given);
  }

  if (digits.length < MIN_PHONE_DIGITS) {
    return {
      notify: false,
      note: `ל${name} אין טלפון ב"הלידים שלי", ולכן לא יישלחו אישור ותזכורת. ` +
        "לשאול את הסוכן/ת מה המספר שלו/ה. לא לנחש. אחרי שנאמר, לקרוא שוב עם lead_phone והמספר.",
    };
  }
  return { notify: true };
}
