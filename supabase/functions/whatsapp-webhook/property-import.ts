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

/** הסיכום שגבריאלה מקבלת - מספרים וסיבות, בלי שורות הקובץ עצמן */
function summaryLines(sum: Row, parsed: Row[]): string[] {
  const lines = [
    `${sum.total} שורות: ${sum.insert} חדשים, ${sum.update} כבר אצל הסוכן/ת ויעודכנו, ` +
      `${sum.same} כבר אצלו/ה בלי שינוי, ${sum.rejected} ייפסלו.`,
  ];
  const guesses = guessDetails(parsed);
  if (guesses.length) {
    lines.push(`ניחושים שמחכים לאישור הסוכן/ת - בלי אישור, השורות האלה לא ייקלטו:`);
    guesses.forEach((g) => lines.push(`• ${g.kind} - ${g.count} שורות: ${g.label}. לדוגמה: ${g.examples.join("; ")}`));
  }
  sum.reasons.slice(0, 5).forEach((r: Row) => lines.push(`נפסלו ${r.count}: ${clip(r.reason, 200)}`));
  const noImages = parsed.filter((r) => !r.errors.length && r.mode === "insert" && !r.payload?.images?.length).length;
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

/**
 * הקליטה עצמה, אחרי אישור. ‏geocode: הפין של create_property (agent.ts) - כדי
 * ששכונה מכינוי ("שכון עובדים") תוכרע לפי הכתובת כשיש כתובת מלאה.
 *
 * מחוץ לשאלת הפרסום של create_property. הסטטוס מגיע מהקובץ, ובלי עמודה
 * הליבה כותבת active - אותו דבר באשף. הסוכן/ת כבר אישר/ה את הקובץ.
 * מודעה של משרד אחר עדיין נחסמת בטריגר במעבר ל-active.
 */
export async function runImportJob(
  supabase: SupabaseClient,
  agent: { id: string; agency_id: string | null },
  jobId: string,
  geocode: (city: string, street: string, house: string) => Promise<{ lat: number; lng: number } | null>,
  /** סוגי הניחוש שהסוכן/ת אישר/ה (‏GUESS_KINDS). ‏undefined - עוד לא נשאל/ה. */
  acceptGuesses?: string[] | null,
): Promise<Row> {
  if (!agent.agency_id) return { ok: false, error: "לסוכן/ת אין משרד משויך - צריך להשלים הרשמה בדשבורד." };
  const { data: job } = await supabase.from("property_import_jobs")
    .select("id, agent_id, status, created_at, headers, rows, file_name")
    .eq("id", jobId).eq("agent_id", agent.id).maybeSingle();
  if (!job) return { ok: false, error: "לא מצאתי את הקובץ הזה. אפשר לשלוח אותו שוב?" };
  if (job.status === "done") return { ok: false, error: "הקובץ הזה כבר נקלט. כדי לעדכן - לשלוח אותו שוב." };
  if (Date.now() - new Date(job.created_at).getTime() > JOB_TTL_MS) {
    return { ok: false, error: "עבר יותר מיום מאז שהקובץ נשלח, והמצב במשרד אולי השתנה. אפשר לשלוח אותו שוב?" };
  }
  // נעילה: שני "כן" ברצף לא יקלטו את הקובץ פעמיים
  const { data: locked } = await supabase.from("property_import_jobs")
    .update({ status: "running" }).eq("id", job.id).in("status", ["pending", "failed"]).select("id");
  if (!locked?.length) return { ok: false, error: "הקובץ הזה כבר בקליטה." };

  try {
    const S = await buildState(supabase, agent.id, agent.agency_id, job.headers, job.rows);
    const parsed: Row[] = PIC.parseAll(S);
    const guesses = guessDetails(parsed);
    if (guesses.length && !Array.isArray(acceptGuesses)) {
      // עוד לא נשאל/ה: לא קולטים כלום, והקובץ חוזר להמתנה
      await supabase.from("property_import_jobs").update({ status: "pending" }).eq("id", job.id);
      return {
        ok: false, needs_confirmation: true, guesses,
        error: "יש בקובץ ניחושים שהסוכן/ת עוד לא אישר/ה. לשאול על כל סוג (עם המספר והדוגמאות), " +
          "ואז לקרוא שוב עם accept_guesses - הסוגים שאושרו, או [] אם אף אחד.",
      };
    }
    const accepted = new Set((acceptGuesses || []).filter((k) => k in GUESS_KINDS));
    // שורה עם ניחוש שלא אושר נשארת בחוץ - לתיקון באשף, כמו שורה שנפסלה
    const held: Row[] = [];
    const ready = parsed.filter((r) => {
      if (r.errors.length) return false;
      const open = writable(r) ? Object.keys(r.guessed || {}).filter((k) => !accepted.has(k)) : [];
      if (!open.length) return true;
      held.push({
        row: r.rowNumber,
        message: open.map((k) => `${GUESS_KINDS[k] || k} - הניחוש לא אושר`).join(" · ") +
          ". לתיקון: לבחור את הערך בעצמכם בתיקון השורות, או לשלוח את הקובץ שוב ולאשר את הניחוש",
      });
      return false;
    });
    const toInsert = ready.filter((r) => (r.mode || "insert") === "insert");
    const toUpdate = ready.filter((r) => r.mode === "update");
    const failed: Row[] = [...held];

    // שכונה מכינוי/התאמה רכה: הכתובת מכריעה קודם (כמו impLocateFallbackRows)
    for (const r of toInsert) {
      const p = r.payload;
      if (!r.hoodFallback || !p.street || !p.house_number || p.lat != null) continue;
      const c = await geocode(String(p.city), String(p.street), String(p.house_number));
      if (c) { p.lat = c.lat; p.lng = c.lng; p.location_precision = "exact"; delete p.neighborhood_id; }
    }

    const inserted = await insertRows(supabase, toInsert, failed);
    // ברירת המחדל של השכונה - רק מה שהפין לא הכריע
    const byHood = new Map<string, string[]>();
    inserted.forEach(({ row, got }) => {
      if (row.hoodFallback && got?.id && !got.neighborhood_id) {
        byHood.set(row.hoodFallback, [...(byHood.get(row.hoodFallback) || []), got.id]);
      }
    });
    for (const [hood, ids] of byHood) {
      await supabase.from("properties").update({ neighborhood_id: hood }).in("id", ids);
    }
    // בעלים (אם היו בקובץ) - אחרי שיש property_id
    const owners = inserted.filter(({ row, got }) => row.owner && got?.id)
      .map(({ row, got }) => ({ property_id: got.id, ...row.owner }));
    if (owners.length) {
      const { error } = await supabase.from("property_owners").insert(owners);
      if (error) console.error("import owners failed", error);
    }

    let updated = 0;
    for (const r of toUpdate) {
      const { error } = await supabase.from("properties").update(r.patch).eq("id", r.targetId);
      if (error) failed.push({ row: r.rowNumber, message: PIC.insertErrorText(error) });
      else updated++;
    }

    const rejected = parsed.filter((r) => r.errors.length)
      .map((r) => ({ row: r.rowNumber, message: r.errors.join(" · ") }));
    const result = {
      inserted: inserted.length, updated, unchanged: ready.filter((r) => r.mode === "same").length,
      rejected: rejected.length + failed.length - held.length,
      held_unconfirmed: held.length,
      guessed: ready.filter((r) => writable(r) && Object.keys(r.guessed || {}).length).length,
      no_images: inserted.filter(({ row }) => !row.payload?.images?.length).length,
      problems: [...rejected, ...failed].sort((a, b) => a.row - b.row),
    };
    await supabase.from("property_import_jobs")
      .update({ status: "done", result, finished_at: new Date().toISOString() }).eq("id", job.id);
    return { ok: true, ...result, problems: result.problems.slice(0, 8), more_problems: Math.max(0, result.problems.length - 8) };
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
