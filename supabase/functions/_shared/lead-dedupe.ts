// ============================================================================
// כפילות ליד לפי טלפון - משותף ל-property-inquiry-intake ול-owner-lead-intake
//
// (source, external_ref) תופס רק ניסיון חוזר של אותו אירוע. אותו אדם משני
// מסלולים (טופס מטא ופייסבוק, או טופס באתר ואז מטא) הוא שתי שורות, שתי
// התראות ושתי רוטציות. כאן, לפני ה-insert: ליד פתוח מאותו טלפון מנורמל,
// אותו lead_type, ובפנייה על נכס גם אותו נכס, מ-30 הימים האחרונים.
//
// נמצא, ורק לקורא פנימי (service role): לא מכניסים שורה ולא מריצים רוטציה.
// lead_phone_touch מוסיף את ההודעה ל-raw_message ואת המקור ל-source_touches
// ב-update אחד. רק אם העדכון הצליח, והליד לא קיבל new_lead ב-24 השעות
// האחרונות, הסוכן/ת שכבר רואה/ה את הליד מקבל/ת התראת new_lead עם כותרת
// "פנייה נוספת" (בלי רוטציה). כישלון העדכון מחזיר null והקורא מכניס שורה
// חדשה. כישלון ההתראה, או כשל בבדיקת החלון, אחרי עדכון שהצליח אינו פותח
// ליד שני. ליד מוסתר, בלי סוכן/ת, או שעוד לא נפתח - לא מצמידים.
//
// שולחן: כשיש agency_id ו-agent_id בפנייה, שניהם חייבים להתאים. פניית
// פלטפורמה (מטא או רשת, בלי שניהם) אינה מתמזגת לפי טלפון בכלל: יעד בלי
// סוכן/ת אינו גלוי, וליד גלוי אינו יעד. אותו external_ref נתפס בשכבה של
// (source, external_ref). בעל/ת נכס מצמיד/ה רק לאותה עיר ואותו רחוב,
// ומספר בית כשאחד הצדדים נושא אותו. בלי כתובת באחד הצדדים אין הצמדה.
// פנייה על נכס בלי property_id (מחשבון תשואה) אינה מצמידה.
//
// מהדפדפן אין מיזוג בכלל: לא דגל duplicate, לא lead_id של ליד אחר, ולא
// כתיבה ל-raw_message של מישהו/י אחר/ת. התשובה היא insert רגיל.
//
// עמודה או פונקציה שטרם עלתה (הקליטה לפני המיגרציה) - מדלגים ומכניסים כרגיל.
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

/**
 * חלון ההתראה החוזרת. לכל היותר new_lead אחד לליד בחלון הזה, כולל
 * "ליד חדש" המקורי. פנייה נוספת בתוך החלון עדיין נוגעת בליד.
 */
export const REPEAT_NOTICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** הסטטוסים החיים של leads. אין status של closed/lost; הסגירה היא ארכיון ושלב. */
const OPEN_STATUSES = new Set(["masked", "unlocked", "pending_charge"]);

/** lead_work: not_relevant = לא רלוונטי / לא ענה, won = נסגר בהצלחה. */
const CLOSED_STAGES = new Set(["not_relevant", "won"]);

/** leads.source של כלי בדף משרד או בדף סוכן/ת. null ומקור פלטפורמה אינם כאלה. */
const PAGE_SOURCES = new Set(["agency_page", "agent_page"]);

