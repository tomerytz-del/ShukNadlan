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
export const CADENCE_OFF_AFTER =
  "מעכשיו לידים והתאמות מחכים בפעמון. אפשר לשאול אותי: אילו לידים יש בביקוש הפתוח? אפשר לשנות את זה בכל רגע.";
export const CADENCE_MENU_BODY =
  "איך לשלוח לך לידים חדשים בוואטסאפ?\nאפשר תמיד לשנות את זה גם במערכת.";

export const WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"] as const;

export type CadenceChoice = "each" | "daily" | "thrice" | "off";

export type CadenceType = {
  id: string;
  title: string;
  digest: boolean;
  ask: boolean;
};

/** אותם סוגים ש-whatsapp_alerts ו-NOTIFY_TYPES מכירים, ועוד ביקוש פתוח. */
export const CADENCE_TYPES: CadenceType[] = [
  { id: "new_lead", title: "ליד חדש", digest: true, ask: true },
  { id: "open_demand", title: "ביקוש פתוח", digest: true, ask: true },
  { id: "match_digest", title: "התאמות", digest: true, ask: false },
  { id: "system", title: "שותף איתך", digest: true, ask: false },
  { id: "agenda_reminder", title: "תזכורת יומן", digest: false, ask: false },
  { id: "agreement_signed", title: "הסכם נחתם", digest: false, ask: false },
  { id: "review_new", title: "ביקורת חדשה", digest: true, ask: false },
  { id: "review_request", title: "בקשת ביקורת", digest: true, ask: false },
  { id: "marketing_copy", title: "תיאור שיווקי", digest: true, ask: false },
  { id: "deal_closed", title: "עסקה נסגרה", digest: false, ask: false },
];

export const CADENCE_MORE_ID = "ncad:more";
export const CADENCE_DONE_ID = "ncad:done";
export const CADENCE_MORE_TITLE = "סוג נוסף";
export const CADENCE_DONE_TITLE = "סיימתי";

const CHOICE_CODE: Record<string, CadenceChoice> = {
  each: "each",
  day: "daily",
  x3: "thrice",
  off: "off",
};

export function cadenceType(id: string): CadenceType | undefined {
  return CADENCE_TYPES.find((t) => t.id === id);
}

export function orderCadenceTypes(first?: string | null): CadenceType[] {
  if (!first || !cadenceType(first)) return CADENCE_TYPES;
  return [cadenceType(first)!, ...CADENCE_TYPES.filter((t) => t.id !== first)];
}

export function cadenceLabel(choice: CadenceChoice): string {
  if (choice === "daily") return "פעם ביום";
  if (choice === "thrice") return "3 פעמים ביום";
  if (choice === "off") return "ללא";
  return "על כל פריט";
}

export function effectiveCadence(
  stored: Record<string, string> | null | undefined,
  offTypes: string[] | null | undefined,
  typeId: string,
): CadenceChoice {
  const raw = stored?.[typeId];
  if (raw === "each" || raw === "daily" || raw === "thrice" || raw === "off") {
    const type = cadenceType(typeId);
    if (type && !type.digest && (raw === "daily" || raw === "thrice")) return "each";
    return raw;
  }
  if ((offTypes || []).includes(typeId)) return "off";
  return "each";
}

export function typeListRows(
  first: string | null | undefined,
  stored: Record<string, string> | null | undefined,
  offTypes: string[] | null | undefined,
): CadenceRow[] {
  return orderCadenceTypes(first).map((type) => ({
    id: `ncad:t:${type.id}`,
    choice: effectiveCadence(stored, offTypes, type.id),
    title: type.title,
    description: `עכשיו: ${cadenceLabel(effectiveCadence(stored, offTypes, type.id))}`,
  }));
}

export function cadenceOptionsFor(typeId: string): { code: string; choice: CadenceChoice; title: string }[] {
  const type = cadenceType(typeId);
  const all = [
    { code: "each", choice: "each" as const, title: "על כל פריט" },
    { code: "day", choice: "daily" as const, title: "פעם ביום" },
    { code: "x3", choice: "thrice" as const, title: "3 פעמים ביום" },
    { code: "off", choice: "off" as const, title: "ללא" },
  ];
  return type && !type.digest ? all.filter((row) => row.choice === "each" || row.choice === "off") : all;
}

export function cadenceFocus(typeId: string): string {
  return `/crm?goto=accNotifPrefs&focus=cadence_${typeId}`;
}

export function cadenceOpenId(typeId?: string | null): string {
  return typeId && cadenceType(typeId) ? `ncad:open:${typeId}` : CADENCE_OPEN_ID;
}

export const CADENCE_TYPES_BODY =
  "איזה סוג התראה להתאים?\nהקצב הנוכחי מופיע ליד כל סוג.";
export const CADENCE_TYPE_BUTTON = "בחירת סוג";
export const CADENCE_SAVED_CTA = "ההגדרה במערכת";

export function cadenceTypeBody(typeId: string): string {
  const name = cadenceType(typeId)?.title || "הסוג";
  return `איך לשלוח ${name} בוואטסאפ?\nאפשר תמיד לשנות את זה גם במערכת.`;
}

