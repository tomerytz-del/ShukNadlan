// ============================================================================
// רילס בתבנית D - המעברים בין המפיקים.
//
// שלושה מפיקים, בסדר הזה:
//
//   1. ‏grok_reel  - Grok Bot. דוגם את התור דרך ‎reel-producer‎. ראשי.
//   2. ‏site_reel  - הגיבוי של האתר: workflow ב-GitHub Actions
//      (‏`.github/workflows/reel_render.yml`) שמריץ את אותו ‎reel.py‎ שבערכה,
//      ולכן התוצאה זהה לזו של Grok ולא "דומה" לה.
//   3. ‏fal_legacy - Kling + מיזוג אצל fal, המסלול שהיה עד 24.10.2026. מוצא
//      אחרון, כשגם הגיבוי נכשל.
//
// ‏**כל מעבר הוא update מותנה-סטטוס**, כמו ‎claim‎ ב-property-video-callback:
// ה-reconcile, ‏reel-producer ו-property-video-create יכולים להגיע לאותה בקשה
// באותה דקה, ומי שהפסיד במרוץ מקבל אפס שורות ופורש. כך בקשה לא נשלחת
// לשני מפיקים, ו-fal לא מקבל אותה פעמיים.
//
// הכסף לא זז כאן: החיוב כבר ירד ב-‎start_property_video_job‎, וכל כישלון
// סופי עובר ב-‎failVideoJob‎ (הסקיל property-video).
// ============================================================================

import { ensureTagged } from "./visualization.ts";
import {
  buildClipInput,
  buildScenePrompt,
  failVideoJob,
  falSubmit,
  FAL_VIDEO_MODEL,
  type FailResult,
  isTransientFailure,
  pickScenes,
} from "./property-video.ts";

// deno-lint-ignore no-explicit-any
type Sb = any;

export const OPEN_STATUSES = ["pending_reel", "rendering", "generating_clips", "merging", "uploading"];
export const REEL_STATUSES = ["pending_reel", "rendering"];

// ‏Grok "חי" אם דיווח בעשר הדקות האחרונות. הוא דוגם כל 2-3 דקות, ולכן
// עשר דקות הן שלושה סבבים שהוחמצו ולא תור עמוס.
export const PRODUCER_FRESH_MINUTES = 10;

