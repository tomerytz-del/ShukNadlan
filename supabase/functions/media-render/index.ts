import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { authorizeInternalCaller } from "../_shared/cron-auth.ts";

// ============================================================================
// מנוע המדיה — הצד של Supabase. ‏docs/media-worker.md.
//
// ffmpeg רץ ב-GitHub Actions (‏media_render.yml + media_engine/), כי ל-Edge
// Function אין ffmpeg. הפונקציה הזו היא כל מה שבין התור במסד לבין הריצה:
//
//   ?mode=dispatch  ‏pg_cron, כל 2 דקות כשיש בקשה פתוחה. מעיר ריצה של Actions,
//                   מחזיר לתור בקשה שנתקעה, ומכשיל בקשה שאיש לא לקח.
//   ?mode=claim     המנוע. לוקח בקשה אחת ומקבל כתובת העלאה חתומה לתוצר.
//   ?mode=complete  המנוע. הקובץ עלה, ומה ש-ffprobe מדד עליו.
//   ?mode=fail      המנוע. רינדור שנכשל, ואם כדאי לנסות שוב.
//
// **למנוע אין service_role.** הוא מחזיק סוד אחד (‏MEDIA_WORKER_SECRET) שמאפשר
// רק את שלוש הפעולות האלה, ומעלה לנתיב שהשרת בחר — לא לנתיב שהוא מבקש.
// הריפו ציבורי, ולכן גם יומני הריצה ציבוריים: שום דבר שהמנוע מקבל מכאן אינו
// נותן גישה למסד.
//
// ‏verify_jwt = false — לא ל-cron ולא ל-Actions יש JWT שלנו. שני המסלולים
// מאומתים כאן, ושניהם fail-closed: סוד שלא הוגדר הוא 503, לא "פתוח".
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WORKER_SECRET = Deno.env.get("MEDIA_WORKER_SECRET") || "";
const GITHUB_TOKEN = Deno.env.get("GITHUB_DISPATCH_TOKEN") || "";
const GITHUB_REPO = Deno.env.get("GITHUB_REPO") || "tomerytz-del/ShukNadlan";
const GITHUB_REF = Deno.env.get("GITHUB_DISPATCH_REF") || "main";
const WORKFLOW_FILE = "media_render.yml";

const BUCKET = "media-renders";

// הספים. הם כאן ולא בתנאי של ה-cron בכוונה (‏20261021090000).
//
// ‏STALE_RENDER — ריצה שלקחה בקשה ונעלמה (ה-runner מת, הזמן נגמר). רינדור
//   של Reel של דקה נמדד ב-26 שניות; 20 דקות הן בבירור תקלה.
// ‏REDISPATCH — שיגור שלא הוליד ריצה. ‏Actions מתחיל בדרך כלל תוך דקה, אבל
//   על runner משותף נמדדו גם איחורים ארוכים (ראו ops_agent.yml), ולכן לא
//   מתעצבנים לפני 10 דקות.
// ‏ABANDON — בקשה שאיש לא לקח יום שלם. בלי זה ה-cron היה יורה כל 2 דקות
//   לנצח על בקשה שהמנוע שלה כבוי.
const STALE_RENDER_MINUTES = 20;
const REDISPATCH_MINUTES = 10;
const ABANDON_HOURS = 24;
const MAX_ATTEMPTS = 3;

