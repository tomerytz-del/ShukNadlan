import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { fetchAsBase64 } from "../_shared/visualization.ts";
import { BRANDING_MODEL, detectBranding } from "./branding.ts";
import { maskHouseNumber, scrubPartnerText } from "./scrub.ts";
import { authorizeInternalCaller } from "../_shared/cron-auth.ts";
import {
  phoneE164, sendShowcaseTemplate, sendShowcaseText, templateConfigured, waConfigured, WaError, WA_OPTED_OUT,
} from "./wa.ts";

// ============================================================================
// המיניסייט האישי ללקוח/ה — showcase.html ↔ כאן ↔ client_showcase_*.
//
// ‏verify_jwt=false, ושני סוגי קוראים:
//
//   ‏· **הלקוח/ה** — אין חשבון. הטוקן מהקישור (‏`t`) הוא המפתח למיניסייט אחד.
//     ‏view / react / message / meeting / cancel_meeting.
//   ‏· **הסוכן/ת** — ‏JWT רגיל ב-Authorization, נבדק כאן מול auth.getUser.
//     ‏scan: בדיקת לוגו בתמונות של נכסי השת"פ במיניסייט שלו/ה.
//
// הדף ממותג במשרד ובסוכן/ת ששלח/ה אותו, והנכסים **בלי מיתוג, כולם באותו
// טיפול**: כל נכס נבנה כאן מחדש מהשדות - בלי משרד מפרסם, סוכן/ת או טלפון,
// בלי מספר בית (‏docs/property-address-privacy.md), תיאור מנוקה, בלי סרטון
// וסיור, ורק תמונות שנבדקו ונמצאו בלי לוגו. נכס בשת"פ אינו נבדל בשום דבר
// מנכס של הסוכן/ת. הפרטים: docs/client-showcase.md
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const TOKEN_RE = /^[0-9a-f]{48}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASONS = ["price", "location", "size", "condition", "layout", "floor", "photos", "other"];
const MAX_IMAGES = 12;
const SCAN_PER_CALL = 60;
const SCAN_CONCURRENCY = 5;
const CLIENT_MSGS_PER_HOUR = 20;
const OPEN_MEETINGS_MAX = 3;
// תגובות ופתיחות מתקבצות להתראה אחת שמתעדכנת, כל עוד לא נקראה
const COALESCE_MINUTES = 120;

// מאפיין שמסגיר אצל מי הנכס — לא מוצג באף נכס, כדי שכולם ייראו אותו דבר
const HIDDEN_FEATURES = new Set(["exclusive"]);
const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: corsHeaders() });
}

function trimmed(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Row = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    return json({ error: "bad_json" }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const action = String(body.action ?? "view");

  if (action === "scan") return await handleScan(req, supabase, body);
  if (action === "wa_notify") {
    // ה-cron (‏showcase-wa) או קריאה ידנית עם service_role - לא דפדפן
    const auth = authorizeInternalCaller(req);
    if (!auth.ok) return json({ error: auth.error, detail: auth.detail }, auth.status);
    return await handleWaNotify(supabase);
  }

  const token = String(body.t ?? "");
  if (!TOKEN_RE.test(token)) return json({ error: "not_found" }, 404);

  const { data: showcase, error } = await supabase
    .from("client_showcases")
    .select("id, agent_id, client_id, intro, status, view_count, first_viewed_at, wa_notify")
    .eq("token", token)
    .maybeSingle();
  if (error) return json({ error: "db_error" }, 500);
  if (!showcase) return json({ error: "not_found" }, 404);
  if (showcase.status !== "active") return json({ error: "closed" }, 410);

  switch (action) {
    case "view":
      return await handleView(supabase, showcase, body.preview === true);
    case "react":
      return await handleReact(supabase, showcase, body);
    case "message":
      return await handleMessage(supabase, showcase, body);
    case "meeting":
      return await handleMeeting(supabase, showcase, body);
    case "wa_pref": {
      // המתג בעמוד: "עדכונים בוואטסאפ". כיבוי גם מרוקן את התור.
      const on = body.on === true;
      const { error: prefErr } = await supabase
        .from("client_showcases")
        .update(on ? { wa_notify: true } : { wa_notify: false, wa_pending_at: null, wa_pending_kinds: [] })
        .eq("id", showcase.id);
      if (prefErr) return json({ error: "db_error" }, 500);
      return json({ ok: true, wa_notify: on });
    }
    case "cancel_meeting":
      return await handleCancelMeeting(supabase, showcase, body);
    default:
      return json({ error: "unknown_action" }, 400);
  }
});

