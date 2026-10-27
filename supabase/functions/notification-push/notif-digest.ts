// תקציר התראות: חלונות, קיבוץ לפי נושא, וכפתור "פחות כאלה".
// הכל כבוי כל עוד הדגלים ב-pricing_config הם 0. הקובץ הזה בלי מסד ובלי Deno,
// כדי שהבדיקה ב-node תריץ אותו.

export const LESS_TITLE = "פחות כאלה";

const TOPIC_LABELS: Record<string, string> = {
  client_match: "התאמות",
  new_lead: "לידים",
  system: "עדכונים",
  agenda_reminder: "יומן",
  showcase_meeting: "סיורים",
  platform_signup: "נרשמים",
  marketing_copy: "תיאור שיווקי",
  open_demand: "ביקוש פתוח",
  deal_closed: "עסקאות",
  review_request: "ביקורות",
};

export function topicLabel(type: string): string {
  return TOPIC_LABELS[type] || "עדכון";
}

/** "nless:client_match" או null. הסוג נשמר רק אם הוא מזהה קצר. */
export function parseLessButton(id: string): string | null {
  const m = /^nless:([a-z][a-z0-9_]{0,39})$/.exec(String(id || ""));
  return m ? m[1] : null;
}

export function minutesInTimeZone(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const minute = Number(parts.find((p) => p.type === "minute")?.value);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return -1;
  return hour * 60 + minute;
}

/** חלון פתוח אם הדקה הנוכחית קרובה לאחד החלונות, בלי מעבר חצות. */
export function digestWindowOpen(
  now: Date,
  windows: number[],
  radiusMin: number,
  timeZone = "Asia/Jerusalem",
): boolean {
  const minute = minutesInTimeZone(now, timeZone);
  if (minute < 0) return false;
  const radius = Math.max(0, radiusMin);
  return windows.some((w) => Number.isFinite(w) && Math.abs(minute - w) <= radius);
}

/** אותו סדר פנימי בכל נושא, והנושאים זה אחרי זה. הכותרת של הראשון בכל נושא מקבלת תווית. */
export function withTopicHeaders<T extends { type: string; title: string }>(
  items: T[],
  label: (type: string) => string = topicLabel,
): T[] {
  const sorted = [...items].sort((a, b) => a.type < b.type ? -1 : a.type > b.type ? 1 : 0);
  let prev = "";
  return sorted.map((it) => {
    if (it.type === prev) return it;
    prev = it.type;
    const name = label(it.type);
    return { ...it, title: `${name}: ${it.title}` };
  });
}
