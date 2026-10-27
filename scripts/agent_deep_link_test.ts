// יעד מדויק להודעת וואטסאפ לסוכן/ת: נתיב, כפתור, רשימה, בלי כתובת בגוף.
//   node --experimental-strip-types scripts/agent_deep_link_test.ts

import { readFileSync } from "node:fs";
import {
  ALL_LABEL,
  BUTTON_TITLE_MAX,
  ctaLabel,
  ctaMessage,
  clickRecords,
  clickToken,
  encodeNavId,
  isSafeCrmPath,
  listMessage,
  notificationPath,
  OPEN_LIST_BUTTON,
  parseNavId,
  REMINDER_FILTER_QUERY,
  reminderFindingPath,
  screenBundle,
  stripHttpUrls,
  containsHttpUrl,
  actionTemplateMessage,
  distinctButtonTitles,
  replyButtonsMessage,
  resendInteractiveAsText,
  utilitySuffix,
  utilityTemplateMessage,
  utf16Length,
  withClick,
  withClickUrl,
} from "../supabase/functions/_shared/agent-deep-link.ts";

const ID = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const ID3 = "33333333-3333-4333-8333-333333333333";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : " - " + JSON.stringify(detail)}`);
  if (!ok) failed++;
}

check("ליד נפתח על הליד", notificationPath({ type: "new_lead", lead_id: ID }) === `/crm?goto=accLeads&lead=${ID}`);
check("ליד בלי מזהה הוא הרשימה", notificationPath({ type: "new_lead" }) === "/crm?goto=accLeads");
check("סיכום לידים הוא הרשימה", notificationPath({ type: "leads_digest" }) === "/crm?goto=accLeads" && notificationPath({ type: "digest" }) === "/crm?goto=accLeads");
check("ביקוש נשאר בלשונית", notificationPath({ type: "open_demand" }) === "/crm?goto=accLeads&tab=demand");
check("action_path גובר", notificationPath({ type: "new_lead", lead_id: ID, action_path: "/crm?goto=accLeads" }) === "/crm?goto=accLeads");
check("action_path זר נזרק", notificationPath({ type: "new_lead", lead_id: ID, action_path: "https://evil.example/x" }) === `/crm?goto=accLeads&lead=${ID}`);
check("לוכסן כפול נזרק", notificationPath({ type: "new_lead", lead_id: ID, action_path: "//evil" }) === `/crm?goto=accLeads&lead=${ID}`);
check("תזכורת על ליד פותחת את הליד", notificationPath({
  type: "agenda_reminder", lead_id: ID, agenda_item_id: ID2,
}) === `/crm?goto=accLeads&lead=${ID}`);
check("יומן בלי ליד", notificationPath({ type: "agenda_reminder", agenda_item_id: ID }) === `/crm?goto=accAgenda&agenda=${ID}`);
check("הסכם", notificationPath({ type: "agreement_signed", agreement_id: ID }) === `/crm?goto=accAgreements&agreement=${ID}`);
check("ביקוש פתוח", notificationPath({ type: "open_demand" }) === "/crm?goto=accLeads&tab=demand");
check("נכסים שלא באוויר בלי מזהה", notificationPath({ type: "unpublished_nudge" }) === "/crm?goto=accProperties&filter=unpublished");
check("נכס אחד שלא באוויר", notificationPath({ type: "unpublished_nudge", property_id: ID }) === `/crm?goto=accProperties&property=${ID}`);
check("התאמה לכרטיס הלקוח", notificationPath({
  type: "client_match", client_id: ID, property_id: ID2,
}) === `/crm?goto=accClients&client=${ID}&focus=matches`);
check("נכס של משרד אחר", notificationPath({
  type: "system", property_id: ID, property_mine: false,
}) === `/crm?goto=accSharedWithMe&property=${ID}`);
check("עריכת נכס", notificationPath({ type: "marketing_copy", property_id: ID }) === `/crm?goto=accProperties&property=${ID}`);
check("עסקה שנסגרה אינה כרטיס הנכס", notificationPath({ type: "deal_closed", property_id: ID }) === null);
check("ביקורת מפורסמת", notificationPath({ type: "review_new", review_agent_slug: "dana" }) === "/agent?slug=dana#reviewsSec");
check("תקציר התראות הוא הפעמון", notificationPath({ type: "burst_digest" }) === "/crm?goto=bell");
check("מזהה שאינו uuid נזרק", notificationPath({ type: "new_lead", lead_id: "לא" }) === "/crm?goto=accLeads");
check("סוג בלי יעד נשאר בלי נתיב", notificationPath({ type: "system", lead_id: "לא" }) === null);

check("תמונות חסרות", reminderFindingPath("missing_images", "accProperties") === "/crm?goto=accProperties&filter=no_images");
check("נכס חדש", reminderFindingPath("idle_listings", "accProperties") === "/crm?goto=accProperties&focus=new");
check("ירדו מפרסום", reminderFindingPath("unpublished_listings", "accProperties") === "/crm?goto=accProperties&filter=unpublished");

const crm = readFileSync(new URL("../assets/crm.js", import.meta.url), "utf8");
const filters = crm.slice(crm.indexOf("const REMINDER_FILTERS"), crm.indexOf("const PROP_FILTER_IDS"));
for (const [kind, query] of Object.entries(REMINDER_FILTER_QUERY)) {
  const value = query.replace(/^&filter=/, "").replace(/^&focus=/, "");
  check(`סינון ${kind} ב-CRM`, filters.includes(`${kind}: '${value}'`) || filters.includes(`${kind}: "${value}"`));
}
check("הפעמון נפתח מ-goto=bell", crm.includes("raw === 'bell'") && crm.includes("openNavLayer('bell')"));

const labels = [
  "/crm?goto=accAgenda&agenda=" + ID,
  "/crm?goto=accProperties&filter=unpublished",
  "/crm?goto=accProperties&filter=no_images",
  "/crm?goto=accProperties&filter=expiring",
  "/crm?goto=accProperties&filter=stale",
  "/crm?goto=accProperties&filter=no_video",
  "/crm?goto=accProperties&focus=new",
  "/crm?goto=accLeads&tab=demand",
  "/crm?goto=bell",
  "/crm?goto=accNotifPrefs",
  "/crm?goto=license",
  "/crm?goto=accLeads&lead=" + ID,
  "/crm?goto=accClients&client=" + ID,
  "/crm?goto=accProperties&property=" + ID,
  "/crm?goto=accSharedWithMe&property=" + ID,
  "/crm?goto=accAgreements&agreement=" + ID,
  "/crm?goto=accReviews&review=" + ID,
  "/agent?slug=dana#reviewsSec",
  "/crm?goto=accMyDashboard",
  "/crm?goto=accPrefs&focus=lead_prefs",
  "/crm?goto=dashPanelMarkets",
  "/crm?goto=accTeam",
].map(ctaLabel);
check("כל כפתור עד 20 UTF-16", labels.every((l) => utf16Length(l) <= BUTTON_TITLE_MAX && l.length > 0), labels.filter((l) => utf16Length(l) > BUTTON_TITLE_MAX));
check("הכול קצר", utf16Length(ALL_LABEL) <= BUTTON_TITLE_MAX && utf16Length(OPEN_LIST_BUTTON) <= BUTTON_TITLE_MAX);

const one = screenBundle([
  { type: "new_lead", path: `/crm?goto=accLeads&lead=${ID}`, title: "ליד חם" },
], () => "/crm?goto=accLeads");
check("יעד אחד הוא cta", one.kind === "single" && one.kind === "single" && one.label === "👈 פתיחת הליד");

const many = screenBundle([
  { type: "new_lead", path: `/crm?goto=accLeads&lead=${ID}`, title: "דנה", body: "עפולה" },
  { type: "new_lead", path: `/crm?goto=accLeads&lead=${ID2}`, title: "יוסי", body: "חיפה" },
  { type: "marketing_copy", path: `/crm?goto=accProperties&property=${ID3}`, title: "נכתב תיאור" },
], (type) => type === "new_lead" ? "/crm?goto=accLeads" : "/crm?goto=accProperties");
check("כמה יעדים הם רשימה", many.kind === "list");
if (many.kind === "list") {
  const allRow = parseNavId(many.rows.at(-1)?.id || "");
  check("הכול אחרון", many.rows.at(-1)?.title === "הכול" && !!allRow && allRow.startsWith("/crm?goto=accLeads") && /[?&]wc=[a-f][a-f0-9]{11}/.test(allRow));
  check("עד עשר שורות", many.rows.length <= 10 && many.rows.length === 4);
  check("מזהי nav", many.rows.every((row) => parseNavId(row.id)));
  const msg = listMessage("972500000000", "מה שחדש אצלך:\nדנה\nיוסי", many.button, many.section, many.rows);
  const body = (msg.interactive as { body: { text: string } }).body.text;
  check("בגוף הרשימה אין כתובת", !containsHttpUrl(body));
  check("כפתור הרשימה", (msg.interactive as { action: { button: string } }).action.button === OPEN_LIST_BUTTON);
}

const props = screenBundle([
  { type: "listing", path: `/crm?goto=accProperties&property=${ID}`, title: "הרצל 1" },
  { type: "listing", path: `/crm?goto=accProperties&property=${ID2}`, title: "הרצל 2" },
], () => "/crm?goto=accProperties");
check("שני יעדים הם כפתורים והכול הוא הרשימה", props.kind === "buttons" && props.rows.length === 3 && props.rows[2].title === "הכול" && props.allPath.startsWith("/crm?goto=accProperties&wc="));
if (props.kind === "buttons") {
  const buttons = (replyButtonsMessage("972500000000", "מה שחדש", props.rows).interactive as {
    action: { buttons: { reply: { id: string; title: string } }[] };
  }).action.buttons;
  check("עד שלושה כפתורים", buttons.length === 3 && buttons.every((b) => utf16Length(b.reply.title) <= 20 && !!parseNavId(b.reply.id)));
}

const sameLead = "ליד חדש: התעניינות בנכס";
const dupLeads = screenBundle([
  { type: "new_lead", path: `/crm?goto=accLeads&lead=${ID}`, title: sameLead, body: "דנה כהן" },
  { type: "new_lead", path: `/crm?goto=accLeads&lead=${ID2}`, title: sameLead, body: "יוסי לוי" },
], () => "/crm?goto=accLeads");
check("שתי כותרות זהות נשארות כפתורים", dupLeads.kind === "buttons" && dupLeads.rows.length === 3);
if (dupLeads.kind === "buttons") {
  const titles = dupLeads.rows.map((row) => row.title);
  const sent = (replyButtonsMessage("972500000000", "מה שחדש", dupLeads.rows).interactive as {
    action: { buttons: { reply: { title: string } }[] };
  }).action.buttons.map((b) => b.reply.title);
  check("הכותרות ייחודיות ובתוך 20", new Set(sent).size === sent.length && sent.every((t) => utf16Length(t) <= 20 && t === t.trim() && t.length > 0), sent);
  check("הכול לא מקבל סיומת", titles[2] === "הכול" && sent.filter((t) => t === "הכול").length === 1);
  check("הכפילות מקבלת את השם", titles[0] !== titles[1] && (titles[1].includes("יוסי") || / \d+$/.test(titles[1])));
}

const longTitle = "ג".repeat(20);
const dupLong = screenBundle([
  { type: "listing", path: `/crm?goto=accProperties&property=${ID}`, title: longTitle, body: "" },
  { type: "listing", path: `/crm?goto=accProperties&property=${ID2}`, title: longTitle, body: "" },
], () => "/crm?goto=accProperties");
check("בלי שם מוסיפים מספר", dupLong.kind === "buttons" && dupLong.rows[0].title === longTitle && / \d+$/.test(dupLong.rows[1].title) && utf16Length(dupLong.rows[1].title) <= 20 && dupLong.rows[2].title === "הכול");

const titledAll = screenBundle([
  { type: "listing", path: `/crm?goto=accProperties&property=${ID}`, title: "הכול", body: "דנה" },
  { type: "listing", path: `/crm?goto=accProperties&property=${ID2}`, title: "הרצל", body: "" },
], () => "/crm?goto=accProperties");
check("הכול נשמר לכפתור הרשימה", titledAll.kind === "buttons" && titledAll.rows[2].title === "הכול" && titledAll.rows[0].title !== "הכול" && titledAll.rows[1].title === "הרצל" && new Set(titledAll.rows.map((row) => row.title)).size === 3);

const listDup = screenBundle([
  { type: "new_lead", path: `/crm?goto=accLeads&lead=${ID}`, title: "ליד חדש", body: "דנה" },
  { type: "new_lead", path: `/crm?goto=accLeads&lead=${ID2}`, title: "ליד חדש", body: "יוסי" },
  { type: "new_lead", path: `/crm?goto=accLeads&lead=${ID3}`, title: "ליד חדש", body: "רן כהן" },
], () => "/crm?goto=accLeads");
check("רשימה עם כותרת כפולה נשארת ייחודית", listDup.kind === "list" && listDup.rows.at(-1)?.title === "הכול" && new Set(listDup.rows.map((row) => row.title)).size === listDup.rows.length && listDup.rows.every((row) => utf16Length(row.title) <= 24));
check("בלי מקום לסיומת אין כותרות", distinctButtonTitles([{ title: "א" }, { title: "א" }], 1) === null);

check("דחיית כפתור נשלחת כטקסט", resendInteractiveAsText("interactive", false, "{\"error\":{\"code\":131009}}", 131050));
check("ביטול של הנמען לא נשלח שוב", !resendInteractiveAsText("interactive", false, "Recipient opted out 131050", 131050));
check("טקסט שנדחה לא נשלח שוב כטקסט", !resendInteractiveAsText("text", false, "no", 131050));
check("הצלחה לא נשלחת שוב", !resendInteractiveAsText("interactive", true, "", 131050));

const demands = screenBundle([
  { type: "open_demand", path: "/crm?goto=accLeads&tab=demand", title: "א" },
  { type: "open_demand", path: "/crm?goto=accLeads&tab=demand", title: "ב" },
], () => "/crm?goto=accLeads");
check("ביקושים זהים מתקפלים לכפתור", demands.kind === "single" && demands.kind === "single" && demands.path.includes("tab=demand"));

const round = encodeNavId(`/crm?goto=accProperties&property=${ID}`);
check("nav הלוך וחזור", round != null && parseNavId(round!) === `/crm?goto=accProperties&property=${ID}`);
check("בלי הפניה פתוחה", parseNavId("nav:https://evil.example") === null);
check("בלי סכמה", parseNavId("nav://evil") === null);
check("בלי /crm עירום", isSafeCrmPath("/crm") === false && encodeNavId("/crm") === null);
check("פעמון מותר", isSafeCrmPath("/crm?goto=bell"));

const cta = ctaMessage("972500000000", stripHttpUrls("ליד חם\nhttps://shuknadlan.co.il/crm?goto=accLeads"), "👈 פתיחת הליד", `https://shuknadlan.co.il/crm?goto=accLeads&lead=${ID}`);
const ctaBody = (cta.interactive as { body: { text: string } }).body.text;
check("cta בלי כתובת בגוף", !containsHttpUrl(ctaBody) && ctaBody.includes("ליד חם"));
const params = (cta.interactive as { action: { parameters: { display_text: string; url: string } } }).action.parameters;
check("cta נושא את היעד", params.url.includes(`lead=${ID}`) && utf16Length(params.display_text) <= 20);