// ---------------------------------------------------------------------------
// view
// ---------------------------------------------------------------------------
async function handleView(supabase: SupabaseClient, showcase: Row, preview: boolean) {
  const [{ data: agent }, { data: client }] = await Promise.all([
    supabase
      .from("agency_members")
      .select("id, agency_id, display_name, photo_url, phone, email, slug, license_number, agencies!agency_members_agency_id_fkey(name, slug, logo_url, colors)")
      .eq("id", showcase.agent_id)
      .maybeSingle(),
    supabase.from("agent_clients").select("full_name").eq("id", showcase.client_id).maybeSingle(),
  ]);
  if (!agent) return json({ error: "not_found" }, 404);

  const items = await visibleItems(supabase, showcase, agent.agency_id);

  const [{ data: messages }, { data: meetings }, busy, hasAgreement] = await Promise.all([
    supabase
      .from("client_showcase_messages")
      .select("id, item_id, author, body, created_at")
      .eq("showcase_id", showcase.id)
      .order("created_at", { ascending: true })
      .limit(300),
    supabase
      .from("client_showcase_meetings")
      .select("id, property_ids, starts_at, note, status, agent_note, created_at")
      .eq("showcase_id", showcase.id)
      .neq("status", "canceled")
      .order("starts_at", { ascending: true }),
    busySlots(supabase, showcase.agent_id),
    clientHasAgreement(supabase, showcase.agent_id, showcase.client_id),
  ]);

  // תצוגה מקדימה של הסוכן/ת אינה "הלקוח/ה פתח/ה", ואינה מסמנת את ההודעות
  // שלו/ה כנקראו
  if (!preview) {
    const now = new Date().toISOString();
    await supabase
      .from("client_showcases")
      .update({
        view_count: (showcase.view_count ?? 0) + 1,
        last_viewed_at: now,
        ...(showcase.first_viewed_at ? {} : { first_viewed_at: now }),
      })
      .eq("id", showcase.id);
    await supabase
      .from("client_showcase_messages")
      .update({ read_at: now })
      .eq("showcase_id", showcase.id)
      .eq("author", "agent")
      .is("read_at", null);
    if (!showcase.first_viewed_at) {
      await notifyAgent(supabase, showcase, `${firstName(client?.full_name)} פתח/ה את המיניסייט`,
        `${items.length} נכסים מחכים לתגובה`, true);
    }
  }

  // ‏item_id → property_id אינו נחשף; הפגישה מוצגת לפי הפריטים שבה
  const byProperty = new Map(items.map((it) => [it.property_id, it.id]));
  const agency = Array.isArray(agent.agencies) ? agent.agencies[0] : agent.agencies;

  return json({
    ok: true,
    client_name: firstName(client?.full_name),
    intro: showcase.intro ?? "",
    // הדף ממותג במשרד ובסוכן/ת ששלח/ה אותו - זה כל המיתוג שהלקוח/ה רואה/ה
    agent: {
      name: agent.display_name ?? "",
      photo_url: agent.photo_url ?? null,
      phone: agent.phone ?? null,
      email: agent.email ?? null,
      slug: agent.slug ?? null,
      license_number: agent.license_number ?? null,
      agency_name: agency?.name ?? null,
      agency_logo: agency?.logo_url ?? null,
      agency_slug: agency?.slug ?? null,
      colors: brandColors(agency?.colors),
    },
    has_agreement: hasAgreement,
    wa_notify: showcase.wa_notify !== false,
    items: items.map(({ property_id: _p, ...rest }) => rest),
    messages: messages ?? [],
    meetings: (meetings ?? []).map((m: Row) => ({
      id: m.id,
      starts_at: m.starts_at,
      note: m.note,
      status: m.status,
      agent_note: m.agent_note,
      item_ids: (m.property_ids ?? []).map((pid: string) => byProperty.get(pid)).filter(Boolean),
    })),
    busy,
  });
}

/**
 * הנכסים שהלקוח/ה רואה/ה: לא הוסרו, לא נפסלו, פעילים, ועדיין במאגר — כלומר
 * נכס של המשרד שעדיין במשרד, ונכס בשת"פ שהשת"פ עליו עדיין קיים.
 */
