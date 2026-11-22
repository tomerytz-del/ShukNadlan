import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/morning.ts";

// ============================================================================
// הקישורים שבתוך ההתראה — קליק והפסקת התראות.
//
// שתי פעולות שנראות שונות אבל הן אותו דבר: כתובת GET שמחפש/ת דירה לוחצ/ת
// עליה מתוך וואטסאפ או מייל, בלי חשבון ובלי התחברות. הטוקן הוא ההרשאה —
// הוא הגיע להם בהודעה ששלחנו אליהם.
//
//   ‏?action=click&token=…        → מונה קליק ומפנה לעמוד הנכס
//   ‏GET ?action=unsubscribe&token=…  → הפניה (302) לעמוד `/manage-alerts` באתר. לא משנה דבר.
//   ‏POST {action, tokens[]}          → הביצוע בפועל. JSON בלבד.
//
// **למה העמוד באתר ולא כאן:** ‏Supabase מגישה HTML מהדומיין הרגיל כ-text/plain עם sandbox, והעמוד שהפונקציה
// החזירה הוצג כקוד. הקישורים שכבר נשלחו מצביעים על הפונקציה, ולכן ה-GET נשאר וקופץ לאתר.
//
// ‏למה ביטול דורש POST ולא רק לחיצה על הקישור: סורקי קישורים של ספקי מייל
// ושל וואטסאפ פותחים כל URL שבהודעה כדי לייצר תצוגה מקדימה. ‏GET שמבטל היה
// מבטל את ההתראות של כל מי שההודעה שלו נסרקה, בלי שנגע/ה בכלום. ‏GET מציג
// עמוד, והכפתור שבו הוא ששולח את הפעולה.
//
// ‏פרוסה עם --no-verify-jwt: הקורא/ת הוא אדם בדפדפן בלי חשבון.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_BASE_URL = (Deno.env.get("SITE_BASE_URL") || "").replace(/\/$/, "");
const SITE = SITE_BASE_URL || "https://shuknadlan.co.il";

const ACTIONS = ["unsubscribe", "pause", "resume"];

const cleanTokens = (raw: unknown[]): string[] =>
  [...new Set(raw.flatMap((p) => String(p ?? "").split(",")).map((t) => t.trim()).filter(Boolean))].slice(0, 20);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });

  const url = new URL(req.url);

  if (req.method === "GET") {
    const action = url.searchParams.get("action") || "";
    const tokens = cleanTokens(url.searchParams.getAll("token"));
    if (!tokens.length) return Response.redirect(`${SITE}/manage-alerts#${new URLSearchParams({ k: "ss", a: "" })}`, 302);

    // ---- קליק: ספירה והפניה ל-נכס ---------------------------------------
    if (action === "click") {
      const sb = createClient(supabaseUrl, serviceRoleKey);
      const { data: propertyId, error } = await sb.rpc("click_saved_search_alert", { p_token: tokens[0] });
      // כישלון בספירה לא ימנע מאדם להגיע לנכס שרצה לראות. המדידה משרתת אותנו, לא אותו/ה.
      if (error) console.error("click count failed", error.message);
      // נכס שאינו זמין: דף "נכס לא נמצא" באתר, לא עמוד מהפונקציה
      const target = propertyId
        ? `${SITE}/property?id=${encodeURIComponent(String(propertyId))}`
        : `${SITE}/manage-alerts#${new URLSearchParams({ k: "ss", a: "gone" })}`;
      return new Response(null, { status: 302, headers: { Location: target, "Cache-Control": "no-store" } });
    }

    // ---- ניהול: הפניה לעמוד באתר, הטוקנים ב-fragment (GA4 לא רושם אותו) ----
    const frag = new URLSearchParams({ k: "ss", a: ACTIONS.includes(action) ? action : "", t: tokens.join(",") });
    return new Response(null, {
      status: 302,
      headers: { Location: `${SITE}/manage-alerts#${frag}`, "Cache-Control": "no-store" },
    });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // גוף JSON מהעמוד באתר. טופס ישן שנשאר פתוח בלשונית שולח את הפרמטרים בכתובת, ולכן הם גיבוי
  let body: { action?: unknown; tokens?: unknown } = {};
  try { body = await req.json(); } catch { /* ללא גוף: כתובת בלבד */ }
  const action = typeof body.action === "string" ? body.action : (url.searchParams.get("action") || "");
  const tokens = cleanTokens(Array.isArray(body.tokens) ? body.tokens : url.searchParams.getAll("token"));
  if (!tokens.length) return json({ error: "invalid_token" }, 400);
  if (!ACTIONS.includes(action)) return json({ error: "unknown_action" }, 400);

  // ---- POST: הביצוע. כמה טוקנים = כל החיפושים שההודעה כיסתה. --------
  const sb = createClient(supabaseUrl, serviceRoleKey);
  let doneStatus = "";
  let label = "";
  let ok = 0;
  let missing = 0;
  let already = 0;
  for (const one of tokens) {
    const { data: result, error } = await sb.rpc("manage_saved_search", { p_token: one, p_action: action });
    if (error) return json({ error: "db_error" }, 500);
    if (result?.error === "not_found") { missing++; continue; }
    if (result?.error === "already_unsubscribed") { already++; continue; }
    if (result?.error) return json({ error: "action_failed" }, 400);
    ok++;
    doneStatus = String(result?.status || doneStatus);
    if (!label && result?.label) label = String(result.label);
  }
  if (!ok && already && !missing) return json({ success: true, status: "already_unsubscribed" });
  if (!ok) return json({ error: "not_found" }, 404);
  return json({ success: true, status: doneStatus, count: ok, label: tokens.length === 1 ? label : "" });
});
