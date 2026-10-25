/* ============================================================================
   הבדיקה של netlify/edge-functions/brokers-page.ts
   הרצה: node --experimental-strip-types scripts/brokers_page_test.ts
   ========================================================================== */

import { readFileSync } from "node:fs";
import handler from "../netlify/edge-functions/brokers-page.ts";

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
};
const AGENT = { slug: "dana", display_name: "דנה", agency_id: "a1" };
const CARD = { agency_id: "a1", active_count: 4 };

function route(url: string, agenciesStatus: number): Response {
  if (url.includes("/rpc/")) {
    return new Response(JSON.stringify([CARD]), { status: 200 });
  }
  if (url.includes("agency_members_public")) {
    return new Response(JSON.stringify([AGENT]), { status: agenciesStatus === 200 ? 200 : 500 });
  }
  return new Response(JSON.stringify(agenciesStatus === 200 ? [AGENCY] : { message: "no" }), { status: agenciesStatus });
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
  check("רווח בחדרים", html.includes('<bdi>3</bdi><span class="land-sp"> </span>חדרים'));
  check("FAQ", types.includes("FAQPage") && html.includes("<details>"));
  check("התראה", html.includes("קבלו התראה"));
  check("משרדים פעילים", html.includes("משרד פעיל בעפולה"));
  check("script לא נשבר", !html.includes("אדל </script>"));
  check("סוגים", types.includes("WebPage") && types.includes("BreadcrumbList") && types.includes("ItemList"));
  check("פירורים", !!crumbs && crumbs.itemListElement.length === 2);
  check("LocalBusiness", !!list && list.itemListElement[0].item["@type"].includes("LocalBusiness")
    && list.itemListElement[0].item["@type"].includes("RealEstateAgent"));
  check("מקום ללוגו", html.includes('width="72"') && html.includes('height="72"'));
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

if (failed) {
  console.error(`\n✗ ${failed}`);
  process.exit(1);
}
console.log("\n✓ מתווכים בעפולה: רשימה, JSON-LD, ו-503 בלי noindex.");