async function visibleItems(supabase: SupabaseClient, showcase: Row, agencyId: string | null) {
  const { data: rows } = await supabase
    .from("client_showcase_items")
    .select("id, property_id, source, agent_note, reaction, position")
    .eq("showcase_id", showcase.id)
    .is("removed_at", null)
    .or("reaction.is.null,reaction.eq.liked")
    .order("position", { ascending: true });
  if (!rows || rows.length === 0 || !agencyId) return [];

  const ids = rows.map((r: Row) => r.property_id);
  const [{ data: props }, { data: shares }, { data: tags }] = await Promise.all([
    supabase
      .from("properties")
      .select(
        "id, agency_id, agent_id, status, category, property_type, deal_type, price, rooms, size_sqm, " +
          "built_size_sqm, garden_sqm, floor, total_floors, city, street, house_number, sales_area, " +
          "features, condition, move_in_date, move_in_soon, maintenance_fee, arnona, price_includes_vat, " +
          "description, marketing_description, marketing_description_stale, images, " +
          "agent2_name, neighborhoods(name), agencies!properties_agency_id_fkey(name), " +
          "agency_members!properties_agent_id_fkey(display_name)",
      )
      .in("id", ids)
      .eq("status", "active"),
    supabase
      .from("property_shares")
      .select("property_id")
      .in("property_id", ids)
      .eq("shared_with_agency_id", agencyId),
    supabase
      .from("property_image_tags")
      .select("property_id, image_url, has_branding")
      .in("property_id", ids)
      .eq("has_branding", false),
  ]);

  const propById = new Map((props ?? []).map((p: Row) => [p.id, p]));
  const shared = new Set((shares ?? []).map((s: Row) => s.property_id));
  const cleanImages = new Map<string, Set<string>>();
  for (const t of tags ?? []) {
    if (!cleanImages.has(t.property_id)) cleanImages.set(t.property_id, new Set());
    cleanImages.get(t.property_id)!.add(t.image_url);
  }

  const out = [];
  for (const r of rows) {
    const p = propById.get(r.property_id);
    if (!p) continue;
    // מקור נגזר מחדש: נכס שעבר משרד, או שהשת"פ עליו בוטל, יורד
    const inAgency = p.agency_id === agencyId;
    const partner = !inAgency;
    if (partner && !shared.has(p.id)) continue;
    out.push(publicItem(r, p, cleanImages.get(p.id) ?? new Set()));
  }
  return out;
}

/**
 * נכס כפי שהלקוח/ה רואה/ה אותו. **אותו טיפול לכל נכס** - שלי, של המשרד או
 * בשת"פ: נכס שלי עם סרטון ותיאור עם טלפון לצד נכס בשת"פ בלעדיהם היה בעצמו
 * הסימן שהשני הגיע ממשרד אחר.
 */
function publicItem(item: Row, p: Row, clean: Set<string>) {
  const hood = (Array.isArray(p.neighborhoods) ? p.neighborhoods[0] : p.neighborhoods)?.name || p.sales_area || "";
  const agencyName = (Array.isArray(p.agencies) ? p.agencies[0] : p.agencies)?.name;
  const agentName = (Array.isArray(p.agency_members) ? p.agency_members[0] : p.agency_members)?.display_name;

  const marketing = p.marketing_description_stale && p.description ? "" : p.marketing_description;
  let description = String(marketing || p.description || "");
  description = maskHouseNumber(description, p.house_number);
  description = scrubPartnerText(description, [agencyName, agentName, p.agent2_name]);

  // רק תמונה שנבדקה ונמצאה בלי לוגו - גם בנכס של המשרד שלי
  const allImages: string[] = (p.images ?? []).filter((u: unknown) => typeof u === "string" && u);
  const images = allImages.filter((u) => clean.has(u)).slice(0, MAX_IMAGES);

  const features: string[] = (p.features ?? []).filter((f: string) => !HIDDEN_FEATURES.has(f));

  return {
    id: item.id as string,
    property_id: p.id as string,
    reaction: item.reaction ?? null,
    agent_note: item.agent_note ?? "",
    category: p.category,
    property_type: p.property_type,
    deal_type: p.deal_type,
    price: p.price,
    price_includes_vat: p.price_includes_vat,
    rooms: p.rooms,
    size_sqm: p.size_sqm,
    built_size_sqm: p.built_size_sqm,
    garden_sqm: p.garden_sqm,
    floor: p.floor,
    total_floors: p.total_floors,
    city: p.city,
    street: p.street,
    neighborhood: hood && hood !== p.city ? hood : "",
    features,
    condition: p.condition,
    move_in_date: p.move_in_date,
    move_in_soon: p.move_in_soon,
    maintenance_fee: p.maintenance_fee,
    arnona: p.arnona,
    description,
    images,
    // בלי סרטון וסיור תלת-ממדי: הם יושבים לרוב בערוץ של המשרד המפרסם, עם
    // הלוגו שלו - ובנכס שלי לבד הם היו מסמנים את השאר כ"לא שלו/ה"
  };
}

/** צבעי המשרד - רק hex תקין, כדי ששדה במסד לא יהפוך ל-CSS שרירותי בדף. */
function brandColors(colors: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!colors || typeof colors !== "object") return out;
  for (const key of ["primary", "primary_dark", "accent"]) {
    const v = (colors as Row)[key];
    if (typeof v === "string" && HEX_RE.test(v.trim())) out[key] = v.trim();
  }
  return out;
}

