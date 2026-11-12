// מודעות ציבוריות מיד2 וממדלן, כמקור שלישי בחיפוש של גבריאלה לסוכן/ת.
//
// המאגר של הסוכן/ת ושל המשרד נשארים כמו שהיו. כאן רק listing_inventory:
// מודעה באוויר (removed_at ריק), בלי טלפון ובלי שם. הקישור יוצא ככפתור
// CTA, לא ככתובת בטקסט. כשל או מלאי ריק נבלעים - החיפוש הרגיל לא נפגע.
// אין כאן ליד, התראה, ארנק או פנייה לבעלים.
// docs/listing-inventory.md, docs/whatsapp-setup.md

import { SearchCore, typePattern } from "./property-search.ts";

/** כמה מודעות מהלוחות מראים. השאר נספרות ב-more. */
export const BOARD_CAP = 5;

/** הכותרת לסוכן/ת. לא מערבים את השורות עם הנכסים שלו/ה. */
export const BOARD_HEADING = "מודעות מהלוחות יד 2 / מדלן";

/** נאמר רק כשהחיפוש בלוחות רץ והעיר כן במלאי, ואין התאמה. */
export const BOARD_NONE_LINE = "בלוחות יד 2 ומדלן אין כרגע מודעות מתאימות.";

/** נאמר כשמאפיין חובה מנע את החיפוש בלוחות. */
export const BOARD_FEATURE_LINE =
  "מודעות בלוחות יד 2 ומדלן לא נבדקו, כי אין בהן נתון על המאפיין שנדרש.";

export type BoardStatus = "matches" | "none" | "skipped_feature" | "unavailable";

/** רק העמודות לחיפוש. id ליומן ההצגה, לא לתשובה לסוכן/ת. */
export const BOARD_COLUMNS = "id, source, city, deal_type, property_type, rooms, price, url";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type BoardListingRow = {
  id?: unknown;
  source?: unknown;
  city?: unknown;
  deal_type?: unknown;
  property_type?: unknown;
  rooms?: unknown;
  price?: unknown;
  url?: unknown;
};

export type BoardScope = {
  /** true כשהסוכן/ת או כרטיס הלקוח/ה ציינו עיר. בלי מזהה לא נופלים לשוק המשרד. */
  askedCity: boolean;
  cityIds: string[];
  cityNames: string[];
  /** ערי השוק של המשרד, רק כשלא ביקשו עיר. */
  fallbackCityIds: string[];
};

export type BoardCriteria = {
  cityIds: string[];
  cityNames: string[];
  dealType: "sale" | "rent" | null;
  propertyTypes: string[];
  minPrice: number | null;
  maxPrice: number | null;
  minRooms: number | null;
  maxRooms: number | null;
};

export type BoardOp =
  | { op: "is"; column: "removed_at"; value: null }
  | { op: "eq"; column: string; value: string }
  | { op: "gte" | "lte"; column: string; value: number }
  | { op: "in"; column: "city_id" | "city"; value: string[] }
  | { op: "or"; value: string }
  | { op: "order"; column: "last_seen_at"; ascending: false }
  | { op: "limit"; value: number };

/** מזהה שורת רשימה. הלחיצה נתפסת לפני המודל ופותחת את המודעה בכפתור. */
export const BOARD_ROW_PREFIX = "bu:";
/** תקרת מזהה שורה בוואטסאפ. מעבר לה המזהה נחתך והקישור נשבר. */
export const BOARD_ROW_ID_MAX = 200;

export type BoardInteractive =
  | { kind: "cta"; body: string; label: string; url: string }
  | {
    kind: "list";
    body: string;
    button: string;
    section: string;
    rows: { id: string; title: string; description?: string }[];
  };

