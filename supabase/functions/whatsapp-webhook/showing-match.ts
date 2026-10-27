// התאמת שם לסיור: קודם fuzzy-text (אותו מתאם של חיפוש נכס), ואחר כך
// קיפול שמות שתמלול שובר - כ/ק, ט/ת, י ו-א, ו' כפולה, ה הידיעה.
// "שיר הקץ" (תמלול) ו"שירה קאץ" (הכרטיס) נפגשים כאן.

import { fuzzyMatches, normalizeWord, words } from "./fuzzy-text.ts";

function foldName(word: string): string {
  return normalizeWord(word)
    .replace(/ו{2,}/g, "ו")
    .replace(/[כק]/g, "ק")
    .replace(/[טת]/g, "ת")
    .replace(/[אי]/g, "")
    .replace(/^ה/, "");
}

/** אותו אדם בסבירות גבוהה, כולל תמלול קולי. */
export function clientNameMatches(query: string, name: string): boolean {
  const q = query.trim();
  const n = String(name || "").trim();
  if (!q || !n) return false;
  if (fuzzyMatches(q, n)) return true;
  const qs = words(q).map(foldName).filter((w) => w.length >= 2);
  const ns = words(n).map(foldName).filter((w) => w.length >= 2);
  if (!qs.length || !ns.length) return false;
  return qs.every((qw) => ns.some((nw) =>
    nw === qw || (Math.min(qw.length, nw.length) >= 2 && (nw.startsWith(qw) || qw.startsWith(nw)))
  ));
}

/** "18:00" או "18.00" מתוך משפט. בלי שעה - null. */
export function extractClock(text: string): string | null {
  const m = /(?:^|\D)([01]?\d|2[0-3])[:.]([0-5]\d)(?!\d)/.exec(text);
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

export function ilClock(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const h = parts.find((p) => p.type === "hour")?.value ?? "00";
  const mi = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${h.padStart(2, "0")}:${mi.padStart(2, "0")}`;
}

export interface ShowingPick {
  client_name: string;
  starts_at: string;
}

/**
 * סינון סיורים לפי שם (סלחני) ושעה. שאילתה ריקה מחזירה את כולם.
 * שעה בתוך השאילתה נשלפת גם אם לא הועברה בנפרד.
 */
export function pickShowings<T extends ShowingPick>(
  rows: T[],
  query: string,
  clock: string | null,
): T[] {
  const q = query.trim();
  const at = clock || (q ? extractClock(q) : null);
  const nameQ = q.replace(/(?:^|\D)([01]?\d|2[0-3])[:.]([0-5]\d)(?!\d)/, " ").replace(/\s+/g, " ").trim();
  return rows.filter((row) => {
    if (at && ilClock(row.starts_at) !== at) return false;
    if (!nameQ) return true;
    return clientNameMatches(nameQ, row.client_name);
  });
}

/** סטטוסי תיאום שעדיין "פתוחים": הביקור עוד צפוי. declined/canceled/failed לא. */
export const NON_FINAL_COORD = ["pending", "sending", "sent", "postpone", "confirmed"] as const;

/** מי שכבר קיבל הודעה, ולכן ביטול בלי עדכון משאיר אותו/ה בדרך. */
export const NOTIFY_COORD = ["sent", "postpone", "confirmed"] as const;

/** רק בקשה שההודעה אליה יצאה בפועל. השאר נשארות cancel_unnotified. */
export function notifiedRequestIds(results: { id: string; sent: boolean }[]): string[] {
  return results.filter((r) => r.sent && r.id).map((r) => r.id);
}

/** כפתור אחרי ביטול. הכותרת עד 20 יחידות UTF-16 (Meta). */
export const CANCEL_NOTIFY_BUTTON_TITLE = "להודיע על הביטול";
