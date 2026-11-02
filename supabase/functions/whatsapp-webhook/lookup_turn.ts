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
import { cutMatches, MATCH_FETCH_CAP, MATCH_SHOW_MAX } from "./match-cut.ts";

/** ברירת המחדל של client_matches כשלא נשלח limit. */
export const CLIENT_MATCHES_DEFAULT_LIMIT = 5;

/**
 * אותו חלון ש-client_matches מציג. חסר או לא-מספר = 5.
 * מספר אמיתי נחתך כלפי מטה, ולפחות 1, ולא יותר מ-15.
 */
export function clientMatchesLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return CLIENT_MATCHES_DEFAULT_LIMIT;
  return Math.min(MATCH_SHOW_MAX, Math.max(1, Math.floor(n)));
}

/**
 * החלון של property_refs. בתור שבו client_matches רץ על הלקוח/ה - ה-limit
 * שהוצג. בתור אחר - ברירת המחדל (5), לא 15.
 */
export function showcaseShownLimit(opts: {
  clientId: string;
  rememberedClientId?: string;
  rememberedLimit?: number;
}): number {
  if (
    opts.rememberedClientId === opts.clientId &&
    typeof opts.rememberedLimit === "number" &&
    opts.rememberedLimit > 0
  ) {
    return Math.min(opts.rememberedLimit, MATCH_SHOW_MAX);
  }
  return CLIENT_MATCHES_DEFAULT_LIMIT;
}

/** מה ש-client_matches באמת הציג ללקוח/ה אחד/ת. נשמר בין תורים. */
export type ShownMatchSet = {
  ids: string[];
  limit: number;
  waive: string[];
};

const SHOWN_MARK = "[[shown-matches-v1]]";
const SHOWN_CLIENTS_MAX = 8;

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((block) => {
    if (!block || typeof block !== "object" || !("text" in block)) return "";
    return String((block as { text?: unknown }).text || "");
  }).join("");
}

function cleanIdList(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const value = String(id ?? "").trim().slice(0, 80);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= MATCH_SHOW_MAX) break;
  }
  return out;
}

function cleanWaive(waive: unknown): string[] {
  if (!Array.isArray(waive)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of waive) {
    const code = String(item ?? "").trim().slice(0, 40);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
    if (out.length >= 20) break;
  }
  return out;
}

export function normalizeShownMatchSet(set: Partial<ShownMatchSet> | null | undefined): ShownMatchSet | null {
  const ids = cleanIdList(set?.ids);
  if (!ids.length) return null;
  return {
    ids,
    limit: clientMatchesLimit(set?.limit),
    waive: cleanWaive(set?.waive),
  };
}

/** שומר את הקבוצה האחרונה ללקוח/ה, ומגביל לכמה לקוחות אחרונים. */
export function rememberShownMatches(
  current: Readonly<Record<string, ShownMatchSet>> | undefined,
  clientId: string,
  set: Partial<ShownMatchSet> | null,
): Record<string, ShownMatchSet> {
  const id = String(clientId || "").trim();
  const normalized = normalizeShownMatchSet(set);
  const next: Record<string, ShownMatchSet> = {};
  for (const [key, value] of Object.entries(current || {})) {
    if (key === id) continue;
    const kept = normalizeShownMatchSet(value);
    if (kept) next[key] = kept;
  }
  if (id && normalized) next[id] = normalized;
  const entries = Object.entries(next);
  return Object.fromEntries(entries.slice(-SHOWN_CLIENTS_MAX));
}

/** null = ה-JSON לא תקין. אובייקט (גם ריק) = נטען נקי. */
function parseShownPayload(text: string): Record<string, ShownMatchSet> | null {
  if (!text.startsWith(SHOWN_MARK)) return null;
  try {
    const raw = JSON.parse(text.slice(SHOWN_MARK.length)) as Record<string, Partial<ShownMatchSet>>;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const out: Record<string, ShownMatchSet> = {};
    for (const [key, value] of Object.entries(raw)) {
      const set = normalizeShownMatchSet(value);
      if (set) out[String(key)] = set;
    }
    return out;
  } catch {
    return null;
  }
}

type HistoryMessage = { role?: string; content?: unknown };

/**
 * מוציא כל שורה שמתחילה בסמן מההיסטוריה שהמודל רואה, מכל תפקיד.
 * מצב נשמר משורת assistant, וגם משורת user ישנה (#1138) רק כשכל
 * התוכן הוא הסמן ואחריו JSON תקין. טקסט שבור נזרק ולא נקרא.
 */
export function peelShownMatches<T extends HistoryMessage>(history: readonly T[]): {
  history: T[];
  shown: Record<string, ShownMatchSet>;
} {
  const kept: T[] = [];
  let shown: Record<string, ShownMatchSet> = {};
  for (const message of history) {
    const text = messageText(message?.content);
    if (!text.startsWith(SHOWN_MARK)) {
      kept.push(message);
      continue;
    }
    const role = message?.role;
    const parsed = role === "assistant" || role === "user" ? parseShownPayload(text) : null;
    if (parsed && Object.keys(parsed).length) shown = { ...shown, ...parsed };
    // גם payload ריק או שבור יוצא מההיסטוריה הגלויה
  }
  return { history: kept, shown };
}

