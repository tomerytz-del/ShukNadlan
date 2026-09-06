import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { authorizeInternalCaller } from "../_shared/cron-auth.ts";

/* ============================================================================
 * העברת סרטוני הנכסים מהפרויקט הישן — ריצה חד-פעמית
 *
 * שישה נכסים עלו לאתר בלי הסרטון שלהם. לא באג בתצוגה: ‏property.html מזהה
 * ‎.mp4‎ ומנגן אותו לבד (‏videoEmbed), אבל ‎video_url‎ בשורות שלהם הייתה ‎null‎.
 * בהעברה מהמערכת הישנה (‏nadlan-afula) למרקטפלייס הועתקו התמונות — ולכן
 * כתובות התמונות בעמודים האלה עדיין מצביעות על ה-Storage של הפרויקט הישן —
 * אבל ‎video_url‎ לא נכללה במיפוי. הקבצים עצמם המשיכו לשבת שם, בדלי ציבורי,
 * בלי שאף עמוד באתר מצביע עליהם.
 *
 * למה Edge Function ולא מיגרציה: מיגרציה יכולה לכתוב כתובת, אבל לא להעביר
 * בייטים. אפשר היה פשוט להצביע על הכתובת הציבורית בפרויקט הישן — וזו הייתה
 * הדרך המהירה — אבל אז האתר היה נשאר תלוי בפרויקט שכבר לא משמש לכלום, וכיבוי
 * שלו היה מכבה שישה סרטונים בלי שיהיה קשר נראה לעין בין הפעולה לתוצאה.
 * הפונקציה הזו מעתיקה את הקובץ עצמו לדלי ‎property-videos‎ של המרקטפלייס,
 * לנתיב שה-CRM כותב אליו ממילא — ‎<agent_id>/<property_id>/video-<uuid>.mp4‎ —
 * ורק אז מעדכנת את העמודה.
 *
 * הנתיב אינו קישוט: ‎cleanupReplacedVideo‎ ב-CRM מוחקת את הקובץ הישן כשמחליפים
 * סרטון, וה-RLS מרשה מחיקה רק בתיקייה ‎<agent_id>/‎ של הסוכן/ת. קובץ שהיה נוחת
 * בנתיב אחר היה נשאר יתום בכל החלפה.
 *
 * מה הפונקציה *לא* מקבלת: את רשימת הנכסים. היא קבועה בקוד למטה — מקור ויעד —
 * ולכן קריאה לפונקציה לא יכולה לגרום לה לכתוב לנכס אחר או למשוך קובץ מכתובת
 * אחרת. הקלט היחיד הוא ‎limit‎, שרק מקטין את כמות העבודה בקריאה אחת.
 *
 * אידמפוטנטית: נכס שכבר יש לו ‎video_url‎ מדולג. לכן אפשר לקרוא שוב אחרי
 * ריצה שנקטעה באמצע, והיא תמשיך מהמקום שבו נעצרה במקום לשכפל קבצים.
 * ========================================================================= */

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const VIDEOS_BUCKET = "property-videos";

/* המיפוי: מזהה הנכס במרקטפלייס → הקובץ בפרויקט הישן.
   ה-‎legacy_id‎ נשמר כדי שאפשר יהיה לאמת את השיוך מול הפרויקט הישן בלי לפרק
   את הכתובת, ו-‎label‎ הוא בשביל הלוג — שורת סיכום עם שישה UUID היא לא דיווח. */
const MIGRATIONS = [
  { id: "6bb07a06-0bf2-4401-84e2-a914bcc13576", label: "שיבולים 17",           legacy: "d8be33ae-b692-4a91-828e-59356625bb5b", file: "1N7v6l2Y6vYPLNApjOm03MBJY06ThlufQ.mp4" },
  { id: "d7d2ecf0-a6e6-44c9-917c-38fdd92a0e15", label: "קרן קיימת לישראל 35",  legacy: "6a912bb7-a411-43e6-af81-f3789213327a", file: "19WfQIx5iteXvzHJ-aTqnycLeJgGqYg6Z.mp4" },
  { id: "080e72a4-899e-4a32-96ff-8c4d41eff8a1", label: "הנשיא וייצמן 13",      legacy: "ec8528c9-ea73-4bed-b7f0-8cc5f31a1899", file: "176Yjov217i2V75OPOmWA74LIvK0ut_HI.mp4" },
  { id: "74643d8f-6831-4332-b355-efb71519959e", label: "יהושוע חנקין 7",       legacy: "d13c46ce-01e1-4d0b-b9e5-c2997bd2c37b", file: "1uoGdt-UMPwrMVwFk5BkM9a5kIZf4zmxN.mp4" },
  { id: "fc9be6fa-e19a-44cd-939a-c6701ad3a94d", label: "יהושע חנקין 1",        legacy: "b6f0727c-f20f-4cd6-9d4d-47f2915abf23", file: "1Tg5OGCf9MPU3tYiVr3u1oTuzoFPVZoDq.mp4" },
  { id: "719373e4-2226-482b-93d7-e255adf59366", label: "יהושע חנקין 2",        legacy: "ce477159-5db2-4284-bc8b-d85a700efdc0", file: "1z_W_EpHoABRrlC4NUasJqS9QbfJyfNXg.mp4" },
] as const;

