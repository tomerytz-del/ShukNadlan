// תקציר התראות: חלונות, קיבוץ לפי נושא, וכפתור "פחות כאלה".
// הכל כבוי כל עוד הדגלים ב-pricing_config הם 0. הקובץ הזה בלי מסד ובלי Deno,
// כדי שהבדיקה ב-node תריץ אותו.

export const LESS_TITLE = "פחות כאלה";
export const RESTORE_TITLE = "החזר כרגיל";
export const RESTORE_COMMAND = "החזר התראות";
export const LESS_HOLD_DAYS = 30;

/**
 * לא מופחתים ולא נדחים לחלון התקציר.
 * כל סוג ליד (כולל new_lead, lead_followup, lead_unrouted),
 * סיור, תזכורת מהיומן, והתראות אבטחה, תקציב ומערכת.
 * אותה רשימה ב-notification_push_less_kept_types, וכל סוג שמכיל lead.
 */
export const LESS_KEPT_TYPES = [
  "agenda_reminder",
  "showcase_meeting",
  "new_lead",
  "lead_followup",
  "lead_unrouted",
  "lead_prefs_default",
  "onboarding_lead",
  "open_demand",
  "security_alert",
  "budget_alert",
  "ops_alert",
] as const;

export function isLessKeptType(type: string): boolean {
  if ((LESS_KEPT_TYPES as readonly string[]).includes(type)) return true;
  return String(type || "").includes("lead");
}

const TOPIC_LABELS: Record<string, string> = {
  client_match: "התאמות",
  new_lead: "לידים",
  lead_followup: "לידים",
  lead_unrouted: "לידים",
  lead_prefs_default: "לידים",
  onboarding_lead: "לידים",
  security_alert: "אבטחה",
  budget_alert: "תקציב",
  ops_alert: "מערכת",
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

/** "nmore:client_match" או null. מוחק את שורת ההפחתה של הסוג. */
export function parseMoreButton(id: string): string | null {
  const m = /^nmore:([a-z][a-z0-9_]{0,39})$/.exec(String(id || ""));
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

/**
 * תווית לשורת גוף כשהסוג מתחלף. לא משנה את סדר arrange() ולא את הכותרת
 * או את הקישור: התבנית נשארת עם הכותרת המקורית, והקישור לא נדחק מהחיתוך.
 */
export function topicBreak(previous: string | null, type: string): string | null {
  if (!type || type === previous) return null;
  return topicLabel(type);
}

/**
 * אחרי שה-CASE בחר אילו סוגים מותרים עכשיו. סוג מופחת שאינו דחוף יורד
 * מהרשימה מחוץ לחלון, ובתוך החלון רק אם לא יצאה הודעה בחלון הזה
 * (פעמיים רדיוס הדקות). דחוף נשאר תמיד.
 */
export function applyLessGate(
  types: string[],
  lessTypes: string[],
  opts: { digestOpen: boolean; lastSentAgoMin: number | null; windowRadiusMin: number },
): string[] {
  const reduced = new Set(lessTypes.filter((t) => !isLessKeptType(t)));
  const span = Math.max(opts.windowRadiusMin, 1) * 2;
  const includeReduced = opts.digestOpen
    && (opts.lastSentAgoMin == null || opts.lastSentAgoMin > span);
  if (includeReduced) return types.slice();
  return types.filter((t) => !reduced.has(t));
}
