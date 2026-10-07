// ============================================================================
// ליד מטופס מיידי של מטא → ליד בפלטפורמה (docs/marketing-console.md, שלב 4)
//
// משותף ל-ads-leads-webhook (בזמן אמת) ול-ads-admin (‏sync_leads, רשת
// ביטחון שעתית). שניהם עושים אותו דבר:
//
//   1. upsert ל-ads_leads לפי meta_lead_id - ה-webhook והסנכרון אינם מכפילים
//   2. ‏ads_lead_claim - רק קורא אחד שולח
//   3. לפי ads_lead_forms.kind: קריאה ל-Edge Function **הקיימת** של אותו
//      מסלול באתר (property-inquiry-intake / owner-lead-intake /
//      saved-search-intake), עם source של meta_ads_*. כך רוטציה, ניתוב,
//      מחירים, התראות למנהל/ת ויומן הניתוב עובדים בלי שורת קוד חדשה.
//
// ‏**למה HTTP ולא insert ישיר.** אין RPC אחד שיוצר ליד - כל פונקציית קליטה
// מכילה לוגיקה משלה (רוטציה, שיוך לשכונה, יומן ניתוב, התראה כשאין נמען).
// insert ישיר היה יוצר מסלול רביעי שמתיישן לחוד, וליד ממטא היה מקבל טיפול
// אחר מליד מהאתר בלי שאיש החליט על כך.
//
// ‏**הסכמה לפנייה (מחפשים).** ‏saved-search-intake מקבל consent_agent_contact
// רק כ-true מפורש. כאן הוא true רק אם בטופס יש שאלה ממופה ל-consent ונענתה
// בחיוב. טופס בלי שאלה כזו שולח false, והליד נשמר על המדף - כמו באתר.
// ============================================================================

import { MetaClient } from "./meta-graph.ts";

export type LeadForm = {
  form_id: string;
  form_name?: string | null;
  kind: "property" | "owner" | "buyer" | "broker" | "ignore";
  property_id?: string | null;
  deal_type?: string | null;
  default_city?: string | null;
  default_property_type?: string | null;
  field_map?: Record<string, string> | null;
};

export type MetaLead = {
  id: string;
  created_time: string;
  form_id?: string;
  ad_id?: string;
  adset_id?: string;
  campaign_id?: string;
  field_data?: { name: string; values?: string[] }[];
};

export const LEAD_FIELDS = "id,created_time,form_id,ad_id,adset_id,campaign_id,field_data";

// שמות השדות המובנים של מטא, ואז מילים שמופיעות בשאלות מותאמות בעברית.
const AUTO: Record<string, RegExp> = {
  city: /^(city|עיר|יישוב|ישוב)$|עיר|יישוב|ישוב|city/i,
  property_type: /property_type|סוג.?נכס|סוג.?הנכס/i,
  budget: /budget|תקציב|מחיר/i,
  rooms: /rooms|חדרים/i,
  consent: /consent|הסכמה|מאשר|מאשרת|יצירת.?קשר/i,
  note: /note|message|הערות|הודעה/i,
};

export function fieldValue(lead: MetaLead, name: string | undefined | null): string {
  if (!name) return "";
  const f = (lead.field_data ?? []).find((x) => x.name === name);
  return String(f?.values?.[0] ?? "").trim();
}

/** המיפוי הסופי לשדה: מה שנשמר ב-field_map, ואם אין - זיהוי לפי שם השדה. */
export function resolveField(lead: MetaLead, form: LeadForm, key: string): string {
  const mapped = form.field_map?.[key];
  if (mapped) return fieldValue(lead, mapped);
  const re = AUTO[key];
  if (!re) return "";
  const hit = (lead.field_data ?? []).find((f) => re.test(f.name));
  return String(hit?.values?.[0] ?? "").trim();
}

export function contact(lead: MetaLead) {
  const full = fieldValue(lead, "full_name") ||
    [fieldValue(lead, "first_name"), fieldValue(lead, "last_name")].filter(Boolean).join(" ");
  return {
    name: full || "ליד ממטא",
    phone: fieldValue(lead, "phone_number") || fieldValue(lead, "phone"),
    email: fieldValue(lead, "email"),
  };
}

