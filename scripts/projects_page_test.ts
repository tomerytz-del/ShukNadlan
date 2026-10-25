/* /projects נשאר באינדקס כשהרשימה ריקה, עם FAQ ובלי ItemList ריק. */
import { readFileSync } from "node:fs";
import handler from "../netlify/edge-functions/projects-page.ts";

const PAGE = readFileSync(new URL("../projects.html", import.meta.url), "utf8");

function context() {
  return {
    next: async () => new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } }),
  } as never;
}

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log((ok ? "✓ " : "✗ ") + name + (ok ? "" : "  " + detail));
}

function ld(html: string): { "@graph"?: Record<string, unknown>[] } {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!m) return {};
  return JSON.parse(m[1]);
}

async function run(body: unknown, status = 200): Promise<string> {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", "content-range": "*/0" },
    })
  ) as typeof fetch;
  const res = await handler(new Request("https://shuknadlan.co.il/projects"), context());
  return res.text();
}

check("בלי noindex בקובץ", !PAGE.includes("noindex"));

const empty = await run([]);
const emptyGraph = ld(empty);
const emptyTypes = (emptyGraph["@graph"] || []).map((n) => n["@type"]);
const guide = empty.split('id="projectsGuide"')[1]?.split('id="devsSec"')[0] || "";
const questions = [...guide.matchAll(/<summary>([^<]*)<\/summary>/g)].map((m) => m[1]);
const faq = emptyGraph["@graph"]?.find((n) => n["@type"] === "FAQPage") as { mainEntity?: { name: string }[] } | undefined;
check("ריק בלי noindex", !/noindex/.test(empty));
check("כותרת ו-H1", empty.includes("<title>פרויקטים חדשים בעפולה | שוק נדל״ן</title>")
  && empty.includes("<h1 id=\"projectsH1\">פרויקטים חדשים בעפולה ובעמק יזרעאל</h1>"));
check("canonical עצמי", empty.includes('rel="canonical" href="https://shuknadlan.co.il/projects"'));
check("בלי ItemList כשריק", emptyTypes.join(",") === "CollectionPage,BreadcrumbList,FAQPage");
check("FAQ תואם לדף", (faq?.mainEntity || []).map((q) => q.name).join("|") === questions.join("|") && questions.length === 4);
check("מדריך ב-HTML", empty.includes("ערבות לפי חוק המכר") && empty.includes("/n/afula/עפולה-עלית") && empty.includes("data-land-alert"));

globalThis.fetch = (async () =>
  new Response(JSON.stringify([{ slug: "park", name: "פארק העמק" }]), {
    status: 200,
    headers: { "content-type": "application/json", "content-range": "0-0/1" },
  })
) as typeof fetch;
const listed = await handler(new Request("https://shuknadlan.co.il/projects"), context());
const listedHtml = await listed.text();
const list = ld(listedHtml)["@graph"]?.find((n) => n["@type"] === "ItemList") as { numberOfItems?: number; itemListElement?: { url: string }[] } | undefined;
check("ItemList כשיש פרויקט", list?.numberOfItems === 1 && list.itemListElement?.[0].url === "https://shuknadlan.co.il/project?slug=park");
check("הרשימה מעל המדריך", listedHtml.indexOf('id="projectsGrid"') < listedHtml.indexOf('id="projectsGuide"'));

const down = await run({ message: "no" }, 500);
check("כשל בלי noindex ובלי ItemList", !/noindex/.test(down) && !ld(down)["@graph"]?.some((n) => n["@type"] === "ItemList"));

if (failed) {
  console.error(`\n✗ ${failed} בדיקות נכשלו.`);
  process.exit(1);
}
console.log("\n✓ /projects נשאר באינדקס.");
