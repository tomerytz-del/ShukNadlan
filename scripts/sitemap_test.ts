/* ============================================================================
   הבדיקה של netlify/edge-functions/sitemap.ts
   ----------------------------------------------------------------------------
   בלוק העסקאות לפי יישוב אסור לו להיעלם בשקט. הבדיקה מריצה את הפונקציה
   על sitemap סטטי קטן, ומוודאת:

     · RPC ענה בשורות → 200, ויש /deals/ לצד שאר הכתובות.
     · RPC ענה [] → 200. מערך ריק אינו כשל, גם כשיש כתובות אחרות.
     · RPC נכשל (500, זריקה, גוף שאינו מערך) ויש כתובות ממקור אחר,
       ואין עותק קודם → 503, no-store, Retry-After. אסור 200 חדש
       שבו שאר הבלוקים מלאים ובלוק העסקאות ריק.
     · אותה נפילה אחרי sitemap מלא שהצליח → 200 עם אותו גוף.
     · כל המקורות נכשלו → הקובץ הסטטי, 200.
     · מקור GET שנכשל עדיין מושמט בשקט, כל עוד העסקאות הגיעו.
     · הקריאה לעסקאות היא POST, וה-timeout שלה הוא 8 שניות.

   הרצה:

       node --experimental-strip-types scripts/sitemap_test.ts
   ========================================================================== */

import { readFileSync } from "node:fs";
import handler from "../netlify/edge-functions/sitemap.ts";
import { resetLastGood } from "../netlify/edge-functions/lib/last-good.ts";

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

resetLastGood();
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

resetLastGood();
const kept = await run(DEALS_ROW);
const keptHtml = kept.html;
const replay = await run({ status: 500, body: {} });
check("אחרי הצלחה, כשל העסקאות מגיש את אותו קובץ", replay.res.status === 200
  && replay.html === keptHtml && replay.html.includes("/deals/afula") && replay.html.includes("property?id=p1"));
check("העותק בלי Retry-After", !replay.res.headers.get("Retry-After")
  && replay.res.headers.get("Cache-Control") === "public, max-age=0, must-revalidate");

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
    `  <url><loc>https://shuknadlan.co.il/haifa/מתווכים</loc></url>\n` +
    `  <url><loc>https://shuknadlan.co.il/haifa/בתים-פרטיים</loc></url>\n` +
    `</urlset>\n`);
const polishedCalls = install(DEALS_ROW, PROP);
const polished = await handler(new Request("https://shuknadlan.co.il/sitemap.xml"), {
  next: async () => new Response(WITH_EXTRA, { headers: { "content-type": "application/xml" } }),
} as never);
const polishedHtml = await polished.text();
check("סינון שה-canonical שלו במקום אחר יורד", polished.status === 200 && !polishedHtml.includes("rooms=3"));
check("נתיב עברי מקודד", polishedHtml.includes("/afula/%D7%9E%D7%AA%D7%95%D7%95%D7%9B%D7%99%D7%9D"));
check("lastmod למתווכים", /afula\/%D7%9E%D7%AA%D7%95%D7%95%D7%9B%D7%99%D7%9D<\/loc>\s*<lastmod>2026-10-09<\/lastmod>/.test(polishedHtml));
check("פרויקטים נשארים גם כשהרשימה ריקה", polishedHtml.includes("https://shuknadlan.co.il/projects"));
check("דפי נחיתה של שוק לא חי יורדים", !polishedHtml.includes("/haifa/"));
check("שאילתת המשרדים לפי העיר", polishedCalls.some((c) => c.url.includes("/agencies?")
  && c.url.includes("city_id=eq.c2a8426f-7bac-4c48-bcb5-53a5ca06f001")));
check("מתווכי עפולה אינם משוכפלים", polishedHtml.split("/afula/%D7%9E%D7%AA%D7%95%D7%95%D7%9B%D7%99%D7%9D").length - 1 === 1);

/* ‏עיר מ-CITIES שאינה בקובץ: נכנסת רק כשהשוק חי ויש מלאי תואם.
   שוק שאינו חי נשאר בחוץ גם כשיש מודעה. רשימה ריקה נשארת בחוץ. */
