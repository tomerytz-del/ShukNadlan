import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { authorizeInternalCaller } from "../_shared/cron-auth.ts";
import {
  buildMergeInput,
  corsHeaders,
  extractVideoUrl,
  falResult,
  falStatus,
  falSubmit,
  FAL_COMPOSE_MODEL,
  FAL_MERGE_MODEL,
  FAL_VIDEO_MODEL,
  json,
  measureMp4Seconds,
  removeStoredVideo,
  storeFinalVideo,
  tokensMatch,
} from "../_shared/property-video.ts";

// ============================================================================
// מכונת המצבים של הסרטון השיווקי — מה שקורה אחרי ש-property-video-create
// שלחה את הבקשות ל-fal.
//
// שלושה מסלולי כניסה, כולם לאותה לוגיקה:
//
//   1. ‏POST ?token=…&job=…&clip=…   — ‏fal סיים/ה קליף.
//   2. ‏POST ?token=…&job=…&merge=1  — ‏fal סיים/ה למזג את הרצף.
//   3. ‏POST ?mode=reconcile         — ‏pg_cron. סורק בקשות תקועות ושואל את
//      fal בעצמו מה קרה להן.
//
// **למה מסלול 3 קיים בכלל:** webhook הוא הבטחה, לא ערובה. אם fal ניסה/תה
// לקרוא אלינו בזמן פריסה, או שהתשובה אבדה, הבקשה נתקעת ב-'generating_clips'
// לנצח — ואם היא של סוכן/ת MID, גם ה-₪20 נתקעים איתה. ה-reconcile הוא מה
// שהופך את החיוב להוגן: כל בקשה מגיעה בסוף ל-done או ל-failed, ו-failed
// מזכה את הארנק.
//
// **הפונקציה רצה עם ‎verify_jwt = false‎** — ‏fal אינו/ה מחזיק/ה JWT שלנו.
// לכן האימות הוא ‎webhook_token‎ שנוצר לכל בקשה ונשמר על השורה: בלעדיו כל מי
// שינחש ‎job_id‎ היה יכול/ה להחליף את הסרטון של נכס זר בכתובת משלו.
// מסלול ה-reconcile מאומת בנפרד דרך cron-auth.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// בקשה שלא זזה יותר מזה נחשבת אבודה. ‏fal מסיים/ת קליף של 5 שניות תוך
// דקות בודדות, ולכן 30 דקות הן כבר בבירור תקלה ולא תור עמוס.
const STALE_MINUTES = 30;

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

// ---------------------------------------------------------------------------
// קידום הבקשה
//
// נקראת אחרי כל שינוי בקליפים ומכל אחד משלושת המסלולים. היא בודקת מה מצב
// הבקשה **מה-DB** ולא ממה שהקורא חושב, ולכן שתי קריאות במקביל לא מקדמות
// אותה פעמיים: המעברים נעשים ב-update מותנה-סטטוס, ומי שהפסיד במרוץ מקבל
// אפס שורות ופורש.
// ---------------------------------------------------------------------------
async function advanceJob(supabase: any, jobId: string): Promise<string> {
  const { data: job } = await supabase
    .from("property_video_jobs")
    .select("id, status, agent_id, property_id, aspect_ratio, previous_video_url, fal_merge_request_id, trim_to_seconds")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return "job_not_found";
  if (job.status === "done" || job.status === "failed") return job.status;

  const { data: clips } = await supabase
    .from("property_video_clips")
    .select("id, idx, status, clip_url")
    .eq("job_id", jobId)
    .order("idx");
  const all = clips ?? [];
  const pending = all.filter((c: any) => c.status === "pending");
  const ready = all.filter((c: any) => c.status === "done" && c.clip_url);

  if (job.status === "generating_clips") {
    if (pending.length > 0) return "generating_clips";

    const minClips = Math.max(1, Math.round(await pricing(supabase, "property_video_min_clips", 2)));
    if (ready.length < minClips) {
      await supabase.rpc("fail_property_video_job", {
        p_job_id: jobId,
        p_reason: `too_few_clips: ${ready.length}/${minClips}`,
      });
      return "failed";
    }

    // קליף בודד אינו צריך מיזוג — שולחים אותו ישר לאחסון וחוסכים קריאה.
    if (ready.length === 1) {
      const claimed = await claim(supabase, jobId, "generating_clips", "uploading");
      if (!claimed) return "uploading";
      return await finalize(supabase, job, ready[0].clip_url);
    }

    const claimed = await claim(supabase, jobId, "generating_clips", "merging");
    if (!claimed) return "merging";

    const urls = ready.sort((a: any, b: any) => a.idx - b.idx).map((c: any) => c.clip_url);
    const hook = `${callbackBase()}?token=${encodeURIComponent(claimed.webhook_token)}&job=${jobId}&merge=1`;

    // מסלול מיזוג אחד בלבד. ‏compose נוסה כאן כדי לחתוך כל קליף לאורך קצר
    // יותר, ונמדד מול ה-API החי: הוא מתעלם מ-‎duration‎, מ-‎timestamp‎
    // ומ-‎start_from‎ ומשרשר קליפים שלמים — בדיוק כמו ‎merge-videos‎, רק עם
    // סכימה מסובכת יותר. ‏‎/trim‎, ‎/cut‎, ‎/split‎ ו-‎/speed‎ אינם קיימים.
    // לכן נשאר ‎merge-videos‎, שמוכח בפרודקשן.
    const submit = await falSubmit(FAL_MERGE_MODEL, buildMergeInput(urls, job.aspect_ratio), hook);

    if (!submit.ok) {
      await supabase.rpc("fail_property_video_job", {
        p_job_id: jobId,
        p_reason: `merge_submit_failed: ${submit.error}`,
      });
      return "failed";
    }

    await supabase
      .from("property_video_jobs")
      .update({ fal_merge_request_id: submit.requestId, updated_at: new Date().toISOString() })
      .eq("id", jobId);
    return "merging";
  }

  return job.status;
}

