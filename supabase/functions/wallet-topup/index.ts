import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  clientFrom,
  corsHeaders,
  createPaymentForm,
  json,
  morningConfigured,
  morningEnvLabel,
  isTerminalMissing,
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
// **שני מסלולים:**
//
//   רגיל               → start_wallet_topup + טופס תשלום. כסף אמיתי.
//   ‏test_mode: true    → process_wallet_topup. זיכוי מיידי, מסומן כבדיקה —
//                         **למנהל/ת פלטפורמה בלבד** (‏is_platform_admin).
//
// עד ספטמבר 2026 המסלול השני קרה **מעצמו** כשמורנינג לא הוגדר, לכל
// סוכן/ת. זה אפשר את המיזוג לפני שהסליקה חוברה, והפך כל סוד חסר לכסף
// בחינם. מורנינג לא מוגדר מחזיר עכשיו morning_not_configured (503).
//
// ‏GET מחזיר את המצב בלי לפתוח תשלום: האם הסליקה פעילה, והאם הקורא/ת
// רשאי/ת לטעינת בדיקה. ‏verify_jwt=true, ולכן גם הוא דורש התחברות.
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
    .select("id, active, display_name, is_platform_admin")
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
      // אין יותר "מצב בדיקה" אוטומטי. ‏test_mode נשאר בתשובה (false) כדי
      // שלקוח ישן לא יציג הצהרה שגויה.
      test_mode: false,
      environment: morningConfigured() ? morningEnvLabel() : "not_configured",
      // טעינה בלי חיוב — מנהל/ת פלטפורמה בלבד, ורק כשביקש/ה אותה במפורש.
      can_test_topup: resolved.agent.is_platform_admin === true,
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

  // ---- טעינה בלי חיוב — מנהל/ת פלטפורמה בלבד ------------------------
  // עד היום זה קרה **אוטומטית** כשמורנינג לא הוגדר: כל סוכן/ת קיבל/ה כסף
  // בארנק בלי לשלם, וסוד שנמחק בטעות היה הופך את האתר לחלוקת קרדיט. מעכשיו
  // זו בקשה מפורשת (`test_mode: true`), והיא נענית רק למנהל/ת פלטפורמה.
  // השורה נשמרת עם test_mode=true ב-process_wallet_topup, כמו קודם.
  if (body?.test_mode === true) {
    if (agent.is_platform_admin !== true) {
      return json({ error: "test_topup_forbidden" }, 403);
    }
    const { data: result, error: rpcErr } = await supabase.rpc("process_wallet_topup", {
      p_agent_id: agent.id,
      p_amount: amount,
    });
    if (rpcErr) return json({ error: "db_error", detail: rpcErr.message }, 500);
    if (result?.error) return json(result, 400);
    console.log("wallet-topup: admin test top-up", agent.id, amount);
    return json({ ...result, test_mode: true }, 200);
  }

  // ---- בלי ספק סליקה אין טעינה ---------------------------------------
  // שגיאה ולא כסף מדומה. זו אותה דוקטרינה של professional-signup: תקלה
  // בהגדרות היא תקלה, לא הטבה.
  if (!morningConfigured()) {
    return json({ error: "morning_not_configured" }, 503);
  }

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

  const client = clientFrom(body, agent.display_name);

  const form = await createPaymentForm({
    amount,
    description: `טעינת ארנק - שוק נדל"ן`,
    ...client,
    clientEmail: email,
    // ‏topup_id ולא id: ‏crm.html מנקה מהכתובת רק את שני המפתחות האלה, ושם
    // גנרי היה מתנגש עם פרמטרים אחרים שהדף כבר קורא (‏invite, מפתחות OAuth).
    successUrl: `${siteBaseUrl}/crm?topup=success&topup_id=${topupId}`,
    failureUrl: `${siteBaseUrl}/crm?topup=failure&topup_id=${topupId}`,
    notifyUrl,
    reference: topupId,
  });

  // 3. מורנינג לא החזיר/ה טופס. הניסיון נסגר מיד — שורת pending שאין מאחוריה
  //    תשלום היא רק רעש בהיסטוריית החיובים של הסוכן/ת.
  if (!form.ok) {
    await supabase.rpc("fail_wallet_topup", { p_topup_id: topupId, p_reason: form.error });
    console.error("wallet-topup: form creation failed", form.error);
    return json({
      error: isTerminalMissing(form.error) ? "payment_terminal_missing" : "payment_provider_error",
    }, 502);
  }

  // 4. שמירת המזהים. ‏provider_form_id הוא מה שמאפשר ל-reconcile לשאול את
  //    מורנינג מה קרה לניסיון הזה, גם אם ה-webhook לעולם לא יגיע.
  await supabase
    .from("wallet_topups")
    .update({ provider_form_id: form.formId, provider_payment_url: form.url })
    .eq("id", topupId);

  // 5. פרטי החשבונית, לפעם הבאה.
  //
  //    עד היום הם הוקלדו מחדש בכל טעינה: שם, טלפון, מדינה, שם עסק ו-ח.פ —
  //    חמישה שדות שאינם משתנים לעולם. ‏ח.פ שמוקלד שוב הוא ח.פ שאפשר להקליד
  //    שגוי, וחשבונית עם מספר שגוי צריך לבטל ולהפיק מחדש.
  //
  //    **נשמר בדיוק מה שנשלח לספק הסליקה**, ומכאן ולא מהטופס: זו הערובה
  //    שמה שיוצע בפעם הבאה הוא מה שמודפס על החשבונית של הפעם הזו, ולא
  //    מחרוזת שעברה מסלול אחר. ‏upsert ולא insert — זו שורה אחת לכל סוכן/ת,
  //    והרכישה האחרונה היא מה שמעניין.
  //
  //    כישלון כאן אינו נוגע בתשלום: הטופס כבר נפתח, והנוחות היחידה שאובדת
  //    היא מילוי אוטומטי בפעם הבאה. לכן אין כאן החזרת שגיאה.
  //
  //    שם האדם ושם העסק נשמרים **בנפרד**, בעוד שעל החשבונית מודפס רק אחד
  //    מהם (`clientName` — שם העסק גובר כשיש ח.פ). שמירת המיזוג בלבד הייתה
  //    מחזירה בפעם הבאה את שם העסק לשדה "שם פרטי" בטופס.
  const text = (v: unknown, max: number) =>
    typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
  const business = text((body as any)?.client_business, 100);
  const person = text((body as any)?.client_name, 100);

  const { error: billingErr } = await supabase.from("agent_billing_profiles").upsert({
    agent_id: agent.id,
    client_name: person || client.clientName,
    business: business || null,
    tax_id: client.clientTaxId,
    phone: client.clientPhone,
    country: client.clientCountry,
    updated_at: new Date().toISOString(),
  });
  if (billingErr) console.warn("wallet-topup: billing profile not saved", billingErr.message);

  return json({
    success: true,
    test_mode: false,
    topup_id: topupId,
    amount,
    redirect_url: form.url,
  }, 200);
});