export type BoardPresentation = {
  listings: Record<string, unknown>[];
  /** הודעה אינטראקטיבית אחת. נשלחת רק אם התשובה מציגה את המודעות. */
  message: BoardInteractive | null;
  lines: string[];
  /** המודעות שנכנסו להודעה, באותו סדר. בלי כתובת. */
  logged: { id: string; source: "yad2" | "madlan" }[];
  note: string;
  heading: string;
  total: number;
  shown: number;
  more: number;
};

export type BoardPresentationLog = {
  agent_id: string;
  tool: "search_properties" | "client_matches";
  listing_ids: string[];
  sources: ("yad2" | "madlan")[];
};

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function texts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const s = String(item || "").trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

function uuids(value: readonly string[]): string[] {
  const out: string[] = [];
  for (const item of value) {
    const s = String(item || "").trim();
    if (!UUID_RE.test(s) || out.includes(s)) continue;
    out.push(s);
  }
  return out;
}

function dealOf(value: unknown): "sale" | "rent" | null {
  const s = String(value || "").trim();
  return s === "sale" || s === "rent" ? s : null;
}

function expandedTypes(value: unknown): string[] {
  const asked = texts(value).slice(0, 6);
  if (!asked.length) return [];
  const bt = SearchCore.botTypes(asked) as { types?: string[] };
  const out: string[] = [];
  for (const t of bt.types || []) {
    const s = String(t || "").trim();
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= 12) break;
  }
  return out;
}

/**
 * עיר שנשאלה גוברת על שוק המשרד, כולל קבוצה (חבל תענך = 12 מזהים).
 * בלי עיר - רק ערי השוק. בלי אף אחת - אין חיפוש, לא סריקה של כל הארץ.
 */
export function boardCriteria(input: {
  askedCity: boolean;
  cityIds?: readonly string[];
  cityNames?: readonly string[];
  fallbackCityIds?: readonly string[];
  dealType?: unknown;
  propertyTypes?: unknown;
  minPrice?: unknown;
  maxPrice?: unknown;
  minRooms?: unknown;
  maxRooms?: unknown;
}): BoardCriteria | null {
  const ids = uuids(input.cityIds || []);
  const names = texts(input.cityNames).slice(0, 12);
  const fallback = uuids(input.fallbackCityIds || []);
  let cityIds: string[] = [];
  let cityNames: string[] = [];
  if (input.askedCity) {
    if (ids.length) cityIds = ids;
    else if (names.length) cityNames = names;
    else return null;
  } else if (fallback.length) {
    cityIds = fallback;
  } else {
    return null;
  }
  return {
    cityIds,
    cityNames,
    dealType: dealOf(input.dealType),
    propertyTypes: expandedTypes(input.propertyTypes),
    minPrice: finite(input.minPrice),
    maxPrice: finite(input.maxPrice),
    minRooms: finite(input.minRooms),
    maxRooms: finite(input.maxRooms),
  };
}

/** סדר הפעולות על listing_inventory. בלי טווח גיאוגרפי - null, בלי שאילתה. */
export function boardQueryOps(criteria: BoardCriteria | null): BoardOp[] | null {
  if (!criteria) return null;
  const ops: BoardOp[] = [{ op: "is", column: "removed_at", value: null }];
  if (criteria.cityIds.length) ops.push({ op: "in", column: "city_id", value: criteria.cityIds });
  else if (criteria.cityNames.length) ops.push({ op: "in", column: "city", value: criteria.cityNames });
  else return null;
  if (criteria.dealType) ops.push({ op: "eq", column: "deal_type", value: criteria.dealType });
  if (criteria.minRooms !== null) ops.push({ op: "gte", column: "rooms", value: criteria.minRooms });
  if (criteria.maxRooms !== null) ops.push({ op: "lte", column: "rooms", value: criteria.maxRooms });
  if (criteria.minPrice !== null) ops.push({ op: "gte", column: "price", value: criteria.minPrice });
  if (criteria.maxPrice !== null) ops.push({ op: "lte", column: "price", value: criteria.maxPrice });
  const patterns = criteria.propertyTypes
    .map((t) => typePattern(t))
    .filter((p): p is string => !!p);
  if (patterns.length) ops.push({ op: "or", value: patterns.join(",") });
  ops.push({ op: "order", column: "last_seen_at", ascending: false });
  ops.push({ op: "limit", value: BOARD_CAP });
  return ops;
}

