import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// עריכה עצמית של כרטיסיית בעל-מקצוע (professional-manage.html).
//
// אין לבעלי מקצוע חשבון באתר — הם לא סוכנים ולא משרדים — ולכן ההרשאה כאן
// היא אסימון ולא JWT: הקישור שהתקבל בסיום ההרשמה מכיל manage_token, והוא
// המפתח לכרטיסייה *אחת*. האסימון יושב ב-ad_placement_access, טבלה שאין
// אליה גישה מהלקוח בשום מפתח ציבורי, ולכן כל קריאה אליה עוברת דרך כאן עם
// service_role. verify_jwt=false מסיבה זו בדיוק.
//
// שני מסלולים: load (טעינת הכרטיסייה למסך העריכה) ו-save (שמירת השדות
// שמותר לבעל/ת המקצוע לשנות). מה שנוגע לכסף ולתקופת הפרסום —
// status, monthly_price, starts_at/ends_at, test_mode — לא נגזר מהבקשה
// בשום מקרה, גם אם נשלח בגוף שלה.

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
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// אותו סינון כמו בהרשמה: הכתובות נכנסות ל-href ול-src של הכרטיסייה בדף
// הבית, ולכן רק http/https נשמרים.
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

// השדות שהמסך מציג ומחזיר — במפורש, ולא select('*'): הכרטיסייה נושאת גם
// contact_email ונתוני חיוב, ואין סיבה שהם יעברו הלוך ושוב בדפדפן.
const CARD_FIELDS = "id, advertiser_name, business_name, advertiser_type, target_region, creative_url, click_url, status, starts_at, ends_at";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!UUID_RE.test(token)) return json({ error: "invalid_token" }, 400);

  const action = body.action === "save" ? "save" : "load";
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const { data: access, error: accessErr } = await supabase
      .from("ad_placement_access")
      .select("placement_id")
      .eq("manage_token", token)
      .maybeSingle();

    if (accessErr) return json({ error: "db_error", detail: accessErr.message }, 500);
    // אותה תשובה בדיוק לאסימון לא קיים ולכרטיסייה שנמחקה — אין כאן מה
    // להסגיר על אסימונים של אחרים.
    if (!access) return json({ error: "not_found" }, 404);

    if (action === "load") {
      const { data: card, error } = await supabase
        .from("ad_placements")
        .select(CARD_FIELDS)
        .eq("id", access.placement_id)
        .maybeSingle();
      if (error) return json({ error: "db_error", detail: error.message }, 500);
      if (!card) return json({ error: "not_found" }, 404);
      return json({ success: true, card });
    }

    const advertiser_name = trimmedOrNull(body.advertiser_name);
    if (!advertiser_name) return json({ error: "missing_fields", required: ["advertiser_name"] }, 400);
    if (body.advertiser_type !== undefined && !VALID_TYPES.includes(body.advertiser_type)) {
      return json({ error: "invalid_advertiser_type", allowed: VALID_TYPES }, 400);
    }

    const patch: Record<string, unknown> = {
      advertiser_name,
      business_name: trimmedOrNull(body.business_name),
      creative_url: safeUrl(body.creative_url),
      click_url: safeUrl(body.click_url),
    };
    if (body.advertiser_type !== undefined) patch.advertiser_type = body.advertiser_type;
    if (body.target_region !== undefined) patch.target_region = trimmedOrNull(body.target_region) ?? "עפולה";

    const { data: card, error } = await supabase
      .from("ad_placements")
      .update(patch)
      .eq("id", access.placement_id)
      .select(CARD_FIELDS)
      .maybeSingle();

    if (error) return json({ error: "db_error", detail: error.message }, 500);
    if (!card) return json({ error: "not_found" }, 404);
    return json({ success: true, card });
  } catch (err: any) {
    return json({ error: "unhandled", detail: String(err?.message ?? err) }, 500);
  }
});
