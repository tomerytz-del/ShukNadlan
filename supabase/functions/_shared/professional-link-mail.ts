// ============================================================================
// שחזור קישור העריכה של כרטיסיית בעל/ת מקצוע למייל שבכרטיסייה
//
// הקישור עם האסימון הוא המפתח היחיד לעריכה, ועד 10.11.2026 מי שאיבד/ה אותו היה
// צריך/ה לכתוב לנו, ואז מישהו שלף אותו ב-SQL. שתי נקודות כניסה מבקשות שליחה מחדש:
//   • professional-manage (action recover_link): "איבדתם את הקישור?" בדף העריכה.
//   • professional-signup: הרשמה חוזרת לאותו מייל כשכבר יש כרטיסייה חיה או ממתינה.
//     במקום כרטיסייה כפולה, שולחים את הקישור של הקיימת.
//
// ## למה המייל ולא תשובה בדפדפן
// האסימון יוצא רק לכתובת שנרשמה בכרטיסייה. תשובה בדפדפן הייתה נותנת את המפתח
// לכל מי שיודע את הכתובת של בעל/ת המקצוע (היא מופיעה בעמוד הציבורי כשהוא/היא
// בחר/ה להציג אותה).
//
// ## בלם, ומה התשובה מסגירה
// שליחה אחת לעשר דקות לכרטיסייה (ad_placement_access.link_sent_at). הדפדפן מקבל
// `throttled`, שהוא true רק כשיש כרטיסייה לכתובת: כלומר התשובה **כן** מסגירה אם הכתובת
// רשומה, בדיוק כמו `card_exists` בהרשמה חוזרת. זו החלטה: הכתובת של בעל/ת מקצוע אינה
// סוד (רבים מציגים אותה בעמוד הציבורי), ו"שלחנו לפני רגע" חוסך פנייה אלינו. מה שלא
// יוצא לעולם הוא האסימון עצמו. כישלון במשלוח נרשם ללוג ואינו זורק.
// ============================================================================

import { sendPlatformEmail } from "./platform-mail-client.ts";

const SITE_BASE = (Deno.env.get("SITE_BASE_URL") || "https://shuknadlan.co.il").replace(/\/+$/, "");
const RESEND_AFTER_MS = 10 * 60_000;

/** כרטיסייה שאפשר לערוך: חיה, ממתינה לאישור, או מושהית (הפרופיל שלה עדיין נערך).
 *  **לא** pending_payment: במסלול בתשלום האסימון נמסר רק אחרי שהתשלום אומת
 *  (professional-signup, action status), ושחזור למייל היה עוקף את זה. */
const RECOVERABLE_STATUSES = ["active", "pending_approval", "paused"];

/**
 * כתובת תקינה, באותיות קטנות. בלי `*` ו-`%`: PostgREST מתרגם `*` ל-`%` בתבנית ilike לפני
 * שהיא מגיעה ל-Postgres, ולכן אי אפשר לברוח ממנו, וכתובת עם תו-כל הייתה תופסת כרטיסיות
 * של אחרים. כתובת אמיתית אינה מכילה אותם.
 */
export function normalizeEmail(value: unknown): string | null {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return v && /^[^@\s*%]+@[^@\s.*%]+\.[^@\s*%]+$/.test(v) && v.length <= 254 ? v : null;
}

/**
 * כתובת כתבנית ilike **מילולית**: ‏`_` ו-`%` הם תווי-כל ב-LIKE, ו-"a_b@x.il" היה תופס גם
 * "aXb@x.il". כאן זה לא עניין של דיוק אלא של למי נשלח המפתח: התאמה רחבה מדי הייתה שולחת
 * את קישור העריכה של כרטיסייה אחרת לכתובת שביקשה. ‏ilike ולא eq כדי להתעלם מרישיות.
 * ‏`*` לא נברח כאן אלא נדחה ב-normalizeEmail (ראו שם).
 */
