import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { authorizeInternalCaller } from "../_shared/cron-auth.ts";
import { falPoll, falSubmit, falVideoUrl } from "../_shared/fal.ts";
import { buildComposeTracks, pickShots, type TaggedImage } from "../_shared/video-plan.ts";
import { corsHeaders, ensureTagged, json } from "../_shared/visualization.ts";

// ============================================================================
// סרטון שיווקי לנכס — השרת.
//
// שני קהלים לאותה נקודת קצה, בדיוק כמו ב-property-description:
//
//   1. **סוכן/ת** שלוחץ/ת "סרטון שיווקי" בכרטיס הנכס. שולח/ת JWT ו-
//      ‏{ property_id, kind }. ההרשאה, הזכאות, ה-cooldown והתקרה נבדקים
//      במסד (‏request_property_video) ולא כאן. התשובה חוזרת מיד עם job_id,
//      וההפקה ממשיכה ברקע.
//   2. **‏pg_cron** בלי גוף, כל דקה. תופס בקשות פתוחות וממשיך אותן. זה מה
//      שהופך הרצה שנחתכה באמצע לעיכוב של דקה במקום לקליפ אבוד.
//
// **מכונת השלבים.** ‏driveJob היא אותה פונקציה בשני המסלולים, והיא תמיד
// יודעת להמשיך מאיפה שהיא נמצאת לפי ‎job.stage‎ ולפי שורות הקליפים. אין
// "המשך של בקשה" נפרד מ"התחלה של בקשה" — היה, וזה בדיוק המקום שבו קליפ
// ששולם עליו הולך לאיבוד.
//
// **שתי הרמות.** ‎slideshow‎ ו-‎ai_reel‎ נבדלים בשלב אחד בלבד: מאיפה מגיע
// ‎clip_url‎. ב-slideshow הוא התמונה עצמה, וב-ai_reel הוא הווידאו שחזר
// מ-fal. משם והלאה — חיבור, שמירה, הצגה — זה אותו קוד.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const FAL_KEY = Deno.env.get("FAL_KEY") || "";
const VIDEO_MODEL = Deno.env.get("FAL_VIDEO_MODEL") || "fal-ai/wan-i2v";
const COMPOSE_MODEL = Deno.env.get("FAL_COMPOSE_MODEL") || "fal-ai/ffmpeg-api/compose";
const MUSIC_URL = Deno.env.get("MARKETING_VIDEO_MUSIC_URL") || "";
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") || "";

const VIDEO_BUCKET = "property-videos";

// כמה זמן סבב אחד מקדם בקשות לפני שהוא משחרר אותן להרצה הבאה. התקרה
// האמיתית היא זמן הריצה של Edge Function; 90 שניות משאירות מרווח לשמירה
// ולהעלאה שאחריהן.
const ROUND_MS = 90_000;
const POLL_MS = 5_000;

// deno-lint-ignore no-explicit-any
type Sb = any;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function config(sb: Sb): Promise<Record<string, number>> {
  const { data } = await sb
    .from("pricing_config")
    .select("key, value")
    .like("key", "marketing_video_%");
  const out: Record<string, number> = {};
  for (const row of data ?? []) out[row.key] = Number(row.value);
  return out;
}

async function failJob(sb: Sb, jobId: string, reason: string) {
  console.error("סרטון שיווקי נכשל", jobId, reason);
  await sb
    .from("property_video_jobs")
    .update({ stage: "failed", last_error: reason.slice(0, 500), finished_at: new Date().toISOString() })
    .eq("id", jobId);
}

