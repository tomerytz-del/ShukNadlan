// ============================================================================
// כפילות ליד לפי טלפון - משותף ל-property-inquiry-intake ול-owner-lead-intake
//
// (source, external_ref) תופס רק ניסיון חוזר של אותו אירוע. אותו אדם משני
// מסלולים (טופס מטא ופייסבוק, או טופס באתר ואז מטא) הוא שתי שורות, שתי
// התראות ושתי רוטציות. כאן, לפני ה-insert: ליד פתוח מאותו טלפון מנורמל,
// אותו lead_type, ובפנייה על נכס גם אותו נכס, מ-30 הימים האחרונים.
//
// נמצא - לא מכניסים שורה, לא מריצים רוטציה ולא קוראים ל-logLeadRouting
// (הטריגר notify_agent_on_new_lead רץ על insert בלבד). ההודעה מצטרפת
// ל-raw_message, והמקור הנוסף נרשם ב-source_touches.
//
// עמודה שטרם עלתה (האתר/הפונקציה לפני המיגרציה) - מדלגים ומכניסים כרגיל.
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
  created_at: string;
  status?: string | null;
  raw_message?: string | null;
  source_touches?: unknown;
};

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
    .select("id, agent_id, status, created_at, raw_message, source_touches")
    .eq("phone_e164", e164)
    .eq("lead_type", input.leadType)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(8);
  if (input.matchProperty) {
    query = input.propertyId ? query.eq("property_id", input.propertyId) : query.is("property_id", null);
  }

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

  const chosen = pickOpenLead(rows, archived.map((a) => a.lead_id), work);
  if (!chosen) return null;

  if (touchSeen(chosen.source_touches, input.source, input.externalRef)) {
    return { lead_id: chosen.id };
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
