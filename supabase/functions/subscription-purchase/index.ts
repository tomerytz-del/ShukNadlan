import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  clientFrom,
  corsHeaders,
  createPaymentForm,
  isTerminalMissing,
  json,
  morningConfigured,
} from "../_shared/morning.ts";

// ============================================================================
// רכישת מנוי למסלול PROFESSIONAL / Elite - חודש ראשון, ומשם חידוש חודשי
//
// **נפתחה מחדש (7.10.2026)** אחרי שהייתה סגורה ב-410 מאז שכל המצטרפים קיבלו
// את הטבת ההשקה. ההטבה עדיין בתוקף, ולכן:
//
//   * בתקופת ההטבה הרכישה מותרת רק ב-30 הימים האחרונים שלה, והתקופה ששולמה
//     מתחילה **בסוף ההטבה** (start/complete_subscription_order,
//     20270307090000). לפני כן - ‏promo_active.
//   * אחרי ההטבה - חודש מהיום.
//
// **הדפדפן שולח מסלול, לא סכום.** ‏subscription_price במסד הוא מקור האמת,
// כולל המע"מ. המסלול נפתח רק ב-wallet-topup-callback, אחרי אימות מול
// מורנינג - לא כאן.
//
// **החידוש.** ‏auto_renew (ברירת מחדל: כן) מסמן את ההזמנה, מבקש ממורנינג
// לשמור את הכרטיס (saveCard - רק כשהשדה ידוע, MORNING_SAVE_CARD_FIELDS),
// ושומר את האימייל שנשלח בטופס: לפיו billing-renew מוצאת את הכרטיס. החיוב
// החודשי עצמו מאחורי recurring_charging_enabled, שכבוי עד חיוב בדיקה
// בסנדבוקס (docs/professional-cards.md, "להדלקה").
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
  if (!["mid", "premium"].includes(tier)) return json({ error: "invalid_tier" }, 400);
  // חודש אחד, והחידוש ממשיך משם. תשלום מראש לכמה חודשים קיים במסד, אבל
  // אינו מוצע: עם חידוש אוטומטי הוא רק מגדיל את מה שנגבה ביום הראשון.
  const months = 1;
  const autoRenew = body?.auto_renew !== false;

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

  // בלי מורנינג אין רכישת מנוי, ואין "מאשרים בכל זאת": מסלול שנפתח בלי
  // תשלום הוא הטבה אמיתית, לא כסף מדומה שאפשר לסמן כבדיקה.
  if (!morningConfigured()) return json({ error: "morning_not_configured" }, 503);
  if (!webhookSecret) {
    return json({
      error: "morning_misconfigured",
      detail: "‏MORNING_WEBHOOK_SECRET אינו מוגדר ב-Edge Functions → Secrets.",
    }, 503);
  }

  const { data: started, error: startErr } = await supabase.rpc("start_subscription_order", {
    p_agent_id: agent.id,
    p_tier: tier,
    p_months: months,
  });
  if (startErr) return json({ error: "db_error", detail: startErr.message }, 500);
  if (started?.error) return json(started, 400);

  const orderId = started.order_id as string;
  const amount = Number(started.amount);
  const contactEmail = userData.user.email ?? null;

  await supabase.from("subscription_orders")
    .update({ auto_renew: autoRenew, contact_email: contactEmail })
    .eq("id", orderId);

  const label = TIER_LABELS[tier] ?? tier;
  const notifyUrl = `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/wallet-topup-callback` +
    `?token=${encodeURIComponent(webhookSecret)}`;

  const form = await createPaymentForm({
    amount,
    description: `מנוי ${label} - חודש${autoRenew ? ", מתחדש חודשית" : ""} - שוק נדל"ן`,
    ...clientFrom(body, agent.display_name),
    clientEmail: contactEmail,
    successUrl: `${siteBaseUrl}/crm?subscription=success&order_id=${orderId}`,
    failureUrl: `${siteBaseUrl}/crm?subscription=failure&order_id=${orderId}`,
    notifyUrl,
    reference: orderId,
    saveCard: autoRenew,
  });

  if (!form.ok) {
    await supabase.rpc("fail_subscription_order", { p_order_id: orderId, p_reason: form.error });
    console.error("subscription-purchase: form creation failed", form.error);
    return json({
      error: isTerminalMissing(form.error) ? "payment_terminal_missing" : "payment_provider_error",
    }, 502);
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
    auto_renew: autoRenew,
    redirect_url: form.url,
  }, 200);
});
