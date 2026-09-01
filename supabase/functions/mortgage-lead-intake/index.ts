import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { audienceSize, logLeadRouting } from "../_shared/lead-routing.ts";

// ============================================================================
// קליטת ליד ייעוץ משכנתאות מטופס המחשבון בדף הבית.
//
// אותה תבנית כמו owner-lead-intake: הקורא/ת הוא מבקר/ת אנונימי/ת באתר עם
// ה-anon key, והכתיבה עצמה נעשית ב-service_role — כי mortgage_leads סגורה
// ל-anon לגמרי (שם, טלפון ואימייל של אדם פרטי יושבים שם).
//
// שני דברים שהפונקציה הזו אחראית עליהם ואי אפשר לסמוך על הדפדפן בהם:
//   1. ולידציה — שם וטלפון תקינים, אימייל תקין אם הוזן.
//   2. חישוב מחדש של loan_amount ו-ltv_pct מהמחיר וההון העצמי, במקום לקבל
//      אותם כמו שהם. הם משפיעים על מה שהיועצ/ת רואה לפני ששילמ/ה ₪50.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: corsHeaders() });
}

// מספר לא-שלילי בתוך תקרה שפויה, או null. התקרות אינן ולידציה עסקית אלא
// הגנה מפני זבל שיעוות את המדף (‏₪999,999,999 בכרטיס הליד).
function num(value: unknown, max: number): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > max) return null;
  return n;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const fullName = String(body.full_name ?? "").trim();
  const phone = String(body.phone ?? "").trim();
  const emailRaw = String(body.email ?? "").trim();

  if (fullName.length < 2) return json({ error: "invalid_name" }, 400);
  if (phone.replace(/\D/g, "").length < 9) return json({ error: "invalid_phone" }, 400);
  if (emailRaw && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
    return json({ error: "invalid_email" }, 400);
  }

  const propertyPrice = num(body.property_price, 100_000_000);
  const equity = num(body.equity, 100_000_000);
  const loanAmount =
    propertyPrice !== null && equity !== null ? Math.max(propertyPrice - equity, 0) : null;
  const ltvPct =
    propertyPrice !== null && propertyPrice > 0 && loanAmount !== null
      ? Math.round((loanAmount / propertyPrice) * 10000) / 100
      : null;

  const years = num(body.years, 40);

  // ‏source הוא תווית סגורה ולא טקסט חופשי מהדפדפן — היא מוצגת ליועצ/ת במדף
  // ומשמשת לפילוח, ואין סיבה לתת ללקוח לכתוב לתוכה מה שירצה.
  const SOURCES = ["homepage_calculator", "property_page"];
  const source = SOURCES.includes(body.source) ? body.source : "homepage_calculator";

  // ‏property_id נכתב רק אם הוא UUID תקין. ערך שגוי היה מפיל את ה-insert על
  // ה-FK ומחזיר לפונה כישלון על משהו שאינו באשמתו.
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const propertyId =
    typeof body.property_id === "string" && uuidRe.test(body.property_id)
      ? body.property_id
      : null;

  const row = {
    full_name: fullName,
    phone,
    email: emailRaw || null,
    owns_property: body.owns_property === true,
    property_price: propertyPrice,
    equity,
    loan_amount: loanAmount,
    interest_rate: num(body.interest_rate, 100),
    years: years === null ? null : Math.max(1, Math.round(years)),
    monthly_payment: num(body.monthly_payment, 10_000_000),
    ltv_pct: ltvPct,
    property_id: propertyId,
    source,
  };

  const serviceClient = createClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await serviceClient
    .from("mortgage_leads")
    .insert(row)
    .select("id")
    .single();

  if (error) {
    // 23505 = כבר קיים ליד פתוח מאותו מספר טלפון
    // (mortgage_leads_open_phone_key). מבחינת הפונה זו הצלחה — הפנייה שלו/ה
    // כבר במערכת — ולכן לא מחזירים שגיאה שתיראה לו/ה ככישלון.
    if ((error as any).code === "23505") {
      return json({ success: true, duplicate: true }, 200);
    }
    return json({ error: "db_error", detail: error.message }, 500);
  }

  /* רישום הניתוב.
     ‏ליד משכנתא נכנס למדף שרשאים לקנות ממנו רק חשבונות שסומנו
     ‏is_mortgage_advisor. כשאין אף אחד כזה הליד יושב במדף שאיש לא רואה —
     וזה בדיוק המצב היום. הרישום כאן הוא מה שהופך את זה מבעיה שקופה
     להתראה אצל מנהל/ת הפלטפורמה. */
  const advisors = await audienceSize(serviceClient, "mortgage_advisor");
  await logLeadRouting(serviceClient, {
    source: source === "property_page" ? "property_page_mortgage_calc" : "homepage_mortgage_calc",
    lead_kind: "mortgage_advisor",
    lead_table: "mortgage_leads",
    lead_id: data.id,
    routing: advisors > 0 ? "shelf" : "unrouted",
    recipients: Math.max(advisors, 0),
    reason: advisors > 0 ? null : "no_mortgage_advisor",
    summary: [
      propertyPrice !== null ? `נכס ${Math.round(propertyPrice).toLocaleString("he-IL")} ₪` : null,
      equity !== null ? `הון עצמי ${Math.round(equity).toLocaleString("he-IL")} ₪` : null,
      ltvPct !== null ? `${ltvPct}% מימון` : null,
      body.owns_property === true ? "יש ברשותו/ה דירה" : null,
    ].filter(Boolean).join(" · "),
  });

  return json({ success: true, lead_id: data.id }, 200);
});
