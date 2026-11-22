import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/projects.ts";
import { mfaGate } from "../_shared/mfa-gate.ts";
import { geminiRow, logAiUsage } from "../_shared/ai-usage.ts";
import { base64ToBytes } from "../_shared/visualization.ts";
import {
  buildModel, imageSize, isPlanModel, mirrorModel, mirrorSettings, parsePlanReading, PLAN_READ_PROMPT,
  PlanReadError, validImageSize,
} from "../_shared/plan-model.ts";

// ============================================================================
// דגם דירה תלת-ממדי: רכישה, קריאת התוכנית והיפוך מראה (docs/plan-3d-tour.md)
//
// ‏POST עם JWT של סוכן/ת או של יזם. שלוש פעולות:
//   create   { owner_kind, name, project_id?, image_base64 }
//   mirror   { owner_kind, source_model_id, name? }
//   plan_url { model_id }   - כתובת חתומה לתוכנית המקור, לבעלים בלבד
//
// הסדר ב-create וב-mirror הוא "מחייבים ואז קונים" (הסקיל wallet-charges):
//   1. start_plan_model מנכה ₪49 מהארנק ויוצרת את הדגם, בטרנזקציה אחת. המחיר
//      והזכאות (סוכן/ת: Elite; יזם: חשבון פעיל) נקבעים במסד, לא כאן ולא בדפדפן.
//   2. קריאת התוכנית במודל ראייה ובניית המודל.
//   3. כל כישלון אחרי החיוב מחזיר את הכסף ב-fail_plan_model, והתשובה אומרת מה קרה
//      לכסף. אם ההחזר לא אושר, plan_models_refund_stuck (cron) מחזיר בתוך חצי שעה,
//      והתשובה אומרת את זה ולא "לא בוצע חיוב".
//
// מה שנבדק **לפני** החיוב: שהמפתח של Gemini מוגדר, שהתמונה תקינה ושהבעלים מזוהה.
// כישלון שאפשר לדעת עליו מראש אינו סיבה לחייב ולהחזיר.
//
// מידות התמונה נקראות מהבייטים (imageSize), לא מהדפדפן: מודל הראייה מחזיר קואורדינטות
// ביחס לקובץ שראה.
//
// המודל שנוצר הוא טיוטה: הוא נשמר לא מפורסם, והבעלים מתקן/ת ומפרסם/ת בעורך.
// ‏settings.checks (קודים) נשמרים עם הדגם, כדי שהעורך יציג מה דורש בדיקה גם אחרי רענון.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PLAN_MODEL = Deno.env.get("GEMINI_PLAN_MODEL") ?? Deno.env.get("GEMINI_VISION_MODEL") ?? "gemini-3.5-flash-lite";

const BUCKET = "plan-sources";
const MIME_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
// ‏base64 של כ-6MB. תוכנית דירה סרוקה היא מאות KB; מעבר לזה זו לא תוכנית אחת
const MAX_B64 = 8_000_000;
const READ_TIMEOUT_MS = 100_000;
// תשובת start_plan_model שאינה הצלחה -> סטטוס HTTP. הגוף עובר כמו שהוא (כולל required_tier ו-detail)
const START_STATUS: Record<string, number> = {
  tier_required: 403, not_your_project: 403, mirror_source_invalid: 403, insufficient_balance: 402,
};

type OwnerKind = "agent" | "developer";

// deno-lint-ignore no-explicit-any
type Sb = any;

/** מי הקורא/ת: המזהה נקבע במסד (current_agent_id / current_developer_id), באותה הגדרה שה-RLS משתמש בה. */
async function resolveOwner(authed: Sb, kind: OwnerKind): Promise<string | null> {
  const { data, error } = await authed.rpc(kind === "agent" ? "current_agent_id" : "current_developer_id");
  if (error) {
    console.error("plan-model: resolveOwner", kind, error.message);
    return null;
  }
  return typeof data === "string" && data ? data : null;
}

