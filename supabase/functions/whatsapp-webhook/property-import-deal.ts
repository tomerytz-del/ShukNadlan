/**
 * שורות בלי סוג עסקה בייבוא דרך גבריאלה.
 *
 * הליבה פוסלת כל שורה שחסר בה מכירה או השכרה. כשכל העמודה ריקה זה נראה
 * כמו פסילה של הקובץ, ואין לגבריאלה דרך למלא. כאן השורות התקינות נכנסות,
 * והשורות שהשדה היחיד שחסר בהן הוא סוג עסקה נשמרות עד שהסוכן/ת בוחר/ת.
 *
 * אין ניחוש ואין ברירת מחדל (כלל של תומר): נכנס רק ערך שהסוכן/ת אמר/ה.
 * "הכל למכירה" ממלא רק תאים ריקים, לא שורה שכבר יש בה סוג עסקה ולא בחירה
 * מפורשת שכבר נרשמה. "לפי שורה" לפי מספר שורה או כתובת, ואפשר לדלג.
 * שורה שדילגו עליה לא נכנסת.
 */

export type DealCode = "sale" | "rent";

export type ImportDealAction =
  | { type: "all"; deal: DealCode }
  | { type: "per_row" }
  | { type: "reply"; text: string };

export const DEAL_HOLD_MS = 24 * 60 * 60 * 1000;

export const DEAL_BUTTON_TITLES = {
  sale: "הכל למכירה",
  rent: "הכל להשכרה",
  row: "לפי שורה",
} as const;

const JOB_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUTTON_RE = /^pideal:(sale|rent|row):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const PHONE_RE = /(?:\+972|972|0)[-\s]?\d(?:[-\s]?\d){7,9}/g;
const URL_RE = /https?:\/\/\S+|www\.\S+|shuknadlan\.co\.il\S*/gi;

export interface HeldDealRow {
  row: number;
  address: string;
  label: string;
}

export interface SkipReason {
  row: number;
  why: string;
}

export interface DealHold {
  expires_at: string;
  mode: "ask" | "per_row";
  rows: HeldDealRow[];
  /** רק בחירה מפורשת. המפתח הוא מספר השורה בגיליון. */
  choices: Record<string, DealCode>;
  skipped: number[];
  inserted: number[];
  updated: number[];
  unchanged: number[];
  skipped_reasons: SkipReason[];
  /** ניחושים שכבר אושרו בתור הקודם, כדי שהמשך הבחירה לא ישאל שוב. */
  accepted_guesses?: string[];
}

export interface ParsedLike {
  rowNumber: number;
  errors?: string[];
  errorFields?: string[];
  payload?: {
    deal_type?: string;
    property_type?: string;
    street?: string;
    house_number?: string;
    city?: string;
    title?: string;
  };
}

export function dealButtonId(key: "sale" | "rent" | "row", jobId: string): string {
  return `pideal:${key}:${jobId}`;
}

export function dealButtons(jobId: string): { id: string; title: string }[] {
  return (["sale", "rent", "row"] as const).map((key) => ({
    id: dealButtonId(key, jobId),
    title: DEAL_BUTTON_TITLES[key],
  }));
}

export function parseDealButtonId(id: string): { key: "sale" | "rent" | "row"; jobId: string } | null {
  const m = BUTTON_RE.exec(String(id || "").trim());
  if (!m || !JOB_RE.test(m[2])) return null;
  return { key: m[1].toLowerCase() as "sale" | "rent" | "row", jobId: m[2] };
}

/** טקסט לסוכן/ת: בלי כתובת אתר ובלי מספר טלפון. */
export function stripPrivate(text: string): string {
  return String(text || "")
    .replace(URL_RE, "")
    .replace(PHONE_RE, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.:])/g, "$1")
    .trim();
}

export function isEmptyDealOnly(row: { errors?: unknown; errorFields?: unknown }): boolean {
  const fields = Array.isArray(row.errorFields) ? row.errorFields : [];
  if (fields.length !== 1 || fields[0] !== "deal_type") return false;
  const errors = Array.isArray(row.errors) ? row.errors : [];
  return errors.some((e) => String(e).includes("(ריק)"));
}

