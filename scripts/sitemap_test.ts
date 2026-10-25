/* ============================================================================
   הבדיקה של netlify/edge-functions/sitemap.ts
   ----------------------------------------------------------------------------
   בלוק העסקאות לפי יישוב אסור לו להיעלם בשקט. הבדיקה מריצה את הפונקציה
   על sitemap סטטי קטן, ומוודאת:

     · RPC ענה בשורות → 200, ויש /deals/ לצד שאר הכתובות.
     · RPC ענה [] → 200. מערך ריק אינו כשל, גם כשיש כתובות אחרות.
     · RPC נכשל (500, זריקה, גוף שאינו מערך) ויש כתובות ממקור אחר →
       503, no-store, Retry-After. אסור 200 שבו שאר הבלוקים מלאים
       ובלוק העסקאות ריק.
     · כל המקורות נכשלו → הקובץ הסטטי, 200.
     · מקור GET שנכשל עדיין מושמט בשקט, כל עוד העסקאות הגיעו.
     · הקריאה לעסקאות היא POST, וה-timeout שלה הוא 8 שניות.

   הרצה:

       node --experimental-strip-types scripts/sitemap_test.ts
   ========================================================================== */

import { readFileSync } from "node:fs";
import handler from "../netlify/edge-functions/sitemap.ts";

const STATIC =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  `  <url><loc>https://shuknadlan.co.il/</loc></url>\n` +
  `</urlset>\n`;

const context = () =>
  ({
    next: async () => new Response(STATIC, { headers: { "content-type": "application/xml" } }),
  }) as never;

type Deals = { status: number; body: unknown } | "throw";