const util = utilityTemplateMessage({
  to: "972500000000",
  templateName: "agent_alert_utility",
  lang: "he",
  name: "דנה",
  summary: `ליד חם https://shuknadlan.co.il/crm?goto=accLeads&lead=${ID}`,
  path: `/crm?goto=accLeads&lead=${ID}`,
});
const utilBody = (((util.template as { components: { type: string; parameters?: { text: string }[] }[] }).components)
  .find((c) => c.type === "body")!.parameters!)[1].text;
const utilBtn = (((util.template as { components: { type: string; parameters?: { text: string }[] }[] }).components)
  .find((c) => c.type === "button")!.parameters!)[0].text;
check("תבנית בלי כתובת בגוף", !containsHttpUrl(utilBody));
check("סיומת בלי לוכסן מוביל", utilBtn === utilitySuffix(`/crm?goto=accLeads&lead=${ID}`) && !utilBtn.startsWith("/"));
const stamped = withClick(`/crm?goto=accLeads&lead=${ID}`, "new_lead");
const stampedWc = (stamped.match(/[?&]wc=([a-f0-9]+)/) || [])[1] || "";
check("wc אטום על כפתור", /^[a-f][a-f0-9]{11}$/.test(stampedWc) && stamped.includes("wt=new_lead") && stamped.includes(`lead=${ID}`));
check("wc אינו הטלפון ואינו ה-uuid", stampedWc !== ID.replace(/-/g, "").slice(0, 12) && !stampedWc.startsWith("972") && /[a-f]/.test(stampedWc));
check("נתיב עם wc עדיין בטוח", isSafeCrmPath(stamped) && (encodeNavId(stamped) || "").length <= 200);
check("wc קיים לא מוכפל", withClick(stamped, "other") === stamped);
check("כתובת מלאה מקבלת wc", /wc=[a-f][a-f0-9]{11}/.test(withClickUrl("https://shuknadlan.co.il/crm?goto=bell", "fallback")));
check("קישור ציבורי בלי wc", withClickUrl("https://shuknadlan.co.il/property?id=" + ID, "page") === "https://shuknadlan.co.il/property?id=" + ID);
if (one.kind === "single") {
  const rec = clickRecords(one);
  check("רשומת לחיצה אחת", rec.length === 1 && rec[0].wt === "new_lead" && rec[0].wc === (one.path.match(/wc=([a-f0-9]+)/) || [])[1]);
}
check("טוקן מתחיל באות", /^[a-f][a-f0-9]{11}$/.test(clickToken()));
check("בסיס התבנית קבוע בקוד", readFileSync(new URL("../supabase/functions/_shared/agent-deep-link.ts", import.meta.url), "utf8").includes("https://shuknadlan.co.il/"));
const action = actionTemplateMessage({
  to: "972500000000",
  templateName: "agent_alert_action",
  lang: "he",
  name: "דנה",
  summary: `ליד https://shuknadlan.co.il/crm?goto=accLeads&lead=${ID}`,
  path: "/crm?goto=accLeads",
});
const actionParts = (action.template as { components: { type: string; parameters?: { text: string }[] }[] }).components;
const actionBody = actionParts.find((c) => c.type === "body")!.parameters![1].text;
const actionBtn = actionParts.find((c) => c.type === "button")!.parameters![0].text;
check("תבנית פעולה בלי כתובת ובלוכסן", !containsHttpUrl(actionBody) && actionBtn === "/crm?goto=accLeads");