export function likeLiteral(email: string): string {
  return email.replace(/[\\%_]/g, (c) => "\\" + c);
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export interface RecoverResult {
  /** כמה כרטיסיות נמצאו לכתובת (לקורא פנימי בלבד; לא מוחזר לדפדפן) */
  found: number;
  /** נשלח מייל בפועל */
  sent: boolean;
  /** נמצאו כרטיסיות אבל כולן בתוך הבלם */
  throttled: boolean;
}

/**
 * שולחת לכתובת את קישורי העריכה של כל הכרטיסיות שלה (בדרך כלל אחת).
 * `supabase` הוא לקוח service_role: ad_placement_access אינו נגיש בשום מפתח אחר.
 */
export async function sendManageLinks(supabase: any, email: string): Promise<RecoverResult> {
  const { data: cards, error } = await supabase
    .from("ad_placements")
    .select("id, advertiser_name, business_name, status, created_at")
    .eq("placement_type", "professional_card")
    .in("status", RECOVERABLE_STATUSES)
    .ilike("contact_email", likeLiteral(email))
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) {
    console.error("manage link recovery: card lookup failed", error.message);
    return { found: 0, sent: false, throttled: false };
  }
  if (!cards?.length) return { found: 0, sent: false, throttled: false };

  const ids = cards.map((c: any) => c.id);
  const { data: access } = await supabase
    .from("ad_placement_access")
    .select("placement_id, manage_token, link_sent_at")
    .in("placement_id", ids);
  const byCard = new Map<string, any>((access ?? []).map((a: any) => [a.placement_id, a]));

  // כרטיסייה בלי שורת אסימון (יצירת האסימון בהרשמה נכשלה ונרשמה ללוג בלבד) אינה "נשלח
  // לפני רגע": אין מה לשלוח, והקורא מקבל "אם הכתובת רשומה" ולא "נסו בעוד עשר דקות" לנצח
  const withToken = cards.filter((c: any) => byCard.has(c.id));
  if (!withToken.length) {
    console.error("manage link recovery: card(s) without ad_placement_access", ids.join(","));
    return { found: 0, sent: false, throttled: false };
  }

  const now = Date.now();
  const fresh = withToken.filter((c: any) => {
    const last = Date.parse(byCard.get(c.id).link_sent_at || "");
    return !(Number.isFinite(last) && now - last < RESEND_AFTER_MS);
  });
  if (!fresh.length) return { found: withToken.length, sent: false, throttled: true };

  const lines = fresh.map((c: any) => {
    const name = String(c.business_name || c.advertiser_name || "הכרטיסייה").trim();
    const url = `${SITE_BASE}/professional-manage?token=${byCard.get(c.id).manage_token}`;
    const state = c.status === "pending_approval" ? " (ממתינה לאישור הנהלת האתר)" : "";
    return { name, url, state };
  });

  const text = [
    "שלום,",
    "",
    "ביקשתם את קישור העריכה של העמוד שלכם בשוק הנדל\"ן. הקישור הוא המפתח לעריכה, ולכן שומרים אותו ולא מעבירים הלאה.",
    "",
    ...lines.map((l) => `${l.name}${l.state}:\n${l.url}`),
    "",
    `כניסה עם אימייל וסיסמה לאזור האישי (ארנק ולידים): ${SITE_BASE}/professional-crm`,
    "",
    "לא ביקשתם? אפשר להתעלם מההודעה. הקישור לא השתנה.",
    "שוק הנדל\"ן של עפולה והסביבה",
  ].join("\n");

  const html = `<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;color:#1B1F26;font-size:15px;line-height:1.6">
  <p>שלום,</p>
  <p>ביקשתם את קישור העריכה של העמוד שלכם בשוק הנדל"ן. הקישור הוא המפתח לעריכה, ולכן שומרים אותו ולא מעבירים הלאה.</p>
  ${lines.map((l) => `<p><b>${esc(l.name)}</b>${esc(l.state)}<br><a href="${esc(l.url)}" style="word-break:break-all">${esc(l.url)}</a></p>`).join("")}
  <p>כניסה עם אימייל וסיסמה לאזור האישי (ארנק ולידים): <a href="${esc(SITE_BASE)}/professional-crm">${esc(SITE_BASE)}/professional-crm</a></p>
  <p style="color:#4a5578;font-size:13px">לא ביקשתם? אפשר להתעלם מההודעה. הקישור לא השתנה.<br>שוק הנדל"ן של עפולה והסביבה</p>
</div>`;

  const result = await sendPlatformEmail({
    to: [email],
    subject: "קישור העריכה של העמוד שלכם - שוק נדל\"ן",
    text,
    html,
  });
  if (!result.sent) {
    console.error("manage link recovery: mail failed", result.error);
    return { found: withToken.length, sent: false, throttled: false };
  }
  // הבלם נרשם רק אחרי משלוח שהצליח: כישלון אצל ספק המייל לא נועל את הכתובת לעשר דקות
  const { error: stampErr } = await supabase
    .from("ad_placement_access")
    .update({ link_sent_at: new Date().toISOString() })
    .in("placement_id", fresh.map((c: any) => c.id));
  if (stampErr) console.error("manage link recovery: stamping link_sent_at failed", stampErr.message);
  return { found: withToken.length, sent: true, throttled: false };
}
