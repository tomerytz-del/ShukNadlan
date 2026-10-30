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
//      saved-search-intake), עם source של meta_ads_* ו-external_ref =
//      meta_lead_id. כך רוטציה, ניתוב, מחירים, התראות למנהל/ת ויומן
//      הניתוב עובדים בלי שורת קוד חדשה, וניסיון חוזר של אותו ליד נופל
//      על unique (source, external_ref) ולא נולד שוב.
//   4. ‏alertLead - וואטסאפ לבעל הפלטפורמה, פעם אחת (alerted_at). כישלון
//      נרשם ב-alert_error ואינו נזרק: ה-webhook חייב להמשיך לענות 200.
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

import { alertKindAllowed, decideLeadAlert, leadAlertExpired, phoneDigits, type LeadField } from "./lead-alert.ts";
import { MetaClient } from "./meta-graph.ts";
import { waCta, waTemplate, waText } from "./wa-send.ts";

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
      body: {
        property_id: form.property_id, name: c.name, phone: c.phone, message: note,
        source: "meta_ads_property_form", external_ref: lead.id,
      },
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
        rooms: rooms ?? undefined, note, source: "meta_ads_owner_form", external_ref: lead.id,
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
        // נשמר ב-leads של נכס ובעלים. חיפוש שמור מתעלם ממנו ונשאר על criteria_hash.
        external_ref: lead.id,
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

// ---------------------------------------------------------------------------
// התראת וואטסאפ לבעל הפלטפורמה. נקראת אחרי routeLead, גם כשהניתוב לא
// הסתיים (טופס לא משויך עדיין ליד). לעולם אינה זורקת.
// ---------------------------------------------------------------------------

const ALERT_KEYS = ["lead_alert_phone", "lead_alert_kinds"];

async function alertSettings(sb: any): Promise<{ phone: string; kinds: string[] | null }> {
  const { data, error } = await sb.from("ads_settings").select("key, value").in("key", ALERT_KEYS);
  if (error) throw new Error(`ads_settings: ${error.message}`);
  let phone = "";
  let kinds: string[] | null = null;
  let sawKinds = false;
  for (const row of data ?? []) {
    if (row.key === "lead_alert_phone") phone = phoneDigits(row.value);
    if (row.key === "lead_alert_kinds") {
      sawKinds = true;
      kinds = Array.isArray(row.value) ? row.value.filter((x: unknown) => typeof x === "string") : [];
    }
  }
  return { phone, kinds: sawKinds ? kinds : null };
}

/** תפיסה אטומית: רק עדכון שהעביר את alerted_at מ-null מחזיר שורה. */
async function claimAlert(sb: any, metaLeadId: string): Promise<any | null> {
  const { data, error } = await sb.from("ads_leads")
    .update({ alerted_at: new Date().toISOString() })
    .eq("meta_lead_id", metaLeadId)
    .is("alerted_at", null)
    .select("meta_lead_id, created_time, form_id, field_data");
  if (error) throw new Error(`ads_leads alert claim: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return row ?? null;
}

/** הזמן של ההודעה האחרונה מהמספר, או null (ואז נשלחת תבנית). */
async function latestMessageAt(sb: any, phone: string): Promise<string | null> {
  const { data, error } = await sb.from("whatsapp_conversations")
    .select("last_message_at")
    .in("wa_phone", [phone, `+${phone}`])
    .order("last_message_at", { ascending: false })
    .limit(1);
  // בלי חלון ידוע שולחים תבנית: טקסט חופשי מחוץ ל-24 שעות נדחה, תבנית לא.
  if (error) {
    console.warn("alertLead window", error.message);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row?.last_message_at ?? null;
}

async function writeAlertError(sb: any, metaLeadId: string, message: string): Promise<void> {
  const alert_error = message.replace(/\s+/g, " ").trim().slice(0, 500);
  try {
    const { error } = await sb.from("ads_leads").update({ alert_error }).eq("meta_lead_id", metaLeadId);
    if (error) console.error("alertLead error write", error.message);
  } catch (e) {
    console.error("alertLead error write", (e as Error).message);
  }
}

/**
 * וואטסאפ אחד על ליד חדש. בלי מספר בהגדרות - חוזר בלי לתפוס את השורה,
 * כדי שכשהמספר יוגדר הליד (אם עודו בחלון 6 השעות) יישלח. אחרי התפיסה
 * כל יציאה שקטה (ישן, סוג מסונן, מישהו אחר תפס) משאירה את alerted_at.
 */
export async function alertLead(sb: any, metaLeadId: string): Promise<void> {
  let claimed = false;
  try {
    const settings = await alertSettings(sb);
    if (!settings.phone) return;

    const row = await claimAlert(sb, metaLeadId);
    if (!row) return;
    claimed = true;
    // ליד ישן נתפס ולא נשלח. הסנכרון מושך 48 שעות; ההתראה היא רק על חדש.
    if (leadAlertExpired(row.created_time)) return;

    const { data: form, error: formErr } = await sb.from("ads_lead_forms")
      .select("form_name, kind")
      .eq("form_id", row.form_id ?? "")
      .maybeSingle();
    if (formErr) throw new Error(`ads_lead_forms: ${formErr.message}`);

    const kind = form?.kind || "unmapped";
    if (!alertKindAllowed(kind, settings.kinds)) return;
    const decision = decideLeadAlert({
      createdTime: row.created_time,
      formName: form?.form_name || row.form_id,
      kind,
      kinds: settings.kinds,
      fields: (row.field_data ?? []) as LeadField[],
      lastMessageAt: await latestMessageAt(sb, settings.phone),
    });
    if (decision.action === "skip") return;
    if (decision.action === "text") {
      if (decision.button) await waCta(settings.phone, decision.text, decision.button.label, decision.button.url);
      else await waText(settings.phone, decision.text);
    }
    else await waTemplate(settings.phone, decision.params);
  } catch (e) {
    const msg = (e as Error).message || String(e);
    console.error("alertLead", metaLeadId, msg);
    if (claimed) await writeAlertError(sb, metaLeadId, msg);
  }
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
