import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { afulaAddressToCoords } from "../_shared/afula-geocode.ts";

// גיאוקוד בסיסי (רחוב+מספר בית -> lat/lng) לעפולה בלבד, דרך שכבת נקודות
// הכתובות של עיריית עפולה (אותו WFS ששכבת "מידע תכנוני" ב-afula-planning-lookup
// משתמשת בו). בכוונה מופרד מ-afula-planning-lookup ולא כפוף להגבלת מנוי
// Mid/Premium: קבלת פין על המפה היא פונקציונליות בסיסית שצריכה לעבוד לכל
// סוכן/ת, בעוד ש-afula-planning-lookup נועדה למידע תכנוני מורחב (גוש/חלקה/
// תוכניות) שהוא כן פיצ'ר בתשלום.
//
// זה המסלול ה**סינכרוני**: מסך הנכס ב-CRM קורא לכאן בזמן שמירה, כשיש כתובת
// ואין קואורדינטות. המסלול השני, geocode-backfill, סורק מאוחר יותר את מה
// שנשמר בלי קואורדינטות בכל זאת (ייבוא מרוכז, ‏WFS שהיה למטה) — שתיהן
// חולקות את אותה לוגיקת כתובת ב-_shared/afula-geocode.ts.
// ראו docs/geocoding.md.

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
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: corsHeaders() });
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
    const coords = await afulaAddressToCoords(street, houseNumber);
    if (!coords) return json({ error: "address_not_found", detail: "לא נמצאה כתובת מתאימה בעפולה" }, 404);
    return json({ success: true, lat: coords.lat, lng: coords.lng }, 200);
  } catch (err) {
    return json({ error: "wfs_error", detail: String((err && (err as Error).message) || err) }, 500);
  }
});
