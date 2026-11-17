/** שורות סיכום "נכס חדש שותף איתך".

המשפט זהה ל-share_digest_describe במסד: סוג, למכירה/להשכרה, עיר
(ושכונה בסוגריים), חדרים, מחיר. בלי טלפון, בלי שם מלא, בלי רחוב.
שורות שנשמרו לפני העמודות החדשות מגיעות בלי עיר וחדרים, והמשפט
פשוט מדלג על מה שחסר. "שותף ע"י" ניטרלי למגדר, כדי שהשם הפרטי
לא ייקרא כמקום.
*/

export type ShareDigestLine = {
  sharer_first_name: string;
  property_type: string;
  price_label: string;
  property_id: string;
  city?: string | null;
  deal_type?: string | null;
  rooms?: number | string | null;
  neighborhood?: string | null;
};

export type NotifyLine = {
  type: string;
  title: string;
  body: string | null;
};

const MISSING_PRICE = "מחיר לא צוין";

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function nameOf(line: ShareDigestLine): string {
  const name = clean(line.sharer_first_name).split(/\s+/)[0] || "";
  return name || "משרד";
}

function typeOf(line: ShareDigestLine): string {
  return clean(line.property_type) || "נכס";
}

function dealWord(deal: unknown): string {
  const value = clean(deal).toLowerCase();
  if (value === "rent") return "להשכרה";
  if (value === "sale") return "למכירה";
  return "";
}

function placeOf(line: ShareDigestLine): string {
  const city = clean(line.city);
  const hood = clean(line.neighborhood);
  const neighborhood = hood && city && hood === city ? "" : hood;
  if (city && neighborhood) return `ב${city} (${neighborhood})`;
  if (city) return `ב${city}`;
  if (neighborhood) return `ב${neighborhood}`;
  return "";
}

/** "5", "5.0" ו-"5.00" הם 5 חדרים. 1 הוא "חדר" אחד. 0 וחסר יורדים. */
function roomsLabel(raw: unknown): string {
  if (raw == null || raw === "") return "";
  const n = typeof raw === "number" ? raw : Number(clean(raw).replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return "";
  const nearest = Math.round(n * 10) / 10;
  const text = Number.isInteger(nearest) ? String(nearest) : String(nearest);
  return text === "1" ? "1 חדר" : `${text} חדרים`;
}

function priceShown(line: ShareDigestLine): string {
  const price = clean(line.price_label);
  if (!price || price === MISSING_PRICE) return "";
  return price;
}

/** המשפט בלי שם המשתף. חלקים חסרים יורדים, בלי "מחיר לא צוין". */
export function shareDigestFacts(line: ShareDigestLine): string {
  const head = [typeOf(line), dealWord(line.deal_type), placeOf(line)].filter(Boolean).join(" ");
  return [head, roomsLabel(line.rooms), priceShown(line)].filter(Boolean).join(", ");
}

export function shareDigestByLine(line: ShareDigestLine): string {
  return `שותף ע"י ${nameOf(line)}`;
}

/** גוף הפעמון: משפט לכל נכס, ומתחתיו מי שיתף. */
export function shareDigestBody(lines: ShareDigestLine[]): string {
  return lines.filter((line) => line.property_id).map((line) =>
    `${shareDigestFacts(line)}\n${shareDigestByLine(line)}`
  ).join("\n\n");
}

/** פריט לכל נכס. הסוג אינו system, כדי ש-arrange לא יקפל אותם לשורה אחת. */
export function shareDigestItems(lines: ShareDigestLine[]) {
  return lines.filter((line) => line.property_id).map((line) => ({
    type: "share_digest",
    title: shareDigestFacts(line),
    body: shareDigestByLine(line),
    action_path: `/crm?goto=accSharedWithMe&property=${line.property_id}`,
    property_id: line.property_id,
    property_mine: false as const,
  }));
}

export function isShareOnlyBatch(items: { type: string }[]): boolean {
  return items.length > 0 && items.every((it) => it.type === "share_digest");
}

export function shareDigestBatchHeader(count: number): string {
  return count === 1
    ? "נכס חדש שותף איתך:"
    : `${count} נכסים חדשים שותפו איתך:`;
}

/** השורה הראשונה של textBody. סיכום שיתופים אינו "מה שחדש". */
export function textBodyHead(first: string | null, items: { type: string }[]): string {
  // מערך ריק: every מחזיר true, כמו שהיה ב-textBody לפני הפיצול.
  const onlyAgenda = items.every((it) => it.type === "agenda_reminder");
  const head = onlyAgenda
    ? "תזכורת מהיומן:"
    : isShareOnlyBatch(items)
      ? shareDigestBatchHeader(items.length)
      : "מה שחדש אצלך:";
  const who = clean(first).split(/\s+/)[0] || "";
  return who ? `${who}, ${head}` : head;
}

/**
 * שורת פריט אחת ב-textBody. בסיכום שיתופים בלבד הבית והשורה השנייה.
 * באצווה מעורבת אותו משפט, עם הקדמה כדי שיהיה ברור שזה שיתוף.
 * link הוא null כשאין כתובת בגוף (noLinks).
 */
/** רווח בין נכסים כשההודעה כולה שיתופים. שורה אחת נשארת כמו שהיא. */
export function separateShareEntries(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (out.length) out.push("");
    out.push(line);
  }
  return out;
}

export function textBodyItemLine(
  it: NotifyLine,
  opts: { onlyShares: boolean; link: string | null },
): string {
  const link = opts.link ? `\n   👈 ${opts.link}` : "";
  if (it.type === "share_digest" && opts.onlyShares) {
    return `🏠 ${it.title}${it.body ? `\n   ${it.body}` : ""}${link}`;
  }
  if (it.type === "share_digest") {
    const who = it.body ? ` (${it.body})` : "";
    return `🔔 נכס ששותף איתך: ${it.title}${who}${link}`;
  }
  const emoji = it.type === "agenda_reminder" ? "📅" : "🔔";
  return `${emoji} ${it.title}${it.body ? `\n   ${it.body}` : ""}${link}`;
}