export function splitImportRows<T extends ParsedLike>(rows: T[]): { ready: T[]; hold: T[]; rejected: T[] } {
  const ready: T[] = [];
  const hold: T[] = [];
  const rejected: T[] = [];
  for (const row of rows) {
    if (!row.errors?.length) ready.push(row);
    else if (isEmptyDealOnly(row)) hold.push(row);
    else rejected.push(row);
  }
  return { ready, hold, rejected };
}

export function rowAddress(row: { payload?: { street?: unknown; house_number?: unknown; city?: unknown; title?: unknown } | null }): string {
  const p = row.payload || {};
  const street = [p.street, p.house_number].filter(Boolean).join(" ");
  const addr = [street, p.city].filter(Boolean).join(", ");
  return stripPrivate(addr || String(p.title || "")).slice(0, 80);
}

export function rowLabel(row: { payload?: { property_type?: unknown; title?: unknown } | null }): string {
  const p = row.payload || {};
  return stripPrivate(String(p.property_type || p.title || "")).slice(0, 40);
}

export function snapshotHeld(row: { rowNumber?: unknown; payload?: unknown }): HeldDealRow {
  const payload = row.payload && typeof row.payload === "object" ? row.payload as { street?: unknown; house_number?: unknown; city?: unknown; title?: unknown; property_type?: unknown } : {};
  return { row: Number(row.rowNumber), address: rowAddress({ payload }), label: rowLabel({ payload }) };
}

export function emptyHold(rows: HeldDealRow[], expiresAt: string): DealHold {
  return {
    expires_at: expiresAt,
    mode: "ask",
    rows,
    choices: {},
    skipped: [],
    inserted: [],
    updated: [],
    unchanged: [],
    skipped_reasons: [],
    accepted_guesses: [],
  };
}

export function holdExpiry(jobCreatedAt: string, now = Date.now()): string {
  const created = Date.parse(jobCreatedAt);
  const jobEnd = (Number.isFinite(created) ? created : now) + DEAL_HOLD_MS;
  return new Date(Math.min(jobEnd, now + DEAL_HOLD_MS)).toISOString();
}

export function holdExpired(hold: DealHold | null | undefined, now = Date.now()): boolean {
  if (!hold?.expires_at) return true;
  const at = Date.parse(hold.expires_at);
  return !Number.isFinite(at) || at <= now;
}

export function readHold(raw: unknown): DealHold | null {
  if (!raw || typeof raw !== "object") return null;
  const h = raw as Partial<DealHold>;
  if (!Array.isArray(h.rows) || typeof h.expires_at !== "string") return null;
  const choices: Record<string, DealCode> = {};
  for (const [k, v] of Object.entries(h.choices || {})) {
    if (v === "sale" || v === "rent") choices[String(k)] = v;
  }
  return {
    expires_at: h.expires_at,
    mode: h.mode === "per_row" ? "per_row" : "ask",
    rows: h.rows.filter((r) => r && Number.isFinite(r.row)).map((r) => ({
      row: Number(r.row),
      address: stripPrivate(String(r.address || "")).slice(0, 80),
      label: stripPrivate(String(r.label || "")).slice(0, 40),
    })),
    choices,
    skipped: numList(h.skipped),
    inserted: numList(h.inserted),
    updated: numList(h.updated),
    unchanged: numList(h.unchanged),
    skipped_reasons: Array.isArray(h.skipped_reasons)
      ? h.skipped_reasons.filter((s) => s && Number.isFinite(s.row)).map((s) => ({
        row: Number(s.row),
        why: stripPrivate(String(s.why || "")).slice(0, 160),
      }))
      : [],
    accepted_guesses: Array.isArray(h.accepted_guesses) ? h.accepted_guesses.map(String) : [],
  };
}

function numList(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return v.map(Number).filter((n) => Number.isFinite(n));
}

