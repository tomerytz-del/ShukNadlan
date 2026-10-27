// ============================================================================
// ניתוב לידים — הרישום המשותף לכל וידג'טי הקליטה
//
// כל וידג'ט קולט לידים לקהל אחר: הערכת שווי לסוכן/ת תיווך, מחשבון המשכנתא
// ליועצ/ת משכנתאות, חיפוש שמור למי שקונה לידי מחפשי דירה. שלוש הפונקציות
// שקולטות אותם (‏owner-lead-intake, mortgage-lead-intake, saved-search-intake)
// חולקות את המודול הזה כדי שהתשובה לשאלה "מה קרה לליד" תיראה אותו דבר בכולן.
//
// שני כללים שלא משתנים בין הקוראים:
//
//   ‏1. **רישום לעולם לא מפיל קליטה.** ליד אמיתי של אדם שהשאיר טלפון שווה
//      יותר מהשורה ביומן. כל שגיאה כאן נבלעת ונרשמת ללוג, והקליטה ממשיכה.
//   ‏2. **ההסלמה היא של מי שאין לו יעד בלבד.** ‏no_consent אינו תקלה אלא
//      בחירה של הפונה, ו-assigned/shelf הם המסלול התקין.
//
// ההתראה בפעמון נוצרת ב-DB (טריגר על lead_routing_log). המייל יוצא מכאן ולא
// מהמסד, כי מסד נתונים שממתין לספק מייל הוא מסד נתונים שנתקע כשהספק נתקע —
// והמשלוח עצמו מרוכז ב-platform-mail, שהיא היחידה שמכירה את פרטי השולח.
// ============================================================================

import { PLATFORM_CONTACT_EMAIL, sendPlatformEmail } from "./platform-mail-client.ts";

export type LeadKind = "agent_owner" | "agent_buyer" | "mortgage_advisor";
export type LeadTable = "leads" | "saved_searches" | "mortgage_leads";
/** assigned = שויך לסוכן/ת · shelf = פורסם למדף · unrouted = אין למי להפנות
 *  · no_consent = הפונה ביקש/ה התראות בלבד ולא אישר/ה יצירת קשר */
export type LeadRouting = "assigned" | "shelf" | "unrouted" | "no_consent";

export interface LeadRoutingInput {
  source: string;
  lead_kind: LeadKind;
  lead_table: LeadTable;
  lead_id: string;
  routing: LeadRouting;
  recipients?: number;
  reason?: string | null;
  summary?: string | null;
  city?: string | null;
  neighborhood_id?: string | null;
  deal_type?: string | null;
  property_type?: string | null;
  assigned_agent_id?: string | null;
}

const KIND_LABELS: Record<LeadKind, string> = {
  agent_owner: "ליד בעל/ת נכס",
  agent_buyer: "ליד מחפש/ת דירה",
  mortgage_advisor: "ליד ייעוץ משכנתאות",
};

/* ---------------------------------------------------------------------------
 * מקורות מהרשתות החברתיות
 *
 * ‏**רק social-lead-intake רשאית לסמן אותם**, והיא מאמתת את גבריאלה בסוד
 * משותף. פונקציות הקליטה ציבוריות (‏verify_jwt = false), ולכן מקור חברתי
 * מתקבל בהן רק מקורא פנימי (‏isInternalCaller - ‏service role, כמו
 * ‏meta-leads.ts); מהדפדפן הוא נופל לברירת המחדל של הקורא. אחרת כל אחד
 * היה יכול לייצר לידים "מפייסבוק" ולזהם את הדוח.
 *
 * התוויות - מה שהסוכן/ת רואה ב-source_detail. אותה מפה כמו
 * ‏lead_source_label() במסד (‏20270806090000).
 * ------------------------------------------------------------------------- */
const SOCIAL_SOURCES_LIST = ["facebook_dm", "facebook_comment", "instagram_dm", "instagram_comment"] as const;
export type SocialSource = typeof SOCIAL_SOURCES_LIST[number];
export const SOCIAL_SOURCES: ReadonlySet<string> = new Set(SOCIAL_SOURCES_LIST);
export const SOCIAL_SOURCE_LABELS: Readonly<Record<SocialSource, string>> = {
  facebook_dm: "פייסבוק · הודעה",
  facebook_comment: "פייסבוק · תגובה",
  instagram_dm: "אינסטגרם · הודעה",
  instagram_comment: "אינסטגרם · תגובה",
};

