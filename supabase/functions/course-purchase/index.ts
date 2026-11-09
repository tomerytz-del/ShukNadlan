import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  clientFrom,
  corsHeaders,
  createPaymentForm,
  json,
  morningConfigured,
  isTerminalMissing,
} from "../_shared/morning.ts";

// ============================================================================
// קורס ההכנה למבחן המתווכים - פתיחת הרכישה
//
// המכונה החמישית של wallet-topup-callback (docs/wallet-payments.md): שורת
// pending ב-course_orders, טופס תשלום מתארח אצל מורנינג, ואימות חוזר מול
// ה-API שלהם ב-callback. **הפונקציה הזו לא פותחת גישה** - זה קורה רק ב-
// complete_course_order, אחרי שהתשלום אומת.
//
// מי שמשלם/ת כאן הוא/היא משתמש/ת auth רגיל/ה (כניסה עם Google מ-learn.html),
// בלי שורה ב-agency_members ובלי ארנק. לכן אין כאן resolveAgent: הזהות היא
// ה-JWT בלבד, והמחיר מגיע מ-pricing_config דרך course_price() ולא מהדפדפן.
//
//   GET          → המחיר ומצב הסליקה (ללא פתיחת תשלום)
//   POST         → פתיחת הזמנה והפניה לטופס התשלום
//   POST {test_mode: true} → גישה בלי חיוב, למנהל/ת פלטפורמה בלבד
//
// ‏verify_jwt = true ב-config.toml, ולכן ה-Gateway כבר חסם כל מי שאינו/ה
// מחובר/ת; getUser() כאן הוא מה שמחלץ את הזהות עצמה.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const siteBaseUrl = (Deno.env.get("SITE_BASE_URL") || "https://shuknadlan.co.il").replace(/\/+$/, "");
const webhookSecret = Deno.env.get("MORNING_WEBHOOK_SECRET") || "";

async function resolveUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return { error: "missing_authorization", status: 401 };
  const authed = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data, error } = await authed.auth.getUser();
  if (error || !data?.user) return { error: "unauthorized", status: 401 };
  return { user: data.user };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST" && req.method !== "GET") return json({ error: "method_not_allowed" }, 405);

  const resolved = await resolveUser(req);
  if ("error" in resolved) return json({ error: resolved.error }, resolved.status);
  const user = resolved.user;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: price, error: priceErr } = await supabase.rpc("course_price");
  if (priceErr) return json({ error: "db_error", detail: priceErr.message }, 500);
  if (price?.error) return json({ error: "course_not_configured" }, 503);

  if (req.method === "GET") {
    const { data: admin } = await supabase
      .from("agency_members")
      .select("is_platform_admin")
      .eq("user_id", user.id)
      .maybeSingle();
    return json({
      configured: morningConfigured(),
      amount: price.amount,
      amount_before_vat: price.amount_before_vat,
      vat_rate: price.vat_rate,
      months: price.months,
      can_test: admin?.is_platform_admin === true,
    });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  // ---- גישה בלי חיוב - מנהל/ת פלטפורמה בלבד --------------------------
  if (body?.test_mode === true) {
    const { data: admin } = await supabase
      .from("agency_members")
      .select("is_platform_admin")
      .eq("user_id", user.id)
      .maybeSingle();
    if (admin?.is_platform_admin !== true) return json({ error: "test_topup_forbidden" }, 403);
    const { data: granted, error: grantErr } = await supabase.rpc("course_grant_access", {
      p_user_id: user.id,
      p_months: price.months,
      p_test_mode: true,
    });
    if (grantErr) return json({ error: "db_error", detail: grantErr.message }, 500);
    if (granted?.error) return json(granted, 400);
    console.log("course-purchase: admin test enrollment", user.id);
    return json({ success: true, test_mode: true, expires_at: granted.expires_at });
  }

  if (!morningConfigured()) return json({ error: "morning_not_configured" }, 503);
  if (!webhookSecret) {
    return json({
      error: "morning_misconfigured",
      detail: "‏MORNING_WEBHOOK_SECRET אינו מוגדר ב-Edge Functions → Secrets.",
    }, 503);
  }

  const { data: started, error: startErr } = await supabase.rpc("start_course_order", {
    p_user_id: user.id,
    p_email: user.email ?? null,
  });
  if (startErr) return json({ error: "db_error", detail: startErr.message }, 500);
  if (started?.error) return json(started, 400);

  const orderId = started.order_id as string;
  const amount = Number(started.amount);

  const notifyUrl = `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/wallet-topup-callback` +
    `?token=${encodeURIComponent(webhookSecret)}`;

  // שם לחשבונית: מה שהוקלד בטופס, ואם לא - השם מחשבון Google.
  const googleName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null;
  const client = clientFrom(body, googleName || user.email || "לומד/ת");

  const form = await createPaymentForm({
    amount,
    description: `קורס הכנה למבחן המתווכים - ${started.months} חודשי גישה - שוק נדל"ן`,
    ...client,
    clientEmail: user.email ?? null,
    successUrl: `${siteBaseUrl}/learn?order=success&order_id=${orderId}`,
    failureUrl: `${siteBaseUrl}/learn?order=failure&order_id=${orderId}`,
    notifyUrl,
    reference: orderId,
  });

  if (!form.ok) {
    await supabase.rpc("fail_course_order", { p_order_id: orderId, p_reason: form.error });
    console.error("course-purchase: form creation failed", form.error);
    return json({
      error: isTerminalMissing(form.error) ? "payment_terminal_missing" : "payment_provider_error",
    }, 502);
  }

  await supabase
    .from("course_orders")
    .update({ provider_form_id: form.formId, provider_payment_url: form.url })
    .eq("id", orderId);

  return json({ success: true, order_id: orderId, amount, redirect_url: form.url });
});