function install(deals: Deals, properties: { status: number; body: unknown }) {
  const calls: { url: string; method: string; body: string }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({ url, method, body });
    if (url.includes("rpc/deal_settlements_public")) {
      if (deals === "throw") throw new Error("timeout");
      return new Response(JSON.stringify(deals.body), {
        status: deals.status,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("market_cities_public")) {
      return new Response(JSON.stringify([{ city_id: "c1", market_slug: "afula-emek" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/agencies?") && url.includes("limit=1")) {
      return new Response(JSON.stringify([{ slug: "adel", updated_at: "2026-10-09T08:00:00Z" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/properties?")) {
      return new Response(JSON.stringify(properties.body), {
        status: properties.status,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return calls;
}

const PROP = {
  status: 200,
  body: [{
    id: "p1",
    updated_at: "2026-10-09T08:00:00Z",
    city: "עפולה",
    city_id: "c1",
    deal_type: "sale",
    category: "residential",
    property_type: "דירה",
    rooms: 4,
  }],
};
const DEALS_ROW = {
  status: 200,
  body: [{ slug: "afula", name: "עפולה", deals: 10, updated_at: "2026-10-09T08:00:00Z" }],
};
const NONE = { status: 500, body: {} };

async function run(deals: Deals, properties = PROP): Promise<{ res: Response; html: string; calls: ReturnType<typeof install> }> {
  const calls = install(deals, properties);
  const res = await handler(new Request("https://shuknadlan.co.il/sitemap.xml"), context());
  return { res, html: await res.text(), calls };
}

let failed = 0;
function check(name: string, ok: boolean) {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}`);
}

/* 200 שמכיל כתובות ממקור אחר ובלי אף /deals/ הוא בדיוק ההשמטה השקטה. */
function droppedDeals(status: number, html: string): boolean {
  return status === 200 && html.includes("property?id=p1") && !html.includes("/deals/");
}

const ok = await run(DEALS_ROW);
check("עסקאות ונכס ב-200", ok.res.status === 200 && ok.html.includes("/deals/afula") && ok.html.includes("property?id=p1"));
check("הקריאה היא POST עם גוף ריק", ok.calls.some((c) =>
  c.url.includes("rpc/deal_settlements_public") && c.method === "POST" && c.body === "{}"));
check("מטמון של הצלחה", ok.res.headers.get("Cache-Control") === "public, max-age=0, must-revalidate"
  && (ok.res.headers.get("Netlify-CDN-Cache-Control") || "").includes("max-age=3600"));
check("הספירה כוללת את היישוב", ok.html.includes("עסקאות לפי יישוב: 1"));

const empty = await run({ status: 200, body: [] });
check("מערך ריק נשאר 200 עם שאר הכתובות", empty.res.status === 200
  && empty.html.includes("property?id=p1") && !empty.html.includes("/deals/")
  && empty.html.includes("עסקאות לפי יישוב: 0"));

for (const [name, deals] of [
  ["RPC 500", { status: 500, body: {} }],
  ["RPC זורק", "throw"],
  ["גוף שאינו מערך", { status: 200, body: { deals: 1 } }],
] as [string, Deals][]) {
  const got = await run(deals);
  check(`${name}: 503 ולא 200 בלי הבלוק`, got.res.status === 503 && !droppedDeals(got.res.status, got.html)
    && !got.html.includes("property?id=p1") && !got.html.includes("/deals/"));
  check(`${name}: no-store ו-Retry-After`, got.res.headers.get("Cache-Control") === "no-store"
    && got.res.headers.get("Netlify-CDN-Cache-Control") === "no-store"
    && got.res.headers.get("Retry-After") === "60");
}

const allDown = await run({ status: 500, body: {} }, NONE);
check("כל המקורות נכשלו: הקובץ הסטטי", allDown.res.status === 200 && allDown.html === STATIC);

const dealsOnly = await run(DEALS_ROW, NONE);
check("מקור GET שנכשל מושמט, העסקאות נשארות", dealsOnly.res.status === 200
  && dealsOnly.html.includes("/deals/afula") && !dealsOnly.html.includes("property?id="));

globalThis.fetch = (async () => {
  throw new Error("לא הייתה צריכה לצאת קריאה");
}) as typeof fetch;
const missing = await handler(new Request("https://shuknadlan.co.il/sitemap.xml"), {
  next: async () => new Response("nope", { status: 404 }),
} as never);
check("קובץ סטטי חסר יוצא כמו שהוא", missing.status === 404 && await missing.text() === "nope");

const WITH_EXTRA =
  STATIC.replace("</urlset>",
    `  <url><loc>https://shuknadlan.co.il/?deal=sale&amp;rooms=3</loc></url>\n` +
    `  <url><loc>https://shuknadlan.co.il/afula/מתווכים</loc></url>\n` +
    `  <url><loc>https://shuknadlan.co.il/projects</loc></url>\n` +
    `</urlset>\n`);
install(DEALS_ROW, PROP);
const polished = await handler(new Request("https://shuknadlan.co.il/sitemap.xml"), {
  next: async () => new Response(WITH_EXTRA, { headers: { "content-type": "application/xml" } }),
} as never);
const polishedHtml = await polished.text();
check("סינון שה-canonical שלו במקום אחר יורד", polished.status === 200 && !polishedHtml.includes("rooms=3"));
check("נתיב עברי מקודד", polishedHtml.includes("/afula/%D7%9E%D7%AA%D7%95%D7%95%D7%9B%D7%99%D7%9D"));
check("lastmod למתווכים", /afula\/%D7%9E%D7%AA%D7%95%D7%95%D7%9B%D7%99%D7%9D<\/loc>\s*<lastmod>2026-10-09<\/lastmod>/.test(polishedHtml));
check("פרויקטים נשארים גם כשהרשימה ריקה", polishedHtml.includes("https://shuknadlan.co.il/projects"));

const src = readFileSync(new URL("../netlify/edge-functions/sitemap.ts", import.meta.url), "utf8");
check("timeout העסקאות הוא 8 שניות", /const DEALS_FETCH_TIMEOUT_MS = 8000;/.test(src));

if (failed) {
  console.error(`\n✗ ${failed} בדיקות נכשלו.`);
  process.exit(1);
}
console.log("\n✓ sitemap: בלוק העסקאות אינו נשמט בשקט.");
