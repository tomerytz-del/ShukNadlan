import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/projects.ts";
import { mfaGate } from "../_shared/mfa-gate.ts";
import { geminiRow, logAiUsage } from "../_shared/ai-usage.ts";
import {
  buildModel, mirrorModel, mirrorSettings, parsePlanReading, PLAN_READ_PROMPT, PlanReadError,
  type PlanModel,
} from "../_shared/plan-model.ts";

// ============================================================================
// דגם דירה תלת-ממדי: רכישה, קריאת התוכנית והיפוך מראה (docs/plan-3d-tour.md)
//
// ‏POST עם JWT של סוכן/ת או של יזם. שלוש פעולות:
//   create   { owner_kind, name, project_id?, image_base64, image_mime, img_w, img_h }
//   mirror   { owner_kind, source_model_id, name? }
//   plan_url { model_id }   - כתובת חתומה לתוכנית המקור, לבעלים בלבד
//
// הסדר ב-create וב-mirror הוא "מחייבים ואז קונים" (הסקיל wallet-charges):
//   1. start_plan_model מנכה ₪49 מהארנק ויוצרת את הדגם, בטרנזקציה אחת. המחיר
//      והזכאות (סוכן/ת: Elite; יזם: חשבון פעיל) נקבעים במסד, לא כאן ולא בדפדפן.
//   2. קריאת התוכנית במודל ראייה ובניית המודל.
//   3. כל כישלון אחרי החיוב מחזיר את הכסף ב-fail_plan_model, והתשובה אומרת מה קרה
//      לכסף. אם גם ההחזר נכשל, plan_models_refund_stuck (cron) מחזיר בתוך חצי שעה,
//      והתשובה אומרת את זה ולא "לא בוצע חיוב".
//
// מה שנבדק **לפני** החיוב: שהמפתח של Gemini מוגדר, שהתמונה תקינה ושהבעלים מזוהה.
// כישלון שאפשר לדעת עליו מראש אינו סיבה לחייב ולהחזיר.
//
// המודל שנוצר הוא טיוטה: הוא נשמר לא מפורסם (published = false), והבעלים מתקן/ת
// ומפרסם/ת בעורך. warnings חוזרות ללקוח כדי שהעורך יציג מה דורש בדיקה.
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
async function readPlan(
  apiKey: string, mime: string, b64: string, ids: { agent_id: string | null },
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${PLAN_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
  row.agent_id = ids.agent_id;
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

/**
 * החזר אחרי כישלון. מנסה פעמיים (הפונקציה במסד אידמפוטנטית). null = ההחזר לא אושר,
 * וה-cron יחזיר; הקורא חייב לומר את זה למשתמש/ת ולא להציג הצלחה.
 */
async function refund(sb: Sb, modelId: string, reason: string): Promise<number | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await sb.rpc("fail_plan_model", { p_model_id: modelId, p_reason: reason.slice(0, 300) });
    if (!error && data?.success) return Number(data.refunded ?? 0);
    console.error("plan-model: fail_plan_model", modelId, attempt, error?.message ?? data?.error);
  }
  return null;
}

function failedResponse(code: string, refunded: number | null, status: number) {
  const what = code === "plan_unreadable"
    ? "לא הצלחנו לקרוא את התוכנית. כדאי להעלות תמונה חדה וישרה של תוכנית דירה אחת."
    : "יצירת הדגם נכשלה.";
  const money = refunded === null
    ? " החיוב יוחזר לארנק אוטומטית בתוך חצי שעה."
    : refunded > 0 ? ` ₪${refunded} הוחזרו לארנק.` : "";
  return json({ error: code, detail: what + money, refunded, refund_pending: refunded === null }, status);
}

