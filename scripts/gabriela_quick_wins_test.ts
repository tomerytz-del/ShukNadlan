// ניצחונות מהירים של גבריאלה: כתיב, קישור לעמוד, כשל מודל, ומרווח שליחה.
//
//   node --experimental-strip-types scripts/gabriela_quick_wins_test.ts

import { readFileSync } from "node:fs";
import { clientMatchesQuery, nameSkeleton, namesLikelySame, namesNeedConfirm, phoneKey, phonesMatch } from "../supabase/functions/whatsapp-webhook/hebrew-name.ts";
import { adminAlertTitle, fallbackReply, isModelCallError, llmFailureKind } from "../supabase/functions/whatsapp-webhook/llm-fallback.ts";
import { pageLink, urlInSay } from "../supabase/functions/whatsapp-webhook/crm-pages.ts";
import { paceRecipient, pairPaceTracked, resetPairPaceForTests, setPairReserve } from "../supabase/functions/_shared/wa-pair-pace.ts";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : " - " + JSON.stringify(detail)}`);
  if (!ok) failed++;
}

const ID = "11111111-1111-4111-8111-111111111111";

check("כלפון וקלפון אותו שלד", nameSkeleton("כלפון") === nameSkeleton("קלפון") && namesLikelySame("כלפון", "קלפון"));
check("ו כפולה מתקפלת", namesLikelySame("ויצמן", "וויצמן"));
check("י חסרה", namesLikelySame("דוד", "דויד") && namesLikelySame("יוסי", "יוסי"));
check("ט ו-ת", namesLikelySame("טל אביב", "תל אביב"));
check("שם קצר בתוך שם ארוך", namesLikelySame("כלפון", "משפחת כלפון"));
check("שם אחר אינו כפילות", !namesLikelySame("כלפון", "כהן"));
check("טלפון 972 ו-050", phonesMatch("972501234567", "050-123-4567") && phoneKey("+972 50 123 4567") === "501234567");
check("טלפון קצר אינו מפתח", phoneKey("12345") === "");
check("חיפוש לפי כתיב", clientMatchesQuery("קלפון", { full_name: "משפחת כלפון", phone: "" }));
check("חיפוש לפי טלפון", clientMatchesQuery("0501234567", { full_name: "דני", phone: "972501234567" }));
check("חיפוש ריק אינו תופס הכל", !clientMatchesQuery("  ", { full_name: "דני", phone: "050" }));
check("דני כהן אינו רון כהן", !namesLikelySame("דני כהן", "רון כהן") && namesNeedConfirm("דני כהן", "רון כהן"));
check("דוד ודויד עם אותו שם משפחה", namesLikelySame("דוד כהן", "דויד כהן") && !namesNeedConfirm("דוד כהן", "דויד כהן"));
check("כהן לבדו אינו דני כהן", !namesLikelySame("כהן", "דני כהן"));

const billing = llmFailureKind({ message: "Your credit balance is too low to access the Anthropic API." });
const transient = llmFailureKind({ status: 529, message: "overloaded" });
const other = llmFailureKind({ status: 400, message: "invalid schema" });
check("יתרה שנגמרה אינה ניסיון חוזר", billing === "billing");
check("529 הוא זמני", transient === "transient");
check("400 אינו זמני", other === "other");

const billText = fallbackReply("billing", "agent", "https://shuknadlan.co.il/");
const otherText = fallbackReply("other", "agent", "https://shuknadlan.co.il");
const visitorText = fallbackReply("other", "visitor", "https://shuknadlan.co.il");
check("תשובת יתרה לסוכן/ת עם קישור", billText.includes("לא זמינה") && billText.includes("https://shuknadlan.co.il/crm") && !billText.includes("אחזור") && !billText.includes("—"));
check("תשובת כשל לסוכן/ת מציעה לשלוח שוב", otherText.includes("לשלוח") && otherText.includes("https://shuknadlan.co.il/crm") && !otherText.includes("—"));
check("גולש בלי אזור אישי", visitorText.includes("לשלוח") && !visitorText.includes("/crm") && !visitorText.includes("אחזור"));
check("שגיאת מסד אינה כשל מודל", !isModelCallError({ message: "permission denied for table agent_clients", code: "42501" }));
check("שגיאת Anthropic היא כשל מודל", isModelCallError({ name: "APIError", status: 529, message: "overloaded" }));
check("כותרת נפרדת לכל סוג", adminAlertTitle("billing") !== adminAlertTitle("transient") && adminAlertTitle("transient") !== adminAlertTitle("other"));

const agr = pageLink("https://shuknadlan.co.il", { topic: "agreements", agreement_id: ID });
check("הסכם נפתח על ההסכם עצמו", agr?.path === `/crm?goto=accAgreements&agreement=${ID}` && (agr?.say.includes(ID) ?? false));
check("מזהה שאינו uuid נזרק", pageLink("https://shuknadlan.co.il", { topic: "property", property_id: "לא" })?.path === "/crm?goto=accProperties");
check("יומן גוגל הוא היומן", pageLink("https://shuknadlan.co.il", { topic: "google_calendar" })?.path === "/crm?goto=accAgenda");
check("נושא לא מוכר", pageLink("https://shuknadlan.co.il", { topic: "nope" }) === null);
check("בלי לומר היכנסו לדשבורד", !(agr?.say.includes("היכנסו לדשבורד")));
check("http לא נחתך", urlInSay("פתחו כאן: http://127.0.0.1:8888/crm?goto=accAgenda") === "http://127.0.0.1:8888/crm?goto=accAgenda");
check("https נשאר", urlInSay(agr?.say || "").startsWith("https://shuknadlan.co.il/crm"));

const sql = readFileSync(new URL("../supabase/migrations/20271027150100_gabriela_quick_wins.sql", import.meta.url), "utf8");
check("מרווח ברירת מחדל 1500", sql.includes("default 1500") && sql.includes("coalesce(p_gap_ms, 1500)") && !sql.includes("default 2000"));
check("ניקוי חריצי שליחה ישנים", sql.includes("interval '7 days'"));

resetPairPaceForTests(0);
let running = 0;
let maxRun = 0;
await Promise.all([1, 2, 3].map(() => paceRecipient("972501111111", async () => {
  running++;
  maxRun = Math.max(maxRun, running);
  await new Promise((r) => setTimeout(r, 15));
  running--;
})));
check("אותו נמען לא נשלח במקביל", maxRun === 1, maxRun);

resetPairPaceForTests(80);
const t0 = Date.now();
await Promise.all([
  paceRecipient("111", async () => 1),
  paceRecipient("222", async () => 2),
]);
check("נמענים שונים לא מחכים זה לזה", Date.now() - t0 < 60, Date.now() - t0);

resetPairPaceForTests(30);
setPairReserve(async () => 0);
const t1 = Date.now();
await paceRecipient("333", async () => "a");
await paceRecipient("333", async () => "b");
check("בלי חריץ במסד נשאר המרווח המקומי", Date.now() - t1 >= 25, Date.now() - t1);

resetPairPaceForTests(0);
await paceRecipient("444", async () => "done");
await Promise.resolve();
check("שרשרת שהסתיימה יורדת מהמפה", pairPaceTracked().chains === 0, pairPaceTracked());

if (failed) {
  console.log(`\n${failed} בדיקות נכשלו`);
  process.exit(1);
}
console.log("\n✓ ניצחונות מהירים של גבריאלה: כל הבדיקות עברו");
