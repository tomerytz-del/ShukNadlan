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

export type CadenceChoice = "each" | "daily" | "thrice" | "off" | "digest";
export type CadenceGroupId = "new_leads" | "meetings" | "open_demand" | "matches" | "system_mentor";
export type CadenceGroupMode = "choices" | "locked" | "digest";

export type CadenceGroup = {
  id: CadenceGroupId;
  title: string;
  mode: CadenceGroupMode;
  confirmOff: boolean;
};

/** קבוצות הקצב. סוג שלא ממופה ולא מוחרג נופל ל-system_mentor. */
export const CADENCE_GROUPS: CadenceGroup[] = [
  { id: "new_leads", title: "לידים חדשים", mode: "choices", confirmOff: true },
  { id: "meetings", title: "פגישות וסיורים", mode: "locked", confirmOff: false },
  { id: "open_demand", title: "ביקוש פתוח", mode: "choices", confirmOff: true },
  { id: "matches", title: "התאמות", mode: "choices", confirmOff: true },
  { id: "system_mentor", title: "מערכת ומנטור", mode: "digest", confirmOff: true },
];

/** מיפוי מפורש. כל סוג ב-notifications_type_check נמצא כאן או ב-CADENCE_EXCLUDED. */
export const CADENCE_GROUP_MAP: Record<string, CadenceGroupId> = {
  new_lead: "new_leads",
  onboarding_lead: "new_leads",
  lead_response_reminder: "new_leads",
  lead_response_escalation: "new_leads",
  leads_digest: "new_leads",
  agenda_reminder: "meetings",
  showcase_meeting: "meetings",
  open_demand: "open_demand",
  listing_match: "matches",
  client_match: "matches",
  match_digest: "matches",
  showcase_activity: "matches",
  system: "system_mentor",
  coach_daily: "system_mentor",
  platform_coach: "system_mentor",
  marketing_copy: "system_mentor",
  review_request: "system_mentor",
  review_new: "system_mentor",
  agreement_signed: "system_mentor",
  deal_closed: "system_mentor",
  lead_prefs_default: "system_mentor",
  onboarding_property: "system_mentor",
  onboarding_client: "system_mentor",
  onboarding_agreement: "system_mentor",
  onboarding_license: "system_mentor",
  market_alert: "system_mentor",
  collab_offer: "system_mentor",
  exclusivity_taken: "system_mentor",
  retention_warning: "system_mentor",
  platform_broadcast: "system_mentor",
  unpublished_nudge: "system_mentor",
  publish_ask_nudge: "system_mentor",
  call_deleted_by_manager: "system_mentor",
};

/** לא בתפריט, והשליחה שלהם לא משתנה. */
export const CADENCE_EXCLUDED = new Set([
  "ops_alert",
  "security_alert",
  "platform_signup",
  "platform_upgrade",
  "deal_sync_summary",
  "deal_data_gap",
  "review_alert",
  "lead_unrouted",
  "access_review",
  "admin_overdue",
  "market_nudge",
  "budget_alert",
  "improvement_suggestion",
]);

export const CADENCE_MORE_ID = "ncad:more";
export const CADENCE_DONE_ID = "ncad:done";
export const CADENCE_MORE_TITLE = "קבוצה נוספת";
export const CADENCE_DONE_TITLE = "סיימתי";

const CHOICE_CODE: Record<string, CadenceChoice> = {
  each: "each",
  day: "daily",
  x3: "thrice",
  off: "off",
  dig: "digest",
};

export function cadenceGroupOf(type: string | null | undefined): CadenceGroupId | null {
  if (!type || CADENCE_EXCLUDED.has(type)) return null;
  return CADENCE_GROUP_MAP[type] || "system_mentor";
}

export function cadenceGroup(id: string | null | undefined): CadenceGroup | undefined {
  return CADENCE_GROUPS.find((g) => g.id === id);
}

export function orderCadenceGroups(first?: string | null): CadenceGroup[] {
  const hit = cadenceGroup(first);
  if (!hit) return CADENCE_GROUPS;
  return [hit, ...CADENCE_GROUPS.filter((g) => g.id !== hit.id)];
}

export function cadenceLabel(choice: CadenceChoice): string {
  if (choice === "daily") return "פעם ביום";
  if (choice === "thrice") return "3 פעמים ביום";
  if (choice === "digest") return "בסיכום היומי";
  if (choice === "off") return "ללא";
  return "על כל פריט";
}

export function groupTypes(groupId: CadenceGroupId): string[] {
  return Object.entries(CADENCE_GROUP_MAP)
    .filter(([, group]) => group === groupId)
    .map(([type]) => type);
}