/** תווית קריאה ל-source_detail, או null למקור שאינו חברתי. */
export function socialSourceLabel(source: string | null | undefined): string | null {
  return source && SOCIAL_SOURCES.has(source) ? SOCIAL_SOURCE_LABELS[source as SocialSource] : null;
}

/** קורא פנימי = מי שמחזיק/ה במפתח ה-service role (פונקציית Edge אחרת). */
export function isInternalCaller(req: Request): boolean {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const got = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!key || got.length !== key.length) return false;
  let diff = 0;
  for (let i = 0; i < key.length; i++) diff |= key.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

/** מזהה אצל הספק (Zernio) - אותו אוצר תווים כמו leads_external_ref_format. */
export function cleanExternalRef(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9._:/-]{1,128}$/.test(value) ? value : null;
}

/** ‏מזהי המקור מגיעים מהדפדפן, ולכן נגזרים לאוצר מילים סגור: המקור נכנס
 *  ליומן שמנהל/ת הפלטפורמה קורא/ת, ואין סיבה שטקסט חופשי יגיע לשם. */
const KNOWN_SOURCES = new Set([
  "homepage_owner_wizard",
  "homepage_buyer_wizard",
  "homepage_search_agent",
  "homepage_mortgage_calc",
  "property_page_mortgage_calc",
  // תיבת ההדמיות בדף הנכס: "חושבים למכור/להשכיר?". הליד נושא agent_slug
  // ולכן היה נרשם ביומן כ-agent_page_owner_wizard — נכון לגבי היעד, מטעה
  // לגבי המקור. שני הכלים מייצרים לידים באותה כמות ובאותו מסלול, וההבדל
  // ביניהם הוא בדיוק מה שהיומן קיים כדי לענות עליו.
  "property_page_owner_wizard",
  "homepage_yield_calc",
  // כרטיס גבריאלה בדף הבית כשהעוזרת בוואטסאפ כבויה: הכפתור פותח את הסוכן
  // החכם במקום קישור wa.me (‏renderGabrielaCta ב-assets/home.js)
  "homepage_gabriela",
  "agency_page_owner_wizard",
  "agency_page_yield_calc",
  "agency_page_buyer_wizard",
  "agent_page_owner_wizard",
  "agent_page_yield_calc",
  "agent_page_buyer_wizard",
  // באנר מחפשי הנכס שבראש הפוטר, בכל עמוד ציבורי שאין לו אשף משלו
  // (‏assets/buyer-banner.js). ערך אחד ולא ערך לעמוד: העמוד עצמו אינו
  // משנה כאן דבר — הפוטר זהה בכולם — ומה שהיומן שואל הוא מאיזה *כלי* הגיע
  // הליד. ‏docs/site-footer.md.
  "footer_buyer_wizard",
  // אותו באנר בדיוק, בדף הנכס — שם הוא יצא מהפוטר ועבר אל מתחת למפה.
  // כאן העמוד כן משנה: ליד שנשמר אחרי קריאת נכס שלם הוא לא אותו ליד
  // שנשמר מרצועה בתחתית עמוד כלשהו, וזו בדיוק השאלה שהיומן קיים בשבילה.
  "property_page_buyer_wizard",
  // הבוט הציבורי בוואטסאפ (‏docs/whatsapp-public-bot.md). שני ערכים ולא אחד,
  // מאותה סיבה שיש שניים לכל עמוד: "מוכר/ת" ו"מחפש/ת" הם שני קהלים ושני
  // מסלולים, והשאלה שהיומן קיים בשבילה היא איזה מהם הבוט באמת מייצר.
  "whatsapp_bot_owner_wizard",
  "whatsapp_bot_search_agent",
  "whatsapp_bot_mortgage_calc",
  // טפסים מיידיים של מטא (‏ads-leads-webhook / ads-admin sync_leads,
  // ‏docs/marketing-console.md שלב 4). שלושה ערכים - אחד לכל מסלול - מאותה
  // סיבה כמו הבוט: מוכר/ת, מחפש/ת ופנייה על נכס הם שלושה משפכים, והשאלה
  // היא איזה מהם הקמפיין באמת מייצר. ‏lead_source_channel() ממפה את
  // meta_ads_* לערוץ משלו.
  "meta_ads_owner_form",
  "meta_ads_buyer_form",
  "meta_ads_property_form",
  // גלישה בהחלקה (‏/swipe, ‏docs/swipe-mode.md): פנייה על נכס מגיליון הפרטים,
  // ופנייה למפרסם מכרטיס ממומן (כבוי כרגע - SPONSORED_ENABLED ב-assets/swipe.js).
  // ‏lead_source_channel() ממפה אותם ל-other עד שיהיה להם ערוץ משלו.
  "swipe",
  "swipe_sponsored",
  // כרטיס הסיום ב-/swipe ("עדכנו אותי על נכס חדש"). עד 27.10 נפל לברירת המחדל
  // של saved-search-intake ונרשם כסוכן החכם של דף הבית
  "swipe_end",
  // "בקשו תמונות מהמפרסם" בנכס בלי תמונות (‏assets/no-photo.js, ‏docs/no-photo.md):
  // פנייה על נכס לכל דבר, מגיליון ההחלקה או מטופס דף הנכס. התווית ב-CRM
  // "בקשת תמונות" (‏lead_source_label במסד, ‏LX_SOURCES ב-crm.js)
  "photo_request",
  // גבריאלה בפייסבוק ובאינסטגרם (Zernio → social-lead-intake, ‏docs/social-leads.md).
  // **רק מקורא פנימי** - ראו SOCIAL_SOURCES למטה.
  ...SOCIAL_SOURCES_LIST,
]);

