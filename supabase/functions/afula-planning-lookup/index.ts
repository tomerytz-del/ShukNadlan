import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { lookupPlanning } from "../_shared/afula-planning.ts";

// ============================================================================
// מידע תכנוני לסוכן/ת מחובר/ת — הכלי ב-CRM ובטופס הנכס
//
// השליפה עצמה יושבת ב-_shared/afula-planning.ts, כי planning-backfill צריכה
// אותה בדיוק והיא רצה מ-cron בלי משתמש/ת. כאן נשאר מה ששייך רק למסלול הזה:
// אימות, בדיקת מסלול Mid/Premium, מטמון של 24 שעות, וכתיבה ל-planning_lookups.
//
// ## ‏`property_id`: השמירה לנכס נעשית כאן, ולא בדפדפן
//
// עד מיגרציה 20270102090000 הדפדפן קיבל את התשובה ושמר אותה בעצמו ל-
// property_planning_info. ה-RLS התיר זאת לכל סוכן/ת על נכס שלו/ה, **בלי
// בדיקת מסלול** - כלומר סוכן/ת Pay&GO יכול/ה היה/תה לכתוב ייעוד, תוכניות
// וגאומטריה משלו/ה, והם הוצגו בדף הנכס כמידע מה-GIS. עכשיו לדפדפן מותר
// לכתוב שם גוש וחלקה בלבד (הקלדה ידנית מהסכם), והשמירה של תוצאת ה-WFS
// עוברת לכאן, עם service_role, אחרי בדיקת בעלות ומסלול.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: corsHeaders() });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing_authorization" }, 401);

  let body;
  try { body = await req.json(); } catch (e) { return json({ error: "invalid_json" }, 400); }
  const street = body.street, house_number = body.house_number, gush = body.gush, helka = body.helka;
  if (!(street && house_number) && !(gush && helka)) {
    return json({ error: "missing_fields", detail: "צריך street+house_number או gush+helka" }, 400);
  }

  const authedClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const authResult = await authedClient.auth.getUser();
  if (authResult.error || !authResult.data.user) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const agentResult = await supabase.from("agency_members").select("id, tier, active, billing_status").eq("user_id", authResult.data.user.id).maybeSingle();
  const agentRow = agentResult.data;

  if (!agentRow || !agentRow.active) return json({ error: "no_matching_agent_profile" }, 403);
  // מסלול שפג אינו מסלול (.claude/skills/new-tier-capability)
  if ((agentRow.tier !== "mid" && agentRow.tier !== "premium") || agentRow.billing_status !== "active") {
    return json({
      error: "upgrade_required",
      detail: "מידע תכנוני מלא זמין רק למנוי Mid/Premium",
      cta: "שדרג למנוי Mid או Premium כדי לקבל מידע על נכסים ללא הגבלה",
    }, 402);
  }

  // נכס לשמירה: רק נכס של הסוכן/ת עצמו/ה. נבדק **לפני** השליפה, כדי
  // שבקשה על נכס זר תיכשל מיד ולא אחרי קריאת WFS.
  const propertyId = typeof body.property_id === "string" ? body.property_id : null;
  if (propertyId) {
    const own = await supabase.from("properties").select("id")
      .eq("id", propertyId).eq("agent_id", agentRow.id).maybeSingle();
    if (own.error) return json({ error: "db_error", detail: own.error.message }, 500);
    if (!own.data) return json({ error: "not_your_property" }, 403);
  }

  // השמירה לנכס. כשל כאן אינו מפיל את התשובה: המידע נשלף, ו-planning-backfill
  // ישלים את השורה בסבב הבא.
  async function saveToProperty(d: Record<string, unknown>): Promise<boolean> {
    if (!propertyId) return false;
    const { error } = await supabase.from("property_planning_info").upsert({
      property_id: propertyId,
      gush: d.gush ?? null, helka: d.helka ?? null,
      parcel_area_sqm: d.parcel_area_sqm ?? null, parcel_status: d.parcel_status ?? null,
      land_use_designation: d.land_use_designation ?? null,
      applicable_plans: d.applicable_plans ?? null,
      geometry_wgs84: d.geometry_wgs84 ?? null,
      lat: d.lat ?? null, lng: d.lng ?? null,
      looked_up_at: new Date().toISOString(),
      source: "municipal_wfs",
    }, { onConflict: "property_id" });
    if (error) console.error("planning: save to property failed", propertyId, error.message);
    return !error;
  }

  const lookupKey = (gush && helka) ? (gush + ":" + helka) : (street + ":" + house_number);

  const cachedResult = await supabase.from("planning_lookups").select("*").eq("lookup_key", lookupKey).maybeSingle();
  const cached = cachedResult.data;
  if (cached && new Date(cached.looked_up_at).getTime() > Date.now() - 24 * 60 * 60 * 1000) {
    return json({ success: true, cached: true, saved: await saveToProperty(cached), data: cached });
  }

  try {
    const result = await lookupPlanning({ street, house_number, gush, helka });
    if (!result.ok) {
      return json({ error: result.error, detail: result.detail }, result.status);
    }

    const upsertResult = await supabase
      .from("planning_lookups")
      .upsert(result.record, { onConflict: "lookup_key" })
      .select().single();
    if (upsertResult.error) return json({ error: "db_error", detail: upsertResult.error.message }, 500);

    return json({ success: true, cached: false, saved: await saveToProperty(upsertResult.data), data: upsertResult.data });
  } catch (err) {
    return json({ error: "wfs_error", detail: String((err && err.message) || err) }, 500);
  }
});