const EXT: Record<string, { ext: string; type: string }> = {
  poster: { ext: "jpg", type: "image/jpeg" },
  compress: { ext: "mp4", type: "video/mp4" },
  reel: { ext: "mp4", type: "video/mp4" },
  merge: { ext: "mp4", type: "video/mp4" },
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function secretsMatch(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authorizeWorker(req: Request): { ok: true } | { ok: false; status: number; error: string } {
  if (!WORKER_SECRET) return { ok: false, status: 503, error: "media_worker_secret_not_configured" };
  const provided = req.headers.get("x-media-worker-secret") || "";
  if (!secretsMatch(provided, WORKER_SECRET)) return { ok: false, status: 401, error: "unauthorized" };
  return { ok: true };
}

function minutesAgo(n: number): string {
  return new Date(Date.now() - n * 60_000).toISOString();
}

// ---------------------------------------------------------------------------
// dispatch — מה שה-cron מפעיל
// ---------------------------------------------------------------------------
async function dispatch(supabase: any) {
  const now = new Date().toISOString();
  const summary = { requeued: 0, failed_stale: 0, abandoned: 0, dispatched: 0, dispatch_error: null as string | null };

  // 1. ריצה שלקחה בקשה ונעלמה. חוזרת לתור כל עוד נשארו ניסיונות.
  const { data: stale, error: staleErr } = await supabase
    .from("media_renders")
    .select("id, attempts")
    .eq("status", "rendering")
    .lt("started_at", minutesAgo(STALE_RENDER_MINUTES));
  if (staleErr) return json({ error: "db_error", detail: staleErr.message }, 500);

  for (const row of stale ?? []) {
    const giveUp = row.attempts >= MAX_ATTEMPTS;
    // ‏update מותנה-סטטוס: אם המנוע דיווח בדיוק עכשיו, הוא ניצח וזה no-op.
    const { data: moved } = await supabase
      .from("media_renders")
      .update(giveUp
        ? { status: "failed", last_error: "stale_render", finished_at: now, updated_at: now }
        : { status: "queued", dispatched_at: null, last_error: "stale_render", updated_at: now })
      .eq("id", row.id)
      .eq("status", "rendering")
      .select("id");
    if (moved?.length) giveUp ? summary.failed_stale++ : summary.requeued++;
  }

  // 2. בקשה שאיש לא לקח יום שלם — המנוע כבוי או שבור. נכשלת ברעש.
  const { data: abandoned } = await supabase
    .from("media_renders")
    .update({ status: "failed", last_error: "never_picked_up", finished_at: now, updated_at: now })
    .eq("status", "queued")
    .lt("created_at", minutesAgo(ABANDON_HOURS * 60))
    .select("id");
  summary.abandoned = abandoned?.length ?? 0;

  // 3. מה שצריך שיגור: לא שוגר, או ששוגר ולא נלקח.
  const { data: due, error: dueErr } = await supabase
    .from("media_renders")
    .select("id")
    .eq("status", "queued")
    .or(`dispatched_at.is.null,dispatched_at.lt."${minutesAgo(REDISPATCH_MINUTES)}"`);
  if (dueErr) return json({ error: "db_error", detail: dueErr.message }, 500);
  if (!due?.length) return json({ ok: true, ...summary });

  // ריצה אחת לכל הבקשות: המנוע לוקח בלולאה עד שהתור ריק. ריצה לכל בקשה
  // הייתה משלמת חצי דקה של עליית runner על כל אחת.
  if (!GITHUB_TOKEN) {
    return json({ ...summary, error: "github_dispatch_not_configured",
      detail: "‏GITHUB_DISPATCH_TOKEN אינו מוגדר. ראו docs/media-worker.md." }, 503);
  }

  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "shuknadlan-media-render",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: GITHUB_REF }),
    },
  );
  if (res.status !== 204) {
    summary.dispatch_error = `github_${res.status}: ${(await res.text()).slice(0, 300)}`;
    return json({ ...summary, error: "github_dispatch_failed" }, 502);
  }

  await supabase
    .from("media_renders")
    .update({ dispatched_at: now, updated_at: now })
    .in("id", due.map((r: { id: string }) => r.id))
    .eq("status", "queued");
  summary.dispatched = due.length;
  return json({ ok: true, ...summary });
}