/** עקיפה לליבה: רק שורות שהסוכן/ת בחר/ה, ורק אם לא דילגו עליהן. */
export function choiceOverrides(hold: DealHold | null): Record<number, { deal_type: string }> {
  if (!hold) return {};
  const skipped = new Set(hold.skipped);
  const out: Record<number, { deal_type: string }> = {};
  for (const [row, deal] of Object.entries(hold.choices)) {
    const n = Number(row);
    if (!n || skipped.has(n)) continue;
    out[n] = { deal_type: deal === "rent" ? "השכרה" : "מכירה" };
  }
  return out;
}

export function awaitingRows(hold: DealHold): HeldDealRow[] {
  const skipped = new Set(hold.skipped);
  return hold.rows.filter((r) => !skipped.has(r.row) && !hold.choices[String(r.row)]);
}

/**
 * "הכל למכירה" / "הכל להשכרה" - רק שורות שעדיין בלי בחירה ובלי דילוג.
 * שורה שכבר נבחרה במפורש לא מתחלפת.
 */
export function fillEmptyDeals(hold: DealHold, deal: DealCode): DealHold {
  const choices = { ...hold.choices };
  const skipped = new Set(hold.skipped);
  for (const row of hold.rows) {
    if (skipped.has(row.row)) continue;
    if (choices[String(row.row)]) continue;
    choices[String(row.row)] = deal;
  }
  return { ...hold, choices, mode: "ask" };
}

const DEAL_WORD = "מכירה|למכירה|השכרה|להשכרה|שכירות|sale|rent";
const ALL_SALE = /^(?:הכל|כולם|כולן)\s+(?:ל)?מכירה$/;
const ALL_RENT = /^(?:הכל|כולם|כולן)\s+(?:ל)?השכרה$/;
const FINISH = /^(?:סיימתי|זהו|זה הכל|דלג על השאר|בלי השאר)$/;
const SKIP_ROW = /^(?:דלג|לדלג|בלי|לא לייבא|לא לקלוט)(?:\s+על)?\s+(?:שורה\s+)?(\d+)$/;
const SKIP_TAIL = /^שורה\s+(\d+)\s+(?:דלג|לדלג|לא)$/;
const ASSIGN = new RegExp(`^(?:שורה\\s+)?(\\d+)\\s*[-:]?\\s*(${DEAL_WORD})$`);
const ADDR = new RegExp(`^(.*?)\\s+(${DEAL_WORD})$`);

export function dealWord(word: string): DealCode | null {
  const w = word.trim().toLowerCase();
  if (w === "מכירה" || w === "למכירה" || w === "sale") return "sale";
  if (w === "השכרה" || w === "להשכרה" || w === "שכירות" || w === "rent") return "rent";
  return null;
}

