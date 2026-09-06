import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { authorizeInternalCaller } from "../_shared/cron-auth.ts";

/* ============================================================================
 * העברת תמונות הנכסים מהפרויקט הישן — פאזה 1: העתקת הקבצים
 *
 * הסרטונים כבר עברו; התמונות נשארו. ‏156 קבצים בדלי ‎site-photos‎ של
 * ‎nadlan-afula‎, ו-221 הפניות אליהם משלוש עמודות. כל עוד הם שם, כיבוי
 * הפרויקט הישן מוחק את התמונות מ-47 מודעות פעילות.
 *
 * הפונקציה הזו רק מעתיקה ורושמת. היא לא נוגעת ב-‎properties‎, ב-‎property_image_tags‎
 * ולא ב-‎property_visualizations‎ — השכתוב הוא פאזה 2, טרנזקציה אחת עם
 * הטריגר ‎properties_enqueue_base_visualization‎ מושבת. הסיבה כתובה במיגרציה
 * ‎20261003090000‎: אותו טריגר יורה על כל כתיבה ל-‎images‎, ובבדיקה הוא היה
 * מזמין 47 הדמיות AI חדשות על שינוי כתובת טכני.
 *
 * מה שהיא *לא* מקבלת: אילו קבצים להעביר. התור מגיע מ-‎legacy_photo_queue‎,
 * שמחזירה רק כתובות שכבר מופנות אליהן מהמסד עצמו ושטרם הועתקו. הקלט היחיד
 * הוא ‎limit‎ — כמה בקריאה אחת — כי 51MB בקריאה אחת חורגים מחלון הזמן.
 *
 * אידמפוטנטית דרך ‎legacy_photo_moves‎: קובץ שהועתק לא חוזר לתור, ולכן
 * ריצה שנקטעה ממשיכה מהמקום שנעצרה במקום לשכפל קבצים.
 * ========================================================================= */

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const IMAGES_BUCKET = "property-images";
// כל 254 הקבצים בדלי הישן הם image/jpeg — נבדק מול storage.objects שם.
const CONTENT_TYPE = "image/jpeg";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 60;

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-alert-cron-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: corsHeaders() });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = authorizeInternalCaller(req);
  if (!auth.ok) return json({ error: auth.error, detail: auth.detail }, auth.status);

  let limit = DEFAULT_LIMIT;
  try {
    const body = await req.json();
    const n = Number(body?.limit);
    if (Number.isFinite(n) && n > 0) limit = Math.min(Math.floor(n), MAX_LIMIT);
  } catch { /* גוף ריק הוא קריאה תקינה */ }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: queue, error: queueErr } = await supabase
    .rpc("legacy_photo_queue", { p_limit: limit });
  if (queueErr) return json({ error: "queue_failed", detail: queueErr.message }, 500);
  if (!queue?.length) return json({ moved: 0, left: 0, done: true, results: [] });

  const results: Array<Record<string, unknown>> = [];
  let moved = 0;

  for (const item of queue) {
    const legacyUrl: string = item.legacy_url;

    let bytes: ArrayBuffer;
    try {
      const res = await fetch(legacyUrl);
      if (!res.ok) { results.push({ legacyUrl, status: "source_unreachable", detail: `HTTP ${res.status}` }); continue; }
      bytes = await res.arrayBuffer();
    } catch (e) {
      results.push({ legacyUrl, status: "source_fetch_failed", detail: String(e) });
      continue;
    }

    /* אותו נתיב שה-CRM כותב אליו: ‎<agent_id>/<property_id>/<uuid>.jpg‎.
       ‏legacy/ הוא נפילה־לאחור לקובץ שאיבד את הנכס או את הסוכן/ת שלו —
       הוא עדיין מועבר, כי מחיקת הפרויקט הישן תשבור גם אותו, אבל הוא לא
       מתחזה לקובץ שיש לו בעלים. */
    const folder = item.agent_id ?? "legacy";
    const sub = item.property_id ?? "unassigned";
    const path = `${folder}/${sub}/${crypto.randomUUID()}.jpg`;

    const { error: uploadErr } = await supabase.storage.from(IMAGES_BUCKET).upload(path, bytes, {
      contentType: CONTENT_TYPE, cacheControl: "31536000", upsert: false,
    });
    if (uploadErr) { results.push({ legacyUrl, status: "upload_failed", detail: uploadErr.message }); continue; }

    const newUrl = supabase.storage.from(IMAGES_BUCKET).getPublicUrl(path).data.publicUrl;

    /* הרישום הוא מה שמוציא את הקובץ מהתור, ולכן כישלון שלו חייב למחוק את
       מה שהעלינו: בלי זה הקובץ היה חוזר בקריאה הבאה ומועלה שוב, ובדלי
       היו נערמים עותקים שאיש לא מצביע עליהם. */
    const { error: logErr } = await supabase.from("legacy_photo_moves").insert({
      legacy_url: legacyUrl,
      new_url: newUrl,
      bytes: bytes.byteLength,
      property_id: item.property_id,
    });
    if (logErr) {
      await supabase.storage.from(IMAGES_BUCKET).remove([path]);
      results.push({ legacyUrl, status: "log_failed", detail: logErr.message });
      continue;
    }

    moved++;
    results.push({ legacyUrl, status: "moved", bytes: bytes.byteLength, newUrl });
  }

  // כמה עוד בתור אחרי המנה הזו — כדי שהקורא ידע אם לחזור בלי לנחש
  const { data: nextQueue } = await supabase.rpc("legacy_photo_queue", { p_limit: MAX_LIMIT });
  const left = nextQueue?.length ?? 0;

  return json({ moved, left, done: left === 0, results });
});