async function busySlots(supabase: SupabaseClient, agentId: string) {
  const now = new Date();
  const until = new Date(now.getTime() + 31 * 86400_000);
  const [{ data: agenda }, { data: showings }] = await Promise.all([
    supabase
      .from("agent_agenda_items")
      .select("due_at, ends_at")
      .eq("agent_id", agentId)
      .eq("status", "open")
      .in("kind", ["meeting", "showing", "signing"])
      .gte("due_at", now.toISOString())
      .lte("due_at", until.toISOString())
      .limit(300),
    supabase
      .from("client_showcase_meetings")
      .select("starts_at, client_showcases!inner(agent_id)")
      .eq("client_showcases.agent_id", agentId)
      .in("status", ["requested", "confirmed"])
      .gte("starts_at", now.toISOString())
      .limit(300),
  ]);
  const hour = 3600_000;
  const slots: Array<{ from: string; to: string }> = [];
  for (const a of agenda ?? []) {
    const from = new Date(a.due_at);
    const to = a.ends_at ? new Date(a.ends_at) : new Date(from.getTime() + hour);
    slots.push({ from: from.toISOString(), to: to.toISOString() });
  }
  for (const s of showings ?? []) {
    const from = new Date(s.starts_at);
    slots.push({ from: from.toISOString(), to: new Date(from.getTime() + hour).toISOString() });
  }
  // רק המועדים, בלי כותרת, לקוח/ה או מיקום — זה כל מה שעמוד הלקוח/ה צריך
  return slots;
}

async function clientHasAgreement(supabase: SupabaseClient, agentId: string, clientId: string) {
  const { data } = await supabase
    .from("agreements")
    .select("id")
    .eq("agent_id", agentId)
    .eq("status", "signed")
    .in("kind", ["buy", "tenant"])
    .contains("client_ids", [clientId])
    .limit(1);
  return (data ?? []).length > 0;
}

// ---------------------------------------------------------------------------
// react
// ---------------------------------------------------------------------------
async function handleReact(supabase: SupabaseClient, showcase: Row, body: Row) {
  const itemId = String(body.item_id ?? "");
  if (!UUID_RE.test(itemId)) return json({ error: "bad_item" }, 400);
  const reaction = body.reaction === "liked" || body.reaction === "disliked" ? body.reaction : null;
  const reasons = reaction === "disliked" && Array.isArray(body.reasons)
    ? [...new Set(body.reasons.filter((r: unknown) => typeof r === "string" && REASONS.includes(r)))]
    : [];

  const { data: item } = await supabase
    .from("client_showcase_items")
    .select("id, property_id, reaction, source, coop_status")
    .eq("id", itemId)
    .eq("showcase_id", showcase.id)
    .is("removed_at", null)
    .maybeSingle();
  if (!item) return json({ error: "bad_item" }, 404);

  // ‏"אהבתי" על נכס בשת"פ הוא משימה: לתאם מול המתווך/ת המקורי/ת. סטטוס
  // שהסוכן/ת כבר קידם/ה (פניתי, סוכם) אינו נדרס בלחיצה חוזרת.
  const coopNeeded = reaction === "liked" && item.source === "shared" && !item.coop_status;
  const { error } = await supabase
    .from("client_showcase_items")
    .update({
      reaction,
      reaction_reasons: reasons,
      reacted_at: reaction ? new Date().toISOString() : null,
      ...(coopNeeded ? { coop_status: "needed", coop_updated_at: new Date().toISOString() } : {}),
    })
    .eq("id", item.id);
  if (error) return json({ error: "db_error" }, 500);

  if (reaction && reaction !== item.reaction) {
    const { data: client } = await supabase.from("agent_clients").select("full_name").eq("id", showcase.client_id).maybeSingle();
    const { data: p } = await supabase
      .from("properties")
      .select("property_type, street, city, agency_members!properties_agent_id_fkey(display_name, phone), agencies!properties_agency_id_fkey(name)")
      .eq("id", item.property_id)
      .maybeSingle();
    const what = [p?.property_type, [p?.street, p?.city].filter(Boolean).join(", ")].filter(Boolean).join(" ב");
    const verb = reaction === "liked" ? "אהב/ה" : "לא אהב/ה";
    const why = reasons.length ? ` (${reasons.map((r) => REASON_LABELS[r as string] ?? r).join(", ")})` : "";
    const name = firstName(client?.full_name);

    if (reaction === "liked" && item.source === "shared") {
      // התראה נפרדת שאינה מתקבצת: זו משימה, לא סטטיסטיקה. פרטי המתווך/ת
      // המקורי/ת יוצאים רק לכאן - לסוכן/ת - ולעולם לא לעמוד הלקוח/ה.
      const lister = Array.isArray(p?.agency_members) ? p?.agency_members[0] : p?.agency_members;
      const office = (Array.isArray(p?.agencies) ? p?.agencies[0] : p?.agencies)?.name;
      const who = [lister?.display_name, office && `(${office})`, lister?.phone].filter(Boolean).join(" ");
      await notifyAgent(supabase, showcase, `${name} אהב/ה נכס בשת"פ - לתאם עם המתווך/ת`,
        `${what}${who ? ` · לתאם עם ${who}` : ""}`, false);
    } else {
      await notifyAgent(supabase, showcase, `${name} ${verb} נכס במיניסייט`, `${what}${why}`, true);
    }
  }
  return json({ ok: true });
}

