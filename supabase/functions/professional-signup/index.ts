import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  clientFrom,
  corsHeaders,
  createPaymentForm,
  json,
  morningConfigured,
} from "../_shared/morning.ts";

// ============================================================================
// הרשמת בעל/ת מקצוע לכרטיסיית "בעלי מקצוע נבחרים"
//
// מוצר פרסום של צד שלישי: מי שקונה אותו אינו סוכן/ת ואין לו/ה חשבון באתר —
// ולכן אין כאן JWT ואין בדיקת agency_members. הזהות היחידה שנוצרת היא אסימון
// הניהול, והוא הדרך היחידה לחזור ולערוך.
//
// **מה השתנה: עד היום ההרשמה "הצליחה" תמיד.** השורה נכנסה עם
// ‏`status='active'` ו-`test_mode=true`, והכרטיסייה עלתה לאוויר בלי שאיש
// שילם — בזמן ש-`terms.html` §15 מתאר מוצר בתשלום ו-`pricing_config` מחזיק
// את המחיר. כאן זה נסגר, על אותו מסלול דו-פאזי של טעינת הארנק ורכישת המנוי:
//
//   ‏1. הכרטיסייה נוצרת מיד, אבל כ-`pending_payment` — מצב שה-policy
//      הציבורית אינה מחזירה. מה שהוקלד בטופס נשמר, ואיש אינו רואה אותו.
//   ‏2. נפתחת שורת `ad_orders` ונוצר טופס תשלום אצל מורנינג.
//   ‏3. ‏`wallet-topup-callback` מאמת/ת מול ה-API שלהם ורק אז
//      ‏`complete_ad_order` מעלה את הכרטיסייה לאוויר וקובע/ת את התאריכים.
//
// **אין מסלול "מאשרים בכל זאת".** בלי מורנינג מוגדר ההרשמה נשמרת ומוחזרת
// תשובת `payment_unavailable` — הכרטיסייה ממתינה, ואיש אינו מקבל פרסום חינם.
// זו אותה דוקטרינה בדיוק שכתובה בראש `subscription-purchase`: ארנק במצב
// בדיקה הוא כסף מדומה שאפשר לסמן ככזה, וכרטיסייה שעלתה בלי תשלום היא מוצר
// אמיתי שניתן בחינם.
//
// ‏`action: "status"` הוא הצד השני של אותו מטבע: אחרי החזרה מעמוד התשלום אין
// למי לשאול "האם שולם", כי אין חשבון. הפעולה מחזירה את מצב ההזמנה, ואת
// אסימון הניהול **רק** אחרי שהתשלום אומת.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const siteBaseUrl = (Deno.env.get("SITE_BASE_URL") || "https://shuknadlan.co.il").replace(/\/+$/, "");
const webhookSecret = Deno.env.get("MORNING_WEBHOOK_SECRET") || "";

const VALID_TYPES = ["mortgage_advisor","appraiser","architect","interior_designer","real_estate_lawyer","general"];

const TYPE_LABELS: Record<string, string> = {
  mortgage_advisor: "יועץ/ת משכנתאות",
  appraiser: "שמאי/ת מקרקעין",
  architect: "אדריכל/ית",
  interior_designer: "מעצב/ת פנים",
  real_estate_lawyer: "עו״ד מקרקעין",
  general: "בעל/ת מקצוע",
};

