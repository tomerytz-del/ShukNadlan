import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { json, removeStoredVideo, tokensMatch, VIDEOS_BUCKET, failVideoJob } from "../_shared/property-video.ts";
import { fallbackToFal, handoffToSite } from "../_shared/reel-fallback.ts";

// ============================================================================
// ‏reel-producer - הממשק של מפיקי הרילסים (תבנית D) מול המסד.
//
// שני קוראים, כל אחד עם סוד משלו בכותרת ‎x-reel-producer-secret‎:
//
//   • ‏Grok Bot   - ‏REEL_PRODUCER_SECRET → ‏producer = grok_reel
//   • הגיבוי שלנו - ‏REEL_SITE_SECRET     → ‏producer = site_reel
//     (‏.github/workflows/reel_render.yml)
//
// **הזהות נגזרת מהסוד, ולא מגוף הבקשה.** כך Grok אינו יכול להשלים בקשה
// שעברה לגיבוי, והגיבוי אינו יכול לדגום את התור של Grok. שני סודות נפרדים
// גם אומרים שדליפה של אחד אינה פותחת את השני, ושאפשר להחליף אחד בלי לעצור
// את המפיק השני.
//
// ‏verify_jwt = false: לאף אחד מהם אין JWT שלנו. ‏service_role נשאר בפנים.
//
//   POST ?action=heartbeat          ‏{ version?, status? }                      (grok)
//   POST ?action=claim              ‏{}  → הבקשה + כל הנתונים לרינדור, או null  (grok)
//   POST ?action=job_data           ‏{ job_id } → אותם נתונים לבקשה שבידיו      (שניהם)
//   POST ?action=job_heartbeat      ‏{ job_id } → ‏not_owner = הבקשה עברה, לעצור (שניהם)
//   POST ?action=upload_urls        ‏{ job_id }                                  (שניהם)
//   POST ?action=complete           ‏{ job_id, video_path, cover_path }          (שניהם)
//   POST ?action=fail               ‏{ job_id, reason } → לגיבוי, לא זיכוי       (שניהם)
//   POST ?action=daily_upload_urls  ‏{ property_id }                             (grok)
//   POST ?action=daily_attach       ‏{ property_id, video_path, cover_path, published_urls } (grok)
//
// ‏docs/property-marketing-video.md, "תבנית D".
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const TOMER_AGENT_ID = "2f552dcf-90d0-4578-9038-cc6e7b9e26a5";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MUSIC_BUCKET = "reel-assets";
const MUSIC_PATH = "music/pixabay/candidate_1.mp3";

type Producer = "grok_reel" | "site_reel";
// deno-lint-ignore no-explicit-any
type Sb = any;

function whoIs(req: Request): Producer | null {
  const got = req.headers.get("x-reel-producer-secret") || "";
  const grok = Deno.env.get("REEL_PRODUCER_SECRET") || "";
  const site = Deno.env.get("REEL_SITE_SECRET") || "";
  // שתי ההשוואות רצות תמיד, כדי שהזמן לא יסגיר איזה סוד כמעט התאים.
  const isGrok = grok.length >= 32 && tokensMatch(got, grok);
  const isSite = site.length >= 32 && tokensMatch(got, site);
  if (isGrok) return "grok_reel";
  if (isSite) return "site_reel";
  return null;
}

function publicUrl(supabase: Sb, path: string): string {
  return supabase.storage.from(VIDEOS_BUCKET).getPublicUrl(path).data.publicUrl;
}

// נתיב שהמפיק החזיר. חייב לשבת בתיקיית הנכס ולשאת את הקידומת של הרילס,
// אחרת "complete" היה מצמיד לנכס כל קובץ בדלי - גם של נכס אחר.
function pathOk(path: unknown, dir: string, prefix: string, ext: string): path is string {
  return typeof path === "string"
    && path.startsWith(`${dir}/${prefix}`)
    && path.endsWith(ext)
    && !path.includes("..")
    && path.split("/").length === dir.split("/").length + 1;
}

async function fileExists(supabase: Sb, path: string): Promise<boolean> {
  const at = path.lastIndexOf("/");
  const { data } = await supabase.storage.from(VIDEOS_BUCKET)
    .list(path.slice(0, at), { search: path.slice(at + 1), limit: 5 });
  return (data ?? []).some((f: any) => f.name === path.slice(at + 1) && (f.metadata?.size ?? 1) > 0);
}

async function removePaths(supabase: Sb, paths: string[]) {
  const list = paths.filter(Boolean);
  if (list.length) await supabase.storage.from(VIDEOS_BUCKET).remove(list).catch(() => {});
}