const REASON_LABELS: Record<string, string> = {
  price: "מחיר", location: "מיקום", size: "גודל", condition: "מצב הנכס",
  layout: "חלוקה", floor: "קומה", photos: "התמונות", other: "אחר",
};

// ---------------------------------------------------------------------------
// message
// ---------------------------------------------------------------------------
async function handleMessage(supabase: SupabaseClient, showcase: Row, body: Row) {
  const text = trimmed(body.body, 1000);
  if (!text) return json({ error: "empty" }, 400);

  let itemId: string | null = null;
  if (body.item_id) {
    const candidate = String(body.item_id);
    if (!UUID_RE.test(candidate)) return json({ error: "bad_item" }, 400);
    const { data: item } = await supabase
      .from("client_showcase_items").select("id").eq("id", candidate).eq("showcase_id", showcase.id).maybeSingle();
    if (!item) return json({ error: "bad_item" }, 404);
    itemId = item.id;
  }

  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await supabase
    .from("client_showcase_messages")
    .select("id", { count: "exact", head: true })
    .eq("showcase_id", showcase.id)
    .eq("author", "client")
    .gte("created_at", since);
  if ((count ?? 0) >= CLIENT_MSGS_PER_HOUR) return json({ error: "rate_limited" }, 429);

  const { data: msg, error } = await supabase
    .from("client_showcase_messages")
    .insert({ showcase_id: showcase.id, item_id: itemId, author: "client", body: text })
    .select("id, item_id, author, body, created_at")
    .single();
  if (error) return json({ error: "db_error" }, 500);

  const { data: client } = await supabase.from("agent_clients").select("full_name").eq("id", showcase.client_id).maybeSingle();
  await notifyAgent(supabase, showcase, `הודעה חדשה מ${firstName(client?.full_name)} במיניסייט`, text.slice(0, 180), false);
  return json({ ok: true, message: msg });
}

// ---------------------------------------------------------------------------
// meeting
// ---------------------------------------------------------------------------
async function handleMeeting(supabase: SupabaseClient, showcase: Row, body: Row) {
  const startsAt = new Date(String(body.starts_at ?? ""));
  const now = Date.now();
  if (isNaN(startsAt.getTime())) return json({ error: "bad_time" }, 400);
  if (startsAt.getTime() < now + 3600_000 || startsAt.getTime() > now + 31 * 86400_000) {
    return json({ error: "bad_time" }, 400);
  }
  if (startsAt.getUTCMinutes() % 30 !== 0) return json({ error: "bad_time" }, 400);

  const itemIds: string[] = Array.isArray(body.item_ids)
    ? body.item_ids.filter((x: unknown) => typeof x === "string" && UUID_RE.test(x)).slice(0, 10)
    : [];
  if (itemIds.length === 0) return json({ error: "no_items" }, 400);

  const { data: items } = await supabase
    .from("client_showcase_items")
    .select("property_id")
    .eq("showcase_id", showcase.id)
    .in("id", itemIds)
    .is("removed_at", null)
    .or("reaction.is.null,reaction.eq.liked");
  const propertyIds = (items ?? []).map((i: Row) => i.property_id);
  if (propertyIds.length === 0) return json({ error: "no_items" }, 400);

  const { count } = await supabase
    .from("client_showcase_meetings")
    .select("id", { count: "exact", head: true })
    .eq("showcase_id", showcase.id)
    .eq("status", "requested");
  if ((count ?? 0) >= OPEN_MEETINGS_MAX) return json({ error: "too_many_open" }, 429);

  const busy = await busySlots(supabase, showcase.agent_id);
  const t = startsAt.getTime();
  if (busy.some((b) => t >= new Date(b.from).getTime() - 3600_000 + 1 && t < new Date(b.to).getTime())) {
    return json({ error: "slot_taken" }, 409);
  }

  const note = trimmed(body.note, 600) || null;
  const { data: meeting, error } = await supabase
    .from("client_showcase_meetings")
    .insert({ showcase_id: showcase.id, property_ids: propertyIds, starts_at: startsAt.toISOString(), note })
    .select("id, starts_at, note, status, agent_note")
    .single();
  if (error) return json({ error: "db_error" }, 500);

  const { data: client } = await supabase.from("agent_clients").select("full_name").eq("id", showcase.client_id).maybeSingle();
  const when = startsAt.toLocaleString("he-IL", {
    timeZone: "Asia/Jerusalem", weekday: "long", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit",
  });
  await notifyAgent(
    supabase, showcase,
    `${firstName(client?.full_name)} מבקש/ת לתאם סיור`,
    `${when} · ${propertyIds.length === 1 ? "נכס אחד" : `${propertyIds.length} נכסים`}${note ? ` · ${note.slice(0, 120)}` : ""}`,
    false,
  );
  return json({ ok: true, meeting: { ...meeting, item_ids: itemIds } });
}

