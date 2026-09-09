import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  corsHeaders,
  createPaymentForm,
  json,
  morningConfigured,
} from "../_shared/morning.ts";

// ============================================================================
// רכישת מנוי — פתיחת התשלום
//
// אותו מסלול דו-פאזי בדיוק כמו wallet-topup, ומאותה סיבה: בין הלחיצה לבין
// הגבייה עוברות דקות, והתשלום עלול לא לקרות. **הפונקציה הזו לא פותחת מסלול.**
// היא פותחת שורת 'pending' ומחזירה כתובת תשלום; המסלול נפתח רק
// ב-wallet-topup-callback, אחרי אימות מול מורנינג.
//
// **הדפדפן שולח מסלול ומספר חודשים, לא סכום.** התמחור נעשה במסד
// (‏subscription_price) ונבדק שוב מול הסולק לפני שהמסלול נפתח. אין נתיב שבו
// סכום שמגיע מבחוץ קובע כמה נגבה או מה נפתח.
//
// אין כאן כרטיס שמור ואין חיוב אוטומטי: זו רכישה של תקופה מראש. ההרחבה
// לחיוב חוזר אפשרית על אותה סכימה, אבל היא החלטה נפרדת — ראו ההסבר בראש
// המיגרציה 20261015090000.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const siteBaseUrl = (Deno.env.get("SITE_BASE_URL") || "https://shuknadlan.co.il").replace(/\/+$/, "");
const webhookSecret = Deno.env.get("MORNING_WEBHOOK_SECRET") || "";

const TIER_LABELS: Record<string, string> = { mid: "PROFESSIONAL", premium: "Elite" };

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

  const tier = String(body?.tier ?? "");
  const months = Number(body?.months ?? 1);
  if (!["mid", "premium"].includes(tier)) return json({ error: "invalid_tier" }, 400);
  if (!Number.isInteger(months) || months < 1 || months > 12) {
    return json({ error: "invalid_months" }, 400);
  }

  const authed = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await authed.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: agent, error: agentErr } = await supabase
    .from("agency_members")
    .select("id, active, display_name")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (agentErr || !agent) return json({ error: "no_matching_agent_profile" }, 403);
  if (!agent.active) return json({ error: "agent_inactive" }, 403);

  // ---- מצב בדיקה --------------------------------------------------------
  // בלי מורנינג אין רכישת מנוי. **לא נופלים כאן למסלול "מאשרים בכל זאת"**,
  // בניגוד לטעינת ארנק: ארנק במצב בדיקה הוא כסף מדומה שאפשר לסמן ככזה,
  // ומסלול Elite שנפתח בלי תשלום הוא הטבה אמיתית לכל דבר.
  if (!morningConfigured()) {
    return json({ error: "morning_not_configured" }, 503);
  }
  if (!webhookSecret) {
    return json({
      error: "morning_misconfigured",
      detail: "‏MORNING_WEBHOOK_SECRET אינו מוגדר ב-Edge Functions → Secrets.",
    }, 503);
  }

  // ---- פאזה 1: ההזמנה ---------------------------------------------------
  const { data: started, error: startErr } = await supabase.rpc("start_subscription_order", {
    p_agent_id: agent.id,
    p_tier: tier,
    p_months: months,
  });
  if (startErr) return json({ error: "db_error", detail: startErr.message }, 500);
  if (started?.error) return json(started, 400);

  const orderId = started.order_id as string;
  const amount = Number(started.amount);

  const label = TIER_LABELS[tier] ?? tier;
  const desc = months === 1
    ? `מנוי ${label} — חודש`
    : `מנוי ${label} — ${months} חודשים`;

  const notifyUrl = `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/wallet-topup-callback` +
    `?token=${encodeURIComponent(webhookSecret)}`;

  const form = await createPaymentForm({
    amount,
    description: `${desc} — שוק נדל"ן`,
    clientName: agent.display_name || "סוכן/ת",
    clientEmail: userData.user.email ?? null,
    successUrl: `${siteBaseUrl}/crm.html?subscription=success&order_id=${orderId}`,
    failureUrl: `${siteBaseUrl}/crm.html?subscription=failure&order_id=${orderId}`,
    notifyUrl,
    reference: orderId,
  });

  if (!form.ok) {
    await supabase.rpc("fail_subscription_order", { p_order_id: orderId, p_reason: form.error });
    console.error("subscription-purchase: form creation failed", form.error);
    return json({ error: "payment_provider_error" }, 502);
  }

  await supabase
    .from("subscription_orders")
    .update({ provider_form_id: form.formId, provider_payment_url: form.url })
    .eq("id", orderId);

  return json({
    success: true,
    order_id: orderId,
    tier,
    months,
    amount,
    redirect_url: form.url,
  }, 200);
});