// שער ישן נמחק רק כשהוא שער של המערכת בדלי שלנו (‏marketing-…-cover.jpg).
async function removeSystemPoster(supabase: Sb, url: string | null) {
  if (url && /\/property-videos\/[^?]*\/marketing-[^/?]*-cover\.jpg(\?.*)?$/.test(url)) {
    await removeStoredVideo(supabase, url);
  }
}

// ---------------------------------------------------------------------------
// הנתונים לרינדור. בלי property_owners ובלי שום פרט של הבעלים.
// ---------------------------------------------------------------------------
const PROPERTY_COLS =
  "id, listing_number, title, status, images, category, property_type, deal_type, price, price_includes_vat, " +
  "rooms, size_sqm, built_size_sqm, area_sqm, floor, total_floors, features, city, street, sales_area, " +
  "neighborhood_id, garden_sqm, price_per_sqm, move_in_date, land_zoning, maintenance_fee, arnona, " +
  "created_at, agent_id, agency_id, video_url";

async function renderData(supabase: Sb, propertyId: string) {
  const { data: property } = await supabase.from("properties").select(PROPERTY_COLS).eq("id", propertyId).maybeSingle();
  if (!property) return null;

  const [tagsRes, nbRes, agencyRes, discRes] = await Promise.all([
    supabase.from("property_image_tags")
      .select("image_url, photo_type, space_role, room_type, has_branding")
      .eq("property_id", propertyId),
    property.neighborhood_id
      ? supabase.from("neighborhoods").select("name").eq("id", property.neighborhood_id).maybeSingle()
      : Promise.resolve({ data: null }),
    property.agency_id
      ? supabase.from("agencies").select("name, logo_url").eq("id", property.agency_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("ads_settings").select("value").eq("key", "disclosure_line").maybeSingle(),
  ]);

  // ‏show_photo_in_ads: הצ'קבוקס "הצג את התמונה שלי בפרסומים" בפרופיל
  // (‏20270810090000). הנסיון השני בלעדיה הוא לדקות שבין פריסת הפונקציה
  // להחלת המיגרציה - "חסר = true".
  const memberCols = "display_name, phone, phone_e164, photo_url, photo_position, license_number";
  let agentRes = await supabase.from("agency_members").select(`${memberCols}, show_photo_in_ads`)
    .eq("id", property.agent_id).maybeSingle();
  if (agentRes.error) {
    agentRes = await supabase.from("agency_members").select(memberCols).eq("id", property.agent_id).maybeSingle();
  }
  const agent = agentRes.data ?? {};

  return {
    property,
    images: Array.isArray(property.images) ? property.images.filter(Boolean) : [],
    image_tags: tagsRes.data ?? [],
    neighborhood: nbRes.data?.name ?? null,
    agent: {
      id: property.agent_id,
      name: agent.display_name ?? null,
      phone: agent.phone || agent.phone_e164 || null,
      photo_url: agent.photo_url ?? null,
      photo_position: agent.photo_position ?? null,
      show_photo_in_ads: agent.show_photo_in_ads !== false,
      license_number: agent.license_number ?? null,
    },
    agency: { name: agencyRes.data?.name ?? null, logo_url: agencyRes.data?.logo_url ?? null },
    // שורת הגילוי של תומר - רק בנכסים שלו עצמו. סוכנים אחרים במשרד אינם תומר.
    is_tomer: property.agent_id === TOMER_AGENT_ID,
    disclosure_line: property.agent_id === TOMER_AGENT_ID ? (discRes.data?.value ?? null) : null,
  };
}

async function loadOwnedJob(supabase: Sb, jobId: unknown, producer: Producer) {
  if (typeof jobId !== "string" || !UUID.test(jobId)) return { error: "bad_job_id" as const };
  const { data: job } = await supabase
    .from("property_video_jobs")
    .select("id, status, claimed_by, property_id, agent_id, aspect_ratio, previous_video_url")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return { error: "job_not_found" as const };
  if (job.status !== "rendering" || job.claimed_by !== producer) return { error: "not_owner" as const, job };
  return { job };
}

async function signedUploads(supabase: Sb, dir: string, prefix: string) {
  const stem = `${dir}/${prefix}${crypto.randomUUID()}`;
  const [video, cover] = await Promise.all([
    supabase.storage.from(VIDEOS_BUCKET).createSignedUploadUrl(`${stem}.mp4`),
    supabase.storage.from(VIDEOS_BUCKET).createSignedUploadUrl(`${stem}-cover.jpg`),
  ]);
  if (video.error || cover.error) return { error: video.error?.message ?? cover.error?.message };
  return {
    video: { path: video.data.path, signed_url: video.data.signedUrl, token: video.data.token, content_type: "video/mp4" },
    cover: { path: cover.data.path, signed_url: cover.data.signedUrl, token: cover.data.token, content_type: "image/jpeg" },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const producer = whoIs(req);
  if (!producer) return json({ error: "unauthorized" }, 401);

  const action = new URL(req.url).searchParams.get("action") || "";
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const grokOnly = ["heartbeat", "claim", "daily_upload_urls", "daily_attach"];
  if (grokOnly.includes(action) && producer !== "grok_reel") return json({ error: "forbidden" }, 403);

  switch (action) {
    // ---- הדופק ------------------------------------------------------------
    case "heartbeat": {
      const { error } = await supabase.rpc("producer_heartbeat_touch", {
        p_producer: producer,
        p_version: typeof body.version === "string" ? body.version.slice(0, 80) : null,
        p_status: typeof body.status === "string" ? body.status.slice(0, 80) : null,
      });
      if (error) return json({ error: "db_error", detail: error.message }, 500);
      return json({ ok: true });
    }

    // ---- לקיחת בקשה --------------------------------------------------------
    case "claim": {
      const { data: claimed, error } = await supabase.rpc("claim_reel_job", { p_producer: producer });
      if (error) return json({ error: "db_error", detail: error.message }, 500);
      if (!claimed) return json({ ok: true, job: null });
      const data = await renderData(supabase, claimed.property_id);
      if (!data) {
        await failVideoJob(supabase, claimed.job_id, "reel_property_missing");
        return json({ ok: true, job: null });
      }
      return json({ ok: true, job: claimed, ...data });
    }

    case "job_data": {
      const owned = await loadOwnedJob(supabase, body.job_id, producer);
      if ("error" in owned) return json({ error: owned.error }, owned.error === "not_owner" ? 409 : 404);
      const data = await renderData(supabase, owned.job.property_id);
      if (!data) return json({ error: "property_not_found" }, 404);
      // המוזיקה ברישיון Pixabay יושבת בדלי פרטי. כתובת לחצי שעה - מספיק
      // לרינדור אחד, וקצר מכדי להפוך להפצה של הקובץ.
      const { data: music } = await supabase.storage.from(MUSIC_BUCKET).createSignedUrl(MUSIC_PATH, 1800);
      return json({
        ok: true,
        job: {
          job_id: owned.job.id,
          property_id: owned.job.property_id,
          agent_id: owned.job.agent_id,
          listing_number: data.property.listing_number,
          aspect_ratio: owned.job.aspect_ratio,
          previous_video_url: owned.job.previous_video_url,
        },
        ...data,
        music_url: music?.signedUrl ?? null,
      });
    }

    case "job_heartbeat": {
      if (typeof body.job_id !== "string" || !UUID.test(body.job_id)) return json({ error: "bad_job_id" }, 400);
      const { data, error } = await supabase.rpc("reel_job_heartbeat", { p_job_id: body.job_id, p_producer: producer });
      if (error) return json({ error: "db_error", detail: error.message }, 500);
      return json(data, data?.error ? 409 : 200);
    }

    // ---- העלאה והשלמה -------------------------------------------------------
    case "upload_urls": {
      const owned = await loadOwnedJob(supabase, body.job_id, producer);
      if ("error" in owned) return json({ error: owned.error }, owned.error === "not_owner" ? 409 : 404);
      const urls = await signedUploads(supabase, `${owned.job.agent_id}/${owned.job.property_id}`, "marketing-reel-");
      if ("error" in urls) return json({ error: "storage_error", detail: urls.error }, 500);
      return json({ ok: true, ...urls });
    }

    case "complete": {
      const owned = await loadOwnedJob(supabase, body.job_id, producer);
      if ("error" in owned) return json({ error: owned.error }, owned.error === "not_owner" ? 409 : 404);
      const job = owned.job;
      const dir = `${job.agent_id}/${job.property_id}`;
      const videoPath = body.video_path;
      const coverPath = body.cover_path;
      if (!pathOk(videoPath, dir, "marketing-reel-", ".mp4")) return json({ error: "bad_video_path" }, 400);
      if (coverPath != null && !pathOk(coverPath, dir, "marketing-reel-", "-cover.jpg")) {
        return json({ error: "bad_cover_path" }, 400);
      }
      if (!(await fileExists(supabase, videoPath))) return json({ error: "video_not_uploaded" }, 400);
      const coverOk = typeof coverPath === "string" && await fileExists(supabase, coverPath);

      const { data: done, error } = await supabase.rpc("complete_property_video_job", {
        p_job_id: job.id,
        p_result_url: publicUrl(supabase, videoPath),
        p_cover_url: coverOk ? publicUrl(supabase, coverPath) : null,
        p_producer: producer,
      });
      if (error) return json({ error: "db_error", detail: error.message }, 500);
      if (done?.error) {
        // איבד את הבקשה בין הבדיקה להשלמה. הקבצים שלו אינם על אף נכס.
        await removePaths(supabase, [videoPath, coverOk ? coverPath : ""]);
        return json(done, 409);
      }
      // הסרטון הקודם - רק אם המערכת יצרה אותו. סרטון שהסוכן/ת העלה נשאר
      // בדלי גם אחרי שהוחלף באישור, כמו שההנחיה קובעת.
      if (!done.already_done) {
        if (done.previous_is_system) await removeStoredVideo(supabase, done.previous_video_url ?? null);
        await removeSystemPoster(supabase, done.previous_poster_url ?? null);
      }
      return json({ ok: true, result_url: done.result_url });
    }

    // ---- כישלון: לא זיכוי, אלא המפיק הבא ------------------------------------
    case "fail": {
      const owned = await loadOwnedJob(supabase, body.job_id, producer);
      if ("error" in owned) return json({ error: owned.error }, owned.error === "not_owner" ? 409 : 404);
      const reason = `producer_failed: ${String(body.reason ?? "").slice(0, 200)}`;
      if (producer === "grok_reel") {
        const r = await handoffToSite(supabase, owned.job.id, reason, "grok_reel");
        return json({ ok: true, next: r === "dispatched" ? "site_reel" : r });
      }
      const r = await fallbackToFal(supabase, owned.job.id, reason);
      return json({ ok: true, next: r.ok ? "fal_legacy" : (r.error === "lost_race" ? "lost_race" : "failed") });
    }

    // ---- הרילס היומי --------------------------------------------------------
    case "daily_upload_urls": {
      if (typeof body.property_id !== "string" || !UUID.test(body.property_id)) return json({ error: "bad_property_id" }, 400);
      const { data: p } = await supabase.from("properties").select("id, agent_id").eq("id", body.property_id).maybeSingle();
      if (!p?.agent_id) return json({ error: "property_not_found" }, 404);
      const urls = await signedUploads(supabase, `${p.agent_id}/${p.id}`, "marketing-reel-daily-");
      if ("error" in urls) return json({ error: "storage_error", detail: urls.error }, 500);
      return json({ ok: true, ...urls });
    }

    case "daily_attach": {
      if (typeof body.property_id !== "string" || !UUID.test(body.property_id)) return json({ error: "bad_property_id" }, 400);
      const { data: p } = await supabase.from("properties").select("id, agent_id").eq("id", body.property_id).maybeSingle();
      if (!p?.agent_id) return json({ error: "property_not_found" }, 404);
      const dir = `${p.agent_id}/${p.id}`;
      const videoPath = body.video_path;
      const coverPath = body.cover_path;
      if (!pathOk(videoPath, dir, "marketing-reel-daily-", ".mp4")) return json({ error: "bad_video_path" }, 400);
      if (coverPath != null && !pathOk(coverPath, dir, "marketing-reel-daily-", "-cover.jpg")) {
        return json({ error: "bad_cover_path" }, 400);
      }
      if (!(await fileExists(supabase, videoPath))) return json({ error: "video_not_uploaded" }, 400);
      const coverOk = typeof coverPath === "string" && await fileExists(supabase, coverPath);

      const published = body.published_urls && typeof body.published_urls === "object" ? body.published_urls : null;
      const { data: res, error } = await supabase.rpc("attach_daily_reel", {
        p_property_id: p.id,
        p_result_url: publicUrl(supabase, videoPath),
        p_cover_url: coverOk ? publicUrl(supabase, coverPath) : null,
        p_published: published,
      });
      if (error) return json({ error: "db_error", detail: error.message }, 500);
      if (res?.error) return json(res, 404);
      if (!res?.attached) {
        // לא נשמר - הקבצים שהועלו לא יישארו יתומים בדלי.
        await removePaths(supabase, [videoPath, coverOk ? coverPath : ""]);
        return json({ ok: true, attached: false, reason: res?.reason ?? "not_attached" });
      }
      // ‏attach_daily_reel החליפה רק סרטון של המערכת, ולכן מותר למחוק אותו.
      await removeStoredVideo(supabase, res.previous_video_url ?? null);
      await removeSystemPoster(supabase, res.previous_poster_url ?? null);
      return json({ ok: true, attached: true, job_id: res.job_id });
    }
  }

  return json({ error: "unknown_action" }, 400);
});
