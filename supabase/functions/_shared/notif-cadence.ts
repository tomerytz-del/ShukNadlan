// קצב התראות הלידים בוואטסאפ. בלי Deno, כדי שהבדיקה ב-node תריץ את הכללים.
// הדגל notif_cadence_button_enabled נולד כבוי. כשהוא כבוי אין כפתור,
// ואין שינוי בשליחה.

export const CADENCE_BUTTON_TITLE = "התאמת קצב התראות";
export const CADENCE_OPEN_ID = "ncad:open";
export const CADENCE_PATH = "/crm?goto=accNotifPrefs&focus=lead_wa";
export const CADENCE_CTA = "קצב הלידים";
export const CADENCE_LIST_BUTTON = "בחירת קצב";
export const CADENCE_OFF_CONFIRM_ID = "ncad:off:yes";
export const CADENCE_BACK_ID = "ncad:back";
export const CADENCE_OFF_CONFIRM_TITLE = "מאשר/ת, ללא התראות";
export const CADENCE_BACK_TITLE = "חזרה לאפשרויות";
export const CADENCE_OFF_WARN =
  "בלי התראות בוואטסאפ לא תצא הודעה על ליד חדש ולא על התאמה. פנייה חדשה עלולה להישאר בלי מענה.";
export const CADENCE_MENU_BODY =
  "איך לשלוח לך לידים חדשים בוואטסאפ?\nאפשר תמיד לשנות את זה גם במערכת.";

export const WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"] as const;

export type CadenceChoice = "each" | "daily" | "thrice" | "off";
export type OutsideMode = "cap" | "bell" | "send";

export type CadenceRow = { id: string; choice: CadenceChoice; title: string; description: string };

const CHOICES = new Set<CadenceChoice>(["each", "daily", "thrice", "off"]);

export function utf16len(s: string): number {
  return s.length;
}

export function hourLabel(hour: number): string {
  return `${hour}:00`;
}

export function weekdayName(dow: number): string {
  return WEEKDAYS[dow] || "";
}

/** "יום ראשון ב-9:00". בלי תאריך. */
export function whenLabel(dow: number, hour: number): string {
  return `יום ${weekdayName(dow)} ב-${hourLabel(hour)}`;
}

function hoursPhrase(hours: number[]): string {
  const labels = hours.map(hourLabel);
  if (labels.length === 0) return hourLabel(9);
  if (labels.length === 1) return `ב-${labels[0]}`;
  if (labels.length === 2) return `ב-${labels[0]} וב-${labels[1]}`;
  return `ב-${labels.slice(0, -1).join(", ב-")} וב-${labels[labels.length - 1]}`;
}

const FRIDAY_NOTE = "ביום שישי רק לפני 13:00, ובשבת אין";

export function cadenceRows(dailyHour: number, hours: number[]): CadenceRow[] {
  return [
    {
      id: "ncad:each",
      choice: "each",
      title: "הודעה על כל ליד (מומלץ)",
      description: "הודעה על כל ליד חדש, מיד כשהוא נכנס",
    },
    {
      id: "ncad:day",
      choice: "daily",
      title: "ריכוז לידים פעם ביום",
      description: `הודעה אחת ביום, ${hoursPhrase([dailyHour])}. ${FRIDAY_NOTE}`,
    },
    {
      id: "ncad:x3",
      choice: "thrice",
      title: "ריכוז לידים 3 פעמים ביום",
      description: `${hoursPhrase(hours)}. ${FRIDAY_NOTE}`,
    },
    {
      id: "ncad:off",
      choice: "off",
      title: "ללא התראות",
      description: "לידים חדשים נשארים בפעמון, בלי וואטסאפ",
    },
  ];
}

export function cadenceChoiceFromId(id: string): CadenceChoice | null {
  if (id === CADENCE_OFF_CONFIRM_ID) return "off";
  const row = cadenceRows(9, [9, 13, 17]).find((r) => r.id === id);
  return row ? row.choice : null;
}

export function isCadenceId(id: string): boolean {
  return id === CADENCE_OPEN_ID || id === CADENCE_BACK_ID || id === CADENCE_OFF_CONFIRM_ID
    || cadenceChoiceFromId(id) !== null;
}