const supabaseUrl = () => (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");

export function callbackBase(): string {
  const explicit = Deno.env.get("PROPERTY_VIDEO_CALLBACK_URL");
  if (explicit) return explicit.replace(/\/+$/, "");
  return `${supabaseUrl()}/functions/v1/property-video-callback`;
}

async function pricing(supabase: Sb, key: string, fallback: number): Promise<number> {
  const { data } = await supabase.from("pricing_config").select("value").eq("key", key).maybeSingle();
  const n = Number(data?.value);
  return Number.isFinite(n) ? n : fallback;
}

export async function grokIsOnline(supabase: Sb): Promise<boolean> {
  const since = new Date(Date.now() - PRODUCER_FRESH_MINUTES * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("producer_heartbeat")
    .select("last_seen")
    .eq("producer", "grok_reel")
    .gt("last_seen", since)
    .maybeSingle();
  return !!data;
}

// ---------------------------------------------------------------------------
// הגיבוי של האתר: workflow_dispatch
//
// ה-workflow מקבל רק את מזהה הבקשה. את הנתונים הוא שולף מ-‎reel-producer‎
// עם סוד משלו (‏REEL_SITE_SECRET), ולא מחזיק מפתח service_role.
// ---------------------------------------------------------------------------
export async function dispatchSiteReel(jobId: string): Promise<{ ok: boolean; error?: string }> {
  const token = Deno.env.get("GH_DISPATCH_TOKEN");
  if (!token) return { ok: false, error: "gh_dispatch_not_configured" };
  const repo = Deno.env.get("GH_REPO") || "tomerytz-del/ShukNadlan";
  const ref = Deno.env.get("GH_REEL_REF") || "main";
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/reel_render.yml/dispatches`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "shuknadlan-reel",
      },
      body: JSON.stringify({ ref, inputs: { job_id: jobId } }),
    });
    if (res.status === 204) return { ok: true };
    return { ok: false, error: `gh_${res.status}: ${(await res.text()).slice(0, 200)}` };
  } catch (err) {
    return { ok: false, error: `gh_network: ${(err as Error).message}` };
  }
}

// ‏Grok לא לקח / נתקע / ויתר → הגיבוי של האתר. ‏fromClaimedBy: מי מחזיק
// עכשיו (null = עדיין pending_reel). הבקשה עוברת רק אם היא עדיין אצלו.
export async function handoffToSite(
  supabase: Sb,
  jobId: string,
  reason: string,
  fromClaimedBy: string | null,
): Promise<"dispatched" | "fal" | "failed" | "lost_race"> {
  const now = new Date().toISOString();
  let q = supabase
    .from("property_video_jobs")
    .update({
      status: "rendering",
      producer: "site_reel",
      claimed_by: "site_reel",
      claimed_at: now,
      heartbeat_at: now,
      fallback_reason: reason.slice(0, 300),
      updated_at: now,
    })
    .eq("id", jobId);
  q = fromClaimedBy
    ? q.eq("status", "rendering").eq("claimed_by", fromClaimedBy)
    : q.eq("status", "pending_reel");
  const { data } = await q.select("id").maybeSingle();
  if (!data) return "lost_race";
  return await startSiteRender(supabase, jobId);
}

// הבקשה כבר ב-rendering אצל site_reel (מ-handoff או ישר מ-property-video-create).
export async function startSiteRender(supabase: Sb, jobId: string): Promise<"dispatched" | "fal" | "failed"> {
  const sent = await dispatchSiteReel(jobId);
  if (sent.ok) return "dispatched";
  console.error(`reel dispatch failed for ${jobId}: ${sent.error}`);
  const r = await fallbackToFal(supabase, jobId, `site_dispatch_failed: ${sent.error}`);
  return r.ok ? "fal" : "failed";
}

// ---------------------------------------------------------------------------
// המוצא האחרון: fal
// ---------------------------------------------------------------------------
// ‏refunded / refund_pending: מה קרה לכסף כשהשליחה נכשלה והבקשה נסגרה.
export interface FalStart {
  ok: boolean;
  refunded?: number;
  refund_pending?: boolean;
  clips?: number;
  clips_failed?: number;
  seconds?: number;
  error?: string;
  detail?: string | null;
}

function money(closed: FailResult) {
  return { refunded: closed.refunded, refund_pending: !closed.ok };
}

export async function fallbackToFal(supabase: Sb, jobId: string, reason: string): Promise<FalStart> {
  const { data: row } = await supabase
    .from("property_video_jobs")
    .select("fallback_reason")
    .eq("id", jobId)
    .maybeSingle();
  const why = [row?.fallback_reason, reason].filter(Boolean).join(" | ").slice(0, 500);
  const { data } = await supabase
    .from("property_video_jobs")
    .update({
      status: "generating_clips",
      producer: "fal_legacy",
      claimed_by: null,
      fallback_reason: why,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("status", "rendering")
    .eq("claimed_by", "site_reel")
    .select("id")
    .maybeSingle();
  if (!data) return { ok: false, error: "lost_race" };
  return await startFalLegacy(supabase, jobId);
}

// ‏לולאת השליחה ל-fal, שהייתה בתוך property-video-create עד תבנית D. הבקשה
// חייבת כבר להיות ב-generating_clips; כל כישלון כאן נגמר ב-failVideoJob.
export async function startFalLegacy(supabase: Sb, jobId: string): Promise<FalStart> {
  const { data: job } = await supabase
    .from("property_video_jobs")
    .select("id, property_id, aspect_ratio, webhook_token, clip_seconds")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return { ok: false, error: "job_not_found" };

  const { data: property } = await supabase
    .from("properties")
    .select("id, property_type, images")
    .eq("id", job.property_id)
    .maybeSingle();
  const images: string[] = Array.isArray(property?.images) ? property.images.filter(Boolean) : [];

  const clipCount = Math.max(1, Math.round(await pricing(supabase, "property_video_clip_count", 5)));
  const clipSeconds = Math.max(0.5, await pricing(supabase, "property_video_clip_seconds", 5));
  const sourceSeconds = Math.max(clipSeconds, await pricing(supabase, "property_video_source_seconds", 5));
  // ‏clip_seconds חייב להיות שווה ל-source_seconds: אין דרך לקצר קליף של
  // Kling אחרי שנוצר (הסקיל property-video, סעיף 5).
  const askSeconds = Math.max(clipSeconds, sourceSeconds);

  let tags: any[] = [];
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (geminiKey && images.length) {
    try {
      tags = await ensureTagged(supabase, geminiKey, job.property_id, images);
    } catch (err) {
      console.warn("classification failed, falling back to upload order:", err);
    }
  }
  const scenes = pickScenes(tags, images, clipCount);
  if (!scenes.length) {
    const closed = await failVideoJob(supabase, jobId, "fal_no_images");
    return { ok: false, error: "no_images", ...money(closed) };
  }

  const { data: insertedClips, error: clipErr } = await supabase
    .from("property_video_clips")
    .insert(scenes.map((scene, idx) => ({
      job_id: jobId,
      idx,
      target: scene.target,
      source_image_url: scene.url,
      prompt: buildScenePrompt(scene.target, property?.property_type ?? null),
    })))
    .select("id, idx, source_image_url, prompt");
  if (clipErr) {
    const closed = await failVideoJob(supabase, jobId, `db_error: ${clipErr.message}`);
    return { ok: false, error: "db_error", detail: clipErr.message, ...money(closed) };
  }

  // מזהה הקליף בכתובת ה-webhook, ולא בגוף התשובה של fal (משתנה בין מודלים).
  const base = callbackBase();
  let submitted = 0;
  const failures: string[] = [];
  for (const clip of insertedClips ?? []) {
    const hook = `${base}?token=${encodeURIComponent(job.webhook_token)}&job=${jobId}&clip=${clip.id}`;
    const input = buildClipInput(clip.source_image_url, clip.prompt, askSeconds, job.aspect_ratio);
    let result = await falSubmit(FAL_VIDEO_MODEL, input, hook);
    // ניסיון שני לכשל חולף בלבד; ‏422 הוא קלט פסול ושליחה חוזרת רק תשלם שוב.
    if (!result.ok && isTransientFailure(result.error)) {
      result = await falSubmit(FAL_VIDEO_MODEL, input, hook);
    }
    if (result.ok) {
      await supabase.from("property_video_clips").update({ fal_request_id: result.requestId }).eq("id", clip.id);
      submitted++;
    } else {
      await supabase.from("property_video_clips")
        .update({ status: "failed", error_detail: result.error })
        .eq("id", clip.id);
      failures.push(result.error ?? "unknown");
    }
  }

  await supabase.from("property_video_jobs")
    .update({ source_seconds: askSeconds, clip_seconds: askSeconds })
    .eq("id", jobId);

  if (submitted === 0) {
    const closed = await failVideoJob(supabase, jobId, `fal_submit_failed: ${failures.slice(0, 3).join(" | ")}`);
    return { ok: false, error: "fal_submit_failed", detail: failures[0] ?? null, ...money(closed) };
  }
  return {
    ok: true,
    clips: submitted,
    clips_failed: (insertedClips?.length ?? 0) - submitted,
    seconds: Math.round(submitted * askSeconds * 10) / 10,
  };
}
