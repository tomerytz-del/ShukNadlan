import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  authUrl,
  disconnectAgent,
  GCAL_PUBLISHED,
  googleCalendarConfigured,
} from "../_shared/google-calendar.ts";

// ============================================================================
// חיבור וניתוק של יומן Google - נקרא מה-CRM, עם ה-JWT של הסוכן/ת.
//
//   ‏start      → כתובת ההסכמה של Google. הדפדפן עובר אליה, ו-Google מחזירה
//                 אל `google-calendar-callback`.
//   ‏disconnect → מחיקת יומן המשנה ב-Google, ביטול ההרשאה ומחיקת הטוקן.
//
// **החיבור מתחיל רק כאן, בלחיצה על "חבר/י יומן".** הכניסה ל-CRM עם Google
// אינה מבקשת הרשאת יומן, ובכוונה - ראו docs/google-calendar.md.
//
// ‏verify_jwt = true: ה-Gateway חוסם קריאה בלי JWT, והזהות נקבעת כאן מה-JWT
// ולא מגוף הבקשה - אי אפשר לבקש חיבור בשם אחר/ת.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

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

  let body: { action?: string };
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const authed = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await authed.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: member } = await supabase
    .from("agency_members")
    .select("id, email, active, is_platform_admin")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (!member || !member.active) return json({ error: "no_matching_agent_profile" }, 403);

  const action = String(body.action || "");

  if (action === "disconnect") {
    // ניתוק מותר גם למי שהמסלול שלו/ה פג: זו הדרך החוצה, והיא אינה נחסמת.
    const result = await disconnectAgent(supabase, member.id, "revoked");
    return json({ ok: true, ...result });
  }

  if (action === "start") {
    if (!googleCalendarConfigured()) {
      return json({
        error: "not_configured",
        detail: "החיבור ליומן Google עוד לא הוגדר במערכת. פנו לתמיכה.",
      }, 503);
    }
    // עד שהאפליקציה מאומתת ב-Google, רק מנהל/ת הפלטפורמה. הכפתור מוסתר
    // לשאר ב-CRM, וזו האכיפה: בקשה ישירה לנקודת הקצה מקבלת את אותה תשובה.
    if (!GCAL_PUBLISHED && !member.is_platform_admin) {
      return json({
        error: "not_available_yet",
        detail: "החיבור ליומן Google ייפתח לכל הסוכנים בקרוב.",
      }, 403);
    }
    const { data: enabled } = await supabase.rpc("agent_agenda_enabled", { p_agent_id: member.id });
    if (!enabled) {
      return json({
        error: "tier_required",
        required_tier: "mid",
        detail: "החיבור ליומן Google הוא חלק מהיומן, שזמין במסלולים PROFESSIONAL ו-Elite.",
      }, 403);
    }
    return json({ ok: true, url: await authUrl(member.id, member.email || userData.user.email) });
  }

  return json({ error: "unknown_action" }, 400);
});
