import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/morning.ts";
import { mfaGate } from "../_shared/mfa-gate.ts";
import { deleteAuthUser, eraseAgent } from "../_shared/account-erasure.ts";

// ============================================================================
// מחיקת חשבון ביוזמת המשתמש/ת (וקודם לכן "סגירת חשבון")
//
// ארבעה סוגי חשבון, לפי מי שמחזיק/ה ב-JWT (ו-body.account כשיש יותר מאחד):
//   agent      סוכן/ת. סגירה (close_agent_account) ואחריה מחיקה
//              (erase_agent_account): הפרטים, הכניסה ב-Auth והמספרים ב-Twilio.
//              במנוי בתשלום - בסוף התקופה (account-erasure משלימה), או מיד
//              אם בחרו when='now' ומוותרים על יתרת החודש.
//   developer  חברה יזמית. close_developer_account סוגרת ומוחקת בקריאה אחת.
//   professional  בעל/ת מקצוע (עו"ד...). close_professional_account סוגרת ומוחקת בקריאה אחת; השורה נשארת מאונונמת
//              (חיובים מפנים אליה), והכרטיסייה באתר נשארת. בלי הסוג הזה המשתמש/ת נחשב/ת none, והחשבון והארנק נמחקים בשקט.
//   none       משתמש/ת שנכנס/ה (למשל עם Google) ולא השלים/ה הרשמה. נמחק/ת
//              המשתמש ב-Auth בלבד - אין מה עוד למחוק.
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


/** מנוי חודשי בתשלום שעדיין בתוך התקופה ששולמה. */
function paidUntil(member: any): string | null {
  if (member?.tier_source !== "paid") return null;
  if (!member?.paid_tier_until) return null;
  const until = new Date(member.paid_tier_until);
  if (isNaN(until.getTime()) || until.getTime() <= Date.now()) return null;
  return until.toISOString();
}

/** המילים שמאשרות. "סגירת חשבון" נשאר כדי שמסך שנטען לפני הפריסה לא ייכשל. */
const CONFIRM_PHRASES = new Set(["מחיקת חשבון", "סגירת חשבון"]);

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
  const mfa = await mfaGate(authHeader);
  if (mfa) return json({ error: mfa.error }, mfa.status);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const userId = userData.user.id;
  const action = String(body?.action ?? "preview");

  const [{ data: member, error: memberErr }, { data: developer, error: devErr }, { data: professional, error: proErr }] = await Promise.all([
    supabase.from("agency_members").select("id, user_id, agency_id, role, active, display_name, email, credit_balance, tier, tier_source, paid_tier, paid_tier_until, released_at, closure_requested_at, closure_effective_at, closed_at").eq("user_id", userId).maybeSingle(),
    supabase.from("developers").select("id, user_id, name, credit_balance, closed_at, erased_at, status").eq("user_id", userId).maybeSingle(),
    // בעל/ת מקצוע (עו"ד...). בלי השורה הזו משתמש/ת כזה/ת נחשב/ת "none", ומחיקת המשתמש ב-Auth מוחקת בשקט (cascade) את החשבון והארנק
    supabase.from("professional_accounts").select("id, user_id, kind, display_name, credit_balance, erased_at").eq("user_id", userId).is("erased_at", null).maybeSingle(),
  ]);
  if (memberErr) return json({ error: "db_error", detail: memberErr.message }, 500);
  if (devErr) return json({ error: "db_error", detail: devErr.message }, 500);
  if (proErr) return json({ error: "db_error", detail: proErr.message }, 500);

  // איזה חשבון. משתמש/ת שהוא/היא גם סוכן/ת וגם חברה יזמית מוחק/ת כל אחד
  // מהמסך שלו, ולכן הדף אומר במפורש (account). בלי - הסוכן/ת קודם.
  const wanted = String(body?.account ?? "");
  const kind = wanted === "developer" && developer ? "developer"
    : wanted === "professional" && professional ? "professional"
    : wanted === "agent" && member ? "agent"
    : member ? "agent" : developer ? "developer" : professional ? "professional" : "none";

  if (kind === "developer") return developerFlow(supabase, developer, action, body);
  if (kind === "professional") return professionalFlow(supabase, professional, action, body);
  if (kind === "none") {
    if (action === "preview") return json({ success: true, summary: { kind: "none", email: userData.user.email ?? null } });
    if (action !== "request") return json({ error: "unknown_action" }, 400);
    if (!CONFIRM_PHRASES.has(String(body?.confirm ?? ""))) return json({ error: "confirmation_mismatch" }, 400);
    await supabase.from("app_push_devices").delete().eq("user_id", userId);
    const auth = await deleteAuthUser(supabase, userId);
    if (auth === "failed") return json({ error: "auth_delete_failed" }, 500);
    return json({ success: true, closed: true, deleted: true });
  }
  if (!member) return json({ error: "no_matching_agent_profile" }, 403);

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
      kind: "agent",
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

    // האישור הכפול נבדק גם כאן. הלקוח כבר דורש אותו, אבל נקודת קצה שמוחקת
    // חשבון בלחיצה אחת מסקריפט היא בדיוק מה שהאישור הכפול נועד למנוע.
    if (!CONFIRM_PHRASES.has(String(body?.confirm ?? ""))) return json({ error: "confirmation_mismatch" }, 400);

    const reason = typeof body?.reason === "string" ? body.reason.slice(0, 500) : null;
    // מנוי בתשלום שבחר/ה "עכשיו": מוותר/ת על יתרת החודש. אין זיכוי יחסי
    // (terms §19), והדיאלוג אומר את זה לפני האישור.
    const now = !summary.immediate && body?.when === "now";
    const effective = now ? new Date().toISOString() : summary.effective_at;

    const { error: markErr } = await supabase
      .from("agency_members")
      .update({
        closure_requested_at: new Date().toISOString(),
        closure_effective_at: effective,
        closure_reason: reason,
      })
      .eq("id", member.id);
    if (markErr) return json({ error: "db_error", detail: markErr.message }, 500);

    // מנוי חודשי: הבקשה נרשמה, הסגירה בתאריך (3:40) והמחיקה אחריה (3:55).
    // עד אז הכול עובד, והחידוש בכרטיס כבר לא ירוץ (claim_due_tier_renewals).
    if (!summary.immediate && !now) {
      return json({ success: true, scheduled: true, effective_at: effective, summary });
    }

    const { data: closed, error: closeErr } = await supabase
      .rpc("close_agent_account", { p_agent_id: member.id });
    if (closeErr) return json({ error: "db_error", detail: closeErr.message }, 500);
    if (closed?.error) return json({ error: closed.error }, 409);

    // הסגירה הצליחה. מחיקה שנכשלה כאן אינה מחזירה את הסגירה: account-erasure
    // תשלים אותה בלילה (accounts_pending_erasure).
    const erased = await eraseAgent(supabase, member.id);
    if (erased.error) console.error("close-account: erase failed", member.id, erased);

    return json({ success: true, closed: true, deleted: !erased.error, result: closed, summary });
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