// מעבר סטטוס מותנה. מחזיר את השורה כשהמעבר הצליח, ו-null כשמישהו אחר הקדים.
async function claim(supabase: any, jobId: string, from: string, to: string): Promise<any | null> {
  const { data } = await supabase
    .from("property_video_jobs")
    .update({ status: to, updated_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("status", from)
    .select("id, webhook_token, agent_id, property_id, previous_video_url")
    .maybeSingle();
  return data ?? null;
}

// ---------------------------------------------------------------------------
// הורדה, שמירה וסגירה
//
// סדר הפעולות כאן חשוב: הקובץ עולה לאחסון שלנו, אחר כך ‎video_url‎ מתעדכן,
// ורק בסוף הסרטון הישן נמחק. כל סדר אחר משאיר חלון שבו הנכס מצביע על קובץ
// שכבר לא קיים.
// ---------------------------------------------------------------------------
async function finalize(supabase: any, job: any, videoUrl: string): Promise<string> {
  const stored = await storeFinalVideo(supabase, job.agent_id, job.property_id, videoUrl);
  if (!stored.url) {
    await supabase.rpc("fail_property_video_job", {
      p_job_id: job.id,
      p_reason: `store_failed: ${stored.error}`,
    });
    return "failed";
  }

  const { data: completed, error } = await supabase.rpc("complete_property_video_job", {
    p_job_id: job.id,
    p_result_url: stored.url,
  });
  if (error || completed?.error) {
    await supabase.rpc("fail_property_video_job", {
      p_job_id: job.id,
      p_reason: `complete_failed: ${error?.message ?? completed?.error}`,
    });
    return "failed";
  }

  // הסרטון הישן. נמחק רק כשהוא קובץ בדלי שלנו ורק אחרי שהחדש כבר על הנכס.
  await removeStoredVideo(supabase, completed?.previous_video_url ?? job.previous_video_url ?? null);
  return "done";
}

// ---------------------------------------------------------------------------
// ה-reconcile
//
// שואל את fal ישירות מה קרה לכל בקשה פתוחה שלא זזה. שלושה מצבים:
// קליף שהושלם נקלט עכשיו, קליף שנכשל מסומן ככושל, ובקשה שעברה את תקרת הזמן
// נסגרת ככושלת — כלומר הארנק מזוכה. בלי השלב האחרון בקשה תקועה הייתה
// נשארת פתוחה לנצח וגם חוסמת את הנכס מהפקה חדשה (יש אינדקס ייחודי על
// בקשה פתוחה אחת לנכס).
// ---------------------------------------------------------------------------
async function reconcile(supabase: any): Promise<Record<string, number>> {
  const cutoff = new Date(Date.now() - STALE_MINUTES * 60 * 1000).toISOString();
  const { data: jobs } = await supabase
    .from("property_video_jobs")
    .select("id, status, agent_id, property_id, aspect_ratio, previous_video_url, fal_merge_request_id, trim_to_seconds, created_at")
    .in("status", ["generating_clips", "merging", "uploading"])
    .lt("updated_at", cutoff)
    .limit(20);

  const stats = { checked: 0, advanced: 0, failed: 0 };

  for (const job of jobs ?? []) {
    stats.checked++;

    // בקשה זקנה מאוד — אין טעם להמשיך לחכות לה.
    const ageMinutes = (Date.now() - new Date(job.created_at).getTime()) / 60000;
    if (ageMinutes > STALE_MINUTES * 4) {
      await supabase.rpc("fail_property_video_job", { p_job_id: job.id, p_reason: "timed_out" });
      stats.failed++;
      continue;
    }

    if (job.status === "generating_clips") {
      const { data: clips } = await supabase
        .from("property_video_clips")
        .select("id, fal_request_id")
        .eq("job_id", job.id)
        .eq("status", "pending");

      for (const clip of clips ?? []) {
        if (!clip.fal_request_id) {
          await supabase
            .from("property_video_clips")
            .update({ status: "failed", error_detail: "never_submitted" })
            .eq("id", clip.id);
          continue;
        }
        const status = await falStatus(FAL_VIDEO_MODEL, clip.fal_request_id);
        if (status !== "COMPLETED") continue;
        const payload = await falResult(FAL_VIDEO_MODEL, clip.fal_request_id);
        const url = extractVideoUrl(payload);
        await supabase
          .from("property_video_clips")
          .update(
            url
              ? { status: "done", clip_url: url }
              : { status: "failed", error_detail: "no_video_in_result" }
          )
          .eq("id", clip.id);
      }
      await supabase
        .from("property_video_jobs")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", job.id);
      await advanceJob(supabase, job.id);
      stats.advanced++;
      continue;
    }

    if (job.status === "merging" && job.fal_merge_request_id) {
      const status = await falStatus(FAL_MERGE_MODEL, job.fal_merge_request_id);
      if (status !== "COMPLETED") continue;
      const payload = await falResult(FAL_MERGE_MODEL, job.fal_merge_request_id);
      const url = extractVideoUrl(payload);
      if (!url) {
        await supabase.rpc("fail_property_video_job", { p_job_id: job.id, p_reason: "merge_no_video" });
        stats.failed++;
        continue;
      }
      const claimed = await claim(supabase, job.id, "merging", "uploading");
      if (!claimed) continue;
      await finalize(supabase, job, url);
      stats.advanced++;
    }
  }

  return stats;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = new URL(req.url);
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // ---- מסלול ה-cron ------------------------------------------------------
  if (url.searchParams.get("mode") === "reconcile") {
    const auth = authorizeInternalCaller(req);
    if (!auth.ok) return json({ error: auth.error, detail: auth.detail }, auth.status);
    const stats = await reconcile(supabase);
    return json({ ok: true, ...stats });
  }

  // ---- מסלול הבדיקה ------------------------------------------------------
  // כלי פיתוח, לא נתיב מוצר. נולד מתוך כישלון אמיתי: ‏`compose` החזיר
  // "הצלחה" על בקשת חיתוך שלא חתכה, ולכן כל תיקון של הסכימה חייב היה סבב
  // שלם — חמישה קליפים ב-Kling (‎~1.75$‎) רק כדי לגלות אם שם שדה נכון.
  //
  // כאן הקלט ל-fal עובר **כמו שהוא** מגוף הבקשה, והתשובה חוזרת גולמית יחד
  // עם **אורך הפלט הנמדד**. כך אפשר לנסות צורות payload עד שהחיתוך תופס,
  // בלי לייצר ולו קליפ אחד ובלי פריסה מחדש לכל ניסיון.
  //
  // שני מעצורים:
  //   • ‏authorizeInternalCaller — ‏service_role או סוד ה-cron, כמו ה-reconcile.
  //   • רשימת מודלים סגורה ל-‎ffmpeg-api‎ בלבד (‎0.0002$‎ לשנייה). בלעדיה זו
  //     הייתה נקודת קצה שמריצה כל מודל ב-fal על חשבון החשבון שלנו.
  if (url.searchParams.get("mode") === "probe") {
    const auth = authorizeInternalCaller(req);
    if (!auth.ok) return json({ error: auth.error, detail: auth.detail }, auth.status);

    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid_json" }, 400);
    }

    const model = String(body?.model ?? FAL_COMPOSE_MODEL);
    if (!model.startsWith("fal-ai/ffmpeg-api/")) {
      return json({ error: "model_not_allowed", detail: "רק fal-ai/ffmpeg-api/*" }, 400);
    }
    if (!body?.input || typeof body.input !== "object") {
      return json({ error: "missing_input" }, 400);
    }

    const key = Deno.env.get("FAL_KEY");
    if (!key) return json({ error: "fal_not_configured" }, 500);

    // ‏fal.run הוא הנתיב הסינכרוני — מחכה לתוצאה ומחזיר אותה. מתאים כאן כי
    // ‏ffmpeg מסיים בשניות, ובלי תור אין גם webhook לחכות לו.
    let falStatusCode = 0;
    let raw = "";
    try {
      const res = await fetch(`https://fal.run/${model}`, {
        method: "POST",
        headers: { "Authorization": `Key ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body.input),
      });
      falStatusCode = res.status;
      raw = await res.text();
    } catch (err) {
      return json({ error: "fal_network", detail: (err as Error).message }, 502);
    }

    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      /* נשאר null; raw עדיין מוחזר */
    }

    const videoUrl = parsed ? extractVideoUrl(parsed) : null;
    const seconds = videoUrl ? await measureMp4Seconds(videoUrl) : null;

    return json({
      ok: falStatusCode >= 200 && falStatusCode < 300,
      model,
      fal_status: falStatusCode,
      video_url: videoUrl,
      duration_seconds: seconds,
      raw: raw.slice(0, 1200),
    });
  }

  // ---- מסלול ה-webhook ---------------------------------------------------
  const jobId = url.searchParams.get("job");
  const token = url.searchParams.get("token") || "";
  const clipId = url.searchParams.get("clip");
  const isMerge = url.searchParams.get("merge") === "1";
  if (!jobId || !token) return json({ error: "missing_params" }, 400);

  const { data: job } = await supabase
    .from("property_video_jobs")
    .select("id, status, agent_id, property_id, aspect_ratio, webhook_token, previous_video_url")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return json({ error: "job_not_found" }, 404);
  if (!tokensMatch(token, job.webhook_token || "")) return json({ error: "bad_token" }, 403);

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  // ‏fal מסמן/ת כישלון ב-status: "ERROR". גם תשובה שאין בה וידאו היא כישלון
  // מבחינתנו — אין הבדל מעשי בין "המודל נכשל" ל"המודל החזיר משהו שאיננו סרטון".
  const failed = body?.status === "ERROR" || body?.error != null;
  const videoUrl = failed ? null : extractVideoUrl(body?.payload ?? body);

  if (isMerge) {
    if (!videoUrl) {
      await supabase.rpc("fail_property_video_job", {
        p_job_id: jobId,
        p_reason: `merge_failed: ${JSON.stringify(body?.error ?? "no_video").slice(0, 300)}`,
      });
      return json({ ok: true, status: "failed" });
    }
    const claimed = await claim(supabase, jobId, "merging", "uploading");
    if (!claimed) return json({ ok: true, status: "already_handled" });

    // ההורדה וההעלאה ממשיכות ברקע: ‏fal מצפה/ה לתשובה מהירה ל-webhook,
    // וסרטון של 20 שניות יכול לשקול כמה עשרות מגהבייט.
    // @ts-ignore — EdgeRuntime.waitUntil זמין בסביבת ה-Edge Functions של Supabase
    EdgeRuntime.waitUntil(finalize(supabase, job, videoUrl));
    return json({ ok: true, status: "uploading" });
  }

  if (!clipId) return json({ error: "missing_clip" }, 400);

  await supabase
    .from("property_video_clips")
    .update(
      videoUrl
        ? { status: "done", clip_url: videoUrl, error_detail: null }
        : { status: "failed", error_detail: JSON.stringify(body?.error ?? "no_video").slice(0, 300) }
    )
    .eq("id", clipId)
    .eq("job_id", jobId);

  await supabase
    .from("property_video_jobs")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", jobId);

  const status = await advanceJob(supabase, jobId);
  return json({ ok: true, status });
});
