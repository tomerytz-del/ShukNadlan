import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { mfaGate } from "../_shared/mfa-gate.ts";
import {
  clientFrom,
  corsHeaders,
  createPaymentForm,
  isTerminalMissing,
  json,
  morningConfigured,
} from "../_shared/morning.ts";

// ============================================================================
// ליד "שאלה לעו"ד": חיוב ישיר בכרטיס, בלי ארנק.
//
// שתי פעולות, שתיהן עם JWT ו-MFA והחשבון הפועל נגזר מה-JWT בלבד (לעולם לא מה-body):
//
//   start   {lead_id, client_*}  פותחת הזמנה, שומרת את הליד ל-15 דקות ומחזירה redirect_url לטופס
//                                התשלום של מורנינג. הסכום נקבע במסד (start_lawyer_lead_order) ולא מגיע מהדפדפן.
//   status  {order_id}           מצב ההזמנה לאחר החזרה מדף התשלום. פרטי הפונה מוחזרים **רק** כשההזמנה
//                                שולמה ואומתה, ודרך purchase_lawyer_lead (שם "כבר שלך" היא חזרה בלי חיוב).
//
// **הפונקציה לא מזכה, לא מוכרת ולא סוגרת תשלום.** הסגירה נעשית רק ב-wallet-topup-callback אחרי אימות
// מול ה-API של מורנינג (פונקציית ה-DB שמוכרת את הליד), כך שאין כאן דרך להצהיר "שילמתי".
// כתובות ההחזרה נושאות order_id בלבד, בלי אסימון. הסקיל wallet-charges.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const siteBaseUrl = (Deno.env.get("SITE_BASE_URL") || "https://shuknadlan.co.il").replace(/\/+$/, "");
const webhookSecret = Deno.env.get("MORNING_WEBHOOK_SECRET") || "";

const STATUS_BY_ERROR: Record<string, number> = {
  lead_not_found: 404,
  lead_not_available: 410,
  lead_already_sold: 409,
  already_purchased: 409,
  lead_reserved: 409,
  account_not_found: 403,
  not_a_lawyer: 403,
  shelf_not_approved: 403,
  too_many_open_orders: 429,
  order_in_progress: 409,
  free_lead: 400,
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing_authorization" }, 401);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const action = String(body?.action || "");
  if (action !== "start" && action !== "status") return json({ error: "unknown_action" }, 400);

  const authedClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await authedClient.auth.getUser();
  if (userErr || !userData?.user) {
    return json({ error: "unauthorized", detail: "invalid or expired session" }, 401);
  }
  const mfa = await mfaGate(authHeader);
  if (mfa) return json({ error: mfa.error }, mfa.status);

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: account } = await supabase
    .from("professional_accounts")
    .select("id, active, kind, shelf_enabled, display_name")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (!account) return json({ error: "no_matching_account" }, 403);
  if (!account.active) return json({ error: "account_inactive" }, 403);
  if (account.kind !== "real_estate_lawyer") return json({ error: "not_a_lawyer" }, 403);
  if (!account.shelf_enabled) return json({ error: "shelf_not_approved" }, 403);

  // ------------------------------------------------------------------ status
  if (action === "status") {
    const orderId = String(body?.order_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(orderId)) return json({ error: "missing_order_id" }, 400);

    const { data: order } = await supabase
      .from("lawyer_lead_orders")
      .select("id, lead_id, professional_id, status")
      .eq("id", orderId)
      .maybeSingle();
    // הזמנה של אחר/ת נראית כמו הזמנה שאינה קיימת
    if (!order || order.professional_id !== account.id) return json({ error: "order_not_found" }, 404);

    // רק המצב. failure_reason הוא טקסט פנימי (שגיאות של הסולק) ולא מוצג לגולש/ת
    if (order.status !== "success") {
      return json({ status: order.status });
    }
    // שולם ואומת: פרטי הפונה דרך אותה פונקציה של הארנק. הליד כבר שלו/ה, ולכן ללא חיוב נוסף.
    const { data: lead, error } = await supabase.rpc("purchase_lawyer_lead", {
      p_lead_id: order.lead_id,
      p_account_id: account.id,
    });
    if (error || !lead?.success) return json({ status: "success", delivered: false });
    return json({
      status: "success",
      delivered: true,
      full_name: lead.full_name,
      phone: lead.phone,
      email: lead.email,
      question: lead.question,
    });
  }

  // ------------------------------------------------------------------- start
  const leadId = String(body?.lead_id || "");
  if (!/^[0-9a-f-]{36}$/i.test(leadId)) return json({ error: "missing_lead_id" }, 400);

  // בלי ספק סליקה לא שומרים ליד לחינם: הבדיקה לפני פתיחת ההזמנה
  if (!morningConfigured() || !webhookSecret) return json({ error: "payment_unavailable" }, 503);

  const { data: started, error: startErr } = await supabase.rpc("start_lawyer_lead_order", {
    p_lead_id: leadId,
    p_account_id: account.id,
  });
  if (startErr) return json({ error: "db_error", detail: startErr.message }, 500);
  if (started?.error) return json(started, STATUS_BY_ERROR[started.error] ?? 400);

  const orderId = started.order_id as string;

  // אותה הזמנה פתוחה (לחיצה כפולה, חזרה מדף התשלום או לשונית שנשארה פתוחה): ממשיכים לאותו טופס
  if (started.reused) {
    if (started.payment_url) {
      return json({ success: true, order_id: orderId, amount: started.amount, redirect_url: started.payment_url });
    }
    // הבקשה הראשונה עוד יוצרת את הטופס. טופס שני על אותה הזמנה (אותו reference) היה מאפשר שני תשלומים
    // שרק אחד מהם ניתן להתאמה, ולכן ממתינים לראשונה.
    return json({ error: "order_in_progress" }, 409);
  }

  const notifyUrl = `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/wallet-topup-callback` +
    `?token=${encodeURIComponent(webhookSecret)}`;

  const form = await createPaymentForm({
    amount: Number(started.amount),
    description: "פרטי פונה, שאלה לעורך דין - שוק נדל\"ן",
    ...clientFrom(body, account.display_name),
    clientEmail: userData.user.email ?? null,
    successUrl: `${siteBaseUrl}/professional-crm?lead_payment=success&order_id=${orderId}`,
    failureUrl: `${siteBaseUrl}/professional-crm?lead_payment=failure&order_id=${orderId}`,
    notifyUrl,
    reference: orderId,
  });

  if (!form.ok) {
    // לא נוצר טופס: משחררים את הליד מיד, בלי לחכות ל-15 הדקות
    await supabase.rpc("fail_lawyer_lead_order", { p_order_id: orderId, p_reason: form.error });
    console.error("lawyer-lead-checkout: form creation failed", form.error);
    return json({
      error: isTerminalMissing(form.error) ? "payment_terminal_missing" : "payment_provider_error",
    }, 502);
  }

  // כשל בשמירה אינו מבטל את התשלום (ה-callback מוצא את ההזמנה לפי ה-reference), אבל חייב להיראות בלוג
  const { error: saveErr } = await supabase
    .from("lawyer_lead_orders")
    .update({ provider_form_id: form.formId, provider_payment_url: form.url })
    .eq("id", orderId);
  if (saveErr) console.error("lawyer-lead-checkout: saving payment url failed", orderId, saveErr.message);

  return json({
    success: true,
    order_id: orderId,
    amount: started.amount,
    amount_before_vat: started.amount_before_vat,
    redirect_url: form.url,
  });
});