async function handleCancelMeeting(supabase: SupabaseClient, showcase: Row, body: Row) {
  const id = String(body.meeting_id ?? "");
  if (!UUID_RE.test(id)) return json({ error: "bad_meeting" }, 400);
  const { data, error } = await supabase
    .from("client_showcase_meetings")
    .update({ status: "canceled", decided_at: new Date().toISOString() })
    .eq("id", id)
    .eq("showcase_id", showcase.id)
    .in("status", ["requested", "confirmed"])
    .select("id, starts_at, agenda_item_id")
    .maybeSingle();
  if (error) return json({ error: "db_error" }, 500);
  if (!data) return json({ error: "bad_meeting" }, 404);

  // סיור שכבר נרשם ביומן מתבטל גם שם, כדי שהסוכן/ת לא יגיע/תגיע לפגישה שאיננה
  if (data.agenda_item_id) {
    await supabase.from("agent_agenda_items").update({ status: "canceled" }).eq("id", data.agenda_item_id);
  }
  const { data: client } = await supabase.from("agent_clients").select("full_name").eq("id", showcase.client_id).maybeSingle();
  await notifyAgent(supabase, showcase, `${firstName(client?.full_name)} ביטל/ה סיור`, "", false);
  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// scan — הסוכן/ת, עם JWT
// ---------------------------------------------------------------------------
async function handleScan(req: Request, supabase: SupabaseClient, body: Row) {
  // שני קוראים: הסוכן/ת מה-CRM (‏JWT, ונבדקת הבעלות), או קורא פנימי עם
  // ‏service_role - העוזרת בוואטסאפ אחרי create_showcase, שכבר אימתה את
  // הסוכן/ת לפי הטלפון ואת המיניסייט דרך agent_showcase_add_properties.
  const internal = authorizeInternalCaller(req).ok;
  let userId: string | null = null;
  if (!internal) {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
    const { data: userData } = await supabase.auth.getUser(auth.slice(7));
    userId = userData?.user?.id ?? null;
    if (!userId) return json({ error: "unauthorized" }, 401);
  }

  const showcaseId = String(body.showcase_id ?? "");
  if (!UUID_RE.test(showcaseId)) return json({ error: "bad_showcase" }, 400);

  const { data: showcase } = await supabase
    .from("client_showcases")
    .select("id, agent_id, agency_members!client_showcases_agent_id_fkey(user_id, agency_id)")
    .eq("id", showcaseId)
    .maybeSingle();
  const owner = showcase && (Array.isArray(showcase.agency_members) ? showcase.agency_members[0] : showcase.agency_members);
  if (!showcase || (!internal && owner?.user_id !== userId)) return json({ error: "not_found" }, 404);

  const apiKey = Deno.env.get("GEMINI_API_KEY");

  // כל הנכסים במיניסייט: גם תמונה עם הלוגו של המשרד שלי אינה מוצגת, כי
  // המיתוג יושב בראש הדף ולא על הנכסים
  const { data: items } = await supabase
    .from("client_showcase_items")
    .select("property_id, properties(id, agency_id, images)")
    .eq("showcase_id", showcase.id)
    .is("removed_at", null);
  const props = (items ?? [])
    .map((i: Row) => (Array.isArray(i.properties) ? i.properties[0] : i.properties))
    .filter((p: Row | null) => !!p);

  const wanted: Array<{ property_id: string; image_url: string }> = [];
  for (const p of props) {
    for (const url of (p.images ?? []).filter(Boolean).slice(0, MAX_IMAGES)) {
      wanted.push({ property_id: p.id, image_url: url });
    }
  }
  if (wanted.length === 0) return json({ ok: true, checked: 0, branded: 0, pending: 0, properties: 0 });

  // אותה שורת תיוג של classify-property-images: (property_id, image_url)
  for (let i = 0; i < wanted.length; i += 500) {
    await supabase
      .from("property_image_tags")
      .upsert(wanted.slice(i, i + 500), { onConflict: "property_id,image_url", ignoreDuplicates: true });
  }

  const propIds = [...new Set(wanted.map((w) => w.property_id))];
  const { data: tags } = await supabase
    .from("property_image_tags")
    .select("id, property_id, image_url, has_branding, branding_checked_at")
    .in("property_id", propIds);
  const wantedKeys = new Set(wanted.map((w) => w.property_id + "|" + w.image_url));
  const relevant = (tags ?? []).filter((t: Row) => wantedKeys.has(t.property_id + "|" + t.image_url));
  const pending = relevant.filter((t: Row) => t.branding_checked_at == null).slice(0, SCAN_PER_CALL);

  let checked = 0;
  let failed = 0;
  const reasons = new Set<string>();
  if (pending.length && !apiKey) reasons.add("gemini_not_configured");

  if (apiKey) {
    for (let i = 0; i < pending.length; i += SCAN_CONCURRENCY) {
      await Promise.all(pending.slice(i, i + SCAN_CONCURRENCY).map(async (t: Row) => {
        const img = await fetchAsBase64(t.image_url);
        if (!img) { failed++; reasons.add("image_download_failed"); return; }
        const res = await detectBranding(apiKey, img.mime, img.data);
        // ‏null נשאר לא בדוק — ולכן מוסתר — וינוסה שוב בסריקה הבאה
        if (res.has_branding === null) { failed++; if (res.error) reasons.add(res.error); return; }
        await supabase
          .from("property_image_tags")
          .update({ has_branding: res.has_branding, branding_checked_at: new Date().toISOString() })
          .eq("id", t.id);
        t.has_branding = res.has_branding;
        t.branding_checked_at = "now";
        checked++;
      }));
    }
  }

  const branded = relevant.filter((t: Row) => t.has_branding === true).length;
  const stillPending = relevant.filter((t: Row) => t.branding_checked_at == null).length;
  return json({
    ok: failed === 0 && !(stillPending && !apiKey),
    properties: props.length,
    images: relevant.length,
    checked,
    branded,
    pending: stillPending,
    failed,
    model: BRANDING_MODEL,
    ...(reasons.size ? { reasons: [...reasons] } : {}),
  });
}

// ---------------------------------------------------------------------------
// התראה לסוכן/ת
// ---------------------------------------------------------------------------
async function notifyAgent(
  supabase: SupabaseClient,
  showcase: Row,
  title: string,
  body: string,
  coalesce: boolean,
) {
  try {
    if (coalesce) {
      const since = new Date(Date.now() - COALESCE_MINUTES * 60_000).toISOString();
      const { data: open } = await supabase
        .from("notifications")
        .select("id")
        .eq("agent_id", showcase.agent_id)
        .eq("type", "showcase_activity")
        .eq("related_showcase_id", showcase.id)
        .eq("read", false)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1);
      if (open && open.length) {
        await supabase.from("notifications").update({ title: title.slice(0, 200), body: body.slice(0, 500) }).eq("id", open[0].id);
        return;
      }
    }
    await supabase.from("notifications").insert({
      agent_id: showcase.agent_id,
      type: "showcase_activity",
      title: title.slice(0, 200),
      body: body ? body.slice(0, 500) : null,
      related_showcase_id: showcase.id,
    });
  } catch (e) {
    // התראה שנכשלה אינה מפילה את פעולת הלקוח/ה — התגובה כבר נשמרה
    console.error("showcase notify failed", (e as Error).message);
  }
}