/* שני נכסים שהיה להם ‎video_url‎ בפרויקט הישן ובכל זאת אינם ברשימה:
 *
 *   • קירשטיין 1 — הכתובת שם היא קישור ‎/view‎ של Google Drive, והיא מצביעה
 *     על אותו קובץ Drive של חנקין 7. סנכרון ה-Drive שייך אותו לשני נכסים,
 *     ומכאן שאחד מהשניים שגוי. סרטון של דירה אחרת בעמוד של דירה אחרת גרוע
 *     מהיעדר סרטון, ולכן זה נשאר להכרעה ידנית.
 *   • יהושע חנקין 13 — יושב על אותן ארבע תמונות של חנקין 7, כלומר גם
 *     התמונות שלו הן תוצר של אותה העברה. תקלה נפרדת, ולא נכון לתקן אותה
 *     בכך שנוסיף לו גם סרטון של נכס אחר.
 */

const LEGACY_STORAGE_BASE =
  "https://hgkxrnmzsyokkecyarwv.supabase.co/storage/v1/object/public/property-videos";

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

  // הקלט היחיד. ‏0 או ערך לא חוקי = בלי הגבלה; המספר רק מקצר את הריצה,
  // הוא לא בוחר על מי היא עובדת.
  let limit = MIGRATIONS.length;
  try {
    const body = await req.json();
    const n = Number(body?.limit);
    if (Number.isFinite(n) && n > 0) limit = Math.min(Math.floor(n), MIGRATIONS.length);
  } catch { /* גוף ריק הוא קריאה תקינה לגמרי */ }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const results: Array<Record<string, unknown>> = [];
  let migrated = 0;

  for (const item of MIGRATIONS) {
    if (migrated >= limit) break;

    const { data: property, error: readErr } = await supabase
      .from("properties")
      .select("id, agent_id, video_url")
      .eq("id", item.id)
      .maybeSingle();

    if (readErr)      { results.push({ ...describe(item), status: "db_error", detail: readErr.message }); continue; }
    if (!property)    { results.push({ ...describe(item), status: "property_not_found" }); continue; }
    // כבר יש סרטון — בין אם מריצה קודמת ובין אם מישהו/י העלה/תה אחד מה-CRM
    // בינתיים. בשני המקרים דריסה כאן הייתה מחליפה נתון חי בעותק ישן.
    if (property.video_url) { results.push({ ...describe(item), status: "skipped_has_video" }); continue; }
    if (!property.agent_id) { results.push({ ...describe(item), status: "no_agent_id" }); continue; }

    const source = `${LEGACY_STORAGE_BASE}/${item.legacy}/${item.file}`;
    let bytes: ArrayBuffer;
    try {
      const res = await fetch(source);
      if (!res.ok) { results.push({ ...describe(item), status: "source_unreachable", detail: `HTTP ${res.status}` }); continue; }
      bytes = await res.arrayBuffer();
    } catch (e) {
      results.push({ ...describe(item), status: "source_fetch_failed", detail: String(e) });
      continue;
    }

    const path = `${property.agent_id}/${property.id}/video-${crypto.randomUUID()}.mp4`;
    const { error: uploadErr } = await supabase.storage.from(VIDEOS_BUCKET).upload(path, bytes, {
      contentType: "video/mp4", cacheControl: "31536000", upsert: false,
    });
    if (uploadErr) { results.push({ ...describe(item), status: "upload_failed", detail: uploadErr.message }); continue; }

    const publicUrl = supabase.storage.from(VIDEOS_BUCKET).getPublicUrl(path).data.publicUrl;

    // ‎is('video_url', null)‎ ולא רק ‎eq('id')‎: בין הקריאה למעלה לכתיבה כאן
    // יכולה הייתה להישמר עריכה מה-CRM. אם קרה — לא כותבים עליה, ומוחקים את
    // הקובץ שהעלינו כדי שלא יישאר יתום בדלי.
    const { data: updated, error: updateErr } = await supabase
      .from("properties")
      .update({ video_url: publicUrl })
      .eq("id", property.id)
      .is("video_url", null)
      .select("id");

    if (updateErr || !updated?.length) {
      await supabase.storage.from(VIDEOS_BUCKET).remove([path]);
      results.push({ ...describe(item), status: updateErr ? "update_failed" : "raced_skipped", detail: updateErr?.message });
      continue;
    }

    migrated++;
    results.push({ ...describe(item), status: "migrated", bytes: bytes.byteLength, video_url: publicUrl });
  }

  const remaining = MIGRATIONS.length - results.filter((r) =>
    r.status === "migrated" || r.status === "skipped_has_video").length;

  return json({ migrated, remaining, results });
});

function describe(item: (typeof MIGRATIONS)[number]) {
  return { property_id: item.id, label: item.label };
}