// ---- חברה יזמית ---------------------------------------------------------
// deno-lint-ignore no-explicit-any
async function developerFlow(supabase: any, dev: any, action: string, body: any) {
  if (dev.closed_at) return json({ error: "already_closed" }, 409);
  const [{ data: refundable }, { count: activeProjects }] = await Promise.all([
    supabase.rpc("developer_refundable_amount", { p_developer_id: dev.id }),
    supabase.from("projects").select("id", { count: "exact", head: true })
      .eq("developer_id", dev.id).neq("status", "archived"),
  ]);
  const summary = {
    kind: "developer",
    developer_id: dev.id,
    name: dev.name,
    credit_balance: Number(dev.credit_balance ?? 0),
    refundable: Number(refundable ?? 0),
    active_projects: activeProjects ?? 0,
    immediate: true,
  };
  if (action === "preview") return json({ success: true, summary });
  if (action !== "request") return json({ error: "unknown_action" }, 400);
  if (!CONFIRM_PHRASES.has(String(body?.confirm ?? ""))) return json({ error: "confirmation_mismatch" }, 400);

  const reason = typeof body?.reason === "string" ? body.reason.slice(0, 500) : null;
  const { data: closed, error } = await supabase
    .rpc("close_developer_account", { p_developer_id: dev.id, p_reason: reason });
  if (error) return json({ error: "db_error", detail: error.message }, 500);
  if (closed?.error) return json({ error: closed.error }, 409);
  const auth = await deleteAuthUser(supabase, closed?.user_id);
  return json({ success: true, closed: true, deleted: auth !== "failed", result: closed, summary });
}

// ---- בעל/ת מקצוע (עו"ד, יועץ משכנתאות...) ---------------------------------
// ‏close_professional_account מוחקת את הפרטים והכניסה בקריאה אחת (אין לבעל מקצוע מנוי תקופתי), והשורה נשארת
// מאונונמת כי חיובים ויומן זיכויים מפנים אליה. כרטיסיית בעל המקצוע באתר נשארת: היא מוצר נפרד שמנוהל מהקישור האישי שלה.
// deno-lint-ignore no-explicit-any
async function professionalFlow(supabase: any, pro: any, action: string, body: any) {
  const [{ count: bought }, { count: pending }] = await Promise.all([
    supabase.from("lawyer_leads").select("id", { count: "exact", head: true }).eq("sold_to_professional_id", pro.id),
    supabase.from("lawyer_lead_orders").select("id", { count: "exact", head: true })
      .eq("professional_id", pro.id).eq("status", "pending"),
  ]);
  const summary = {
    kind: "professional",
    account_id: pro.id,
    name: pro.display_name,
    credit_balance: Number(pro.credit_balance ?? 0),
    bought_leads: bought ?? 0,
    // תשלום שעוד בדרך חוסם: מחיקה באמצע הייתה משאירה כסף שנגבה בלי חשבון למסור לו את הליד
    blocker: (pending ?? 0) > 0 ? "payment_pending" : null,
    immediate: true,
  };
  if (action === "preview") return json({ success: true, summary });
  if (action !== "request") return json({ error: "unknown_action" }, 400);
  if (!CONFIRM_PHRASES.has(String(body?.confirm ?? ""))) return json({ error: "confirmation_mismatch" }, 400);
  if (summary.blocker) return json({ error: summary.blocker, summary }, 409);

  const reason = typeof body?.reason === "string" ? body.reason.slice(0, 500) : null;
  const { data: closed, error } = await supabase
    .rpc("close_professional_account", { p_account_id: pro.id, p_reason: reason });
  if (error) return json({ error: "db_error", detail: error.message }, 500);
  if (closed?.error) return json({ error: closed.error }, 409);
  // ‏user_id כבר מתאפס בשורה, ולכן מחיקת המשתמש ב-Auth אינה מוחקת אותה (cascade)
  const auth = await deleteAuthUser(supabase, closed?.user_id);
  return json({ success: true, closed: true, deleted: auth !== "failed", auth, result: closed, summary });
}
