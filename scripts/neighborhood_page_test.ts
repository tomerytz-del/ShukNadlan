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
import { resetLastGood } from "../netlify/edge-functions/lib/last-good.ts";

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
  check("בלי קישור ל-swipe", !html.includes("/swipe"));
  check("פירורי לחם גלויים", html.includes('aria-label="פירורי לחם"') && html.includes(">בית</a>")
    && html.includes(">שכונת גבעת המורה</span>"));
  const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  const graph = ld ? JSON.parse(ld[1]) : null;
  const crumbs = graph && graph["@graph"].find((x: { "@type": string }) => x["@type"] === "BreadcrumbList");
  check("JSON-LD תקין ותואם לפירורים", !!crumbs
    && crumbs.itemListElement[0].name === "בית"
    && crumbs.itemListElement[2].name === "שכונת גבעת המורה");
  check("שאלות נפוצות כ-3 לכל היותר", (html.match(/<details class="hood-faq-item">/g) || []).length === 1);
}
{
  const cover = {
    ...HOOD,
    cover_path: "11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222.jpg",
    cover_alt: "רחוב בשכונה",
    cover_credit: "תומר",
  };
  const res = await run(URL_HOOD, 200, cover);
  const html = await res.text();
  const hero = html.match(/<img[^>]*neighborhood-covers[^>]*>/);
  check("שער עם מידות ו-webp", !!hero && hero[0].includes('width="1200"') && hero[0].includes('height="520"')
    && hero[0].includes("format=webp") && hero[0].includes('fetchpriority="high"'));
  check("קרדיט גלוי ו-og:image", html.includes("צילום: תומר")
    && html.includes('property="og:image" content="https://obookujgolazrwycsiyn.supabase.co/storage/v1/object/public/neighborhood-covers/'));
  check("preload לשער, כרטיס לא LCP", html.includes('rel="preload" as="image"') && html.includes("neighborhood-covers")
    && !html.includes('property-images/a.jpg" fetchpriority'));
}
{
  const named = { ...HOOD, name: "השכונה הצפון מערבית", slug: "השכונה-הצפון-מערבית" };
  const res = await run(URL_HOOD, 200, named);
  const html = await res.text();
  check("בלי שכונת השכונה בכותרת", !html.includes("שכונת השכונה"));
  check("H1 בלי הכפלה", html.includes('<h1 id="dealsH1">השכונה הצפון מערבית, עפולה</h1>'));
}
{
  const lead = { ...HOOD, about: { ...HOOD.about, hero_intro: "משפט קצר על גבעת המורה." } };
  const res = await run(URL_HOOD, 200, lead);
  const html = await res.text();
  check("פתיחה קצרה מתחת ל-H1", html.includes('<p id="dealsLead">משפט קצר על גבעת המורה.</p>'));
  check("פתיחה קצרה בתיאור", html.includes('name="description" content="משפט קצר על גבעת המורה."')
    && html.includes('property="og:description" content="משפט קצר על גבעת המורה."'));
}
{
  const fits = { ...HOOD, about: { ...HOOD.about, fits: "• זוגות צעירים\n• משפחות" } };
  const res = await run(URL_HOOD, 200, fits);
  const html = await res.text();
  check("למי מתאימה כרשימה", html.includes('<ul class="hood-fits-list">') && html.includes("<li>זוגות צעירים</li>"));
}
{
  const words = Array.from({ length: 122 }, (_v, i) => "מילה" + i);
  words[121] = "כאן.";
  const more = "המשך שחייב להישאר ב-HTML של הדף.";
  const long = { ...HOOD, about: { ...HOOD.about, intro: words.join(" ") + " " + more } };
  const res = await run(URL_HOOD, 200, long);
  const html = await res.text();
  check("המשך קריאה אחרי סוף משפט", html.includes("להמשך קריאה ←") && html.includes("כאן.") && html.includes(more)
    && html.includes('class="hood-about-rest"'));
}
{
  const poi = { ...HOOD, poi: { parks: [], transport: ["תחנת רכבת"], education: ["  "] } };
  const res = await run(URL_HOOD, 200, poi);
  const html = await res.text();
  check("צ'יפ ריק לא מוצג", html.includes("תחבורה") && html.includes("תחנת רכבת") && !html.includes("פארקים") && !html.includes("חינוך"));
}
{
  const faqs = { ...HOOD, about: { ...HOOD.about, faq: [
    { q: "שאלה אחת?", a: "תשובה אחת." },
    { q: "שאלה שתיים?", a: "תשובה שתיים." },
    { q: "שאלה שלוש?", a: "תשובה שלוש." },
    { q: "שאלה רביעית שלא תוצג", a: "לא." },
  ] } };
  const res = await run(URL_HOOD, 200, faqs);
  const html = await res.text();
  check("שלוש שאלות ולא ארבע", (html.match(/<details class="hood-faq-item">/g) || []).length === 3
    && !html.includes("שאלה רביעית"));
}
{
  const offices = { ...HOOD, agencies: [
    { name: "משרד לדוגמה", slug: "demo-office", n: 3, phone: "053-9876543", email: "secret@example.com", license_number: "99999",
      logo: "https://obookujgolazrwycsiyn.supabase.co/storage/v1/object/public/property-images/logo.jpg" },
  ] };
  const res = await run(URL_HOOD, 200, offices);
  const html = await res.text();
  check("משרד בלי טלפון", html.includes("/agency?slug=demo-office") && html.includes("יועצי נדל״ן")
    && html.includes("3 נכסים בשכונה") && !html.includes("053-9876543") && !html.includes("secret@example.com") && !html.includes("99999"));
}
resetLastGood();
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
  const empty = { ...HOOD, props_active: 0, props: [], deals: 20 };
  const res = await run(URL_HOOD, 200, empty);
  const html = await res.text();
  check("בלי מודעות: 200 ו-noindex גם עם עסקאות", res.status === 200 && html.includes("noindex")
    && res.headers.get("X-Robots-Tag") === "noindex, follow");
}
{
  const away = { ...HOOD, market_slug: "haifa-krayot", city: "חיפה", city_slug: "haifa" };
  const res = await run(URL_HOOD, 200, away);
  const html = await res.text();
  check("מחוץ לשוק חי: 200 ו-noindex", res.status === 200 && html.includes('data-ssr="1"') && html.includes("noindex"));
}
{
  const res = await run("https://shuknadlan.co.il/n/afula/<x>", 200, HOOD);
  const html = await res.text();
  check("כתובת לא תקינה: 404 ו-noindex בלי מסד", res.status === 404 && html.includes("noindex") && calls === 0);
  check("כתובת לא תקינה: no-store", res.headers.get("Cache-Control") === "no-store");
}

resetLastGood();
{
  const good = await run(URL_HOOD, 200, HOOD);
  const goodHtml = await good.text();
  const bad = await run(URL_HOOD, 500, {});
  const badHtml = await bad.text();
  check("אחרי הצלחה, כשל מגיש את אותו דף", bad.status === 200 && badHtml === goodHtml && goodHtml.includes("data-ssr"));
  check("העותק בלי Retry-After", !bad.headers.get("Retry-After"));
}

if (failed) {
  console.error(`\n${failed} בדיקות נכשלו`);
  process.exit(1);
}
console.log("\n✓ neighborhood-page.ts");
