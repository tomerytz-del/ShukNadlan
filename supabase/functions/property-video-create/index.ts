import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { ensureTagged } from "../_shared/visualization.ts";
import { authorizeInternalCaller } from "../_shared/cron-auth.ts";
import { corsHeaders, json, pickScenes } from "../_shared/property-video.ts";
import { grokIsOnline, startFalLegacy, startSiteRender } from "../_shared/reel-fallback.ts";
import { mfaGate } from "../_shared/mfa-gate.ts";

// ============================================================================
// הפקת סרטון שיווקי לנכס — הכניסה מה-CRM ומהעוזר בוואטסאפ.
//
// ‏POST { property_id, replace_existing? }
// מחזיר מיד ‎{ ok, job_id, status, estimated_seconds }‎. ה-CRM עושה polling
// דרך ‎rpc('property_video_job_status', { p_job_id })‎.
//
// ‏**מאז 24.10.2026 הסרטון הוא רילס בתבנית D**, ומי שמפיק אותו נקבע כאן:
// ‏Grok Bot כשהוא חי (‏pending_reel, והוא לוקח דרך ‎reel-producer‎), אחרת
// הגיבוי של האתר ב-GitHub Actions (‏rendering), ורק אם גם הוא לא זמין -
// המסלול הישן של fal (‏_shared/reel-fallback.ts). הפונקציה לא מחכה לסרטון
// באף אחד מהם: ההפקה לוקחת דקות, והמשך הטיפול הוא מכונת מצבים ב-DB.
//
// שלוש נקודות שכדאי להכיר:
//
//   1. **הזכאות והחיוב קורים ב-DB ולא כאן.** ‎start_property_video_job‎ בודקת
//      דרגה, תקרה חודשית וסרטון קיים, ומחייבת את הארנק — הכל בטרנזקציה אחת.
//      פיצול לשתי קריאות היה מאפשר לחייב ארנק בלי שנפתחה בקשה.
//   2. **הסרטון הישן נמחק רק בסוף.** ‎previous_video_url‎ נשמר על הבקשה,
//      וה-callback מוחק אותו אחרי שהחדש כבר על הנכס. הפקה שנכשלת באמצע
//      משאירה את הסוכן/ת עם הסרטון שהיה לו/ה.
//   3. **כישלון בשליחה מחזיר את הכסף מיד.** אם הבקשה הגיעה ל-fal ואף קליף
//      לא נשלח, אין מה לחכות לו — הבקשה נסגרת ככושלת וה-RPC מזכה את הארנק.
//
// ## שני קוראים, נקודת כניסה אחת
//
// ‏**הדפדפן** שולח את ה-JWT של הסוכן/ת, ומכאן נגזרת הזהות.
//
// ‏**העוזר בוואטסאפ** מזהה לפי מספר טלפון ורץ עם `service_role` — אין לו JWT
// של משתמש/ת ולכן `auth.getUser()` שם מחזיר null. במקום זה הוא שולח
// ‏`Authorization: Bearer <service_role>` ו-`agent_id` מפורש בגוף, ו-
// ‏`authorizeInternalCaller` מאשר את הקורא.
//
// **שכפול הפונקציה לבוט לא בא בחשבון**, וזו אותה סיבה שבגללה ארבעת כלי
// הלידים של הבוט הציבורי קוראים לנקודות הקליטה של האתר: הזכאות, התקרה
// החודשית, החיוב, בחירת הסצנות, ההגנה על סרטון קיים וההחזר בכישלון —
// כולם חיים כאן. עותק שני היה מתפצל מהם, והסרטון מוואטסאפ היה מתומחר אחרת
// מזה שמהדשבורד בלי שאיש ישים לב.
//
// ‏`agent_id` מתקבל **רק** במסלול הפנימי. בבקשה עם JWT הוא נבלע — אחרת כל
// סוכן/ת מחובר/ת היה/הייתה יכול/ה להפיק סרטון על חשבון ארנק של אחר/ת.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function pricing(supabase: any, key: string, fallback: number): Promise<number> {
  const { data } = await supabase.from("pricing_config").select("value").eq("key", key).maybeSingle();
  const n = Number(data?.value);
  return Number.isFinite(n) ? n : fallback;
}