export function effectiveGroupCadence(
  stored: Record<string, string> | null | undefined,
  offTypes: string[] | null | undefined,
  groupId: string,
): CadenceChoice {
  const group = cadenceGroup(groupId);
  if (!group || group.mode === "locked") return "each";
  const raw = stored?.[groupId];
  if (group.mode === "digest") {
    if (raw === "digest" || raw === "off") return raw;
    const types = groupTypes("system_mentor");
    if (types.length && types.every((type) => (offTypes || []).includes(type))) return "off";
    return "digest";
  }
  if (raw === "each" || raw === "daily" || raw === "thrice" || raw === "off") return raw;
  const types = groupTypes(group.id);
  if (types.length && types.every((type) => (offTypes || []).includes(type))) return "off";
  return "each";
}

export function typeListRows(
  first: string | null | undefined,
  stored: Record<string, string> | null | undefined,
  offTypes: string[] | null | undefined,
): CadenceRow[] {
  return orderCadenceGroups(first).map((group) => {
    const choice = effectiveGroupCadence(stored, offTypes, group.id);
    const description = group.mode === "locked"
      ? "יוצא תמיד, בלי בחירה"
      : `עכשיו: ${cadenceLabel(choice)}`;
    return {
      id: `ncad:t:${group.id}`,
      choice,
      title: group.title,
      description,
    };
  });
}

export function cadenceOptionsFor(groupId: string): { code: string; choice: CadenceChoice; title: string }[] {
  const group = cadenceGroup(groupId);
  if (!group || group.mode === "locked") return [];
  if (group.mode === "digest") {
    return [
      { code: "dig", choice: "digest", title: "בסיכום היומי" },
      { code: "off", choice: "off", title: "רק בפעמון" },
    ];
  }
  const eachTitle = groupId === "new_leads" ? "על כל ליד" : groupId === "matches" ? "על כל התאמה" : "על כל פריט";
  return [
    { code: "each", choice: "each", title: eachTitle },
    { code: "day", choice: "daily", title: "פעם ביום" },
    { code: "x3", choice: "thrice", title: "3 פעמים ביום" },
    { code: "off", choice: "off", title: "ללא" },
  ];
}

export function cadenceFocus(groupId: string): string {
  return `/crm?goto=accNotifPrefs&focus=cadence_${groupId}`;
}

export function cadenceOpenId(typeOrGroup?: string | null): string {
  const group = cadenceGroup(typeOrGroup) ? typeOrGroup : cadenceGroupOf(typeOrGroup);
  return group ? `ncad:open:${group}` : CADENCE_OPEN_ID;
}

export const CADENCE_TYPES_BODY =
  "איזו קבוצת התראות להתאים?\nהקצב הנוכחי מופיע ליד כל קבוצה.";
export const CADENCE_TYPE_BUTTON = "בחירת קבוצה";
export const CADENCE_SAVED_CTA = "ההגדרה במערכת";

export function cadenceTypeBody(groupId: string): string {
  if (groupId === "meetings") {
    return "פגישות וסיורים יוצאים תמיד, בלי בחירת קצב. הם גם ביומן במערכת.";
  }
  if (groupId === "system_mentor") {
    return "עדכוני מערכת ומנטור לא יוצאים כוואטסאפ נפרד. אפשר לכלול אותם בסיכום היומי, והם תמיד בפעמון.";
  }
  const name = cadenceGroup(groupId)?.title || "הקבוצה";
  return `איך לשלוח ${name} בוואטסאפ?\nאפשר תמיד לשנות את זה גם במערכת.`;
}

export function offWarn(groupId: string): string {
  if (groupId === "new_leads") {
    return "בלי התראות על לידים המענה איטי יותר, וליד בלי מענה עלול לעבור הלאה. לאשר?";
  }
  if (groupId === "open_demand") {
    return "בלי התראה סוכנים מהירים יותר יתפסו את הביקוש. הוא גם בלשונית ביקוש פתוח, בפעמון, ואפשר לשאול אותי.";
  }
  if (groupId === "matches") {
    return "בלי התראה מפסידים עסקאות שת״פ, ולקוחות שאהבו נכס מחכים. ההתאמות גם אצל הלקוחות ובפעמון.";
  }
  if (groupId === "system_mentor") {
    return "בלי הסיכום, עדכוני מערכת ומנטור נשארים רק בפעמון ולא יוצאים כוואטסאפ. לאשר?";
  }
  return "בלי וואטסאפ הפריטים נשארים בפעמון. לאשר?";
}