const YES = /^(yes|true|1|כן|מאשר|מאשרת|מסכים|מסכימה)/i;

function num(s: string): number | null {
  const n = Number(String(s).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** גוף הבקשה לפונקציית הקליטה של המסלול, או סיבה למה אי אפשר. */
export function intakeRequest(lead: MetaLead, form: LeadForm):
  { fn: string; body: Record<string, unknown> } | { error: string } {
  const c = contact(lead);
  if (!c.phone && form.kind !== "buyer") return { error: "missing_phone" };
  const note = [resolveField(lead, form, "note"), `ליד מטופס מטא: ${form.form_name || form.form_id}`]
    .filter(Boolean).join(" · ");

  if (form.kind === "property") {
    if (!form.property_id) return { error: "form_missing_property" };
    return {
      fn: "property-inquiry-intake",
      body: { property_id: form.property_id, name: c.name, phone: c.phone, message: note, source: "meta_ads_property_form" },
    };
  }

  if (form.kind === "owner") {
    const city = resolveField(lead, form, "city") || form.default_city || "";
    const propertyType = resolveField(lead, form, "property_type") || form.default_property_type || "";
    const deal = form.deal_type || "sale";
    if (!city) return { error: "missing_city" };
    if (!propertyType) return { error: "missing_property_type" };
    const rooms = num(resolveField(lead, form, "rooms"));
    return {
      fn: "owner-lead-intake",
      body: {
        city, property_type: propertyType, deal_type: deal, name: c.name, phone: c.phone,
        rooms: rooms ?? undefined, note, source: "meta_ads_owner_form",
      },
    };
  }

  if (form.kind === "buyer") {
    if (!c.phone && !c.email) return { error: "missing_contact" };
    const city = resolveField(lead, form, "city") || form.default_city || "";
    const budget = num(resolveField(lead, form, "budget"));
    const rooms = num(resolveField(lead, form, "rooms"));
    if (!city && !budget && !rooms) return { error: "missing_search_criteria" };
    const consentAnswer = resolveField(lead, form, "consent");
    return {
      fn: "saved-search-intake",
      body: {
        full_name: c.name.slice(0, 80),
        phone: c.phone || undefined,
        email: c.email || undefined,
        contact_channel: c.phone && c.email ? "both" : c.phone ? "whatsapp" : "email",
        deal_type: form.deal_type || "sale",
        category: "residential",
        cities: city ? [city] : undefined,
        max_price: budget ?? undefined,
        min_rooms: rooms ?? undefined,
        free_text: note,
        consent_agent_contact: YES.test(consentAnswer),
        source: "meta_ads_buyer_form",
      },
    };
  }

  return { error: `kind_${form.kind}` };
}

/** שמירת הליד ב-ads_leads. לא דורס ליד שכבר נשלח. */
export async function storeLead(sb: any, lead: MetaLead, via: "sync" | "webhook") {
  const row = {
    meta_lead_id: lead.id,
    created_time: lead.created_time,
    form_id: lead.form_id ?? null,
    ad_id: lead.ad_id ?? null,
    adset_id: lead.adset_id ?? null,
    campaign_id: lead.campaign_id ?? null,
    field_data: lead.field_data ?? [],
    received_via: via,
  };
  // ‏ignoreDuplicates: ליד שכבר קיים (וייתכן שכבר נשלח) אינו נכתב מחדש.
  const { error } = await sb.from("ads_leads").upsert(row, { onConflict: "meta_lead_id", ignoreDuplicates: true });
  if (error) throw new Error(`ads_leads: ${error.message}`);
}

/** שליחת ליד אחד למסלול שלו. מחזירה את המצב שנקבע. */
export async function routeLead(
  sb: any,
  opts: { supabaseUrl: string; serviceRoleKey: string },
  metaLeadId: string,
): Promise<{ status: string; error?: string }> {
  const { data: row, error } = await sb.from("ads_leads")
    .select("meta_lead_id, created_time, form_id, ad_id, adset_id, campaign_id, field_data, status")
    .eq("meta_lead_id", metaLeadId).maybeSingle();
  if (error || !row) return { status: "missing", error: error?.message };
  if (row.status === "routed" || row.status === "broker" || row.status === "skipped") return { status: row.status };

  const { data: form } = await sb.from("ads_lead_forms").select("*").eq("form_id", row.form_id ?? "").maybeSingle();
  if (!form) return { status: "new" }; // טופס שעוד לא שויך - ממתין

  if (form.kind === "broker" || form.kind === "ignore") {
    const status = form.kind === "broker" ? "broker" : "skipped";
    await sb.from("ads_leads").update({ kind: form.kind, status, routed_at: new Date().toISOString(), error: null })
      .eq("meta_lead_id", metaLeadId);
    return { status };
  }

  const { data: claimed } = await sb.rpc("ads_lead_claim", { p_meta_lead_id: metaLeadId });
  if (claimed !== true) return { status: row.status };

  const lead: MetaLead = { id: row.meta_lead_id, created_time: row.created_time, form_id: row.form_id, field_data: row.field_data };
  const req = intakeRequest(lead, form as LeadForm);
  if ("error" in req) {
    await sb.from("ads_leads").update({ kind: form.kind, status: "failed", error: req.error }).eq("meta_lead_id", metaLeadId);
    return { status: "failed", error: req.error };
  }

  let res: Response;
  let body: any = {};
  try {
    res = await fetch(`${opts.supabaseUrl}/functions/v1/${req.fn}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.serviceRoleKey}` },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(30_000),
    });
    body = await res.json().catch(() => ({}));
  } catch (e) {
    const msg = `network: ${(e as Error).message}`;
    await sb.from("ads_leads").update({ kind: form.kind, status: "failed", error: msg }).eq("meta_lead_id", metaLeadId);
    return { status: "failed", error: msg };
  }

  // ‏duplicate של חיפוש שמור (אותו טלפון ואותם קריטריונים) הוא הצלחה: הפונה
  // כבר במערכת, ואין טעם לנסות שוב.
  const ok = res.ok && (body?.success === true || body?.duplicate === true);
  if (!ok) {
    const msg = `${req.fn} ${res.status}: ${String(body?.error ?? "").slice(0, 120)}`;
    await sb.from("ads_leads").update({ kind: form.kind, status: "failed", error: msg }).eq("meta_lead_id", metaLeadId);
    return { status: "failed", error: msg };
  }
  await sb.from("ads_leads").update({
    kind: form.kind,
    status: "routed",
    routed_at: new Date().toISOString(),
    lead_id: body.lead_id ?? null,
    target: { fn: req.fn, lead_id: body.lead_id ?? null, search_id: body.search_id ?? null, match_type: body.match_type ?? null, duplicate: body.duplicate ?? false },
    error: null,
  }).eq("meta_lead_id", metaLeadId);
  return { status: "routed" };
}

/** ‏Page token: לטפסים וללידים צריך טוקן של הדף, לא של המשתמש. נגזר מטוקן
 *  ה-System User כשיש לו תפקיד על הדף, ואחרת הטוקן הקיים של הפרסום. */
export async function pageToken(adsToken: string, pageId: string, fallback: string): Promise<string> {
  if (adsToken && pageId) {
    try {
      const r = await new MetaClient(adsToken).get(pageId, { fields: "access_token" });
      if (r?.access_token) return String(r.access_token);
    } catch { /* נופל לטוקן הקיים */ }
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// ה-webhook: חתימת מטא ושליפת מזהי הלידים מהגוף.
// ---------------------------------------------------------------------------
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signatureValid(raw: string, header: string | null, secret: string): Promise<boolean> {
  if (!header || !secret) return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!m) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual(hex, m[1].toLowerCase());
}

export function leadgenIds(payload: any): string[] {
  const out: string[] = [];
  for (const entry of payload?.entry ?? []) {
    for (const ch of entry?.changes ?? []) {
      if (ch?.field === "leadgen" && ch?.value?.leadgen_id) out.push(String(ch.value.leadgen_id));
    }
  }
  return [...new Set(out)];
}