/** קריאת התוכנית במודל הראייה. זורק PlanReadError עם קוד שהמסך יודע לתרגם. */
async function readPlan(apiKey: string, mime: string, b64: string, agentId: string | null): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(
      // המפתח בכותרת ולא בכתובת: הודעת שגיאה של fetch כוללת את הכתובת המלאה, והיא נכתבת ללוג
      `https://generativelanguage.googleapis.com/v1beta/models/${PLAN_MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
        body: JSON.stringify({
          contents: [{ parts: [{ inline_data: { mime_type: mime, data: b64 } }, { text: PLAN_READ_PROMPT }] }],
          // התקרה רחבה בכוונה: המודל חושב, והתקציב כולל את החשיבה (ראו classifyImage)
          generationConfig: { temperature: 0, maxOutputTokens: 32768, responseMimeType: "application/json" },
        }),
      },
    );
  } catch (e) {
    throw new PlanReadError("plan_read_failed", `Gemini: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) {
    let bodyText = "";
    try { bodyText = (await res.text()).slice(0, 300); } catch { /* noop */ }
    throw new PlanReadError("plan_read_failed", `Gemini HTTP ${res.status}${bodyText ? `: ${bodyText}` : ""}`);
  }
  const out = await res.json();
  const row = geminiRow("plan_read", PLAN_MODEL, out?.usageMetadata);
  row.agent_id = agentId;
  logAiUsage(row);
  // כל החלקים ולא parts[0]: מודל חושב מחזיר לפעמים חלק של מחשבה לפני התשובה
  const text = (out?.candidates?.[0]?.content?.parts ?? [])
    .map((p: { text?: string; thought?: boolean }) => (p?.thought ? "" : p?.text ?? ""))
    .join("");
  if (!text.trim()) {
    const why = out?.candidates?.[0]?.finishReason ?? "empty";
    throw new PlanReadError("plan_read_failed", `Gemini returned no text (${why})`);
  }
  return parsePlanReading(text);
}

type Charged = { modelId: string; receipt: Record<string, unknown> };

/** החיוב ויצירת הדגם. מחזיר Response כשהמסד סירב (מסלול, יתרה, בעלות), ואז לא ירד כסף. */
async function startModel(sb: Sb, args: Record<string, unknown>): Promise<Charged | Response> {
  const { data: start, error } = await sb.rpc("start_plan_model", args);
  if (error) return json({ error: "db_error" }, 500);
  if (!start?.success) return json(start ?? { error: "db_error" }, START_STATUS[String(start?.error ?? "")] ?? 400);
  return {
    modelId: String(start.model_id),
    receipt: { amount_charged: start.amount_charged, renders_included: start.renders_included, balance: start.balance },
  };
}

/** שמירת המודל ופתיחת הדגם. זורק כשהמסד לא אישר. */
async function completeModel(sb: Sb, modelId: string, model: unknown, settings: unknown, lights: unknown = null) {
  const { data, error } = await sb.rpc("complete_plan_model", {
    p_model_id: modelId, p_model: model, p_settings: settings, p_lights: lights,
  });
  if (error || !data?.success) throw new Error(error?.message ?? String(data?.error ?? "complete failed"));
}

/**
 * אחרי כישלון: מחזירים את הכסף, ואומרים מה קרה לו. שלושה מצבים, ולא שניים:
 *   refunded - fail_plan_model אישרה, והסכום בתשובה.
 *   ready    - הדגם דווקא הושלם (complete_plan_model נכנסה והתשובה שלה אבדה). אין החזר
 *              ואין מה להחזיר: זו הצלחה. בלי המצב הזה היינו מבטיחים החזר שה-cron לא ייתן.
 *   unknown  - ההחזר לא אושר אחרי שני ניסיונות (הפונקציה אידמפוטנטית). ה-cron יחזיר.
 */
