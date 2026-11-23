// עריכת ליד שכבר נשמר ב"הלידים שלי" (הכלי update_lead). docs/leads-unified.md, "עריכת ליד".
// בקובץ נפרד מ-agent.ts כדי שהבדיקה תרוץ ב-node. הכללים עצמם (רק ליד שהסוכן/ת הזין/ה,
// פתוח, ושלו/ה) נאכפים במסד, ב-agent_lead_update; כאן רק בניית הבקשה ותרגום התשובה.

/** השדות שאפשר לערוך. כל השאר נזרק, כדי שמודל לא יכתוב לעמודה אחרת. */
export const LEAD_EDITABLE_KEYS = [
  "full_name", "phone", "city", "deal_type", "property_type", "rooms", "notes", "details",
] as const;

export type LeadUpdatePayload = Record<string, string | number>;

/**
 * רק מפתחות שנשלחו. מחרוזת ריקה היא "לנקות את השדה" ונשמרת כמו שהיא (המסד מבדיל בין "לא נשלח"
 * ל"ריק"). ערך שאינו מחרוזת או מספר נזרק.
 */
export function buildLeadUpdatePayload(input: Record<string, unknown>): LeadUpdatePayload {
  const out: LeadUpdatePayload = {};
  for (const key of LEAD_EDITABLE_KEYS) {
    const v = input[key];
    if (typeof v === "string") out[key] = v;
    else if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
  }
  return out;
}

const FIELD_LABELS: Record<string, string> = {
  full_name: "שם", phone: "טלפון", city: "עיר", deal_type: "סוג עסקה", property_type: "סוג נכס",
  rooms: "חדרים", notes: "הערות", details: "פרטי הנכס",
};

export type LeadUpdateReply =
  | { ok: true; [k: string]: unknown }
  | { ok: false; error: string; guidance?: string };

/** תרגום תשובת agent_lead_update למה שהמודל מקבל. */
export function leadUpdateReply(data: unknown): LeadUpdateReply {
  const r = (data || {}) as Record<string, unknown>;
  if (r.success) {
    const changed = (Array.isArray(r.changed) ? r.changed : []).map((k) => FIELD_LABELS[String(k)] || String(k));
    return {
      ok: true,
      lead_id: r.lead_id,
      changed,
      guidance: "לאשר במשפט אחד מה השתנה. בלי להציג מזהה.",
    };
  }
  if (r.duplicate) {
    // ok: true, כמו ב-add_lead: זו תוצאה נכונה ולא כשל כלי
    return {
      ok: true,
      updated: false,
      duplicate: true,
      lead_id: r.lead_id,
      full_name: r.full_name,
      note: "הטלפון הזה כבר שייך לליד פתוח אחר של הסוכן/ת (בשם שחזר), ולכן לא שיניתי כלום. לומר זאת, " +
        "ולהציע לעדכן את הליד הקיים או לתקן את המספר.",
    };
  }
  switch (r.error) {
    case "lead_not_found":
      return { ok: false, error: "lead_not_found", guidance: "הליד לא נמצא ב\"הלידים שלי\" של הסוכן/ת. לחפש אותו ב-list_leads, ולא להמציא מזהה." };
    case "not_editable":
      return {
        ok: false, error: "not_editable",
        guidance: "אפשר לערוך רק ליד שהסוכן/ת הזין/ה בעצמו/ה. הפרטים של ליד שהגיע מהאתר, מהלוחות, מהחנות או משיחה " +
          "הם מה שהפונה מסר, ולכן לא נערכים. הערה ושלב אפשר בכרטיס הליד ב-CRM.",
      };
    case "locked":
      return { ok: false, error: "locked", guidance: "הליד עוד נעול, ואי אפשר לערוך אותו. אחרי שייפתח אפשר." };
    case "name_or_phone_required":
      return { ok: false, error: "name_or_phone_required", guidance: "אי אפשר לנקות גם את השם וגם את הטלפון: אחד מהם חייב להישאר." };
    case "bad_rooms":
      return { ok: false, error: "bad_rooms", guidance: "מספר החדרים חייב להיות בין 0.5 ל-50. לשאול את הסוכן/ת." };
    case "bad_deal_type":
      return { ok: false, error: "bad_deal_type", guidance: "סוג עסקה הוא sale (מכירה) או rent (השכרה) בלבד." };
    case "nothing_to_update":
      return { ok: false, error: "nothing_to_update", guidance: "לא נשלח שום שדה לעדכון. לשאול מה לשנות." };
    default:
      return { ok: false, error: "update_failed", guidance: "לא הצלחתי לעדכן את הליד. אפשר לנסות שוב." };
  }
}
