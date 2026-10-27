// יעד מדויק להודעה לסוכן/ת. בלי Deno, כדי שהבדיקה ב-node תריץ את המיפוי.
// הנתיב נפתח ב-handleGotoParam ב-assets/crm.js. כפתור וואטסאפ אינו מדביק
// את הכתובת בגוף: בחלון 24 השעות זה cta_url, ובכמה יעדים רשימה שהלחיצה
// עליה מחזירה cta_url אחד. מחוץ לחלון התבנית הקיימת נשארת כל עוד
// WHATSAPP_NOTIFY_UTILITY_TEMPLATE אינו מוגדר.

export const NAV_PREFIX = "nav:";
export const BUTTON_TITLE_MAX = 20;
export const LIST_TITLE_MAX = 24;
export const LIST_DESC_MAX = 72;
export const LIST_ID_MAX = 200;
export const LIST_ROW_MAX = 9;
export const OPEN_LIST_BUTTON = "לאן לפתוח";
export const ALL_LABEL = "הכול";
export const OPT_OUT_BARE = "להפסקת ההתראות: מסך התראות והודעות.";
export const NOTIFY_UTILITY_ENV = "WHATSAPP_NOTIFY_UTILITY_TEMPLATE";
export const NOTIFY_UTILITY_LANG_ENV = "WHATSAPP_NOTIFY_UTILITY_TEMPLATE_LANG";
export const NOTIFY_ACTION_ENV = "WHATSAPP_NOTIFY_ACTION_TEMPLATE";
export const NOTIFY_ACTION_LANG_ENV = "WHATSAPP_NOTIFY_ACTION_TEMPLATE_LANG";
export const OPEN_LEADS_PATH = "/crm?goto=accLeads";
export const OPEN_DEMAND_PATH = "/crm?goto=accLeads&tab=demand";
export const REMINDER_UTILITY_ENV = "WHATSAPP_REMINDER_UTILITY_TEMPLATE";
export const REMINDER_UTILITY_LANG_ENV = "WHATSAPP_REMINDER_UTILITY_TEMPLATE_LANG";
export const UTILITY_URL_BASE = "https://shuknadlan.co.il/";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GOTO_RE = /^(acc|dashPanel)[A-Za-z0-9]{1,40}$/;
const SPECIAL_GOTO = new Set(["adminOps", "license", "adminHome", "bell", "cma", "cmaAddress"]);
const PARAMS = new Set([
  "goto", "client", "property", "lead", "focus", "agenda", "agreement", "review",
  "filter", "import", "tab", "plan_city", "plan_street", "plan_num", "plan_gush", "plan_helka",
  "wc", "wt",
]);
const WC_RE = /^[a-f][a-f0-9]{11}$/;
const WT_RE = /^[a-z0-9_]{1,40}$/;
const PRIORITY = ["agenda_reminder", "showcase_meeting", "new_lead"];

export type NotifTarget = {
  type: string;
  property_id?: string | null;
  client_id?: string | null;
  lead_id?: string | null;
  property_mine?: boolean | null;
  agenda_item_id?: string | null;
  agreement_id?: string | null;
  review_id?: string | null;
  review_agent_slug?: string | null;
  action_path?: string | null;
};

export type ScreenRef = {
  type: string;
  path: string | null;
  title: string;
  body?: string | null;
};

export type NavRow = { id: string; title: string; description?: string };

export type ScreenPlan =
  | { kind: "single"; path: string; label: string }
  | { kind: "buttons"; rows: NavRow[]; allPath: string }
  | { kind: "list"; button: string; section: string; rows: NavRow[]; allPath: string }
  | { kind: "none" };

export type ClickRecord = { wc: string; wt: string; target: string };

export function uuidOr(v: unknown): string | null {
  return typeof v === "string" && UUID_RE.test(v) ? v : null;
}

export function utf16Length(s: string): number {
  return s.length;
}

/** חיתוך ביחידות UTF-16, בלי לחתוך זוג סורוגט באמצע. */
export function clipUtf16(s: string, max: number): string {
  if (s.length <= max) return s;
  let end = max;
  const cu = s.charCodeAt(end - 1);
  if (cu >= 0xd800 && cu <= 0xdbff) end -= 1;
  return s.slice(0, Math.max(0, end));
}

function cleanTitle(title: string, fallback: string): string {
  return String(title || "").replace(/\s+/g, " ").trim() || fallback;
}

