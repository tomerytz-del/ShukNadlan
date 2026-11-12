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

/** רק העמודות שאפשר להראות. אין טלפון, אין שם, אין כתובת רחוב בטבלה. */
export const BOARD_COLUMNS = "source, city, deal_type, property_type, rooms, price, url";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type BoardListingRow = {
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

export type BoardOutboxItem = {
  kind: "cta";
  body: string;
  label: string;
  url: string;
  origin: "lookup";
};

export type BoardPresentation = {
  listings: Record<string, unknown>[];
  outbox: BoardOutboxItem[];
  note: string;
  heading: string;
  total: number;
  shown: number;
  more: number;
  buttonsSent: boolean;
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

/**
 * שורות להצגה, וכפתור אחד לכל מודעה. בלי כפתורים (תור מייל) ה-url נשאר
 * בתוצאה כדי שהשכבה שמוציאה הודעה תהפוך אותו לכפתור. בטקסט של הכפתור
 * אין כתובת.
 */
export function presentBoardListings(
  rows: readonly BoardListingRow[],
  total: number,
  opts: { buttons: boolean; featuresUnchecked?: boolean },
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
  const outbox: BoardOutboxItem[] = opts.buttons
    ? picked.map(({ line, url, label }, index) => ({
      kind: "cta",
      body: index === 0 ? `${BOARD_HEADING}\n${line}` : line,
      label,
      url,
      origin: "lookup",
    }))
    : [];
  const bits = [
    `${BOARD_HEADING}. אלה מודעות ציבוריות, לא נכסים שלך ולא של המשרד. ` +
      "להציג אותן אחרי הנכסים שלך ושל המשרד, בכותרת הזו, בלי לערבב.",
    "אין טלפון ואין שם ואין כתובת רחוב. אין לפנות לבעלים, ואין חיוב. " +
      "אין שכונה במודעות. אם נשאלה שכונה, אל תאמרי שהמודעה בה.",
  ];
  if (opts.buttons) bits.push("הכפתורים יוצאים אחרי התשובה. אל תכתבי כתובת אתר.");
  else bits.push("בכל שורה יש url. העתיקי אותו לתשובה: בוואטסאפ הוא יוצא ככפתור ולא כטקסט גלוי.");
  if (opts.featuresUnchecked) {
    bits.push("אין במודעות האלה מאפיינים. אל תאמרי שיש בהן ממ״ד, מעלית או חניה.");
  }
  if (more > 0) bits.push(`מוצגות ${shown} מתוך ${counted}. יש עוד ${more}.`);
  bits.push("אם אין נכסים שלך או של המשרד ויש כאן מודעות - יש מה להראות, לא אפס.");
  return {
    listings,
    outbox,
    note: bits.join(" "),
    heading: BOARD_HEADING,
    total: counted,
    shown,
    more,
    buttonsSent: outbox.length > 0,
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
    ...(presented.buttonsSent ? { board_buttons_sent: true } : {}),
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
