import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { SOCIAL_SOURCES } from "../_shared/lead-routing.ts";

// ============================================================================
// social-lead-intake — ליד מגבריאלה בפייסבוק ובאינסטגרם (Zernio), שרת-לשרת
//
// גבריאלה עונה לפניות ברשתות ושולחת לכאן כל ליד. מכאן הוא עובר לפונקציית
// הקליטה **הקיימת** של אותו מסלול באתר - בדיוק כמו ליד מטופס של מטא
// (‏_shared/meta-leads.ts), ומאותה סיבה: רוטציה, ניתוב, מחירים, התראות ויומן
// הניתוב (‏lead_routing_log) עובדים בלי מסלול רביעי שמתיישן לחוד.
//
//   ‏property  → property-inquiry-intake  (נכס לא פעיל / לא נמצא → saved-search-intake)
//   ‏buyer     → saved-search-intake      (‏lead_only, אלא אם subscribe_alerts)
//   ‏owner     → owner-lead-intake
//   ‏mortgage  → mortgage-lead-intake
//
// ‏**האימות** - סוד משותף ב-header ‏x-social-lead-secret (או Authorization:
// Bearer), מול SOCIAL_LEAD_SECRET. ‏fail-closed: בלי הסוד כל בקשה נדחית ב-503.
// רק מכאן אפשר לסמן מקור חברתי - פונקציות הקליטה מקבלות אותו רק מקורא
// פנימי (‏isInternalCaller), וזה הקורא.
//
// ‏**אידמפוטנטיות** - ‏social_leads לפי zernio_id: שליחה חוזרת של אותה פנייה
// מחזירה את מה שכבר נוצר, ו-social_lead_claim נותנת אותה לקורא אחד.
// ‏external_ref = zernio_id עובר גם לליד עצמו, כשכבת הגנה שנייה במסד.
//
// ‏verify_jwt = false: ‏Zernio אינו מחזיק JWT של Supabase. ‏docs/social-leads.md.
// ============================================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SECRET = Deno.env.get("SOCIAL_LEAD_SECRET") || "";

const KINDS = ["property", "buyer", "owner", "mortgage"] as const;
type Kind = typeof KINDS[number];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF_RE = /^[A-Za-z0-9._:/-]{1,128}$/;
const NAME_FALLBACK: Record<string, string> = {
  facebook_dm: "פונה מפייסבוק",
  facebook_comment: "פונה מפייסבוק",
  instagram_dm: "פונה מאינסטגרם",
  instagram_comment: "פונה מאינסטגרם",
};

function timingSafeEqual(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}
function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

type Intake = { fn: string; body: Record<string, unknown>; fallback?: string };
type Prop = {
  id: string; status: string; city: string | null; deal_type: string | null;
  property_type: string | null; rooms: number | null; neighborhood_id: string | null;
};

/** חיפוש שמור מהפנייה - המסלול של מחפש/ת, וגם הנפילה של נכס שירד מהאוויר. */
function buyerIntake(p: any, base: Record<string, unknown>, prop: Prop | null, consent: boolean): Intake | { error: string } {
  const city = str(p.city, 60) || prop?.city || "";
  const deal = ["sale", "rent"].includes(p.deal_type) ? p.deal_type : (prop?.deal_type || "sale");
  const types = str(p.property_type, 40) || prop?.property_type || "";
  const rooms = num(p.rooms) ?? (prop?.rooms ?? undefined);
  const body: Record<string, unknown> = {
    full_name: base.name,
    phone: base.phone || undefined,
    email: base.email || undefined,
    contact_channel: base.phone && base.email ? "both" : base.phone ? "whatsapp" : "email",
    deal_type: deal,
    category: "residential",
    cities: city ? [city] : undefined,
    neighborhood_ids: UUID_RE.test(String(p.neighborhood_id || "")) ? [p.neighborhood_id]
      : prop?.neighborhood_id ? [prop.neighborhood_id] : undefined,
    property_types: types ? [types] : undefined,
    min_rooms: num(p.min_rooms) ?? rooms,
    max_rooms: num(p.max_rooms) ?? (rooms !== undefined ? rooms + 0.5 : undefined),
    min_price: num(p.min_price),
    max_price: num(p.max_price),
    free_text: base.message || undefined,
    consent_agent_contact: consent,
    // ‏lead_only: ליד בלי מנוי להתראות, אלא אם הפונה ביקש/ה עדכונים במפורש
    lead_only: p.subscribe_alerts !== true,
    source: base.source,
  };
  if (!body.phone && !body.email) return { error: "missing_contact" };
  if (!city && !body.max_price && !body.min_rooms && !types) return { error: "missing_search_criteria" };
  if (body.lead_only && !consent) return { error: "missing_consent" };
  return { fn: "saved-search-intake", body };
}

