import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  corsHeaders,
  createPaymentForm,
  json,
  morningConfigured,
  morningEnvLabel,
} from "../_shared/morning.ts";

// ============================================================================
// טעינת ארנק — פתיחת התשלום
//
// מודול 4 §5.1.1 — טעינה בסכומים 100-500 בקפיצות 100.
//
// **הפונקציה הזו לא מזכה את הארנק.** היא פותחת שורת 'pending' ומחזירה כתובת
// של טופס תשלום מתארח אצל מורנינג. הזיכוי קורה רק ב-wallet-topup-callback,
// אחרי אימות מול ה-API של מורנינג. הפרדה זו היא כל ההבדל בין "לחצתי טען"
// לבין "שילמתי" — ועד היום הקוד כאן לא הבדיל ביניהם.
//
// **שני מסלולים, לפי מה שמוגדר בסביבה:**
//
//   מורנינג מוגדר   → start_wallet_topup + טופס תשלום. כסף אמיתי.
//   מורנינג לא מוגדר → process_wallet_topup. מצב בדיקה, זיכוי מיידי, מסומן.
//
// מסלול הנפילה אינו נוחות — הוא מה שמאפשר למזג את השינוי הזה בלי להפיל את
// הארנק ברגע המיזוג. הסודות מוגדרים ב-Supabase → Edge Functions → Secrets,
// והמעבר לסליקה אמיתית קורה כשמגדירים אותם, בלי פריסה נוספת.
//
// ‏GET מחזיר את המצב בלי לפתוח תשלום, כדי שהממשק ידע אם להציג את תג
// "מצב בדיקה". ‏verify_jwt=true, ולכן גם הוא דורש התחברות.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const siteBaseUrl = (Deno.env.get("SITE_BASE_URL") || "https://shuknadlan.co.il").replace(/\/+$/, "");
const webhookSecret = Deno.env.get("MORNING_WEBHOOK_SECRET") || "";

const ALLOWED_AMOUNTS = [100, 200, 300, 400, 500];

