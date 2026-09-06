import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { ensureTagged } from "../_shared/visualization.ts";
import {
  buildClipInput,
  buildScenePrompt,
  corsHeaders,
  falSubmit,
  FAL_VIDEO_MODEL,
  isTransientFailure,
  json,
  pickScenes,
} from "../_shared/property-video.ts";

// ============================================================================
// הפקת סרטון שיווקי לנכס — הכניסה מה-CRM.
//
// ‏POST { property_id, replace_existing?, aspect_ratio? }
// מחזיר מיד ‎{ ok, job_id, clips }‎; הקליפים נוצרים אצל fal והתשובות חוזרות
// ל-‎property-video-callback‎. ה-CRM עושה polling דרך
// ‎rpc('property_video_job_status', { p_job_id })‎.
//
// למה הפונקציה לא מחכה לסרטון: יצירת ארבעה קליפים ב-fal לוקחת דקות, הרבה
// מעבר לתקרת הזמן של Edge Function. הפונקציה שולחת את הבקשות ומסיימת —
// המשך הטיפול הוא מכונת מצבים ב-DB.
//
// שלוש נקודות שכדאי להכיר:
//
//   1. **הזכאות והחיוב קורים ב-DB ולא כאן.** ‎start_property_video_job‎ בודקת
//      דרגה, תקרה חודשית וסרטון קיים, ומחייבת את הארנק — הכל בטרנזקציה אחת.
//      פיצול לשתי קריאות היה מאפשר לחייב ארנק בלי שנפתחה בקשה.
//   2. **הסרטון הישן נמחק רק בסוף.** ‎previous_video_url‎ נשמר על הבקשה,
//      וה-callback מוחק אותו אחרי שהחדש כבר על הנכס. הפקה שנכשלת באמצע
//      משאירה את הסוכן/ת עם הסרטון שהיה לו/ה.
//   3. **כישלון בשליחה מחזיר את הכסף מיד.** אם אף קליף לא נשלח ל-fal, אין
//      מה לחכות לו — הבקשה נסגרת ככושלת וה-RPC מזכה את הארנק.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// כתובת ה-callback חייבת להיות ציבורית ומוחלטת — fal קורא/ת אליה מבחוץ.
// ברירת המחדל נגזרת מ-SUPABASE_URL, ו-PROPERTY_VIDEO_CALLBACK_URL קיים כדי
// לאפשר בדיקה מול מנהרה מקומית בלי לשנות קוד.
function callbackBase(): string {
  const explicit = Deno.env.get("PROPERTY_VIDEO_CALLBACK_URL");
  if (explicit) return explicit.replace(/\/+$/, "");
  return `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/property-video-callback`;
}

