import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import proj4 from "npm:proj4@2.9.0";

// גיאוקוד בסיסי (רחוב+מספר בית -> lat/lng) לעפולה בלבד, דרך שכבת נקודות
// הכתובות של עיריית עפולה (אותו WFS ששכבת "מידע תכנוני" ב-afula-planning-lookup
// משתמשת בו). בכוונה מופרד מ-afula-planning-lookup ולא כפוף להגבלת מנוי
// Mid/Premium: קבלת פין על המפה היא פונקציונליות בסיסית שצריכה לעבוד לכל
// סוכן/ת, בעוד ש-afula-planning-lookup נועדה למידע תכנוני מורחב (גוש/חלקה/
// תוכניות) שהוא כן פיצ'ר בתשלום.

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const WFS_URL = "https://layers.intertown.co.il/opengis/wfs";
const WFS_REFERER = "https://up.intertown.co.il/afl/public";

const ITM_DEF = "+proj=tmerc +lat_0=31.7343936111111 +lon_0=35.2045169444444 +k=1.0000067 +x_0=219529.584 +y_0=626907.39 +ellps=GRS80 +towgs84=23.772,17.49,17.859,-0.3132,-1.85274,1.67299,-5.4262 +units=m +no_defs +type=crs";
const WGS84_DEF = "+proj=longlat +datum=WGS84 +no_defs";

function itmToWgs84(x: number, y: number) {
  return proj4(ITM_DEF, WGS84_DEF, [x, y]);
}

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

async function wfsQuery(xmlBody: string) {
  const res = await fetch(WFS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/xml", "Referer": WFS_REFERER },
    body: xmlBody,
  });
  if (!res.ok) throw new Error("WFS request failed: " + res.status);
  return await res.json();
}

function streetVariants(street: string) {
  const variants = new Set([street]);
  if (street.endsWith("ה")) variants.add(street.slice(0, -1));
  else variants.add(street + "ה");
  variants.add(street.replace(/י/g, "יי"));
  variants.add(street.replace(/יי/g, "י"));
  return Array.from(variants);
}

async function addressToCoords(street: string, houseNumber: string) {
  for (const variant of streetVariants(street)) {
    const xml = '<wfs:GetFeature service="WFS" version="2.0.0" xmlns:wfs="http://www.opengis.net/wfs/2.0" xmlns:fes="http://www.opengis.net/fes/2.0" outputFormat="application/json" count="5">' +
      '<wfs:Query typeNames="afl_bld:afl_bld-Address_Points_1">' +
      '<fes:Filter><fes:And>' +
      '<fes:PropertyIsEqualTo><fes:ValueReference>שם_רחוב</fes:ValueReference><fes:Literal>' + variant + '</fes:Literal></fes:PropertyIsEqualTo>' +
      '<fes:PropertyIsEqualTo><fes:ValueReference>מספר_בית</fes:ValueReference><fes:Literal>' + houseNumber + '</fes:Literal></fes:PropertyIsEqualTo>' +
      '</fes:And></fes:Filter></wfs:Query></wfs:GetFeature>';
    const data = await wfsQuery(xml);
    const feature = data && data.features && data.features[0];
    if (feature && feature.properties && feature.properties.X && feature.properties.Y) {
      return { x: feature.properties.X, y: feature.properties.Y };
    }
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing_authorization" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const street = (body.street || "").trim();
  const houseNumber = (body.house_number || "").trim();
  if (!street || !houseNumber) return json({ error: "missing_fields", detail: "צריך street+house_number" }, 400);

  const authedClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await authedClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: agentRow, error: agentErr } = await supabase
    .from("agency_members").select("id, active").eq("user_id", userData.user.id).maybeSingle();
  if (agentErr || !agentRow) return json({ error: "no_matching_agent_profile" }, 403);
  if (!agentRow.active) return json({ error: "agent_inactive" }, 403);

  try {
    const coords = await addressToCoords(street, houseNumber);
    if (!coords) return json({ error: "address_not_found", detail: "לא נמצאה כתובת מתאימה בעפולה" }, 404);
    const [lng, lat] = itmToWgs84(coords.x, coords.y);
    return json({ success: true, lat, lng }, 200);
  } catch (err) {
    return json({ error: "wfs_error", detail: String((err && (err as Error).message) || err) }, 500);
  }
});
