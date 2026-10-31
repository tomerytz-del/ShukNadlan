// ניצחונות מהירים של גבריאלה: כתיב, קישור לעמוד, כשל מודל, ומרווח שליחה.
//
//   node --experimental-strip-types scripts/gabriela_quick_wins_test.ts

import { readFileSync } from "node:fs";
import { clientMatchesQuery, nameSkeleton, namesLikelySame, namesNeedConfirm, phoneKey, phonesMatch } from "../supabase/functions/whatsapp-webhook/hebrew-name.ts";
import { adminAlertTitle, FALLBACK_AGENT_PATH, fallbackReply, isModelCallError, llmFailureKind, PUBLIC_FALLBACK_SITE } from "../supabase/functions/whatsapp-webhook/llm-fallback.ts";
import { PUBLIC_MODEL_CURRENT, PUBLIC_MODEL_NEXT, publicBotModel } from "../supabase/functions/whatsapp-webhook/public-model.ts";
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
check("ישי לוי אינו לוי כהן", !namesLikelySame("ישי לוי", "לוי כהן") && !namesNeedConfirm("ישי לוי", "לוי כהן"));
check("רוני כהן אינו רון כהן", !namesLikelySame("רוני כהן", "רון כהן") && namesNeedConfirm("רוני כהן", "רון כהן"));
check("י מובילה נשמרת", nameSkeleton("ישי") === "ישי" && nameSkeleton("ישי לוי").startsWith("ישי"));
check("י סופית אינה נמחקת", nameSkeleton("רוני") === "רוני" && nameSkeleton("רוני") !== nameSkeleton("רון") && nameSkeleton("לוי") === "לוי");
check("טאב ושורה הם רווח", nameSkeleton("יוסי\tלוי") === nameSkeleton("יוסי לוי") && nameSkeleton("יוסי\nלוי") === nameSkeleton("יוסי לוי"));
check("NFKC לפני הפיצול", nameSkeleton("יוסי\u00a0לוי") === nameSkeleton("יוסי לוי") && nameSkeleton("Ａ") === "a");

const billing = llmFailureKind({ message: "Your credit balance is too low to access the Anthropic API." });
const transient = llmFailureKind({ status: 529, message: "overloaded" });
const other = llmFailureKind({ status: 400, message: "invalid schema" });
check("יתרה שנגמרה אינה ניסיון חוזר", billing === "billing");
check("529 הוא זמני", transient === "transient");
check("400 אינו זמני", other === "other");

const billText = fallbackReply("billing", "agent", "https://shuknadlan.co.il/");
const otherText = fallbackReply("other", "agent", "https://shuknadlan.co.il");
const visitorOther = "סליחה, משהו השתבש אצלי רגע לפני שעניתי. אפשר לשלוח לי את ההודעה שוב?";
const visitorBill = "סליחה, אני לא זמינה כרגע בגלל תקלה אצלי. אפשר לנסות שוב מאוחר יותר, או לחפש נכסים באתר בינתיים.";
check("תשובת יתרה לסוכן/ת בלי קישור ארוך", billText === "אני לא זמינה לרגע בגלל תקלה אצלי. אפשר להמשיך בינתיים מהאזור האישי, ולשלוח לי שוב כשזה יסתדר.");
check("תשובת כשל לסוכן/ת מציעה לשלוח שוב", otherText === "משהו השתבש אצלי רגע לפני שעניתי. אפשר לשלוח את ההודעה שוב, או להמשיך מהאזור האישי.");
check("כפתור הכשל פותח את הפעמון", FALLBACK_AGENT_PATH === "/crm?goto=bell");
check("כשל לגולש/ת בנוסח המאושר", fallbackReply("other", "visitor", PUBLIC_FALLBACK_SITE) === visitorOther);
check("כשל זמני לגולש/ת אותו נוסח", fallbackReply("transient", "visitor", "/") === visitorOther);
for (const base of [PUBLIC_FALLBACK_SITE, PUBLIC_FALLBACK_SITE + "/", "shuknadlan.co", "https://shuknadlan.co", "/", PUBLIC_FALLBACK_SITE + "/crm"]) {
  const text = fallbackReply("billing", "visitor", base);
  check("יתרה לגולש/ת בלי כתובת בגוף", text === visitorBill && !text.includes("http"), base);
}
check("שגיאת מסד אינה כשל מודל", !isModelCallError({ message: "permission denied for table agent_clients", code: "42501" }));
check("שגיאת Anthropic היא כשל מודל", isModelCallError({ name: "APIError", status: 529, message: "overloaded" }));
check("כותרת נפרדת לכל סוג", adminAlertTitle("billing") !== adminAlertTitle("transient") && adminAlertTitle("transient") !== adminAlertTitle("other"));