// ---------------------------------------------------------------------------
// שלב א' — תכנון: אילו תמונות נכנסות, ובאיזה סדר
//
// נקרא פעם אחת לכל בקשה. בקשה שכבר יש לה שורות קליפים מדלגת — הרצה שנחתכה
// אחרי התכנון לא מתכננת מחדש, אחרת הסרטון היה יכול להיבנות מתמונות אחרות
// באמצע הדרך.
// ---------------------------------------------------------------------------
async function planClips(sb: Sb, job: Record<string, unknown>, cfg: Record<string, number>) {
  const propertyId = job.property_id as string;

  const { count } = await sb
    .from("property_video_clips")
    .select("id", { count: "exact", head: true })
    .eq("job_id", job.id);
  if ((count ?? 0) > 0) return true;

  const { data: property } = await sb
    .from("properties")
    .select("id, images")
    .eq("id", propertyId)
    .single();

  const images: string[] = Array.isArray(property?.images) ? property.images.filter(Boolean) : [];
  if (images.length < 2) {
    await failJob(sb, job.id as string, "לנכס אין מספיק תמונות לסרטון");
    return false;
  }

  // הסיווג הוא מה שיודע איזו תמונה היא החזית ואיזו המטבח. בלי מפתח Gemini
  // הוא פשוט לא רץ, והבחירה נופלת לסדר הגלריה — סרטון קצת פחות מסודר, אבל
  // סרטון. חוסר מפתח לסיווג הוא לא סיבה להיכשל על הפקה ששילמו עליה.
  let tags: TaggedImage[] = [];
  if (GEMINI_KEY) {
    try {
      tags = await ensureTagged(sb, GEMINI_KEY, propertyId, images);
    } catch (e) {
      console.error("סיווג התמונות נכשל, ממשיכים לפי סדר הגלריה", e);
    }
  }

  const limit = Math.max(2, Math.min(cfg.marketing_video_clip_count ?? 4, images.length));
  const shots = pickShots(tags, images, limit);
  if (shots.length < 2) {
    await failJob(sb, job.id as string, "לא נמצאו תמונות מתאימות לסרטון");
    return false;
  }

  const isSlideshow = job.kind === "slideshow";
  const { error } = await sb.from("property_video_clips").insert(
    shots.map((s) => ({
      job_id: job.id,
      position: s.position,
      room_type: s.roomType,
      source_image_url: s.imageUrl,
      // ב-slideshow אין מה לייצר: התמונה היא הקליף, והשורה נולדת גמורה.
      prompt: isSlideshow ? null : s.prompt,
      clip_url: isSlideshow ? s.imageUrl : null,
      status: isSlideshow ? "done" : "pending",
    })),
  );
  if (error) {
    await failJob(sb, job.id as string, `יצירת שורות הקליפים נכשלה: ${error.message}`);
    return false;
  }

  // תמונת הפוסטר היא התמונה הראשונה בסרטון ולא ה-thumbnail ש-fal מחזיר:
  // הכתובת שלו מתארחת אצלם ופגה, וכרטיס עם תמונה שבורה גרוע מכרטיס בלי.
  await sb
    .from("property_video_jobs")
    .update({ thumbnail_url: shots[0].imageUrl, model: isSlideshow ? null : VIDEO_MODEL })
    .eq("id", job.id);

  return true;
}

// ---------------------------------------------------------------------------
// שלב ב' — שליחת הקליפים ל-fal (‏ai_reel בלבד)
// ---------------------------------------------------------------------------
async function submitClips(sb: Sb, jobId: string, cfg: Record<string, number>) {
  const { data: clips } = await sb
    .from("property_video_clips")
    .select("id, position, prompt, source_image_url")
    .eq("job_id", jobId)
    .eq("status", "pending")
    .order("position");

  const seconds = Math.max(1, cfg.marketing_video_clip_seconds ?? 5);

  for (const clip of clips ?? []) {
    try {
      const sub = await falSubmit(FAL_KEY, VIDEO_MODEL, {
        image_url: clip.source_image_url,
        prompt: clip.prompt,
        duration: seconds,
      });
      await sb
        .from("property_video_clips")
        .update({
          fal_request_id: sub.requestId,
          status_url: sub.statusUrl,
          response_url: sub.responseUrl,
          status: "submitted",
          last_error: null,
        })
        .eq("id", clip.id);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // קליפ שנדחה בשליחה לא מפיל את הסרטון: שלושה קליפים הם עדיין סרטון.
      // ההכרעה אם נשאר מספיק נופלת ב-collectClips.
      await sb
        .from("property_video_clips")
        .update({ status: "failed", last_error: message.slice(0, 500) })
        .eq("id", clip.id);
    }
  }
}

