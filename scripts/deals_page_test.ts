/* ============================================================================
   ‏הבדיקה של netlify/edge-functions/deals-page.ts
   ----------------------------------------------------------------------------
   ‏/deals/{slug} שווה משהו לסורק רק אם המספרים יושבים ב-HTML שהשרת מגיש,
   וה-canonical שלו נכון גם כשהמסד לא ענה. הבדיקה מריצה את הפונקציה על
   `deals.html` עצמו, ומוודאת:

     ‏· יישוב, המסד ענה  → כותרת, תיאור, כרטיסים, ‏data-ssr, ‏Dataset ו-canonical.
     ‏· יישוב, המסד נכשל → 503, canonical של היישוב בכל זאת, בלי noindex, no-store.
     ‏· יישוב שאינו קיים (המסד ענה null) → ‏404 ו-noindex.
     ‏· אינדקס → קישורים לכל יישוב, canonical נשאר /deals.
     ‏· שם עם ‎</script>‎ אינו סוגר תגית; אין מספר בית ואין גוש בדף.

   הרצה:

       node --experimental-strip-types scripts/deals_page_test.ts

   התיעוד: ‎docs/settlement-deals.md‎.
   ========================================================================== */

import { readFileSync } from "node:fs";
import handler from "../netlify/edge-functions/deals-page.ts";
import { resetLastGood } from "../netlify/edge-functions/lib/last-good.ts";

const PAGE = readFileSync(new URL("../deals.html", import.meta.url), "utf8");

const context = () =>
  ({
    next: async () => new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } }),
  }) as never;

const AFULA = {
  name: "עפולה",
  slug: "afula",
  updated_at: "2026-10-09T08:00:00+00:00",
  period_start: "2025-09-01",
  period_end: "2026-08-31",
  deals: 812,
  median_price: 1430000,
  median_ppsqm: 13600,
  by_rooms: [
    { rooms: 3, deals: 210, median_price: 980000, median_ppsqm: 13900 },
    { rooms: 4, deals: 400, median_price: 1450000, median_ppsqm: 13500 },
    { rooms: 6, deals: 3, median_price: null, median_ppsqm: null },
  ],
  recent: [
    { sold_at: "2026-08-30", street: "הנביאים", neighborhood: "גבעת המורה", property_type: "דירה", rooms: 4, floor: "שלישית", size_sqm: 105, sale_price: 1495000, ppsqm: 14238 },
    { sold_at: "2026-08-31", street: "</script><b>x", neighborhood: null, property_type: null, rooms: 3, floor: null, size_sqm: 80, sale_price: 990000, ppsqm: 12375 },
  ],
};

async function run(url: string, status: number, body: unknown): Promise<Response> {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
  ) as typeof fetch;
  return await handler(new Request(url), context());
}

