/**
 * ייבוא נכסים מקובץ דרך גבריאלה - אותה ליבה של האשף ב-CRM
 * (‏_shared/property-import-core.js, docs/property-import.md).
 *
 *   קובץ Excel/CSV בוואטסאפ ──► prepareImportJob: עותק ב-property_import_jobs
 *                                 וסיכום יבש לגבריאלה (חדשים / עדכונים / נפסלים)
 *   "כן, תייבאי" ──────────────► runImportJob (הכלי import_properties_file):
 *                                 בנייה מחדש מול המסד של עכשיו, קליטה, עדכון
 *
 * **שתי ריצות ולא אחת:** בין הסיכום לאישור יכולות לעבור שעות, ועמית/ה במשרד
 * יכול/ה לייבא באמצע את אותו קובץ. לכן הקליטה בונה את המצב מחדש (מי כבר
 * במשרד, מה כבר אצלי) ולא סומכת על הסיכום.
 *
 * שורה בלי סוג עסקה לא פוסלת את הקובץ. התקינות נקלטו, והיא נשמרת עד
 * בחירה מפורשת (הכל למכירה / הכל להשכרה / לפי שורה). אין ניחוש ואין
 * ברירת מחדל. "הכל" ממלא רק תאים ריקים. שורה שדילגו עליה לא נכנסת.
 *
 * מה שהאשף עושה ו**לא** כאן:
 *   • רחוב שאינו ברשימת הרחובות נשמר כפי שהוקלד, בלי אזהרה (באשף יש
 *     אזהרה ותיקון ידני). רחוב שכן ברשימה, בכתיב אחר, נשמר בכתיב הרשמי -
 *     כמו באשף (‏streetCanonicalizer). הגאוקוד בשרת מתמודד עם כתיב בעצמו.
 *   • אין תיקון ידני. במקומו **ניחוש מחכה לאישור**: מכירה/השכרה לפי המחיר,
 *     מחיר למ"ר וסוג נכס מהכותרת נמסרים בסיכום לפי סוג, עם דוגמאות, וגבריאלה
 *     שואלת לפני הקליטה ("78 מסחריים סווגו לפי מחיר - לאשר?"). הכלי מקבל את
 *     הסוגים שאושרו (‏accept_guesses); בלי התשובה הוא מחזיר
 *     ‏needs_confirmation ואינו קולט, ושורה עם ניחוש שלא אושר נשארת בחוץ
 *     ונפתחת לתיקון באשף, יחד עם השורות שנפסלו (‏/crm?...&import=<id>).
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import * as XLSX from "npm:xlsx@0.18.5";
import "../_shared/property-import-core.js";
import { SearchCore } from "./property-search.ts";
import { FEATURE_LABELS } from "../_shared/marketing-copy.ts";
import { decodeText } from "./media-intake.ts";
import {
  applyDealText,
  awaitingRows,
  choiceOverrides,
  dealAskBody,
  dealButtons,
  emptyHold,
  fillEmptyDeals,
  holdExpired,
  holdExpiry,
  importSummary,
  parseDealButtonId,
  perRowBody,
  readHold,
  rejectionWhy,
  snapshotHeld,
  isEmptyDealOnly,
  type DealHold,
  type ImportDealAction,
} from "./property-import-deal.ts";

export type { ImportDealAction };
export { parseDealButtonId };

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
// deno-lint-ignore no-explicit-any
const PIC = (globalThis as any).PropertyImportCore;

/** אותה תקרה של האשף (‏IMPORT_MAX_ROWS ב-crm.js) */
export const IMPORT_MAX_ROWS = 500;
const CHUNK = 50;
/** אחרי זה הסיכום כבר לא מתאר את המצב - שולחים את הקובץ מחדש */
const JOB_TTL_MS = 24 * 60 * 60 * 1000;

let configured = false;
/** אוצר המילים של השרת: סוגי הנכס של הבוט (agent.ts קורא לכאן בטעינה, אחרי
 *  שהרשימות שלו הוגדרו) ותוויות המאפיינים של התיאור השיווקי.
 *  ‏property_import_core_test.js בודק שהתוצאה זהה לזו של ה-CRM. */
export function configureImportVocab(residentialTypes: string[], commercialTypes: string[]) {
  PIC.configure({ residentialTypes, commercialTypes, features: Object.entries(FEATURE_LABELS) });
  configured = true;
}
function ensureConfigured() {
  if (!configured) throw new Error("property import vocab not configured (agent.ts)");
}

