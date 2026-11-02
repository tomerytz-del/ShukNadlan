// בורר נכס של גבריאלה, וההודעות שהוא דוחף לתור.
//
// 1.11.2026, 18:44: הסוכן בחר "רק עם פרץ ציוני" אחרי התאמות לחנות למכירה.
// list_properties מצא בכתובת גם דירה למכירה וגם חנות להשכרה, ודחף רשימת
// "איזה נכס לפתוח?" ועוד כרטיס "פתיחה ב-CRM" לכל שורה - אחרי "פתחתי מיניסייט"
// ולפני כפתורי השליחה. שלושה דברים נפרדים:
//
// א. screenBundle חותם wc ו-wt על הנתיב שבכפתור. ההשוואה "השורה כבר ברשימה"
//    הייתה על הנתיב בלי החותמת, ולכן אף שורה לא נחשבה ברשימה וכל אחת קיבלה
//    גם כרטיס.
// ב. בורר שנפתח כדי למצוא מזהה אינו הודעה לסוכן/ת כשבאותו תור כבר רצה כלי
//    שכותב (מיניסייט, לקוח/ה, נכס). הוא יורד לפני השליחה.
// ג. בחירה מתוך ההתאמות נפתרת מול agent_client_matches (client_property_match),
//    קבוצה שכבר מסוננת לפי סוג העסקה וסוג הנכס, לא מול כל הנכסים בכתובת.

import {
  bareCrmPath,
  parseNavId,
  screenBundle,
  type ScreenRef,
} from "../_shared/agent-deep-link.ts";

export type OutboxItem =
  | {
    kind: "cta";
    body: string;
    label: string;
    url: string;
    /** נכס שנוצר בתור הזה. שניים או יותר מתקפלים להודעה אחת לפני השליחה. */
    batch?: "property_created";
    listLine?: string;
    /** בורר שנפתח כדי למצוא מזהה. יורד כשבאותו תור רץ כלי כתיבה. */
    origin?: "lookup";
  }
  | {
    kind: "buttons";
    body: string;
    buttons: { id: string; title: string }[];
    origin?: "lookup";
  }
  | {
    kind: "list";
    body: string;
    button: string;
    section: string;
    rows: { id: string; title: string; description?: string }[];
    origin?: "lookup";
  };

export type LookupRow = {
  id: string;
  title: string;
  address?: string;
};

/** התאמה שכבר עברה את סינון הלקוח/ה (סוג עסקה, סוג נכס, ציון). */
export type ShowcaseMatch = {
  property_id?: unknown;
  title?: unknown;
  street?: unknown;
  house_number?: unknown;
  city?: unknown;
  deal_type?: unknown;
  property_type?: unknown;
};

export type ShowcaseRefs =
  | { ok: true; ids: string[] }
  | { ok: false; ask: string; ambiguous: boolean };

const MUTATING_TOOLS = new Set([
  "create_property",
  "import_properties_file",
  "update_property",
  "set_property_status",
  "attach_images",
  "discard_pending_images",
  "manage_images",
  "move_property_photos",
  "share_property",
  "unshare_property",
  "set_share_level",
  "create_property_video",
  "create_client",
  "update_client",
  "set_client_status",
  "create_showcase",
  "remove_from_showcase",
  "prepare_agreement",
  "cancel_agreement",
  "reissue_agreement",
  "whatsapp_alerts",
  "agenda_add",
  "agenda_update",
  "cancel_showing",
  "update_profile",
]);

/** כלי שכותב. list_properties ו-search_properties אינם כאן: בורר שלהם נשאר כשאין פעולה. */
export function agentToolMutates(name: string): boolean {
  return MUTATING_TOOLS.has(name);
}

/** נתיב חתום ונתיב חשוף הם אותו מסך. */
export function pathListed(listed: readonly string[], path: string): boolean {
  const bare = bareCrmPath(path);
  return listed.some((item) => bareCrmPath(item) === bare);
}

/**
 * כפתור אחד, או רשימה ועוד "הכול". `listed` הם הנתיבים שבאמת נכנסו לכפתור,
 * בלי wc ו-wt. שורה שלא נכנסה שומרת כרטיס אצל הקורא.
 */
export function screenOutbox(
  screens: ScreenRef[],
  body: string,
  category: string,
  siteBase: string,
  origin?: "lookup",
): { items: OutboxItem[]; listed: string[]; sent: boolean } {
  if (!siteBase) return { items: [], listed: [], sent: false };
  const plan = screenBundle(screens, () => category);
  const raw = plan.kind === "single"
    ? [plan.path]
    : plan.kind === "list"
    ? plan.rows.flatMap((row) => {
      const path = parseNavId(row.id);
      return path ? [path] : [];
    })
    : [];
  const listed = raw.map(bareCrmPath);
  const tag = origin ? { origin } : {};
  if (plan.kind === "single") {
    const item: OutboxItem = {
      kind: "cta",
      body,
      label: plan.label,
      url: `${siteBase}${plan.path}`,
      ...tag,
    };
    return { items: [item], listed, sent: true };
  }
  if (plan.kind === "list") {
    const item: OutboxItem = {
      kind: "list",
      body,
      button: plan.button,
      section: plan.section,
      rows: plan.rows,
      ...tag,
    };
    return { items: [item], listed, sent: true };
  }
  return { items: [], listed: [], sent: false };
}