type ExtraPage = {
  path: string;
  property_type: string | null;
  rooms: number | null;
  cityName: string;
  market: string;
};
const siloPages = (globalThis as unknown as { ShukSilo: { pages: ExtraPage[] } }).ShukSilo.pages;
const liveExtra: ExtraPage = {
  path: "/afula/דירות-4-חדרים",
  property_type: null,
  rooms: 4,
  cityName: "עפולה",
  market: "afula-emek",
};
const emptyExtra: ExtraPage = {
  path: "/afula/דירות-9-חדרים",
  property_type: null,
  rooms: 9,
  cityName: "עפולה",
  market: "afula-emek",
};
const hiddenExtra: ExtraPage = {
  path: "/haifa/דירות-4-חדרים",
  property_type: null,
  rooms: 4,
  cityName: "חיפה",
  market: "haifa",
};
const FOUR = "/afula/%D7%93%D7%99%D7%A8%D7%95%D7%AA-4-%D7%97%D7%93%D7%A8%D7%99%D7%9D";
const NINE = "%D7%93%D7%99%D7%A8%D7%95%D7%AA-9-%D7%97%D7%93%D7%A8%D7%99%D7%9D";
const withHaifa = {
  status: 200,
  body: [
    ...(PROP.body as Record<string, unknown>[]),
    {
      id: "p-haifa",
      updated_at: "2026-10-11T08:00:00Z",
      city: "חיפה",
      city_id: "c-haifa",
      deal_type: "sale",
      category: "residential",
      property_type: "דירה",
      rooms: 4,
    },
  ],
};
siloPages.push(liveExtra, emptyExtra, hiddenExtra);
try {
  const addedCalls = install(DEALS_ROW, withHaifa);
  const added = await handler(new Request("https://shuknadlan.co.il/sitemap.xml"), context());
  const addedHtml = await added.text();
  check("עיר חיה עם מודעות נכנסת פעם אחת ומקודדת", added.status === 200
    && addedHtml.split(FOUR).length - 1 === 1);
  check("lastmod של הנחיתה החדשה מהמודעה", new RegExp(`${FOUR}</loc>\\s*<lastmod>2026-10-09</lastmod>`).test(addedHtml));
  check("שורה חדשה בלי changefreq", !new RegExp(`${FOUR}[\\s\\S]{0,120}<changefreq>`).test(addedHtml));
  check("בלי מודעות תואמות לא נכנסת", !addedHtml.includes(NINE));
  check("שוק לא חי לא נכנס גם עם מודעות", !addedHtml.includes("/haifa/"));
  check("השאילתה עדיין רצה", addedCalls.some((c) => c.url.includes("/properties?")));

  const already =
    STATIC.replace("</urlset>",
      `  <url>\n    <loc>https://shuknadlan.co.il/afula/דירות-4-חדרים</loc>\n    <changefreq>daily</changefreq>\n    <priority>0.7</priority>\n  </url>\n</urlset>\n`);
  install(DEALS_ROW, withHaifa);
  const kept = await handler(new Request("https://shuknadlan.co.il/sitemap.xml"), {
    next: async () => new Response(already, { headers: { "content-type": "application/xml" } }),
  } as never);
  const keptHtml = await kept.text();
  check("כתובת קיימת אינה משוכפלת", keptHtml.split(FOUR).length - 1 === 1);
  check("בקיימת lastmod נכנס לפני changefreq", new RegExp(
    `${FOUR}</loc>\\s*<lastmod>2026-10-09</lastmod>\\s*<changefreq>daily</changefreq>\\s*<priority>0\\.7</priority>`,
  ).test(keptHtml));

  const unknown = await run(DEALS_ROW, NONE);
  check("כשל מודעות אינו מוסיף נחיתה חדשה", !unknown.html.includes(FOUR) && !unknown.html.includes(NINE));
} finally {
  const drop = new Set([liveExtra, emptyExtra, hiddenExtra]);
  for (let i = siloPages.length - 1; i >= 0; i--) if (drop.has(siloPages[i])) siloPages.splice(i, 1);
}