export type OpenLeadRow = {
  id: string;
  agent_id: string | null;
  agency_id?: string | null;
  source?: string | null;
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

/**
 * ליד שנולד מכלי בדף (הערכת שווי, מחשבון) ולא מרוטציה של הפלטפורמה.
 * source הוא הסימון כשהוא נשמר. ניסיון insert שנסוג בלי source משאיר null.
 */
export function isPageRoutedSource(source: string | null | undefined): boolean {
  if (!source) return false;
  if (PAGE_SOURCES.has(source)) return true;
  return source.startsWith("agency_page_") || source.startsWith("agent_page_");
}

/**
 * יעד תיאורטי של פניית פלטפורמה: בלי agency_id, בלי agent_id, ו-source
 * שאינו דף. source ריק עם משרד או עם סוכן/ת אינו יעד.
 * אין קורא בהצמדה. ליד גלוי דורש agent_id, והיעד דורש agent_id ריק,
 * אז אין שורה שעוברת את שניהם. attachToOpenLead חוזר null בלי שאילתה.
 */
export function isPlatformTarget(row: {
  agency_id?: string | null;
  agent_id?: string | null;
  source?: string | null;
}): boolean {
  if (row.agency_id || row.agent_id) return false;
  if (isPageRoutedSource(row.source)) return false;
  return true;
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

export type AddressIdentity = { city: string; street: string; house: string | null };

/** מילים של מפרט, לא של רחוב. "4 חדרים" אינו כתובת. */
const ADDRESS_STOP = new Set([
  "חדרים", "חדר", "מצב", "חדש", "ישן", "משופץ", "שיפוץ", "גג", "דירה", "בית",
  "פנטהאוז", "קומה", "מרפסת", "מעלית", "מחסן", "חניה", "ממד", "מר", "מסחרי",
  "משרד", "חנות", "וילה", "דופלקס", "גן", "קרקע", "נכס", "מכירה", "השכרה",
  "למכירה", "להשכרה", "מרוהט", "מרוהטת",
]);

const STREET_PREFIX = /^(?:רחוב|רח|שדרות|שד|דרך|סמטת|סמטה|שכונת|שכונה)\s+/;
const HOUSE_END = /^(.*?)(?:\s+)(\d+[a-zא-ת]?(?:\/\d+)?)$/;
const HOUSE_START = /^(\d+[a-zא-ת]?(?:\/\d+)?)(?:\s+)(.+)$/;

function foldPlace(s: string): string {
  return s
    .replace(/["'״׳]/g, "")
    .replace(/[-.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function streetOk(street: string): boolean {
  const words = street.split(" ").filter(Boolean);
  if (words.length === 0) return false;
  const letters = street.replace(/[^א-תa-z]/g, "");
  if (letters.length < 2) return false;
  return words.some((w) => !ADDRESS_STOP.has(w) && /[א-תa-z]/.test(w));
}

/**
 * עיר + רחוב, ומספר בית אם נכתב. null כשאין כתובת שאפשר להשוות:
 * שדה ריק, או טקסט שהוא מפרט ("4 חדרים") ולא רחוב.
 */
export function parseAddressIdentity(
  city: string | null | undefined,
  address: string | null | undefined,
): AddressIdentity | null {
  const cityNorm = foldPlace(String(city || ""));
  if (!/[א-תa-z]{2,}/.test(cityNorm)) return null;
  let addr = foldPlace(String(address || ""));
  if (!addr) return null;
  if (addr.endsWith(" " + cityNorm)) addr = addr.slice(0, -(cityNorm.length + 1)).trim();
  let guard = 0;
  while (STREET_PREFIX.test(addr) && guard < 3) {
    addr = addr.replace(STREET_PREFIX, "").trim();
    guard++;
  }
  let street = addr;
  let house: string | null = null;
  const end = addr.match(HOUSE_END);
  const start = addr.match(HOUSE_START);
  if (end && streetOk(end[1].trim())) {
    street = end[1].trim();
    house = end[2];
  } else if (start && streetOk(start[2].trim())) {
    house = start[1];
    street = start[2].trim();
  }
  let guard2 = 0;
  while (STREET_PREFIX.test(street) && guard2 < 3) {
    street = street.replace(STREET_PREFIX, "").trim();
    guard2++;
  }
  if (!streetOk(street)) return null;
  return { city: cityNorm, street, house };
}

/** אותה עיר ואותו רחוב. מספר בית באחד הצדדים מחייב אותו מספר בשני. */
export function sameOwnerAddress(a: AddressIdentity, b: AddressIdentity | null): boolean {
  if (!b) return false;
  if (a.city !== b.city || a.street !== b.street) return false;
  if (a.house || b.house) return a.house === b.house;
  return true;
}

/**
 * הכתובת שנשמרה בתחילת raw_message: "רחוב · מפרט", והערות מצטרפות בשורה חדשה.
 * ההערה אינה הכתובת. מפרט בלי רחוב ("4 חדרים") אינו זהות.
 */
export function addressFromStoredLead(row: {
  raw_message?: string | null;
  city?: string | null;
}): AddressIdentity | null {
  const firstLine = (row.raw_message || "").split("\n")[0] ?? "";
  const segment = firstLine.split(" · ")[0] ?? "";
  return parseAddressIdentity(row.city, segment);
}

export type AttachInput = {
  phone: string;
  leadType: string;
  /** true בפנייה על נכס: רק אותו property_id. null אינו מצמיד. */
  matchProperty: boolean;
  propertyId?: string | null;
  /** true בבעל/ת נכס: אותה עיר ואותו רחוב. בלי כתובת אין הצמדה. */
  matchAddress?: boolean;
  city?: string | null;
  address?: string | null;
  source: string | null;
  externalRef: string | null;
  message: string | null;
  sourceLabel: string | null;
  /** false לדפדפן. בלי זה הפונקציה מחזירה null והקורא מכניס ליד חדש. */
  internal: boolean;
  /** דף משרד, דף סוכן/ת, או הנכס עצמו. בלי שניהם זו פניית פלטפורמה. */
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
  // פניית פלטפורמה (מטא או רשת, בלי משרד ובלי סוכן/ת) אינה מתמזגת לפי
  // טלפון. יעד בלי agent_id אינו עובר את leadIsVisible, אז אין מה לחפש.
  // אותו external_ref נתפס ב-(source, external_ref), לא כאן.
  if (!input.agencyId && !input.agentId) return null;
  // בעל/ת נכס בלי כתובת שאפשר להשוות אינו נבלע בליד של נכס אחר.
  const wantAddress = input.matchAddress ? parseAddressIdentity(input.city, input.address) : null;
  if (input.matchAddress && !wantAddress) return null;

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
    .select("id, agent_id, agency_id, status, source, created_at, raw_message, source_touches, city, property_type, deal_type")
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

  if (wantAddress) rows = rows.filter((r) => sameOwnerAddress(wantAddress, addressFromStoredLead(r)));
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

  // קודם העדכון, בשאילתה אחת. כישלון - אין התראה, והקורא מכניס ליד חדש.
  const noteLine = appendLeadNote(null, input.sourceLabel, input.message);
  let touchedId: string | null = null;
  try {
    const upd = await sb.rpc("lead_phone_touch", {
      p_lead_id: chosen.id,
      p_note: noteLine,
      p_touch: {
        source: input.source,
        external_ref: input.externalRef,
        at: new Date().toISOString(),
      },
    });
    if (upd.error || typeof upd.data !== "string" || !upd.data) {
      console.warn("lead phone dedupe note skipped", upd.error?.code || "update");
      return null;
    }
    touchedId = upd.data;
  } catch {
    console.warn("lead phone dedupe note skipped", "update");
    return null;
  }

  // ההתראה אחרי עדכון שהצליח. כישלון שלה אינו פותח ליד שני: ההודעה כבר על הליד.
  // אין רוטציה: לא נגענו ב-lead_distribution_rotation. משימת היומן אינה נכפלת
  // כי source_key שלה הוא lead:<id> (on conflict do nothing).
  // לכל היותר new_lead אחד לליד ב-24 שעות, כולל "ליד חדש" שנכתב ביצירה.
  // כשל בבדיקה מדלג על ההתראה ולא שולח כפילות. המגע נשאר.
  const sinceNotice = new Date(Date.now() - REPEAT_NOTICE_WINDOW_MS).toISOString();
  let noticeBlocked = true;
  try {
    const prev = await sb.from("notifications")
      .select("id")
      .eq("type", "new_lead")
      .eq("related_lead_id", chosen.id)
      .gt("created_at", sinceNotice)
      .limit(1);
    if (prev.error || !Array.isArray(prev.data)) {
      console.warn("lead phone dedupe notify skipped", prev.error?.code || "notify-window");
    } else {
      noticeBlocked = prev.data.length > 0;
    }
  } catch {
    console.warn("lead phone dedupe notify skipped", "notify-window");
  }
  if (noticeBlocked) return { lead_id: touchedId };

  const notice = repeatNotice(chosen);
  try {
    const note = await sb.from("notifications").insert({
      agent_id: chosen.agent_id,
      type: "new_lead",
      title: notice.title,
      body: notice.body,
      related_lead_id: chosen.id,
    });
    if (note.error) console.warn("lead phone dedupe notify skipped", note.error.code || "notify");
  } catch {
    console.warn("lead phone dedupe notify skipped", "notify");
  }
  return { lead_id: touchedId };
}
