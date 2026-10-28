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

/** יום בשבוע ושעה, שעון ישראל. בלי תאריך: ההודעה לבעלים לא נושאת מספר. */
export function whenWeekdayTime(iso: string): string {
  const parts = new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const day = parts.find((p) => p.type === "weekday")?.value ?? "";
  const h = (parts.find((p) => p.type === "hour")?.value ?? "00").padStart(2, "0");
  const mi = (parts.find((p) => p.type === "minute")?.value ?? "00").padStart(2, "0");
  return `${day} ${h}:${mi}`;
}

/** שם פרטי בלבד. בלי שם נשאר "הסוכן", כדי שהמשפט לא יישבר. */
export function agentFirstName(displayName: string): string {
  const first = String(displayName || "").trim().split(/\s+/)[0] || "";
  return first || "הסוכן";
}

/**
 * הודעת הביטול לבעלים ולמתווכים. גבריאלה מדברת, לא הסוכן/ת.
 * יוצאת רק אחרי אישור, ורק בחלון. הנוסח כאן הוא כל ההודעה.
 */
export function ownerCancelNotice(ownerName: string, agentDisplayName: string, startsAt: string): string {
  const name = String(ownerName || "").trim();
  const hello = name ? `שלום ${name}` : "שלום";
  const who = agentFirstName(agentDisplayName);
  const when = whenWeekdayTime(startsAt);
  return `${hello}, כאן גבריאלה משוק הנדל״ן. הביקור שתואם עם ${who} ל${when} בוטל, אז אין צורך להגיע. אם תרצו לתאם מועד אחר, אפשר לכתוב לי כאן.`;
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

/** חיפוש ביטול לפי שם: סיורים שכבר התחילו לאחרונה, והקרובים בשלושת השבועות. */
export const CANCEL_SEARCH_PAST_MS = 6 * 60 * 60 * 1000;
export const CANCEL_SEARCH_FUTURE_MS = 21 * 24 * 60 * 60 * 1000;
export const CANCEL_SEARCH_LIMIT = 80;

export function cancelSearchBounds(now: number): { fromIso: string; toIso: string } {
  return {
    fromIso: new Date(now - CANCEL_SEARCH_PAST_MS).toISOString(),
    toIso: new Date(now + CANCEL_SEARCH_FUTURE_MS).toISOString(),
  };
}

const SHOWING_CLOSE_TITLE = "סיור בוטל";

/** כפתור scn: רק על התראת סגירה אחת, כדי שהסוכן/ת יחליט/תחליט אם לעדכן את מי שכבר קיבל בקשה. */
export function showingCloseNotifyButton(
  items: { type: string; title?: string | null; meeting_id?: string | null }[],
): { id: string; title: string } | null {
  if (items.length !== 1) return null;
  const it = items[0];
  const id = String(it.meeting_id || "");
  if (it.type !== "showcase_meeting") return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  if (!String(it.title || "").startsWith(SHOWING_CLOSE_TITLE)) return null;
  if (CANCEL_NOTIFY_BUTTON_TITLE.length > 20) return null;
  return { id: `scn:${id.toLowerCase()}`, title: CANCEL_NOTIFY_BUTTON_TITLE };
}

/** חיתוך גוף הודעה בלי לקטוע קישור ובלי לחתוך באמצע שורה אם יש שורה קודמת. */
export function clipWhatsappBody(text: string, max = 1024): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, max);
  const nl = cut.lastIndexOf("\n");
  if (nl >= Math.floor(max * 0.5)) cut = cut.slice(0, nl);
  return cut.replace(/https?:\/\/\S*$/u, "").trimEnd();
}
