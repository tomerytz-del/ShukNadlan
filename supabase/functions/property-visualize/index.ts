import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  buildCommercialPrompt,
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
  type CommercialTarget,
  type PrivateTarget,
  type StyleKey,
  type WorkItem,
} from "../_shared/visualization.ts";

// ============================================================================
// הדמיית נכס לפי דרישת הגולש/ת — הצד ה"חי" של המנגנון ההיברידי.
//
// ‏POST { property_id, style?, business_type?, business_description?, name, phone }
// מחזיר מיד { ok, job_id, ready } והעיבוד ממשיך ברקע; הפרונט עושה polling דרך
// ‏rpc('visualization_job_status', { p_job_id }).
//
// שלוש נקודות שכדאי להכיר לפני שנוגעים כאן:
//
//   1. הפרטים אינם "אימות" — הם המוצר. גולש/ת שמבקש/ת לראות איך המטבח נראה
//      בסגנון אחר הוא/היא ליד חם, ולכן הליד נוצר לפני ההדמיה ולא אחריה, ונכנס
//      לאותו מסלול tier של property-inquiry-intake.
//   2. הדמיה פרטית שכבר קיימת לא נוצרת מחדש. שני גולשים שביקשו "סלון בסגנון
//      ים-תיכוני" מקבלים את אותה תמונה — הליד נרשם פעמיים, ה-API נקרא פעם אחת.
//      זה מה שהופך את המודל ההיברידי לזול יותר מ-batch מראש.
//   3. הזכאות נקבעת ב-DB (property_visualizations_enabled) ולא כאן, כדי שלא
//      יהיו שתי הגדרות שונות ל"מי זכאי".
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return json({ error: "gemini_not_configured" }, 500);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const { property_id, style, business_type, business_description, name, phone } = body ?? {};
  if (!property_id) return json({ error: "missing_property_id" }, 400);
  if (!name || !phone) return json({ error: "missing_contact", message: "יש למלא שם וטלפון" }, 400);

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // ---- זכאות ------------------------------------------------------------
  const { data: enabled } = await supabase.rpc("property_visualizations_enabled", {
    p_property_id: property_id,
  });
  if (!enabled) {
    return json({ error: "not_available", message: "הדמיות זמינות רק בנכסים של סוכני Premium" }, 403);
  }

  const { data: property } = await supabase
    .from("properties")
    .select("id, title, category, property_type, rooms, size_sqm, area_sqm, city, deal_type, agency_id, agent_id, images, agency_members(tier)")
    .eq("id", property_id)
    .single();
  if (!property) return json({ error: "property_not_found" }, 404);

  // מגרש וקרקע אינם ניתנים להדמיה — ראו isLandType. דף הנכס לא מציג להם את
  // הטופס בכלל, וכאן נסגרת גם הדרך הישירה לפונקציה.
  if (isLandType(property.property_type)) {
    return json({
      error: "land_not_supported",
      message: "לנכסי קרקע מוצג מידע תכנוני במקום הדמיה",
    }, 400);
  }

  // ---- בלם קצב ----------------------------------------------------------
  // ‏Gemini עולה כסף לכל קריאה, והנכס פתוח לכל האינטרנט. הבלם הוא פר נכס ליום
  // ולא פר גולש/ת, כי אין לנו זהות אמינה של גולש/ת בצד הזה.
  const { data: capRow } = await supabase
    .from("pricing_config")
    .select("value")
    .eq("key", "visualization_ondemand_daily_cap")
    .maybeSingle();
  const dailyCap = Number(capRow?.value ?? 30);

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: todayCount } = await supabase
    .from("visualization_jobs")
    .select("id", { count: "exact", head: true })
    .eq("property_id", property_id)
    .eq("trigger_source", "ondemand")
    .gte("created_at", since);

  if ((todayCount ?? 0) >= dailyCap) {
    return json({ error: "rate_limited", message: "הנכס הזה הגיע למכסת ההדמיות היומית. נסו שוב מחר." }, 429);
  }

  const isPrivate = property.category === "residential";
  const kind = isPrivate ? "private_room" : "commercial_business";

  let styleKey: StyleKey | null = null;
  if (isPrivate) {
    styleKey = isStyleKey(style) ? style : DEFAULT_STYLE;
  } else if (!business_type) {
    return json({ error: "missing_business_type", message: "יש לבחור סוג עסק" }, 400);
  }

  // ---- תמונות המקור -----------------------------------------------------
  const images: string[] = Array.isArray(property.images) ? property.images.filter(Boolean) : [];
  if (images.length === 0) return json({ error: "no_images", message: "אין תמונות לנכס הזה" }, 400);

  const tags = await ensureTagged(supabase, apiKey, property_id, images);
  const sizeSqm = property.size_sqm ?? property.area_sqm ?? null;

  const sources: Array<{ target: PrivateTarget | CommercialTarget; url: string; prompt: string }> = [];

  if (isPrivate) {
    // חוץ רק לבית פרטי — בדירה בבניין החזית היא רכוש משותף
    const targets: PrivateTarget[] = hasOwnExterior(property.property_type)
      ? ["exterior", "living_room", "kitchen"]
      : ["living_room", "kitchen"];

    const picked = pickPrivateSources(tags, targets);
    for (const target of targets) {
      const url = picked[target];
      if (!url) continue;
      sources.push({
        target,
        url,
        prompt: buildPrivatePrompt(target, styleKey!, {
          propertyType: property.property_type,
          sizeSqm: sizeSqm ? Number(sizeSqm) : null,
          rooms: property.rooms ? Number(property.rooms) : null,
        }),
      });
    }
  } else {
    const exterior = tags.find((t) => t.photo_type === "exterior");
    const interior = tags.find((t) => t.photo_type === "interior" && t.space_role === "main");
    const pairs: Array<[CommercialTarget, string | undefined]> = [
      ["exterior", exterior?.image_url],
      ["interior_main", interior?.image_url],
    ];
    for (const [target, url] of pairs) {
      if (!url) continue;
      sources.push({
        target,
        url,
        prompt: buildCommercialPrompt(
          target,
          business_type,
          business_description ?? "",
          sizeSqm ? Number(sizeSqm) : null
        ),
      });
    }
  }

  if (sources.length === 0) {
    return json(
      { error: "no_suitable_images", message: "לא נמצאו תמונות מתאימות להדמיה בנכס הזה" },
      400
    );
  }

  // ---- מה כבר קיים ------------------------------------------------------
  // רק status='done' נחשב שימוש חוזר. שורה שנכשלה או שתקועה ב-processing
  // נוצרת מחדש — עדיף לשלם עוד קריאה מאשר להשאיר גולש/ת מול תמונה חסרה.
  let ready: Array<{ target: string; style_key: string | null; result_url: string }> = [];
  if (isPrivate) {
    const { data: existing } = await supabase
      .from("property_visualizations")
      .select("target, style_key, result_url, status")
      .eq("property_id", property_id)
      .eq("kind", "private_room")
      .eq("style_key", styleKey)
      .eq("status", "done");
    ready = (existing ?? [])
      .filter((r: any) => r.result_url)
      .map((r: any) => ({ target: r.target, style_key: r.style_key, result_url: r.result_url }));
  }

  const readyTargets = new Set(ready.map((r) => r.target));
  const todo = sources.filter((s) => !readyTargets.has(s.target));

  // ---- הליד -------------------------------------------------------------
  // נוצר תמיד, גם כשאין מה לייצר: מה שמעניין את הסוכן/ת הוא הפנייה, לא
  // האם התמונה במקרה כבר הייתה בקאש.
  const tier = (property as any).agency_members?.tier ?? "free";
  const autoUnlock = tier === "mid" || tier === "premium";
  const details = isPrivate
    ? `הדמיית נכס פרטי · סגנון: ${styleKey}`
    : `הדמיית עסק · סוג: ${business_type}${business_description ? ` · ${business_description}` : ""}`;

  const leadPayload: Record<string, unknown> = {
    lead_type: "visualization",
    deal_type: property.deal_type,
    property_id: property.id,
    agency_id: property.agency_id,
    agent_id: property.agent_id,
    raw_name: name,
    raw_phone: phone,
    raw_message: details,
    property_details: details,
    city: property.city,
    property_type: property.property_type,
    status: autoUnlock ? "unlocked" : "masked",
  };
  if (autoUnlock) {
    leadPayload.quota_source = "subscription_unlimited";
    leadPayload.unlocked_at = new Date().toISOString();
    leadPayload.unlocked_by = property.agent_id;
  }

  const { data: lead, error: leadErr } = await supabase.from("leads").insert(leadPayload).select("id").single();
  if (leadErr) return json({ error: "db_error", detail: leadErr.message }, 500);

  if (todo.length === 0) {
    return json({ ok: true, job_id: null, lead_id: lead.id, ready, note: "כל ההדמיות בסגנון הזה כבר קיימות" });
  }

  // ---- הבקשה ------------------------------------------------------------
  const { data: job, error: jobErr } = await supabase
    .from("visualization_jobs")
    .insert({
      property_id,
      kind,
      trigger_source: "ondemand",
      style_key: styleKey,
      business_type: business_type ?? null,
      business_description: business_description ?? null,
      lead_id: lead.id,
      status: "processing",
    })
    .select("id")
    .single();
  if (jobErr) return json({ error: "db_error", detail: jobErr.message }, 500);

  const items: WorkItem[] = [];
  for (const s of todo) {
    // בהדמיה פרטית המפתח (נכס, מטרה, סגנון) ייחודי — מעדכנים שורה קיימת
    // שנכשלה במקום להתנגש באינדקס.
    let rowId: string | null = null;
    if (isPrivate) {
      const { data: prior } = await supabase
        .from("property_visualizations")
        .select("id")
        .eq("property_id", property_id)
        .eq("kind", "private_room")
        .eq("target", s.target)
        .eq("style_key", styleKey)
        .maybeSingle();
      if (prior) {
        await supabase
          .from("property_visualizations")
          .update({ job_id: job.id, source_image_url: s.url, status: "pending", error_detail: null })
          .eq("id", prior.id);
        rowId = prior.id;
      }
    }

    if (!rowId) {
      const { data: inserted, error: insErr } = await supabase
        .from("property_visualizations")
        .insert({
          property_id,
          job_id: job.id,
          kind,
          target: s.target,
          style_key: styleKey,
          source_image_url: s.url,
          status: "pending",
        })
        .select("id")
        .single();
      if (insErr) continue;
      rowId = inserted.id;
    }

    items.push({ rowId, target: s.target, sourceUrl: s.url, prompt: s.prompt });
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
    lead_id: lead.id,
    ready,
    pending_targets: items.map((i) => i.target),
  });
});
