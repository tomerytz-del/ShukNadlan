/* ============================================================================
   ‏הבדיקה של netlify/edge-functions/neighborhood-page.ts
   ----------------------------------------------------------------------------
   מריצה את הפונקציה על `neighborhood.html` עצמו, ומוודאת:

     ‏· שכונה, המסד ענה  → כותרת, H1, כרטיסים, נכסים, ‏data-ssr, ‏JSON-LD ו-canonical
       מקודד מהכתובת.
     ‏· שכונה, המסד נכשל → 503, canonical של השכונה בכל זאת, בלי noindex, no-store.
     ‏· שכונה שאינה קיימת (המסד ענה null) → ‏404 ו-noindex, בלי מטמון.
     ‏· דף דל (בלי נכסים ומתחת ל-5 עסקאות) → ‏200, ‏noindex, אבל ממולא.
     ‏· כתובת לא תקינה → 404 ו-noindex, בלי קריאה למסד.
     ‏· שם עם ‎</script>‎ אינו סוגר תגית; תמונה מכתובת זרה אינה נכנסת.

   הרצה:

       node --experimental-strip-types scripts/neighborhood_page_test.ts

   התיעוד: ‎docs/neighborhood-pages.md‎.
   ========================================================================== */

import { readFileSync } from "node:fs";
import handler from "../netlify/edge-functions/neighborhood-page.ts";

const PAGE = readFileSync(new URL("../neighborhood.html", import.meta.url), "utf8");

const context = () =>
  ({
    next: async () => new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } }),
  }) as never;

const HOOD = {
  name: "גבעת המורה",
  slug: "גבעת-המורה",
  city: "עפולה",
  city_slug: "afula",
  market_slug: "afula-emek",
  props_active: 5, props_sale: 4, props_rent: 1,
  sale_min: 1200000, sale_max: 2100000,
  props: [
    { id: "p1", title: "4 חדרים </script><b>x", property_type: "דירה", deal_type: "sale", price: 1500000, rooms: 4, size_sqm: 105,
      image: "https://obookujgolazrwycsiyn.supabase.co/storage/v1/object/public/property-images/a.jpg" },
    { id: "p2", title: "דירה", property_type: "דירה", deal_type: "rent", price: 4200, rooms: 3, size_sqm: 80,
      image: "https://evil.example/x.jpg" },
    { id: "p3", title: "דירה שניה", property_type: "דירה", deal_type: "sale", price: 1600000, rooms: 3, size_sqm: 90,
      image: "https://obookujgolazrwycsiyn.supabase.co/storage/v1/object/public/property-images/b.jpg" },
  ],
  deals: 151, period_start: "2024-09-01", period_end: "2026-08-31",
  median_price: 1430000, median_ppsqm: 13600,
  by_rooms: [{ rooms: 4, deals: 60, median_price: 1450000, median_ppsqm: 13500 }, { rooms: 6, deals: 3, median_price: null, median_ppsqm: null }],
  siblings: [{ name: "מרכז העיר", slug: "מרכז-העיר" }],
  about: { intro: "פסקה ראשונה על השכונה, עם מספיק מילים כדי להיות פסקה.\n\nפסקה שנייה </script>", fits: "למשפחות",
    faq: [{ q: "כמה עולה דירת 4 חדרים?", a: "החציון הוא 1,450,000 ש\"ח." }] },
};

const URL_HOOD = "https://shuknadlan.co.il/n/afula/" + encodeURIComponent("גבעת-המורה");
const CANON = "https://shuknadlan.co.il/n/afula/" + encodeURIComponent("גבעת-המורה");

let calls = 0;
async function run(url: string, status: number, body: unknown): Promise<Response> {
  calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return await handler(new Request(url), context());
}

let failed = 0;
function check(name: string, ok: boolean) {
  if (!ok) failed++;
  console.log((ok ? "✓ " : "✗ ") + name);
}