async function buildIntake(sb: any, p: any, kind: Kind, source: string, ref: string): Promise<Intake | { error: string }> {
  const base = {
    name: str(p.name, 80).length >= 2 ? str(p.name, 80) : NAME_FALLBACK[source],
    phone: str(p.phone, 30),
    email: str(p.email, 254).toLowerCase(),
    message: str(p.message, 1500),
    source,
  };
  if (kind !== "buyer" && base.phone.replace(/\D/g, "").length < 9) return { error: "missing_phone" };

  if (kind === "property") {
    let prop: Prop | null = null;
    const cols = "id, status, city, deal_type, property_type, rooms, neighborhood_id";
    if (UUID_RE.test(String(p.property_id || ""))) {
      const { data, error } = await sb.from("properties").select(cols).eq("id", p.property_id).maybeSingle();
      if (error) return { error: `db_error: ${error.message}` };
      prop = data;
    } else if (num(p.listing_number)) {
      const { data, error } = await sb.from("properties").select(cols)
        .eq("listing_number", Math.round(num(p.listing_number)!)).maybeSingle();
      if (error) return { error: `db_error: ${error.message}` };
      prop = data;
    }
    if (prop && prop.status === "active") {
      return {
        fn: "property-inquiry-intake",
        body: { property_id: prop.id, name: base.name, phone: base.phone, message: base.message || null, source, external_ref: ref },
      };
    }
    // הנכס ירד מהאוויר או לא זוהה: הפונה עדיין מחפש/ת נכס כזה. פנייה על נכס
    // היא בקשה שמתווך/ת יחזור/תחזור - כמו בטופס בדף הנכס - ולכן ההסכמה כאן
    // נלקחת מהפנייה עצמה, אלא אם גבריאלה שלחה false מפורש.
    const consent = p.consent_agent_contact !== false;
    const r = buyerIntake(p, base, prop, consent);
    return "error" in r ? r : { ...r, fallback: prop ? "property_not_active" : "property_not_found" };
  }

  if (kind === "buyer") return buyerIntake(p, base, null, p.consent_agent_contact === true);

  if (kind === "owner") {
    const city = str(p.city, 60);
    const type = str(p.property_type, 40);
    if (!city) return { error: "missing_city" };
    if (!type) return { error: "missing_property_type" };
    return {
      fn: "owner-lead-intake",
      body: {
        city, property_type: type, deal_type: p.deal_type === "rent" ? "rent" : "sale",
        neighborhood_id: UUID_RE.test(String(p.neighborhood_id || "")) ? p.neighborhood_id : undefined,
        rooms: num(p.rooms), name: base.name, phone: base.phone,
        note: base.message ? base.message.slice(0, 180) : undefined,
        source, external_ref: ref,
      },
    };
  }

  // mortgage
  return {
    fn: "mortgage-lead-intake",
    body: {
      full_name: base.name, phone: base.phone, email: base.email || undefined,
      property_price: num(p.property_price), equity: num(p.equity),
      owns_property: p.owns_property === true, source,
    },
  };
}

