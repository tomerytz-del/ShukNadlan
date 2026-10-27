// ============================================================================
// כפילות ליד לפי טלפון - משותף ל-property-inquiry-intake ול-owner-lead-intake
//
// (source, external_ref) תופס רק ניסיון חוזר של אותו אירוע. אותו אדם משני
// מסלולים (טופס מטא ופייסבוק, או טופס באתר ואז מטא) הוא שתי שורות, שתי
// התראות ושתי רוטציות. כאן, לפני ה-insert: ליד פתוח מאותו טלפון מנורמל,
// אותו lead_type, ובפנייה על נכס גם אותו נכס, מ-30 הימים האחרונים.
//
// נמצא, ורק לקורא פנימי (service role): לא מכניסים שורה ולא מריצים רוטציה.
// ההודעה מצטרפת ל-raw_message, המקור הנוסף נרשם ב-source_touches, והסוכן/ת
// שכבר רואה/ה את הליד מקבל/ת התראת new_lead עם כותרת "פנייה נוספת" (בלי
// רוטציה). ליד מוסתר, בלי סוכן/ת, או שעוד לא נפתח - לא מצמידים, והקורא
// מכניס שורה חדשה. דף משרד או סוכן/ת מצמיד רק לאותו משרד ולאותו/ה סוכן/ת.
// פנייה על נכס בלי property_id (מחשבון תשואה) אינה מצמידה.
//
// מהדפדפן אין מיזוג בכלל: לא דגל duplicate, לא lead_id של ליד אחר, ולא
// כתיבה ל-raw_message של מישהו/י אחר/ת. התשובה היא insert רגיל.
//
// עמודה שטרם עלתה (הפונקציה לפני המיגרציה) - מדלגים ומכניסים כרגיל.
// אין כאן PII בלוג: לא הטלפון ולא גוף ההודעה.
// ============================================================================

export const META_ADS_SOURCES_LIST = [
  "meta_ads_owner_form",
  "meta_ads_buyer_form",
  "meta_ads_property_form",
] as const;

export type MetaAdsSource = typeof META_ADS_SOURCES_LIST[number];
export const META_ADS_SOURCES: ReadonlySet<string> = new Set(META_ADS_SOURCES_LIST);

/** תווית לסוכן/ת, אותה מפה כמו ב-assets/crm.js. null למקור שאינו טופס מטא. */
export const META_ADS_SOURCE_LABELS: Readonly<Record<MetaAdsSource, string>> = {
  meta_ads_owner_form: "טופס לידים במטא · מוכר/ת",
  meta_ads_buyer_form: "טופס לידים במטא · מחפש/ת",
  meta_ads_property_form: "טופס לידים במטא · פנייה על נכס",
};

export function metaAdsSourceLabel(source: string | null | undefined): string | null {
  return source && META_ADS_SOURCES.has(source) ? META_ADS_SOURCE_LABELS[source as MetaAdsSource] : null;
}

/** 30 יום - אותו חלון של שיחה שמצטרפת לליד פתוח (agent_call_to_lead). */
export const OPEN_LEAD_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** הסטטוסים החיים של leads. אין status של closed/lost; הסגירה היא ארכיון ושלב. */
const OPEN_STATUSES = new Set(["masked", "unlocked", "pending_charge"]);

/** lead_work: not_relevant = לא רלוונטי / לא ענה, won = נסגר בהצלחה. */
const CLOSED_STAGES = new Set(["not_relevant", "won"]);

export type OpenLeadRow = {
  id: string;
  agent_id: string | null;
  agency_id?: string | null;
  created_at: string;
  status?: string | null;
  raw_message?: string | null;
  source_touches?: unknown;
  city?: string | null;
  property_type?: string | null;
  deal_type?: string | null;
};

/** הסוכן/ת כבר רואה/ה את הליד: משויך/ת, ו-status פתוח. מוסתר וממתין לחיוב אינם. */
export function leadIsVisible(row: OpenLeadRow): boolean {
  return row.status === "unlocked" && !!row.agent_id;
}

/** שני לידים פתוחים ממשרדים או מסוכנים שונים - לא בוחרים מנצח. */
export function sameDesk(rows: OpenLeadRow[]): boolean {
  if (rows.length === 0) return false;
  const agency = rows[0].agency_id ?? null;
  const agent = rows[0].agent_id ?? null;
  return rows.every((r) => (r.agency_id ?? null) === agency && (r.agent_id ?? null) === agent);
}

