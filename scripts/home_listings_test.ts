/* דף הבית: קישורי נכס ו-ItemList ב-HTML הראשון, ורק בלי פרמטרי חיפוש. */
import { readFileSync } from "node:fs";
import handler from "../netlify/edge-functions/home-listings.ts";

const REAL = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const FIXTURE = `<!doctype html><html><head><title>t</title>
<link rel="canonical" href="https://shuknadlan.co.il/">
</head><body>
<section class="section wrap" id="allProps" hidden data-browse="home"></section>
</body></html>`;

const ROWS = [
  { id: "p1", title: "דירה </script><b>x", price: 1250000, deal_type: "sale" },
  { id: "p2", title: "דירה להשכרה", price: 4000, deal_type: "rent" },
  { id: "p3", title: "בלי מחיר", price: null, deal_type: "sale" },
];

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : "   " + detail}`);
}

let calls: { url: string; cache?: string }[] = [];
async function run(path: string, status: number, body: unknown, page = FIXTURE): Promise<Response> {
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), cache: init?.cache });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return await handler(
    new Request("https://shuknadlan.co.il" + path),
    { next: async () => new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } }) } as never,
  );
}

{
  const res = await run("/", 200, ROWS, REAL);
  const html = await res.text();
  const links = [...html.matchAll(/href="(\/property\?id=[^"]+)"/g)].map((m) => m[1]);
  const visible = [...html.matchAll(/<a href="\/property\?id=[^"]+">([\s\S]*?)<\/a>/g)]
    .map((m) => m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  check("דף הבית: 3 קישורים", links.length === 3, String(links.length));
  check("טקסט גלוי: כותרת ומחיר", visible[0]?.includes("דירה") && visible[0].includes("₪") && visible[1]?.includes("לחודש") && visible[2]?.includes("לפי בקשה"), visible.join(" | "));
  check("ItemList", html.includes('"@type":"ItemList"') || html.includes('"@type": "ItemList"'));
  check("canonical של /", (html.match(/rel="canonical" href="([^"]+)"/) || [])[1] === "https://shuknadlan.co.il/");
  check("בלי סגירת script", !html.includes("</script><b>"));
  check("מטמון להצלחה", res.headers.get("Netlify-CDN-Cache-Control")?.includes("max-age=3600") === true);
  check("data-ssr", html.includes('id="allProps"') && html.includes('data-ssr="1"'));
  const open = html.match(/<section\b[^>]*\bid="allProps"[^>]*>/);
  check("בלי hidden", !!open && !/\shidden\b/.test(open[0]), open?.[0] || "");
  check("שאילתה אחת ו-cache manual", calls.length === 1 && calls[0].url.includes("/properties?") && !calls[0].url.includes("market_cities") && calls[0].cache === "manual", JSON.stringify(calls));
}

{
  const res = await run("/?utm_source=google&gclid=abc&fbclid=z", 200, ROWS);
  const html = await res.text();
  check("utm אינו תוכן", html.includes('href="/property?id=p1"') && html.includes("ItemList"));
}

{
  const res = await run("/?deal=sale", 200, ROWS);
  const html = await res.text();
  check("עמוד סינון בלי הרשימה של דף הבית", !html.includes("home-ssr") && !html.includes("ItemList"));
}

{
  const res = await run("/", 500, ROWS);
  const html = await res.text();
  check("כשל מסד: הדף כמו שהוא", res.status === 200 && !html.includes("home-ssr") && !html.includes("ItemList"));
  check("כשל בלי מטמון", !res.headers.get("Netlify-CDN-Cache-Control"));
}

{
  const res = await run("/", 200, []);
  const html = await res.text();
  check("רשימה ריקה: בלי ItemList ובלי noindex", !html.includes("ItemList") && !/noindex/.test(html));
}

if (failed) {
  console.error(`\n✗ ${failed}`);
  process.exit(1);
}
console.log("\n✓ home-listings");