export function offAfterText(groupId: string): string {
  if (groupId === "new_leads") {
    return "מעכשיו לידים חדשים בלי וואטסאפ. הם בלשונית הלידים, בפעמון, ואפשר לשאול אותי. אפשר לשנות בכל רגע.";
  }
  if (groupId === "open_demand") {
    return "מעכשיו ביקוש פתוח בלי וואטסאפ. הוא בלשונית ביקוש פתוח, בפעמון, ואפשר לשאול אותי אילו לידים יש בביקוש הפתוח.";
  }
  if (groupId === "matches") {
    return "מעכשיו התאמות בלי וואטסאפ. הן אצל הלקוחות ובפעמון. אפשר לשנות בכל רגע.";
  }
  if (groupId === "system_mentor") {
    return "מעכשיו עדכוני מערכת ומנטור רק בפעמון, בלי סיכום יומי. אפשר לשנות בכל רגע.";
  }
  return "מעכשיו הקבוצה הזו בלי וואטסאפ. אפשר לשנות בכל רגע.";
}

export function meetingsInfo(): string {
  return "פגישות וסיורים יוצאים תמיד, בלי בחירת קצב. הם גם ביומן במערכת.";
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
  groupId: string,
  choice: CadenceChoice,
  changed: boolean,
  dailyHour: number,
  hours: number[],
): string {
  const name = cadenceGroup(groupId)?.title || "הקבוצה";
  if (choice === "digest") {
    return changed
      ? `מעכשיו ${name} נכנסים לסיכום היומי, ובפעמון. לא כוואטסאפ נפרד.`
      : `זה כבר הקצב של ${name}: בסיכום היומי.`;
  }
  if (!changed) return `זה כבר הקצב של ${name}: ${cadenceLabel(choice)}.`;
  if (choice === "each") return `מעכשיו ${name} יוצאים על כל פריט.`;
  if (choice === "daily") {
    return `מעכשיו ${name} יוצאים פעם ביום, ${hoursPhrase([dailyHour])}. ${FRIDAY_NOTE}.`;
  }
  if (choice === "thrice") return `מעכשיו ${name} יוצאים ${hoursPhrase(hours)}. ${FRIDAY_NOTE}.`;
  return offAfterText(groupId);
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
  if (open && cadenceGroup(open[1])) return { kind: "open", type: open[1] };
  const type = /^ncad:t:([a-z_]+)$/.exec(id);
  if (type && cadenceGroup(type[1])) return { kind: "type", type: type[1] };
  const choice = /^ncad:c:([a-z_]+):(each|day|x3|off|dig)$/.exec(id);
  if (choice && cadenceGroup(choice[1]) && cadenceGroup(choice[1])?.mode !== "locked") {
    return { kind: "choice", type: choice[1], code: choice[2], choice: CHOICE_CODE[choice[2]] };
  }
  const yes = /^ncad:yes:([a-z_]+)$/.exec(id);
  if (yes && cadenceGroup(yes[1])) return { kind: "confirm", type: yes[1] };
  const back = /^ncad:back:([a-z_]+)$/.exec(id);
  if (back && cadenceGroup(back[1])) return { kind: "back", type: back[1] };
  return null;
}
export type OutsideMode = "cap" | "bell";

export type CadenceRow = { id: string; choice: CadenceChoice; title: string; description: string };

const CHOICES = new Set<CadenceChoice>(["each", "daily", "thrice", "off", "digest"]);

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
  const name = typeId === "new_leads" || typeId === "new_lead"
    ? "הלידים החדשים"
    : (cadenceGroup(typeId)?.title || "העדכונים");
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
  // לכל היותר שתי תבניות ביום, 8 שעות ביניהן. אין מצב send שעוקף את התקרה.
  if (ordinal >= 3) return inWindow ? "text" : "bell";
  if (inWindow) return "text";
  if (outside === "bell") return "bell";
  return capAllows ? "template" : "bell";
}

export function parseOutside(value: string | null | undefined): OutsideMode {
  if (value === "bell") return "bell";
  return "cap";
}

export function parseChoice(value: string | null | undefined): CadenceChoice {
  return CHOICES.has(value as CadenceChoice) ? value as CadenceChoice : "each";
}

/** אין תאריך בנוסח שמוצג. שעה ויום בשבוע מותרים. */
export function hasCalendarDate(text: string): boolean {
  return /\d{1,2}[./]\d{1,2}/.test(text) || /\d{4}/.test(text);
}