export function sourceLabel(source: unknown): "יד2" | "מדלן" | null {
  if (source === "yad2") return "יד2";
  if (source === "madlan") return "מדלן";
  return null;
}

export function boardButtonLabel(source: unknown): string | null {
  if (source === "yad2") return "פתיחה ביד2";
  if (source === "madlan") return "פתיחה במדלן";
  return null;
}

function boardHost(url: string): "yad2" | "madlan" | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "yad2.co.il" || host.endsWith(".yad2.co.il")) return "yad2";
    if (host === "madlan.co.il" || host.endsWith(".madlan.co.il")) return "madlan";
  } catch {
    return null;
  }
  return null;
}

/** מזהה שורה רק לכתובת לוח קצרה מספיק. אחרת אין שורה, כי חיתוך שובר את הקישור. */
export function boardRowId(url: string): string | null {
  const safe = safeListingUrl(url);
  if (!safe || !boardHost(safe)) return null;
  const id = BOARD_ROW_PREFIX + safe;
  return id.length <= BOARD_ROW_ID_MAX ? id : null;
}

/** הכתובת מלחיצה על שורת הרשימה. רק יד2 ומדלן. */
export function boardUrlFromRowId(id: string): string | null {
  if (!id.startsWith(BOARD_ROW_PREFIX)) return null;
  const url = safeListingUrl(id.slice(BOARD_ROW_PREFIX.length));
  if (!url || !boardHost(url)) return null;
  return url;
}

export function boardButtonLabelForUrl(url: string): string | null {
  const host = boardHost(url);
  return host ? boardButtonLabel(host) : null;
}

/**
 * מאפיין חובה שהמלאי לא יכול לאמת (ממ״ד, מעלית, חניה) חוסם את הלוחות.
 * ויתור מפורש על כולם אינו חובה יותר. בלי מאפיין - מצרפים.
 */
/**
 * אפס אחרי חיפוש אמיתי הוא none רק אם בעיר יש מלאי. עיר בלי מלאי,
 * או כשל, הם unavailable - לא אומרים "אין מודעות".
 */
export function boardSearchStatus(input: {
  filtered: number | null;
  cityStock: number | null;
}): BoardStatus {
  if (input.filtered === null || input.filtered < 0) return "unavailable";
  if (input.filtered > 0) return "matches";
  if (input.cityStock === null || input.cityStock <= 0) return "unavailable";
  return "none";
}

/** ספירת המלאי החי בעיר, בלי שאר הסינונים. */
export function boardCityStockCriteria(criteria: BoardCriteria): BoardCriteria {
  return {
    cityIds: criteria.cityIds,
    cityNames: criteria.cityNames,
    dealType: null,
    propertyTypes: [],
    minPrice: null,
    maxPrice: null,
    minRooms: null,
    maxRooms: null,
  };
}

export function boardStatusFields(status: BoardStatus): Record<string, unknown> {
  if (status === "none") {
    return {
      board_status: status,
      board_say: BOARD_NONE_LINE,
      board_note: "החיפוש בלוחות רץ ואין התאמה. כתבי את board_say כמו שהוא, בתוך התשובה. בלי הודעה נוספת.",
    };
  }
  if (status === "skipped_feature") {
    return {
      board_status: status,
      board_say: BOARD_FEATURE_LINE,
      board_note: "הלוחות לא נבדקו. כתבי את board_say בקצרה. אל תאמרי שאין בהם מודעות.",
    };
  }
  if (status === "unavailable") {
    return {
      board_status: status,
      board_note: "הלוחות לא נבדקו, או שאין מלאי לעיר. אל תאמרי שאין מודעות ביד 2 ובמדלן.",
    };
  }
  return { board_status: status };
}

