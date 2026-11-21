import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/morning.ts";

// ============================================================================
// הקישור שבתחתית כל מייל של יריד הבתים הפתוחים — הסרה וחזרה.
//
//   ‏GET ?action=unsubscribe|resubscribe&token=…  → הפניה (302) לעמוד `/manage-alerts` באתר. לא משנה דבר.
//   ‏POST {action, token}                          → הביצוע בפועל. JSON בלבד.
//
// **למה העמוד באתר ולא כאן:** ‏Supabase מגישה HTML מהדומיין הרגיל כ-text/plain עם sandbox, ולכן עמוד האישור
// שהפונקציה הזו החזירה הוצג כקוד. הקישורים שכבר נשלחו במיילים מצביעים על הפונקציה, ולכן ה-GET נשאר וקופץ לאתר.
//
// **למה ביטול דורש POST ולא רק לחיצה על הקישור:** סורקי קישורים של ספקי
// מייל פותחים כל URL שבהודעה כדי לייצר תצוגה מקדימה. ‏GET שמסיר היה מסיר את
// כל מי שההודעה שלו נסרקה, בלי שנגע בכלום. ‏GET מציג עמוד, והכפתור שולח.
// זו אותה החלטה בדיוק כמו ב-saved-search-manage.
//
// **הטוקן הוא ההרשאה.** אין כאן חשבון ואין התחברות — הוא הגיע לנרשם/ת
// בהודעה ששלחנו אליו/ה, והוא מזהה שורה אחת בלבד.
//
// ‏resubscribe קיים כאן ולא בטופס ההרשמה מסיבה אחת: ‏open-house-subscribe
// **לא** מחזיר לרשימה מי שביקש/ה לצאת, כדי שכתובת שמישהו הקליד לא תחזיר
// אדם שביקש לצאת. הדרך לחזור היא הקישור הזה, שנמצא רק אצלו/ה.
//
// ‏פרוסה עם verify_jwt=false: הקורא/ת הוא אדם בדפדפן בלי חשבון.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE = (Deno.env.get("SITE_BASE_URL") || "https://shuknadlan.co.il").replace(/\/$/, "");

const ACTIONS = ["unsubscribe", "resubscribe"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });

  // ---- GET: הפניה לעמוד באתר. הטוקן ב-fragment, כדי ש-GA4 לא ירשום אותו ----
  if (req.method === "GET") {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "";
    const token = url.searchParams.get("token") || "";
    const frag = new URLSearchParams({ k: "oh", a: ACTIONS.includes(action) ? action : "", t: token });
    return new Response(null, {
      status: 302,
      headers: { Location: `${SITE}/manage-alerts#${frag}`, "Cache-Control": "no-store" },
    });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: { action?: unknown; token?: unknown };
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const action = typeof body.action === "string" ? body.action : "";
  const token = typeof body.token === "string" ? body.token : "";
  if (!token) return json({ error: "invalid_token" }, 400);
  if (!ACTIONS.includes(action)) return json({ error: "unknown_action" }, 400);

  const sb = createClient(supabaseUrl, serviceRoleKey);
  const { data: row, error: readError } = await sb
    .from("open_house_subscribers")
    .select("id, email, unsubscribed_at")
    .eq("unsubscribe_token", token)
    .maybeSingle();
  if (readError) {
    console.error("open house manage lookup failed", readError);
    return json({ error: "db_error" }, 500);
  }
  if (!row) return json({ error: "not_found" }, 404);

  if (action === "unsubscribe") {
    if (row.unsubscribed_at) return json({ success: true, status: "already_unsubscribed" });
    const { error } = await sb
      .from("open_house_subscribers")
      .update({ unsubscribed_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) {
      console.error("open house unsubscribe failed", error);
      return json({ error: "db_error" }, 500);
    }
    return json({ success: true, status: "unsubscribed" });
  }

  // resubscribe — והסמן מתאפס לעכשיו: מי שחוזר/ת אינו/ה מקבל/ת את כל מה
  // שהיה ביריד בזמן שלא היה/תה ברשימה
  const { error } = await sb
    .from("open_house_subscribers")
    .update({ unsubscribed_at: null, last_notified_at: new Date().toISOString(), last_error: null })
    .eq("id", row.id);
  if (error) {
    console.error("open house resubscribe failed", error);
    return json({ error: "db_error" }, 500);
  }
  return json({ success: true, status: "resubscribed" });
});