function normAddr(s: string): string {
  return s.replace(/["'״׳.,]/g, " ").replace(/\s+/g, " ").trim().replace(/^רחוב\s+/, "");
}

function clauses(text: string): string[] {
  return text
    .replace(/\s+ו(?:גם\s+)?(?=שורה|\d|דלג)/g, "\n")
    .split(/\n+|[,;]|·/)
    .map((s) => s.replace(/^(?:ו|גם)\s+/, "").trim())
    .filter(Boolean);
}

function tidy(text: string): string {
  return text
    .replace(/[!?.]+$/g, "")
    .replace(/\s+(?:בבקשה|תודה|עכשיו)$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface DealText {
  all?: DealCode;
  assignments: { row: number; deal: DealCode }[];
  skips: number[];
  skipRest: boolean;
  clarify?: string;
}

/** null כשזה לא מענה על השאלה. clarify בלי שינוי כשיש יותר מהתאמה אחת. */
export function interpretDealText(text: string, hold: DealHold): DealText | null {
  const raw = tidy(text);
  if (!raw) return null;
  if (ALL_SALE.test(raw)) return { all: "sale", assignments: [], skips: [], skipRest: false };
  if (ALL_RENT.test(raw)) return { all: "rent", assignments: [], skips: [], skipRest: false };
  if (FINISH.test(raw)) return { assignments: [], skips: [], skipRest: true };
  if (!/מכירה|השכרה|שכירות|\b(?:sale|rent)\b|דלג|סיימתי|זהו|לפי שורה/.test(raw)) return null;
  if (raw === "לפי שורה") return { assignments: [], skips: [], skipRest: false, clarify: "per_row" };

  const assignments: { row: number; deal: DealCode }[] = [];
  const skips: number[] = [];
  let skipRest = false;
  let structured = false;
  const ambiguous: string[] = [];
  const unknown: string[] = [];
  const known = new Map(hold.rows.map((r) => [r.row, r]));

  for (const clause of clauses(raw)) {
    const bit = tidy(clause);
    if (!bit) continue;
    if (FINISH.test(bit)) { skipRest = true; structured = true; continue; }
    const skip = SKIP_ROW.exec(bit) || SKIP_TAIL.exec(bit);
    if (skip) { skips.push(Number(skip[1])); structured = true; continue; }
    const assigned = ASSIGN.exec(bit);
    if (assigned) {
      const row = Number(assigned[1]);
      const deal = dealWord(assigned[2]);
      if (!deal) continue;
      structured = true;
      if (!known.has(row)) unknown.push(String(row));
      else assignments.push({ row, deal });
      continue;
    }
    const addr = ADDR.exec(bit);
    if (addr) {
      const deal = dealWord(addr[2]);
      const query = normAddr(addr[1].replace(/^שורה\s+\d+\s*/, ""));
      // בלי ספרה זו לא כתובת ("מה עם המכירה") אלא משפט. לא תופסים את התור.
      if (!deal || query.length < 2 || !/\d/.test(query)) continue;
      structured = true;
      const hits = hold.rows.filter((r) => {
        const a = normAddr(r.address);
        return a.length > 0 && (a.includes(query) || query.includes(a));
      });
      if (hits.length === 1) assignments.push({ row: hits[0].row, deal });
      else if (hits.length > 1) ambiguous.push(query);
      else unknown.push(query);
    }
  }

  if (!structured) return null;
  if (!assignments.length && !skips.length && !skipRest) {
    if (ambiguous.length) {
      return {
        assignments: [],
        skips: [],
        skipRest: false,
        clarify: `יש יותר משורה אחת שמתאימה ל"${stripPrivate(ambiguous[0])}". כתבו את מספר השורה.`,
      };
    }
    if (unknown.length) {
      return {
        assignments: [],
        skips: [],
        skipRest: false,
        clarify: "לא מצאתי שורה שממתינה לזה. אפשר לפי מספר שורה, למשל: שורה 3 מכירה.",
      };
    }
    return null;
  }
  if (ambiguous.length) {
    return {
      assignments: [],
      skips: [],
      skipRest: false,
      clarify: `יש יותר משורה אחת שמתאימה ל"${stripPrivate(ambiguous[0])}". כתבו את מספר השורה, ולא שיניתי כלום.`,
    };
  }
  let clarify: string | undefined;
  if (unknown.length) {
    clarify = `לא מצאתי את ${unknown.slice(0, 3).map((u) => stripPrivate(u)).join(", ")} בין השורות שממתינות.`;
  }
  return { assignments, skips, skipRest, clarify };
}

export function applyDealText(hold: DealHold, text: string): { hold: DealHold; clarify?: string; perRow?: boolean; changed: boolean } | null {
  const parsed = interpretDealText(text, hold);
  if (!parsed) return null;
  if (parsed.clarify === "per_row") return { hold: { ...hold, mode: "per_row" }, perRow: true, changed: hold.mode !== "per_row" };
  if (parsed.clarify && !parsed.assignments.length && !parsed.skips.length && !parsed.skipRest && !parsed.all) {
    return { hold, clarify: parsed.clarify, changed: false };
  }
  let next = parsed.all ? fillEmptyDeals(hold, parsed.all) : { ...hold, choices: { ...hold.choices }, skipped: hold.skipped.slice(), skipped_reasons: hold.skipped_reasons.slice() };
  const choices = { ...next.choices };
  for (const a of parsed.assignments) {
    if (next.skipped.includes(a.row)) continue;
    if (next.inserted.includes(a.row) || next.updated.includes(a.row)) continue;
    choices[String(a.row)] = a.deal;
  }
  const skipped = new Set(next.skipped);
  const reasons = next.skipped_reasons.slice();
  const skipOne = (row: number, why: string) => {
    if (next.inserted.includes(row) || next.updated.includes(row)) return;
    if (!hold.rows.some((r) => r.row === row) && !awaitingRows(hold).some((r) => r.row === row)) return;
    skipped.add(row);
    delete choices[String(row)];
    if (!reasons.some((s) => s.row === row)) reasons.push({ row, why });
  };
  for (const row of parsed.skips) skipOne(row, "ביקשת לדלג");
  next = { ...next, choices, skipped: [...skipped], skipped_reasons: reasons };
  if (parsed.skipRest) {
    for (const row of awaitingRows(next)) skipOne(row.row, "לא נבחר סוג עסקה");
    next = { ...next, skipped: [...skipped], choices, skipped_reasons: reasons };
  }
  const extra = parsed.clarify ? ` ${parsed.clarify}` : "";
  return { hold: next, clarify: extra.trim() || undefined, changed: true };
}

export function dealAskBody(count: number): string {
  const n = count === 1 ? "שורה אחת בלי סוג עסקה" : `${count} שורות בלי סוג עסקה`;
  return `${n}. לא אמלא לבד, גם לא לפי המחיר.`;
}

export function perRowBody(rows: HeldDealRow[]): string {
  const lines = [
    "כתבו לכל שורה מכירה או השכרה, או דלג על שורה. מה שלא תסמנו לא ייכנס.",
    "אפשר גם: הכל למכירה, הכל להשכרה, או סיימתי.",
    "",
  ];
  const shown = rows.slice(0, 12);
  for (const r of shown) {
    const where = r.address ? ` ${r.address}` : "";
    const what = r.label ? ` (${r.label})` : "";
    lines.push(`· שורה ${r.row}${where}${what}`);
  }
  if (rows.length > shown.length) lines.push(`· ועוד ${rows.length - shown.length}. אפשר לפי מספר שורה.`);
  return lines.join("\n");
}

export function importSummary(opts: {
  inserted: number;
  updated: number;
  unchanged?: number;
  skipped: SkipReason[];
}): string {
  const lines: string[] = [];
  if (opts.inserted === 0 && opts.updated === 0) lines.push("לא נקלט אף נכס חדש.");
  else if (opts.inserted === 1 && opts.updated === 0) lines.push("נקלט נכס אחד.");
  else if (opts.inserted === 0) lines.push(opts.updated === 1 ? "עודכן נכס אחד." : `עודכנו ${opts.updated} נכסים.`);
  else {
    const fresh = opts.inserted === 1 ? "נקלט נכס אחד" : `נקלטו ${opts.inserted} נכסים`;
    lines.push(opts.updated ? `${fresh}, ועודכנו ${opts.updated}.` : `${fresh}.`);
  }
  if (opts.unchanged) lines.push(opts.unchanged === 1 ? "נכס אחד כבר היה זהה, בלי שינוי." : `${opts.unchanged} כבר היו זהים, בלי שינוי.`);
  const skipped = [...opts.skipped].sort((a, b) => a.row - b.row);
  if (skipped.length) {
    lines.push(skipped.length === 1 ? "דילגתי על שורה אחת:" : `דילגתי על ${skipped.length}:`);
    for (const s of skipped.slice(0, 8)) lines.push(`· שורה ${s.row}: ${stripPrivate(s.why)}`);
    if (skipped.length > 8) lines.push(`· ועוד ${skipped.length - 8}.`);
  }
  return lines.join("\n");
}

export function rejectionWhy(errors: string[]): string {
  const msg = (errors[0] || "לא נקלט").split(". לתיקון:")[0];
  return stripPrivate(msg).slice(0, 160);
}