export function shouldAttachBoardListings(input: {
  features?: readonly unknown[] | null;
  required?: readonly unknown[] | null;
  waived?: readonly unknown[] | null;
}): boolean {
  if (texts(input.features).length) return false;
  const waived = new Set(texts(input.waived));
  return !texts(input.required).some((feature) => !waived.has(feature));
}

function clipChars(value: string, max: number): string {
  return Array.from(value).slice(0, max).join("");
}

function foldText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** התשובה מציגה את המודעות. בלי הכותרת או שורת מודעה - אין הודעה. */
export function replyPresentsBoard(reply: string, lines: readonly string[]): boolean {
  const text = foldText(reply);
  if (!text) return false;
  if (text.includes(foldText("אין מודעות מהלוחות"))) return false;
  if (text.includes(foldText(BOARD_HEADING)) || text.includes(foldText("מודעות מהלוחות"))) return true;
  for (const line of lines) {
    const folded = foldText(line);
    if (folded && text.includes(folded)) return true;
  }
  return false;
}

/** הודעה אחת, ורק אם התשובה הציגה את המודעות. */
export function boardInteractiveForReply(
  reply: string,
  lines: readonly string[],
  message: BoardInteractive | null,
): BoardInteractive | null {
  if (!message || !replyPresentsBoard(reply, lines)) return null;
  return message;
}

function listingUuid(value: unknown): string | null {
  const s = String(value || "").trim();
  return UUID_RE.test(s) ? s : null;
}

/** שורת יומן רק להודעה שבאמת יוצאת. בלי הצגה, או בלי מזהים תקינים - null. */
export function boardPresentationLog(input: {
  agentId: string;
  tool: unknown;
  reply: string;
  lines: readonly string[];
  message: BoardInteractive | null;
  logged: readonly { id?: unknown; source?: unknown }[];
}): BoardPresentationLog | null {
  if (!boardInteractiveForReply(input.reply, input.lines, input.message)) return null;
  const tool = input.tool === "search_properties" || input.tool === "client_matches" ? input.tool : null;
  const agentId = listingUuid(input.agentId);
  if (!tool || !agentId) return null;
  const listingIds: string[] = [];
  const sources: ("yad2" | "madlan")[] = [];
  for (const row of input.logged) {
    const id = listingUuid(row.id);
    const source = row.source === "yad2" || row.source === "madlan" ? row.source : null;
    if (!id || !source) continue;
    listingIds.push(id);
    sources.push(source);
  }
  if (!listingIds.length) return null;
  return { agent_id: agentId, tool, listing_ids: listingIds, sources };
}

/** כתיבה ליומן. כשל לא עולה למעלה. */
export async function recordBoardPresentation(
  db: {
    from(table: string): {
      insert(row: BoardPresentationLog): PromiseLike<{ error: { message?: string } | null }>;
    };
  },
  row: BoardPresentationLog | null,
): Promise<void> {
  if (!row) return;
  try {
    const { error } = await db.from("board_listing_presentations").insert(row);
    if (error) console.warn("board presentation log skipped", error.message || "error");
  } catch (err) {
    console.warn("board presentation log skipped", err instanceof Error ? err.message : "error");
  }
}

/** https בלבד, בלי רווח, בתקרת העמודה. אחרת אין כפתור ואין שורה. */
export function safeListingUrl(url: unknown): string | null {
  const s = String(url || "").trim();
  if (!s.startsWith("https://") || s.length > 500 || /\s/.test(s)) return null;
  return s;
}

