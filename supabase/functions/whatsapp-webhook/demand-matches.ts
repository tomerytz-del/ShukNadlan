// פוסטים בפייסבוק (ביקוש פתוח) שמתאימים ללקוח/ה, בהודעת הוואטסאפ של גבריאלה.
//
// המקור: agent_client_demand_matches_for_agent (20271120140000). כל פוסט חוזר
// עם link_token, והשורה ברשימה נושאת אותו (dc:<token>). **בחירה בשורה אינה
// תפיסה**: היא שולחת כפתור, והלחיצה על הכפתור פותחת את /demand?k=, ושם נעשה
// "אני פונה" (supabase/functions/demand-claim). בוט, תצוגה מקדימה ובחירה
// בטעות לא תופסים כלום.
//
// הפוסט אנונימי (עיר, סוג, חדרים, מחיר מבוקש, גיל). אין כאן קישור לפוסט,
// טלפון או פרטי נכס: הקישור נחשף רק אחרי התפיסה. docs/scraped-leads.md,
// docs/listing-inventory.md.

import {
  BOARD_CAP,
  BOARD_HEADING,
  DEMAND_HEADING,
  type BoardInteractive,
  type BoardListingRow,
  boardListRows,
} from "./board-listings.ts";

/** מזהה שורת רשימה של פוסט. הלחיצה נתפסת לפני המודל ושולחת כפתור. */
export const DEMAND_ROW_PREFIX = "dc:";

const TOKEN_RE = /^[0-9a-f]{32}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** רשימה בוואטסאפ: עד עשר שורות. */
const LIST_MAX_ROWS = 10;

export type DemandItem = {
  id: string;
  token: string;
  city: string;
  dealType: "sale" | "rent" | null;
  propertyType: string;
  rooms: number | null;
  price: number | null;
  score: number;
  daysAgo: number | null;
  mine: boolean;
};

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** התשובה של ה-RPC -> פריטים תקינים בלבד, באותו סדר. פריט בלי טוקן תקין נושר. */
export function demandItems(result: unknown): DemandItem[] {
  const raw = result && typeof result === "object" ? (result as { items?: unknown }).items : null;
  if (!Array.isArray(raw)) return [];
  const out: DemandItem[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const r = it as Record<string, unknown>;
    const id = String(r.id || "");
    const token = String(r.link_token || "");
    const score = num(r.score);
    if (!UUID_RE.test(id) || !TOKEN_RE.test(token) || score === null) continue;
    out.push({
      id,
      token,
      city: String(r.city || "").trim(),
      dealType: r.deal_type === "rent" ? "rent" : r.deal_type === "sale" ? "sale" : null,
      propertyType: String(r.property_type || "").trim(),
      rooms: num(r.rooms),
      price: num(r.price),
      score,
      daysAgo: num(r.days_ago),
      mine: r.mine === true,
    });
  }
  return out;
}

export function demandRowId(token: string): string | null {
  return TOKEN_RE.test(token) ? DEMAND_ROW_PREFIX + token : null;
}

/** הטוקן משורת הרשימה שנבחרה. כל מה שאינו 32 תווים הקסדצימליים - null. */
export function demandTokenFromRowId(id: string): string | null {
  if (!id.startsWith(DEMAND_ROW_PREFIX)) return null;
  const token = id.slice(DEMAND_ROW_PREFIX.length);
  return TOKEN_RE.test(token) ? token : null;
}

export function demandUrl(siteBase: string, token: string): string | null {
  if (!siteBase || !TOKEN_RE.test(token)) return null;
  return `${siteBase.replace(/\/+$/, "")}/demand?k=${token}`;
}

