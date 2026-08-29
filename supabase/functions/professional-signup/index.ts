import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// מודול 2 §5.6 — הרשמת בעל-מקצוע לכרטיסיית "בעלי מקצוע נבחרים". ציבורי צד-שלישי (לא
// סוכנים/משרדים) — לכן אין JWT, אין בדיקת agency_members. TEST MODE: אין
// עדיין ספק סליקה אמיתי מחובר — הרשמה "מצליחה" תמיד כרגע ומסומנת test_mode=true.

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

const VALID_TYPES = ["mortgage_advisor","appraiser","architect","interior_designer","real_estate_lawyer","general"];

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

  const { advertiser_name, advertiser_type, contact_email, target_region } = body;
  if (!advertiser_name || !advertiser_type || !contact_email) {
    return json({ error: "missing_fields", required: ["advertiser_name","advertiser_type","contact_email"] }, 400);
  }
  if (!VALID_TYPES.includes(advertiser_type)) {
    return json({ error: "invalid_advertiser_type", allowed: VALID_TYPES }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
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
        starts_at: new Date().toISOString().slice(0,10),
        ends_at: new Date(Date.now() + 30*24*60*60*1000).toISOString().slice(0,10),
        status: "active",
        price_model: "flat_monthly",
        monthly_price: 350,
        test_mode: true,
      })
      .select()
      .single();

    if (insertErr) return json({ error: "db_error", detail: insertErr.message }, 500);

    return json({ success: true, placement_id: placement.id, ends_at: placement.ends_at, test_mode: true });
  } catch (err: any) {
    return json({ error: "unhandled", detail: String(err?.message ?? err) }, 500);
  }
});