// מאמת את הקורא ומחזיר את שורת הסוכן/ת. זהה בשני המסלולים — הרשאה נבדקת
// לפני שנוגעים בכסף או פונים לספק חיצוני, לא אחרי.
async function resolveAgent(req: Request, supabase: any) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return { error: "missing_authorization", status: 401 };

  const authedClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await authedClient.auth.getUser();
  if (userErr || !userData?.user) return { error: "unauthorized", status: 401 };

  const { data: agentRow, error: agentErr } = await supabase
    .from("agency_members")
    .select("id, active, display_name")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (agentErr || !agentRow) return { error: "no_matching_agent_profile", status: 403 };
  if (!agentRow.active) return { error: "agent_inactive", status: 403 };

  return { agent: agentRow, email: userData.user.email ?? null };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST" && req.method !== "GET") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // ---- מצב המערכת, בלי לפתוח תשלום -----------------------------------
  if (req.method === "GET") {
    const resolved = await resolveAgent(req, supabase);
    if ("error" in resolved) return json({ error: resolved.error }, resolved.status);
    return json({
      configured: morningConfigured(),
      test_mode: !morningConfigured(),
      environment: morningConfigured() ? morningEnvLabel() : "test_mode",
      amounts: ALLOWED_AMOUNTS,
    });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const amount = Number(body?.amount);
  if (!ALLOWED_AMOUNTS.includes(amount)) return json({ error: "invalid_amount" }, 400);

  const resolved = await resolveAgent(req, supabase);
  if ("error" in resolved) return json({ error: resolved.error }, resolved.status);
  const { agent, email } = resolved;

  // ---- מסלול מצב הבדיקה ------------------------------------------------
  // אין ספק סליקה מוגדר. מתנהג בדיוק כפי שהתנהג עד היום, כולל הסימון —
  // שקיפות כאן חשובה יותר מאשר להיראות מוכן: מי שרואה "מצב בדיקה" יודע/ת
  // שלא חויב/ה, ומי שלא רואה — מצפה/ה לחיוב.
  if (!morningConfigured()) {
    const { data: result, error: rpcErr } = await supabase.rpc("process_wallet_topup", {
      p_agent_id: agent.id,
      p_amount: amount,
    });
    if (rpcErr) return json({ error: "db_error", detail: rpcErr.message }, 500);
    if (result?.error) return json(result, 400);
    return json({ ...result, test_mode: true }, 200);
  }

  // ---- מסלול הסליקה ----------------------------------------------------
  // 1. שורת pending אצלנו, **לפני** הפנייה למורנינג. הסדר הזה מכוון: המזהה
  //    שלה הוא מה שנשלח כאסמכתא, וכך לכל תשלום שייווצר שם כבר יש בית כאן.
  //    הסדר ההפוך היה יוצר תשלום שאין לו למי להיזקף.
  const { data: started, error: startErr } = await supabase.rpc("start_wallet_topup", {
    p_agent_id: agent.id,
    p_amount: amount,
  });
  if (startErr) return json({ error: "db_error", detail: startErr.message }, 500);
  if (started?.error) return json(started, 400);

  const topupId = started.topup_id as string;

  // 2. הסוד בכתובת ה-webhook. בלעדיו כל מי שיודע/ת את הכתובת יכול/ה לקרוא
  //    ל-callback; זו נקודת קצה ציבורית (‏verify_jwt=false) כי למורנינג אין
  //    JWT שלנו. אם הסוד לא הוגדר — עוצרים כאן ולא פותחים תשלום שלא נוכל
  //    לאשר בבטחה אחר כך.
  if (!webhookSecret) {
    await supabase.rpc("fail_wallet_topup", {
      p_topup_id: topupId,
      p_reason: "webhook_secret_not_configured",
    });
    return json({
      error: "morning_misconfigured",
      detail: "‏MORNING_WEBHOOK_SECRET אינו מוגדר ב-Edge Functions → Secrets.",
    }, 503);
  }

  const notifyUrl = `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/wallet-topup-callback` +
    `?token=${encodeURIComponent(webhookSecret)}`;

  const form = await createPaymentForm({
    amount,
    description: `טעינת ארנק — שוק נדל"ן`,
    clientName: agent.display_name || "סוכן/ת",
    clientEmail: email,
    // ‏topup_id ולא id: ‏crm.html מנקה מהכתובת רק את שני המפתחות האלה, ושם
    // גנרי היה מתנגש עם פרמטרים אחרים שהדף כבר קורא (‏invite, מפתחות OAuth).
    successUrl: `${siteBaseUrl}/crm.html?topup=success&topup_id=${topupId}`,
    failureUrl: `${siteBaseUrl}/crm.html?topup=failure&topup_id=${topupId}`,
    notifyUrl,
    reference: topupId,
  });

  // 3. מורנינג לא החזיר/ה טופס. הניסיון נסגר מיד — שורת pending שאין מאחוריה
  //    תשלום היא רק רעש בהיסטוריית החיובים של הסוכן/ת.
  if (!form.ok) {
    await supabase.rpc("fail_wallet_topup", { p_topup_id: topupId, p_reason: form.error });
    console.error("wallet-topup: form creation failed", form.error);
    return json({ error: "payment_provider_error" }, 502);
  }

  // 4. שמירת המזהים. ‏provider_form_id הוא מה שמאפשר ל-reconcile לשאול את
  //    מורנינג מה קרה לניסיון הזה, גם אם ה-webhook לעולם לא יגיע.
  await supabase
    .from("wallet_topups")
    .update({ provider_form_id: form.formId, provider_payment_url: form.url })
    .eq("id", topupId);

  return json({
    success: true,
    test_mode: false,
    topup_id: topupId,
    amount,
    redirect_url: form.url,
  }, 200);
});