async function pricing(supabase: any, key: string, fallback: number): Promise<number> {
  const { data } = await supabase.from("pricing_config").select("value").eq("key", key).maybeSingle();
  const n = Number(data?.value);
  return Number.isFinite(n) ? n : fallback;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  if (!Deno.env.get("FAL_KEY")) return json({ error: "fal_not_configured" }, 500);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing_authorization" }, 401);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const propertyId = body?.property_id;
  if (!propertyId) return json({ error: "missing_property_id" }, 400);
  const replaceExisting = body?.replace_existing === true;
  const aspectRatio = body?.aspect_ratio === "9:16" ? "9:16" : "16:9";

  // ---- מי הסוכן/ת --------------------------------------------------------
  const authedClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await authedClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: agentRow } = await supabase
    .from("agency_members")
    .select("id, active")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (!agentRow) return json({ error: "no_matching_agent_profile" }, 403);
  if (!agentRow.active) return json({ error: "agent_inactive" }, 403);

  // ---- הנכס --------------------------------------------------------------
  const { data: property } = await supabase
    .from("properties")
    .select("id, title, property_type, images, agent_id, status")
    .eq("id", propertyId)
    .single();
  if (!property) return json({ error: "property_not_found" }, 404);
  if (property.agent_id !== agentRow.id) return json({ error: "not_your_property" }, 403);

  const images: string[] = Array.isArray(property.images) ? property.images.filter(Boolean) : [];
  if (images.length === 0) {
    return json({ error: "no_images", message: "אין תמונות לנכס הזה — אי אפשר להפיק ממנו סרטון" }, 400);
  }

  // ---- כמה קליפים ובאיזה אורך -------------------------------------------
  // ‏clipCount הוא **תקרה** ולא יעד: pickScenes לוקחת min(תמונות, התקרה), ולכן
  // נכס עם חמש תמונות מקבל חמש סצנות ולא נשאר עם תמונה שלא נכנסה לסרטון.
  //
  // שני אורכים ולא אחד — ראו המיגרציה 20261005090000: clipSeconds הוא מה
  // שנכנס לסרטון (2.5), ו-sourceSeconds הוא מה שמבקשים מהמודל אם הוא דוחה
  // את הראשון (5). ‏Math.round הוסר מ-clipSeconds בכוונה: הוא היה מעגל 2.5 ל-2.
  const clipCount = Math.max(1, Math.round(await pricing(supabase, "property_video_clip_count", 8)));
  const clipSeconds = Math.max(0.5, await pricing(supabase, "property_video_clip_seconds", 2.5));
  const sourceSeconds = Math.max(clipSeconds, await pricing(supabase, "property_video_source_seconds", 5));
  const minClips = Math.max(1, Math.round(await pricing(supabase, "property_video_min_clips", 3)));

  // ---- אילו תמונות -------------------------------------------------------
  // הסיווג הקיים (‎property_image_tags‎) הוא מה שמאפשר סדר של מודעה: חוץ,
  // סלון, מטבח. ‏ensureTagged מסווג/ת מה שטרם סווג. נכס שהסיווג שלו נכשל
  // אינו נחסם — ‎pickScenes‎ נופל/ת חזרה לסדר ההעלאה.
  let tags: any[] = [];
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (geminiKey) {
    try {
      tags = await ensureTagged(supabase, geminiKey, propertyId, images);
    } catch (err) {
      console.warn("classification failed, falling back to upload order:", err);
    }
  }

  const scenes = pickScenes(tags, images, clipCount);
  if (scenes.length < minClips) {
    return json(
      {
        error: "not_enough_images",
        message: `נדרשות לפחות ${minClips} תמונות מתאימות להפקת סרטון`,
      },
      400
    );
  }

  // ---- הזכאות, התקרה והחיוב ---------------------------------------------
  const webhookToken = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");

  const { data: started, error: startErr } = await supabase.rpc("start_property_video_job", {
    p_property_id: propertyId,
    p_agent_id: agentRow.id,
    p_webhook_token: webhookToken,
    p_clip_seconds: clipSeconds,
    p_aspect_ratio: aspectRatio,
    p_replace_existing: replaceExisting,
  });
  if (startErr) return json({ error: "db_error", detail: startErr.message }, 500);
  if (started?.error) {
    const status = started.error === "insufficient_balance" ? 402
      : started.error === "not_eligible" ? 403
      : 409;
    return json(started, status);
  }

  const jobId = started.job_id as string;

  // ---- שורות הקליפים -----------------------------------------------------
  const clipRows = scenes.map((scene, idx) => ({
    job_id: jobId,
    idx,
    target: scene.target,
    source_image_url: scene.url,
    prompt: buildScenePrompt(scene.target, property.property_type),
  }));

  const { data: insertedClips, error: clipErr } = await supabase
    .from("property_video_clips")
    .insert(clipRows)
    .select("id, idx, source_image_url, prompt");
  if (clipErr) {
    await supabase.rpc("fail_property_video_job", { p_job_id: jobId, p_reason: `db_error: ${clipErr.message}` });
    return json({ error: "db_error", detail: clipErr.message }, 500);
  }

  // ---- שליחה ל-fal -------------------------------------------------------
  // מזהה הקליף נכנס לכתובת ה-webhook ולא נשלף מגוף התשובה: כך ה-callback
  // יודע/ת על איזו שורה מדובר בלי להסתמך על הצורה המדויקת של המעטפת ש-fal
  // מחזיר/ה, שמשתנה בין מודלים.
  const base = callbackBase();
  let submitted = 0;
  const failures: string[] = [];

  // ---- באיזה אורך מבקשים -------------------------------------------------
  // **החלטה דטרמיניסטית ולא ניסוי.** הגרסה הקודמת ניסתה לבקש 2.5 שניות
  // וליפול חזרה ל-5 אם המודל דוחה — וזה נכשל בפרודקשן מסיבה מלמדת: ‏Kling
  // **קיבל** את הבקשה (‎200‎ עם ‎request_id‎) ורק בזמן הריצה החזיר ‎422‎, דרך
  // ה-webhook. כלומר הדחייה אינה מגיעה בתשובת ה-submit בכלל, ובדיקה עליה
  // לעולם לא תתפוס. חמישה קליפים נשלחו, כולם נכשלו, והבקשה נסגרה ב-
  // ‎too_few_clips: 0/3‎.
  //
  // הניסוי הזה כבר ענה על השאלה: המודל לא מייצר 2.5 שניות. לכן מבקשים
  // ישירות את אורך המקור וחותכים במיזוג — מסלול אחד, בלי הימור ובלי קליפים
  // מבוזבזים. כשמישהו יגדיר מודל שכן תומך באורך המבוקש, ‎source_seconds‎
  // יורד ל-2.5 ב-pricing_config והחיתוך מכבה את עצמו.
  const needsTrim = clipSeconds < sourceSeconds;
  const askSeconds = needsTrim ? sourceSeconds : clipSeconds;
  const trimToSeconds: number | null = needsTrim ? clipSeconds : null;

  for (const clip of insertedClips ?? []) {
    const hook = `${base}?token=${encodeURIComponent(webhookToken)}&job=${jobId}&clip=${clip.id}`;
    const input = buildClipInput(clip.source_image_url, clip.prompt, askSeconds, aspectRatio);

    let result = await falSubmit(FAL_VIDEO_MODEL, input, hook);

    // ניסיון שני לכשל שנראה חולף. בהרצה האחרונה קליף אחד קיבל ‎403‎ של יתרה
    // בעוד שהקליף **שאחריו** נשלח בהצלחה — כלומר זה לא היה מצב חשבון אלא
    // רעש רגעי, ותמונה אחת ירדה מהסרטון בלי סיבה אמיתית. ניסיון אחד נוסף
    // הוא המחיר הזול ביותר לכך ש"לא יתפספסו תמונות".
    //
    // ‏422 אינו נכלל: הוא אומר שהקלט עצמו פסול, ושליחה חוזרת שלו רק תשלם שוב.
    if (!result.ok && isTransientFailure(result.error)) {
      result = await falSubmit(FAL_VIDEO_MODEL, input, hook);
    }

    if (result.ok) {
      await supabase
        .from("property_video_clips")
        .update({ fal_request_id: result.requestId })
        .eq("id", clip.id);
      submitted++;
    } else {
      await supabase
        .from("property_video_clips")
        .update({ status: "failed", error_detail: result.error })
        .eq("id", clip.id);
      failures.push(result.error ?? "unknown");
    }
  }

  // נרשם אחרי הלולאה כי הוא מתגלה תוך כדיה. ‎advanceJob‎ קורא/ת אותו בשלב
  // המיזוג ובוחר/ת בין compose (עם חיתוך) ל-merge-videos (בלי).
  await supabase
    .from("property_video_jobs")
    .update({ source_seconds: askSeconds, trim_to_seconds: trimToSeconds })
    .eq("id", jobId);

  // אף קליף לא נשלח — אין למה לחכות, והארנק מזוכה עכשיו ולא בעוד שעה.
  if (submitted === 0) {
    await supabase.rpc("fail_property_video_job", {
      p_job_id: jobId,
      p_reason: `fal_submit_failed: ${failures.slice(0, 3).join(" | ")}`,
    });
    return json({ error: "fal_submit_failed", detail: failures[0] ?? null }, 502);
  }

  // חלק מהקליפים נשלחו וחלק לא. הסרטון עדיין שווה משהו — 3 קליפים במקום 4
  // הם 15 שניות במקום 20 — ולכן הבקשה ממשיכה, וה-callback ימזג את מה שיצא.
  return json({
    ok: true,
    job_id: jobId,
    tier: started.tier,
    amount_charged: started.amount_charged,
    clips: submitted,
    clips_failed: (insertedClips?.length ?? 0) - submitted,
    // אורך הסרטון הסופי הוא תמיד לפי clipSeconds, גם כשהמודל ייצר ארוך יותר
    // וייחתך במיזוג — זה מה שהסוכן/ת יראה/תראה בפועל.
    estimated_seconds: Math.round(submitted * clipSeconds * 10) / 10,
    trimmed: trimToSeconds != null,
  });
});