// ---------------------------------------------------------------------------
// wa_notify - וואטסאפ ללקוח/ה על תשובה או החלטה על סיור (ה-cron, כל 5 דקות)
//
// התור יושב על client_showcases (‏wa_pending_at / wa_pending_kinds) ומתמלא
// בטריגרים במסד (‏20270209090000). כאן: הודעה אחת למיניסייט שמסכמת את כל
// מה שהצטבר, 30 דקות לפחות מהקודמת, ולא בשעות השקט.
// ---------------------------------------------------------------------------
const WA_GAP_MINUTES = 30;
const WA_BATCH = 30;

function ilHour(): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", hour: "numeric", hourCycle: "h23" }).format(new Date()));
}

async function handleWaNotify(supabase: SupabaseClient) {
  const h = ilHour();
  if (h < 8 || h >= 22) return json({ ok: true, quiet: true });

  const gapCutoff = new Date(Date.now() - WA_GAP_MINUTES * 60_000).toISOString();
  const { data: due, error } = await supabase
    .from("client_showcases")
    .select("id, token, agent_id, client_id, wa_pending_at, wa_pending_kinds, wa_last_sent_at, last_viewed_at")
    .eq("status", "active")
    .eq("wa_notify", true)
    .not("wa_pending_at", "is", null)
    .or(`wa_last_sent_at.is.null,wa_last_sent_at.lt.${gapCutoff}`)
    .order("wa_pending_at", { ascending: true })
    .limit(WA_BATCH);
  if (error) return json({ error: "db_error", detail: error.message }, 500);

  const results: Record<string, number> = {};
  for (const sc of due ?? []) {
    const status = await notifyOne(supabase, sc);
    results[status] = (results[status] ?? 0) + 1;
  }
  return json({ ok: true, processed: (due ?? []).length, results });
}