let failed = 0;
function check(name: string, ok: boolean) {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}`);
}

function ldOf(html: string): Record<string, any> | null {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  try { return m ? JSON.parse(m[1]) : null; } catch { return null; }
}

/* יישוב, המסד ענה */
let res = await run("https://shuknadlan.co.il/deals/afula", 200, AFULA);
let html = await res.text();
const ld = ldOf(html);
check("‏data-ssr", /<div id="dealsBody" data-ssr="1">/.test(html));
const jeru = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", year: "numeric", month: "numeric" }).formatToParts(new Date());
const jeruMonth = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"][Number(jeru.find((p) => p.type === "month")!.value) - 1];
const jeruYear = jeru.find((p) => p.type === "year")!.value;
const afulaTitle = `עסקאות נדל״ן בעפולה לפי שכונה - ${jeruMonth} ${jeruYear}`;
check("כותרת עם חודש ושנה", html.includes(`<title>${afulaTitle} | שוק נדל״ן</title>`));
check("‏og:title כמו הכותרת", html.includes(`<meta property="og:title" content="${afulaTitle} | שוק נדל״ן">`));
check("‏h1", new RegExp(`<h1 id="dealsH1">${afulaTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</h1>`).test(html));
check("‏meta description עם המספרים", /<meta name="description" content="812 עסקאות[^"]*₪1,430,000/.test(html));
check("כרטיסי הסיכום", html.includes("₪1,430,000") && html.includes("₪13,600") && html.includes(">812<"));
check("חציון מושתק מתחת ל-5", html.includes("מעט מדי עסקאות"));
check("canonical של היישוב", html.includes('<link rel="canonical" href="https://shuknadlan.co.il/deals/afula">'));
check("‏og:url של היישוב", html.includes('<meta property="og:url" content="https://shuknadlan.co.il/deals/afula">'));
check("שורת המקור", html.includes("מקור: רשות המסים, דרך GovMap."));
check("‏Dataset + BreadcrumbList", Array.isArray(ld?.["@graph"])
  && ld!["@graph"].some((x: any) => x["@type"] === "Dataset" && x.temporalCoverage === "2025-09-01/2026-08-31")
  && ld!["@graph"].some((x: any) => x["@type"] === "BreadcrumbList" && x.itemListElement.length === 3));
check("נתוני המיון מוטמעים", /<script type="application\/json" id="dealsData">/.test(html));
check("‏</script> בשם רחוב מוברח", !html.includes("</script><b>x") && html.includes("&lt;/script&gt;&lt;b&gt;x"));
check("החדשה ראשונה", html.indexOf("31.8.2026") < html.indexOf("30.8.2026"));
check("נשמר במטמון", (res.headers.get("Netlify-CDN-Cache-Control") || "").includes("max-age=3600"));
check("מטמון בלי פיצול utm", res.headers.get("Netlify-Vary") === "query=_");

/* יישוב, המסד נכשל, ואין עותק קודם */
resetLastGood();
res = await run("https://shuknadlan.co.il/deals/afula", 503, { message: "down" });
html = await res.text();
check("כשל: canonical של היישוב בכל זאת", html.includes('href="https://shuknadlan.co.il/deals/afula"'));
check("כשל: 503 בלי noindex", res.status === 503 && !html.includes("noindex"));
check("כשל: הדף לא מולא", !html.includes("data-ssr"));
check("כשל: no-store ו-Retry-After", res.headers.get("Cache-Control") === "no-store"
  && res.headers.get("Netlify-CDN-Cache-Control") === "no-store"
  && res.headers.get("Retry-After") === "60");

/* יישוב עם פחות מ-5 עסקאות: מוצג, אבל noindex */
res = await run("https://shuknadlan.co.il/deals/kfar-katan", 200, { ...AFULA, name: "כפר קטן", slug: "kfar-katan", deals: 3, median_price: null, median_ppsqm: null, by_rooms: [] });
html = await res.text();
check("דל: 200 והדף מולא", res.status === 200 && /<div id="dealsBody" data-ssr="1">/.test(html));
check("דל: noindex", html.includes('<meta name="robots" content="noindex,follow">'));
html = await (await run("https://shuknadlan.co.il/deals/afula", 200, AFULA)).text();
check("812 עסקאות, בלי תשובת מודעות: בלי noindex", !html.includes("noindex"));

async function runRouted(url: string, route: (target: string) => { status: number; body: unknown }): Promise<Response> {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const target = String(input instanceof Request ? input.url : input);
    const got = route(target);
    return new Response(JSON.stringify(got.body), {
      status: got.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return await handler(new Request(url), context());
}

res = await runRouted("https://shuknadlan.co.il/deals/afula", (target) => {
  if (target.includes("/properties?")) return { status: 200, body: [{ city_id: "c1" }] };
  if (target.includes("market_cities_public")) return { status: 200, body: [{ market_slug: "afula-emek" }] };
  return { status: 200, body: AFULA };
});
html = await res.text();
check("עפולה עם מודעות: בלי noindex", res.status === 200 && !html.includes("noindex"));

res = await runRouted("https://shuknadlan.co.il/deals/haifa", (target) => {
  if (target.includes("/properties?")) return { status: 200, body: [] };
  return { status: 200, body: { ...AFULA, name: "חיפה", slug: "haifa", deals: 100 } };
});
html = await res.text();
check("בלי מודעות: 200 ו-noindex", res.status === 200 && html.includes("noindex")
  && res.headers.get("X-Robots-Tag") === "noindex, follow");

res = await runRouted("https://shuknadlan.co.il/deals/haifa", (target) => {
  if (target.includes("/properties?")) return { status: 200, body: [{ city_id: "h1" }] };
  if (target.includes("market_cities_public")) return { status: 200, body: [{ market_slug: "haifa-krayot" }] };
  return { status: 200, body: { ...AFULA, name: "חיפה", slug: "haifa", deals: 100 } };
});
html = await res.text();
check("מחוץ לשוק חי: 200 ו-noindex", res.status === 200 && html.includes("noindex"));

/* יישוב שאינו קיים */
res = await run("https://shuknadlan.co.il/deals/nowhere", 200, null);
html = await res.text();
check("לא קיים: 404 ו-noindex", res.status === 404 && html.includes('<meta name="robots" content="noindex,follow">'));
check("לא קיים: no-store בלי Retry-After", res.headers.get("Cache-Control") === "no-store" && !res.headers.get("Retry-After"));

/* slug פסול */
res = await run("https://shuknadlan.co.il/deals/%3Cx%3E", 200, AFULA);
html = await res.text();
check("‏slug פסול: 404, noindex, וה-canonical לא נגע", res.status === 404 && html.includes("noindex") && html.includes('href="https://shuknadlan.co.il/deals"'));

/* אינדקס: רק יישוב שמותר לאנדקס. השאר בלי קישור. */
const INDEX = [
  { name: "עפולה", slug: "afula", deals: 1568, newest: "2026-08-31" },
  { name: "מגדל העמק", slug: "migdal-haemek", deals: 400, newest: "2026-08-31" },
  { name: "כפר קטן", slug: "kfar-katan", deals: 2, newest: "2026-01-01" },
];
res = await runRouted("https://shuknadlan.co.il/deals", (target) => {
  if (target.includes("deal_settlements_public")) return { status: 200, body: INDEX };
  if (target.includes("/properties?")) return { status: 200, body: [
    { city: "עפולה", city_id: "c1" },
    { city: "מגדל העמק", city_id: "m1" },
  ] };
  if (target.includes("market_cities_public")) return { status: 200, body: [
    { city_id: "c1", market_slug: "afula-emek" },
    { city_id: "m1", market_slug: "nof-hagalil-migdal" },
  ] };
  if (target.includes("deal_settlement_page")) return { status: 200, body: { ...AFULA, deals: 812 } };
  return { status: 500, body: {} };
});
html = await res.text();
check("אינדקס: רק יישוב לאינדקס", html.includes('href="/deals/afula"')
  && !html.includes('href="/deals/migdal-haemek"')
  && !html.includes("kfar-katan")
  && !html.includes('href="/deals/abn-shmval"'));
check("אינדקס: canonical נשאר /deals", html.includes('<link rel="canonical" href="https://shuknadlan.co.il/deals">'));
check("אינדקס: ‏BreadcrumbList", ldOf(html)?.["@graph"]?.[0]?.["@type"] === "BreadcrumbList");
check("אינדקס מוצלח: מטמון CDN", (res.headers.get("Netlify-CDN-Cache-Control") || "").includes("max-age=3600"));
check("אינדקס: Netlify-Vary במפתח דמה", res.headers.get("Netlify-Vary") === "query=_");

/* כשל בסינון: לא מציגים יישוב לא מאומת. יש עותק - הוא יוצא, והכשל לא נשמר. */
res = await runRouted("https://shuknadlan.co.il/deals", (target) => {
  if (target.includes("deal_settlements_public")) return { status: 200, body: INDEX };
  if (target.includes("/properties?")) return { status: 500, body: {} };
  return { status: 500, body: {} };
});
html = await res.text();
check("אינדקס בכשל מודעות: העותק הקודם, בלי מגדל העמק",
  html.includes('href="/deals/afula"') && !html.includes('href="/deals/migdal-haemek"') && !html.includes("kfar-katan"));
check("עותק אינדקס: no-store, לא שעה", res.headers.get("Cache-Control") === "no-store"
  && res.headers.get("Netlify-CDN-Cache-Control") === "no-store"
  && !(res.headers.get("Netlify-CDN-Cache-Control") || "").includes("max-age=3600"));

resetLastGood();
res = await runRouted("https://shuknadlan.co.il/deals", (target) => {
  if (target.includes("deal_settlements_public")) return { status: 200, body: INDEX };
  if (target.includes("/properties?")) return { status: 500, body: {} };
  return { status: 500, body: {} };
});
html = await res.text();
check("בלי עותק: אין קישור לא מאומת", !html.includes('href="/deals/') && res.status === 200);
check("בלי עותק: no-store", res.headers.get("Cache-Control") === "no-store"
  && res.headers.get("Netlify-CDN-Cache-Control") === "no-store");

res = await runRouted("https://shuknadlan.co.il/deals", (target) => {
  if (target.includes("deal_settlements_public")) return { status: 200, body: INDEX };
  if (target.includes("/properties?")) return { status: 200, body: [{ city: "עפולה", city_id: "c1" }] };
  if (target.includes("market_cities_public")) return { status: 200, body: [{ city_id: "c1", market_slug: "afula-emek" }] };
  if (target.includes("deal_settlement_page")) return { status: 500, body: {} };
  return { status: 500, body: {} };
});
html = await res.text();
check("חלון עסקאות שנכשל: אין קישור, ולא נשמר", !html.includes('href="/deals/afula"')
  && res.headers.get("Cache-Control") === "no-store");

/* אינדקס, המסד נכשל - לא מפרסמים 200 בלי הרשימה, כשאין עותק */
resetLastGood();
res = await run("https://shuknadlan.co.il/deals", 500, { message: "down" });
html = await res.text();
check("אינדקס בכשל: 503 בלי noindex", res.status === 503 && !html.includes("noindex"));
check("אינדקס בכשל: no-store", res.headers.get("Cache-Control") === "no-store"
  && res.headers.get("Netlify-CDN-Cache-Control") === "no-store");

/* אינדקס ריק הוא תשובה, לא כשל */
res = await run("https://shuknadlan.co.il/deals", 200, []);
html = await res.text();
check("אינדקס ריק: 200 בלי מילוי", res.status === 200 && !html.includes("data-ssr"));

resetLastGood();
const goodDeal = await run("https://shuknadlan.co.il/deals/afula", 200, AFULA);
const goodDealHtml = await goodDeal.text();
const staleDeal = await run("https://shuknadlan.co.il/deals/afula", 500, { message: "down" });
const staleDealHtml = await staleDeal.text();
check("אחרי הצלחה, כשל מגיש את אותו דף", staleDeal.status === 200 && staleDealHtml === goodDealHtml && staleDealHtml.includes("data-ssr"));
check("העותק בלי Retry-After", !staleDeal.headers.get("Retry-After") && !staleDealHtml.includes("noindex"));
check("עותק יישוב: no-store בשתי הכותרות", staleDeal.headers.get("Cache-Control") === "no-store"
  && staleDeal.headers.get("Netlify-CDN-Cache-Control") === "no-store");

res = await runRouted("https://shuknadlan.co.il/deals/afula", (target) => {
  if (target.includes("neighborhood_pages_public")) {
    return { status: 200, body: [
      { name: "גבעת המורה", city: "עפולה", path_key: "afula/גבעת-המורה", props: 6 },
      { name: "בלי מודעות", city: "עפולה", path_key: "afula/בלי", props: 0 },
    ] };
  }
  return { status: 200, body: AFULA };
});
html = await res.text();
check("שכונה בעסקאות מקושרת ל-/n/", html.includes('href="/n/afula/' + encodeURIComponent("גבעת-המורה") + '">גבעת המורה</a>'));
check("שכונה בלי מודעות אינה קישור", !html.includes("/n/afula/" + encodeURIComponent("בלי")));

/* פרטיות: אין מספר בית ואין גוש/חלקה בשום מקום ב-render */
const D = (globalThis as any).ShukDeals;
const rendered = D.renderSettlement({ ...AFULA, recent: [{ ...AFULA.recent[0], house_number: "12", gush: "17014" }] });
check("פרטיות: בלי מספר בית וגוש", !rendered.includes("17014") && !/הנביאים 12/.test(rendered));

if (failed) {
  console.error(`\n${failed} בדיקות נכשלו`);
  process.exit(1);
}
console.log("\n✓ deals-page.ts");