function nis(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function ageLabel(days: number | null): string | null {
  if (days === null) return null;
  return days === 0 ? "פורסם היום" : days === 1 ? "פורסם אתמול" : `פורסם לפני ${days} ימים`;
}

/** שורת טקסט לפוסט. אנונימית: בלי קישור, טלפון או כתובת. */
export function demandLine(item: DemandItem): string {
  const priceText = item.price !== null && item.price > 0
    ? `${nis(item.price)} ₪${item.dealType === "rent" ? " לחודש" : ""} (מבוקש)`
    : "";
  return [
    "פייסבוק",
    item.propertyType || null,
    item.rooms !== null && item.rooms > 0 ? `${item.rooms} חדרים` : null,
    item.dealType === "rent" ? "להשכרה" : item.dealType === "sale" ? "למכירה" : null,
    priceText || null,
    item.city || null,
    ageLabel(item.daysAgo),
    item.mine ? "כבר תפסת" : null,
  ].filter(Boolean).join(" - ");
}

/**
 * חיתוך משותף ללוחות ולפוסטים: עד `cap` שורות בסך הכול, לפי ציון. בשוויון -
 * הלוח קודם: הקישור שלו חופשי, ואילו פוסט נתפס בלחיצה ונספר בתקרה היומית.
 * פוסט שכבר תפסתי קודם לפוסט אחר באותו ציון (הקישור שלו כבר שלי).
 */
export function mergeByScore(
  boards: readonly BoardListingRow[],
  demand: readonly DemandItem[],
  cap: number = BOARD_CAP,
): { boards: BoardListingRow[]; demand: DemandItem[] } {
  type Slot = { kind: "b" | "d"; i: number; score: number; mine: boolean; order: number };
  const slots: Slot[] = [];
  boards.forEach((b, i) => slots.push({ kind: "b", i, score: num(b.score) ?? 0, mine: false, order: i }));
  demand.forEach((d, i) => slots.push({ kind: "d", i, score: d.score, mine: d.mine, order: i }));
  slots.sort((a, b) =>
    b.score - a.score ||
    (a.kind === b.kind ? 0 : a.kind === "b" ? -1 : 1) ||
    Number(b.mine) - Number(a.mine) ||
    a.order - b.order
  );
  const keep = slots.slice(0, Math.max(0, cap));
  return {
    boards: keep.filter((s) => s.kind === "b").sort((a, b) => a.i - b.i).map((s) => boards[s.i]),
    demand: keep.filter((s) => s.kind === "d").sort((a, b) => a.i - b.i).map((s) => demand[s.i]),
  };
}

/** מה שהמודל רואה: שורות בלי טוקן. הטוקן יושב רק בשורת הרשימה. */
export function demandListings(items: readonly DemandItem[]): Record<string, unknown>[] {
  return items.map((d) => ({
    source_label: "פייסבוק",
    city: d.city || null,
    deal_type: d.dealType,
    property_type: d.propertyType || null,
    rooms: d.rooms,
    price: d.price,
    score: d.score,
    days_ago: d.daysAgo,
    already_mine: d.mine,
    line: demandLine(d),
  }));
}

export const DEMAND_NOTE =
  `${DEMAND_HEADING}: פוסטים של בעלי נכס בקבוצות, בלי פרטי קשר. אלה אינם נכסים שלך או של המשרד. ` +
  "כשמציגים אותם כותבים את הכותרת, בלי כתובת אתר: הודעה אחת יוצאת אחרייך. בלי הכותרת אין הודעה. " +
  "בהודעה, שורה של פייסבוק שולחת כפתור, **והלחיצה על הכפתור מסמנת \"אני פונה\"** ופותחת את הפוסט: " +
  "הפוסט נתפס לסוכן/ת הזה, לא נשאר פתוח לאחרים, ונספר בתקרה היומית. אמרי את זה במשפט אחד, " +
  "ואל תבטיחי שהפוסט עוד פנוי. score הוא אותו ציון התאמה של הנכסים, לפי מה שמופיע בפוסט. " +
  "אין לפנות לבעל הנכס בשום דרך אחרת, ואין להציע לו קונים בלי שהסוכן/ת בחר/ה בפוסט.";

function rowTitle(item: DemandItem): string {
  const t = item.rooms !== null && item.rooms > 0 ? `פייסבוק - ${item.rooms} חדרים` : "פייסבוק";
  return Array.from(t).slice(0, 24).join("");
}

function rowDescription(item: DemandItem): string {
  const bits = [
    item.city || null,
    item.price !== null && item.price > 0 ? `${nis(item.price)} ₪` : null,
    ageLabel(item.daysAgo),
    `${item.score}%`,
  ].filter(Boolean).join(" · ");
  return Array.from(bits).slice(0, 72).join("");
}

/**
 * ההודעה האינטראקטיבית של הלקוח/ה: לוחות ופוסטים ברשימה אחת. פוסט אחד לבדו -
 * כפתור קישור ל-/demand. בלי כתובת אתר גולמית בגוף ההודעה.
 */
export function combinedMatchMessage(
  boards: readonly BoardListingRow[],
  demand: readonly DemandItem[],
  siteBase: string,
): BoardInteractive | null {
  const boardRows = boardListRows(boards);
  const demandRows = demand.flatMap((d) => {
    const id = demandRowId(d.token);
    return id && demandUrl(siteBase, d.token) ? [{ id, title: rowTitle(d), description: rowDescription(d), item: d }] : [];
  });
  if (!demandRows.length) return null;   // בלי פוסטים: ההודעה הרגילה של הלוחות
  if (!boardRows.length && demandRows.length === 1) {
    const one = demandRows[0];
    return {
      kind: "cta",
      body: `${DEMAND_HEADING}\n${demandLine(one.item)}\nהלחיצה מסמנת "אני פונה" ופותחת את הפוסט.`,
      label: "אני פונה ופתיחה",
      url: demandUrl(siteBase, one.item.token) as string,
    };
  }
  const rows = [...boardRows, ...demandRows.map(({ id, title, description }) => ({ id, title, description }))]
    .slice(0, LIST_MAX_ROWS);
  const heading = boardRows.length ? `${BOARD_HEADING} ו${DEMAND_HEADING}` : DEMAND_HEADING;
  return {
    kind: "list",
    body: `${heading}\nבחירה בשורה של פייסבוק שולחת כפתור. הלחיצה על הכפתור מסמנת "אני פונה" ופותחת את הפוסט.`,
    button: "למודעות ולפוסטים",
    section: "יד2 / מדלן / פייסבוק",
    rows,
  };
}

/** הכפתור שנשלח אחרי בחירה בשורת פוסט. הלחיצה עליו היא התפיסה. */
export function demandButton(token: string, siteBase: string): { body: string; label: string; url: string } | null {
  const url = demandUrl(siteBase, token);
  if (!url) return null;
  return {
    body: `הפוסט בפייסבוק. הלחיצה על הכפתור מסמנת "אני פונה" ופותחת אותו:`,
    label: "אני פונה ופתיחה",
    url,
  };
}