// כתובות שנשמרות כאן מוזרקות בדף הבית ל-href ול-src של הכרטיסייה. הטופס
// פתוח לכל אחד, ולכן רק http/https נשמרים — ‎javascript:‎ בשדה הקישור היה
// הופך לכתובת שהכרטיסייה כולה מפעילה בלחיצה.
function safeUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function trimmedOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // ---- בדיקת מצב הזמנה אחרי החזרה מעמוד התשלום -------------------------
  if (body?.action === "status") {
    const orderId = String(body?.order_id || "");
    if (!orderId) return json({ error: "missing_order_id" }, 400);

    const { data: order } = await supabase
      .from("ad_orders")
      .select("id, status, placement_id, period_end, failure_reason")
      .eq("id", orderId)
      .maybeSingle();
    if (!order) return json({ error: "order_not_found" }, 404);

    // האסימון נמסר רק כשהתשלום אומת. בלי התנאי הזה די היה לנחש מזהה הזמנה
    // כדי לקבל מפתח עריכה לכרטיסייה של מישהו אחר.
    if (order.status !== "success") {
      return json({ success: true, status: order.status, paid: false });
    }

    const { data: access } = await supabase
      .from("ad_placement_access")
      .select("manage_token")
      .eq("placement_id", order.placement_id)
      .maybeSingle();

    return json({
      success: true,
      status: "success",
      paid: true,
      placement_id: order.placement_id,
      ends_at: order.period_end,
      manage_token: access?.manage_token ?? null,
    });
  }

  // ---- הרשמה ------------------------------------------------------------
  const { advertiser_name, advertiser_type, contact_email, target_region } = body;
  if (!advertiser_name || !advertiser_type || !contact_email) {
    return json({ error: "missing_fields", required: ["advertiser_name","advertiser_type","contact_email"] }, 400);
  }
  if (!VALID_TYPES.includes(advertiser_type)) {
    return json({ error: "invalid_advertiser_type", allowed: VALID_TYPES }, 400);
  }

  const months = Number.isInteger(body?.months) ? Number(body.months) : 1;
  if (months < 1 || months > 12) return json({ error: "invalid_months" }, 400);

  try {
    // ‏status='pending_payment' — נשמר, ולא מוצג לאיש עד שההזמנה תושלם.
    const { data: placement, error: insertErr } = await supabase
      .from("ad_placements")
      .insert({
        placement_type: "professional_card",
        advertiser_name,
        // שם העסק הוא השורה השנייה בכרטיסייה; כשהוא ריק התצוגה נופלת
        // לתחום העיסוק.
        business_name: trimmedOrNull(body.business_name),
        advertiser_type,
        contact_email,
        target_region: target_region || "עפולה",
        // תמונת הפרופיל שממלאת את האריח בדף הבית.
        creative_url: safeUrl(body.creative_url),
        click_url: safeUrl(body.click_url),
        // התאריכים נקבעים בהפעלה ולא כאן: 30 יום שמתחילים בזמן מילוי הטופס
        // הם 30 יום שחלקם נגמר לפני שהכרטיסייה בכלל עלתה.
        status: "pending_payment",
        price_model: "flat_monthly",
        test_mode: false,
      })
      .select()
      .single();

    if (insertErr) return json({ error: "db_error", detail: insertErr.message }, 500);

    // אסימון הניהול נוצר עכשיו אבל **אינו מוחזר עדיין** — הוא נמסר רק
    // ב-action:"status" אחרי שהתשלום אומת.
    const { error: accessErr } = await supabase
      .from("ad_placement_access")
      .insert({ placement_id: placement.id });
    if (accessErr) console.error("manage token creation failed", accessErr.message);

    // ---- בלי ספק סליקה אין פרסום --------------------------------------
    if (!morningConfigured() || !webhookSecret) {
      return json({
        success: true,
        paid: false,
        placement_id: placement.id,
        error: "payment_unavailable",
        detail: "הרשמה נקלטה, אך הסליקה אינה זמינה כרגע. ניצור קשר להשלמת התשלום.",
      }, 503);
    }

    // ---- פאזה 1: ההזמנה -----------------------------------------------
    const { data: started, error: startErr } = await supabase.rpc("start_ad_order", {
      p_placement_id: placement.id,
      p_months: months,
    });
    if (startErr) return json({ error: "db_error", detail: startErr.message }, 500);
    if (started?.error) return json(started, 400);

    const orderId = started.order_id as string;
    const amount = Number(started.amount);

    const label = TYPE_LABELS[advertiser_type] ?? "בעל/ת מקצוע";
    const desc = months === 1
      ? `כרטיסיית ${label} — חודש`
      : `כרטיסיית ${label} — ${months} חודשים`;

    const notifyUrl = `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/wallet-topup-callback` +
      `?token=${encodeURIComponent(webhookSecret)}`;

    const form = await createPaymentForm({
      amount,
      description: `${desc} — שוק נדל"ן`,
      ...clientFrom(body, advertiser_name),
      clientEmail: contact_email,
      successUrl: `${siteBaseUrl}/professional-signup.html?payment=success&order_id=${orderId}`,
      failureUrl: `${siteBaseUrl}/professional-signup.html?payment=failure&order_id=${orderId}`,
      notifyUrl,
      reference: orderId,
    });

    if (!form.ok) {
      await supabase.rpc("fail_ad_order", { p_order_id: orderId, p_reason: form.error });
      console.error("professional-signup: form creation failed", form.error);
      return json({ error: "payment_provider_error" }, 502);
    }

    await supabase
      .from("ad_orders")
      .update({ provider_form_id: form.formId, provider_payment_url: form.url })
      .eq("id", orderId);

    return json({
      success: true,
      paid: false,
      placement_id: placement.id,
      order_id: orderId,
      amount,
      months,
      redirect_url: form.url,
    });
  } catch (err: any) {
    return json({ error: "unhandled", detail: String(err?.message ?? err) }, 500);
  }
});