const EMEK = "/emek-yizrael/%D7%91%D7%AA%D7%99%D7%9D-%D7%95%D7%9E%D7%92%D7%A8%D7%A9%D7%99%D7%9D";
const valleyRows = {
  status: 200,
  body: [
    ...(PROP.body as Record<string, unknown>[]),
    {
      id: "p-oman",
      updated_at: "2026-10-12T08:00:00Z",
      city: "אומן",
      deal_type: "sale",
      category: "residential",
      property_type: "מגרש",
      rooms: null,
    },
    {
      id: "p-sde",
      updated_at: "2026-10-13T08:00:00Z",
      city: "שדה נחום",
      deal_type: "sale",
      category: "residential",
      property_type: "בית פרטי/קוטג'",
      rooms: 5,
    },
    {
      id: "p-nof",
      updated_at: "2026-10-12T08:00:00Z",
      city: "נוף הגליל",
      deal_type: "sale",
      category: "residential",
      property_type: "דירה",
      rooms: 4,
    },
  ],
};
install(DEALS_ROW, valleyRows);
const valley = await handler(new Request("https://shuknadlan.co.il/sitemap.xml"), context());
const valleyHtml = await valley.text();
check("עמוד עמק נכנס פעם אחת ומקודד", valley.status === 200 && valleyHtml.split(EMEK).length - 1 === 1);
check("lastmod של העמק מהמודעה התואמת", new RegExp(`${EMEK}</loc>\\s*<lastmod>2026-10-12</lastmod>`).test(valleyHtml));
check("שורה חדשה של העמק בלי changefreq", !new RegExp(`${EMEK}[\\s\\S]{0,160}<changefreq>`).test(valleyHtml));
check("נוף הגליל ומגדל העמק אינם ב-sitemap", !valleyHtml.includes("/nof-hagalil/") && !valleyHtml.includes("/migdal-haemek/"));

const sdeOnly = {
  status: 200,
  body: [{
    id: "p-sde",
    updated_at: "2026-10-13T08:00:00Z",
    city: "שדה נחום",
    deal_type: "sale",
    category: "residential",
    property_type: "בית פרטי/קוטג'",
    rooms: 5,
  }],
};
install(DEALS_ROW, sdeOnly);
const sde = await handler(new Request("https://shuknadlan.co.il/sitemap.xml"), context());
check("שדה נחום לבד אינו מכניס את העמק", !(await sde.text()).includes("emek-yizrael"));

const AFULA_HOUSE = "https://shuknadlan.co.il/afula/%D7%91%D7%AA%D7%99%D7%9D-%D7%A4%D7%A8%D7%98%D7%99%D7%99%D7%9D";
const afulaBlock =
  `  <url>\n    <loc>${AFULA_HOUSE}</loc>\n    <lastmod>2026-10-25</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.7</priority>\n  </url>\n`;
const withAfula = STATIC.replace("</urlset>", afulaBlock + "</urlset>\n");
install(DEALS_ROW, {
  status: 200,
  body: [{
    id: "p-house",
    updated_at: "2026-10-20T08:00:00Z",
    city: "עפולה",
    deal_type: "sale",
    category: "residential",
    property_type: "בית פרטי/קוטג'",
    rooms: 5,
  }, valleyRows.body[1]],
});
const keptAfula = await handler(new Request("https://shuknadlan.co.il/sitemap.xml"), {
  next: async () => new Response(withAfula, { headers: { "content-type": "application/xml" } }),
} as never);
const keptAfulaHtml = await keptAfula.text();
check("בלוק עפולה קיים נשאר בייט-בייט", keptAfulaHtml.includes(afulaBlock) && keptAfulaHtml.split(AFULA_HOUSE).length - 1 === 1);
check("העמק נוסף בלי להזיז את עפולה", keptAfulaHtml.indexOf(AFULA_HOUSE) < keptAfulaHtml.indexOf(EMEK));

const src = readFileSync(new URL("../netlify/edge-functions/sitemap.ts", import.meta.url), "utf8");
check("timeout העסקאות הוא 8 שניות", /const DEALS_FETCH_TIMEOUT_MS = 8000;/.test(src));

if (failed) {
  console.error(`\n✗ ${failed} בדיקות נכשלו.`);
  process.exit(1);
}
console.log("\n✓ sitemap: בלוק העסקאות אינו נשמט בשקט.");
