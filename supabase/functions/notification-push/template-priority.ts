// סדר תבניות הוואטסאפ לסוכנים, זיהוי 131049, ונוסח התקציר.
// בלי מסד ובלי Deno, כדי שהבדיקה ב-node תריץ את אותו קוד שהשליחה קוראת.

/** שורה 1: אדם מחכה, או התראת תפעול. לא נדחה לתקציר. */
export const TIER1_TYPES = [
  "new_lead",
  "showcase_meeting",
  "agenda_reminder",
  "ops_alert",
] as const;

/** שורה 2: ביקוש פתוח. קודם לסיכומים, אחרי שורה 1. */
export const TIER2_TYPES = ["open_demand"] as const;

const MATCH_TYPES = new Set(["match_digest", "client_match", "listing_match"]);

/** סיכומים ותפוצה. לא התראת אבטחה ולא ליד שלא שובץ. */
const SUMMARY_TYPES = new Set([
  "match_digest",
  "client_match",
  "listing_match",
  "share_digest",
  "system",
  "platform_signup",
  "leads_digest",
  "digest",
  "burst_digest",
  "deal_sync_summary",
]);

/** 0 נשאר עם ההודעה שיוצאת, ולא נדחה לתקציר. */
export function templateTier(type: string): 0 | 1 | 2 | 3 {
  if ((TIER1_TYPES as readonly string[]).includes(type)) return 1;
  if ((TIER2_TYPES as readonly string[]).includes(type)) return 2;
  if (SUMMARY_TYPES.has(type)) return 3;
  return 0;
}

/**
 * Meta רושמת 131049 ב-delivery_detail אחרי ש-whatsapp_status כבר sent,
 * ולא ב-last_error. שני השדות נספרים.
 */
export function logHit131049(
  lastError: string | null | undefined,
  deliveryDetail: string | null | undefined,
): boolean {
  return String(lastError || "").includes("131049")
    || String(deliveryDetail || "").includes("131049");
}

/** תבנית נעצרת רק מחוץ לחלון 24 השעות. בתוך החלון זו הודעת שיחה. */
export function templatesHeld(opts: {
  stopOn: boolean;
  hit: boolean;
  inWindow: boolean;
}): boolean {
  return opts.stopOn && opts.hit && !opts.inWindow;
}

export type SlotPlan<T> = {
  send: T[];
  defer: T[];
  /** נוסח תקציר קצר, בלי לרכוב על הודעה דחופה. */
  digest: boolean;
};

/**
 * תבנית אחת במשבצת. שורה נמוכה לא נשלחת כשיש שורה גבוהה ממתינה באותה
 * אצווה: הגבוהה יוצאת, והשאר נשארים לפעמון ולתקציר. בתוך חלון 24 השעות
 * אין משבצת תבנית, והאצווה יוצאת כמו שהיא.
 * reclaim: פריטים שכבר נעצרו בתקרה יוצאים יחד כתקציר, בלי פיצול שני.
 */
export function planTemplateSlots<T extends { type: string }>(
  items: T[],
  opts: { template: boolean; reclaim: boolean },
): SlotPlan<T> {
  if (!opts.template) return { send: items.slice(), defer: [], digest: false };
  const has = (tier: 1 | 2 | 3) => items.some((it) => templateTier(it.type) === tier);
  const deferTiers = new Set<number>();
  if (has(1)) {
    deferTiers.add(2);
    deferTiers.add(3);
  } else if (has(2) && has(3) && !opts.reclaim) {
    deferTiers.add(3);
  }
  const send = items.filter((it) => !deferTiers.has(templateTier(it.type)));
  const defer = items.filter((it) => deferTiers.has(templateTier(it.type)));
  if (opts.reclaim) {
    const types = new Set(items.map((it) => it.type));
    return { send, defer, digest: items.length > 1 || types.size > 1 };
  }
  const summaries = send.filter((it) => templateTier(it.type) === 3);
  const digest = defer.length === 0 && summaries.length > 1
    && summaries.length === send.length;
  return { send, defer, digest };
}

function countPhrase(n: number, one: string, many: string): string | null {
  if (n === 1) return one;
  if (n > 1) return `${n} ${many}`;
  return null;
}

/**
 * שורת תקציר אחת. בלי כתובת, בלי טלפון, בלי גוף המודעה.
 * הכפתור נשאר מחוץ לטקסט.
 */
export function digestSummary(items: { type: string }[]): string {
  let demand = 0;
  let matches = 0;
  let other = 0;
  for (const it of items) {
    if (templateTier(it.type) === 1) continue;
    if (it.type === "open_demand") demand++;
    else if (MATCH_TYPES.has(it.type)) matches++;
    else other++;
  }
  const parts = [
    countPhrase(demand, "ביקוש פתוח אחד", "ביקושים פתוחים"),
    countPhrase(matches, "סיכום התאמות אחד", "סיכומי התאמות"),
    countPhrase(other, "עדכון אחד", "עדכונים"),
  ].filter((part): part is string => !!part);
  if (!parts.length) return "יש עדכונים חדשים. הפרטים בפעמון.";
  if (parts.length === 1) return `יש לך ${parts[0]}. הפרטים בפעמון.`;
  const last = parts[parts.length - 1];
  const joiner = /^\d/.test(last) ? " ו-" : " ו";
  return `יש לך ${parts.slice(0, -1).join(", ")}${joiner}${last}. הפרטים בפעמון.`;
}