/** תשובת start_plan_model שאינה הצלחה -> סטטוס HTTP. הגוף עובר כמו שהוא (כולל required_tier ו-detail). */
function startErrorStatus(code: string): number {
  if (code === "tier_required") return 403;
  if (code === "insufficient_balance") return 402;
  if (code === "not_your_project" || code === "mirror_source_invalid") return 403;
  return 400;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const authed = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await authed.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
  const mfa = await mfaGate(authHeader);
  if (mfa) return json({ error: mfa.error }, mfa.status);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const action = typeof body.action === "string" ? body.action : "";

  // ---------------------------------------------------------------------
  // כתובת חתומה לתוכנית המקור: לבעלים בלבד, לשעה. הדלי פרטי, כי תוכנית שלא
  // פורסמה היא חומר של היזם ולא של הציבור.
  // ---------------------------------------------------------------------
  if (action === "plan_url") {
    const modelId = typeof body.model_id === "string" ? body.model_id : "";
    if (!modelId) return json({ error: "missing_fields" }, 400);
    const { data: m, error } = await supabase.from("plan_models")
      .select("id, owner_kind, agent_id, developer_id, source_plan_path").eq("id", modelId).maybeSingle();
    if (error) return json({ error: "db_error" }, 500);
    if (!m) return json({ error: "not_found" }, 404);
    const me = await resolveOwner(authed, m.owner_kind as OwnerKind);
    if (!me || me !== (m.owner_kind === "agent" ? m.agent_id : m.developer_id)) return json({ error: "forbidden" }, 403);
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
  // דגם מוכן של אותו בעלים (הבדיקה במסד, ב-start_plan_model).
  // ---------------------------------------------------------------------
  if (action === "mirror") {
    const sourceId = typeof body.source_model_id === "string" ? body.source_model_id : "";
    if (!sourceId) return json({ error: "missing_fields" }, 400);
    const { data: src, error: srcErr } = await supabase.from("plan_models")
      .select("id, name, status, model, settings, lights, project_id").eq("id", sourceId).maybeSingle();
    if (srcErr) return json({ error: "db_error" }, 500);
    if (!src) return json({ error: "not_found" }, 404);

    const { data: start, error: startErr } = await supabase.rpc("start_plan_model", {
      p_owner_kind: kind, p_owner_id: ownerId, p_name: name || `${src.name} (מראה)`,
      p_project_id: kind === "developer" ? src.project_id : null, p_mirror_of: sourceId,
    });
    if (startErr) return json({ error: "db_error" }, 500);
    if (!start?.success) return json(start ?? { error: "db_error" }, startErrorStatus(String(start?.error ?? "")));
    const modelId = String(start.model_id);

    try {
      const mirrored = mirrorModel(src.model as PlanModel);
      const settings = { ...mirrorSettings((src.settings ?? {}) as { north?: number }), mirrored: true };
      const { data: done, error: doneErr } = await supabase.rpc("complete_plan_model", {
        p_model_id: modelId, p_model: mirrored, p_settings: settings,
      });
      if (doneErr || !done?.success) throw new Error(doneErr?.message ?? String(done?.error ?? "complete failed"));
      // תבניות התאורה אינן תלויות בכיוון ועוברות כמו שהן. זוויות הצפייה כן, ולכן נשמרות מחדש בעורך
      await supabase.from("plan_models").update({ lights: src.lights ?? [] }).eq("id", modelId);
      return json({
        ok: true, model_id: modelId, amount_charged: start.amount_charged,
        renders_included: start.renders_included, balance: start.balance,
      });
    } catch (e) {
      console.error("plan-model: mirror", modelId, e instanceof Error ? e.message : e);
      return failedResponse("plan_mirror_failed", await refund(supabase, modelId, "mirror failed"), 500);
    }
  }

  // ---------------------------------------------------------------------
  // create: כל מה שאפשר לבדוק נבדק לפני החיוב
  // ---------------------------------------------------------------------
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return json({ error: "gemini_not_configured" }, 500);

  const mime = typeof body.image_mime === "string" ? body.image_mime : "";
  const b64 = typeof body.image_base64 === "string" ? body.image_base64.replace(/^data:[^,]*,/, "") : "";
  const imgW = Number(body.img_w), imgH = Number(body.img_h);
  if (!name || !b64) return json({ error: "missing_fields" }, 400);
  if (!MIME_EXT[mime]) return json({ error: "bad_image_type", detail: "אפשר להעלות תמונת JPG, PNG או WebP." }, 400);
  if (b64.length > MAX_B64) return json({ error: "image_too_large", detail: "התמונה גדולה מדי. עד 6MB." }, 400);
  if (!(imgW >= 200 && imgW <= 8000 && imgH >= 200 && imgH <= 8000)) {
    return json({ error: "bad_image_size", detail: "גודל התמונה אינו תקין." }, 400);
  }
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  } catch {
    return json({ error: "bad_image_type", detail: "קובץ התמונה אינו תקין." }, 400);
  }
  const projectId = typeof body.project_id === "string" && body.project_id ? body.project_id : null;

  const { data: start, error: startErr } = await supabase.rpc("start_plan_model", {
    p_owner_kind: kind, p_owner_id: ownerId, p_name: name, p_project_id: projectId, p_mirror_of: null,
  });
  if (startErr) return json({ error: "db_error" }, 500);
  if (!start?.success) return json(start ?? { error: "db_error" }, startErrorStatus(String(start?.error ?? "")));
  const modelId = String(start.model_id);

  // מכאן הכסף כבר ירד: כל יציאה בלי דגם מוכן עוברת בהחזר
  let code = "plan_read_failed";
  try {
    const path = `${kind}/${ownerId}/${modelId}.${MIME_EXT[mime]}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: true });
    if (upErr) throw new Error(`upload: ${upErr.message}`);
    const { error: markErr } = await supabase.from("plan_models")
      .update({ status: "reading", source_plan_path: path }).eq("id", modelId);
    if (markErr) throw new Error(`mark reading: ${markErr.message}`);

    const reading = await readPlan(apiKey, mime, b64, { agent_id: kind === "agent" ? ownerId : null });
    const built = buildModel(reading, imgW, imgH);

    const { data: done, error: doneErr } = await supabase.rpc("complete_plan_model", {
      p_model_id: modelId, p_model: built.model, p_settings: built.settings,
    });
    if (doneErr || !done?.success) throw new Error(doneErr?.message ?? String(done?.error ?? "complete failed"));

    return json({
      ok: true, model_id: modelId, warnings: built.warnings, settings: built.settings,
      amount_charged: start.amount_charged, renders_included: start.renders_included, balance: start.balance,
    });
  } catch (e) {
    if (e instanceof PlanReadError) code = e.code;
    console.error("plan-model: create", modelId, code, e instanceof Error ? e.message : e);
    return failedResponse(code, await refund(supabase, modelId, `${code}: ${e instanceof Error ? e.message : String(e)}`),
      code === "plan_unreadable" ? 422 : 502);
  }
});
