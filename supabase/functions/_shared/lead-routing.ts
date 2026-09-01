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

/** ‏מזהי המקור מגיעים מהדפדפן, ולכן נגזרים לאוצר מילים סגור: המקור נכנס
 *  ליומן שמנהל/ת הפלטפורמה קורא/ת, ואין סיבה שטקסט חופשי יגיע לשם. */
const KNOWN_SOURCES = new Set([
  "homepage_owner_wizard",
  "homepage_buyer_wizard",
  "homepage_search_agent",
  "homepage_mortgage_calc",
  "property_page_mortgage_calc",
  "homepage_yield_calc",
  "agency_page_owner_wizard",
  "agency_page_yield_calc",
  "agency_page_buyer_wizard",
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
    .select("id, role")
    .eq("agency_id", agency.id)
    .eq("active", true);

  const list = members ?? [];
  const manager = list.find((m: any) => m.role === "manager") ?? list[0] ?? null;
  return { agencyId: agency.id, agentId: manager?.id ?? null };
}

export function normalizeSource(value: unknown, fallback: string): string {
  return typeof value === "string" && KNOWN_SOURCES.has(value) ? value : fallback;
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
    `— שוק הנדל״ן של עפולה והסביבה · ${PLATFORM_CONTACT_EMAIL}`,
  ].filter(Boolean);

  const esc = (s: string) =>
    s.replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

  const result = await sendPlatformEmail({
    to: emails.slice(0, 10),
    subject: `⚠️ ${kind} ללא יעד — שוק נדל״ן`,
    text: lines.join("\n"),
    html: `<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;color:#1B1F26">\n  <h2 style="margin:0 0 10px;font-size:18px">${esc(kind)} — אין למי להפנות</h2>\n  ${lines.slice(1).map((l) => `<p style="margin:4px 0;font-size:14px">${esc(l)}</p>`).join("")}\n</div>`,
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
