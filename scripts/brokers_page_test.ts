/* ============================================================================
   הבדיקה של netlify/edge-functions/brokers-page.ts
   הרצה: node --experimental-strip-types scripts/brokers_page_test.ts
   ========================================================================== */

import { readFileSync } from "node:fs";
import handler from "../netlify/edge-functions/brokers-page.ts";
import "../assets/silo-render.js";

const PAGE = readFileSync(new URL("../brokers.html", import.meta.url), "utf8");
const SITE = "https://shuknadlan.co.il";
const URL_PAGE = SITE + "/afula/" + encodeURIComponent("מתווכים");
const CANON = SITE + "/afula/מתווכים";

const context = () =>
  ({
    next: async () => new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } }),
  }) as never;

const AGENCY = {
  id: "a1",
  slug: "adel",
  name: "אדל </script>",
  address: "הולנד 12 עפולה",
  tagline: "מגורים",
  logo_url: "https://obookujgolazrwycsiyn.supabase.co/storage/v1/object/public/logos/a.png",
  updated_at: "2026-10-01T00:00:00.000Z",
};
const MORE = [
  { id: "a2", slug: "by", name: "BY", logo_url: null },
  { id: "a3", slug: "mc", name: 'Mc נדל"ן', logo_url: "" },
  { id: "a4", slug: "ab", name: "א.ב יזמות", logo_url: "" },
  { id: "a5", slug: "aviv", name: "אביב נכסים", logo_url: "" },
];
const AGENT = { slug: "dana", display_name: "דנה", agency_id: "a1" };
const CARD = { agency_id: "a1", active_count: 4 };

function route(url: string, agenciesStatus: number): Response {
  if (url.includes("/rpc/")) {
    return new Response(JSON.stringify([CARD]), { status: 200 });
  }
  if (url.includes("agency_members_public")) {
    return new Response(JSON.stringify([AGENT]), { status: agenciesStatus === 200 ? 200 : 500 });
  }
  return new Response(JSON.stringify(agenciesStatus === 200 ? [AGENCY, ...MORE] : { message: "no" }), { status: agenciesStatus });
}

async function run(pathname: string, agenciesStatus: number, membersOk = true): Promise<Response> {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (!membersOk && url.includes("agency_members_public")) {
      return new Response("no", { status: 500 });
    }
    if (!membersOk && url.includes("/rpc/")) return new Response("no", { status: 500 });
    return route(url, agenciesStatus);
  }) as typeof fetch;
  return await handler(new Request(SITE + pathname), context());
}

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log((ok ? "✓ " : "✗ ") + name + (ok ? "" : "  " + detail));
}

function blocks(html: string): Record<string, unknown>[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
}

{
  const res = await run("/afula/" + encodeURIComponent("מתווכים"), 200);
  const html = await res.text();
  const ld = blocks(html);
  const types = ld.map((b) => b["@type"]);
  const list = ld.find((b) => b["@type"] === "ItemList") as { itemListElement: { item: { "@type": string[] } }[] } | undefined;
  const crumbs = ld.find((b) => b["@type"] === "BreadcrumbList") as { itemListElement: unknown[] } | undefined;
  check("200", res.status === 200);
  check("H1", html.includes("מתווכים בעפולה</h1>"));
  check("canonical", html.includes(`href="${CANON}"`));
  check("משרד ומתווך", html.includes("/agency?slug=adel") && html.includes("/agent?slug=dana"));
  check("ספירה", html.includes('<bdi>4</bdi><span class="land-sp"> </span>נכסים פעילים'));
  const faq = ld.find((b) => b["@type"] === "FAQPage") as { mainEntity?: unknown[] } | undefined;
  check("FAQ", types.includes("FAQPage") && faq?.mainEntity?.length === 4);
  check("התראה", html.includes("קבלו התראה") && !html.includes("זו ההתראה שכבר קיימת באתר"));
  check("כותרת משרדים", html.includes("משרדי תיווך פעילים בעפולה")
    && !html.includes("משרדי התיווך שמפרסמים בעפולה"));
  const heroCta = html.slice(html.indexOf('id="landAll"'), html.indexOf('id="landAll"') + 180);
  check("כפתור משרדים", heroCta.includes('href="/agencies"') && heroCta.includes(">לכל המשרדים<"));
  const body = (html.split('id="brokersBody"')[1] || "").split("<!--/brokers-->")[0];
  check("בלי סינון נכסים", !body.includes("rooms=3") && !body.includes('aria-label="סינון מהיר"'));
  check("עודכן", html.includes("עודכן לאחרונה") && html.includes("<bdi>01.10.2026</bdi>"));
  check("ראשי תיבות", html.includes('class="land-avatar" aria-hidden="true">BY<')
    && html.includes('class="land-avatar" aria-hidden="true">Mc<')
    && html.includes('class="land-avatar" aria-hidden="true">א.ב<')
    && html.includes('class="land-avatar" aria-hidden="true">אנ<'));
  check("script לא נשבר", !html.includes("אדל </script>"));
  check("סוגים", types.includes("WebPage") && types.includes("BreadcrumbList") && types.includes("ItemList"));
  check("פירורים", !!crumbs && crumbs.itemListElement.length === 3
    && (crumbs.itemListElement[1] as { name: string; item: string }).name === "עפולה"
    && (crumbs.itemListElement[1] as { item: string }).item === SITE + "/");
  check("LocalBusiness", !!list && list.itemListElement[0].item["@type"].includes("LocalBusiness")
    && list.itemListElement[0].item["@type"].includes("RealEstateAgent"));
  check("מקום ללוגו", html.includes('width="48"') && html.includes('height="48"'));
  check("פירור גלוי", html.includes('aria-label="נתיב ניווט"') && html.includes(">עפולה</a>"));
}