/** מחזיר את המצב לסוף ההיסטוריה שנשמרת. בלי קבוצות - בלי שורה. */
export function stampShownMatches<T extends HistoryMessage>(
  history: readonly T[],
  shown: Readonly<Record<string, ShownMatchSet>> | undefined,
): T[] {
  const peeled = peelShownMatches(history);
  const clean = rememberShownMatches(shown, "", null);
  if (!Object.keys(clean).length) return peeled.history;
  const marker = { role: "assistant", content: SHOWN_MARK + JSON.stringify(clean) } as T;
  return [...peeled.history, marker];
}

/**
 * מוסיף הודעות בלי שהסמן ייספר בחלון. קודם מקלפים, אחר כך חותכים,
 * ובסוף סמן assistant אחד. חיתוך לפני הקילוף היה משאיר את הבקשה
 * למודל מתחילה ב-assistant.
 */
export function appendHistoryKeepingShown(
  previous: unknown,
  additions: readonly HistoryMessage[],
  limit = 12,
): HistoryMessage[] {
  const prev = peelShownMatches(Array.isArray(previous) ? previous as HistoryMessage[] : []);
  const cap = Math.max(1, limit);
  const body = [...prev.history, ...additions].slice(-cap);
  return stampShownMatches(body, prev.shown);
}

/**
 * כותב היסטוריה מחדש (שיחה, הטמעה) בלי לאבד את מצב ההתאמות.
 * `next` הוא הרשימה החדשה, כולל או בלי הסמן.
 */
export function historyKeepingShownMatches(previous: unknown, next: readonly HistoryMessage[]): HistoryMessage[] {
  const prev = peelShownMatches(Array.isArray(previous) ? previous as HistoryMessage[] : []);
  const built = peelShownMatches(next);
  const shown = Object.keys(built.shown).length ? built.shown : prev.shown;
  return stampShownMatches(built.history, shown);
}

/**
 * רק השורות שהוצגו. בלי קבוצה שמורה - כל השורות, והחלון חוזר לברירת המחדל.
 * עם קבוצה - הסדר של המזהים שנשמרו, גם אם המסד החזיר עוד.
 */
export function applyShownMatchSet<T extends { property_id?: unknown }>(
  rows: readonly T[],
  shown: ShownMatchSet | null | undefined,
): { rows: T[]; limit: number; restricted: boolean } {
  if (!shown?.ids.length) {
    return { rows: [...rows], limit: CLIENT_MATCHES_DEFAULT_LIMIT, restricted: false };
  }
  const order = new Map(shown.ids.map((id, index) => [id, index]));
  const kept = rows.filter((row) => order.has(String(row.property_id || "")));
  kept.sort((a, b) => (order.get(String(a.property_id)) ?? 0) - (order.get(String(b.property_id)) ?? 0));
  return {
    rows: kept,
    limit: Math.max(1, Math.min(MATCH_SHOW_MAX, kept.length || 1)),
    restricted: true,
  };
}

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
  score?: unknown;
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
 * אותו סינון כמו ב-client_matches: רק קוד שנמצא ב-required_features של
 * הלקוח/ה. קוד אחר אינו מרחיב את ההתאמות.
 * בתור שבו client_matches כבר רץ על הלקוח/ה הזה, הוויתור שלו גובר על מה
 * שנשלח שוב ל-create_showcase. בתור אחר נשמר מה שהמודל מעביר.
 */
export function waiveForShowcaseRefs(opts: {
  required: readonly string[];
  inputWaive: unknown;
  clientId: string;
  rememberedClientId?: string;
  rememberedWaive?: readonly string[];
}): string[] {
  const requested = opts.rememberedClientId === opts.clientId
    ? opts.rememberedWaive
    : opts.inputWaive;
  const allow = new Set(opts.required.map(String).filter(Boolean));
  if (!Array.isArray(requested)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of requested) {
    const code = String(item ?? "").trim();
    if (!code || !allow.has(code) || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out;
}

/** הארגומנטים של agent_client_matches כשפותרים property_refs. */
export function showcaseRefsCall(opts: {
  agentId: string;
  clientId: string;
  required: readonly string[];
  inputWaive: unknown;
  rememberedClientId?: string;
  rememberedWaive?: readonly string[];
}): {
  p_agent_id: string;
  p_client_id: string;
  p_limit: number;
  p_waive_features: string[];
} {
  return {
    p_agent_id: opts.agentId,
    p_client_id: opts.clientId,
    p_limit: MATCH_FETCH_CAP,
    p_waive_features: waiveForShowcaseRefs(opts),
  };
}

/**
 * קטעי כתובת או כותרת מול ההתאמות שהוצגו לסוכן/ת, לא מול כל 30 השורות
 * שהמסד החזיר. החיתוך הוא cutMatches. בלי limit - 5, כמו client_matches,
 * ולעולם לא יותר מ-15. יותר מהתאמה אחת בחלון הזה - שאלה בטקסט, ורק עליהן,
 * בלי מזהים ובלי בורר CRM.
 */
export function resolveShowcaseRefs(
  matches: readonly ShowcaseMatch[],
  refs: readonly string[],
  limit = CLIENT_MATCHES_DEFAULT_LIMIT,
): ShowcaseRefs {
  const cap = clientMatchesLimit(limit);
  const raw = matches
    .filter((row) => String(row.property_id || "").trim())
    .map((row) => ({ ...row })) as Array<Record<string, unknown>>;
  const rows = cutMatches(raw, cap).shown as ShowcaseMatch[];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const key = refKey(ref);
    const label = clipRef(ref);
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
