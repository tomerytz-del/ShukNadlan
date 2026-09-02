import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  buildPrivatePrompt,
  corsHeaders,
  DEFAULT_STYLE,
  ensureTagged,
  hasOwnExterior,
  isLandType,
  isStyleKey,
  json,
  pickPrivateSources,
  runVisualizationJob,
  STYLES,
  type PrivateTarget,
  type StyleKey,
  type WorkItem,
  readGeminiApiKey,
  isServiceRoleCall,
} from "../_shared/visualization.ts";

// ============================================================================
// סט הבסיס — הצד ה"קבוע" של המנגנון ההיברידי.
//
// ‏POST { property_id, style? } עם JWT של הסוכן/ת. מייצר סגנון אחד על עד שלוש
// המטרות (חוץ, סלון, מטבח) ומסמן is_base=true — אלה ההדמיות שמופיעות בדף
// הנכס לכל מבקר/ת, בלי להשאיר פרטים.
//
// למה זה נכס פרטי בלבד: להדמיה מסחרית צריך לדעת איזה עסק מדמים, ואין ברירת
// מחדל הגיונית ל"עסק" — משרד רואה חשבון וחנות בגדים באותו נכס נראים אחרת
// לגמרי. לכן המסחרי נשאר לפי דרישה בלבד, בדיוק כמו ב-nadlan-afula.
//
// אותה תבנית אבטחה כמו rss-lead-purchase: verify_jwt=true, והסוכן/ת נגזר/ת
// מה-JWT המאומת בלבד — לעולם לא מה-body. אחרת כל אחד יכול להעלות חשבון
// Gemini על נכס של מישהו אחר.
//
// יש מסלול כניסה שני: הטריגר ב-DB שרץ עם פרסום נכס (מיגרציה
// 20260827190000). לטריגר אין JWT של משתמש/ת, ולכן הוא מזדהה עם ה-service
// role key. במסלול הזה בדיקת הבעלות מדולגת — אין "בעלים" לקריאה שהמערכת
// יזמה — אבל בדיקת הזכאות (property_visualizations_enabled) נאכפת בדיוק
// כמו במסלול הרגיל, כי היא זו ששומרת שלא נוציא כסף על נכס לא זכאי.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const { key: apiKey, problem: keyProblem } = readGeminiApiKey();
  if (!apiKey) return json({ error: "gemini_not_configured", message: keyProblem }, 500);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing_authorization" }, 401);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const { property_id, style, force } = body ?? {};
  if (!property_id) return json({ error: "missing_property_id" }, 400);
  const styleKey: StyleKey = isStyleKey(style) ? style : DEFAULT_STYLE;

  // ---- מי מבקש/ת -------------------------------------------------------
  // הטריגר של פרסום הנכס שולח את ה-service role key. מי שמחזיק/ה בו ממילא
  // יכול/ה לכתוב ישירות לכל טבלה, ולכן אין כאן הרחבת הרשאות — רק ויתור על
  // שאלת הבעלות, שאין לה משמעות בקריאה שהמערכת יזמה.
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const isInternalCall = isServiceRoleCall(authHeader, serviceRoleKey);

  let agent: { id: string; active: boolean; is_platform_admin: boolean } | null = null;
  if (!isInternalCall) {
    const authed = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await authed.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

    const { data: agentRow } = await supabase
      .from("agency_members")
      .select("id, active, tier, is_platform_admin")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (!agentRow || !agentRow.active) return json({ error: "agent_not_found" }, 403);
    agent = agentRow;
  }

  const { data: property } = await supabase
    .from("properties")
    .select("id, category, property_type, rooms, size_sqm, area_sqm, agent_id, images")
    .eq("id", property_id)
    .maybeSingle();
  if (!property) return json({ error: "property_not_found" }, 404);

  if (agent && property.agent_id !== agent.id && !agent.is_platform_admin) {
    return json({ error: "forbidden", message: "אפשר ליצור הדמיות רק לנכסים שלך" }, 403);
  }

  const { data: enabled } = await supabase.rpc("property_visualizations_enabled", {
    p_property_id: property_id,
  });
  if (!enabled) {
    return json(
      { error: "not_available", message: "מנגנון ההדמיות כלול במסלול Premium ודורש נכס פעיל" },
      403
    );
  }

  // "מגרש" יושב ברשימת סוגי הנכס של המגורים, ולכן בדיקת הקטגוריה לבדה לא
  // עוצרת אותו — ראו isLandType.
  if (isLandType(property.property_type)) {
    return json(
      {
        error: "land_not_supported",
        message: "בנכסי קרקע מוצג מידע תכנוני בדף הנכס במקום הדמיה",
      },
      400
    );
  }

  if (property.category !== "residential") {
    return json(
      {
        error: "commercial_is_ondemand",
        message: "בנכס מסחרי ההדמיה נוצרת לפי סוג העסק שהגולש/ת בוחר/ת, ולכן אין לה סט בסיס",
      },
      400
    );
  }

  // ---- תמונות המקור ----------------------------------------------------
  const images: string[] = Array.isArray(property.images) ? property.images.filter(Boolean) : [];
  if (images.length === 0) return json({ error: "no_images", message: "אין תמונות לנכס הזה" }, 400);

  const tags = await ensureTagged(supabase, apiKey, property_id, images);

  const targets: PrivateTarget[] = hasOwnExterior(property.property_type)
    ? ["exterior", "living_room", "kitchen"]
    : ["living_room", "kitchen"];

  const picked = pickPrivateSources(tags, targets);
  const found = targets.filter((t) => picked[t]);
  if (found.length === 0) {
    return json(
      {
        error: "no_suitable_images",
        message: "לא זוהו תמונות של סלון או מטבח. הוסיפו תמונות ברורות של החללים האלה ונסו שוב.",
        classified: tags.map((t) => ({ image_url: t.image_url, room_type: t.room_type })),
      },
      400
    );
  }

  // ---- מה כבר קיים -----------------------------------------------------
  const { data: existing } = await supabase
    .from("property_visualizations")
    .select("id, target, status, result_url")
    .eq("property_id", property_id)
    .eq("kind", "private_room")
    .eq("style_key", styleKey);

  const existingByTarget = new Map((existing ?? []).map((r: any) => [r.target, r]));
  const todo = force
    ? found
    : found.filter((t) => {
        const row = existingByTarget.get(t);
        return !(row && row.status === "done" && row.result_url);
      });

  if (todo.length === 0) {
    return json({
      ok: true,
      job_id: null,
      style: styleKey,
      note: "סט הבסיס בסגנון הזה כבר קיים",
      ready: (existing ?? []).filter((r: any) => r.status === "done").map((r: any) => r.target),
    });
  }

  // ---- הבקשה -----------------------------------------------------------
  const { data: job, error: jobErr } = await supabase
    .from("visualization_jobs")
    .insert({
      property_id,
      kind: "private_room",
      trigger_source: "base",
      style_key: styleKey,
      // בקריאה פנימית אין סוכן/ת שיזם/ה — הטריגר הוא המערכת עצמה
      requested_by_agent_id: agent ? agent.id : null,
      status: "processing",
    })
    .select("id")
    .single();
  if (jobErr) return json({ error: "db_error", detail: jobErr.message }, 500);

  const sizeSqm = property.size_sqm ?? property.area_sqm ?? null;
  const items: WorkItem[] = [];

  for (const target of todo) {
    const sourceUrl = picked[target]!;
    const payload = {
      property_id,
      job_id: job.id,
      kind: "private_room",
      target,
      style_key: styleKey,
      source_image_url: sourceUrl,
      status: "pending",
      is_base: true,
      error_detail: null,
    };

    const prior = existingByTarget.get(target);
    let rowId: string;
    if (prior) {
      await supabase.from("property_visualizations").update(payload).eq("id", prior.id);
      rowId = prior.id;
    } else {
      const { data: inserted, error: insErr } = await supabase
        .from("property_visualizations")
        .insert(payload)
        .select("id")
        .single();
      if (insErr) continue;
      rowId = inserted.id;
    }

    items.push({
      rowId,
      target,
      sourceUrl,
      prompt: buildPrivatePrompt(target, styleKey, {
        propertyType: property.property_type,
        sizeSqm: sizeSqm ? Number(sizeSqm) : null,
        rooms: property.rooms ? Number(property.rooms) : null,
      }),
    });
  }

  if (items.length === 0) {
    await supabase
      .from("visualization_jobs")
      .update({ status: "failed", error_detail: "לא נוצרו שורות הדמיה" })
      .eq("id", job.id);
    return json({ error: "db_error", detail: "לא נוצרו שורות הדמיה" }, 500);
  }

  // @ts-ignore — EdgeRuntime.waitUntil זמין בסביבת ה-Edge Functions של Supabase
  EdgeRuntime.waitUntil(runVisualizationJob(supabase, apiKey, job.id, items));

  return json({
    ok: true,
    job_id: job.id,
    style: styleKey,
    style_label: STYLES[styleKey].label,
    targets: items.map((i) => i.target),
    skipped_targets: targets.filter((t) => !picked[t]),
  });
});
