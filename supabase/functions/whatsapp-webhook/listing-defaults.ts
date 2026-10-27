// עיר ברירת מחדל לנכס, וקיפול כפתורי "עריכה ב-CRM" של כמה נכסים בתור אחד.
// בלי Deno ובלי מסד, כדי שהבדיקה ב-node תריץ את ההחלטה עצמה.

/** כפתור העריכה הקיים. כותרת בתוך 20 יחידות UTF-16 של Meta. */
export const CRM_EDIT_LABEL = "✏️ עריכה ב-CRM";

/** כמה שורות מוצגות בהודעה המאוחדת. מעבר לזה - "ועוד N" ואותו קישור. */
export const LIST_ROWS_MAX = 10;

/** גוף כפתור קישור ב-WhatsApp. חריגה דוחה את ההודעה כולה. */
export const CTA_BODY_MAX = 1024;

export type CtaOutbox = {
  kind: "cta";
  body: string;
  label: string;
  url: string;
  batch?: "property_created";
  listLine?: string;
};

export type ButtonOutbox = {
  kind: "buttons";
  body: string;
  buttons: { id: string; title: string }[];
};

export type BatchableOutbox = CtaOutbox | ButtonOutbox;

/**
 * עיר לנכס חדש כשהסוכן/ת לא אמר/ה עיר.
 * קודם העיר השמורה שלו/ה, אחר כך עיר המשרד, ולבסוף עפולה -
 * אותה נפילה שהייתה כשמשרד בלי עיר.
 */
export function propertyCityWhenOmitted(
  agentDefault: string | null | undefined,
  officeCity: string | null | undefined,
): string {
  const agent = String(agentDefault || "").trim();
  if (agent) return agent;
  const office = String(officeCity || "").trim();
  return office || "עפולה";
}

/** קישור לרשימת הנכסים של הסוכן/ת, מאותו אתר שממנו נבנה קישור הנכס. */
export function propertiesListUrl(sample: string): string {
  const m = /^(https?:\/\/[^/?#]+)/.exec(sample);
  if (!m) return sample;
  return `${m[1]}/crm?goto=accProperties`;
}

function oneLine(value: string | undefined): string {
  const line = String(value || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return line || "נכס";
}

/**
 * כמה נכסים שנוצרו באותו תור - הודעת עריכה אחת עם הרשימה, וכפתור אחד
 * לרשימת הנכסים. נכס יחיד נשאר עם הכפתור שלו. עדכון נכס קיים (בלי batch)
 * אינו נכנס לקיפול.
 */
export function collapseCreatedPropertyEdits<T extends BatchableOutbox>(items: T[]): T[] {
  const created = items.filter(
    (item): item is T & CtaOutbox => item.kind === "cta" && item.batch === "property_created",
  );
  if (created.length < 2) return items;

  const shown = created.slice(0, LIST_ROWS_MAX);
  const lines = shown.map((item, i) => `${i + 1}. ${oneLine(item.listLine)}`);
  const extra = created.length - shown.length;
  let body = `נרשמו ${created.length} נכסים. לעריכה ולתמונות:\n${lines.join("\n")}`;
  if (extra > 0) body += `\nועוד ${extra}.`;
  if (body.length > CTA_BODY_MAX) body = body.slice(0, CTA_BODY_MAX - 1) + "…";

  const summary: CtaOutbox = {
    kind: "cta",
    body,
    label: CRM_EDIT_LABEL,
    url: propertiesListUrl(created[0].url),
  };
  let placed = false;
  const out: T[] = [];
  for (const item of items) {
    if (item.kind === "cta" && item.batch === "property_created") {
      if (!placed) {
        out.push(summary as T);
        placed = true;
      }
      continue;
    }
    out.push(item);
  }
  return out;
}
