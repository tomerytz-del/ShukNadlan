// ============================================================================
// גבריאלה מציעה לסוכן/ת: לפתוח נכס חדש לשת"פ, ולהפיק סרטון לנכס שראוי לו.
//
// ‏pg_cron קורא ל-`whatsapp-webhook?task=property-offers` כל עשר דקות.
// ‏`property_offers_claim` (מיגרציה 20270321094000) בוחרת את הנכסים, רושמת
// את ההצעה **לפני** השליחה - כך שנפילה באמצע אינה שולחת פעמיים - ומחזירה מה
// לשלוח. כאן רק מרכיבים הודעה עם כפתורים ושולחים.
//
// ## למה רק בתוך חלון 24 השעות
//
// ‏Meta מתירה הודעת כפתורים רק עד 24 שעות מההודעה האחרונה של הנמען/ת. מחוצה
// לחלון רק תבנית מאושרת, ואין לנו תבנית עם כפתורי כן/לא. לכן ה-claim בוחרת
// רק סוכנים שכתבו לגבריאלה ב-23 השעות האחרונות, וההצעה על נכס ממתינה (עד
// 14 יום מיצירתו) לפעם הבאה שהסוכן/ת כותב/ת.
//
// ## הלחיצה
//
// מזהה הכפתור נושא את ההצעה: ‏`poffer:<share|video>:<yes|no>:<property_id>`.
// ‏`offerButtonReply` ב-index.ts הופך אותו לטקסט מפורש עם מזהה הנכס, כדי
// שהמודל ידע על איזה נכס עונים גם בלי ההודעה המקורית בהיסטוריה. "לא" נענה
// בלי מודל.
// ============================================================================

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { formatForWhatsapp, sendButtons } from "./whatsapp.ts";

type OfferRow = {
  offer_id: string;
  agent_id: string;
  wa_phone: string;
  display_name: string | null;
  property_id: string;
  title: string | null;
  property_type: string | null;
  kind: "share" | "video";
};

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const BUTTON_RE = new RegExp(`^poffer:(share|video):(yes|no):(${UUID})$`, "i");

// כותרות הכפתורים: עד 20 תווים אצל Meta, אחרת כל ההודעה נדחית. נמדדו
// ב-Array.from וב-length (ראו הסקיל whatsapp-bots).
export const SHARE_YES = "🤝 כן, לפתוח לשת״פ";
export const VIDEO_YES = "🎬 כן, להפיק סרטון";
export const OFFER_NO = "לא, תודה";

function firstName(name: string | null): string {
  return String(name || "").trim().split(/\s+/)[0] || "";
}

function offerBody(o: OfferRow): string {
  const title = (o.title || "הנכס").trim();
  const hi = firstName(o.display_name);
  if (o.kind === "share") {
    return `${hi ? hi + ", " : ""}"${title}" באוויר עם פרטים, תיאור ותמונות. ` +
      "לפתוח אותו לשיתוף פעולה עם המשרדים השותפים? הם יוכלו להציע אותו ללקוחות שלהם, " +
      "והפרטים שלך נשארים על המודעה.";
  }
  return `${hi ? hi + ", " : ""}ל"${title}" אין עדיין סרטון. ` +
    `ב${o.property_type || "נכס כזה"} סרטון מראה את המרחב והחוץ הרבה יותר טוב מתמונות, ` +
    "ודף הנכס נראה מלא יותר. להפיק סרטון שיווקי מהתמונות? אגיד לך קודם כמה זה עולה.";
}

/** סבב אחד: תפיסה, שליחה, ורישום התוצאה. */
export async function runPropertyOffers(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("property_offers_claim", { p_limit: 20 });
  if (error) return { error: error.message };
  const rows = (data || []) as OfferRow[];
  let sent = 0, failed = 0;

  // בטור ולא במקביל: לרוב יש כאן הצעה אחת או שתיים, ושתי הצעות לאותו/ה
  // סוכן/ת צריכות להגיע בסדר (שת"פ ואז סרטון).
  for (const o of rows) {
    const body = offerBody(o);
    const yes = o.kind === "share" ? SHARE_YES : VIDEO_YES;
    let waId: string | null = null;
    let err: string | null = null;
    try {
      waId = await sendButtons(o.wa_phone, body, [
        { id: `poffer:${o.kind}:yes:${o.property_id}`, title: yes },
        { id: `poffer:${o.kind}:no:${o.property_id}`, title: OFFER_NO },
      ]);
    } catch (e) {
      err = String((e as Error)?.message || e);
      console.error("property offer send failed", o.offer_id, err);
    }

    // ‏msg_type interactive, כמו הכפתורים של הבוט הציבורי - כל הודעה יוצאת
    // נרשמת ביומן, אחרת אין מעקב מסירה (הסקיל whatsapp-bots).
    await supabase.from("whatsapp_messages").insert({
      wa_message_id: waId,
      direction: "out",
      wa_phone: o.wa_phone,
      agent_id: o.agent_id,
      msg_type: "interactive",
      body: formatForWhatsapp(`${body} [${yes} | ${OFFER_NO}]`).slice(0, 1000),
      status: waId ? "sent" : null,
      error: err,
    });
    await supabase.from("agent_property_offers")
      .update({ status: waId ? "sent" : "failed", wa_message_id: waId })
      .eq("id", o.offer_id);
    if (waId) sent++; else failed++;
  }
  return { claimed: rows.length, sent, failed };
}

/**
 * לחיצה על כפתור של הצעה. ‏null - זה לא כפתור של הצעה. אחרת: ‏`reply` -
 * תשובה קבועה בלי מודל ("לא, תודה"), או ‏`text` - מה שנכנס לתור כאילו נכתב
 * ביד, עם מזהה הנכס.
 */
export async function offerButtonReply(
  supabase: SupabaseClient,
  agentId: string,
  buttonId: string,
): Promise<{ reply?: string; text?: string; propertyId?: string } | null> {
  const m = BUTTON_RE.exec(buttonId || "");
  if (!m) return null;
  const [, kind, answer, propertyId] = m;

  // רק נכס של הסוכן/ת שלחץ/ה. כפתור שהועבר בין מכשירים אינו פותח נכס של אחר/ת.
  const { data: prop } = await supabase.from("properties")
    .select("id, title").eq("id", propertyId).eq("agent_id", agentId).maybeSingle();
  if (!prop) return { reply: "לא מצאתי את הנכס הזה אצלך - ייתכן שנמסר לסוכן/ת אחר/ת." };

  await supabase.from("agent_property_offers")
    .update({ status: answer, answered_at: new Date().toISOString() })
    .eq("property_id", propertyId).eq("kind", kind);

  const title = String(prop.title || "הנכס");
  if (answer === "no") {
    return {
      reply: kind === "share"
        ? `בסדר, "${title}" נשאר רק אצלך. אם תרצה/י לפתוח אותו לשת"פ אחר כך - רק תגיד/י לי.`
        : `בסדר, בלי סרטון ל"${title}". אם תרצה/י אחר כך - רק תגיד/י לי.`,
    };
  }
  return {
    propertyId,
    text: kind === "share"
      ? `כן, לפתוח לשת"פ את הנכס "${title}" (property_id: ${propertyId}) - בתשובה להצעה שלך.`
      : `כן, אשמח לסרטון שיווקי לנכס "${title}" (property_id: ${propertyId}) - בתשובה להצעה שלך. ` +
        "קודם תגידי לי כמה זה עולה.",
  };
}