/** מילה ראשונה בגוף, כסיומת שמבדילה שתי כותרות זהות. */
function nameHint(body: string | null | undefined): string {
  const word = String(body || "").replace(/\s+/g, " ").trim().split(" ")[0] || "";
  if (word.length < 2 || word.length > 12 || word === ALL_LABEL) return "";
  if (!/^[\p{L}][\p{L}'׳.-]*$/u.test(word)) return "";
  return word;
}

/**
 * כותרות כפתור ייחודיות בתוך max יחידות UTF-16.
 * וואטסאפ דוחה הודעה ששני כפתורים בה חולקים כותרת, וחיתוך ל-20
 * הופך "ליד חדש: התעניינות בנכס" לכפילות. הראשונה נשארת, והשאר
 * מקבלות את המילה הראשונה בגוף או מספר. "הכול" נשמר כמו שהוא.
 * null כשאין מקום לסיומת - הקורא יורד לרשימה, או לטקסט.
 */
export function distinctButtonTitles(
  rows: { title: string; hint?: string | null }[],
  max: number,
): string[] | null {
  const cleaned = rows.map((row) => String(row.title || "").replace(/\s+/g, " ").trim());
  const hints = rows.map((row) => nameHint(row.hint));
  const clipped = cleaned.map((title) => clipUtf16(title || "פתח", max));
  const out: string[] = new Array(rows.length);
  const used = new Set<string>();
  const reserved = new Set<number>();
  const allIdx = cleaned.lastIndexOf(ALL_LABEL);
  if (allIdx >= 0 && clipped[allIdx] && !used.has(clipped[allIdx])) {
    out[allIdx] = clipped[allIdx];
    used.add(clipped[allIdx]);
    reserved.add(allIdx);
  }
  const groups = new Map<string, number[]>();
  clipped.forEach((title, i) => {
    if (reserved.has(i)) return;
    const list = groups.get(title) || [];
    list.push(i);
    groups.set(title, list);
  });
  const take = (i: number, candidate: string): boolean => {
    const title = candidate.trim();
    if (!title || title.length > max || title !== candidate || used.has(title)) return false;
    out[i] = title;
    used.add(title);
    return true;
  };
  const suffixed = (i: number, suffix: string): string => {
    if (suffix.length >= max) return "";
    return (clipUtf16(cleaned[i] || "פתח", max - suffix.length) + suffix).trim();
  };
  for (const idxs of groups.values()) {
    const colliding = idxs.length > 1 || used.has(clipped[idxs[0]]);
    for (let k = 0; k < idxs.length; k++) {
      const i = idxs[k];
      if ((!colliding || k === 0) && take(i, clipped[i])) continue;
      if (hints[i] && take(i, suffixed(i, " " + hints[i]))) continue;
      let placed = false;
      for (let n = 2; n < 100; n++) {
        if (take(i, suffixed(i, " " + String(n)))) {
          placed = true;
          break;
        }
      }
      if (!placed) return null;
    }
  }
  if (out.some((title) => !title)) return null;
  return out;
}

/** דחיית כפתור או רשימה נשלחת שוב כטקסט. ביטול של הנמען/ת לא נשלח שוב. */
export function resendInteractiveAsText(
  payloadType: string,
  ok: boolean,
  errorBody: string,
  optedOutCode: number,
): boolean {
  if (ok || payloadType !== "interactive") return false;
  return !String(errorBody || "").includes(String(optedOutCode));
}

/**
 * הנתיב היחסי של התראה. אותו סדר כמו openNotificationTarget ב-crm.js:
 * ליד מתוך תזכורת, יומן, הסכם, העדפות לידים, ביקוש פתוח, נכסים שלא באוויר,
 * ביקורת, התאמה ללקוח/ה, נכס של משרד אחר, נכס, לקוח/ה, ליד.
 */
/** נתיב שנשמר על ההתראה. רק נתיב יחסי ש-handleGotoParam פותח. */
export function storedActionPath(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const path = v.trim();
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("://")) return null;
  if (path.length > 180 || /\s/.test(path)) return null;
  return isSafeCrmPath(path) ? path : null;
}

export function notificationPath(it: NotifTarget): string | null {
  const stored = storedActionPath(it.action_path);
  if (stored) return stored;
  const property = uuidOr(it.property_id);
  const client = uuidOr(it.client_id);
  const lead = uuidOr(it.lead_id);
  const agenda = uuidOr(it.agenda_item_id);
  const agreement = uuidOr(it.agreement_id);
  const review = uuidOr(it.review_id);

  if (lead && it.type === "agenda_reminder") return `/crm?goto=accLeads&lead=${lead}`;
  if (agenda && it.type === "agenda_reminder") return `/crm?goto=accAgenda&agenda=${agenda}`;
  if (agreement) return `/crm?goto=accAgreements&agreement=${agreement}`;
  if (it.type === "lead_prefs_default") return "/crm?goto=accPrefs&focus=lead_prefs";
  if (it.type === "open_demand") return OPEN_DEMAND_PATH;
  if (it.type === "leads_digest" || it.type === "digest") return OPEN_LEADS_PATH;
  if (it.type === "unpublished_nudge" && !property) {
    return "/crm?goto=accProperties&filter=unpublished";
  }
  if (it.type === "review_new" || it.type === "review_alert") {
    if (review) return `/crm?goto=accReviews&review=${review}`;
    const slug = String(it.review_agent_slug || "");
    if (slug) return `/agent?slug=${encodeURIComponent(slug)}#reviewsSec`;
    return null;
  }
  if (client && it.type === "client_match") {
    return `/crm?goto=accClients&client=${client}&focus=matches`;
  }
  if (property && it.property_mine === false) {
    return `/crm?goto=accSharedWithMe&property=${property}`;
  }
  if (property && it.type !== "client_match" && it.type !== "deal_closed") {
    return `/crm?goto=accProperties&property=${property}`;
  }
  if (client) return `/crm?goto=accClients&client=${client}`;
  if (lead && ["new_lead", "review_request", "system"].includes(it.type)) {
    return `/crm?goto=accLeads&lead=${lead}`;
  }
  // new_lead בלי lead_id, או עם מזהה שאינו uuid, נפתח לרשימת הלידים בלי כרטיס.
  if (it.type === "new_lead") return OPEN_LEADS_PATH;
  if (it.type === "burst_digest") return "/crm?goto=bell";
  return null;
}

/** אותו מיפוי כמו FINDING_PARAMS ב-agent-reminders ו-REMINDER_FILTERS ב-crm.js. */
export const REMINDER_FILTER_QUERY: Record<string, string> = {
  missing_images: "&filter=no_images",
  expiring_listings: "&filter=expiring",
  stale_listings: "&filter=stale",
  video_opportunity: "&filter=no_video",
  idle_listings: "&focus=new",
  unpublished_listings: "&filter=unpublished",
};

export function reminderFindingPath(kind: string, action: string | null): string {
  const acc = /^acc[A-Za-z0-9]+$/.test(action || "") ? action! : "accNotifPrefs";
  const extra = acc === "accProperties" ? (REMINDER_FILTER_QUERY[kind] || "") : "";
  return `/crm?goto=${encodeURIComponent(acc)}${extra}`;
}

export function categoryPath(acc: string): string {
  return `/crm?goto=${encodeURIComponent(acc)}`;
}

/** כותרת כפתור לפי היעד. עד 20 יחידות UTF-16. */
export function ctaLabel(url: string): string {
  if (url.includes("accAgenda")) return "📅 פתיחה ביומן";
  if (url.includes("filter=unpublished")) return "🏠 נכסים שלא באוויר";
  if (url.includes("filter=no_images")) return "📷 בלי תמונה";
  if (url.includes("filter=expiring")) return "⏳ שעומדות לפוג";
  if (url.includes("filter=stale")) return "🕒 נכסים ישנים";
  if (url.includes("filter=no_video")) return "🎬 בלי סרטון";
  if (url.includes("focus=new")) return "➕ נכס חדש";
  if (url.includes("tab=demand")) return "📣 לביקוש הפתוח";
  if (url.includes("accLeads") && !/[?&]lead=/.test(url)) return "👈 ללידים";
  if (url.includes("goto=bell")) return "🔔 כל ההתראות";
  if (url.includes("accNotifPrefs")) return "⚙️ להתראות";
  if (url.includes("goto=license")) return "📄 לרישיון";
  if (url.includes("accLeads")) return "👈 פתיחת הליד";
  if (url.includes("accClients")) return "👤 כרטיס הלקוח";
  if (url.includes("accProperties") || url.includes("accSharedWithMe")) return "🏠 פתיחת הנכס";
  if (url.includes("accAgreements")) return "📝 פתיחת ההסכם";
  if (url.includes("accReviews") || url.includes("/agent?")) return "⭐ לביקורת";
  if (url.includes("accMyDashboard")) return "🧭 לסיכום המנטור";
  if (url.includes("accPrefs")) return "⚙️ להעדפות הלידים";
  if (url.includes("dashPanelMarkets")) return "🗺️ לשווקים המקומיים";
  return "👈 פתיחה";
}

/** נתיב יחסי ש-handleGotoParam פותח. בלי סכמה, בלי //, בלי מפתח זר. */
export function isSafeCrmPath(path: string): boolean {
  if (!path || path.length > 180) return false;
  if (path.includes("//") || path.includes("\\") || /[\s<>"']/.test(path)) return false;
  if (path.startsWith("/agent?")) {
    return /^\/agent\?slug=[A-Za-z0-9._~%-]{1,120}(#reviewsSec)?$/.test(path);
  }
  if (!path.startsWith("/crm?")) return false;
  let q: URLSearchParams;
  try {
    q = new URLSearchParams(path.slice("/crm?".length));
  } catch {
    return false;
  }
  const goto = q.get("goto");
  if (!goto || (!GOTO_RE.test(goto) && !SPECIAL_GOTO.has(goto))) return false;
  for (const [k, v] of q) {
    if (!PARAMS.has(k) || v.length > 80 || !/^[A-Za-z0-9._~%-]+$/.test(v)) return false;
    if (k === "wc" && !WC_RE.test(v)) return false;
    if (k === "wt" && !WT_RE.test(v)) return false;
  }
  return true;
}

/** מזהה לחיצה אטום. 12 תווי hex, הראשון אות, בלי טלפון ובלי מזהה סוכן. */
export function clickToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let out = "a";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out.slice(0, 12);
}

/** מוסיף wc ו-wt לנתיב /crm. נתיב שכבר נושא wc נשאר. נתיב שאינו בטוח נשאר בליהם. */
export function withClick(path: string, msgType: string): string {
  if (!path.startsWith("/crm?") || /(?:^|[?&])wc=/.test(path)) return path;
  const wt = String(msgType || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 40) || "msg";
  const next = `${path}&wc=${clickToken()}&wt=${wt}`;
  return isSafeCrmPath(next) ? next : path;
}

export function withClickUrl(url: string, msgType: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (u.pathname !== "/crm") return url;
  const raw = `${u.pathname}${u.search}`;
  const stamped = withClick(raw, msgType);
  return stamped === raw ? url : `${u.origin}${stamped}`;
}

export function encodeNavId(path: string): string | null {
  if (!isSafeCrmPath(path)) return null;
  const id = NAV_PREFIX + path;
  return id.length <= LIST_ID_MAX ? id : null;
}

export function parseNavId(id: string): string | null {
  if (!id.startsWith(NAV_PREFIX)) return null;
  const path = id.slice(NAV_PREFIX.length);
  return isSafeCrmPath(path) ? path : null;
}

/** ה-wc-ים שבאמת יושבים על כפתורי התוכנית. בלי כפילות. */
export function clickRecords(plan: ScreenPlan): ClickRecord[] {
  const paths: string[] = [];
  if (plan.kind === "single") paths.push(plan.path);
  else if (plan.kind === "list" || plan.kind === "buttons") {
    for (const row of plan.rows) {
      const path = parseNavId(row.id);
      if (path) paths.push(path);
    }
  }
  const out: ClickRecord[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    const q = new URLSearchParams(path.slice(path.indexOf("?") + 1));
    const wc = q.get("wc") || "";
    if (!WC_RE.test(wc) || seen.has(wc)) continue;
    seen.add(wc);
    out.push({ wc, wt: q.get("wt") || "", target: q.get("goto") || "" });
  }
  return out;
}

/** סיומת לכפתור URL דינמי. הבסיס בתבנית הוא https://shuknadlan.co.il/ */
export function utilitySuffix(path: string): string {
  return path.replace(/^\/+/, "");
}

/** סיומת לתבנית שהבסיס שלה הוא https://shuknadlan.co.il בלי לוכסן. */
export function actionSuffix(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

export function absoluteUrl(siteBase: string, path: string): string {
  return `${siteBase.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

export function stripHttpUrls(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function containsHttpUrl(text: string): boolean {
  return /https?:\/\//.test(text);
}

function rank(type: string): number {
  const i = PRIORITY.indexOf(type);
  return i === -1 ? PRIORITY.length : i;
}

function allScreensPath(
  items: { type: string; path: string }[],
  categoryPathForType: (type: string) => string | null,
): string {
  const types = new Set(items.map((it) => it.type));
  if (types.size === 1) {
    const t = [...types][0];
    if (t === "open_demand") return OPEN_DEMAND_PATH;
    if (t === "unpublished_nudge") return "/crm?goto=accProperties&filter=unpublished";
    if (t === "client_match") return "/crm?goto=accClients";
    if (t === "new_lead" || t === "review_request" || t === "leads_digest" || t === "digest") {
      return OPEN_LEADS_PATH;
    }
    if (t === "burst_digest") return "/crm?goto=bell";
    if (t === "match_digest") return "/crm?goto=accAlerts";
    const cat = categoryPathForType(t);
    if (cat && isSafeCrmPath(cat)) return cat;
  }
  const counts = new Map<string, number>();
  for (const it of items) {
    const cat = categoryPathForType(it.type);
    const key = cat && isSafeCrmPath(cat) ? cat : "";
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let best = "";
  let n = 0;
  for (const [key, c] of counts) {
    if (c > n) {
      best = key;
      n = c;
    }
  }
  return best || "/crm?goto=bell";
}

/**
 * יעד אחד = כפתור קישור. שני יעדים = עד שלושה כפתורי תשובה
 * (שני היעדים ו"הכול"). משלושה = רשימה (עד 9) ועוד "הכול".
 * כותרת כפולה אחרי החיתוך מקבלת סיומת. בלי מקום לסיומת, שני
 * היעדים יורדים לרשימה. לא ל-/crm בלי יעד.
 */
export function screenBundle(
  items: ScreenRef[],
  categoryPathForType: (type: string) => string | null,
): ScreenPlan {
  const indexed = items.map((it, index) => ({ ...it, index }))
    .map((it) => {
      const path = it.path || categoryPathForType(it.type);
      return path && isSafeCrmPath(path) ? { ...it, path } : null;
    })
    .filter((it): it is ScreenRef & { path: string; index: number } => !!it);
  indexed.sort((a, b) => rank(a.type) - rank(b.type) || a.index - b.index);

  const seen = new Set<string>();
  const unique: { type: string; path: string; title: string; body?: string | null }[] = [];
  for (const it of indexed) {
    if (seen.has(it.path)) continue;
    seen.add(it.path);
    unique.push(it);
  }
  if (unique.length === 0) return { kind: "none" };
  if (unique.length === 1) {
    const path = withClick(unique[0].path, unique[0].type);
    return { kind: "single", path, label: ctaLabel(path) };
  }
  const shared = new Set(unique.map((it) => it.type)).size === 1 ? unique[0].type : "all";
  const allPath = withClick(allScreensPath(unique, categoryPathForType), shared);
  if (unique.length === 2) {
    const prepared: { id: string; title: string; hint: string | null }[] = [];
    for (const it of unique) {
      const path = withClick(it.path, it.type);
      const id = encodeNavId(path);
      if (!id) continue;
      prepared.push({
        id,
        title: cleanTitle(it.title, ctaLabel(it.path)),
        hint: it.body ?? null,
      });
    }
    const allId = encodeNavId(allPath);
    if (allId && prepared.length === 2) prepared.push({ id: allId, title: ALL_LABEL, hint: null });
    const titles = prepared.length >= 2 && prepared.length <= 3
      ? distinctButtonTitles(prepared, BUTTON_TITLE_MAX)
      : null;
    if (titles) {
      return {
        kind: "buttons",
        rows: prepared.map((row, i) => ({ id: row.id, title: titles[i] })),
        allPath,
      };
    }
  }
  const prepared: { id: string; title: string; hint: string | null; description?: string }[] = [];
  for (const it of unique.slice(0, LIST_ROW_MAX)) {
    const path = withClick(it.path, it.type);
    const id = encodeNavId(path);
    if (!id) continue;
    const description = clipUtf16(String(it.body || "").replace(/\s+/g, " ").trim(), LIST_DESC_MAX);
    prepared.push({
      id,
      title: cleanTitle(it.title, ctaLabel(it.path)),
      hint: it.body ?? null,
      ...(description ? { description } : {}),
    });
  }
  const allId = encodeNavId(allPath);
  if (allId) prepared.push({ id: allId, title: ALL_LABEL, hint: null, description: "הרשימה המסוננת" });
  const listTitles = distinctButtonTitles(prepared, LIST_TITLE_MAX);
  const rows: NavRow[] = prepared.map((row, i) => {
    const title = listTitles ? listTitles[i] : clipUtf16(row.title, LIST_TITLE_MAX);
    return row.description ? { id: row.id, title, description: row.description } : { id: row.id, title };
  });
  if (rows.length < 2) {
    const path = withClick(unique[0].path, unique[0].type);
    return { kind: "single", path, label: ctaLabel(path) };
  }
  return { kind: "list", button: OPEN_LIST_BUTTON, section: OPEN_LIST_BUTTON, rows, allPath };
}

export function replyButtonsMessage(to: string, body: string, rows: NavRow[]): Record<string, unknown> {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body },
      action: {
        buttons: rows.slice(0, 3).map((row) => ({
          type: "reply",
          reply: { id: row.id.slice(0, 256), title: clipUtf16(row.title, BUTTON_TITLE_MAX) },
        })),
      },
    },
  };
}

export function ctaMessage(to: string, body: string, label: string, url: string): Record<string, unknown> {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "cta_url",
      body: { text: body },
      action: {
        name: "cta_url",
        parameters: { display_text: clipUtf16(label, BUTTON_TITLE_MAX), url },
      },
    },
  };
}

export function listMessage(
  to: string,
  body: string,
  button: string,
  section: string,
  rows: NavRow[],
): Record<string, unknown> {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: body },
      action: {
        button: clipUtf16(button, BUTTON_TITLE_MAX),
        sections: [{
          title: clipUtf16(section, LIST_TITLE_MAX),
          rows: rows.slice(0, 10).map((row) => ({
            id: row.id.slice(0, LIST_ID_MAX),
            title: clipUtf16(row.title, LIST_TITLE_MAX),
            ...(row.description ? { description: clipUtf16(row.description, LIST_DESC_MAX) } : {}),
          })),
        }],
      },
    },
  };
}

/**
 * תבנית UTILITY שעוד לא הוגשה למטא. כפתור URL דינמי אחד:
 * הבסיס https://shuknadlan.co.il/ והפרמטר הוא הסיומת בלי לוכסן מוביל.
 * כשהסוד אינו מוגדר הקורא נשאר על התבנית המאושרת.
 */
export function utilityTemplateMessage(opts: {
  to: string;
  templateName: string;
  lang: string;
  name: string;
  summary: string;
  path: string;
}): Record<string, unknown> {
  const summary = stripHttpUrls(opts.summary)
    .replace(/\s*[\r\n\t]+\s*/g, " ")
    .replace(/ {4,}/g, "   ")
    .slice(0, 900);
  return {
    messaging_product: "whatsapp",
    to: opts.to,
    type: "template",
    template: {
      name: opts.templateName,
      language: { code: opts.lang || "he" },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: (opts.name || "שלום").slice(0, 60) },
            { type: "text", text: summary || "-" },
          ],
        },
        {
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [{ type: "text", text: utilitySuffix(opts.path) }],
        },
      ],
    },
  };
}

/**
 * תבנית הפעולה (WHATSAPP_NOTIFY_ACTION_TEMPLATE). כפתור URL דינמי:
 * הבסיס https://shuknadlan.co.il והפרמטר הוא הנתיב עם לוכסן מוביל.
 * {{2}} בלי כתובת. כשהסוד ריק הקורא נשאר על התבנית המאושרת.
 */
export function actionTemplateMessage(opts: {
  to: string;
  templateName: string;
  lang: string;
  name: string;
  summary: string;
  path: string;
}): Record<string, unknown> {
  const summary = stripHttpUrls(opts.summary)
    .replace(/\s*[\r\n\t]+\s*/g, " ")
    .replace(/ {4,}/g, "   ")
    .slice(0, 900);
  return {
    messaging_product: "whatsapp",
    to: opts.to,
    type: "template",
    template: {
      name: opts.templateName,
      language: { code: opts.lang || "he" },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: (opts.name || "שלום").slice(0, 60) },
            { type: "text", text: summary || "-" },
          ],
        },
        {
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [{ type: "text", text: actionSuffix(opts.path) }],
        },
      ],
    },
  };
}