async function notifyOne(supabase: SupabaseClient, sc: Row): Promise<string> {
  const done = async (status: string, err: string | null, sent: boolean) => {
    await supabase.from("client_showcases").update({
      wa_pending_at: null,
      wa_pending_kinds: [],
      wa_last_status: status,
      wa_last_error: err ? err.slice(0, 500) : null,
      ...(sent || status === "failed" ? { wa_last_sent_at: new Date().toISOString() } : {}),
      ...(status === "opted_out" ? { wa_notify: false } : {}),
    }).eq("id", sc.id);
    return status;
  };

  // נקרא כבר: הלקוח/ה פתח/ה את העמוד אחרי שהתור התמלא
  if (sc.last_viewed_at && new Date(sc.last_viewed_at) > new Date(sc.wa_pending_at)) {
    return await done("seen", null, false);
  }

  const [{ data: client }, { data: agent }] = await Promise.all([
    supabase.from("agent_clients").select("full_name, phone").eq("id", sc.client_id).maybeSingle(),
    supabase.from("agency_members").select("display_name").eq("id", sc.agent_id).maybeSingle(),
  ]);
  const to = phoneE164(client?.phone);
  if (!to) return await done("no_phone", "אין ללקוח/ה מספר טלפון תקין בכרטיס", false);
  if (!waConfigured()) return await done("failed", "WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID לא מוגדרים", false);

  const line = await waSummary(supabase, sc, agent?.display_name || "הסוכן/ת");
  const suffix = `showcase?t=${sc.token}`;
  const name = firstName(client?.full_name);

  // ערוץ: תבנית, או טקסט חופשי רק בתוך חלון 24 השעות
  let mode: "template" | "text" | null = templateConfigured() ? "template" : null;
  if (!mode) {
    const since = new Date(Date.now() - 23 * 3600_000).toISOString();
    const { data: conv } = await supabase
      .from("whatsapp_public_conversations").select("last_message_at").eq("wa_phone", to).gte("last_message_at", since).maybeSingle();
    if (conv) mode = "text";
  }
  if (!mode) {
    return await done("no_channel",
      "WHATSAPP_SHOWCASE_TEMPLATE לא מוגדר, והלקוח/ה לא כתב/ה למספר ב-24 השעות האחרונות", false);
  }

  const body = mode === "template"
    ? line
    : `שלום ${name}, ${line}.\nלצפייה ולתשובה: https://shuknadlan.co.il/${suffix}`;
  try {
    const wamid = mode === "template"
      ? await sendShowcaseTemplate(to, name, line, suffix)
      : await sendShowcaseText(to, body);
    // כל הודעה יוצאת נרשמת ביומן - מעקב מסירה (docs/whatsapp-setup.md)
    await supabase.from("whatsapp_messages").insert({
      wa_message_id: wamid, direction: "out", wa_phone: to, msg_type: mode, body: body.slice(0, 2000),
    });
    return await done("sent", null, true);
  } catch (e) {
    const err = e as WaError;
    await supabase.from("whatsapp_messages").insert({
      direction: "out", wa_phone: to, msg_type: mode, body: body.slice(0, 2000), error: err.message.slice(0, 500),
    });
    return await done(err.code === WA_OPTED_OUT ? "opted_out" : "failed", err.message, false);
  }
}

/** שורת העדכון: מה קרה מאז ההודעה הקודמת, בשורה אחת. */
async function waSummary(supabase: SupabaseClient, sc: Row, agentName: string): Promise<string> {
  const kinds: string[] = sc.wa_pending_kinds ?? [];
  const parts: string[] = [];
  const fmt = (iso: string) => new Date(iso).toLocaleString("he-IL", {
    timeZone: "Asia/Jerusalem", weekday: "long", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit",
  });

  if (kinds.includes("meeting_confirmed") || kinds.includes("meeting_declined")) {
    const { data: meets } = await supabase
      .from("client_showcase_meetings")
      .select("starts_at, status, decided_at")
      .eq("showcase_id", sc.id)
      .in("status", ["confirmed", "declined"])
      .gte("decided_at", sc.wa_pending_at)
      .order("decided_at", { ascending: false })
      .limit(1);
    const m = meets?.[0];
    if (m?.status === "confirmed") parts.push(`${agentName} אישר/ה את הסיור ב${fmt(m.starts_at)}`);
    else if (m) parts.push(`${agentName} הציע/ה מועד אחר לסיור`);
  }
  if (kinds.includes("reply")) {
    const { count } = await supabase
      .from("client_showcase_messages")
      .select("id", { count: "exact", head: true })
      .eq("showcase_id", sc.id)
      .eq("author", "agent")
      .is("read_at", null);
    const n = count ?? 1;
    parts.push(n > 1 ? `${agentName} שלח/ה לך ${n} תשובות במיניסייט` : `${agentName} ענה/תה לך במיניסייט`);
  }
  return parts.join(" · ") || `יש עדכון מ${agentName} במיניסייט`;
}

function firstName(full: unknown): string {
  const s = typeof full === "string" ? full.trim() : "";
  return s.split(/\s+/)[0] || "הלקוח/ה";
}
