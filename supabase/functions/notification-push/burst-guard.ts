// שמירה מפני התפרצות וואטסאפ. התקרות חיות ב-pricing_config
// (מיגרציה 20271028140000). כאן ההחלטה בלי מסד, כדי שהבדיקה ב-node
// תריץ אותה, והשליחה תקרוס גוף ענק גם אם ה-claim הישן עוד באוויר.

export const BURST_DEFAULTS = {
  hourCap: 12,
  dayCap: 30,
  leadHourCap: 20,
  leadDayCap: 40,
  showingHourCap: 20,
  showingDayCap: 40,
  staleHours: 12,
  urgentHours: 72,
  agentPending: 30,
  createdMinutes: 15,
  createdMax: 300,
  globalHour: 130,
  maxItems: 24,
  scrapedStaleDays: 14,
} as const;

export const BURST_DIGEST_TYPE = "burst_digest";

export type BurstBucket = "lead" | "showing" | "general";

export type BurstItem = {
  type: string;
  source?: string | null;
  count?: number | null;
  title?: string | null;
  body?: string | null;
};

/** ליד אמיתי משתמש בתקרת הלידים. בקשת תמונות וכל השאר - בתקרה הכללית. */
export function burstBucket(items: BurstItem[]): BurstBucket {
  if (items.length === 0) return "general";
  if (items.every((it) => it.type === "showcase_meeting")) return "showing";
  if (items.every((it) => it.type === "new_lead" && it.source !== "photo_request")) return "lead";
  return "general";
}

export function burstCaps(
  bucket: BurstBucket,
  cfg: typeof BURST_DEFAULTS = BURST_DEFAULTS,
): { hour: number; day: number } {
  if (bucket === "lead") return { hour: cfg.leadHourCap, day: cfg.leadDayCap };
  if (bucket === "showing") return { hour: cfg.showingHourCap, day: cfg.showingDayCap };
  return { hour: cfg.hourCap, day: cfg.dayCap };
}

export function overBurstCap(
  sentHour: number,
  sentDay: number,
  caps: { hour: number; day: number },
): boolean {
  return sentHour >= caps.hour || sentDay >= caps.day;
}

/**
 * שורה שלא יוצאת לוואטסאפ. נשארת לא-נקראת בפעמון.
 * דגל התקציר כבוי: quiet_hold נשאר, כמו היום. דגל דלוק: סוג שאינו דחוף
 * מעל 12 שעות לא יוצא, גם אם ההחזקה של 7 הימים שמרה אותו לפעמון.
 */
export function shouldMarkSiteOnly(opts: {
  ageHours: number;
  digestOn: boolean;
  priority: boolean;
  kept: boolean;
  quietHold: boolean;
  suppress: boolean;
  staleHours?: number;
  urgentHours?: number;
}): boolean {
  if (opts.suppress) return true;
  const stale = opts.staleHours ?? BURST_DEFAULTS.staleHours;
  const urgent = opts.urgentHours ?? BURST_DEFAULTS.urgentHours;
  if (opts.priority || (opts.digestOn && opts.kept)) return opts.ageHours > urgent;
  if (!opts.digestOn && opts.quietHold) return false;
  return opts.ageHours > stale;
}

export function breakerShouldPause(opts: {
  manual: boolean;
  pending: number;
  created: number;
  globalSends: number;
  pendingMax?: number;
  createdMax?: number;
  globalMax?: number;
}): { global: boolean; agent: boolean } {
  const pendingMax = opts.pendingMax ?? BURST_DEFAULTS.agentPending;
  const createdMax = opts.createdMax ?? BURST_DEFAULTS.createdMax;
  const globalMax = opts.globalMax ?? BURST_DEFAULTS.globalHour;
  const global = opts.manual || opts.created > createdMax || opts.globalSends > globalMax;
  return { global, agent: !global && opts.pending > pendingMax };
}

export type BurstAction = "send" | "digest" | "site_only";

/** מעל התקרה: תקציר אחד בשעה, ואחר כך רק באתר. מעל מקסימום פריטים: תקציר. */
export function burstAction(opts: {
  paused: boolean;
  overCap: boolean;
  digestAlreadyThisHour: boolean;
  itemCount: number;
  maxItems?: number;
}): BurstAction {
  if (opts.paused) return "site_only";
  const maxItems = opts.maxItems ?? BURST_DEFAULTS.maxItems;
  if (opts.overCap) return opts.digestAlreadyThisHour ? "site_only" : "digest";
  if (opts.itemCount > maxItems) return "digest";
  return "send";
}

/** בקשת תמונות: לכל היותר הודעה אחת לנכס. החדשה נשארת, השאר באתר. */
export function photoRequestKeep<T extends { id: string; createdAt: number }>(
  rows: T[],
  alreadySent: boolean,
): T | null {
  if (alreadySent || rows.length === 0) return null;
  return [...rows].sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1))[0];
}

export function burstDigestItem(count: number): BurstItem {
  return {
    type: BURST_DIGEST_TYPE,
    title: `יש לך ${count} התראות חדשות באתר`,
    body: null,
    count,
  };
}

export function collapseForSend<T extends BurstItem>(
  items: T[],
  maxItems = BURST_DEFAULTS.maxItems,
): T[] {
  const digest = items.find((it) => it.type === BURST_DIGEST_TYPE);
  if (digest) return [digest];
  if (items.length > maxItems) return [burstDigestItem(items.length) as T];
  return items;
}

export function burstText(
  name: string | null,
  count: number,
  siteBase: string,
  manageUrl: string,
): string {
  const first = String(name || "").trim().split(/\s+/)[0] || "";
  const line = `יש לך ${count} התראות חדשות באתר.`;
  return [
    first ? `${first}, ${line}` : line,
    `${siteBase}/crm`,
    `להפסקת ההתראות בוואטסאפ: ${manageUrl}`,
  ].join("\n");
}
