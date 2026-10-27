// שמירה מפני התפרצות וואטסאפ. התקרות והמפסק חיים ב-SQL
// (מיגרציה 20271028140000). כאן רק מה שהשליחה עצמה צריכה:
// לא לקפל ליד אמיתי או סוג מוגן לתוך "יש לך N", וגוף התקציר.
// המתג notification_burst_guard_enabled כבוי: אין קיפול.

import { isLessKeptType } from "./notif-digest.ts";

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

/** ליד אמיתי, סיור, תזכורת, אבטחה, תקציב, ops. בקשת תמונות לא. */
export function isBurstExempt(item: { type: string; source?: string | null }): boolean {
  if (item.type === "new_lead" && item.source === "photo_request") return false;
  return isLessKeptType(item.type);
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
  guardOn = true,
): T[] {
  if (!guardOn) return items;
  if (items.some((it) => isBurstExempt(it))) return items;
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
