// נוסח שהסוכן/ת מעביר/ה מהוואטסאפ האישי: קישור קצר בשורה משלו.
//
//   node --experimental-strip-types scripts/wa_forward_test.ts

import { readFileSync } from "node:fs";
import {
  forwardPropertyLink,
  minisiteRedirectPath,
  propertyForwardMessage,
  propertyPublicUrl,
  showcaseForwardMessage,
  showcasePublicUrl,
} from "../supabase/functions/_shared/wa-forward.ts";
import minisiteLink from "../netlify/edge-functions/minisite-link.ts";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`ok  ${name}`);
  else {
    failed++;
    console.log(`FAIL  ${name}`, detail === undefined ? "" : detail);
  }
}

const TOKEN = "a".repeat(48);
const SITE = "https://shuknadlan.co.il";

const propertyBefore = [
  "היי דנה,",
  "דירת 4 חדרים",
  "העצמאות, גבעת המורה",
  "4 חדרים · 100 מ\"ר · 1,200,000 ₪",
  `${SITE}/property?id=11111111-2222-3333-4444-555555555555`,
].join("\n");
const propertyAfter = propertyForwardMessage({
  greeting: "היי דנה,",
  title: "דירת 4 חדרים",
  address: "העצמאות, גבעת המורה",
  facts: "4 חדרים · 100 מ\"ר · 1,200,000 ₪",
  link: propertyPublicUrl(SITE, 1147)!,
});
check("נכס: הקישור הקצר בשורה האחרונה", propertyAfter === [
  "היי דנה,",
  "דירת 4 חדרים",
  "העצמאות, גבעת המורה",
  "4 חדרים · 100 מ\"ר · 1,200,000 ₪",
  `${SITE}/p/1147`,
].join("\n"));
check("נכס: אין כתובת ארוכה ואין מספר בית", !propertyAfter.includes("property?id=") && !propertyAfter.includes("12 ") && propertyAfter !== propertyBefore);
check("נכס: בלי טלפון ובלי פרמטרים", !/05\d|\+972|wa\.me|[?&]/.test(propertyAfter));
check("מספר מודעה כמו באתר", propertyPublicUrl(SITE, "1385") === `${SITE}/p/1385`);
check("בלי מספר מודעה אין קישור קצר", propertyPublicUrl(SITE, null) === undefined && propertyPublicUrl(SITE, 0) === undefined);
check("מספר של עד 9 ספרות כמו /p/", propertyPublicUrl(SITE, 999_999_999) === `${SITE}/p/999999999` && propertyPublicUrl(SITE, 1_000_000_000) === undefined);
const longProperty = `${SITE}/property?id=11111111-2222-3333-4444-555555555555`;
check("מודעה באוויר מקבלת קישור קצר", forwardPropertyLink("active", `${SITE}/p/1147`, longProperty) === `${SITE}/p/1147`);
check("מודעה שאינה באוויר נשארת בכתובת המלאה", forwardPropertyLink("unpublished", `${SITE}/p/1147`, longProperty) === longProperty && forwardPropertyLink("archived", undefined, longProperty) === longProperty);

const showcaseBefore = showcaseForwardMessage("דנה", `${SITE}/showcase?t=${TOKEN}`);
const showcaseAfter = showcaseForwardMessage("דנה", showcasePublicUrl(SITE, TOKEN)!);
check("מיניסייט: הקישור הקצר בשורה משלו",
  showcaseAfter.startsWith("היי דנה, ריכזתי בשבילך עמוד אישי עם הנכסים שמתאימים למה שחיפשת:\n" + `${SITE}/m/${TOKEN}\n\n`)
  && showcaseAfter.includes("נכסים חדשים שאמצא יתווספו לאותו עמוד.")
  && showcaseAfter.endsWith("רוצה להתייעץ? אפשר לשתף את העמוד עם בני הזוג או המשפחה, והם יראו בדיוק את אותו עמוד."));
