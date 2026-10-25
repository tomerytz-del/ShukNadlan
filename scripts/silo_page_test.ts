/* ============================================================================
   הבדיקה של netlify/edge-functions/silo-page.ts
   ----------------------------------------------------------------------------
   מריצה את הפונקציה על silo.html, ומוודאת:

     · יש מודעות → כותרת, H1, כרטיסים, קישורים, data-ssr, JSON-LD ו-canonical
       מהכתובת.
     · המסד נכשל → 503, canonical בכל זאת, בלי noindex, no-store ו-Retry-After.
     · מערך ריק → 200 ו-noindex, לא 503.
     · כתובת שאינה אחד משלושת הדפים → 404 ו-noindex, בלי קריאה למסד.
     · כותרת עם </script> אינה סוגרת תגית; תמונה מכתובת זרה אינה נכנסת.
     · WebPage, BreadcrumbList ו-ItemList נפרסים.

   הרצה:

       node --experimental-strip-types scripts/silo_page_test.ts
   ========================================================================== */

import { readFileSync } from "node:fs";
import handler from "../netlify/edge-functions/silo-page.ts";

const PAGE = readFileSync(new URL("../silo.html", import.meta.url), "utf8");
const SITE = "https://shuknadlan.co.il";
const PATH = "/afula/" + encodeURIComponent("בתים-פרטיים");
const CANON = SITE + "/afula/בתים-פרטיים";

const context = () =>
  ({
    next: async () => new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } }),
  }) as never;

const RECENT = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
const ROWS = [
  {
    id: "p1",
    title: "קוטג' </script><b>x",
    property_type: "בית פרטי/קוטג'",
    deal_type: "sale",
    price: 2500000,
    rooms: 5,
    size_sqm: 180,
    city: "עפולה",
    features: ["price_dropped"],
    neighborhoods: { name: "גבעת המורה" },
    created_at: "2020-01-01T00:00:00.000Z",
    updated_at: RECENT,
    images: ["https://obookujgolazrwycsiyn.supabase.co/storage/v1/object/public/property-images/a.jpg"],
  },
  {
    id: "p2",
    title: "בית",
    property_type: "בית פרטי/קוטג'",
    deal_type: "sale",
    price: 1800000,
    rooms: 4,
    size_sqm: 140,
    city: "עפולה",
    created_at: RECENT,
    updated_at: RECENT,
    images: ["https://evil.example/x.jpg"],
  },
];

let calls = 0;
async function run(url: string, status: number, body: unknown, page = PAGE): Promise<Response> {
  calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const ctx = {
    next: async () => new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } }),
  } as never;
  return await handler(new Request(url), ctx);
}

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log((ok ? "✓ " : "✗ ") + name + (ok ? "" : "  " + detail));
}

function ldBlocks(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    out.push(JSON.parse(m[1]));
  }
  return out;
}

{
  const res = await run(SITE + PATH, 200, ROWS);
  const html = await res.text();
  const blocks = ldBlocks(html);
  const types = blocks.map((b) => b["@type"]);
  const crumbs = blocks.find((b) => b["@type"] === "BreadcrumbList") as { itemListElement: { position: number; name: string; item: string }[] } | undefined;
  const list = blocks.find((b) => b["@type"] === "ItemList") as { numberOfItems: number; itemListElement: { position: number; url: string }[] } | undefined;
  const web = blocks.find((b) => b["@type"] === "WebPage") as { url?: string; name?: string } | undefined;
  check("200", res.status === 200);
  check("כותרת", html.includes("<title>בתים פרטיים למכירה בעפולה | שוק נדל״ן</title>"));
  check("H1", html.includes("<h1 id=\"siloH1\">בתים פרטיים למכירה בעפולה</h1>"));
  check("ממולא", html.includes('data-ssr="1"') && html.includes("מודעות פעילות"));
  check("canonical מהכתובת", html.includes(`<link rel="canonical" href="${CANON}">`));
  check("קישורי אזור", html.includes('href="/deals/afula"') && html.includes('href="/prices"') && html.includes('href="/"'));
  check("שכונה", html.includes("/n/afula/" + encodeURIComponent("גבעת-המורה")));
  check("תמונה זרה בחוץ", !html.includes("evil.example"));
  check("script לא נשבר", !html.includes("</script><b>"));
  check("מקום לתמונה", html.includes('width="320"') && html.includes('height="200"'));
  check("שלושה סוגים", types.includes("WebPage") && types.includes("BreadcrumbList") && types.includes("ItemList"), types.join(","));
  check("WebPage.url", web?.url === CANON && web?.name === "בתים פרטיים למכירה בעפולה");
  check("פירורי לחם", !!crumbs && crumbs.itemListElement.length === 3
    && crumbs.itemListElement.every((x, i) => x.position === i + 1 && !!x.item && !!x.name));
  check("ItemList", !!list && list.numberOfItems === 2 && list.itemListElement[0].position === 1
    && list.itemListElement[0].url === SITE + "/property?id=p1");
  check("מטמון", (res.headers.get("Cache-Control") || "").includes("must-revalidate"));
  check("FAQ", types.includes("FAQPage") && (html.match(/<details>/g) || []).length >= 4);
  check("פירור גלוי", html.includes('aria-label="מיקום בדף"') && html.includes(">דף הבית</a>") && html.includes(">עפולה</a>"));
  check("התראה", html.includes("קבלו התראה") && html.includes("data-land-alert"));
  check("בלי שמירה", !html.includes("land-save") && !html.includes("שמור נכס"));
  check("תג ירד מחיר", html.includes('class="land-badge">ירד מחיר'));
  check("תג חדש", html.includes('class="land-badge">חדש'));
  check("מחיר ב-bdi", html.includes("<bdi>₪2,500,000</bdi>") && html.includes("מחיר חציוני"));
  check("רווח בחדרים", html.includes('<bdi>3</bdi><span class="land-sp"> </span>חדרים'));
  check("גיבור מהמודעה עם תמונה", html.includes("property-images/a.jpg") && html.includes('fetchpriority="high"'));
  check("שכונה בכרטיס", html.includes("גבעת המורה"));
  check("H1 לא הוכפל", html.split("<h1").length === 2);
}