{
  const res = await run("/afula/מתווכים", 500);
  const html = await res.text();
  check("כשל משרדים הוא 503", res.status === 503);
  check("בלי noindex", !/noindex/.test(html));
  check("canonical נשאר", html.includes(`href="${CANON}"`));
  check("Retry-After", res.headers.get("Retry-After") === "60");
  check("no-store", res.headers.get("Cache-Control") === "no-store"
    && res.headers.get("Netlify-CDN-Cache-Control") === "no-store");
}

{
  const res = await run("/afula/מתווכים", 200, false);
  const html = await res.text();
  check("מתווכים שנכשלו אינם מפילים", res.status === 200 && html.includes("/agency?slug=adel") && !/noindex/.test(html));
}

{
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("agencies?")) return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const res = await handler(new Request(URL_PAGE), context());
  const html = await res.text();
  check("רשימה ריקה", res.status === 200 && /noindex/.test(html) && res.headers.get("Retry-After") == null);
}

{
  const res = await run("/brokers", 200);
  const html = await res.text();
  check("בלי הנתיב הוא 404", res.status === 404 && /noindex/.test(html));
}

{
  const marker = "<!--other-page-->";
  const res = await handler(new Request(SITE + "/afula/" + encodeURIComponent("בתים-פרטיים")), {
    next: async () => new Response(marker, { headers: { "content-type": "text/html; charset=utf-8" } }),
  } as never);
  const html = await res.text();
  check("נתיב /afula אחר עובר הלאה", res.status === 200 && html === marker);
}

{
  const seen: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    seen.push(String(input));
    return route(String(input), 200);
  }) as typeof fetch;
  const res = await handler(new Request(SITE + "/haifa/" + encodeURIComponent("מתווכים")), context());
  const html = await res.text();
  const ld = blocks(html);
  const list = ld.find((b) => b["@type"] === "ItemList") as { name: string; itemListElement: { item: { address: { addressLocality: string } } }[] } | undefined;
  const crumbs = ld.find((b) => b["@type"] === "BreadcrumbList") as { itemListElement: { name: string; item: string }[] } | undefined;
  check("חיפה: 200, H1 וכותרת", res.status === 200 && html.includes('<h1 id="brokersH1">מתווכים בחיפה</h1>')
    && html.includes("<title>מתווכים בחיפה | שוק נדל״ן</title>"));
  check("חיפה: canonical", html.includes('<link rel="canonical" href="https://shuknadlan.co.il/haifa/מתווכים">'));
  check("חיפה: משרדים לפי city_id", seen.some((u) => u.includes("/agencies?") && u.includes("city_id=eq.751fcf13-a02b-4370-97a5-fc4ec42ea4fe")));
  check("חיפה: ItemList ו-addressLocality", list?.name === "מתווכים בחיפה" && list.itemListElement[0].item.address.addressLocality === "חיפה");
  check("חיפה: פירורים", crumbs?.itemListElement[1]?.name === "חיפה" && crumbs?.itemListElement[1]?.item === SITE + "/haifa"
    && html.includes('<a href="/haifa" id="landCityCrumb">חיפה</a>'));
  const body = (html.split('id="brokersBody"')[1] || "").split("<!--/brokers-->")[0];
  check("חיפה: קישורים לחיפה", body.includes('href="/deals/haifa"') && body.includes('href="/haifa/בתים-פרטיים"') && !body.includes("/afula") && !body.includes("בעפולה"));
  check("חיפה: רמז השוק", html.includes('<script>window.SHUK_MARKET={"slug":"haifa"};</script>'));
  check("חיפה: שוק לא חי - noindex", /<meta name="robots" content="noindex,follow">/.test(html)
    && res.headers.get("X-Robots-Tag") === "noindex, follow");
}

{
  const res = await run("/afula/" + encodeURIComponent("מתווכים"), 200);
  check("עפולה: בלי noindex", !/noindex/.test(await res.text()) && res.headers.get("X-Robots-Tag") == null);
}

{
  type City = { slug: string; name: string; cityId: string; market: string; home: string };
  const g = globalThis as unknown as { ShukSilo: { cities: City[] }; ShukBrokers: { cities: City[] } };
  const pick = (c: City) => [c.slug, c.name, c.cityId, c.market, c.home].join("|");
  check("אותן ערים ב-silo-render וב-brokers-render",
    JSON.stringify(g.ShukSilo.cities.map(pick)) === JSON.stringify(g.ShukBrokers.cities.map(pick)));
}

if (failed) {
  console.error(`\n✗ ${failed}`);
  process.exit(1);
}
console.log("\n✓ מתווכים לפי עיר: רשימה, JSON-LD, ו-503 בלי noindex.");
