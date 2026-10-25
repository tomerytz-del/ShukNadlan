/* ‏JSON-LD של רשימות: @graph תקין, בלי שדות ריקים, ובלי בלוק כפול. */
import handler from "../netlify/edge-functions/index-jsonld.ts";

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

globalThis.fetch = (async () =>
  new Response(JSON.stringify([{ slug: "office", name: "משרד" }]), {
    status: 200,
    headers: { "content-type": "application/json", "content-range": "0-0/1" },
  })
) as typeof fetch;
const agencies = await (await handler(new Request("https://shuknadlan.co.il/agencies"), context())).text();
const agencyGraph = JSON.parse(agencies.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
const agencyItem = agencyGraph["@graph"][2].itemListElement[0];
check("משרד הוא RealEstateAgent", agencyItem.item["@type"] === "RealEstateAgent"
  && agencyItem.item.url === "https://shuknadlan.co.il/agency?slug=" + encodeURIComponent("office"));

const present = HTML.replace("</head>", '<script type="application/ld+json">{"@type":"CollectionPage"}</script></head>');
const again = await handler(new Request("https://shuknadlan.co.il/agents"), {
  next: async () => new Response(present, { headers: { "content-type": "text/html" } }),
} as never);
const againHtml = await again.text();
check("לא מכפילים CollectionPage", againHtml.split("CollectionPage").length === 2);

if (failed) {
  console.error(`\n${failed} בדיקות נכשלו`);
  process.exit(1);
}
console.log("\n✓ index-jsonld");