// ---------------------------------------------------------------------------
// שלב ג' — איסוף הקליפים
//
// מחזירה true כשאין יותר קליפים בהמתנה. ההכרעה מה עושים עם מה שהתקבל היא
// של הקורא: שני קליפים ומעלה הם סרטון, ופחות מזה אינו.
// ---------------------------------------------------------------------------
async function collectClips(sb: Sb, jobId: string): Promise<boolean> {
  const { data: clips } = await sb
    .from("property_video_clips")
    .select("id, status_url, response_url")
    .eq("job_id", jobId)
    .eq("status", "submitted");

  if (!clips?.length) return true;

  // deno-lint-ignore no-explicit-any
  const results = await Promise.all(clips.map(async (clip: any) => {
    if (!clip.status_url || !clip.response_url) return true;
    const state = await falPoll(FAL_KEY, clip.status_url, clip.response_url);

    if (state.state === "pending") return false;

    if (state.state === "failed") {
      await sb
        .from("property_video_clips")
        .update({ status: "failed", last_error: state.reason.slice(0, 500) })
        .eq("id", clip.id);
      return true;
    }

    const url = falVideoUrl(state.payload);
    await sb
      .from("property_video_clips")
      .update(
        url
          ? { status: "done", clip_url: url, last_error: null }
          : { status: "failed", last_error: "תשובת fal אינה כוללת כתובת וידאו" },
      )
      .eq("id", clip.id);
    return true;
  }));

  return results.every(Boolean);
}

// ---------------------------------------------------------------------------
// שלב ד' — חיבור לסרטון אחד
// ---------------------------------------------------------------------------
async function submitCompose(sb: Sb, job: Record<string, unknown>, cfg: Record<string, number>) {
  const { data: clips } = await sb
    .from("property_video_clips")
    .select("clip_url")
    .eq("job_id", job.id)
    .eq("status", "done")
    .order("position");

  // deno-lint-ignore no-explicit-any
  const urls = (clips ?? []).map((c: any) => c.clip_url).filter(Boolean);
  if (urls.length < 2) {
    await failJob(sb, job.id as string, "לא נוצרו מספיק קליפים לסרטון");
    return false;
  }

  const clipMs = 1000 * (job.kind === "slideshow"
    ? Math.max(1, cfg.marketing_video_slide_seconds ?? 4)
    : Math.max(1, cfg.marketing_video_clip_seconds ?? 5));

  const { tracks, totalMs } = buildComposeTracks({
    clipUrls: urls,
    clipMs,
    crossfadeMs: cfg.marketing_video_crossfade_ms ?? 0,
    musicUrl: MUSIC_URL || null,
  });

  try {
    const sub = await falSubmit(FAL_KEY, COMPOSE_MODEL, { tracks });
    await sb
      .from("property_video_jobs")
      .update({
        stage: "compose",
        compose_request_id: sub.requestId,
        compose_status_url: sub.statusUrl,
        compose_response_url: sub.responseUrl,
        duration_seconds: Math.round(totalMs / 100) / 10,
        last_error: null,
      })
      .eq("id", job.id);
    return true;
  } catch (e) {
    await failJob(sb, job.id as string, e instanceof Error ? e.message : String(e));
    return false;
  }
}

