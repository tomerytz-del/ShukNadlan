// יעד מדויק להודעת וואטסאפ לסוכן/ת: נתיב, כפתור, רשימה, בלי כתובת בגוף.
//   node --experimental-strip-types scripts/agent_deep_link_test.ts

import { readFileSync } from "node:fs";
import {
  ALL_LABEL,
  BUTTON_TITLE_MAX,
  ctaLabel,
  ctaMessage,
  encodeNavId,
  isSafeCrmPath,
  listMessage,
  listTextFallback,
  notificationPath,
  OPEN_LIST_BUTTON,
  parseNavId,
  REMINDER_FILTER_QUERY,
  reminderFindingPath,
  screenBundle,
  stripHttpUrls,
  containsHttpUrl,
  utilitySuffix,
  utilityTemplateMessage,
  utf16Length,
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
check("מזהה שאינו uuid נזרק", notificationPath({ type: "new_lead", lead_id: "לא" }) === null);

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
check("סטטוס נכס נפתח מהכתובת", crm.includes("openPropertyStatusFromParam") && crm.includes("params.get('status')"));

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
  check("הכול אחרון", many.rows.at(-1)?.title === "הכול" && many.rows.at(-1)?.id === encodeNavId("/crm?goto=accLeads"));
  check("הכול בלי סינון הוא כל הרשימה", many.rows.at(-1)?.description === "כל הרשימה");
  check("אין מזהה כפול", new Set(many.rows.map((row) => row.id)).size === many.rows.length);
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
check("הכול של נכסים הוא הרשימה", props.kind === "list" && props.kind === "list" && props.allPath === "/crm?goto=accProperties");
if (props.kind === "list") {
  check("נכסים בלי סטטוס אינם הרשימה המסוננת", props.rows.at(-1)?.description === "כל הרשימה");
}

const byStatus = screenBundle([
  { type: "listing", path: `/crm?goto=accProperties&property=${ID}`, title: "א" },
  { type: "listing", path: `/crm?goto=accProperties&property=${ID2}`, title: "ב" },
], () => "/crm?goto=accProperties&status=sold");
check("הכול נושא את הסטטוס", byStatus.kind === "list" && byStatus.allPath === "/crm?goto=accProperties&status=sold");
if (byStatus.kind === "list") {
  check("סטטוס הוא הרשימה המסוננת", byStatus.rows.at(-1)?.description === "הרשימה המסוננת");
  check("סטטוס הוא נתיב בטוח", isSafeCrmPath(byStatus.allPath));
}

const dupAll = screenBundle([
  { type: "listing", path: "/crm?goto=accProperties", title: "הרשימה" },
  { type: "listing", path: `/crm?goto=accProperties&property=${ID}`, title: "כרטיס" },
], () => "/crm?goto=accProperties");
check("הכול לא משכפל מזהה", dupAll.kind === "list" && dupAll.rows.filter((row) => row.title === "הכול").length === 0);
if (dupAll.kind === "list") {
  check("מזהים יחידים גם בלי הכול", new Set(dupAll.rows.map((row) => row.id)).size === dupAll.rows.length);
}

const dozen = screenBundle(
  Array.from({ length: 12 }, (_, i) => ({
    type: "listing",
    path: `/crm?goto=accProperties&property=${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`,
    title: `נכס ${i}`,
  })),
  () => "/crm?goto=accProperties",
);
check("מעל תשע נשארות תשע ועוד הכול", dozen.kind === "list" && dozen.rows.length === 10 && dozen.rows.at(-1)?.title === "הכול");
if (dozen.kind === "list") {
  const ids = dozen.rows.map((row) => row.id);
  check("גם בעשר אין כפילות", new Set(ids).size === ids.length);
  check("העשירי לא ברשימה", !ids.includes(encodeNavId("/crm?goto=accProperties&property=00000009-1111-4111-8111-111111111111") || ""));
}

const fallback = listTextFallback("https://shuknadlan.co.il", "איזה נכס לפתוח?", [
  { id: encodeNavId(`/crm?goto=accProperties&property=${ID}`) || "", title: "הרצל" },
  { id: "dest:site", title: "רק אתר" },
]);
check("נפילת רשימה כוללת את הקישור", fallback.includes(`הרצל: https://shuknadlan.co.il/crm?goto=accProperties&property=${ID}`));
check("שורה בלי nav נשארת כותרת", fallback.includes("רק אתר") && !fallback.includes("dest:site"));

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
check("בסיס התבנית קבוע בקוד", readFileSync(new URL("../supabase/functions/_shared/agent-deep-link.ts", import.meta.url), "utf8").includes("https://shuknadlan.co.il/"));

const push = readFileSync(new URL("../supabase/functions/notification-push/index.ts", import.meta.url), "utf8");
check("הדחיפה משתמשת ברשימה ובכפתור", push.includes("screenBundle") && push.includes("listMessage") && push.includes("ctaMessage"));
check("בלי הסוד נשארת התבנית הישנה", push.includes("WHATSAPP_NOTIFY_TEMPLATE") && push.includes("mode === \"template\" && WA_UTILITY"));
check("התבנית הישנה עדיין כפתור הפסקה", push.includes("`/crm?goto=${MANAGE_ACC}`"));

const agent = readFileSync(new URL("../supabase/functions/whatsapp-webhook/agent.ts", import.meta.url), "utf8");
check("רשימת נכסים לא מדביקה crm_link למי שנכנס לכפתור", agent.includes("listed.has(path)"));
check("סטטוס עובר ל-הכול", agent.includes("/crm?goto=accProperties&status="));
check("המודל לא מתבקש לצרף unlock_where", !agent.includes("צרף/י את unlock_where"));
check("המודל לא מרכיב כתובת", agent.includes("אסור להרכיב לבד"));
check("page_link שולח כפתור", agent.includes("crm_button_sent: true") && agent.includes("ctaLabel(link.path)"));

const hook = readFileSync(new URL("../supabase/functions/whatsapp-webhook/index.ts", import.meta.url), "utf8");
check("נפילת רשימה חוזרת עם הקישורים", hook.includes("listTextFallback"));
check("הפסק מכבה את הערוץ", hook.includes("notification_push_opt_out") && hook.includes("הפסקה"));

if (failed) {
  console.error(`נכשלו ${failed}`);
  process.exit(1);
}
console.log("עבר");