{
  const res = await run(URL_HOOD, 200, HOOD);
  const html = await res.text();
  check("כותרת", html.includes("<title>שכונת גבעת המורה, עפולה"));
  check("H1", html.includes('<h1 id="dealsH1">שכונת גבעת המורה, עפולה</h1>'));
  check("ממולא בשרת", html.includes('data-ssr="1"') && html.includes("נכסים בשכונה"));
  check("canonical מקודד מהכתובת", html.includes(`<link rel="canonical" href="${CANON}">`));
  check("JSON-LD", html.includes('"@type":"Place"'));
  check("בלי noindex", !html.includes("noindex"));
  check("200 ומטמון", res.status === 200 && (res.headers.get("Netlify-CDN-Cache-Control") || "").includes("max-age=3600"));
  check("שם עם </script> מוברח", !html.includes("</script><b>x"));
  check("תמונה זרה לא נכנסת", !html.includes("evil.example"));
  const imgs = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  const first = imgs.find((t) => t.includes("property-images/a.jpg"));
  const second = imgs.find((t) => t.includes("property-images/b.jpg"));
  check("כרטיס ראשון eager ובגודל התא", !!first && first.includes('fetchpriority="high"')
    && first.includes("/render/image/") && first.includes("width=800") && !first.includes('loading="lazy"'));
  check("שאר הכרטיסים lazy", !!second && second.includes('loading="lazy"') && !second.includes("fetchpriority"));
  check("preload לתמונה הראשונה", html.includes('rel="preload" as="image"')
    && html.includes("/render/image/public/property-images/a.jpg"));
  check("תיאור מאושר: פסקאות ושאלות", html.includes("<p>פסקה ראשונה") && html.includes("<h3>כמה עולה דירת 4 חדרים?</h3>"));
  check("FAQPage ב-JSON-LD", html.includes('"@type":"FAQPage"'));
  check("קישור לשכונה סמוכה", html.includes("/n/afula/" + encodeURIComponent("מרכז-העיר")));
}
{
  const res = await run(URL_HOOD, 500, {});
  const html = await res.text();
  check("כשל מסד: canonical בכל זאת", html.includes(`<link rel="canonical" href="${CANON}">`));
  check("כשל מסד: 503 בלי noindex", res.status === 503 && !html.includes("noindex"));
  check("כשל מסד: no-store ו-Retry-After", res.headers.get("Cache-Control") === "no-store"
    && res.headers.get("Netlify-CDN-Cache-Control") === "no-store"
    && res.headers.get("Retry-After") === "60");
}
{
  const res = await run(URL_HOOD, 200, null);
  const html = await res.text();
  check("שכונה שאינה קיימת: 404 ו-noindex", res.status === 404 && html.includes("noindex"));
  check("שכונה שאינה קיימת: no-store בלי Retry-After", res.headers.get("Cache-Control") === "no-store"
    && res.headers.get("Netlify-CDN-Cache-Control") === "no-store"
    && !res.headers.get("Retry-After"));
}
{
  const res = await run(URL_HOOD, 200, "לא אובייקט");
  const html = await res.text();
  check("תשובה שאינה אובייקט: 503 בלי noindex", res.status === 503 && !html.includes("noindex"));
}
{
  const thin = { ...HOOD, props_active: 0, props: [], deals: 3, median_price: null, median_ppsqm: null };
  const res = await run(URL_HOOD, 200, thin);
  const html = await res.text();
  check("דף דל: 200, ממולא ו-noindex", res.status === 200 && html.includes('data-ssr="1"') && html.includes("noindex"));
  check("דף דל: נשמר במטמון", (res.headers.get("Netlify-CDN-Cache-Control") || "").includes("max-age=3600"));
}
{
  const res = await run("https://shuknadlan.co.il/n/afula/<x>", 200, HOOD);
  const html = await res.text();
  check("כתובת לא תקינה: 404 ו-noindex בלי מסד", res.status === 404 && html.includes("noindex") && calls === 0);
  check("כתובת לא תקינה: no-store", res.headers.get("Cache-Control") === "no-store");
}

if (failed) {
  console.error(`\n${failed} בדיקות נכשלו`);
  process.exit(1);
}
console.log("\n✓ neighborhood-page.ts");
