// שמירה מפני התפרצות וואטסאפ. התקרות, המסלולים והמפסק חיים ב-SQL
// (מיגרציה 20271029140000). כאן רק מה שהשליחה עצמה צריכה:
// לא לקפל ליד אמיתי או סוג מוגן לתוך "יש לך N", וגוף התקציר.
// המתג notification_burst_guard_enabled: כל ערך שאינו 0 הוא דלוק.

import { isLessKeptType } from "./notif-digest.ts";

export const BURST_DIGEST_TYPE = "burst_digest";
const BURST_MAX_ITEMS = 24;

export type BurstItem = {
  type: string;
  source?: string | null;
  count?: number | null;
  title?: string | null;
  body?: string | null;
};

/** 0 כבוי. כל מספר אחר דלוק, כמו ב-SQL (<> 0). */
export function guardEnabled(value: unknown): boolean {
  const n = Number(value);
  return Number.isFinite(n) && n !== 0;
}

/** ליד אמיתי, סיור, תזכורת, אבטחה, תקציב, ops. בקשת תמונות לא. */
export function isBurstExempt(item: { type: string; source?: string | null }): boolean {
  if (item.type === "new_lead" && item.source === "photo_request") return false;
  return isLessKeptType(item.type);
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
  maxItems = BURST_MAX_ITEMS,
  guardOn = true,
): T[] {
  if (!guardOn) return items;
  if (items.some((it) => isBurstExempt(it))) return items;
  const digest = items.find((it) => it.type === BURST_DIGEST_TYPE);
  if (digest) return [digest];
  if (items.length > maxItems) return [burstDigestItem(items.length) as T];
  return items;
}

export function burstText(name: string | null, count: number): string {
  const first = String(name || "").trim().split(/\s+/)[0] || "";
  const line = `יש לך ${count} התראות חדשות באתר.`;
  return [
    first ? `${first}, ${line}` : line,
    "פרטים ב-CRM.",
    "להפסקת ההתראות: מסך התראות והודעות.",
  ].join("\n");
}
