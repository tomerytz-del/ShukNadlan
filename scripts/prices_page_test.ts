/* ============================================================================
   ‏הבדיקה של netlify/edge-functions/prices-page.ts
   ----------------------------------------------------------------------------
   ‏/prices שווה משהו לסורק רק אם המספרים יושבים ב-HTML שהשרת מגיש. הבדיקה
   מריצה את הפונקציה על `prices.html` עצמו, ומוודאת:

     ‏· המסד ענה  → הטבלאות בדף, ‏data-ssr, התקופה ו-Dataset ב-JSON-LD.
     ‏· המסד נכשל בלי עותק קודם → 503 עם אותו HTML (ה-JS ממלא), ‏no-store ו-Retry-After.
     ‏· המסד נכשל אחרי דף שמולא → 200 עם אותו HTML.
     ‏· המסד ענה מערך ריק → 200 והדף כמו שהוא.
     ‏· שם עיר עם ‎</script>‎ אינו סוגר תגית ואינו נכנס לטבלה כ-HTML.

   הרצה:

       node --experimental-strip-types scripts/prices_page_test.ts

   התיעוד: ‎docs/city-prices.md‎.
   ========================================================================== */

import { readFileSync } from "node:fs";
import handler from "../netlify/edge-functions/prices-page.ts";
import { resetLastGood } from "../netlify/edge-functions/lib/last-good.ts";

const PAGE = readFileSync(new URL("../prices.html", import.meta.url), "utf8");

const context = () =>
  ({
    next: async () => new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } }),
  }) as never;

const ROWS = [
  { market_slug: "haifa", city: "חיפה", rooms: 3, deals: 547, median_price: 1200000, median_ppsqm: 19100, period_start: "2025-08-14", period_end: "2026-08-13" },
  { market_slug: "afula-emek", city: "עפולה", rooms: 4, deals: 534, median_price: 1438000, median_ppsqm: 13600, period_start: "2025-08-14", period_end: "2026-08-13" },
  { market_slug: "afula-emek", city: "עפולה", rooms: 3, deals: 259, median_price: 920000, median_ppsqm: 13500, period_start: "2025-08-14", period_end: "2026-08-13" },
  { market_slug: "afula-emek", city: "כפר</script>תבור", rooms: 6, deals: 8, median_price: 3815000, median_ppsqm: 20800, period_start: "2025-08-14", period_end: "2026-08-13" },
];

async function run(status: number, body: unknown): Promise<Response> {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
  ) as typeof fetch;
  return await handler(new Request("https://shuknadlan.co.il/prices"), context());
}

let failed = 0;
function check(name: string, ok: boolean) {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}`);
}

const okRes = await run(200, ROWS);
const html = await okRes.text();
check("תשובה תקינה: 200", okRes.status === 200);
const ldMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
let ld: Record<string, any> | null = null;
try { ld = ldMatch ? JSON.parse(ldMatch[1]) : null; } catch { ld = null; }

check("הטבלאות מולאו בשרת (‏data-ssr)", /<div id="pricesTables" data-ssr="1">/.test(html));
check("המחיר החציוני בדף", html.includes("₪1,438,000") && html.includes("₪13,600"));
check("עפולה לפני חיפה (סדר השווקים)", html.indexOf("מחירי דירות בעפולה") < html.indexOf("מחירי דירות בחיפה"));
check("‏3 חדרים לפני 4 בתוך העיר", html.indexOf("<th scope=\"row\">3 חדרים") < html.indexOf("<th scope=\"row\">4 חדרים"));
check("שם השוק ככותרת", /<h2 class="prices-market">חיפה[^<]*<\/h2>/.test(html));
check("התקופה בדף", /<span id="pricesPeriod">14\.8\.2025 - 13\.8\.2026<\/span>/.test(html));
check("‏Dataset ב-JSON-LD עם תקופה", ld?.["@type"] === "Dataset" && ld?.temporalCoverage === "2025-08-14/2026-08-13");
check("שם עיר מוברח בטבלה", html.includes("כפר&lt;/script&gt;תבור") && !html.includes("<h3>מחירי דירות בכפר</script>"));
check("‏</script> בשם עיר אינו סוגר את ה-JSON-LD", (html.match(/<\/script>/g) || []).length === (PAGE.match(/<\/script>/g) || []).length + 1);
check("טקסט הטעינה הוחלף", !html.includes("טוען את הנתונים..."));

resetLastGood();
const failRes = await run(500, {});
check("מסד נכשל (‏500): 503 ואותו HTML", failRes.status === 503 && (await failRes.text()) === PAGE);
check("מסד נכשל: no-store ו-Retry-After", failRes.headers.get("Cache-Control") === "no-store"
  && failRes.headers.get("Netlify-CDN-Cache-Control") === "no-store"
  && failRes.headers.get("Retry-After") === "60");
const oddRes = await run(200, { message: "not-an-array" });
check("תשובה שאינה מערך: 503", oddRes.status === 503 && (await oddRes.text()) === PAGE);
const emptyRes = await run(200, []);
check("מסד ענה ריק: 200 והדף כמו שהוא", emptyRes.status === 200 && (await emptyRes.text()) === PAGE);

resetLastGood();
const again = await run(200, ROWS);
const againHtml = await again.text();
const stale = await run(500, {});
check("אחרי הצלחה, כשל מגיש את אותו דף", stale.status === 200 && (await stale.text()) === againHtml && againHtml === html);
check("העותק בלי Retry-After", !stale.headers.get("Retry-After")
  && (stale.headers.get("Netlify-CDN-Cache-Control") || "").includes("max-age=3600"));

if (failed) {
  console.error(`\n✗ ${failed} מקרים התנהגו אחרת.`);
  process.exit(1);
}
console.log("\n✓ ‏/prices: הטבלאות בשרת, כשל הוא 503, ומערך ריק נשאר 200.");