{
  const newer = {
    id: "p-new",
    title: "בית חדש",
    property_type: "בית פרטי/קוטג'",
    deal_type: "sale",
    price: 2100000,
    rooms: 5,
    size_sqm: 160,
    city: "עפולה",
    created_at: new Date().toISOString(),
    images: ["https://obookujgolazrwycsiyn.supabase.co/storage/v1/object/public/property-images/new-house.jpg"],
  };
  const res = await run(SITE + PATH, 200, [ROWS[0], newer]);
  const html = await res.text();
  const hero = (html.split('id="landHeroBg"')[1] || "").split("land-hero-overlay")[0];
  check("גיבור מהמודעה החדשה", hero.includes("new-house.jpg") && !hero.includes("property-images/a.jpg"));
}

{
  const res = await run(SITE + PATH, 500, { message: "no" });
  const html = await res.text();
  check("כשל הוא 503", res.status === 503 && calls === 1);
  check("בלי noindex על כשל", !/noindex/.test(html));
  check("canonical נשאר", html.includes(`<link rel="canonical" href="${CANON}">`));
  check("no-store", res.headers.get("Cache-Control") === "no-store"
    && res.headers.get("Netlify-CDN-Cache-Control") === "no-store");
  check("Retry-After", res.headers.get("Retry-After") === "60");
}

{
  const res = await run(SITE + PATH, 200, []);
  const html = await res.text();
  check("רשימה ריקה היא 200", res.status === 200);
  check("noindex רק כשריק", /noindex/.test(html));
  check("ריק בלי Retry-After", res.headers.get("Retry-After") == null);
  check("ריק אינו נשמר", res.headers.get("Cache-Control") === "no-store");
  check("ריק עם התראה במקום גריד", html.includes("אין כרגע מודעות פעילות") && html.includes("data-land-alert") && !html.includes('class="land-grid"'));
}

{
  const res = await run(SITE + "/silo", 200, ROWS);
  const html = await res.text();
  check("נתיב בלי סוג הוא 404", res.status === 404 && calls === 0);
  check("404 עם noindex", /noindex/.test(html));
  check("404 בלי Retry-After", res.headers.get("Retry-After") == null);
}

{
  const marker = "<!--other-page-->";
  const res = await run(SITE + "/afula/" + encodeURIComponent("מתווכים"), 200, ROWS, marker);
  const html = await res.text();
  check("נתיב /afula אחר עובר הלאה, בלי 404 ובלי noindex", res.status === 200 && html.includes(marker) && !/noindex/.test(html) && calls === 0);
}

{
  const res = await run(SITE + "/afula/" + encodeURIComponent("דירות-גן"), 200, ROWS);
  const html = await res.text();
  check("דירות גן", res.status === 200 && html.includes("דירות גן למכירה בעפולה")
    && html.includes('href="https://shuknadlan.co.il/afula/דירות-גן"'));
}

if (failed) {
  console.error(`\n✗ ${failed} מקרים התנהגו אחרת.`);
  process.exit(1);
}
console.log("\n✓ דפי הנחיתה: מודעות, canonical, 503 בלי noindex, ו-JSON-LD.");