// הרילס בתבנית D: חמש שקופיות של כ-3 שניות, וכרטיס סיום.
const REEL_SECONDS = 18;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

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
  // תבנית D היא 1080x1920, ולכן הבקשה אנכית תמיד - גם אם בסוף היא מגיעה
  // למסלול fal. ‏aspect_ratio בגוף הבקשה נשאר מתקבל ואינו משנה דבר.
  const aspectRatio = "9:16";

  // ---- מי הסוכן/ת --------------------------------------------------------
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const internal = authorizeInternalCaller(req);

  let agentRow: { id: string; active: boolean } | null = null;

  if (internal.ok) {
    // המסלול הפנימי: העוזר בוואטסאפ. ‏`agent_id` הוא הזהות, והוא נאמן רק
    // משום ש-`authorizeInternalCaller` כבר אישר שהקורא מחזיק ב-service_role.
    const agentId = String(body?.agent_id || "");
    if (!agentId) return json({ error: "missing_agent_id" }, 400);

    const { data } = await supabase
      .from("agency_members")
      .select("id, active")
      .eq("id", agentId)
      .maybeSingle();
    agentRow = data;
  } else {
    const authedClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await authedClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
    const mfa = await mfaGate(authHeader);
    if (mfa) return json({ error: mfa.error }, mfa.status);

    const { data } = await supabase
      .from("agency_members")
      .select("id, active")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    agentRow = data;
  }

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
    return json({ error: "no_images", message: "אין תמונות לנכס הזה - אי אפשר להפיק ממנו סרטון" }, 400);
  }

  // ---- כמה קליפים ובאיזה אורך -------------------------------------------
  // ‏clipCount הוא **תקרה** ולא יעד: pickScenes לוקחת min(תמונות, התקרה), ולכן
  // נכס עם חמש תמונות מקבל חמש סצנות ולא נשאר עם תמונה שלא נכנסה לסרטון.
  //
  // ‏clipSeconds ו-sourceSeconds אמורים להיות שווים — ראו askSeconds מיד אחריהם
  // ואת המיגרציה 20261006090000. ‏Math.round הוסר מ-clipSeconds בכוונה:
  // הוא היה מעגל ערך שברירי בשקט.
  const clipCount = Math.max(1, Math.round(await pricing(supabase, "property_video_clip_count", 5)));
  const clipSeconds = Math.max(0.5, await pricing(supabase, "property_video_clip_seconds", 5));
  const sourceSeconds = Math.max(clipSeconds, await pricing(supabase, "property_video_source_seconds", 5));
  const minClips = Math.max(1, Math.round(await pricing(supabase, "property_video_min_clips", 2)));

  // ---- באיזה אורך מבקשים -------------------------------------------------
  // **אורך אחד בלבד, כי אין דרך לקצר קליף אחרי שנוצר.**
  //
  // שתי הנחות נוסו כאן ושתיהן הופרכו מול ה-API החי:
  //
  //   1. "אפשר לבקש מ-Kling 2.5 שניות" — הבקשה מתקבלת עם ‎200‎ ונכשלת מאוחר
  //      יותר ב-‎422‎ דרך ה-webhook. עשרה קליפים, שתי בקשות, אפס תוצרים.
  //   2. "אפשר לייצר 5 שניות ולחתוך במיזוג" — ‏compose מתעלם מ-‎duration‎,
  //      מ-‎timestamp‎ ומ-‎start_from‎, ומשרשר קליפים שלמים. ‏‎/trim‎, ‎/cut‎,
  //      ‎/split‎ ו-‎/speed‎ אינם קיימים (404).
  //
  // לכן ‎clip_seconds‎ חייב להיות שווה ל-‎source_seconds‎. ערך קטן יותר לא
  // היה מתממש — הוא רק היה גורם למערכת להבטיח סרטון קצר ולספק ארוך, בלי
  // שום שגיאה שתסגיר את זה. ‏Math.max שומר על השוויון גם אם מישהו יוריד את
  // הערך ב-pricing_config בלי לקרוא את התיעוד.
  //
  // ‏**ההצהרה יושבת כאן ולא ליד לולאת השליחה** — ‎start_property_video_job‎
  // מקבלת אותה כ-‎p_clip_seconds‎ הרבה לפני שהקליפים נשלחים. הצהרה מאוחרת
  // יותר הפילה כל בקשה ב-‎ReferenceError‎ עוד לפני שנפתחה שורת בקשה.
  const askSeconds = Math.max(clipSeconds, sourceSeconds);

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

  // ---- הזכאות, התקרה והחיוב, והמפיק --------------------------------------
  // תבנית D (24.10.2026): הבקשה נולדת אצל המפיק שיפיק אותה. ‏Grok חי
  // (דופק בעשר הדקות האחרונות) - ממתינה לו ב-pending_reel. אחרת - ישר
  // לגיבוי של האתר ב-rendering. השורה נוצרת בסטטוס הזה בתוך הטרנזקציה של
  // החיוב, ולכן אין רגע שבו בקשה פתוחה אינה מוכרת לאינדקס הייחודי.
  const webhookToken = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const grokOnline = await grokIsOnline(supabase);

  const base = {
    p_property_id: propertyId,
    p_agent_id: agentRow.id,
    p_webhook_token: webhookToken,
    p_clip_seconds: askSeconds,
    p_aspect_ratio: aspectRatio,
    p_replace_existing: replaceExisting,
  };
  let { data: started, error: startErr } = await supabase.rpc("start_property_video_job", {
    ...base,
    p_initial_status: grokOnline ? "pending_reel" : "rendering",
    p_producer: grokOnline ? "grok_reel" : "site_reel",
    p_fallback_reason: grokOnline ? null : "producer_offline",
  });
  // ‏PGRST202: המיגרציה של תבנית D עוד לא הוחלה (הפונקציות והמיגרציות
  // נפרסות במקביל אחרי מיזוג). בדקות האלה - המסלול הקודם כמו שהיה: fal.
  let legacy = false;
  if (startErr?.code === "PGRST202") {
    legacy = true;
    ({ data: started, error: startErr } = await supabase.rpc("start_property_video_job", base));
  }
  if (startErr) return json({ error: "db_error", detail: startErr.message }, 500);
  if (started?.error) {
    const status = started.error === "insufficient_balance" ? 402
      : started.error === "not_eligible" ? 403
      : 409;
    return json(started, status);
  }

  const jobId = started.job_id as string;
  const accepted = {
    ok: true,
    job_id: jobId,
    tier: started.tier,
    amount_charged: started.amount_charged,
    estimated_seconds: REEL_SECONDS,
  };

  if (legacy) {
    const r = await startFalLegacy(supabase, jobId);
    if (!r.ok) return json({ error: r.error, detail: r.detail ?? null, refunded: r.refunded, refund_pending: r.refund_pending }, 502);
    return json({ ...accepted, status: "generating_clips", estimated_seconds: r.seconds });
  }

  if (grokOnline) return json({ ...accepted, status: "pending_reel" });

  // ---- הגיבוי של האתר, ואם גם הוא לא זמין - fal --------------------------
  const route = await startSiteRender(supabase, jobId);
  if (route === "dispatched") return json({ ...accepted, status: "rendering" });

  // ‏startSiteRender כבר העבירה ל-fal והריצה את השליחה. נשארה רק התשובה:
  // אם הבקשה נכשלה ונסגרה (וזוכתה), זה מה שהסוכן/ת צריך/ה לשמוע.
  const { data: row } = await supabase
    .from("property_video_jobs")
    .select("status, refunded, amount_charged, error_detail")
    .eq("id", jobId)
    .maybeSingle();
  if (row?.status === "failed") {
    return json({
      error: "fal_submit_failed",
      detail: row.error_detail ?? null,
      refunded: row.refunded ? Number(row.amount_charged) || 0 : 0,
      refund_pending: !row.refunded && Number(row.amount_charged) > 0,
    }, 502);
  }
  return json({ ...accepted, status: row?.status ?? "generating_clips", estimated_seconds: Math.round(5 * askSeconds) });
});