/* ---------------------------------------------------------------------------
 * ליד שהגיע מדף משרד
 *
 * ‏agency_slug נשלח משלושת הווידג'טים של agency.html: הערכת השווי, מחשבון
 * התשואה, והתאמת הנכס. כשהוא מגיע, כל מנגנון ההתאמה והרוטציה נעקף — הליד
 * שייך למשרד שבדף שבו הגולש/ת בחר/ה להשאיר פרטים, ולא למי שתורו הגיע —
 * והוא משויך למנהל/ת המשרד.
 *
 * משרד בלי מנהל/ת פעיל/ה נופל לסוכן/ת הראשון/ה, כדי שהפנייה לא תישאר
 * בתיבה שאיש לא פותח. ‏slug שאינו מוכר אינו שגיאה: הקורא ממשיך למסלול
 * הרגיל של הפלטפורמה, כי לזרוק פנייה אמיתית בגלל כתובת שגויה גרוע מכל
 * חלופה.
 *
 * יושב כאן ולא בפונקציה אחת מהן כי שלוש הפונקציות הקולטות צריכות בדיוק
 * את אותה תשובה, ושתי גרסאות שלה היו נפרדות בשקט ביום שבו הכלל ישתנה.
 * ------------------------------------------------------------------------- */
export interface AgencyRouting {
  agencyId: string;
  agentId: string | null;
  /** המסלול של מי שיקבל/תקבל את הליד. ‏null = לא נמצא/ה נמען/ת.
   *  הקורא צריך אותו כדי להחליט אם הליד נפתח מיד (‏mid/premium) או נכנס
   *  מוסתר ונספר במכסת הפניות החודשית של Pay&GO. */
  tier: string | null;
}

export async function resolveAgencyRouting(
  supabase: any,
  agencySlug: unknown,
): Promise<AgencyRouting | null> {
  if (typeof agencySlug !== "string") return null;
  const slug = agencySlug.trim().slice(0, 120);
  if (!slug) return null;

  const { data: agency } = await supabase
    .from("agencies").select("id").eq("slug", slug).maybeSingle();
  if (!agency) return null;

  const { data: members } = await supabase
    .from("agency_members")
    .select("id, role, tier")
    .eq("agency_id", agency.id)
    .eq("active", true);

  const list = members ?? [];
  const manager = list.find((m: any) => m.role === "manager") ?? list[0] ?? null;
  return { agencyId: agency.id, agentId: manager?.id ?? null, tier: manager?.tier ?? null };
}

/* ---------------------------------------------------------------------------
 * ליד שהגיע מדף סוכן/ת
 *
 * ‏agent_slug נשלח משלושת הווידג'טים של agent.html — אותם שלושה כלים של דף
 * המשרד, בדף של אדם אחד. ההיגיון זהה, רק צר יותר: מה שהדף של הסוכן/ת מייצר
 * שייך לסוכן/ת עצמו/ה, ולא למנהל/ת המשרד ולא לרוטציה של הפלטפורמה.
 *
 * ‏slug שאינו מוכר — או סוכן/ת שכבר אינו/ה פעיל/ה — אינו שגיאה: הקורא ממשיך
 * ל-‎resolveAgencyRouting‎ עם ה-slug של המשרד, ורק אם גם הוא אינו מוכר חוזר
 * למסלול הרגיל. פנייה אמיתית לא נזרקת בגלל כתובת שהשתנתה.
 * ------------------------------------------------------------------------- */