/** מזהה הלחיצה מהודעת כפתור, תבנית או רשימה. */
export function cadenceIdFromMessage(msg: {
  type?: string;
  button?: { payload?: string; text?: string };
  interactive?: { button_reply?: { id?: string; title?: string }; list_reply?: { id?: string; title?: string } };
}): string | null {
  const id = msg.type === "button"
    ? String(msg.button?.payload || msg.button?.text || "")
    : msg.type === "interactive"
    ? String(msg.interactive?.button_reply?.id || msg.interactive?.list_reply?.id || "")
    : "";
  if (isCadenceId(id)) return id;
  const title = msg.type === "button"
    ? String(msg.button?.text || "")
    : String(msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || "");
  if (title.trim() === CADENCE_BUTTON_TITLE) return CADENCE_OPEN_ID;
  return null;
}

export function confirmLine(
  choice: CadenceChoice,
  changed: boolean,
  dailyHour: number,
  hours: number[],
): string {
  const same = changed ? "מעכשיו" : "זה כבר הקצב.";
  if (choice === "each") {
    return changed ? "מעכשיו אשלח הודעה על כל ליד חדש." : "זה כבר הקצב: הודעה על כל ליד חדש.";
  }
  if (choice === "off") {
    return changed
      ? "מעכשיו לידים חדשים יופיעו רק בפעמון, בלי וואטסאפ."
      : "זה כבר הקצב: לידים חדשים רק בפעמון, בלי וואטסאפ.";
  }
  if (choice === "daily") {
    const body = `ריכוז לידים פעם ביום, ${hoursPhrase([dailyHour])}. ${FRIDAY_NOTE}.`;
    return changed ? `${same} אשלח ${body}` : `זה כבר הקצב: ${body}`;
  }
  const body = `ריכוז לידים ${hoursPhrase(hours)}. ${FRIDAY_NOTE}.`;
  return changed ? `${same} אשלח ${body}` : `זה כבר הקצב: ${body}`;
}

export function digestIntro(dow: number, hour: number): string {
  return `הלידים החדשים, ${whenLabel(dow, hour)}.`;
}

export type JerusalemParts = { dow: number; hour: number; minute: number };

const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function jerusalemParts(at: Date): JerusalemParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]));
  return {
    dow: DOW[parts.weekday] ?? 0,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

export type Slot = { dow: number; hour: number; key: string };

/**
 * חלון דקות מתחילת השעה. יום שישי רק לפני 13:00. שבת אין.
 * המפתח הפנימי כולל תאריך כדי שלא נשלח פעמיים. הוא לא מוצג לסוכן/ת.
 */
export function digestSlot(
  at: Date,
  mode: "daily" | "thrice",
  dailyHour: number,
  hours: number[],
  windowMinutes: number,
): Slot | null {
  const parts = jerusalemParts(at);
  if (parts.dow === 6) return null;
  const wanted = mode === "daily" ? [dailyHour] : hours;
  if (!wanted.includes(parts.hour)) return null;
  if (parts.dow === 5 && parts.hour >= 13) return null;
  if (parts.minute < 0 || parts.minute >= windowMinutes) return null;
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
  return { dow: parts.dow, hour: parts.hour, key: `${day}-${parts.hour}` };
}

export function digestChannel(
  inWindow: boolean,
  outside: OutsideMode,
  capAllows: boolean,
): "text" | "template" | "bell" {
  if (inWindow) return "text";
  if (outside === "bell") return "bell";
  if (outside === "send") return "template";
  return capAllows ? "template" : "bell";
}

export function parseOutside(value: string | null | undefined): OutsideMode {
  if (value === "bell" || value === "send" || value === "cap") return value;
  return "cap";
}

export function parseChoice(value: string | null | undefined): CadenceChoice {
  return CHOICES.has(value as CadenceChoice) ? value as CadenceChoice : "each";
}

/** אין תאריך בנוסח שמוצג. שעה ויום בשבוע מותרים. */
export function hasCalendarDate(text: string): boolean {
  return /\d{1,2}[./]\d{1,2}/.test(text) || /\d{4}/.test(text);
}