const agr = pageLink("https://shuknadlan.co.il", { topic: "agreements", agreement_id: ID });
check("הסכם נפתח על ההסכם עצמו", agr?.path === `/crm?goto=accAgreements&agreement=${ID}` && (agr?.url.includes(ID) ?? false));
check("מזהה שאינו uuid נזרק", pageLink("https://shuknadlan.co.il", { topic: "property", property_id: "לא" })?.path === "/crm?goto=accProperties");
check("יומן גוגל הוא היומן", pageLink("https://shuknadlan.co.il", { topic: "google_calendar" })?.path === "/crm?goto=accAgenda");
check("נושא לא מוכר", pageLink("https://shuknadlan.co.il", { topic: "nope" }) === null);
check("בלי לומר היכנסו לדשבורד", !(agr?.say.includes("היכנסו לדשבורד")));
check("http לא נחתך", urlInSay("פתחו כאן: http://127.0.0.1:8888/crm?goto=accAgenda") === "http://127.0.0.1:8888/crm?goto=accAgenda");
check("המשפט בלי כתובת", !!agr && !agr.say.includes("http"));
check("https נשאר", urlInSay("פתחו כאן: https://shuknadlan.co.il/crm?goto=accAgenda").startsWith("https://shuknadlan.co.il/crm"));

const sql = readFileSync(new URL("../supabase/migrations/20271029122000_gabriela_quick_wins.sql", import.meta.url), "utf8");
check("מרווח ברירת מחדל 1500", sql.includes("default 1500") && sql.includes("coalesce(p_gap_ms, 1500)") && !sql.includes("default 2000"));
check("ניקוי חריצי שליחה ישנים", sql.includes("interval '7 days'"));
check("כפילות לקוח ב-SQL על כל הקובץ", sql.includes("function public.agent_client_duplicate") && sql.includes("client_name_skeleton") && sql.includes("from public.agent_clients"));
const skeletonFn = sql.slice(sql.indexOf("function public.client_name_skeleton"), sql.indexOf("function public.client_name_tokens"));
check("שלד SQL זהה ל-TS", skeletonFn.includes("normalize(coalesce(p_raw, ''), NFKC)")
  && !skeletonFn.includes("'NFKC'") && !skeletonFn.includes("'NFC'")
  && skeletonFn.indexOf("[[:space:]]") < skeletonFn.indexOf("regexp_split_to_array")
  && skeletonFn.includes("return lower(array_to_string(words, ' '))"));
const dupFn = sql.slice(sql.indexOf("function public.agent_client_duplicate"), sql.indexOf("comment on function public.agent_client_duplicate"));
check("יומן מענה חלופי בלי גוף ובלי טלפון",
  sql.includes("gabriela_llm_fallbacks")
  && sql.includes("interval '1 hour'")
  && sql.includes("conversation_id uuid not null")
  && !/gabriela_llm_fallbacks[\s\S]{0,400}phone/.test(sql)
  && !sql.includes("gabriela_public_opus_55', 1"));
check("duplicate לא ל-authenticated", !/security\s+definer/i.test(dupFn)
  && sql.includes("revoke all on function public.agent_client_duplicate(uuid, text, text) from public, anon, authenticated")
  && sql.includes("אין grant ל-authenticated")
  && !/grant execute on function public\.agent_client_duplicate\(uuid, text, text\)\s+to\s+authenticated/i.test(sql));
const agentSrc = readFileSync(new URL("../supabase/functions/whatsapp-webhook/agent.ts", import.meta.url), "utf8");
const createClient = agentSrc.slice(agentSrc.indexOf("async function findClientDuplicates"), agentSrc.indexOf("async function toolUpdateClient"));
check("יצירת לקוח לא נעצרת ב-500", createClient.includes('rpc("agent_client_duplicate"') && createClient.includes(".range(") && !createClient.includes(".limit(500)"));
const indexSrc = readFileSync(new URL("../supabase/functions/whatsapp-webhook/index.ts", import.meta.url), "utf8");
const outer = indexSrc.slice(indexSrc.indexOf("message handling failed"), indexSrc.indexOf("status handling failed"));
check("כשל שליחה לא עוצר סטטוסים", outer.includes("llm failure reply failed"));
check("מענה חלופי נרשם ומוגבל לשעה", indexSrc.includes("gabriela_llm_fallback_log") && indexSrc.includes("p_reason: kind"));
check("מודל ציבורי: סוד גובר, דגל כבוי נשאר Opus 5",
  publicBotModel("claude-opus-5-5", 0) === "claude-opus-5-5"
  && publicBotModel("", 0) === PUBLIC_MODEL_CURRENT
  && publicBotModel(undefined, null) === PUBLIC_MODEL_CURRENT
  && publicBotModel(undefined, 1) === PUBLIC_MODEL_NEXT);
check("חימום הבוט הציבורי קורא את הדגל", indexSrc.includes("warmPublicPromptCache(supabase)"));
check("סוכן לא פעיל לא מקבל קישור", outer.includes('.eq("active", true)'));
check("בוט ציבורי כבוי בלי הודעת כשל ללא מוכר", outer.includes("!agentId && !publicBotEnabled"));

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
