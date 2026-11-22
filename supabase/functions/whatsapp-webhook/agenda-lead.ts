// אישור ותזכורת לפגישה עם ליד מ"הלידים שלי", בלי כרטיס לקוח/ה.
// docs/meeting-client-followup.md, "ליד מ'הלידים שלי'".
//
// הכלל: טלפון של ליד משמש לשליחה רק כשהליד של הסוכן/ת הזה/זו ופתוח
// (status = 'unlocked'). ליד נעול מוסתר ב-leads_masked, ושליחה אליו עוקפת את
// הנעילה. אותה בדיקה יושבת גם במסד (agent_agenda_contact), כך שגם פריט שנכתב
// מ-CRM או מהבוט בלי הבדיקה הזו לא ישלח לליד נעול.
//
// בקובץ נפרד מ-agent.ts כדי שהבדיקה תרוץ בלי לטעון את כל העוזרת.

import { clientPhoneE164 } from "../_shared/phone-il.ts";

export type OwnLead = {
  id: string;
  raw_name: string | null;
  raw_phone: string | null;
  status: string;
};

/**
 * `phoneToSave`: מספר שהסוכן/ת אמר/ה, שעבר אימות ועוד לא נשמר. הקורא שומר אותו
 * (saveLeadPhone) **רק אחרי** שהפגישה נשמרה ביומן, כדי שכשל בשמירת הפגישה לא ישאיר
 * מספר שהסוכן/ת לא ראה/תה נכנס לליד.
 */
export type FollowupPlan = { notify: boolean; note?: string; phoneToSave?: string };

// deno-lint-ignore no-explicit-any
export type LeadSb = { from: (table: string) => any };

/**
 * האם `meeting-client` ישלח למספר הזה. אותה נורמליזציה של השולח (clientPhoneE164, כמו במסד), כדי
 * שהבוט לא יגיד "נשלח" על מספר שהשולח ידחה כ-no_phone.
 */
function sendable(value: unknown): boolean {
  return clientPhoneE164(value) !== null;
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
 * `phoneInput` הוא מספר שהסוכן/ת אמר/ה עכשיו לליד שאין לו טלפון. התוכנית אינה כותבת: היא
 * מחזירה `phoneToSave`, והקורא שומר אחרי שהפגישה נשמרה. אסור לנחש מספר, ואסור לשמור
 * מספר שאינו תקין.
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
  let phoneToSave: string | undefined;
  const given = String(phoneInput ?? "").trim();
  if (!ok && given) {
    if (!dictatedPhoneOk(given)) {
      return {
        notify: false,
        note: "המספר שנמסר אינו מספר טלפון תקין, ולכן לא יישלחו אישור ותזכורת. " +
          "לבקש מהסוכן/ת מספר מלא. לא לנחש ספרות.",
      };
    }
    phoneToSave = given.slice(0, 40);
    ok = true;
  }

  if (!ok) {
    return {
      notify: false,
      note: `ל${name} אין טלפון ב"הלידים שלי", ולכן לא יישלחו אישור ותזכורת. ` +
        "לשאול את הסוכן/ת מה המספר שלו/ה. לא לנחש. אחרי שנאמר, לקרוא שוב עם lead_phone והמספר.",
    };
  }
  return phoneToSave ? { notify: true, phoneToSave } : { notify: true };
}

/**
 * שומר את המספר על הליד של הסוכן/ת (רק ליד פתוח). מחזירה false בכשל, והקורא מבטל את
 * השליחה ואומר לסוכן/ת.
 */
export async function saveLeadPhone(sb: LeadSb, agentId: string, leadId: string, phone: string): Promise<boolean> {
  const { error } = await sb.from("leads")
    .update({ raw_phone: phone })
    .eq("id", leadId).eq("agent_id", agentId).eq("status", "unlocked");
  return !error;
}

/** הנוסח לסוכן/ת כשהמספר חסום. */
export const NUMBER_BLOCKED_NOTE =
  "המספר הזה ביקש לא לקבל הודעות מהעסק, ולכן לא יישלחו אישור ותזכורת על הפגישה. " +
  "הוא יקבל הודעות שוב רק אחרי שיכתוב לנו בעצמו. כדאי לתאם איתו ישירות.";

/** האם המספר ב-whatsapp_optouts (קיבל 131050). כשל בקריאה אינו חוסם: הסבב במסד חוסם ממילא. */
export async function isNumberBlocked(sb: LeadSb, phone: unknown): Promise<boolean> {
  const e164 = clientPhoneE164(phone);
  if (!e164) return false;
  const { data } = await sb.from("whatsapp_optouts").select("phone_e164").eq("phone_e164", e164).maybeSingle();
  return !!data;
}