async function callIntake(req: Intake): Promise<{ ok: boolean; status: number; body: any }> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${req.fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    body: JSON.stringify(req.body),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok && (body?.success === true || body?.duplicate === true), status: res.status, body };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!SECRET) {
    console.error("social-lead-intake: SOCIAL_LEAD_SECRET אינו מוגדר - כל בקשה נדחית");
    return json({ error: "not_configured" }, 503);
  }
  const given = req.headers.get("x-social-lead-secret") ||
    (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!timingSafeEqual(given, SECRET)) return json({ error: "unauthorized" }, 401);

  const raw = await req.text();
  if (raw.length > 20_000) return json({ error: "payload_too_large" }, 413);
  let p: any;
  try {
    p = JSON.parse(raw);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const ref = String(p?.zernio_id ?? "");
  const source = String(p?.channel ?? "");
  const kind = String(p?.kind ?? "") as Kind;
  if (!REF_RE.test(ref)) return json({ error: "invalid_zernio_id" }, 400);
  if (!SOCIAL_SOURCES.has(source)) return json({ error: "invalid_channel", allowed: [...SOCIAL_SOURCES] }, 400);
  if (!KINDS.includes(kind)) return json({ error: "invalid_kind", allowed: KINDS }, 400);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // 1. השורה נשמרת קודם. קיימת = שליחה חוזרת.
  const { error: insErr } = await sb.from("social_leads")
    .upsert({ zernio_id: ref, channel: source, kind, payload: p }, { onConflict: "zernio_id", ignoreDuplicates: true });
  if (insErr) return json({ error: "db_error", detail: insErr.message }, 500);

  const { data: row } = await sb.from("social_leads").select("status, target, lead_id").eq("zernio_id", ref).maybeSingle();
  if (row?.status === "routed") {
    return json({ success: true, duplicate: true, status: "routed", lead_id: row.lead_id, ...(row.target ?? {}) });
  }

  // 2. קורא אחד בלבד
  const { data: claimed } = await sb.rpc("social_lead_claim", { p_zernio_id: ref });
  if (claimed !== true) return json({ success: false, status: row?.status ?? "unknown", note: "הפנייה כבר בטיפול או נכשלה 5 פעמים" }, 409);

  // ניסיון חוזר אחרי כישלון מגיע עם הגוף החדש - הוא זה שנשמר
  await sb.from("social_leads").update({ payload: p, channel: source, kind }).eq("zernio_id", ref);

  const fail = async (error: string, http = 422) => {
    await sb.from("social_leads").update({ status: "failed", error: error.slice(0, 300) }).eq("zernio_id", ref);
    return json({ success: false, error }, http);
  };

  // 3. המסלול
  const intake = await buildIntake(sb, p, kind, source, ref);
  if ("error" in intake) return await fail(intake.error, intake.error.startsWith("db_error") ? 500 : 422);

  let r: { ok: boolean; status: number; body: any };
  try {
    r = await callIntake(intake);
  } catch (e) {
    return await fail(`network: ${(e as Error).message}`, 502);
  }
  if (!r.ok) return await fail(`${intake.fn} ${r.status}: ${String(r.body?.error ?? "").slice(0, 120)}`, 502);

  const target = {
    fn: intake.fn,
    fallback: intake.fallback ?? null,
    search_id: r.body?.search_id ?? null,
    match_type: r.body?.match_type ?? null,
    intake_duplicate: r.body?.duplicate === true,
  };
  const leadId = UUID_RE.test(String(r.body?.lead_id ?? "")) ? r.body.lead_id : null;
  await sb.from("social_leads").update({
    status: "routed", routed_at: new Date().toISOString(), target, lead_id: leadId, error: null,
  }).eq("zernio_id", ref);

  return json({ success: true, status: "routed", lead_id: leadId, ...target });
});
