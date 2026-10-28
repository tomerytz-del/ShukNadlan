// תקציר ביקוש פתוח לגבריאלה. בלי פרטי קשר, ובלי תאריך.

export const OPEN_DEMAND_LIMIT = 6;
export const OPEN_DEMAND_MAX = 8;
export const OPEN_DEMAND_SEE_ALL = "/crm?goto=accLeads&tab=demand";
export const DEMAND_FORBIDDEN = [
  "phone", "email", "name", "raw_name", "display_name", "display_phone",
  "post_url", "profile", "fb_id", "facebook_id",
];

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