const push = readFileSync(new URL("../supabase/functions/notification-push/index.ts", import.meta.url), "utf8");
check("הדחיפה משתמשת ברשימה ובכפתור", push.includes("screenBundle") && push.includes("listMessage") && push.includes("ctaMessage") && push.includes("replyButtonsMessage"));
const fallbackAt = push.indexOf('payload.type === "interactive"');
const fallback = fallbackAt >= 0 ? push.slice(fallbackAt, push.indexOf("if (!res.ok)", fallbackAt + 10)) : "";
check("דחייה נופלת לטקסט עם הקישור", fallback.includes("resendInteractiveAsText") && fallback.includes("textBody(name, items, false, topics)") && fallback.includes('type: "text"'));
check("בלי הסוד נשארת התבנית הישנה", push.includes("WHATSAPP_NOTIFY_TEMPLATE") && push.includes("mode === \"template\" && WA_UTILITY"));
check("התבנית הישנה עדיין כפתור הפסקה", push.includes("`/crm?goto=${MANAGE_ACC}`"));
check("סוד הפעולה מוריד כתובות מהגוף", push.includes("WHATSAPP_NOTIFY_ACTION_TEMPLATE") && push.includes("templateSummary(items, false)") && push.includes("actionTemplateMessage"));
check("הפעמון מעדיף action_path", crm.includes("openStoredActionPath(n.action_path)"));
const storedFn = crm.slice(crm.indexOf("function openStoredActionPath"), crm.indexOf("function openNotificationTarget"));
const visAt = storedFn.indexOf("navAccVisible");
const openAt = storedFn.indexOf("handleGotoParam()");
const urlAt = storedFn.indexOf("history.replaceState");
check("נתיב שמור נבדק לפני פתיחה", visAt >= 0 && visAt < urlAt && urlAt < openAt && storedFn.includes("accAliasTarget"));

