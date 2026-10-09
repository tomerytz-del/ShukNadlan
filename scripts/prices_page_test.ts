/* ============================================================================
   ‏הבדיקה של netlify/edge-functions/prices-page.ts
   ----------------------------------------------------------------------------
   ‏/prices שווה משהו לסורק רק אם המספרים יושבים ב-HTML שהשרת מגיש. הבדיקה
   מריצה את הפונקציה על `prices.html` עצמו, ומוודאת:

     ‏· המסד ענה  → הטבלאות בדף, ‏data-ssr, התקופה ו-Dataset ב-JSON-LD.
     ‏· המסד נכשל או ריק → הדף יוצא כמו שהוא, וה-JS שבו ימלא אותו.
     ‏· שם עיר עם ‎</script>‎ אינו סוגר תגית ואינו נכנס לטבלה כ-HTML.

   הרצה:

       node --experimental-strip-types scripts/prices_page_test.ts

   התיעוד: ‎docs/city-prices.md‎.
   ========================================================================== */

import { readFileSync } from "node:fs";
import handler from "../netlify/edge-functions/prices-page.ts";

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

async function run(status: number, body: unknown): Promise<string> {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
  ) as typeof fetch;
  const res = await handler(new Request("https://shuknadlan.co.il/prices"), context());
  return await res.text();
}

let failed = 0;
function check(name: string, ok: boolean) {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}`);
}

const html = await run(200, ROWS);
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

check("מסד נכשל (‏500): הדף כמו שהוא", (await run(500, {})) === PAGE);
check("מסד ענה ריק: הדף כמו שהוא", (await run(200, [])) === PAGE);

if (failed) {
  console.error(`\n✗ ${failed} מקרים התנהגו אחרת.`);
  process.exit(1);
}
console.log("\n✓ ‏/prices: הטבלאות בשרת, ובכל כשל הדף יוצא כמו שהוא.");
