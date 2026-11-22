/* ‏JSON-LD של רשימות: @graph תקין, בלי שדות ריקים, ובלי בלוק כפול. */
import handler, { filterDefaultMarketOffices } from "../netlify/edge-functions/index-jsonld.ts";

const HTML = `<!DOCTYPE html><html><head><title>t</title></head><body><h1>x</h1></body></html>`;

function context() {
  return {
    next: async () => new Response(HTML, { headers: { "content-type": "text/html" } }),
  } as never;
}

const AGENTS = [
  { slug: "roi", display_name: "רועי" },
  { slug: "", display_name: "בלי כתובת" },
  { slug: "noname", display_name: "  " },
];

globalThis.fetch = (async () =>
  new Response(JSON.stringify(AGENTS), {
    status: 200,
    headers: { "content-type": "application/json", "content-range": "0-2/3" },
  })
) as typeof fetch;

let failed = 0;
function check(name: string, ok: boolean) {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}`);
}

const res = await handler(new Request("https://shuknadlan.co.il/agents"), context());
const html = await res.text();
check("תשובה שמולאה נשמרת ב-CDN", /max-age=3600/.test(res.headers.get("Netlify-CDN-Cache-Control") || ""));
const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
check("בלוק אחד", blocks.length === 1);
let graph: { "@graph"?: Record<string, unknown>[] } = {};
try { graph = JSON.parse(blocks[0][1]); } catch { /* נבדק למטה */ }
check("JSON תקין", Array.isArray(graph["@graph"]));
const types = (graph["@graph"] || []).map((node) => node["@type"]);
check("שלושה טיפוסים", types.join(",") === "CollectionPage,BreadcrumbList,ItemList");
const page = graph["@graph"]?.[0] as Record<string, unknown>;
const list = graph["@graph"]?.[2] as Record<string, unknown>;
const items = list?.itemListElement as Record<string, unknown>[];
check("עפולה ומזהה האתר", (page?.about as { name?: string })?.name === "עפולה"
  && (page?.isPartOf as { "@id"?: string })?.["@id"] === "https://shuknadlan.co.il/#website");
check("רק פריט עם שם וכתובת", items?.length === 1 && items[0].url === "https://shuknadlan.co.il/agent?slug=roi");
check("הספירה היא של הפריטים", list?.numberOfItems === 1);
check("בלי שדה ריק", !JSON.stringify(graph).includes('""'));

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/* ‏משרד אחד בעיר של שוק ברירת המחדל, עם סוכן/ת פעיל/ה. */
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes("market_cities_public")) return jsonResponse([{ city_id: "c1", market_slug: "afula-emek" }]);
  if (url.includes("service_markets")) return jsonResponse([{ id: "m1", agency_id: "a1", service_markets: [] }]);
  if (url.includes("agency_members_public")) return jsonResponse([{ agency_id: "a1", active: true }]);
  return jsonResponse([{ id: "a1", slug: "office", name: "משרד", city_id: "c1" }]);
}) as typeof fetch;
const agencies = await (await handler(new Request("https://shuknadlan.co.il/agencies"), context())).text();
const agencyGraph = JSON.parse(agencies.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
const agencyItem = agencyGraph["@graph"][2].itemListElement[0];
check("משרד הוא RealEstateAgent", agencyItem.item["@type"] === "RealEstateAgent"
  && agencyItem.item.url === "https://shuknadlan.co.il/agency?slug=" + encodeURIComponent("office"));
const agencyPage = agencyGraph["@graph"][0] as { name?: string; about?: { "@type"?: string; name?: string } };
check("שם המשרדים הוא האזור", agencyPage.name === "משרדי תיווך בעמק יזרעאל"
  && agencyPage.about?.["@type"] === "AdministrativeArea"
  && agencyPage.about?.name === "עמק יזרעאל");

const AFULA = "city-afula";
const NETANYA = "city-netanya";
const DEMO = "cf863e10-c25d-41ed-8b22-d6899a56e95d";
const OFFICES = [
  { id: "afula", slug: "emek", name: "משרד בעמק", city_id: AFULA },
  { id: "nat", slug: "kfar-yona", name: "משרד בנתניה", city_id: NETANYA },
  { id: "covers", slug: "covers-emek", name: "משרד שמכסה את העמק", city_id: NETANYA },
  { id: "empty", slug: "no-staff", name: "בלי סוכן", city_id: AFULA },
  { id: DEMO, slug: "demo-office-play-review", name: "משרד הדגמה", city_id: AFULA },
];
const CITIES = [
  { city_id: AFULA, market_slug: "afula-emek" },
  { city_id: NETANYA, market_slug: "netanya" },
];
const STAFF = [
  { agency_id: "afula", active: true },
  { agency_id: "nat", active: true },
  { agency_id: "covers", active: true },
  { agency_id: DEMO, active: true },
];
const MARKETS = [
  { id: "m-a", agency_id: "afula", service_markets: [] },
  { id: "m-n", agency_id: "nat", service_markets: ["netanya"] },
  { id: "m-c", agency_id: "covers", service_markets: ["afula-emek"] },
  { id: "m-d", agency_id: DEMO, service_markets: ["afula-emek"] },
];
const filtered = filterDefaultMarketOffices(OFFICES, CITIES, STAFF, MARKETS).map((r) => r.slug);
check("סינון השוק כמו הדף", filtered.join(",") === "emek,covers-emek");
const staffDown = filterDefaultMarketOffices(OFFICES, CITIES, null, MARKETS).map((r) => r.slug);
check("כשל צוות אינו מוחק משרד", staffDown.includes("no-staff")
  && staffDown.includes("emek")
  && !staffDown.includes("kfar-yona")
  && !staffDown.includes("demo-office-play-review"));

globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes("market_cities_public")) return jsonResponse(CITIES);
  if (url.includes("service_markets")) return jsonResponse(MARKETS);
  if (url.includes("agency_members_public")) return jsonResponse(STAFF);
  return jsonResponse(OFFICES);
}) as typeof fetch;
const filteredHtml = await (await handler(new Request("https://shuknadlan.co.il/agencies"), context())).text();
const filteredGraph = JSON.parse(filteredHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
const filteredItems = filteredGraph["@graph"][2].itemListElement as { name: string; url: string }[];
check("הרשימה ב-JSON-LD בלי נתניה ובלי הדגמה", filteredItems.map((i) => i.name).join(",") === "משרד בעמק,משרד שמכסה את העמק"
  && filteredGraph["@graph"][2].numberOfItems === 2
  && !filteredHtml.includes("kfar-yona")
  && !filteredHtml.includes("demo-office-play-review")
  && !filteredHtml.includes("no-staff"));

const present = HTML.replace("</head>", '<script type="application/ld+json">{"@type":"CollectionPage"}</script></head>');
const again = await handler(new Request("https://shuknadlan.co.il/agents"), {
  next: async () => new Response(present, { headers: { "content-type": "text/html" } }),
} as never);
const againHtml = await again.text();
check("לא מכפילים CollectionPage", againHtml.split("CollectionPage").length === 2);

const projectsHtml = await (await handler(new Request("https://shuknadlan.co.il/projects"), context())).text();
check("projects לא בפונקציה הזו", projectsHtml === HTML);

globalThis.fetch = (async () => new Response("no", { status: 500 })) as typeof fetch;
const downRes = await handler(new Request("https://shuknadlan.co.il/agencies"), context());
check("כשל מסד לא נשמר במטמון", !downRes.headers.get("Netlify-CDN-Cache-Control") && (await downRes.text()) === HTML);

if (failed) {
  console.error(`\n${failed} בדיקות נכשלו`);
  process.exit(1);
}
console.log("\n✓ index-jsonld");
