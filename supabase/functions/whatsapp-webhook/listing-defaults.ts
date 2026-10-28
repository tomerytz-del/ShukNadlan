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

export type ListOutbox = {
  kind: "list";
  body: string;
  button: string;
  section: string;
  rows: { id: string; title: string; description?: string }[];
};

export type BatchableOutbox = CtaOutbox | ButtonOutbox | ListOutbox;

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

/**
 * קישור לרשימת הנכסים, מאותו אתר. בלי כתובת מלאה (http/https) אין מאיפה
 * לגזור את האתר - null, ולא קישור הנכס הראשון.
 */
export function propertiesListUrl(sample: string): string | null {
  const m = /^(https?:\/\/[^/?#]+)/.exec(sample);
  if (!m) return null;
  return `${m[1]}/crm?goto=accProperties`;
}

/**
 * עמודה שעוד לא קיימת. Postgres מחזיר 42703; PostgREST מחזיר PGRST204
 * על אותה עמודה חסרה. שם העמודה בטקסט השגיאה אינו זה.
 */
export function listingCityColumnMissing(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  return error?.code === "42703" || error?.code === "PGRST204";
}

/**
 * ה-patch בלי default_city_id, רק כשהעמודה עוד לא נפרסה והשמירה נגעה בה.
 * null = להשאיר את השגיאה כמו שהיא.
 */
export function profilePatchIfCityColumnMissing(
  patch: Record<string, unknown>,
  error: { code?: string; message?: string } | null | undefined,
): Record<string, unknown> | null {
  if (!listingCityColumnMissing(error)) return null;
  if (!Object.prototype.hasOwnProperty.call(patch, "default_city_id")) return null;
  const rest = { ...patch };
  delete rest.default_city_id;
  return rest;
}

/** השם שכבר נטען לתור. undefined = עוד לא נטען, ואין לקרוא למסד בשביל הפרומפט. */
export function cachedListingCityName(
  slot: ListingCitySlot | undefined,
): string | null | undefined {
  if (!slot?.loaded) return undefined;
  return slot.name;
}

/** שורת הפרומפט. עיר ידועה, "אין שמורה", או כלל בלי טענה כשהזיכרון ריק. */
export function listingCityPromptLine(cached: string | null | undefined): string {
  if (cached) {
    return `עיר ברירת מחדל לנכס חדש: ${cached}. כשהסוכן/ת לא אמר/ה עיר - אל תשלח/י city.`;
  }
  if (cached === null) {
    return "אין עיר ברירת מחדל שמורה לנכס חדש. נכס בלי עיר נרשם בעיר המשרד. " +
      "בקשה לשמור עיר קבועה - update_profile עם default_city. אל תאמרי שאין דרך לשמור.";
  }
  return "כשהסוכן/ת לא אמר/ה עיר - אל תשלח/י city. הקוד שם את העיר השמורה, ואם אין - את עיר המשרד. " +
    "בקשה לשמור עיר קבועה - update_profile עם default_city.";
}

/** העיר השמורה של התור. הקריאה למסד רצה פעם אחת; שמירה באמצע התור מעדכנת בלי שאילתה. */
export type ListingCitySlot = { loaded: boolean; name: string | null };

export async function loadListingCityOnce(
  slot: ListingCitySlot,
  read: () => Promise<string | null>,
): Promise<string | null> {
  if (slot.loaded) return slot.name;
  slot.name = await read();
  slot.loaded = true;
  return slot.name;
}

export function storeListingCity(slot: ListingCitySlot, name: string | null): void {
  slot.loaded = true;
  slot.name = name && name.trim() ? name.trim() : null;
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

  const listUrl = propertiesListUrl(created[0].url);
  // בלי אתר מלא כל נכס נשאר עם כפתור העריכה שלו, ולא עם קישור הנכס הראשון.
  if (!listUrl) return items;

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
    url: listUrl,
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