// ---------------------------------------------------------------------------
// claim — המנוע לוקח בקשה
//
// הנתיב נבחר כאן ונשמר על השורה **לפני** שהמנוע מקבל אותו. ‏complete אינו
// מקבל נתיב מהמנוע בכלל, ולכן מנוע שנפרץ אינו יכול לכתוב כתובת של קובץ זר
// על בקשה.
// ---------------------------------------------------------------------------
async function claim(supabase: any) {
  const { data: job, error } = await supabase.rpc("claim_media_render");
  if (error) return json({ error: "db_error", detail: error.message }, 500);
  // פונקציה שמחזירה שורה מחזירה null — או שורה שכל השדות בה null.
  if (!job?.id) return json({ job: null });

  const spec = EXT[job.kind];
  if (!spec) {
    await failJob(supabase, job.id, `unknown_kind: ${job.kind}`, false);
    return json({ job: null, skipped: job.id });
  }

  const path = `${job.kind}/${job.property_id ?? "none"}/${job.id}-${job.attempts}.${spec.ext}`;
  const { data: signed, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(path, { upsert: true });
  if (signErr || !signed?.signedUrl) {
    // לא באשמת הבקשה — חוזרת לתור לניסיון הבא.
    await failJob(supabase, job.id, `sign_upload_failed: ${signErr?.message ?? "no_url"}`, true);
    return json({ error: "sign_upload_failed" }, 500);
  }

  await supabase
    .from("media_renders")
    .update({ output_path: path, updated_at: new Date().toISOString() })
    .eq("id", job.id);

  return json({
    job: { id: job.id, kind: job.kind, property_id: job.property_id, input: job.input, attempt: job.attempts },
    upload: { url: signed.signedUrl, content_type: spec.type },
  });
}

// ---------------------------------------------------------------------------
// complete / fail
// ---------------------------------------------------------------------------
async function complete(supabase: any, body: any) {
  const jobId = String(body?.job_id || "");
  if (!jobId) return json({ error: "job_id_required" }, 400);

  const { data: job } = await supabase
    .from("media_renders")
    .select("id, status, output_path")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return json({ error: "not_found" }, 404);
  if (job.status !== "rendering" || !job.output_path) {
    return json({ error: "not_rendering", status: job.status }, 409);
  }

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(job.output_path);
  const now = new Date().toISOString();
  const meta = body?.meta && typeof body.meta === "object" ? body.meta : null;

  const { data: done } = await supabase
    .from("media_renders")
    .update({
      status: "done",
      output_url: pub.publicUrl,
      output_meta: meta,
      last_error: null,
      finished_at: now,
      updated_at: now,
    })
    .eq("id", jobId)
    .eq("status", "rendering")
    .select("id");
  if (!done?.length) return json({ error: "not_rendering" }, 409);

  return json({ ok: true, url: pub.publicUrl });
}

async function failJob(supabase: any, jobId: string, reason: string, retryable: boolean) {
  const { data: job } = await supabase
    .from("media_renders")
    .select("id, status, attempts")
    .eq("id", jobId)
    .maybeSingle();
  if (!job || job.status !== "rendering") return { ok: false, status: job?.status ?? "not_found" };

  const now = new Date().toISOString();
  const again = retryable && job.attempts < MAX_ATTEMPTS;
  await supabase
    .from("media_renders")
    .update(again
      ? { status: "queued", dispatched_at: null, last_error: reason.slice(0, 1000), updated_at: now }
      : { status: "failed", last_error: reason.slice(0, 1000), finished_at: now, updated_at: now })
    .eq("id", jobId)
    .eq("status", "rendering");
  return { ok: true, status: again ? "queued" : "failed" };
}

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const mode = new URL(req.url).searchParams.get("mode") || "";
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  if (mode === "dispatch") {
    const auth = authorizeInternalCaller(req);
    if (!auth.ok) return json({ error: auth.error, detail: auth.detail }, auth.status);
    return await dispatch(supabase);
  }

  if (mode === "claim" || mode === "complete" || mode === "fail") {
    const auth = authorizeWorker(req);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    if (mode === "claim") return await claim(supabase);

    let body: any = null;
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    if (mode === "complete") return await complete(supabase, body);

    const jobId = String(body?.job_id || "");
    if (!jobId) return json({ error: "job_id_required" }, 400);
    const result = await failJob(supabase, jobId, String(body?.error || "unknown"), body?.retryable === true);
    return json(result, result.ok ? 200 : 409);
  }

  return json({ error: "unknown_mode" }, 400);
});
