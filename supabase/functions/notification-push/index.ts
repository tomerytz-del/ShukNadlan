import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { authorizeInternalCaller } from "../_shared/cron-auth.ts";
import { mapPool } from "../_shared/pool.ts";
import {
  LEAD_CTA, type LeadInfo, leadListTitle, leadTemplateLine, leadText, loadLeadInfo,
} from "./lead-alert.ts";
import { clipWhatsappBody, showingCloseNotifyButton } from "../whatsapp-webhook/showing-match.ts";
import { unpublishedNudgeButtons } from "../whatsapp-webhook/listing-actions.ts";
import { paceRecipient, setPairReserve } from "../_shared/wa-pair-pace.ts";
import { isLessKeptType, LESS_TITLE, parseLessButton, topicBreak } from "./notif-digest.ts";
import { burstText, collapseForSend, BURST_DIGEST_TYPE } from "./burst-guard.ts";
import {
  absoluteUrl,
  categoryPath,
  clickRecords,
  containsHttpUrl,
  actionTemplateMessage,
  ctaMessage,
  listMessage,
  NOTIFY_ACTION_ENV,
  NOTIFY_ACTION_LANG_ENV,
  NOTIFY_UTILITY_ENV,
  NOTIFY_UTILITY_LANG_ENV,
  notificationPath,
  OPT_OUT_BARE,
  replyButtonsMessage,
  resendInteractiveAsText,
  screenBundle,
  stripHttpUrls,
  type ClickRecord,
  type NotifTarget,
  utilityTemplateMessage,
  withClick,
} from "../_shared/agent-deep-link.ts";

// ============================================================================
// דחיפת התראות הפעמון לוואטסאפ.
//
// ‏נקראת מ-pg_cron כל חמש דקות, ורק כשיש מה לשלוח
// (‏`notification_push_ready()` במיגרציה 20261029090000).
//
// ## מה זה לא
//
// זו **אינה** `agent-reminders`. שם המקור הוא מצב שמחושב בכל קריאה (נכסים
// בלי תמונה, שבוע בלי מודעה) והקצב הוא שבועי; כאן המקור הוא טבלת
// ‏`notifications` — אירועים שקרו ברגע מסוים, שהערך שלהם נשחק בשעות. שתי
// הפונקציות חולקות את התבנית (‏claim→שליחה→mark) ואת שעות השקט של הסוכן/ת,
// ולא את התוכן ולא את הקצב.
//
// ## מה הפונקציה הזו לא מחליטה
//
// מי מקבל/ת, אילו סוגים, מתי מותר וכמה — הכול במסד:
//
//   ‏· `notification_push_due_agents` — ערוץ דלוק עם מספר, שעות שקט, תקרה, מרווח
//   ‏· `notification_push_claim`      — רושמת את שורת היומן ומחזירה מה לשלוח
//
// כאן רק מרכיבים הודעה משורה שהגיעה מוכנה, שולחים, ומדווחים.
//
// ## טקסט חופשי או תבנית — וההבדל שאינו קוסמטי
//
// ‏Meta מרשה לעסק לשלוח טקסט חופשי רק בתוך 24 שעות מההודעה האחרונה שהנמען/ת
// שלח/ה. סוכן/ת שכתב/ה לבוט בשעה האחרונה נמצא/ת בתוך החלון, ולכן מקבל/ת
// הודעה מלאה עם קישורים אמיתיים — וגם בחינם. מחוץ לחלון נדרשת תבנית מאושרת
// (`WHATSAPP_NOTIFY_TEMPLATE`), שמוגבלת בפרמטרים ועולה כסף.
//
// ההחלטה הזו נלקחת **במסד** (‏`channel_mode` שחוזר מה-claim, מחושב מ-
// ‏`whatsapp_conversations.last_message_at`) ולא כאן, כדי שהיא תישמר ביומן:
// כשל של "מחוץ לחלון" נראה אחרת בכל אחד מהמצבים, ובלי הרישום אין דרך לדעת
// איזה משלוח היה איזה.
//
// בלי תבנית מוגדרת נשלח טקסט חופשי גם מחוץ לחלון. זה נכשל אצל Meta — בכוונה:
// עדיף כשל שנרשם ב-`last_error` על הודעה שנעלמת בשקט, וזה גם המצב שמתאים
// לבדיקה מול מספר ששלח לנו הודעה עכשיו.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const GRAPH_VERSION = Deno.env.get("WHATSAPP_GRAPH_VERSION") || "v23.0";
const WA_TOKEN = Deno.env.get("WHATSAPP_TOKEN") || "";
const WA_PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || "";
const WA_TEMPLATE = Deno.env.get("WHATSAPP_NOTIFY_TEMPLATE") || "";
const WA_TEMPLATE_LANG = Deno.env.get("WHATSAPP_NOTIFY_TEMPLATE_LANG") || "he";
// תבנית UTILITY עם כפתור ליעד המדויק. ריק = התבנית המאושרת למעלה, בלי שינוי.
const WA_ACTION = Deno.env.get(NOTIFY_ACTION_ENV) || "";
const WA_ACTION_LANG = Deno.env.get(NOTIFY_ACTION_LANG_ENV) || "he";
const WA_UTILITY = Deno.env.get(NOTIFY_UTILITY_ENV) || "";
const WA_UTILITY_LANG = Deno.env.get(NOTIFY_UTILITY_LANG_ENV) || "he";

