// שיתוף דף המשרד בפייסבוק: כפתור לדף הציבורי, בלי כתובת בגוף, ובלי דף מומצא.
//
//   node --experimental-strip-types scripts/office_share_test.ts

import { readFileSync } from "node:fs";
import { BUTTON_TITLE_MAX } from "../supabase/functions/_shared/agent-deep-link.ts";
import { csmLinkFor } from "../supabase/functions/whatsapp-webhook/csm-links.ts";
import {
  OFFICE_SHARE_BODY,
  OFFICE_SHARE_BUTTON_GUIDANCE,
  OFFICE_SHARE_LABEL,
  OFFICE_SHARE_MISS_GUIDANCE,
  officePageUrl,
  officeShareDecision,
  officeShareLabelFits,
  officeShareSay,
} from "../supabase/functions/whatsapp-webhook/office-share.ts";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : " - " + JSON.stringify(detail)}`);
  if (!ok) failed++;
}

const PHONE_RE = /(?:\+?972|05\d)[\d\s-]{6,}|\d{7,}/;
const URL_RE = /https?:\/\/|www\.|wa\.me|shuknadlan|\.co\.il/i;
const CLAIM_RE = /פרסמתי|שלחתי|העליתי|אני לא יכולה|אין לי אפשרות/;
const DASH_RE = /[—–―]/;

function clean(text: string): boolean {
  return !PHONE_RE.test(text) && !URL_RE.test(text) && !CLAIM_RE.test(text) && !DASH_RE.test(text) && !/\d/.test(text);
}

const slug = "אדל-נכסים";
const built = csmLinkFor("agency_page", { agency_slug: slug });
const url = officePageUrl(slug);
check("הכתובת היא של csmLinkFor", !!built && url === built.url);
check("slug עברי מקודד", !!url && url.includes(encodeURIComponent(slug)) && !url.includes(slug));
check("רק דף המשרד", !!url && url.startsWith("https://shuknadlan.co.il/agency?slug="));
check("slug ריק אינו דף", officePageUrl("  ") === null && officePageUrl(null) === null);

const share = officeShareDecision({ agencyId: "ag-1", slug, live: true });
check("משרד חי מקבל כפתור", share.kind === "share" && share.kind === "share" && share.url === url);
if (share.kind === "share") {
  check("כותרת הכפתור", share.label === OFFICE_SHARE_LABEL && share.label === "🏢 דף המשרד");
  check("הכותרת נכנסת ל-20", officeShareLabelFits(share.label) && share.label.length <= BUTTON_TITLE_MAX && Array.from(share.label).length <= BUTTON_TITLE_MAX);
  check("גוף ההודעה", share.body === OFFICE_SHARE_BODY);
  check("הגוף בלי כתובת, טלפון או טענת פרסום", clean(share.body) && clean(share.label.replace("🏢", "")));
  check("ההנחיה לכפתור בלי כתובת", !URL_RE.test(OFFICE_SHARE_BUTTON_GUIDANCE) && !PHONE_RE.test(OFFICE_SHARE_BUTTON_GUIDANCE)
    && OFFICE_SHARE_BUTTON_GUIDANCE.includes("אל תאמרי שפרסמת"));
}

const reasons = ["no_agency", "no_page", "not_live", "unknown"] as const;
for (const reason of reasons) {
  const say = officeShareSay(reason);
  check(`הסבר ${reason} בלי כתובת`, say.length > 10 && say.length < 220 && clean(say), say);
}

check("בלי משרד", officeShareDecision({ agencyId: null, slug, live: true }).kind === "explain"
  && officeShareDecision({ agencyId: "  ", slug, live: true }).kind === "explain");
const noAgency = officeShareDecision({ agencyId: null, slug: "x", live: true });
check("בלי משרד לא מנחשים דף", noAgency.kind === "explain" && noAgency.kind === "explain" && noAgency.reason === "no_agency");

check("בלי slug", officeShareDecision({ agencyId: "ag-1", slug: " ", live: true }).kind === "explain"
  && officeShareDecision({ agencyId: "ag-1", slug: "", live: true }).kind === "explain");
const noPage = officeShareDecision({ agencyId: "ag-1", slug: "", live: true });
check("בלי slug זה אין דף", noPage.kind === "explain" && noPage.reason === "no_page");

const held = officeShareDecision({ agencyId: "ag-1", slug, live: false });
check("רישיון לא מאושר אינו קישור", held.kind === "explain" && held.reason === "not_live");

const down = officeShareDecision({ agencyId: "ag-1", slug, live: "error" });
check("כשל בדיקה אינו קישור", down.kind === "explain" && down.reason === "unknown");
const missed = officeShareDecision({ agencyId: "ag-1", slug: null, lookupFailed: true, live: true });
check("שאילתה שנכשלה אינה אין דף", missed.kind === "explain" && missed.reason === "unknown");

check("הנחיית ההסבר בלי כתובת", !URL_RE.test(OFFICE_SHARE_MISS_GUIDANCE) && !PHONE_RE.test(OFFICE_SHARE_MISS_GUIDANCE)
  && OFFICE_SHARE_MISS_GUIDANCE.includes("בלי לנחש דף") && OFFICE_SHARE_MISS_GUIDANCE.includes("אני לא יכולה"));

const agent = readFileSync(new URL("../supabase/functions/whatsapp-webhook/agent.ts", import.meta.url), "utf8");
const email = readFileSync(new URL("../supabase/functions/whatsapp-webhook/email-intake.ts", import.meta.url), "utf8");
const media = readFileSync(new URL("../supabase/functions/whatsapp-webhook/media-intake.ts", import.meta.url), "utf8");
check("הכלי רשום ומופעל", agent.includes('name: "office_page_link"') && agent.includes('case "office_page_link"'));
check("הכפתור דרך modelLink", agent.includes("modelLink(ctx, decision.url, decision.label, decision.body, \"page_url\")"));
check("החיות נבדקת במסד", agent.includes('rpc("agency_is_live"'));
check("הפרומפט ממפה את הכוונה", agent.includes("שיתוף דף המשרד בפייסבוק (פרופיל אישי, דף או קבוצה) = office_page_link")
  && agent.includes("אל תאמרי שפרסמת"));
check("נכס בפייסבוק נשאר page_link", agent.includes("פרסום נכס = page_link עם topic marketing"));
check("לא בתור מייל או קובץ", !email.includes("office_page_link") && !media.includes("office_page_link"));

const shareSrc = readFileSync(new URL("../supabase/functions/whatsapp-webhook/office-share.ts", import.meta.url), "utf8");
check("הכתובת מ-csmLinkFor", shareSrc.includes('csmLinkFor("agency_page"'));

if (failed) {
  console.error(`\n${failed} נכשלו`);
  process.exit(1);
}
console.log("\nהכל עבר");