export async function resolveAgentRouting(
  supabase: any,
  agentSlug: unknown,
): Promise<AgencyRouting | null> {
  if (typeof agentSlug !== "string") return null;
  const slug = agentSlug.trim().slice(0, 120);
  if (!slug) return null;

  const { data: member } = await supabase
    .from("agency_members")
    .select("id, agency_id, tier")
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle();
  // ‏agency_id הוא NOT NULL בפועל, אבל סוכן/ת שבין משרדים לא אמור/ה להפיל
  // את הליד — בלי משרד אין מה לשייך, והקורא ימשיך לניתוב לפי המשרד שבדף.
  if (!member || !member.agency_id) return null;
  return { agencyId: member.agency_id, agentId: member.id, tier: member.tier ?? null };
}

/** ‏trusted = הקורא פנימי (‏isInternalCaller). מקור חברתי בלי זה - ברירת המחדל. */
export function normalizeSource(value: unknown, fallback: string, trusted = false): string {
  if (typeof value !== "string" || !KNOWN_SOURCES.has(value)) return fallback;
  if (SOCIAL_SOURCES.has(value) && !trusted) return fallback;
  return value;
}

/** כמה נמענים אפשריים יש היום לקהל הזה. ‏0 פירושו שהליד ייפול. */
export async function audienceSize(supabase: any, kind: LeadKind): Promise<number> {
  try {
    const { data, error } = await supabase.rpc("lead_audience_size", { p_kind: kind });
    if (error) throw error;
    return Number(data) || 0;
  } catch (err) {
    // ‏-1 ולא 0: ספירה שנכשלה אינה "אין נמענים", והקורא לא יסיק ממנה שהליד
    // תקוע. הרישום ימשיך עם המצב שהקורא כבר יודע.
    console.warn("lead_audience_size failed:", String(err));
    return -1;
  }
}

async function emailPlatformAdmins(
  emails: string[],
  input: LeadRoutingInput,
): Promise<void> {
  if (emails.length === 0) return;

  const kind = KIND_LABELS[input.lead_kind] ?? "ליד";
  const lines = [
    `${kind} נקלט ואין למי להפנות אותו.`,
    input.summary ? `פרטים: ${input.summary}` : "",
    `מקור: ${input.source}`,
    `נמענים אפשריים: ${input.recipients ?? 0}`,
    input.reason ? `סיבה: ${input.reason}` : "",
    `מזהה: ${input.lead_table}/${input.lead_id}`,
    `- שוק הנדל״ן של עפולה והסביבה · ${PLATFORM_CONTACT_EMAIL}`,
  ].filter(Boolean);

  const esc = (s: string) =>
    s.replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

  const result = await sendPlatformEmail({
    to: emails.slice(0, 10),
    subject: `⚠️ ${kind} ללא יעד - שוק נדל״ן`,
    text: lines.join("\n"),
    html: `<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;color:#1B1F26">\n  <h2 style="margin:0 0 10px;font-size:18px">${esc(kind)} - אין למי להפנות</h2>\n  ${lines.slice(1).map((l) => `<p style="margin:4px 0;font-size:14px">${esc(l)}</p>`).join("")}\n</div>`,
  });

  // הפעמון כבר קיבל את ההתראה מהטריגר; המייל הוא הסלמה נוספת ולא היחידה.
  if (!result.sent) console.warn("unrouted-lead email failed:", result.error);
}

/**
 * רישום ניתוב של ליד שנקלט. לעולם לא זורק: הקליטה כבר הצליחה, והיומן לא
 * ייקח אותה בחזרה.
 */
export async function logLeadRouting(supabase: any, input: LeadRoutingInput): Promise<void> {
  try {
    const payload = { ...input, recipients: Math.max(input.recipients ?? 0, 0) };
    const { data, error } = await supabase.rpc("log_lead_routing", { p_payload: payload });
    if (error) throw error;
    if (data?.alerted && Array.isArray(data.admin_emails)) {
      await emailPlatformAdmins(data.admin_emails, payload);
    }
  } catch (err) {
    console.warn("log_lead_routing failed:", String(err));
  }
}