/**
 * מה ש-list_properties דוחף לתור: רשימה (או כרטיס יחיד), וכרטיס "פתיחה ב-CRM"
 * רק לשורה שלא נכנסה. הנתיב להשוואה בלי wc ו-wt, אחרת כל שורה מקבלת גם כרטיס.
 */
export function propertyLookupOutbox(
  rows: LookupRow[],
  category: string,
  siteBase: string,
): { items: OutboxItem[]; listed: string[]; sent: boolean } {
  const screens: ScreenRef[] = rows.map((row) => ({
    type: "listing",
    path: `/crm?goto=accProperties&property=${row.id}`,
    title: row.title || "נכס",
    body: row.address || "",
  }));
  const built = screenOutbox(screens, "איזה נכס לפתוח?", category, siteBase, "lookup");
  const items = [...built.items];
  for (const row of rows) {
    const path = `/crm?goto=accProperties&property=${row.id}`;
    if (built.sent && pathListed(built.listed, path)) continue;
    if (!siteBase) continue;
    items.push({
      kind: "cta",
      body: row.title || "נכס",
      label: "פתיחה ב-CRM",
      url: `${siteBase}${path}`,
      origin: "lookup",
    });
  }
  return { items, listed: built.listed, sent: built.sent };
}

/** בורר חיפוש יורד בתור פעולה. בלי פעולה הוא נשאר. */
export function dropLookupOnMutation<T extends { origin?: "lookup" }>(
  items: readonly T[],
  mutated: boolean,
): T[] {
  if (!mutated) return items.slice();
  return items.filter((item) => item.origin !== "lookup");
}

/**
 * מה שנשלח אחרי התור: הטקסט תמיד, והתור בלי בוררי חיפוש אם רץ כלי כתיבה.
 * index.ts שולח את הטקסט ואז את מה שנשאר ב-outbox.
 */
export function turnOutbound(
  reply: string,
  outbox: readonly OutboxItem[],
  toolNames: readonly string[],
): { text: string; outbox: OutboxItem[] } {
  const mutated = toolNames.some((name) => agentToolMutates(name));
  return { text: reply, outbox: dropLookupOnMutation(outbox, mutated) };
}

function fold(value: unknown): string {
  return String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function refKey(raw: string): string {
  return fold(raw).replace(/^רחוב\s+/, "");
}

function matchHaystack(row: ShowcaseMatch): string {
  const street = fold(row.street);
  const house = fold(row.house_number);
  const city = fold(row.city);
  const streetLine = [street, house].filter(Boolean).join(" ");
  return [fold(row.title), street, streetLine, house, city, [streetLine, city].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(" ");
}

function show(value: unknown): string {
  return String(value ?? "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

function dealLabel(deal: unknown): string {
  const value = String(deal ?? "");
  if (value === "rent") return "להשכרה";
  if (value === "sale") return "למכירה";
  return "";
}

function matchLine(row: ShowcaseMatch): string {
  const where = [show(row.street), show(row.house_number)].filter(Boolean).join(" ");
  const place = [where, show(row.city)].filter(Boolean).join(", ");
  const kind = [show(row.property_type), dealLabel(row.deal_type)].filter(Boolean).join(" ");
  const title = show(row.title);
  return [title || place || "נכס", kind, place].filter(Boolean).join(" - ");
}

function clipRef(raw: string): string {
  return String(raw).replace(/[\r\n"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

/**
 * קטעי כתובת או כותרת מול ההתאמות של הלקוח/ה בלבד.
 * יותר מהתאמה אחת לאותו קטע - שאלה בטקסט, בלי מזהים ובלי בורר CRM.
 */
export function resolveShowcaseRefs(
  matches: readonly ShowcaseMatch[],
  refs: readonly string[],
): ShowcaseRefs {
  const rows = matches.filter((row) => String(row.property_id || "").trim());
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const raw of refs) {
    const key = refKey(raw);
    const label = clipRef(raw);
    if (key.length < 2) {
      return {
        ok: false,
        ambiguous: false,
        ask: "צריך קטע כתובת או כותרת כדי לבחור מתוך ההתאמות.",
      };
    }
    const hits: ShowcaseMatch[] = [];
    const hitIds = new Set<string>();
    for (const row of rows) {
      const id = String(row.property_id);
      if (hitIds.has(id)) continue;
      if (!matchHaystack(row).includes(key)) continue;
      hitIds.add(id);
      hits.push(row);
    }
    if (hits.length === 0) {
      return {
        ok: false,
        ambiguous: false,
        ask: `לא מצאתי את "${label}" בין ההתאמות של הלקוח/ה. אפשר לבחור לפי כתובת או כותרת מתוך מה שהוצג.`,
      };
    }
    if (hits.length > 1) {
      const lines = hits.map((row) => matchLine(row)).join("\n");
      return {
        ok: false,
        ambiguous: true,
        ask: `יש יותר מהתאמה אחת ל"${label}". איזה מהם?\n${lines}`,
      };
    }
    const id = String(hits[0].property_id);
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  if (!ids.length) {
    return {
      ok: false,
      ambiguous: false,
      ask: "צריך קטע כתובת או כותרת כדי לבחור מתוך ההתאמות.",
    };
  }
  return { ok: true, ids };
}