// ---------------------------------------------------------------------------
// שלב ה' — הורדה ושמירה אצלנו
//
// הקובץ לא נשאר אצל fal. הכתובת שלהם פגה, והמודעה הייתה מאבדת את הסרטון
// בלי שאיש יידע. הנתיב זהה לזה של סרטון שהסוכן/ת מעלה בעצמו/ה
// (‏<agent_id>/<property_id>/) כדי שמדיניות המחיקה הקיימת בדלי תחול גם כאן.
// ---------------------------------------------------------------------------
async function storeVideo(sb: Sb, job: Record<string, unknown>, sourceUrl: string) {
  const { data: property } = await sb
    .from("properties")
    .select("agent_id")
    .eq("id", job.property_id)
    .single();

  const res = await fetch(sourceUrl);
  if (!res.ok) throw new Error(`הורדת הסרטון מ-fal נכשלה: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());

  const path = `${property?.agent_id ?? "platform"}/${job.property_id}/marketing-${job.id}.mp4`;
  const { error } = await sb.storage
    .from(VIDEO_BUCKET)
    .upload(path, bytes, { contentType: "video/mp4", upsert: true });
  if (error) throw new Error(`שמירת הסרטון בדלי נכשלה: ${error.message}`);

  const { data } = sb.storage.from(VIDEO_BUCKET).getPublicUrl(path);
  return data.publicUrl as string;
}

// ---------------------------------------------------------------------------
// מכונת השלבים
//
// רצה עד ‎ROUND_MS‎ ואז יוצאת ומשחררת את החכירה, כדי שהסבב הבא — של ה-cron
// שרץ כל דקה — ימשיך מיד ולא יחכה לפקיעת החכירה המלאה.
// ---------------------------------------------------------------------------
async function driveJob(sb: Sb, job: Record<string, unknown>, cfg: Record<string, number>) {
  const deadline = Date.now() + ROUND_MS;
  const jobId = job.id as string;
  let stage = job.stage as string;

  try {
    if (stage === "pending") {
      if (!(await planClips(sb, job, cfg))) return;

      if (job.kind === "ai_reel") {
        await submitClips(sb, jobId, cfg);
        stage = "clips";
        await sb.from("property_video_jobs").update({ stage }).eq("id", jobId);
      } else {
        // slideshow: הקליפים כבר גמורים, אין מה לאסוף
        if (!(await submitCompose(sb, job, cfg))) return;
        stage = "compose";
      }
    }

    if (stage === "clips") {
      let settled = false;
      while (!settled && Date.now() < deadline) {
        settled = await collectClips(sb, jobId);
        if (!settled) await sleep(POLL_MS);
      }
      if (!settled) return; // עוד רצים אצל fal — הסבב הבא ימשיך מכאן
      if (!(await submitCompose(sb, job, cfg))) return;
      stage = "compose";
    }

    if (stage === "compose") {
      const { data: fresh } = await sb
        .from("property_video_jobs")
        .select("compose_status_url, compose_response_url")
        .eq("id", jobId)
        .single();
      if (!fresh?.compose_status_url) return;

      while (Date.now() < deadline) {
        const state = await falPoll(FAL_KEY, fresh.compose_status_url, fresh.compose_response_url);

        if (state.state === "pending") {
          await sleep(POLL_MS);
          continue;
        }
        if (state.state === "failed") {
          await failJob(sb, jobId, `חיבור הסרטון נכשל: ${state.reason}`);
          return;
        }

        const url = falVideoUrl(state.payload);
        if (!url) {
          await failJob(sb, jobId, "תשובת החיבור אינה כוללת כתובת וידאו");
          return;
        }

        const stored = await storeVideo(sb, job, url);
        await sb
          .from("property_video_jobs")
          .update({
            stage: "done",
            video_url: stored,
            last_error: null,
            claimed_at: null,
            finished_at: new Date().toISOString(),
          })
          .eq("id", jobId);
        return;
      }
    }
  } catch (e) {
    await failJob(sb, jobId, e instanceof Error ? e.message : String(e));
    return;
  }

  // הסבב נגמר והבקשה עוד פתוחה: משחררים את החכירה כדי שהדקה הבאה תמשיך.
  await sb
    .from("property_video_jobs")
    .update({ claimed_at: null })
    .eq("id", jobId)
    .in("stage", ["pending", "clips", "compose"]);
}

// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  if (!FAL_KEY) return json({ error: "fal_not_configured", detail: "‏FAL_KEY אינו מוגדר" }, 503);

  const internal = authorizeInternalCaller(req);
  const authHeader = req.headers.get("Authorization") || "";
  const sb = createClient(supabaseUrl, serviceRoleKey);

  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {}; // ‏pg_cron שולח בקשה בלי גוף
  }

  const cfg = await config(sb);
  const propertyId: string | null = body?.property_id ?? null;

  // ---------------------------------------------------------------------
  // המסלול הפנימי — קידום בקשות פתוחות
  // ---------------------------------------------------------------------
  if (!propertyId) {
    if (!internal.ok) {
      if (internal.status === 503) return json({ error: internal.error, detail: internal.detail }, 503);
      return json({ error: "unauthorized" }, 401);
    }

    const { data: jobs, error } = await sb.rpc("claim_property_video_jobs", { p_limit: 3 });
    if (error) return json({ error: "claim_failed", detail: error.message }, 500);
    if (!jobs?.length) return json({ ok: true, advanced: 0 });

    // deno-lint-ignore no-explicit-any
    await Promise.all(jobs.map((job: any) => driveJob(sb, job, cfg)));
    // deno-lint-ignore no-explicit-any
    return json({ ok: true, advanced: jobs.length, job_ids: jobs.map((j: any) => j.id) });
  }

  // ---------------------------------------------------------------------
  // המסלול של הסוכן/ת
  //
  // ההרשאה, הזכאות, ה-cooldown והתקרה נבדקים במסד בהקשר ה-JWT עצמו — אותו
  // עיקרון כמו ב-bump_property וב-request_property_description.
  // ---------------------------------------------------------------------
  const kind = body?.kind === "ai_reel" ? "ai_reel" : "slideshow";

  if (!authHeader) return json({ error: "unauthorized" }, 401);

  const authed = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: gate, error: gateErr } = await authed.rpc("request_property_video", {
    p_property_id: propertyId,
    p_kind: kind,
  });
  if (gateErr) return json({ error: "request_failed", detail: gateErr.message }, 500);

  const codes: Record<string, number> = {
    not_authenticated: 401,
    not_your_property: 403,
    ai_not_available: 403,
    property_not_found: 404,
    property_not_active: 400,
    not_enough_images: 400,
    bad_kind: 400,
    disabled: 503,
    cooldown_active: 429,
    daily_cap_reached: 429,
  };
  if (gate?.error) {
    return json(
      { error: gate.error, retry_after_seconds: gate.retry_after_seconds ?? null },
      codes[gate.error] ?? 400,
    );
  }

  const jobId = gate?.job_id as string;

  // בקשה שכבר רצה — לא מתחילים אותה שוב, רק מחזירים את המזהה כדי שהמסך
  // יתחיל לעקוב אחריה.
  if (gate?.already_running) {
    return json({ ok: true, job_id: jobId, already_running: true });
  }

  const { data: job } = await sb
    .from("property_video_jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  // הבקשה נוצרה זה עתה, אז שורה חסרה כאן פירושה תקלת קריאה ולא מצב לגיטימי.
  // במקרה כזה משחררים את החכירה שה-RPC קבע — אחרת הבקשה הייתה ממתינה חמש
  // דקות לפקיעתה בלי שאיש מקדם אותה — וה-cron ייקח אותה בדקה הבאה. ה-job_id
  // חוזר כרגיל: השורה קיימת והמסך כבר יודע לעקוב אחריה.
  if (job) {
    // @ts-ignore — EdgeRuntime.waitUntil זמין בסביבת ה-Edge Functions של Supabase
    EdgeRuntime.waitUntil(driveJob(sb, job, cfg));
  } else {
    await sb.from("property_video_jobs").update({ claimed_at: null }).eq("id", jobId);
  }

  return json({ ok: true, job_id: jobId, kind, already_running: false });
});