const agentState = { is_platform_admin: false };
let replaced: string | null = null;
let opened = false;
let assigned: string | null = null;
const openStored = new Function(
  "location", "history", "NAV_TAB_OF", "currentAgent", "navAccVisible", "accAliasTarget", "handleGotoParam", "URL",
  `${storedFn}\nreturn openStoredActionPath;`,
)(
  { origin: "https://shuknadlan.co.il", assign: (url: string) => { assigned = url; } },
  { state: null, replaceState: (_s: unknown, _t: string, url: string) => { replaced = url; } },
  new Map([["dashPanelMarkets", "admin"]]),
  agentState,
  (id: string) => id === "accLeads",
  (id: string) => id,
  () => { opened = true; },
  URL,
) as (path: string) => boolean;
const hidden = openStored("/crm?goto=accTeam");
check("קטגוריה מוסתרת לא נפתחת", hidden === false && replaced === null && opened === false);
replaced = null;
opened = false;
const shown = openStored(`/crm?goto=accLeads&lead=${ID}`);
check("קטגוריה גלויה נפתחת", shown === true && opened && replaced === `/crm?goto=accLeads&lead=${ID}`);
replaced = null;
opened = false;
const adminHidden = openStored("/crm?goto=dashPanelMarkets");
check("פאנל ניהול חסום לסוכן/ת", adminHidden === false && replaced === null && opened === false);
agentState.is_platform_admin = true;
replaced = null;
opened = false;
const adminShown = openStored("/crm?goto=dashPanelMarkets");
check("פאנל ניהול נפתח למנהל/ת", adminShown === true && opened && replaced === "/crm?goto=dashPanelMarkets");
agentState.is_platform_admin = false;
replaced = null;
opened = false;
const bell = openStored("/crm?goto=bell");
check("פעמון שמור נפתח", bell === true && opened && replaced === "/crm?goto=bell");
const agentPage = openStored("/agent?slug=dana#reviewsSec");
check("דף סוכן/ת שמור עובר", agentPage === true && assigned === "/agent?slug=dana#reviewsSec");
const mig = readFileSync(new URL("../supabase/migrations/20271028210000_notification_action_path.sql", import.meta.url), "utf8");
check("העמודה וה-claim", mig.includes("add column if not exists action_path") && mig.includes("'action_path', n.action_path") && mig.includes("notification_types_add(array['leads_digest'])"));

const agent = readFileSync(new URL("../supabase/functions/whatsapp-webhook/agent.ts", import.meta.url), "utf8");
check("רשימת נכסים לא מדביקה crm_link כשיש כפתור", agent.includes("screenSent.crm_button_sent"));
check("page_link שולח כפתור", agent.includes("crm_button_sent: true") && agent.includes("ctaLabel(link.path)"));

if (failed) {
  console.error(`נכשלו ${failed}`);
  process.exit(1);
}
console.log("עבר");