/** ‏Date מהגיליון נשמר כ-yyyy-mm-dd: כך הוא עובר jsonb, ו-PIC.date קורא אותו */
function cellOut(v: unknown): unknown {
  if (v instanceof Date && !isNaN(v.getTime())) {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${v.getUTCFullYear()}-${p(v.getUTCMonth() + 1)}-${p(v.getUTCDate())}`;
  }
  return v ?? "";
}

/** הגיליון הראשון כמו שהאשף קורא אותו: שורת כותרות, ושורות לא ריקות */
export function readMatrix(bytes: Uint8Array, fileName: string): { headers: string[]; rows: unknown[][] } | null {
  const csv = /\.(csv|txt|tsv)$/i.test(fileName);
  const wb = csv
    ? XLSX.read(decodeText(bytes), { type: "string", raw: false })
    : XLSX.read(bytes, { type: "array", cellDates: true, sheetRows: IMPORT_MAX_ROWS + 2 });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return null;
  const matrix: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: "" });
  if (!matrix.length) return null;
  const headers = (matrix[0] || []).map((h, i) => PIC.text(h) || `עמודה ${i + 1}`);
  const rows = matrix.slice(1)
    .filter((r) => r.some((c) => PIC.text(c) !== ""))
    .map((r) => headers.map((_, i) => cellOut(r[i])));
  return { headers, rows };
}

/** קובץ נכסים: יד2, או שלושת שדות החובה שהאשף ממפה בעצמו */
function looksLikeProperties(headers: string[]): boolean {
  if (PIC.detectYad2(headers)) return true;
  const m = PIC.autoMap(headers);
  return ["property_type", "deal_type", "price"].every((k) => (m[k] ?? -1) > -1);
}

/**
 * הכתיב הרשמי של הרחוב, כמו canonicalStreet בטופס ובאשף (‏crm.js): התאמה לפי
 * המפתח (‏SearchCore.streetNameKey, העתק של public.street_name_key) ברשימת
 * הרחובות או בשמות הנרדפים של אותה עיר - נשמר השם שברשימה. בלי התאמה, כמו
 * עד היום: כפי שהוקלד ובלי אזהרה (הגאוקוד בשרת מתמודד עם כתיב בעצמו).
 * ‏docs/street-registry.md.
 */
async function streetCanonicalizer(supabase: SupabaseClient, cities: string[]) {
  const clean = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
  const byCity = new Map<string, Map<string, string>>();
  if (cities.length) {
    // עמודים של 1,000: בחיפה לבדה יש כ-1,400 רחובות, ו-PostgREST חותך בשקט
    const page = async (table: string, cols: string) => {
      const out: Row[] = [];
      for (let from = 0; ; from += 1000) {
        let q = supabase.from(table).select(cols).in("city", cities).order("id").range(from, from + 999);
        if (table === "street_registry") q = q.eq("active", true);
        const { data, error } = await q;
        if (error) { console.warn(`${table} לא נטען - הרחובות נשמרים כפי שהוקלדו:`, error.message); return out; }
        out.push(...(data || []));
        if (!data || data.length < 1000) return out;
      }
    };
    const [streets, aliases] = await Promise.all([
      page("street_registry", "city, name"),
      page("street_registry_aliases", "city, alias, name"),
    ]);
    const names = new Set<string>();
    streets.sort((a, b) => String(a.name).localeCompare(String(b.name), "he")).forEach((r) => {
      if (!byCity.has(r.city)) byCity.set(r.city, new Map());
      const k = SearchCore.streetNameKey(r.name);
      if (!byCity.get(r.city)!.has(k)) byCity.get(r.city)!.set(k, r.name);
      names.add(`${r.city}|${r.name}`);
    });
    // רחוב אמיתי גובר על שם נרדף, ושם נרדף מצביע רק על רחוב שברשימה
    aliases.forEach((a) => {
      const keys = byCity.get(a.city);
      const k = SearchCore.streetNameKey(a.alias);
      if (keys && !keys.has(k) && names.has(`${a.city}|${a.name}`)) keys.set(k, a.name);
    });
  }
  return (v: string, city: string) => {
    const raw = clean(v);
    const hit = raw ? byCity.get(clean(city))?.get(SearchCore.streetNameKey(raw)) : null;
    return { ok: true, name: hit || raw };
  };
}

/** המצב שהליבה צריכה (‏S), מהמסד של עכשיו. אותו סדר כמו impRenderStep3. */
async function buildState(supabase: SupabaseClient, agentId: string, agencyId: string, headers: string[], rows: unknown[][]) {
  ensureConfigured();
  const S: Row = { headers, rows, mapping: PIC.autoMap(headers), overrides: {}, maxImages: 8 };
  S.yad2 = PIC.detectYad2(headers);
  const at = (n: string) => headers.findIndex((h) => PIC.norm(h) === PIC.norm(n));
  if (S.yad2) {
    S.mapping.listing_expires_at = -1;
    S.yad2Agent1 = { name: at("סוכן 1"), phone: at("טלפון 1") };
    if ((S.mapping.yad2_listing_id ?? -1) < 0) S.mapping.yad2_listing_id = at("מספר מודעה");
  }
  S.featureColumns = PIC.detectFeatureColumns(headers, S.mapping);

  const { data: me } = await supabase.from("agency_members")
    .select("id, agency_id, phone, phone_e164").eq("id", agentId).maybeSingle();
  S.agent = { id: agentId, agency_id: agencyId, phone: me?.phone || me?.phone_e164 || "" };

  // שכונות: של הערים שבקובץ, ועוד שכונה ששמה הוא "עיר" בקובץ ("אזור תעשייה
  // אלון התבור"). לא את כל הטבלה - PostgREST חותך ב-1,000 בשקט.
  const cityIdx = S.mapping.city ?? -1;
  const cities = cityIdx < 0 ? [] : [...new Set(rows.map((r) => PIC.text(r[cityIdx])).filter(Boolean))];
  const [byCity, byName] = cities.length
    ? await Promise.all([
      supabase.from("neighborhoods").select("id, city, name, city_id").in("city", cities),
      supabase.from("neighborhoods").select("id, city, name, city_id").in("name", cities),
    ])
    : [{ data: [] }, { data: [] }];
  const hoods = new Map<string, Row>();
  [...(byCity.data || []), ...(byName.data || [])].forEach((n: Row) => hoods.set(n.id, n));
  S.neighborhoods = [...hoods.values()];
  // שכונות של עיר נוספת שהגיעה מהשם (עפולה, דרך אלון התבור)
  const extraCities = [...new Set((byName.data || []).map((n: Row) => n.city))].filter((c) => !cities.includes(c));
  if (extraCities.length) {
    const { data } = await supabase.from("neighborhoods").select("id, city, name, city_id").in("city", extraCities);
    (data || []).forEach((n: Row) => hoods.set(n.id, n));
    S.neighborhoods = [...hoods.values()];
  }
  const hoodIds = S.neighborhoods.map((n: Row) => n.id);
  const { data: aliases } = hoodIds.length
    ? await supabase.from("neighborhood_aliases").select("neighborhood_id, alias").in("neighborhood_id", hoodIds)
    : { data: [] };
  S.hoodAliases = aliases || [];
  S.canonicalStreet = await streetCanonicalizer(supabase, cities);

  // כפילות לפי כותרת ומחיר - אותו מפתח של האשף
  const { data: mine } = await supabase.from("properties").select("title, price").eq("agent_id", agentId);
  S.existingKeys = new Set((mine || []).map((p: Row) => `${PIC.norm(p.title)}|${Number(p.price)}`));

  // מודעות יד2 שכבר במשרד: שלי - עדכון; של עמית/ה - דחייה עם השם
  S.yad2Taken = new Map();
  S.ownByYad2 = new Map();
  const ids = PIC.yad2Ids(S);
  if (ids.length) {
    const { data: inOffice } = await supabase.from("properties")
      .select(PIC.REIMPORT_COLUMNS + ", agent_id").eq("agency_id", agencyId).in("yad2_listing_id", ids);
    const others = (inOffice || []).filter((p: Row) => p.agent_id !== agentId);
    const names = new Map<string, string>();
    if (others.length) {
      const { data: members } = await supabase.from("agency_members")
        .select("id, display_name").in("id", [...new Set(others.map((p: Row) => p.agent_id))]);
      (members || []).forEach((m: Row) => names.set(m.id, m.display_name || ""));
    }
    (inOffice || []).forEach((p: Row) => {
      const id = Number(p.yad2_listing_id);
      if (p.agent_id === agentId) S.ownByYad2.set(id, p);
      else S.yad2Taken.set(id, names.get(p.agent_id) || "");
    });
  }
  return S;
}

/** סוגי הניחוש שהליבה עושה (‏guessed ב-impBuildRow), כמו שהסוכן/ת שומע/ת אותם */
export const GUESS_KINDS: Record<string, string> = {
  deal_type: 'מכירה/השכרה שנקבעו לפי המחיר (בקובץ כתוב "מסחרי")',
  price: 'מחיר למ"ר שהומר לשכר דירה חודשי',
  property_type: "סוג נכס שהושלם מהכותרת",
};

/** טקסט מהקובץ בתוך הבלוק: בלי סוגריים מרובעים (שלא ייסגר הבלוק מבפנים)
 *  ובלי שורות. קובץ ממייל נכתב בידי אחרים, ובלוק הייבוא אינו עובר safe. */
function clip(v: unknown, n = 40): string {
  const s = String(v ?? "").replace(/\[/g, "(").replace(/\]/g, ")").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n) + "…" : s;
}
const shekel = (n: unknown) => Number(n) > 0 ? `${Number(n).toLocaleString("he-IL")} ₪` : "";

/** שורה שתיכתב (חדשה או עדכון) ושיש בה ניחוש */
function writable(r: Row): boolean {
  return !r.errors.length && r.mode !== "same";
}

/** דוגמה אחת לניחוש - מספיק כדי שהסוכן/ת יזהה/תזהה את הנכס ויחליט/תחליט */
function guessExample(r: Row, kind: string): string {
  const p = r.payload || {};
  const what = clip(p.property_type || p.title, 30);
  const value = kind === "price" ? `${shekel(r.guessed.price)} לחודש (${clip(p.built_size_sqm || p.size_sqm, 8)} מ"ר)`
    : kind === "deal_type" ? `${clip(r.guessed.deal_type, 10)} (${shekel(p.price)})`
    : `"${clip(p.title, 40)}" → ${clip(r.guessed.property_type, 20)}`;
  return `שורה ${r.rowNumber}${kind === "property_type" ? "" : ` ${what}`}: ${value}`;
}

/** הניחושים לפי סוג: כמה, ושלוש דוגמאות */
function guessDetails(parsed: Row[]): Row[] {
  return Object.keys(GUESS_KINDS).map((kind) => {
    const rows = parsed.filter((r) => writable(r) && r.guessed && kind in r.guessed);
    return { kind, label: GUESS_KINDS[kind], count: rows.length, examples: rows.slice(0, 3).map((r) => guessExample(r, kind)) };
  }).filter((g) => g.count);
}

/** הסיכום שגבריאלה מקבלת - מספרים וסיבות, בלי שורות הקובץ עצמן.
 *  שורה שהשדה היחיד שחסר בה הוא סוג עסקה אינה "הקובץ נפסל": היא נשמרת
 *  ונשאלת. אין כאן ניחוש לפי מחיר. */
function summaryLines(_sum: Row, parsed: Row[]): string[] {
  const split = splitRows(parsed);
  const count = (rows: Row[], mode: string) => rows.filter((r) => (r.mode || "insert") === mode).length;
  const lines = [
    `${parsed.length} שורות: ${count(split.ready, "insert")} חדשים מוכנים, ` +
      `${count(split.ready, "update")} כבר אצל הסוכן/ת ויעודכנו, ` +
      `${count(split.ready, "same")} כבר אצלו/ה בלי שינוי, ` +
      `${split.hold.length} בלי סוג עסקה (נשמרות ונשאלות, לא פוסלות את הקובץ), ` +
      `${split.rejected.length} ייפסלו מסיבה אחרת.`,
  ];
  if (split.hold.length) {
    const sample = split.hold.slice(0, 3).map((r) => {
      const where = snapshotHeld(r).address;
      return `שורה ${r.rowNumber}${where ? " " + where : ""}`;
    });
    lines.push(
      `בלי סוג עסקה: ${sample.join("; ")}${split.hold.length > 3 ? "…" : ""}. ` +
        `אין לנחש מכירה או השכרה, גם לא לפי מחיר.`,
    );
  }
  const guesses = guessDetails(parsed);
  if (guesses.length) {
    lines.push(`ניחושים שמחכים לאישור הסוכן/ת - בלי אישור, השורות האלה לא ייקלטו:`);
    guesses.forEach((g) => lines.push(`• ${g.kind} - ${g.count} שורות: ${g.label}. לדוגמה: ${g.examples.join("; ")}`));
  }
  const reasons = new Map<string, number>();
  for (const r of split.rejected) {
    for (const e of r.errors || []) {
      const k = String(e).split(". לתיקון: ")[0].replace(/"[^"]*"/g, '"…"');
      reasons.set(k, (reasons.get(k) || 0) + 1);
    }
  }
  [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .forEach(([reason, n]) => lines.push(`נפסלו ${n}: ${clip(reason, 200)}`));
  const noImages = split.ready.filter((r) => r.mode === "insert" && !r.payload?.images?.length).length;
  if (noImages) lines.push(`${noImages} נכסים חדשים בלי תמונות (בקובץ של יד2 אין תמונות) - צריך להעלות אחר כך.`);
  return lines;
}

/**
 * בקבלת הקובץ. מחזיר בלוק לתור של גבריאלה, או null כשזה לא קובץ נכסים.
 * לעולם אינו זורק: קובץ שלא נקרא כאן ממשיך להיות מסמך רגיל.
 */
export async function prepareImportJob(
  supabase: SupabaseClient,
  agent: { id: string; agency_id: string | null },
  bytes: Uint8Array,
  fileName: string,
  source: "whatsapp" | "email" = "whatsapp",
): Promise<string | null> {
  try {
    if (!agent.agency_id) return null;
    const m = readMatrix(bytes, fileName);
    if (!m || !m.rows.length) return null;
    ensureConfigured();
    if (!looksLikeProperties(m.headers)) return null;
    if (m.rows.length > IMPORT_MAX_ROWS) {
      return `[ייבוא נכסים] זה קובץ נכסים עם יותר מ-${IMPORT_MAX_ROWS} שורות - יותר ממה שאפשר לקלוט בבת אחת. ` +
        `להציע לפצל אותו לכמה קבצים.`;
    }
    const S = await buildState(supabase, agent.id, agent.agency_id, m.headers, m.rows);
    const parsed = PIC.parseAll(S);
    const sum = PIC.summarize(parsed);
    const { data: job, error } = await supabase.from("property_import_jobs").insert({
      agent_id: agent.id, agency_id: agent.agency_id, source, file_name: fileName || null,
      headers: m.headers, rows: m.rows, summary: sum,
    }).select("id").single();
    if (error || !job) {
      console.error("property import job insert failed", error);
      return null;
    }
    return [
      `[ייבוא נכסים] זוהה קובץ נכסים${S.yad2 ? " מיד2" : ""} (job_id: ${job.id}).`,
      ...summaryLines(sum, parsed),
      `אפשר לקלוט אותו עכשיו, בלי האשף: אחרי אישור הסוכן/ת - הכלי import_properties_file עם job_id הזה.`,
      ...(sum.guessed
        ? [`לפני הקליטה לשאול על כל סוג ניחוש בנפרד אם לאשר (עם המספר והדוגמאות), ולהעביר ב-accept_guesses ` +
          `את הסוגים שאושרו בלבד ([] אם אף אחד). "כן" כללי לקליטה אינו אישור של הניחושים.`]
        : []),
      ...(splitRows(parsed).hold.length
        ? [`שורות בלי סוג עסקה לא פוסלות את הקובץ. אחרי אישור - import_properties_file. ` +
          `המערכת שואלת בכפתורים: הכל למכירה, הכל להשכרה, לפי שורה. ` +
          `אין למלא סוג עסקה לבד, גם לא לפי מחיר. "הכל" חל רק על תאים ריקים. ` +
          `לפי שורה: מספר שורה או כתובת, או דילוג. שורה שדילגו עליה לא נכנסת.`]
        : []),
      `[סוף ייבוא נכסים]`,
    ].join("\n");
  } catch (err) {
    console.error("prepareImportJob failed", err);
    return null;
  }
}

/** מכניס שורות חדשות: מנות של 50, ובכישלון - שורה-שורה, כמו האשף */
async function insertRows(supabase: SupabaseClient, rows: Row[], failed: Row[]): Promise<Row[]> {
  const inserted: Row[] = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { data, error } = await supabase.from("properties")
      .insert(chunk.map((r) => r.payload)).select("id, neighborhood_id");
    if (!error) {
      chunk.forEach((r, k) => inserted.push({ row: r, got: data?.[k] }));
      continue;
    }
    for (const r of chunk) {
      const { data: one, error: e } = await supabase.from("properties")
        .insert(r.payload).select("id, neighborhood_id").single();
      if (e) failed.push({ row: r.rowNumber, message: PIC.insertErrorText(e) });
      else inserted.push({ row: r, got: one });
    }
  }
  return inserted;
}

const JOB_COLS_OLD = "id, agent_id, status, created_at, headers, rows, file_name, result";
const JOB_COLS = JOB_COLS_OLD + ", deal_hold";

function missingDealColumn(error: { message?: string } | null): boolean {
  return /deal_hold/.test(error?.message || "");
}

/** העמודה נוספת במיגרציה. עד שהיא רצה, השאילתה בלי העמודה והשמירה בלי השדה. */
async function loadImportJob(supabase: SupabaseClient, agentId: string, jobId: string): Promise<
  { job: Row; columnMissing: boolean } | { error: Row }
> {
  let columnMissing = false;
  let res = await supabase.from("property_import_jobs").select(JOB_COLS)
    .eq("id", jobId).eq("agent_id", agentId).maybeSingle();
  if (res.error && missingDealColumn(res.error)) {
    columnMissing = true;
    res = await supabase.from("property_import_jobs").select(JOB_COLS_OLD)
      .eq("id", jobId).eq("agent_id", agentId).maybeSingle();
  }
  if (res.error || !res.data) return { error: { ok: false, error: "לא מצאתי את הקובץ הזה. אפשר לשלוח את הקובץ שוב?" } };
  return { job: res.data, columnMissing };
}

function holdOf(job: Row): DealHold | null {
  return readHold(job.deal_hold) || readHold(job.result?.deal_hold);
}

/** שומר את הטיפוס של השורה המלאה. splitImportRows מצמצם ל-ParsedLike. */
function splitRows(rows: Row[]): { ready: Row[]; hold: Row[]; rejected: Row[] } {
  const ready: Row[] = [];
  const hold: Row[] = [];
  const rejected: Row[] = [];
  for (const row of rows) {
    if (!row.errors?.length) ready.push(row);
    else if (isEmptyDealOnly(row)) hold.push(row);
    else rejected.push(row);
  }
  return { ready, hold, rejected };
}

async function saveImportJob(supabase: SupabaseClient, jobId: string, patch: Row): Promise<boolean> {
  const { error } = await supabase.from("property_import_jobs").update(patch).eq("id", jobId);
  if (error && missingDealColumn(error) && "deal_hold" in patch) {
    const rest = { ...patch };
    delete rest.deal_hold;
    const again = await supabase.from("property_import_jobs").update(rest).eq("id", jobId);
    return !again.error;
  }
  if (error) console.error("import job save failed", error.message);
  return !error;
}

function rememberSkip(hold: DealHold, row: number, why: string) {
  if (!hold.skipped.includes(row)) hold.skipped.push(row);
  delete hold.choices[String(row)];
  if (!hold.skipped_reasons.some((s) => s.row === row)) hold.skipped_reasons.push({ row, why });
}

function doneNumbers(hold: DealHold): Set<number> {
  return new Set([...hold.inserted, ...hold.updated, ...hold.unchanged]);
}

const SKIP_WHY = new Set(["ביקשת לדלג", "לא נבחר סוג עסקה", "עבר יום בלי בחירה"]);

/**
 * הקליטה עצמה, אחרי אישור. ‏geocode: הפין של create_property (agent.ts) - כדי
 * ששכונה מכינוי ("שכון עובדים") תוכרע לפי הכתובת כשיש כתובת מלאה.
 *
 * מחוץ לשאלת הפרסום של create_property. הסטטוס מגיע מהקובץ, ובלי עמודה
 * הליבה כותבת active - אותו דבר באשף. הסוכן/ת כבר אישר/ה את הקובץ.
 * מודעה של משרד אחר עדיין נחסמת בטריגר במעבר ל-active.
 *
 * שורה שחסר בה רק סוג עסקה לא פוסלת את הקובץ: התקינות נקלטו, והיא נשמרת
 * ב-deal_hold עד בחירה מפורשת. אין ניחוש.
 */
export async function runImportJob(
  supabase: SupabaseClient,
  agent: { id: string; agency_id: string | null },
  jobId: string,
  geocode: (city: string, street: string, house: string) => Promise<{ lat: number; lng: number } | null>,
  /** סוגי הניחוש שהסוכן/ת אישר/ה (‏GUESS_KINDS). ‏undefined - עוד לא נשאל/ה. */
  acceptGuesses?: string[] | null,
  action?: ImportDealAction,
): Promise<Row> {
  if (!agent.agency_id) return { ok: false, error: "לסוכן/ת אין משרד משויך - צריך להשלים הרשמה בדשבורד." };
  const loaded = await loadImportJob(supabase, agent.id, jobId);
  if ("error" in loaded) return loaded.error;
  const { job, columnMissing } = loaded;
  if (job.status === "done") return { ok: false, error: "הקובץ הזה כבר נקלט. כדי לעדכן - לשלוח אותו שוב." };
  if (Date.now() - new Date(job.created_at).getTime() > JOB_TTL_MS) {
    return { ok: false, error: "עבר יותר מיום מאז שהקובץ נשלח, והמצב במשרד אולי השתנה. אפשר לשלוח את הקובץ שוב?" };
  }
  const { data: locked } = await supabase.from("property_import_jobs")
    .update({ status: "running" }).eq("id", job.id).in("status", ["pending", "failed"]).select("id");
  if (!locked?.length) return { ok: false, error: "הקובץ הזה כבר בקליטה." };

  const backTo = (patch: Row) => saveImportJob(supabase, job.id, patch);

  try {
    let hold = holdOf(job);
    const hadHold = !!hold;
    if (hold && holdExpired(hold)) {
      for (const row of awaitingRows(hold)) rememberSkip(hold, row.row, "עבר יום בלי בחירה");
      const summary = importSummary({
        inserted: hold.inserted.length, updated: hold.updated.length, unchanged: hold.unchanged.length,
        skipped: hold.skipped_reasons,
      });
      await backTo({ status: "done", deal_hold: null, result: { summary }, finished_at: new Date().toISOString() });
      return {
        ok: false,
        error: `${summary}\nעבר יותר מיום בלי בחירה, והשורות בלי סוג עסקה לא נקלטו. אפשר לשלוח את הקובץ שוב.`,
      };
    }
    if (action && !hold) {
      await backTo({ status: "pending" });
      return { ok: false, error: "אין כרגע שורות שממתינות לסוג עסקה. אפשר לשלוח את הקובץ שוב?" };
    }
    if (action && columnMissing) {
      await backTo({ status: "pending" });
      return { ok: false, error: "עוד אי אפשר לשמור את הבחירה. אפשר לשלוח את הקובץ שוב בעוד כמה דקות." };
    }

    let clarify = "";
    let perRow = action?.type === "per_row";
    if (hold && action?.type === "all") hold = fillEmptyDeals(hold, action.deal);
    if (hold && action?.type === "reply") {
      const applied = applyDealText(hold, action.text);
      if (!applied) {
        await backTo({ status: "pending", deal_hold: hold, result: { deal_hold: hold } });
        return { ok: false, error: "לא הבנתי את הבחירה. אפשר: הכל למכירה, הכל להשכרה, או שורה 3 מכירה." };
      }
      hold = applied.hold;
      if (applied.perRow) perRow = true;
      if (!applied.changed && applied.clarify && !applied.perRow) {
        await backTo({ status: "pending", deal_hold: hold, result: { deal_hold: hold } });
        return { ok: true, needs_deal: true, send_buttons: false, ask_body: applied.clarify, summary: applied.clarify };
      }
      clarify = applied.clarify || "";
    }

    const S = await buildState(supabase, agent.id, agent.agency_id, job.headers, job.rows);
    S.overrides = choiceOverrides(hold);
    const parsed: Row[] = PIC.parseAll(S);
    const guesses = guessDetails(parsed);
    const decided = Array.isArray(acceptGuesses) ? acceptGuesses : (hold ? hold.accepted_guesses : undefined);
    if (guesses.length && !Array.isArray(decided)) {
      await backTo({ status: "pending", ...(hold ? { deal_hold: hold } : {}) });
      return {
        ok: false, needs_confirmation: true, guesses,
        error: "יש בקובץ ניחושים שהסוכן/ת עוד לא אישר/ה. לשאול על כל סוג (עם המספר והדוגמאות), " +
          "ואז לקרוא שוב עם accept_guesses - הסוגים שאושרו, או [] אם אף אחד. " +
          "שורות בלי סוג עסקה אינן ניחוש, ואין למלא אותן לבד.",
      };
    }
    const accepted = new Set((decided || []).filter((k) => k in GUESS_KINDS));
    const unconfirmed: Row[] = [];
    const split = splitRows(parsed);
    const ready = split.ready.filter((r) => {
      const open = writable(r) ? Object.keys(r.guessed || {}).filter((k) => !accepted.has(k)) : [];
      if (!open.length) return true;
      unconfirmed.push({
        row: r.rowNumber,
        message: open.map((k) => `${GUESS_KINDS[k] || k} - הניחוש לא אושר`).join(" · ") +
          ". לתיקון: לבחור את הערך בעצמכם בתיקון השורות, או לשלוח את הקובץ שוב ולאשר את הניחוש",
      });
      return false;
    });

    if (!hold) hold = emptyHold(split.hold.map((r) => snapshotHeld(r)), holdExpiry(String(job.created_at)));
    else if (!hold.rows.length && split.hold.length) hold.rows = split.hold.map((r) => snapshotHeld(r));
    hold.accepted_guesses = [...accepted];

    const skipped = new Set(hold.skipped);
    const already = doneNumbers(hold);
    for (const r of split.rejected) {
      if (!hold.skipped_reasons.some((s) => s.row === r.rowNumber)) {
        hold.skipped_reasons.push({ row: r.rowNumber, why: rejectionWhy(r.errors || []) });
      }
    }
    for (const u of unconfirmed) {
      if (!hold.skipped_reasons.some((s) => s.row === u.row)) hold.skipped_reasons.push({ row: u.row, why: rejectionWhy([u.message]) });
    }
    if (columnMissing) {
      for (const r of split.hold) {
        if (!hold.skipped_reasons.some((s) => s.row === r.rowNumber)) {
          hold.skipped_reasons.push({ row: r.rowNumber, why: rejectionWhy(r.errors || []) });
        }
      }
    }

    const toWrite = (columnMissing ? ready : ready.filter((r) => !skipped.has(r.rowNumber)))
      .filter((r) => !already.has(r.rowNumber));
    const toInsert = toWrite.filter((r) => (r.mode || "insert") === "insert");
    const toUpdate = toWrite.filter((r) => r.mode === "update");
    const failed: Row[] = [];

    for (const r of toInsert) {
      const p = r.payload;
      if (!r.hoodFallback || !p.street || !p.house_number || p.lat != null) continue;
      const c = await geocode(String(p.city), String(p.street), String(p.house_number));
      if (c) { p.lat = c.lat; p.lng = c.lng; p.location_precision = "exact"; delete p.neighborhood_id; }
    }

    const inserted = await insertRows(supabase, toInsert, failed);
    const byHood = new Map<string, string[]>();
    inserted.forEach(({ row, got }) => {
      hold.inserted.push(row.rowNumber);
      if (row.hoodFallback && got?.id && !got.neighborhood_id) {
        byHood.set(row.hoodFallback, [...(byHood.get(row.hoodFallback) || []), got.id]);
      }
    });
    for (const [hood, ids] of byHood) {
      await supabase.from("properties").update({ neighborhood_id: hood }).in("id", ids);
    }
    const owners = inserted.filter(({ row, got }) => row.owner && got?.id)
      .map(({ row, got }) => ({ property_id: got.id, ...row.owner }));
    if (owners.length) {
      const { error } = await supabase.from("property_owners").insert(owners);
      if (error) console.error("import owners failed", error);
    }
    for (const r of toUpdate) {
      const { error } = await supabase.from("properties").update(r.patch).eq("id", r.targetId);
      if (error) failed.push({ row: r.rowNumber, message: PIC.insertErrorText(error) });
      else hold.updated.push(r.rowNumber);
    }
    for (const r of toWrite) if (r.mode === "same") hold.unchanged.push(r.rowNumber);
    for (const f of failed) {
      if (!hold.skipped_reasons.some((s) => s.row === f.row)) {
        hold.skipped_reasons.push({ row: f.row, why: rejectionWhy([String(f.message || "")]) });
      }
    }
    const finished = doneNumbers(hold);
    hold.skipped_reasons = hold.skipped_reasons.filter((s) => !finished.has(s.row));

    const open = columnMissing ? [] : awaitingRows(hold);
    const summary = importSummary({
      inserted: hold.inserted.length,
      updated: hold.updated.length,
      unchanged: hold.unchanged.length,
      skipped: hold.skipped_reasons,
    });
    const fixable = hold.skipped_reasons.some((s) => !SKIP_WHY.has(s.why));

    if (open.length) {
      hold.mode = perRow ? "per_row" : hold.mode;
      await backTo({ status: "pending", deal_hold: hold, result: { deal_hold: hold } });
      const ask = perRow ? perRowBody(open) : dealAskBody(open.length);
      const lead = clarify ? `${clarify}\n` : "";
      const progress = hold.inserted.length || hold.updated.length ? `${lead}${summary}\n${ask}` : `${lead}${ask}`;
      return {
        ok: true,
        needs_deal: true,
        send_buttons: !perRow && !hadHold,
        ask_body: ask,
        buttons: perRow ? [] : dealButtons(String(job.id)),
        summary: progress,
        job_id: job.id,
        inserted: hold.inserted.length,
        updated: hold.updated.length,
        waiting: open.length,
      };
    }

    await backTo({
      status: "done",
      deal_hold: null,
      result: {
        inserted: hold.inserted.length,
        updated: hold.updated.length,
        unchanged: hold.unchanged.length,
        skipped: hold.skipped_reasons.length,
        summary,
      },
      finished_at: new Date().toISOString(),
    });
    return {
      ok: true,
      done: true,
      summary,
      inserted: hold.inserted.length,
      updated: hold.updated.length,
      unchanged: hold.unchanged.length,
      rejected: hold.skipped_reasons.length,
      held_unconfirmed: unconfirmed.length,
      no_images: inserted.filter(({ row }) => !row.payload?.images?.length).length,
      problems: hold.skipped_reasons.slice(0, 8).map((s) => ({ row: s.row, message: s.why })),
      more_problems: Math.max(0, hold.skipped_reasons.length - 8),
      open_fix: fixable,
      job_id: job.id,
    };
  } catch (err) {
    console.error("runImportJob failed", err);
    await supabase.from("property_import_jobs").update({ status: "failed" }).eq("id", job.id);
    return {
      ok: false,
      error: "הקליטה נעצרה באמצע בגלל תקלה, וחלק מהנכסים אולי כבר נקלטו. כדאי לבדוק ב\"הנכסים שלי\" לפני שמנסים שוב - " +
        "מודעות של יד2 לא ייכנסו פעמיים, אבל שורות בלי מספר מודעה כן.",
    };
  }
}

export interface ImportDealOutcome {
  text: string;
  buttons?: { id: string; title: string }[];
  /** נתיב יחסי לכפתור. הטקסט עצמו בלי כתובת. */
  ctaPath?: string;
  ctaLabel?: string;
  ctaBody?: string;
}

/**
 * לחיצה על כפתור, או טקסט שנראה כמענה, בזמן שיש שורות ממתינות.
 * null כשאין מה לתפוס והמודל ממשיך. לא שולח הודעה.
 */
export async function continueImportDeal(
  supabase: SupabaseClient,
  agent: { id: string; agency_id: string | null },
  action: ImportDealAction & { jobId?: string },
  geocode: (city: string, street: string, house: string) => Promise<{ lat: number; lng: number } | null>,
): Promise<ImportDealOutcome | null> {
  const jobId = action.jobId || await latestHoldJob(supabase, agent.id);
  if (!jobId) {
    if (action.type === "reply") return null;
    return { text: "השאלה על סוג העסקה כבר לא פתוחה. אפשר לשלוח את הקובץ שוב." };
  }
  if (action.type === "reply") {
    const loaded = await loadImportJob(supabase, agent.id, jobId);
    if ("error" in loaded || loaded.job.status === "done") return null;
    const hold = readHold(loaded.job.deal_hold);
    if (!hold || holdExpired(hold)) return null;
    if (!applyDealText(hold, action.text)) return null;
  }
  const res = await runImportJob(supabase, agent, jobId, geocode, undefined, action);
  if (!res.ok && !res.needs_deal) return { text: String(res.error || "לא הצלחתי להמשיך את הייבוא.") };
  const text = String(res.summary || res.ask_body || res.error || "");
  const buttons = res.send_buttons && Array.isArray(res.buttons) ? res.buttons : undefined;
  return {
    text,
    ...(buttons?.length ? { buttons } : {}),
    ...(res.done && res.open_fix
      ? { ctaPath: `/crm?goto=accProperties&import=${jobId}`, ctaLabel: "🛠️ תיקון השורות", ctaBody: "השורות שנשארו פתוחות לתיקון:" }
      : res.done && (res.inserted || res.updated)
      ? { ctaPath: "/crm?goto=accProperties", ctaLabel: "🏠 הנכסים שלי", ctaBody: "לנכסים שנקלטו:" }
      : {}),
  };
}

async function latestHoldJob(supabase: SupabaseClient, agentId: string): Promise<string | null> {
  const full = await supabase.from("property_import_jobs")
    .select("id, deal_hold, result")
    .eq("agent_id", agentId)
    .in("status", ["pending", "failed"])
    .order("created_at", { ascending: false })
    .limit(5);
  const res = full.error && missingDealColumn(full.error)
    ? await supabase.from("property_import_jobs")
      .select("id, result")
      .eq("agent_id", agentId)
      .in("status", ["pending", "failed"])
      .order("created_at", { ascending: false })
      .limit(5)
    : full;
  if (res.error || !res.data?.length) return null;
  for (const row of res.data) {
    const hold = holdOf(row);
    if (hold && !holdExpired(hold)) return String(row.id);
  }
  return null;
}