function formatNis(n: number): string {
  const digits = Math.round(n).toString();
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function roomsLabel(n: number): string {
  const s = Number.isInteger(n) ? String(n) : String(n);
  return `${s} חדרים`;
}

function dealLabel(deal: "sale" | "rent" | null): string | null {
  if (deal === "sale") return "למכירה";
  if (deal === "rent") return "להשכרה";
  return null;
}

export function boardLine(row: BoardListingRow): string | null {
  const label = sourceLabel(row.source);
  const url = safeListingUrl(row.url);
  if (!label || !url) return null;
  const deal = dealOf(row.deal_type);
  const rooms = finite(row.rooms);
  const price = finite(row.price);
  const kind = String(row.property_type || "").trim();
  const city = String(row.city || "").trim();
  const priceText = price !== null && price > 0
    ? `${formatNis(price)} ₪${deal === "rent" ? " לחודש" : ""}`
    : "";
  return [
    label,
    kind || null,
    rooms !== null && rooms > 0 ? roomsLabel(rooms) : null,
    dealLabel(deal),
    priceText || null,
    city || null,
  ].filter(Boolean).join(" - ");
}

function rowTitle(row: BoardListingRow, label: string): string {
  const rooms = finite(row.rooms);
  const title = rooms !== null && rooms > 0 ? `${label} - ${roomsLabel(rooms)}` : label;
  return clipChars(title, 24);
}

/**
 * הודעה אינטראקטיבית אחת. מודעה אחת: כפתור קישור. כמה: רשימה אחת,
 * כי וואטסאפ מתיר כפתור קישור אחד להודעה. אין כתובת בגוף.
 */
export function boardInteractiveMessage(
  picked: readonly { row: BoardListingRow; line: string; url: string; label: string }[],
): BoardInteractive | null {
  const openable = picked.flatMap((item) => {
    const id = boardRowId(item.url);
    return id ? [{ ...item, id }] : [];
  });
  if (!openable.length) return null;
  if (openable.length === 1) {
    const one = openable[0];
    return {
      kind: "cta",
      body: `${BOARD_HEADING}\n${one.line}`,
      label: one.label,
      url: one.url,
    };
  }
  return {
    kind: "list",
    body: BOARD_HEADING,
    button: "למודעות",
    section: "יד2 / מדלן",
    rows: openable.map((item) => {
      const description = clipChars(item.line, 72);
      const title = rowTitle(item.row, sourceLabel(item.row.source) || item.label);
      return {
        id: item.id,
        title,
        ...(description ? { description } : {}),
      };
    }),
  };
}

/**
 * שורות להצגה. הודעת הלוחות היא אחת, ונשלחת רק אם התשובה מציגה אותן.
 * בלי כפתורים (תור מייל) ה-url נשאר בתוצאה. בטקסט אין כתובת.
 */
export function presentBoardListings(
  rows: readonly BoardListingRow[],
  total: number,
  opts: { buttons: boolean },
): BoardPresentation | null {
  const picked: { row: BoardListingRow; line: string; url: string; label: string }[] = [];
  for (const row of rows) {
    if (picked.length >= BOARD_CAP) break;
    const line = boardLine(row);
    const url = safeListingUrl(row.url);
    const label = boardButtonLabel(row.source);
    if (!line || !url || !label) continue;
    picked.push({ row, line, url, label });
  }
  if (!picked.length) return null;
  const shown = picked.length;
  const counted = Number.isFinite(total) && total >= shown ? Math.floor(total) : shown;
  const more = counted - shown;
  const listings = picked.map(({ row, line, url }) => {
    const deal = dealOf(row.deal_type);
    const item: Record<string, unknown> = {
      source: row.source,
      source_label: sourceLabel(row.source),
      city: String(row.city || "").trim() || null,
      deal_type: deal,
      deal_label: dealLabel(deal),
      property_type: String(row.property_type || "").trim() || null,
      rooms: finite(row.rooms),
      price: finite(row.price),
      line,
    };
    if (!opts.buttons) item.url = url;
    return item;
  });
  const lines = picked.map((item) => item.line);
  const message = opts.buttons ? boardInteractiveMessage(picked) : null;
  const logged: { id: string; source: "yad2" | "madlan" }[] = [];
  for (const item of picked) {
    if (!boardRowId(item.url)) continue;
    const id = listingUuid(item.row.id);
    const source = item.row.source === "yad2" || item.row.source === "madlan" ? item.row.source : null;
    if (id && source) logged.push({ id, source });
  }
  const bits = [
    `${BOARD_HEADING}. אלה מודעות ציבוריות, לא נכסים שלך ולא של המשרד. ` +
      "להציג אותן אחרי הנכסים שלך ושל המשרד, בכותרת הזו, בלי לערבב.",
    "אין טלפון ואין שם ואין כתובת רחוב. אין לפנות לבעלים, ואין חיוב. " +
      "אין שכונה במודעות. אם נשאלה שכונה, אל תאמרי שהמודעה בה.",
  ];
  if (opts.buttons) {
    bits.push(
      "אם את מציגה את המודעות, כתבי את הכותרת ואל תכתבי כתובת אתר. " +
        "הודעה אחת יוצאת אחרי התשובה. אם אינך מציגה אותן, אל תכתבי את הכותרת.",
    );
  } else {
    bits.push("בכל שורה יש url. העתיקי אותו לתשובה: בוואטסאפ הוא יוצא ככפתור ולא כטקסט גלוי.");
  }
  if (more > 0) bits.push(`מוצגות ${shown} מתוך ${counted}. יש עוד ${more}.`);
  bits.push("אם אין נכסים שלך או של המשרד ויש כאן מודעות - יש מה להראות, לא אפס.");
  return {
    listings,
    message,
    lines,
    logged,
    note: bits.join(" "),
    heading: BOARD_HEADING,
    total: counted,
    shown,
    more,
  };
}

export function boardToolFields(presented: BoardPresentation | null): Record<string, unknown> {
  if (!presented) return {};
  return {
    board_listings: presented.listings,
    board_total: presented.total,
    board_shown: presented.shown,
    board_more: presented.more,
    board_heading: presented.heading,
    board_note: presented.note,
  };
}

type BoardResult = {
  data: BoardListingRow[] | null;
  error: { message?: string } | null;
  count: number | null;
};

// deno-lint-ignore no-explicit-any
type BoardQuery = any;

/**
 * קריאה ל-listing_inventory דרך לקוח service_role. שגיאה או טבלה חסרה
 * מחזירות null, והכלי לא מספר על זה.
 */
export async function fetchBoardListings(
  db: { from(table: string): BoardQuery },
  criteria: BoardCriteria | null,
): Promise<{ rows: BoardListingRow[]; total: number } | null> {
  const ops = boardQueryOps(criteria);
  if (!ops) return null;
  try {
    let query = db.from("listing_inventory").select(BOARD_COLUMNS, { count: "exact" });
    for (const op of ops) {
      if (op.op === "is") query = query.is(op.column, op.value);
      else if (op.op === "eq") query = query.eq(op.column, op.value);
      else if (op.op === "gte") query = query.gte(op.column, op.value);
      else if (op.op === "lte") query = query.lte(op.column, op.value);
      else if (op.op === "in") query = query.in(op.column, op.value);
      else if (op.op === "or") query = query.or(op.value);
      else if (op.op === "order") query = query.order(op.column, { ascending: op.ascending });
      else if (op.op === "limit") query = query.limit(op.value);
    }
    const res = await query as BoardResult;
    if (res.error || !res.data) {
      console.warn("board listings skipped", res.error?.message || "empty");
      return null;
    }
    const total = typeof res.count === "number" ? res.count : res.data.length;
    return { rows: res.data, total };
  } catch (err) {
    console.warn("board listings skipped", err instanceof Error ? err.message : "error");
    return null;
  }
}
