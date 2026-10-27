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
export const REMINDER_UTILITY_ENV = "WHATSAPP_REMINDER_UTILITY_TEMPLATE";
export const REMINDER_UTILITY_LANG_ENV = "WHATSAPP_REMINDER_UTILITY_TEMPLATE_LANG";
export const UTILITY_URL_BASE = "https://shuknadlan.co.il/";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GOTO_RE = /^(acc|dashPanel)[A-Za-z0-9]{1,40}$/;
const SPECIAL_GOTO = new Set(["adminOps", "license", "adminHome", "bell", "cma", "cmaAddress"]);
const PARAMS = new Set([
  "goto", "client", "property", "lead", "focus", "agenda", "agreement", "review",
  "filter", "import", "tab", "plan_city", "plan_street", "plan_num", "plan_gush", "plan_helka",
]);
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
  | { kind: "list"; button: string; section: string; rows: NavRow[]; allPath: string }
  | { kind: "none" };

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

/**
 * הנתיב היחסי של התראה. אותו סדר כמו openNotificationTarget ב-crm.js:
 * ליד מתוך תזכורת, יומן, הסכם, העדפות לידים, ביקוש פתוח, נכסים שלא באוויר,
 * ביקורת, התאמה ללקוח/ה, נכס של משרד אחר, נכס, לקוח/ה, ליד.
 */
export function notificationPath(it: NotifTarget): string | null {
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
  if (it.type === "open_demand") return "/crm?goto=accLeads&tab=demand";
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
  }
  return true;
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

/** סיומת לכפתור URL דינמי. הבסיס בתבנית הוא https://shuknadlan.co.il/ */
export function utilitySuffix(path: string): string {
  return path.replace(/^\/+/, "");
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
    if (t === "open_demand") return "/crm?goto=accLeads&tab=demand";
    if (t === "unpublished_nudge") return "/crm?goto=accProperties&filter=unpublished";
    if (t === "client_match") return "/crm?goto=accClients";
    if (t === "new_lead" || t === "review_request") return "/crm?goto=accLeads";
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
 * יעד אחד = כפתור קישור. כמה יעדים = רשימה (עד 9) ועוד "הכול" לרשימה
 * המסוננת. לא ל-/crm בלי יעד.
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
    return { kind: "single", path: unique[0].path, label: ctaLabel(unique[0].path) };
  }
  const allPath = allScreensPath(unique, categoryPathForType);
  const rows: NavRow[] = [];
  for (const it of unique.slice(0, LIST_ROW_MAX)) {
    const id = encodeNavId(it.path);
    if (!id) continue;
    const title = clipUtf16(String(it.title || "").replace(/\s+/g, " ").trim() || ctaLabel(it.path), LIST_TITLE_MAX);
    const description = clipUtf16(String(it.body || "").replace(/\s+/g, " ").trim(), LIST_DESC_MAX);
    rows.push(description ? { id, title, description } : { id, title });
  }
  const allId = encodeNavId(allPath);
  if (allId) rows.push({ id: allId, title: ALL_LABEL, description: "הרשימה המסוננת" });
  if (rows.length < 2) {
    const path = unique[0].path;
    return { kind: "single", path, label: ctaLabel(path) };
  }
  return { kind: "list", button: OPEN_LIST_BUTTON, section: OPEN_LIST_BUTTON, rows, allPath };
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
