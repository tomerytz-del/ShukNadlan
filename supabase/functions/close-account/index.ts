import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/morning.ts";

// ============================================================================
// סגירת חשבון ביוזמת הסוכן/ת
//
// שלוש פעולות, כולן על החשבון של הקורא/ת בלבד:
//
//   preview   מה יקרה אם אאשר — כמה מודעות ירדו, כמה כסף יוחזר, מאיזה
//             תאריך, ומה (אם בכלל) חוסם. זו השאילתה שמזינה את דיאלוג
//             האישור, ובלעדיה האישור הכפול היה מבקש לאשר משהו לא ידוע.
//   request   רישום הבקשה. למי שאינו במנוי בתשלום — סגירה מיידית באותה
//             קריאה. למנוי חודשי — הבקשה נרשמת והסגירה נקבעת לסוף תקופת
//             החיוב ששולמה, ומבוצעת בריצה היומית.
//   cancel    ביטול בקשה שטרם נכנסה לתוקף.
//
// **למה דרך שרת ולא update מהדפדפן.** ארבע עמודות הסגירה נעולות בטריגר
// ‏protect_sensitive_agency_member_fields, ו-active נעול לכתיבה עצמית מאז
// ומתמיד. אבל הסיבה האמיתית עמוקה יותר: "סגירת חשבון" היא שבע פעולות
// בטרנזקציה אחת (החזר, אירכוב מודעות, כיבוי העדפות, השתקת התראות, מחיקת
// פעמון, הסרה מרשימת התפוצה, כיבוי החשבון), ומחציתן נוגעות בטבלאות שהדפדפן
// לא אמור לגעת בהן. הן יושבות ב-close_agent_account שבמסד.
//
// **המדיניות שהפונקציה אוכפת**, ושנאמרת מילה במילה גם בדיאלוג:
//   • הזיכוי היחיד הוא יתרת הארנק שנטענה ולא מומשה. אין זיכוי יחסי על דמי
//     מנוי באמצע חודש.
//   • למנוי חודשי ההתקשרות נפסקת בתום תקופת החיוב ששולמה — עד אז הדף
//     והמודעות ממשיכים לעבוד, ואפשר לבטל את הבקשה.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MEMBER_FIELDS =
  "id, user_id, agency_id, role, active, display_name, email, credit_balance, " +
  "tier, tier_source, paid_tier, paid_tier_until, released_at, " +
  "closure_requested_at, closure_effective_at, closed_at";

/** מנוי חודשי בתשלום שעדיין בתוך התקופה ששולמה. */
function paidUntil(member: any): string | null {
  if (member?.tier_source !== "paid") return null;
  if (!member?.paid_tier_until) return null;
  const until = new Date(member.paid_tier_until);
  if (isNaN(until.getTime()) || until.getTime() <= Date.now()) return null;
  return until.toISOString();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing_authorization" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const authed = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await authed.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: member, error: memberErr } = await supabase
    .from("agency_members")
    .select(MEMBER_FIELDS)
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (memberErr) return json({ error: "db_error", detail: memberErr.message }, 500);
  if (!member) return json({ error: "no_matching_agent_profile" }, 403);

  const action = String(body?.action ?? "preview");

  // ---- מה יקרה אם אאשר -----------------------------------------------
  if (action === "preview" || action === "request") {
    const [blockerRes, { data: refundable }, { count: activeProps }, { data: openRefund }] =
      await Promise.all([
        supabase.rpc("agency_account_closure_blocker", { p_agent_id: member.id }),
        supabase.rpc("wallet_refundable_amount", { p_agent_id: member.id }),
        supabase.from("properties")
          .select("id", { count: "exact", head: true })
          .eq("agent_id", member.id).eq("status", "active"),
        supabase.from("wallet_refunds")
          .select("id, amount").eq("agent_id", member.id).eq("status", "requested").maybeSingle(),
      ]);

    // ‏blocker שנכשל אינו "אין חסם". סביבה שהמיגרציה עוד לא רצה בה מגיעה
    // לכאן, ובלי השגיאה הזו ה-CRM היה מציג מקטע סגירה מלא שנופל בלחיצה.
    // ‏close-account מחזיר/ה שגיאה, וה-CRM מוריד את הקטגוריה מהמסך.
    if (blockerRes.error) {
      return json({ error: "closure_unavailable", detail: blockerRes.error.message }, 503);
    }
    const blocker = blockerRes.data as string | null;

    const until = paidUntil(member);
    const summary = {
      agent_id: member.id,
      display_name: member.display_name,
      blocker: blocker ?? null,
      // הסכום שיוחזר בפועל: מה שנטען ולא מומש, ולא כל היתרה. יתרות מתנה
      // ובונוסים אינם כסף שנגבה, ואין מה להחזיר עליהם.
      credit_balance: Number(member.credit_balance ?? 0),
      refundable: Number(refundable ?? 0),
      refund_already_open: openRefund ? Number(openRefund.amount) : null,
      active_properties: activeProps ?? 0,
      subscription_until: until,
      effective_at: until ?? new Date().toISOString(),
      immediate: !until,
      closure_requested_at: member.closure_requested_at,
      closure_effective_at: member.closure_effective_at,
      closed_at: member.closed_at,
    };

    if (action === "preview") return json({ success: true, summary });

    // ---- רישום הבקשה -------------------------------------------------
    if (member.closed_at) return json({ error: "already_closed", summary }, 409);
    if (member.closure_requested_at) return json({ error: "closure_already_requested", summary }, 409);
    if (summary.blocker) return json({ error: summary.blocker, summary }, 409);

    // האישור הכפול נבדק גם כאן. הלקוח כבר דורש אותו, אבל נקודת קצה שסוגרת
    // חשבון בלחיצה אחת מסקריפט היא בדיוק מה שהאישור הכפול נועד למנוע.
    if (body?.confirm !== "סגירת חשבון") return json({ error: "confirmation_mismatch" }, 400);

    const reason = typeof body?.reason === "string" ? body.reason.slice(0, 500) : null;

    const { error: markErr } = await supabase
      .from("agency_members")
      .update({
        closure_requested_at: new Date().toISOString(),
        closure_effective_at: summary.effective_at,
        closure_reason: reason,
      })
      .eq("id", member.id);
    if (markErr) return json({ error: "db_error", detail: markErr.message }, 500);

    // מנוי חודשי: הבקשה נרשמה, והריצה היומית תסגור בתאריך. עד אז הכול עובד.
    if (!summary.immediate) {
      return json({ success: true, scheduled: true, effective_at: summary.effective_at, summary });
    }

    const { data: closed, error: closeErr } = await supabase
      .rpc("close_agent_account", { p_agent_id: member.id });
    if (closeErr) return json({ error: "db_error", detail: closeErr.message }, 500);
    if (closed?.error) return json({ error: closed.error }, 409);

    return json({ success: true, closed: true, result: closed, summary });
  }

  // ---- ביטול בקשה שטרם נכנסה לתוקף -----------------------------------
  if (action === "cancel") {
    if (member.closed_at) return json({ error: "already_closed" }, 409);
    if (!member.closure_requested_at) return json({ error: "no_open_request" }, 409);

    const { error } = await supabase
      .from("agency_members")
      .update({ closure_requested_at: null, closure_effective_at: null, closure_reason: null })
      .eq("id", member.id);
    if (error) return json({ error: "db_error", detail: error.message }, 500);
    return json({ success: true, cancelled: true });
  }

  return json({ error: "unknown_action" }, 400);
});