/** כותרת קלה יותר מ"ליד חדש". הקישור הוא related_lead_id, כמו בהתראה הרגילה. */
export function repeatNotice(row: OpenLeadRow): { title: string; body: string } {
  const deal = row.deal_type === "sale" ? "מכירה" : row.deal_type === "rent" ? "השכרה" : "";
  const body = [row.city, row.property_type, deal, "פתוח"].filter(Boolean).join(" · ").slice(0, 300);
  return { title: "פנייה נוספת על ליד קיים", body: body || "פתוח" };
}

export type LeadWorkStage = { lead_id: string; agent_id: string; stage: string };

/**
 * הליד הכי חדש שעדיין פתוח.
 * סגור: בארכיון, status שאינו מהשלושה החיים, או שלב סופי של הסוכן/ת
 * שהליד משויך אליו/ה. שלב סופי של סוכן/ת אחר/ת (הפנייה) אינו סוגר את
 * הליד אצל מי שמופיע/ה ב-agent_id. ליד בלי סוכן/ת נסגר אם יש לו שלב סופי.
 */
export function pickOpenLead(
  rows: OpenLeadRow[],
  archivedLeadIds: Iterable<string>,
  work: LeadWorkStage[],
): OpenLeadRow | null {
  const archived = new Set(archivedLeadIds);
  const open = rows.filter((row) => {
    if (!row?.id || archived.has(row.id)) return false;
    if (row.status && !OPEN_STATUSES.has(row.status)) return false;
    const closed = work.filter((w) => w.lead_id === row.id && CLOSED_STAGES.has(w.stage));
    if (closed.length === 0) return true;
    if (!row.agent_id) return false;
    return !closed.some((w) => w.agent_id === row.agent_id);
  });
  open.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return open[0] ?? null;
}

/** שורה שמצטרפת ל-raw_message. אותה שורה פעמיים אינה מוכפלת. */
export function appendLeadNote(
  existing: string | null | undefined,
  label: string | null | undefined,
  message: string | null | undefined,
): string {
  const head = label ? `פנייה נוספת (${label})` : "פנייה נוספת";
  const msg = typeof message === "string" ? message.replace(/\s+/g, " ").trim() : "";
  const line = (msg ? `${head}: ${msg}` : head).slice(0, 1500);
  const base = (existing || "").trim();
  if (!base) return line.slice(0, 4000);
  if (base.includes(line)) return base.slice(0, 4000);
  return `${base}\n${line}`.slice(0, 4000);
}

export function touchSeen(touches: unknown, source: string | null, externalRef: string | null): boolean {
  if (!source || !externalRef || !Array.isArray(touches)) return false;
  return touches.some((t) =>
    !!t && typeof t === "object" &&
    (t as { source?: unknown }).source === source &&
    (t as { external_ref?: unknown }).external_ref === externalRef
  );
}

export function pushTouch(
  touches: unknown,
  touch: { source: string | null; external_ref: string | null; at: string },
): { source: string | null; external_ref: string | null; at: string }[] {
  const prev = Array.isArray(touches)
    ? touches.filter((t) => !!t && typeof t === "object" && typeof (t as { at?: unknown }).at === "string")
      .slice(-19) as { source: string | null; external_ref: string | null; at: string }[]
    : [];
  return [...prev, touch];
}

export type AttachInput = {
  phone: string;
  leadType: string;
  /** true בפנייה על נכס: רק אותו property_id, ו-null רק מול לידים בלי נכס. */
  matchProperty: boolean;
  propertyId?: string | null;
  source: string | null;
  externalRef: string | null;
  message: string | null;
  sourceLabel: string | null;
  /** false לדפדפן. בלי זה הפונקציה מחזירה null והקורא מכניס ליד חדש. */
  internal: boolean;
  /** דף משרד, דף סוכן/ת, או הנכס עצמו. בלי ערך אין סינון - ואז sameDesk שומר. */
  agencyId?: string | null;
  agentId?: string | null;
};

type QueryError = { code?: string; message?: string } | null;
type QueryResult = { data: any; error: QueryError };

/**
 * מצמיד פנייה לליד פתוח, או null כשאין התאמה / אי אפשר לבדוק.
 * null = הקורא ממשיך ל-insert הרגיל.
 */