export function offWarn(typeId: string): string {
  const name = cadenceType(typeId)?.title || "הסוג הזה";
  return `בלי וואטסאפ על ${name} לא תצא הודעה על הסוג הזה. פריט חדש עלול להישאר בלי מענה.`;
}

export function offAfterText(typeId: string): string {
  const name = cadenceType(typeId)?.title || "הסוג הזה";
  if (typeId === "new_lead") {
    return "מעכשיו ליד חדש מחכה בפעמון. אפשר גם לשאול אותי אילו לידים חדשים יש. אפשר לשנות את זה בכל רגע.";
  }
  if (typeId === "open_demand") {
    return "מעכשיו ביקוש פתוח מחכה בפעמון. אפשר גם לשאול אותי: אילו לידים יש בביקוש הפתוח? אפשר לשנות את זה בכל רגע.";
  }
  return `מעכשיו ${name} מחכה בפעמון, בלי וואטסאפ. אפשר לשנות את זה בכל רגע.`;
}

export function cadenceOptionRows(typeId: string, dailyHour: number, hours: number[]): CadenceRow[] {
  return cadenceOptionsFor(typeId).map((opt) => ({
    id: `ncad:c:${typeId}:${opt.code}`,
    choice: opt.choice,
    title: opt.title,
    description: optionDescription(opt.choice, dailyHour, hours),
  }));
}

function optionDescription(choice: CadenceChoice, dailyHour: number, hours: number[]): string {
  if (choice === "daily") return `הודעה אחת ביום, ${hoursPhrase([dailyHour])}. ${FRIDAY_NOTE}`;
  if (choice === "thrice") return `${hoursPhrase(hours)}. ${FRIDAY_NOTE}`;
  if (choice === "off") return "הפריטים נשארים בפעמון, בלי וואטסאפ";
  return "הודעה על כל פריט, מיד כשהוא נכנס";
}

export function typeConfirmLine(
  typeId: string,
  choice: CadenceChoice,
  changed: boolean,
  dailyHour: number,
  hours: number[],
): string {
  const name = cadenceType(typeId)?.title || "הסוג";
  if (!changed) return `זה כבר הקצב של ${name}: ${cadenceLabel(choice)}.`;
  if (choice === "each") return `מעכשיו ${name} יוצא על כל פריט.`;
  if (choice === "daily") {
    return `מעכשיו ${name} יוצא פעם ביום, ${hoursPhrase([dailyHour])}. ${FRIDAY_NOTE}.`;
  }
  if (choice === "thrice") return `מעכשיו ${name} יוצא ${hoursPhrase(hours)}. ${FRIDAY_NOTE}.`;
  return offAfterText(typeId);
}

export type CadenceTap =
  | { kind: "open"; type: string | null }
  | { kind: "types" }
  | { kind: "type"; type: string }
  | { kind: "choice"; type: string; choice: CadenceChoice; code: string }
  | { kind: "confirm"; type: string }
  | { kind: "back"; type: string }
  | { kind: "done" };

export function parseCadenceTap(id: string): CadenceTap | null {
  if (id === CADENCE_OPEN_ID) return { kind: "open", type: null };
  if (id === CADENCE_MORE_ID) return { kind: "types" };
  if (id === CADENCE_DONE_ID) return { kind: "done" };
  if (id === CADENCE_BACK_ID) return { kind: "back", type: "" };
  const open = /^ncad:open:([a-z_]+)$/.exec(id);
  if (open && cadenceType(open[1])) return { kind: "open", type: open[1] };
  const type = /^ncad:t:([a-z_]+)$/.exec(id);
  if (type && cadenceType(type[1])) return { kind: "type", type: type[1] };
  const choice = /^ncad:c:([a-z_]+):(each|day|x3|off)$/.exec(id);
  if (choice && cadenceType(choice[1])) {
    return { kind: "choice", type: choice[1], code: choice[2], choice: CHOICE_CODE[choice[2]] };
  }
  const yes = /^ncad:yes:([a-z_]+)$/.exec(id);
  if (yes && cadenceType(yes[1])) return { kind: "confirm", type: yes[1] };
  const back = /^ncad:back:([a-z_]+)$/.exec(id);
  if (back && cadenceType(back[1])) return { kind: "back", type: back[1] };
  return null;
}
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
  return parseCadenceTap(id) !== null;
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
  return digestIntroFor("new_lead", dow, hour);
}

export function digestIntroFor(typeId: string, dow: number, hour: number): string {
  const name = typeId === "new_lead" ? "הלידים החדשים" : (cadenceType(typeId)?.title || "העדכונים");
  return `${name}, ${whenLabel(dow, hour)}.`;
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
  ordinal = 1,
): "text" | "template" | "bell" {
  // הסיכום השלישי ביום אינו תבנית: טקסט רק בתוך חלון 24 השעות, אחרת פעמון.
  // הוא לא נספר בתקרה ולא עוקף אותה. send אינו עוקף את התקרה גם בשני הראשונים.
  if (ordinal >= 3) return inWindow ? "text" : "bell";
  if (inWindow) return "text";
  if (outside === "bell") return "bell";
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