check("מיניסייט: אין כתובת ארוכה", !showcaseAfter.includes("showcase?t=") && showcaseAfter !== showcaseBefore);
const showcaseLinkLine = showcaseAfter.split("\n").find((line) => line.startsWith("https://")) || "";
check("מיניסייט: בלי טלפון ובלי פרמטרים",
  showcaseLinkLine === `${SITE}/m/${TOKEN}`
  && !showcaseAfter.includes("wa.me")
  && !/05\d{7}/.test(showcaseAfter));
check("טוקן לא חוקי לא נבנה", showcasePublicUrl(SITE, "short") === undefined && showcasePublicUrl(SITE, TOKEN + "zz") === undefined);

check("הפניה של /m/ לאותו טוקן", minisiteRedirectPath(`/m/${TOKEN}`) === `/showcase?t=${TOKEN}`);
check("הפניה בלי query נוסף", minisiteRedirectPath(`/m/${TOKEN.toUpperCase()}/`) === `/showcase?t=${TOKEN}`);
check("נתיב שאינו טוקן לא נפתח", minisiteRedirectPath("/m/nope") === null && minisiteRedirectPath("/meeting") === null);

const crm = readFileSync(new URL("../assets/crm-showcase.js", import.meta.url), "utf8");
check("ה-CRM מעתיק את הקישור הקצר", crm.includes("'/m/'") && crm.includes("showcaseClientUrl(sc.token)"));
check("ה-CRM שומר את משפט ההודעה", crm.includes("ריכזתי בשבילך עמוד אישי עם הנכסים שמתאימים למה שחיפשת:\\n${link}"));
const share = readFileSync(new URL("../assets/showcase.js", import.meta.url), "utf8");
check("שיתוף העמוד מהמיניסייט הוא /m/", share.includes("'/m/' + encodeURIComponent(TOKEN)"));
const send = readFileSync(new URL("../netlify/edge-functions/showcase-send.ts", import.meta.url), "utf8");
check("פתיחת הוואטסאפ שמה את /m/ בתוך ההודעה", send.includes("showcasePublicUrl") && send.includes("showcaseForwardMessage"));
const agent = readFileSync(new URL("../supabase/functions/whatsapp-webhook/agent.ts", import.meta.url), "utf8");
check("הבוט בונה את הודעת הנכס מהקישור הקצר", agent.includes("propertyPublicUrl(SITE_BASE_URL, p.listing_number)"));
check("נוסח ההעתקה של המיניסייט הוא הקישור הקצר", agent.includes("showcaseForwardMessage(first, showcasePublicUrl(SITE_BASE_URL, token)"));

const ORIGIN = "https://shuknadlan.co.il";
async function redirectOf(pathname: string, search = ""): Promise<string> {
  const res = await minisiteLink(new Request(`${ORIGIN}${pathname}${search}`), {} as never);
  return res.headers.get("location") || "";
}
const valid = await redirectOf(`/m/${TOKEN}`);
check("טוקן תקין מופנה למיניסייט", valid === `${ORIGIN}/showcase?t=${TOKEN}` && (await minisiteLink(new Request(`${ORIGIN}/m/${TOKEN}`), {} as never)).status === 302);
check("טוקן באותיות גדולות מנורמל", (await redirectOf(`/m/${TOKEN.toUpperCase()}/`)) === `${ORIGIN}/showcase?t=${TOKEN}`);
for (const bad of [
  "/m/nope",
  "/m/",
  `/m/${"a".repeat(31)}`,
  `/m/${"b".repeat(65)}`,
  `/m/${TOKEN}/extra`,
  "/m/..%2F..%2Fevil",
  "/m/%2e%2e",
  "/meeting",
  `/m/${TOKEN}@evil.com`,
]) {
  const loc = await redirectOf(bad);
  check(`נתיב לא תקין חוזר הביתה: ${bad}`, loc === `${ORIGIN}/`);
}
const withQuery = await redirectOf(`/m/${TOKEN}`, "?next=https://evil.example/phish&t=other");
check("בלי הפניה פתוחה ובלי query מהבקשה", withQuery === `${ORIGIN}/showcase?t=${TOKEN}` && !withQuery.includes("evil") && !withQuery.includes("next="));

if (failed) {
  console.log(`\n${failed} בדיקות נכשלו`);
  process.exit(1);
}
console.log("\n✓ קישור קצר בהודעה שהסוכן/ת מעביר/ה");