export async function attachToOpenLead(
  // ‏rpc של supabase-js מחזיר PostgrestFilterBuilder (אז-able), לא Promise.
  sb: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<QueryResult>; from: (table: string) => any },
  input: AttachInput,
): Promise<{ lead_id: string } | null> {
  // הדפדפן אינו לומד אם יש ליד פתוח, ואינו כותב לליד של מישהו אחר.
  if (!input.internal) return null;
  // מחשבון תשואה: property_inquiry בלי נכס. is(null) היה מצמיד כל משרד לכל משרד.
  if (input.matchProperty && !input.propertyId) return null;
  // דף עם משרד ובלי סוכן/ת: אין שולחן להצמיד אליו, ולא בוחרים סוכן/ת אחר/ת.
  if (input.agencyId && !input.agentId) return null;

  const digits = String(input.phone || "").replace(/\D/g, "");
  if (digits.length < 9) return null;

  let e164 = "";
  try {
    const norm = await sb.rpc("normalize_msisdn", { p_phone: input.phone });
    if (norm.error || typeof norm.data !== "string" || !norm.data) return null;
    e164 = norm.data;
  } catch {
    console.warn("lead phone dedupe skipped", "normalize");
    return null;
  }
  if (!e164) return null;

  const since = new Date(Date.now() - OPEN_LEAD_WINDOW_MS).toISOString();
  let query = sb.from("leads")
    .select("id, agent_id, agency_id, status, created_at, raw_message, source_touches, city, property_type, deal_type")
    .eq("phone_e164", e164)
    .eq("lead_type", input.leadType)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(8);
  if (input.matchProperty) query = query.eq("property_id", input.propertyId);
  // דף משרד, דף סוכן/ת, או נכס: רק אותו שולחן. לא מצמידים ליד של משרד א' למשרד ב'.
  if (input.agencyId) query = query.eq("agency_id", input.agencyId);
  if (input.agentId) query = query.eq("agent_id", input.agentId);

  let rows: OpenLeadRow[] = [];
  try {
    const found = await query;
    if (found.error) {
      console.warn("lead phone dedupe skipped", found.error.code || "query");
      return null;
    }
    rows = Array.isArray(found.data) ? found.data : [];
  } catch {
    console.warn("lead phone dedupe skipped", "query");
    return null;
  }
  if (rows.length === 0) return null;

  const ids = rows.map((r) => r.id).filter(Boolean);
  let archived: { lead_id: string }[] = [];
  let work: LeadWorkStage[] = [];
  try {
    const arch = await sb.from("lead_archives").select("lead_id").in("lead_id", ids);
    const stages = await sb.from("lead_work").select("lead_id, agent_id, stage").in("lead_id", ids);
    if (arch.error || stages.error) {
      console.warn("lead phone dedupe skipped", arch.error?.code || stages.error?.code || "open-check");
      return null;
    }
    archived = Array.isArray(arch.data) ? arch.data : [];
    work = Array.isArray(stages.data) ? stages.data : [];
  } catch {
    console.warn("lead phone dedupe skipped", "open-check");
    return null;
  }

  // מוסתר, בלי סוכן/ת, או pending_charge - הסוכן/ת לא רואה/ה, אז לא בולעים את הפנייה.
  const visible = rows.filter(leadIsVisible);
  if (!sameDesk(visible)) return null;
  const chosen = pickOpenLead(visible, archived.map((a) => a.lead_id), work);
  if (!chosen?.agent_id) return null;

  if (touchSeen(chosen.source_touches, input.source, input.externalRef)) {
    return { lead_id: chosen.id };
  }

  // קודם התראה. כישלון - הקורא מכניס ליד חדש, והטריגר על insert מודיע.
  // אין רוטציה: לא נגענו ב-lead_distribution_rotation.
  const notice = repeatNotice(chosen);
  try {
    const note = await sb.from("notifications").insert({
      agent_id: chosen.agent_id,
      type: "new_lead",
      title: notice.title,
      body: notice.body,
      related_lead_id: chosen.id,
    });
    if (note.error) {
      console.warn("lead phone dedupe notify skipped", note.error.code || "notify");
      return null;
    }
  } catch {
    console.warn("lead phone dedupe notify skipped", "notify");
    return null;
  }

  const raw_message = appendLeadNote(chosen.raw_message, input.sourceLabel, input.message);
  const source_touches = pushTouch(chosen.source_touches, {
    source: input.source,
    external_ref: input.externalRef,
    at: new Date().toISOString(),
  });
  try {
    const upd = await sb.from("leads").update({ raw_message, source_touches }).eq("id", chosen.id);
    if (upd.error) console.warn("lead phone dedupe note skipped", upd.error.code || "update");
  } catch {
    console.warn("lead phone dedupe note skipped", "update");
  }
  return { lead_id: chosen.id };
}