const SITE_BASE = (Deno.env.get("SITE_BASE_URL") || "https://shuknadlan.co.il")
  .replace(/\/+$/, "");

// הקטגוריה שבה מכבים את הערוץ. מופיעה בכל הודעה: ערוץ יוצא שאין ממנו דרך
// לצאת הוא ערוץ שמסתיים בחסימה של המספר — וחסימה אחת מייקרת אותנו אצל כל
// הנמענים העתידיים דרך דירוג האיכות של Meta.
const MANAGE_ACC = "accNotifPrefs";

const BATCH = 40;

// כמה נמענים במקביל. לולאה בטור על ארבעים הודעות הייתה מגיעה לעשרות שניות,
// ו-pg_net מנתק — זה בדיוק מה שקרה ב-agent-reminders (ראו
// ‏20261030090000_cron_http_timeout.sql). מצד שני ארבעים קריאות בבת אחת
// ל-Graph API הן הדרך לקבל הגבלת קצב מ-Meta. ראו `_shared/pool.ts`.
const SEND_CONCURRENCY = 4;

// ‏131050 — הנמען/ת ביקש/ה מ-Meta להפסיק לקבל הודעות מהעסק.
const WA_OPTED_OUT = 131050;

// הקטגוריה בדשבורד שבה מטפלים בכל סוג התראה. אותו מיפוי שב-NOTIF_TYPES
// ב-assets/crm.js, ו-scripts/check_notif_links.py חוסם ב-CI כל פער. סוג שאינו
// כאן נופל ל-MANAGE_ACC - הגדרות ההתראות - וזה לעולם לא היעד הנכון.
const ACC_BY_TYPE: Record<string, string> = {
  improvement_suggestion: "accSuggestions",
  new_lead: "accLeads",
  // סיכום לידים פתוחים. הרשימה, לא ליד אחד. digest הוא אותו יעד.
  leads_digest: "accLeads",
  digest: "accLeads",
  client_match: "accAlerts",
  listing_match: "accProperties",
  // ‏הסיכום שמחליף את שתיהן (20270426090000) - לרשימת "התראות התאמה"
  match_digest: "accAlerts",
  agreement_signed: "accAgreements",
  review_new: "accReviews",
  review_request: "accLeads",
  deal_closed: "accTeam",
  marketing_copy: "accProperties",
  // מנהל/ת המשרד מחק/ה שיחה (twilio-voice?task=delete) - השיחות והמספרים
  call_deleted_by_manager: "accLines",
  // "שותפו איתי" הוא לשונית ב"נכסים" מאז שלב 5 (docs/properties-unified.md);
  // נכס מסוים עדיין נפתח ב-goto=accSharedWithMe (itemPath), כינוי ב-CRM
  system: "accProperties",
  platform_signup: "accSubscriptions",
  // ‏פריט בתיבת המשימות של מנהל/ת הפלטפורמה שחרג מזמן היעד (docs/admin-inbox.md)
  admin_overdue: "accAdminInbox",
  // ‏הודעה לכל הסוכנים מהפלטפורמה (admin_broadcast) - לרשימת ההודעות
  platform_broadcast: "accPlatformNews",
  // ‏"דף האזור קרוב לפתיחה" (20270725090000) - להעלאת נכס
  market_nudge: "accProperties",
  platform_upgrade: "accSubscriptions",
  agenda_reminder: "accAgenda",
  showcase_activity: "accClients",
  showcase_meeting: "accClients",
  // ‏כרטיס שיימחק בעוד שבוע לפי מדיניות השמירה (docs/data-retention.md)
  retention_warning: "accClients",
  // ‏העדפות לידים שהמערכת הגדירה לסוכן/ת שעוסק/ת במסחרי (20270807090000).
  // ‏itemPath מוסיף focus=lead_prefs, שפותח את החלק המקופל
  lead_prefs_default: "accPrefs",
  // ‏סיכום של הרצת "עדכן עסקאות" - למנהל/ת הפלטפורמה (docs/settlement-deals.md)
  deal_sync_summary: "accDealSettlements",
  // ‏ממצא אבטחה חמור - למנהל/ת הפלטפורמה. היעד הוא פאנל "בריאות המערכת",
  // שאינו קטגוריה; ‏handleGotoParam ב-crm.js מכיר את adminOps.
  // מיגרציה 20270421100000, docs/ops-agent.md.
  security_alert: "adminOps",
  // ‏ממצא חמור שאינו אבטחה (20270720090000) - לאותו פאנל
  ops_alert: "adminOps",
  // ‏שוק שמתקרב לסף, עובר אותו או יורד מתחתיו (20270705090000) - לפאנל
  // "שווקים מקומיים", שה-goto ב-crm.js פותח בתצוגת הניהול.
  market_alert: "dashPanelMarkets",
  // ‏עלויות מול תקציב, 80% ו-100% (20270727090000) - לפאנל העלויות
  budget_alert: "dashPanelCosts",
  // ‏סקירת הרשאות חצי-שנתית (docs/access-review.md)
  access_review: "accSecurityAudit",
  // ‏שבעת אלה חסרו עד 10.2026 ונפלו ל-MANAGE_ACC - כלומר הקישור בוואטסאפ על
  // ביקורת ממתינה או ליד בלי יעד הוביל להגדרות ההתראות ולא לפריט.
  // ‏scripts/check_notif_links.py מצליב מעכשיו את המפה הזו מול NOTIF_TYPES.
  review_alert: "accReviews",
  lead_unrouted: "accUnroutedLeads",
  deal_data_gap: "accDealsImport",
  onboarding_property: "accProperties",
  onboarding_client: "accClients",
  onboarding_lead: "accLeadShelf",
  onboarding_agreement: "accAgreements",
  // ‏תזכורת אימות רישיון (20270723090000) - לכרטיס הרישיון בראש הדשבורד,
  // שאינו קטגוריה; ‏handleGotoParam ב-crm.js מכיר את license.
  onboarding_license: "license",
  // ‏הסיכום היומי של המנטור (office-coach) - לכרטיס שלו ב"הדשבורד שלי"
  coach_daily: "accMyDashboard",
  // ‏המנטור של מנהל/ת הפלטפורמה (20270730090000) - לכרטיס בראש מרכז הפיקוד,
  // שאינו קטגוריה; ‏handleGotoParam ב-crm.js מכיר את adminHome.
  platform_coach: "adminHome",
  // ‏ביקוש פתוח מפוסט בפייסבוק (20270812090000) - ללשונית "ביקוש פתוח" ב"הלידים
  // שלי"; ‏itemPath מוסיף tab=demand, ולכן גם כמה ביקושים בהודעה אחת הם כפתור
  open_demand: "accLeads",
  // תזכורת שבועית על נכסים שלא באוויר (20271028190000). נכס אחד נפתח
  // בכרטיס; כמה נכסים נפתחים לרשימה המסוננת.
  unpublished_nudge: "accProperties",
  // שת״פ שנפתח אחרי בקשת הבעלים. הנכס של משרד אחר נפתח ב"שותפו איתי".
  collab_offer: "accProperties",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Item = {
  type: string;
  title: string;
  body: string | null;
  // ‏notification_push_claim מחזירה אותם מ-20270320093000. התראה ישנה, או כזו
  // שמכסה כמה נכסים/לקוחות, מגיעה בלעדיהם ומקבלת את קישור הקטגוריה.
  property_id?: string | null;
  client_id?: string | null;
  lead_id?: string | null;
  // ‏20270321093000: נכס של משרד אחר (שיתוף), תזכורת, הסכם וביקורת
  property_mine?: boolean | null;
  agenda_item_id?: string | null;
  agreement_id?: string | null;
  review_id?: string | null;
  review_agent_slug?: string | null;
  // ‏new_lead בלבד: נטען ב-loadLeadInfo (lead-alert.ts). חסר - הנוסח הגנרי.
  lead?: LeadInfo | null;
  // ‏סגירת מיניסייט (20271028121000). חסר - אין כפתור scn:.
  meeting_id?: string | null;
  // ‏תקציר התפרצות (20271028140000). חסר בהודעה רגילה.
  count?: number | null;
  // מקור הליד. photo_request אינו מוגן גם כשהסוג הוא new_lead.
  source?: string | null;
  // notifications.action_path. חסר עד שהמיגרציה עלתה, ואז גובר על המיפוי.
  action_path?: string | null;
};

/** הודעה שכולה ליד חדש אחד עם פרטים - מקבלת את הנוסח המלא (lead-alert.ts). */
function richLead(items: Item[]): LeadInfo | null {
  if (items.length !== 1) return null;
  const it = items[0];
  return it.type === "new_lead" && it.lead && itemPath(it) ? it.lead : null;
}

/** בהודעה מרוכזת: שם הפונה והערוץ במקום "ליד חדש: התעניינות בנכס". */
function withLeadLines(items: Item[]): Item[] {
  if (items.length < 2) return items;
  return items.map((it) =>
    it.type === "new_lead" && it.lead
      ? { ...it, title: leadListTitle(it.lead), body: it.lead.what || it.body }
      : it
  );
}

class WhatsappError extends Error {
  constructor(message: string, readonly code: number | null) {
    super(message);
  }
}

function firstName(name: string | null): string {
  return String(name || "").trim().split(/\s+/)[0] || "";
}

function gotoUrl(acc: string): string {
  return `${SITE_BASE}/crm?goto=${encodeURIComponent(acc)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOr = (v: unknown): string | null =>
  typeof v === "string" && UUID_RE.test(v) ? v : null;

/**
 * הקישור הישיר של התראה - **הדבר שעליו היא מדברת**, ולא הקטגוריה שלו.
 * "נכתב תיאור לנכס" מוביל לכרטיס של אותו נכס ב-CRM, "נכס מתאים לדנה" לכרטיס
 * של דנה עם רשימת ההתאמות פתוחה. ‏null כשאין יעד יחיד - ואז הקטגוריה.
 *
 * הסדר חשוב רק ב-client_match: היא נושאת גם את הנכס וגם את הלקוח/ה, והפעולה
 * הבאה היא אצל הלקוח/ה (להתקשר, לשלוח), כי הנכס בדרך כלל של מישהו אחר.
 * עסקה שנסגרה מגיעה למנהל/ת, והנכס של סוכן/ת אחר/ת - אין לו כרטיס אצלו/ה.
 * נכס של משרד אחר (‏property_mine = false, "נכס חדש שותף איתך") נפתח ב"שותפו
 * איתי". ביקורת ממתינה מגיעה עם review_id רק למי שמאשר/ת אותה, ומפורסמת -
 * עם הסלאג של הסוכן/ת, לדף הציבורי.
 * הפרמטרים נקראים ב-handleGotoParam ב-crm.js.
 */
function itemPath(it: Item): string | null {
  // הסדר ב-notificationPath (_shared/agent-deep-link.ts), וזהה לפעמון.
  return notificationPath(it as NotifTarget);
}

// ‏notification_push_priority_types() במסד (20270420090000): מה שאדם מחכה לו
// בצד השני. הם עולים לראש ההודעה, כדי שחיתוך האורך (4000 / 900) לא יפגע בהם.
const PRIORITY_TYPES = ["agenda_reminder", "showcase_meeting", "new_lead"];

// רקע: שיתוף נכס ממשרד אחר ונרשם/ת חדש/ה לפלטפורמה. במסד הם לא מעירים שליחה
// לבד (notification_push_is_ambient), וכאן הם מתקפלים לשורה אחת לכל סוג - ב-
// 11.10.2026 נכתבו 678 התראות "נכס חדש שותף איתך" ביום אחד.
const isShare = (it: Item) => it.type === "system" && it.property_id != null && it.property_mine === false;
const isSignup = (it: Item) => it.type === "platform_signup";

/**
 * הסדר וקיפול הרקע. התראות בעדיפות קודם, אחריהן שאר ההתראות, ובסוף שורה אחת
 * לשיתופים ושורה אחת לנרשמים כשיש יותר מאחד/ת. שורה מקופלת היא בלי פריט ולכן
 * מקבלת את קישור הקטגוריה ("שותפו איתי", "מנויים ובקשות שדרוג").
 */
function arrange(items: Item[]): Item[] {
  const shares = items.filter(isShare);
  const signups = items.filter(isSignup);
  const rest = items.filter((it) => !isShare(it) && !isSignup(it));
  const prio = (it: Item) => (PRIORITY_TYPES.includes(it.type) ? 0 : 1);
  const out = [...rest].sort((a, b) => prio(a) - prio(b));
  if (shares.length === 1) out.push(shares[0]);
  else if (shares.length > 1) {
    out.push({ type: "system", title: `${shares.length} נכסים חדשים שותפו איתך`, body: null });
  }
  if (signups.length === 1) out.push(signups[0]);
  else if (signups.length > 1) {
    out.push({
      type: "platform_signup",
      title: `${signups.length} נרשמים חדשים לפלטפורמה`,
      body: signups.map((it) => it.title).join(" · ").slice(0, 300),
    });
  }
  return out;
}

/**
 * גוף ההודעה בטקסט חופשי.
 *
 * שורה לכל התראה, ומתחתיה הקישור הישיר שלה כשיש לה יעד יחיד (ראו itemPath).
 * התראות בלי יעד כזה חולקות קישור אחד לכל **קטגוריה**: שלוש התאמות שמובילות
 * לאותו מסך לא צריכות שלושה קישורים זהים ברצף.
 */
function textBody(
  name: string | null,
  items: Item[],
  noLinks = false,
  topics = false,
  withOptOutUrl = true,
): string {
  const opt = withOptOutUrl
    ? `להפסקת ההתראות בוואטסאפ: ${gotoUrl(MANAGE_ACC)}`
    : OPT_OUT_BARE;
  const burst = items.find((it) => it.type === BURST_DIGEST_TYPE);
  if (burst) {
    if (noLinks && !withOptOutUrl) {
      const count = burst.count ?? items.length;
      const line = `יש לך ${count} התראות חדשות באתר.`;
      const who = firstName(name);
      return [who ? `${who}, ${line}` : line, "", opt].join("\n").slice(0, 4000);
    }
    return burstText(name, burst.count ?? items.length, SITE_BASE, gotoUrl(MANAGE_ACC)).slice(0, 4000);
  }
  const first = firstName(name);
  const li = richLead(items);
  if (li) {
    const link = noLinks ? null : `${SITE_BASE}${itemPath(items[0])}`;
    return leadText(first, li, link, opt).slice(0, 4000);
  }
  const accs = noLinks ? [] : [...new Set(
    items.filter((it) => !itemPath(it)).map((it) => ACC_BY_TYPE[it.type] || MANAGE_ACC),
  )];

  // תזכורת מהיומן אינה "מה שחדש" אלא "מה שקורה עכשיו", וכשזה כל מה שיש
  // בהודעה - הכותרת אומרת את זה.
  const onlyAgenda = items.every((it) => it.type === "agenda_reminder");
  const head = onlyAgenda ? "תזכורת מהיומן:" : "מה שחדש אצלך:";
  let prevType: string | null = null;
  const itemLines: string[] = [];
  for (const it of items) {
    if (topics) {
      const section = topicBreak(prevType, it.type);
      if (section) itemLines.push(section);
    }
    prevType = it.type;
    const path = itemPath(it);
    itemLines.push(
      `${it.type === "agenda_reminder" ? "📅" : "🔔"} ${it.title}${it.body ? `\n   ${it.body}` : ""}` +
        (path && !noLinks ? `\n   👈 ${SITE_BASE}${path}` : ""),
    );
  }
  const lines = [
    first ? `${first}, ${head}` : head,
    "",
    ...itemLines,
    "",
    ...accs.map((acc) => gotoUrl(acc)),
    ...(accs.length ? [""] : []),
    opt,
  ];
  // ‏4000 ולא 4096: חיתוך שלנו עדיף על 400 מ-Meta ואפס הודעה.
  return lines.join("\n").slice(0, 4000);
}

/** כפתורי לפרסם / שת״פ / לא עכשיו רק על תזכורת של נכס אחד, בתוך החלון. */
function nudgeReplyButtons(items: Item[]): { id: string; title: string }[] | null {
  if (items.length !== 1 || items[0].type !== "unpublished_nudge") return null;
  const property = uuidOr(items[0].property_id);
  if (!property) return null;
  return unpublishedNudgeButtons(property);
}

function screensOf(items: Item[]) {
  return items.map((it) => ({
    type: it.type,
    path: itemPath(it),
    title: it.title,
    body: it.body,
  }));
}

function categoryFor(type: string): string | null {
  if (type === BURST_DIGEST_TYPE) return "/crm?goto=bell";
  const acc = ACC_BY_TYPE[type];
  return acc ? categoryPath(acc) : null;
}

/**
 * רשימת ההתראות כפרמטר לתבנית — **שורה אחת, בלי תווי שורה חדשה.**
 *
 * ‏Meta דוחה פרמטר של תבנית שמכיל `\n`, טאב או יותר מארבעה רווחים רצופים.
 * הגרסה הראשונה כאן חיברה ב-`\n` כדי שהרשימה תיראה כמו רשימה, וזה היה נדחה
 * בשליחה הראשונה מחוץ לחלון 24 השעות — כלומר בדיוק במצב שהתבנית קיימת בשבילו.
 *
 * ה-`•` שבראש כל פריט הוא גם המפריד, ולכן החיבור הוא ברווח בודד ולא בתו
 * הפרדה נוסף: גופי ההתראות מכילים פסיקים ונקודות משל עצמם, ו-`•` הוא הגבול
 * היחיד שנשאר חד. התבנית עצמה עדיין שמה את `{{2}}` בשורה נפרדת — המגבלה היא
 * על הפרמטר, לא על הנוסח.
 *
 * בלי WHATSAPP_NOTIFY_ACTION_TEMPLATE הקישור נשאר בסוף הפריט: הכפתור
 * היחיד בתבנית המאושרת הוא כיבוי הערוץ. כשהסוד מוגדר, withUrls הוא false
 * והכפתור הוא הנתיב של היעד.
 */
function templateSummary(items: Item[], withUrls = true): string {
  const burst = items.find((it) => it.type === BURST_DIGEST_TYPE);
  if (burst) {
    const count = burst.count ?? items.length;
    const link = withUrls ? ` ${SITE_BASE}/crm` : "";
    return `יש לך ${count} התראות חדשות באתר.${link}`.slice(0, 900);
  }
  return items
    .map((it) => {
      const path = itemPath(it);
      const url = withUrls && path ? `${SITE_BASE}${path}` : null;
      if (it.type === "new_lead" && it.lead) {
        return `• ${leadTemplateLine(it.lead, url, items.length === 1)}`;
      }
      return `• ${it.title}${it.body ? `: ${it.body}` : ""}${url ? ` ${url}` : ""}`;
    })
    .join(" ")
    // ‏replace לפני החיתוך: גוף התראה נכתב במסד ועשוי להכיל שורה חדשה בעצמו
    // (למשל ציטוט מביקורת), ולכן לא די בהחלפת המפריד.
    .replace(/\s*[\r\n\t]+\s*/g, " ")
    .replace(/ {4,}/g, "   ")
    .slice(0, 900);
}

async function loadDigestFlags(
  sb: { from: (table: string) => any },
): Promise<{ less: boolean; topics: boolean; guardOn: boolean }> {
  const off = { less: false, topics: false, guardOn: true };
  try {
    const { data, error } = await sb.from("pricing_config")
      .select("key, value")
      .in("key", ["notif_digest_enabled", "notif_topic_group", "notification_burst_guard_enabled"]);
    if (error || !Array.isArray(data)) return off;
    const on = (key: string) => data.some((row: { key?: string; value?: unknown }) =>
      row.key === key && Number(row.value) === 1);
    const digest = on("notif_digest_enabled");
    const seenGuard = data.some((row: { key?: string }) => row.key === "notification_burst_guard_enabled");
    return {
      less: digest,
      topics: digest && on("notif_topic_group"),
      guardOn: seenGuard ? on("notification_burst_guard_enabled") : true,
    };
  } catch {
    return off;
  }
}

async function sendWhatsapp(
  to: string,
  name: string | null,
  items: Item[],
  mode: string,
  lessType: string | null,
  topics = false,
): Promise<{ id: string | null; tokens: ClickRecord[] }> {
  if (!WA_TOKEN || !WA_PHONE_ID) throw new WhatsappError("whatsapp not configured", null);
  let tokens: ClickRecord[] = [];

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${WA_PHONE_ID}/messages`;
  const headers = {
    Authorization: `Bearer ${WA_TOKEN}`,
    "Content-Type": "application/json",
  };

  let payload: Record<string, unknown>;
  const nudgeBtns = mode === "template" ? null : nudgeReplyButtons(items);

  const bare = () => stripHttpUrls(clipWhatsappBody(textBody(name, items, true, topics, false), 1024));
  const linked = () => ({
    messaging_product: "whatsapp",
    recipient_type: "individual" as const,
    to,
    type: "text" as const,
    text: { preview_url: false, body: textBody(name, items, false, topics) },
  });
  // הודעה אחת. יעד אחד = cta_url. כמה יעדים = רשימה, והלחיצה (nav:) מחזירה
  // cta_url אחד. בלי כתובת בגוף. כשל של האינטראקטיב נופל לטקסט עם הקישור.
  const inWindow = (): Record<string, unknown> | null => {
    const plan = screenBundle(screensOf(items), categoryFor);
    const body = bare();
    if (!body || containsHttpUrl(body) || body.length > 1024) return null;
    if (plan.kind === "single") {
      tokens = clickRecords(plan);
      return ctaMessage(
        to,
        body,
        richLead(items) ? LEAD_CTA : plan.label,
        absoluteUrl(SITE_BASE, plan.path),
      );
    }
    if (plan.kind === "buttons") {
      tokens = clickRecords(plan);
      return replyButtonsMessage(to, body, plan.rows);
    }
    if (plan.kind === "list") {
      tokens = clickRecords(plan);
      return listMessage(to, body, plan.button, plan.section, plan.rows);
    }
    return null;
  };

  if (mode === "template" && WA_ACTION) {
    const plan = screenBundle(screensOf(items), categoryFor);
    const path = plan.kind === "single" ? plan.path
      : plan.kind === "list" || plan.kind === "buttons" ? plan.allPath
      : withClick("/crm?goto=bell", "bell");
    tokens = clickRecords({ kind: "single", path, label: "" });
    payload = actionTemplateMessage({
      to,
      templateName: WA_ACTION,
      lang: WA_ACTION_LANG,
      name: firstName(name) || "שלום",
      summary: templateSummary(items, false),
      path,
    });
  } else if (mode === "template" && WA_UTILITY) {
    const plan = screenBundle(screensOf(items), categoryFor);
    const path = plan.kind === "single" ? plan.path
      : plan.kind === "list" || plan.kind === "buttons" ? plan.allPath
      : withClick("/crm?goto=bell", "bell");
    tokens = clickRecords({ kind: "single", path, label: "" });
    payload = utilityTemplateMessage({
      to,
      templateName: WA_UTILITY,
      lang: WA_UTILITY_LANG,
      name: firstName(name) || "שלום",
      summary: templateSummary(items, false),
      path,
    });
  } else if (mode === "template" && WA_TEMPLATE) {
    const prefsPath = withClick(`/crm?goto=${MANAGE_ACC}`, "notif_prefs");
    tokens = clickRecords({ kind: "single", path: prefsPath, label: "" });
    // שני פרמטרים בגוף התבנית: ‏{{1}} השם הפרטי · {{2}} רשימת ההתראות.
    // וכפתור URL דינמי אחד שמוביל לניהול ההתראות; הפרמטר הוא **סיומת
    // הכתובת בלבד**, כך Meta מגדירה כפתור דינמי, ולכן הקידומת נקבעת בתבנית.
    // בלי WHATSAPP_NOTIFY_UTILITY_TEMPLATE הגוף והיעד נשארים.
    // על הכפתור מתווסף רק wc, בלי לשנות את התבנית המאושרת.
    payload = {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: WA_TEMPLATE,
        language: { code: WA_TEMPLATE_LANG },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: (firstName(name) || "שלום").slice(0, 60) },
              { type: "text", text: templateSummary(items) },
            ],
          },
          {
            type: "button",
            sub_type: "url",
            index: "0",
            parameters: [{ type: "text", text: prefsPath }],
          },
        ],
      },
    };
  } else if (nudgeBtns) {
    // שלושה כפתורי תשובה על נכס אחד. אי אפשר לערבב אותם עם cta_url.
    // "בלי תזכורת" נשאר בכרטיס ב-CRM: ל-Meta יש שלושה כפתורים.
    const body = clipWhatsappBody(textBody(name, items, true, topics, false), 1024);
    const buttons = nudgeBtns.map((b) => ({
      type: "reply",
      reply: { id: b.id, title: b.title },
    }));
    payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: body },
        action: { buttons },
      },
    };
  } else if (mode !== "template" && (showingCloseNotifyButton(items) || lessType)) {
    const scn = showingCloseNotifyButton(items);
    // כפתור תשובה אחד. אי אפשר לערבב אותו עם cta_url, והקישור נשאר בגוף.
    // ביטול סיור קודם ל"פחות כאלה": שם הסוכן/ת צריך/ה להחליט אם לעדכן
    // את מי שכבר קיבל בקשה, ולא נשלח דבר ללקוח/ה עד הלחיצה.
    // החיתוך נעצר לפני כתובת שנקטעת, לא באמצע הקישור.
    const body = clipWhatsappBody(textBody(name, items, false, topics), 1024);
    const button = scn
      ? { type: "reply", reply: { id: scn.id, title: scn.title } }
      : { type: "reply", reply: { id: `nless:${lessType}`, title: LESS_TITLE } };
    payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: body },
        action: { buttons: [button] },
      },
    };
  } else {
    payload = inWindow() || linked();
  }

  return paceRecipient(to, async () => {
  let res = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
  // כפתור שנדחה (לא ביטול של הנמען/ת) - אותה הודעה כטקסט עם הקישור, כדי
  // שההתראה לא תיפול בגלל הצורה שלה.
  if (!res.ok && payload.type === "interactive") {
    const raw = await res.text();
    if (resendInteractiveAsText(String(payload.type), false, raw, WA_OPTED_OUT)) {
      console.error("cta_url rejected, sending as text", raw.slice(0, 300));
      tokens = [];
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          messaging_product: "whatsapp", recipient_type: "individual", to, type: "text",
          text: { preview_url: false, body: textBody(name, items, false, topics) },
        }),
      });
    } else {
      res = new Response(raw, { status: res.status });
    }
  }
  if (!res.ok) {
    const raw = await res.text();
    let code: number | null = null;
    try {
      code = JSON.parse(raw)?.error?.code ?? null;
    } catch { /* גוף שאינו JSON — נשמר כטקסט ב-last_error */ }
    throw new WhatsappError(`whatsapp ${res.status}: ${raw.slice(0, 300)}`, code);
  }
  // ‏wamid: דרכו record_whatsapp_status (ה-webhook) מוצאת את השורה כש-Meta
  // מדווחת delivered / read / failed. בלעדיו "sent" הוא כל מה שנדע - וחסימה
  // של הודעות שיווק (131050) מגיעה רק שם, לא בתשובה הזו.
  let id: string | null = null;
  try {
    id = (await res.json())?.messages?.[0]?.id ?? null;
  } catch { /* בלי wamid השורה נשארת sent */ }
  return { id, tokens };
  });
}

// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  const auth = authorizeInternalCaller(req);
  if (!auth.ok) return json({ error: auth.error, detail: auth.detail }, auth.status);

  const sb = createClient(supabaseUrl, serviceRoleKey);
  setPairReserve(async (phone, gapMs) => {
    const { data, error: slotErr } = await sb.rpc("whatsapp_pair_reserve", {
      p_phone: phone, p_gap_ms: gapMs,
    });
    if (slotErr) return 0;
    const n = Number(data);
    return Number.isFinite(n) ? n : 0;
  });

  // ‏claim רושמת את שורות היומן **לפני** השליחה. נפילה מכאן והלאה משאירה
  // שורה עם status='pending' — "יצא, לא ידוע אם הגיע" — ולא אותן התראות
  // בסבב הבא.
  const { data: batch, error } = await sb.rpc("notification_push_claim", { p_limit: BATCH });
  if (error) return json({ error: "db_error", detail: error.message }, 500);
  if (!batch || batch.length === 0) return json({ sent: 0, failed: 0, empty: true });

  let sent = 0, failed = 0;

  // ‏new_lead: שם הפונה, הערוץ והנכס (lead-alert.ts). כשל - מפה ריקה, נוסח ישן.
  const leadInfo = await loadLeadInfo(sb, batch as Record<string, any>[]);
  const digest = await loadDigestFlags(sb);

  await mapPool(batch as Record<string, any>[], SEND_CONCURRENCY, async (row) => {
    let items = collapseForSend(withLeadLines(arrange(((row.items || []) as Item[]).map((it) =>
      it.type === "new_lead" && it.lead_id && leadInfo.has(it.lead_id)
        ? { ...it, lead: leadInfo.get(it.lead_id) }
        : it
    ))), undefined, digest.guardOn);
    const onlyType = items.length > 0 && new Set(items.map((it) => it.type)).size === 1
      ? items[0].type
      : null;
    const lessType = digest.less && onlyType && onlyType !== BURST_DIGEST_TYPE && !isLessKeptType(onlyType)
      ? parseLessButton(`nless:${onlyType}`)
      : null;
    let status = "failed";
    let lastError: string | null = null;
    let waId: string | null = null;
    let tokens: ClickRecord[] = [];

    try {
      const sent = await sendWhatsapp(
        row.phone_e164, row.display_name, items, row.channel_mode, lessType, digest.topics,
      );
      waId = sent.id;
      tokens = sent.tokens;
      status = "sent";
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);

      // ביטול מול Meta הוא ביטול, גם אם לא נעשה דרך הדשבורד שלנו. מכבים את
      // הערוץ מיד, אחרת נמשיך לשלוח לאותו מספר בכל סבב ולצבור דחיות. הפעמון
      // בדשבורד ו-`muted_types` אינם נוגעים בזה — זה כיבוי של ערוץ, לא של
      // ההתראות עצמן.
      if (err instanceof WhatsappError && err.code === WA_OPTED_OUT) {
        const { error: offErr } = await sb.rpc("notification_push_opt_out", {
          p_agent_id: row.agent_id,
        });
        if (offErr) console.error("opt-out failed", offErr.message);
        else console.log("whatsapp alerts disabled after Meta opt-out", row.agent_id);
      }
    }

    const { error: markErr } = await sb.rpc("notification_push_mark", {
      p_log_id: row.log_id,
      p_status: status,
      p_error: lastError ? lastError.slice(0, 500) : null,
    });
    if (markErr) console.error("mark failed", row.log_id, markErr.message);
    if (waId || (status === "sent" && tokens.length)) {
      // לא קריטי: בלי המזהה ההודעה כבר יצאה, רק המסירה שלה לא תירשם.
      // click_tokens חסר עד שהמיגרציה עלתה: שומרים את wa_message_id לבד.
      const patch: Record<string, unknown> = {};
      if (waId) patch.wa_message_id = waId;
      if (status === "sent" && tokens.length) patch.click_tokens = tokens;
      const { error: idErr } = await sb.from("notification_push_log")
        .update(patch).eq("id", row.log_id);
      const missingCol = !!idErr && (
        idErr.code === "PGRST204" || idErr.code === "42703" || /click_tokens/.test(idErr.message || "")
      );
      if (missingCol && waId) {
        const { error: again } = await sb.from("notification_push_log")
          .update({ wa_message_id: waId }).eq("id", row.log_id);
        if (again) console.error("wa_message_id not saved", row.log_id, again.message);
      } else if (idErr) console.error("wa_message_id not saved", row.log_id, idErr.message);
    }

    if (status === "sent") sent++;
    else failed++;
  });

  return json({ sent, failed, processed: batch.length });
});