async function failAndRespond(sb: Sb, charged: Charged, code: string, status: number, sourcePath?: string): Promise<Response> {
  let refunded: number | null = null;
  for (let attempt = 0; attempt < 2 && refunded === null; attempt++) {
    // ‏refund_reason נקרא על ידי הבעלים (RLS): נכתב בו קוד בלבד, לא טקסט שגיאה גולמי
    const { data, error } = await sb.rpc("fail_plan_model", { p_model_id: charged.modelId, p_reason: code });
    if (!error && data?.success) refunded = Number(data.refunded ?? 0);
    else if (!error && data?.error === "already_ready") return json({ ok: true, model_id: charged.modelId, ...charged.receipt });
    else console.error("plan-model: fail_plan_model", charged.modelId, attempt, error?.message ?? data?.error);
  }
  // התוכנית של דגם שלא נוצר אינה נשמרת אצלנו. נמחקת **רק אחרי שההחזר אושר**: עד אז ייתכן שהדגם
  // דווקא מוכן (already_ready, למעלה) וצריך את התוכנית שלו, וכשההחזר לא אושר לא נוגעים בדבר.
  // מאמץ בלבד: כישלון במחיקה אינו משנה את התשובה
  if (refunded !== null && sourcePath) {
    const { error } = await sb.storage.from(BUCKET).remove([sourcePath]);
    if (error) console.error("plan-model: remove source", charged.modelId, error.message);
  }
  const what = code === "plan_unreadable"
    ? "לא הצלחנו לקרוא את התוכנית. כדאי להעלות תמונה חדה וישרה של תוכנית דירה אחת."
    : "יצירת הדגם נכשלה.";
  // ‏0 = fail_plan_model כבר החזירה קודם (ניסיון ראשון שתשובתו אבדה, או ה-cron): הכסף חזר, וצריך לומר את זה
  const money = refunded === null
    ? " החיוב יוחזר לארנק אוטומטית בתוך חצי שעה."
    : refunded > 0 ? ` ₪${refunded} הוחזרו לארנק.` : " החיוב כבר הוחזר לארנק.";
  return json({ error: code, detail: what + money, refunded, refund_pending: refunded === null }, status);
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);

  // הזיהוי לפני קריאת הגוף: בקשה בלי הרשאה אינה סיבה לפענח 8MB
  const authed = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await authed.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
  const mfa = await mfaGate(authHeader);
  if (mfa) return json({ error: mfa.error }, mfa.status);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const action = typeof body.action === "string" ? body.action : "";

  // ---------------------------------------------------------------------
  // כתובת חתומה לתוכנית המקור, לשעה, לבעלים בלבד. השורה נקראת ב-service_role: עמודות
  // הבעלות והנתיב אינן פתוחות ל-authenticated (דגם שפורסם נקרא לכל מחובר/ת), ולכן
  // הבעלות נבדקת כאן מול current_agent_id / current_developer_id. הדלי פרטי.
  // ---------------------------------------------------------------------
  if (action === "plan_url") {
    const modelId = typeof body.model_id === "string" ? body.model_id : "";
    if (!modelId) return json({ error: "missing_fields" }, 400);
    const { data: m, error } = await supabase.from("plan_models")
      .select("id, owner_kind, agent_id, developer_id, source_plan_path").eq("id", modelId).maybeSingle();
    if (error) return json({ error: "db_error" }, 500);
    if (!m) return json({ error: "not_found" }, 404);
    const me = await resolveOwner(authed, m.owner_kind as OwnerKind);
    if (!me || me !== (m.agent_id ?? m.developer_id)) return json({ error: "forbidden" }, 403);
    if (!m.source_plan_path) return json({ error: "not_found" }, 404);
    const { data: signed, error: signErr } = await supabase.storage.from(BUCKET).createSignedUrl(m.source_plan_path, 3600);
    if (signErr || !signed?.signedUrl) return json({ error: "db_error" }, 500);
    return json({ ok: true, url: signed.signedUrl });
  }

  if (action !== "create" && action !== "mirror") return json({ error: "unknown_action" }, 400);

  const kind = body.owner_kind === "agent" || body.owner_kind === "developer" ? body.owner_kind as OwnerKind : null;
  if (!kind) return json({ error: "missing_fields" }, 400);
  const ownerId = await resolveOwner(authed, kind);
  if (!ownerId) return json({ error: "forbidden" }, 403);
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";

  // ---------------------------------------------------------------------
  // דגם מהופך מראה: דגם נוסף, נרכש בנפרד. אין קריאה למודל ראייה, רק היפוך של
  // דגם מוכן של אותו בעלים (הבדיקה במסד, ב-start_plan_model). העמודות הכבדות
  // נשלפות רק אחרי שהחיוב אושר, כדי שסירוב (מסלול, יתרה) לא ישלם על מגה-בייט.
  // ---------------------------------------------------------------------
  if (action === "mirror") {
    const sourceId = typeof body.source_model_id === "string" ? body.source_model_id : "";
    if (!sourceId) return json({ error: "missing_fields" }, 400);
    const { data: head, error: headErr } = await supabase.from("plan_models")
      .select("id, name, project_id").eq("id", sourceId).maybeSingle();
    if (headErr) return json({ error: "db_error" }, 500);
    if (!head) return json({ error: "not_found" }, 404);

    const charged = await startModel(supabase, {
      // השם במסד עד 120 תווים: מקצרים את המקור לפני הסיומת
      p_owner_kind: kind, p_owner_id: ownerId, p_name: name || `${String(head.name).slice(0, 110)} (מראה)`,
      p_project_id: kind === "developer" ? head.project_id : null, p_mirror_of: sourceId,
    });
    if (charged instanceof Response) return charged;

    try {
      const { data: src, error: srcErr } = await supabase.from("plan_models")
        .select("model, settings, lights").eq("id", sourceId).single();
      if (srcErr) throw new Error(`source: ${srcErr.message}`);
      // הבעלים עורך/ת את model מהדפדפן, ולכן לא סומכים על המבנה לפני שהופכים אותו
      if (!isPlanModel(src.model)) throw new Error("source model is malformed");
      const settings = mirrorSettings((src.settings ?? {}) as { north?: number; mirrored?: boolean });
      // תבניות התאורה אינן תלויות בכיוון ועוברות כמו שהן. זוויות הצפייה כן, ולכן נשמרות מחדש בעורך
      await completeModel(supabase, charged.modelId, mirrorModel(src.model), settings, src.lights ?? []);
      return json({ ok: true, model_id: charged.modelId, ...charged.receipt });
    } catch (e) {
      console.error("plan-model: mirror", charged.modelId, errText(e));
      return failAndRespond(supabase, charged, "plan_mirror_failed", 500);
    }
  }

  // ---------------------------------------------------------------------
  // create: כל מה שאפשר לבדוק נבדק לפני החיוב
  // ---------------------------------------------------------------------
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return json({ error: "gemini_not_configured" }, 500);

  const b64 = typeof body.image_base64 === "string" ? body.image_base64.replace(/^data:[^,]*,/, "") : "";
  if (!name || !b64) return json({ error: "missing_fields" }, 400);
  if (b64.length > MAX_B64) return json({ error: "image_too_large", detail: "התמונה גדולה מדי. עד 6MB." }, 400);
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(b64);
  } catch {
    return json({ error: "bad_image_type", detail: "קובץ התמונה אינו תקין." }, 400);
  }
  // הסוג והמידות מהבייטים, לא ממה שהדפדפן הצהיר: קובץ ששמו שונה היה מחויב ואז נדחה אצל Gemini
  const size = imageSize(bytes);
  if (!size) return json({ error: "bad_image_type", detail: "אפשר להעלות תמונת JPG, PNG או WebP." }, 400);
  const mime = size.mime;
  if (!validImageSize(size.w, size.h)) {
    return json({ error: "bad_image_size", detail: "התמונה קטנה או גדולה מדי. הרוחב והגובה בין 200 ל-8,000 פיקסלים." }, 400);
  }
  const projectId = typeof body.project_id === "string" && body.project_id ? body.project_id : null;

  const charged = await startModel(supabase, {
    p_owner_kind: kind, p_owner_id: ownerId, p_name: name, p_project_id: projectId, p_mirror_of: null,
  });
  if (charged instanceof Response) return charged;

  // מכאן הכסף כבר ירד: כל יציאה בלי דגם מוכן עוברת בהחזר
  const path = `${kind}/${ownerId}/${charged.modelId}.${MIME_EXT[mime]}`;
  try {
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: true });
    if (upErr) throw new Error(`upload: ${upErr.message}`);
    const { data: marked, error: markErr } = await supabase.rpc("mark_plan_model_reading", {
      p_model_id: charged.modelId, p_source_plan_path: path,
    });
    if (markErr || !marked?.success) throw new Error(`mark reading: ${markErr?.message ?? marked?.error}`);

    const reading = await readPlan(apiKey, mime, b64, kind === "agent" ? ownerId : null);
    const built = buildModel(reading, size.w, size.h);
    await completeModel(supabase, charged.modelId, built.model, built.settings);
    return json({ ok: true, model_id: charged.modelId, settings: built.settings, ...charged.receipt });
  } catch (e) {
    const code = e instanceof PlanReadError ? e.code : "plan_read_failed";
    console.error("plan-model: create", charged.modelId, code, errText(e));
    return failAndRespond(supabase, charged, code, code === "plan_unreadable" ? 422 : 502, path);
  }
});
