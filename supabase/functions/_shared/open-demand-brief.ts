// תקציר ביקוש פתוח לגבריאלה. בלי פרטי קשר, ובלי תאריך.

export const OPEN_DEMAND_LIMIT = 6;
export const OPEN_DEMAND_MAX = 8;
export const OPEN_DEMAND_SEE_ALL = "/crm?goto=accLeads&tab=demand";
export const CLAIM_TITLE = "אני פונה";
export const CLAIM_ID_PREFIX = "odc:";
export const DEMAND_FORBIDDEN = [
  "phone", "email", "name", "raw_name", "display_name", "display_phone",
  "post_url", "source_post_url", "profile", "fb_id", "facebook_id",
];

const POST_HOSTS = new Set([
  "facebook.com",
  "www.facebook.com",
  "m.facebook.com",
  "fb.com",
  "www.fb.com",
  "instagram.com",
  "www.instagram.com",
]);

/** קישור פוסט אחרי תפיסה. https בלבד, ורק מארחי פייסבוק ואינסטגרם. */
export function directPostUrl(raw: string | null | undefined): string | null {
  const text = String(raw || "").trim();
  if (!text.startsWith("https://") || text.length > 600) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  if (!POST_HOSTS.has(url.hostname.toLowerCase())) return null;
  return text;
}

export type DemandRow = {
  id: string;
  lead_type?: string | null;
  city?: string | null;
  neighborhood?: string | null;
  deal_type?: string | null;
  property_type?: string | null;
  rooms?: number | null;
  budget?: number | null;
  posted_at?: string | null;
  mine?: boolean | null;
};

const WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

export function demandPath(id: string, locked: boolean): string {
  if (locked) return OPEN_DEMAND_SEE_ALL;
  return `/crm?goto=accLeads&tab=demand&demand=${id}`;
}

export function demandAge(postedAt: string | null | undefined, now: Date): string {
  const at = postedAt ? new Date(postedAt) : null;
  if (!at || Number.isNaN(at.getTime())) return "";
  const ms = now.getTime() - at.getTime();
  if (ms < 60 * 60 * 1000) return "לפני שעה";
  if (ms < 24 * 60 * 60 * 1000) return "היום";
  if (ms < 48 * 60 * 60 * 1000) return "אתמול";
  if (ms < 7 * 24 * 60 * 60 * 1000) {
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", weekday: "short" });
    const name = fmt.format(at);
    const dow = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[name] ?? 0;
    return `יום ${WEEKDAYS[dow]}`;
  }
  return "לפני יותר משבוע";
}

function money(n: number): string {
  if (n >= 1000000) {
    const m = Math.round(n / 100000) / 10;
    return `${m} מליון`;
  }
  return Math.round(n).toLocaleString("en-US");
}

export function openDemandBrief(
  row: DemandRow,
  now: Date,
  locked: boolean,
): { summary: string; age: string; action_path: string; locked: boolean } {
  const owner = row.lead_type === "owner_inbound";
  const rent = row.deal_type === "rent";
  const who = owner ? (rent ? "משכיר/ה" : "מוכר/ת") : (rent ? "מחפש/ת לשכור" : "מחפש/ת לקנות");
  const place = [row.neighborhood, row.city].filter(Boolean).join(", ");
  const bits = [
    `${who} ${row.property_type || "נכס"}`,
    place,
    row.rooms ? `${row.rooms} חדרים` : "",
    row.budget ? `${owner ? "מחיר" : "עד"} ${money(Number(row.budget))}` : "",
  ].filter(Boolean);
  const age = demandAge(row.posted_at, now);
  return {
    summary: bits.join(" · "),
    age,
    action_path: demandPath(row.id, locked),
    locked,
  };
}

export function hasCalendarDate(text: string): boolean {
  return /\d{1,2}[./]\d{1,2}[./]\d{2,4}/.test(text) || /\b20\d{2}\b/.test(text);
}

/** מחפש/ת מפייסבוק או מאינסטגרם, בלי מסירת פרטים. אותו זיהוי כמו #1050. */
export function isSocialBuyerDm(leadType: string | null | undefined, source: string | null | undefined): boolean {
  return leadType === "seeker_inbound"
    && /^(facebook|instagram)_(dm|comment)$/.test(String(source || ""));
}

/** כשדגל #1050 דלוק, גבריאלה לא מציגה אותם עד שתומר יחליט על המסירה. */
export function excludeSocialBuyer(
  flagOn: boolean,
  leadType: string | null | undefined,
  source: string | null | undefined,
): boolean {
  return flagOn && isSocialBuyerDm(leadType, source);
}

export function claimButtonId(id: string): string {
  return `${CLAIM_ID_PREFIX}${id}`;
}

export function claimRows(items: { id: string; summary: string; locked: boolean }[]): {
  id: string;
  title: string;
  description: string;
}[] {
  const used = new Set<string>();
  const out: { id: string; title: string; description: string }[] = [];
  items.filter((item) => !item.locked).forEach((item, index) => {
    let title = Array.from(item.summary).slice(0, 24).join("").trim() || CLAIM_TITLE;
    if (used.has(title)) {
      const suffix = ` ${index + 1}`;
      title = Array.from(title).slice(0, 24 - Array.from(suffix).length).join("").trimEnd() + suffix;
    }
    used.add(title);
    out.push({ id: claimButtonId(item.id), title, description: CLAIM_TITLE });
  });
  return out;
}
