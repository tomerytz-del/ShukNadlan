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
     · חיפה: אותה תבנית, שאילתה לפי העיר, וקישורים לחיפה. השוק אינו
       live, ולכן הדף מלא ועם noindex ו-X-Robots-Tag.

   הרצה:

       node --experimental-strip-types scripts/silo_page_test.ts
   ========================================================================== */

import { readFileSync } from "node:fs";
import handler from "../netlify/edge-functions/silo-page.ts";
import { resetLastGood } from "../netlify/edge-functions/lib/last-good.ts";

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
let urls: string[] = [];
async function run(url: string, status: number, body: unknown, page = PAGE): Promise<Response> {
  calls = 0;
  urls = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls++;
    urls.push(String(input));
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
  check("עפולה: city=eq ומסוג אחד", urls.some((u) => u.includes("/properties?")
    && u.includes("city=eq." + encodeURIComponent("עפולה"))
    && u.includes("property_type=eq." + encodeURIComponent("בית פרטי/קוטג'"))
    && !u.includes("city=in.")));
  check("כותרת", html.includes("<title>בית פרטי למכירה בעפולה | שוק נדל״ן</title>"));
  check("H1", html.includes("<h1 id=\"siloH1\">בית פרטי למכירה בעפולה</h1>"));
  check("ממולא", html.includes('data-ssr="1"') && html.includes("מודעות פעילות"));
  check("canonical מהכתובת", html.includes(`<link rel="canonical" href="${CANON}">`));
  check("קישורי אזור", html.includes('href="/deals/afula"') && html.includes('href="/prices"') && html.includes('href="/"'));
  check("שכונה", html.includes("/n/afula/" + encodeURIComponent("גבעת-המורה")));
  check("תמונה זרה בחוץ", !html.includes("evil.example"));
  check("script לא נשבר", !html.includes("</script><b>"));
  check("מקום לתמונה", html.includes('width="320"') && html.includes('height="200"'));
  check("שלושה סוגים", types.includes("WebPage") && types.includes("BreadcrumbList") && types.includes("ItemList"), types.join(","));
  check("WebPage.url", web?.url === CANON && web?.name === "בית פרטי למכירה בעפולה");
  check("פירורי לחם", !!crumbs && crumbs.itemListElement.length === 3
    && crumbs.itemListElement.every((x, i) => x.position === i + 1 && !!x.item && !!x.name));
  check("ItemList", !!list && list.numberOfItems === 2 && list.itemListElement[0].position === 1
    && list.itemListElement[0].url === SITE + "/property?id=p1");
  check("מטמון", (res.headers.get("Cache-Control") || "").includes("must-revalidate"));
  const faq = blocks.find((b) => b["@type"] === "FAQPage") as { mainEntity?: unknown[] } | undefined;
  const houseQa = (faq?.mainEntity || []) as { name: string; acceptedAnswer: { text: string } }[];
  const houseBy = "המודעות מתפרסמות על ידי יועצי נדל״ן ומשרדים.";
  const faqP = (text: string) => "<p>" + text.replace(/'/g, "&#39;") + "</p>";
  const faqSum = (text: string) => "<summary>" + text.replace(/'/g, "&#39;") + "</summary>";
  const houseNames = [
    "מה נכלל בבית פרטי למכירה בעפולה?",
    "יש הבדל בין בית פרטי, בית קרקע וקוטג'?",
    "מאיפה המודעות בעמוד הזה?",
    "איפה רואים את המחיר ואת כל הפרטים?",
    "איפה רואים עסקאות ומחירי דירות?",
    "מה עושים אם אין כרגע מודעות?",
  ];
  check("FAQ", types.includes("FAQPage") && houseQa.length === houseNames.length
    && (html.match(/<details><summary>/g) || []).length === houseNames.length
    && houseQa.every((q, i) => q.name === houseNames[i] && html.includes(faqSum(q.name))));
  check("בית: יועצי נדל״ן ב-FAQ וב-JSON-LD", !!houseQa[0] && houseQa[0].acceptedAnswer.text.endsWith(houseBy)
    && html.includes(faqP(houseQa[0].acceptedAnswer.text))
    && !html.includes("בלי תיווך")
    && !houseQa.some((q) => q.name.includes("בלי תיווך"))
    && html.includes("שיועצי נדל״ן ומשרדים מפרסמים באתר"));
  check("פירור גלוי", html.includes('aria-label="נתיב ניווט"') && html.includes(">דף הבית</a>") && html.includes(">עפולה</a>") && html.includes('aria-current="page"'));
  check("התראה", html.includes("קבלו התראה") && html.includes("data-land-alert"));
  check("בלי שמירה", !html.includes("land-save") && !html.includes("שמור נכס"));
  check("תג ירד מחיר", html.includes('class="land-badge">ירד מחיר'));
  check("תג חדש", html.includes('class="land-badge">חדש'));
  check("מחיר ב-bdi", html.includes("<bdi>₪2,500,000</bdi>") && html.includes("מחיר חציוני"));
  check("רווח בחדרים", html.includes("<bdi>3</bdi><span>חדרים</span>"));
  const hero0 = (html.split('id="landHeroBg"')[1] || "").split("land-hero-overlay")[0];
  check("גיבור הוא תמונת הבית", hero0.includes("hero-house-800.webp") && hero0.includes("hero-house-1600.webp 1600w") && hero0.includes('sizes="100vw"') && hero0.includes('fetchpriority="high"') && !hero0.includes("property-images/") && !hero0.includes("hero-valley"));
  check("שכונה בכרטיס", html.includes("גבעת המורה"));
  check("עפולה עילית", html.includes("עפולה עילית") && html.includes('href="/n/afula/עפולה-עלית"'));
  check("preload לפי הסוג", html.includes('href="assets/hero-house-800.webp" media="(max-width: 759px)"')
    && html.includes('href="assets/hero-house-1600.webp" media="(min-width: 760px)"')
    && !html.includes("hero-valley"));
  check("og לפי הסוג", html.includes('property="og:image" content="https://shuknadlan.co.il/assets/hero-house-1600.webp"')
    && html.includes('property="og:image:width" content="1600"'));
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
  check("גיבור לא לוקח תמונת מודעה", hero.includes("hero-house-800.webp") && !hero.includes("new-house.jpg") && !hero.includes("property-images/a.jpg"));
}

resetLastGood();
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
  resetLastGood();
  const good = await run(SITE + PATH, 200, ROWS);
  const goodHtml = await good.text();
  const bad = await run(SITE + PATH, 500, { message: "no" });
  const badHtml = await bad.text();
  check("אחרי הצלחה, כשל מגיש את אותו דף", bad.status === 200 && badHtml === goodHtml && goodHtml.includes("data-ssr"));
  check("העותק בלי Retry-After", !bad.headers.get("Retry-After") && !/noindex/.test(badHtml));
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
  const gardenFaq = ldBlocks(html).find((b) => b["@type"] === "FAQPage") as { mainEntity?: { acceptedAnswer: { text: string } }[] } | undefined;
  const gardenA = "דירת גן היא דירה עם גינה פרטית, בדרך כלל בקומת קרקע. בעמוד הזה מופיעות דירות גן פעילות למכירה בעפולה, מיועצי נדל״ן ומשרדים.";
  check("דירות גן", res.status === 200 && html.includes("דירות גן למכירה בעפולה")
    && html.includes("<title>דירות גן למכירה בעפולה | שוק נדל״ן</title>")
    && html.includes("hero-garden-800.webp")
    && html.includes('href="https://shuknadlan.co.il/afula/דירות-גן"'));
  check("דירות גן: יועצי נדל״ן ב-FAQ וב-JSON-LD", gardenFaq?.mainEntity?.[0]?.acceptedAnswer.text === gardenA
    && html.includes("<p>" + gardenA + "</p>"));
}

{
  const res = await run(SITE + "/afula/" + encodeURIComponent("דירות-3-חדרים"), 200, ROWS);
  const html = await res.text();
  const filters = (html.split('aria-label="סינון מהיר"')[1] || "").split("</nav>")[0];
  check("בלי צ'יפ 3 חדרים", !filters.includes("<bdi>3</bdi>"));
  check("גיבור דירות", html.includes("hero-apt-800.webp"));
  check("שכונה במקום הצ'יפ", filters.includes("/n/afula/" + encodeURIComponent("מרכז-העיר")));
  const sharedFaq = ldBlocks(html).find((b) => b["@type"] === "FAQPage") as { mainEntity?: { name: string; acceptedAnswer: { text: string } }[] } | undefined;
  const priceQ = "איפה רואים את המחיר ואת כל הפרטים?";
  const priceA = "בדף של כל נכס מופיעים המחיר שפורסם והמפרט המלא. אם אין מחיר במודעה, אפשר לפנות דרך האתר ולשאול.";
  const sourceA = "אלה נכסים למכירה בעפולה שיועצי נדל״ן ומשרדים מפרסמים באתר.";
  check("FAQ משותף: טקסט ו-JSON-LD", sharedFaq?.mainEntity?.[0]?.acceptedAnswer.text === sourceA
    && sharedFaq.mainEntity[1]?.name === priceQ
    && sharedFaq.mainEntity[1].acceptedAnswer.text === priceA
    && html.includes("<summary>מאיפה המודעות בעמוד הזה?</summary><p>" + sourceA + "</p>")
    && html.includes("<summary>" + priceQ + "</summary><p>" + priceA + "</p>")
    && !html.includes("האם המחיר שמופיע הוא המחיר הסופי?"));
}

{
  const HAIFA = SITE + "/haifa/" + encodeURIComponent("בתים-פרטיים");
  const rows = ROWS.map((r) => ({ ...r, city: "חיפה", neighborhoods: { name: "נווה שאנן" } }));
  const res = await run(HAIFA, 200, rows);
  const html = await res.text();
  const blocks = ldBlocks(html);
  const crumbs = blocks.find((b) => b["@type"] === "BreadcrumbList") as { itemListElement: { name: string; item: string }[] } | undefined;
  check("חיפה: 200 וממולא", res.status === 200 && html.includes('data-ssr="1"') && html.includes("מודעות פעילות"));
  check("חיפה: כותרת ו-H1", html.includes("<title>בית פרטי למכירה בחיפה | שוק נדל״ן</title>")
    && html.includes('<h1 id="siloH1">בית פרטי למכירה בחיפה</h1>'));
  check("חיפה: canonical", html.includes('<link rel="canonical" href="https://shuknadlan.co.il/haifa/בתים-פרטיים">'));
  check("חיפה: השאילתה לפי העיר", urls.some((u) => u.includes("/properties?") && u.includes("city=eq." + encodeURIComponent("חיפה")))
    && !urls.some((u) => u.includes(encodeURIComponent("עפולה"))));
  check("חיפה: משרדים לפי city_id", urls.some((u) => u.includes("/agencies?") && u.includes("city_id=eq.751fcf13-a02b-4370-97a5-fc4ec42ea4fe")));
  check("חיפה: קישורים", html.includes('href="/deals/haifa"') && html.includes("/n/haifa/" + encodeURIComponent("נווה-שאנן"))
    && html.includes('href="/haifa/מתווכים"') && html.includes('href="/haifa/דירות-גן"') && html.includes('href="/haifa">חיפה והסביבה</a>'));
  check("חיפה: החיפוש של חיפה", html.includes('id="landAll"') && /id="landAll"[^>]*href="\/haifa\?deal=sale/.test(html)
    && !((html.split('id="siloBody"')[1] || "").split("<!--/silo-->")[0]).includes('href="/?'));
  check("חיפה: בלי עפולה בגוף", !(html.split('id="siloBody"')[1] || "").split("<!--/silo-->")[0].includes("עפולה"));
  check("חיפה: פירור גלוי", html.includes('<a href="/haifa" id="landCityCrumb">חיפה</a>'));
  check("חיפה: פירור ב-JSON-LD", crumbs?.itemListElement[1]?.name === "חיפה" && crumbs?.itemListElement[1]?.item === SITE + "/haifa");
  check("חיפה: רמז השוק", html.includes('<script>window.SHUK_MARKET={"slug":"haifa"};</script>'));
  check("חיפה: שוק לא חי - noindex", /<meta name="robots" content="noindex,follow">/.test(html)
    && res.headers.get("X-Robots-Tag") === "noindex, follow");
}

{
  const res = await run(SITE + PATH, 200, ROWS);
  const html = await res.text();
  check("עפולה: שוק חי - בלי noindex", !/noindex/.test(html) && res.headers.get("X-Robots-Tag") == null);
  check("עפולה: בלי רמז שוק", !html.includes("SHUK_MARKET"));
}

{
  const marker = "<!--other-page-->";
  const res = await run(SITE + "/haifa/" + encodeURIComponent("מתווכים"), 200, ROWS, marker);
  const html = await res.text();
  check("נתיב /haifa אחר עובר הלאה", res.status === 200 && html.includes(marker) && !/noindex/.test(html) && calls === 0);
}

{
  const URL_YAM = SITE + "/kiryat-yam/" + encodeURIComponent("דירות-3-חדרים");
  const rows = ROWS.map((r) => ({ ...r, city: "קריית ים", rooms: 3, neighborhoods: { name: "קריית ים ב'" } }));
  const res = await run(URL_YAM, 200, rows);
  const html = await res.text();
  const body = (html.split('id="siloBody"')[1] || "").split("<!--/silo-->")[0];
  const filters = (html.split('aria-label="סינון מהיר"')[1] || "").split("</nav>")[0];
  check("קריית ים: H1", html.includes('<h1 id="siloH1">דירות 3 חדרים למכירה בקריית ים</h1>'));
  check("קריית ים: השאילתה לפי העיר", urls.some((u) => u.includes("/properties?") && u.includes("city=eq." + encodeURIComponent("קריית ים"))));
  check("קריית ים: שכונה עם גרש בורחת", body.includes("קריית ים ב&#39;") && !body.includes("קריית ים ב'<"));
  check("קריית ים: צ'יפים של שכונות", filters.includes("/n/kiryat-yam/" + encodeURIComponent("קריית-ים-ב")));
  check("קריית ים: הקריות", html.includes('href="/krayot" id="landCityCrumb">קריית ים</a>') && html.includes('href="/deals/kiryat-yam"')
    && html.includes('<script>window.SHUK_MARKET={"slug":"krayot"};</script>'));
  check("קריית ים: noindex", /<meta name="robots" content="noindex,follow">/.test(html) && res.headers.get("X-Robots-Tag") === "noindex, follow");
}

{
  const EMEK = SITE + "/emek-yizrael/" + encodeURIComponent("בתים-ומגרשים");
  const CANON_E = SITE + "/emek-yizrael/%D7%91%D7%AA%D7%99%D7%9D-%D7%95%D7%9E%D7%92%D7%A8%D7%A9%D7%99%D7%9D";
  const H1 = "בתים ומגרשים למכירה ביישובי עמק יזרעאל";
  const DESC = "בתים פרטיים ומגרשים למכירה במושבים וביישובים שסביב עפולה, מכל משרדי התיווך באתר, עם מחיר, גודל ותמונות לכל מודעה פעילה.";
  const INTRO = "בעמוד הזה מרוכזים בתים פרטיים ומגרשים למכירה ביישובים שסביב עפולה, ביניהם היוגב, אומן וחבר. המודעות מתפרסמות על ידי משרדי תיווך שפועלים בעפולה ובעמק, ובכל אחת מופיעים המחיר, הגודל והתמונות כפי שפורסמו. דירות בעפולה עצמה מופיעות בדפים של העיר: בתים פרטיים, דירות גן ודירות 3 חדרים.";
  const FAQ: [string, string][] = [
    ["אילו יישובים כלולים בעמוד?", "היישובים שסביב עפולה שהאתר משייך לאזור עפולה והעמק, ביניהם היוגב, אומן, חבר, גן נר, כפר תבור, תל עדשים, בלפוריה, מרחביה, כפר גדעון, מגן שאול, נורית, גדיש, אביטל ואחוזת ברק. נכסים בעפולה עצמה מופיעים בדפים של העיר."],
    ["מי מפרסם את הנכסים?", "משרדי תיווך שמפרסמים באתר. בדף של כל נכס מופיעים שם המשרד ופרטי הקשר שלו."],
    ["מה כדאי לבדוק לפני קניית מגרש או בית במושב?", "את ייעוד הקרקע וזכויות הבנייה, מול הוועדה המקומית לתכנון ובנייה, ואת תנאי הקבלה ליישוב, שבחלק מהיישובים כוללים הליך קבלה. הפרטים שפורסמו במודעה מופיעים בדף הנכס."],
    ["איפה רואים מחירי עסקאות ביישובים?", "בעמוד עסקאות הנדל״ן לפי יישוב, מתוך דיווחי רשות המסים. ביישוב עם פחות מ-5 עסקאות בשנה האחרונה האתר אינו מציג מחיר חציוני."],
    ["מה עושים אם אין כרגע נכס שמתאים לי?", "אפשר להשאיר התראה ולקבל עדכון כשעולה נכס מתאים באחד מיישובי העמק."],
  ];
  const rows = [
    {
      id: "plot-1",
      title: "מגרש <ב",
      property_type: "מגרש",
      deal_type: "sale",
      price: 900000,
      size_sqm: 500,
      city: "אומן",
      created_at: RECENT,
      updated_at: RECENT,
      images: ["https://obookujgolazrwycsiyn.supabase.co/storage/v1/object/public/property-images/plot.jpg"],
    },
    {
      id: "house-1",
      title: "בית בהיוגב",
      property_type: "בית פרטי/קוטג'",
      deal_type: "sale",
      price: 2100000,
      rooms: 5,
      size_sqm: 160,
      city: "היוגב",
      created_at: RECENT,
      updated_at: RECENT,
      images: [],
    },
  ];
  const res = await run(EMEK, 200, rows);
  const html = await res.text();
  const blocks = ldBlocks(html);
  const graph = blocks.find((b) => Array.isArray(b["@graph"])) as { "@graph": Record<string, unknown>[] } | undefined;
  const gtypes = (graph?.["@graph"] || []).map((b) => b["@type"]);
  const faq = (graph?.["@graph"] || []).find((b) => b["@type"] === "FAQPage") as { mainEntity?: { name: string; acceptedAnswer: { text: string } }[] } | undefined;
  const list = blocks.find((b) => b["@type"] === "ItemList") as { numberOfItems?: number } | undefined;
  const props = urls.filter((u) => u.includes("/properties?"));
  check("עמק: 200 ובלי noindex", res.status === 200 && !/noindex/.test(html) && res.headers.get("X-Robots-Tag") == null);
  check("עמק: כותרת, תיאור ו-H1", html.includes(`<title>${H1} | שוק נדל״ן</title>`)
    && html.includes(`content="${DESC}"`)
    && html.includes(`<h1 id="siloH1">${H1}</h1>`));
  check("עמק: פתיח וחמש שאלות", html.includes(INTRO) && FAQ.every(([q, a]) => html.includes(q) && html.includes(a))
    && (html.match(/<details><summary>/g) || []).length === 5);
  check("עמק: תמונת הבתים הקיימת", html.includes("hero-house-800.webp") && html.includes("hero-house-1600.webp") && !html.includes("hero-emek"));
  check("עמק: canonical מקודד", html.includes(`<link rel="canonical" href="${CANON_E}">`));
  check("עמק: שאילתה על כמה יישובים", props.some((u) => u.includes("city=in.(")
    && u.includes(encodeURIComponent("אומן"))
    && u.includes(encodeURIComponent("היוגב"))
    && u.includes(encodeURIComponent("חבר"))
    && u.includes(encodeURIComponent("מרחביה (מושב)"))
    && u.includes("property_type=in.")
    && u.includes(encodeURIComponent("מגרש"))
    && u.includes(encodeURIComponent("בית פרטי/קוטג'").replace(/'/g, "%27"))));
  check("עמק: בלי עפולה ובלי שדה נחום בשאילתה", !props.some((u) => u.includes("city=eq." + encodeURIComponent("עפולה")) || u.includes(encodeURIComponent("שדה נחום"))));
  check("עמק: בלי שאילתת משרדים", !urls.some((u) => u.includes("/agencies?")));
  check("עמק: JSON-LD", gtypes.includes("CollectionPage") && gtypes.includes("BreadcrumbList") && gtypes.includes("FAQPage")
    && !gtypes.includes("ItemList") && list?.numberOfItems === 2 && blocks.filter((b) => b["@type"] === "WebPage").length === 0);
  const pageLd = (graph?.["@graph"] || []).find((b) => b["@type"] === "CollectionPage") as { url?: string; name?: string; description?: string; isPartOf?: { "@id"?: string }; about?: { name?: string } } | undefined;
  const crumbs = (graph?.["@graph"] || []).find((b) => b["@type"] === "BreadcrumbList") as { itemListElement?: { name: string; item: string }[] } | undefined;
  check("עמק: כתובות ה-JSON-LD", pageLd?.url === CANON_E && pageLd?.name === H1 && pageLd?.description === DESC
    && pageLd?.isPartOf?.["@id"] === SITE + "/#website" && pageLd?.about?.name === "עמק יזרעאל"
    && crumbs?.itemListElement?.[1]?.name === "עפולה והעמק" && crumbs?.itemListElement?.[1]?.item === SITE + "/"
    && crumbs?.itemListElement?.[2]?.name === H1 && crumbs?.itemListElement?.[2]?.item === CANON_E);
  check("עמק: FAQ ב-JSON-LD", JSON.stringify(faq?.mainEntity?.map((q) => [q.name, q.acceptedAnswer.text])) === JSON.stringify(FAQ));
  check("עמק: בלי HTML ב-JSON", html.includes("\\u003c") && !html.includes("מגרש <ב"));
  check("עמק: קישורים לעפולה ולעסקאות", html.includes('href="/afula/בתים-פרטיים"') && html.includes('href="/afula/מתווכים"') && html.includes('href="/deals"')
    && !html.includes("/emek-yizrael/מתווכים"));
  check("עמק: בלי רמז שוק", !html.includes("SHUK_MARKET"));
}

{
  const marker = "<!--other-page-->";
  const res = await run(SITE + "/emek-yizrael/" + encodeURIComponent("מתווכים"), 200, ROWS, marker);
  const html = await res.text();
  check("עמק: אין דף מתווכים", res.status === 200 && html.includes(marker) && !/noindex/.test(html) && calls === 0);
}

{
  const NOF = SITE + "/nof-hagalil/" + encodeURIComponent("דירות-למכירה");
  const row = { ...ROWS[0], id: "nof-1", city: "נוף הגליל", property_type: "דירה", rooms: 4, neighborhoods: null };
  const res = await run(NOF, 200, [row]);
  const html = await res.text();
  const blocks = ldBlocks(html);
  const graph = blocks.find((b) => Array.isArray(b["@graph"])) as { "@graph": { "@type": string }[] } | undefined;
  check("נוף הגליל: 200 ו-noindex", res.status === 200
    && /<meta name="robots" content="noindex,follow">/.test(html)
    && res.headers.get("X-Robots-Tag") === "noindex, follow");
  check("נוף הגליל: כותרת", html.includes("<title>דירות למכירה בנוף הגליל | שוק נדל״ן</title>")
    && html.includes("1,020 עסקאות") && html.includes("hero-apt-800.webp"));
  check("נוף הגליל: שאילתה", urls.some((u) => u.includes("city=eq." + encodeURIComponent("נוף הגליל"))
    && u.includes("property_type=in.")
    && u.includes(encodeURIComponent("דירה"))
    && u.includes(encodeURIComponent("דירת גן"))));
  check("נוף הגליל: JSON-LD", (graph?.["@graph"] || []).map((b) => b["@type"]).join(",") === "CollectionPage,BreadcrumbList,FAQPage");
  check("נוף הגליל: רמז השוק", html.includes('<script>window.SHUK_MARKET={"slug":"nof-hagalil-migdal"};</script>'));
}

{
  const MIG = SITE + "/migdal-haemek/" + encodeURIComponent("דירות-למכירה");
  const row = { ...ROWS[1], id: "mig-1", city: "מגדל העמק", property_type: "דירה", rooms: 3 };
  const res = await run(MIG, 200, [row]);
  const html = await res.text();
  check("מגדל העמק: 200 ו-noindex", res.status === 200
    && /<meta name="robots" content="noindex,follow">/.test(html)
    && res.headers.get("X-Robots-Tag") === "noindex, follow"
    && html.includes("<title>דירות למכירה במגדל העמק | שוק נדל״ן</title>")
    && html.includes("562 עסקאות")
    && urls.some((u) => u.includes("city=eq." + encodeURIComponent("מגדל העמק"))));
}

{
  const SALE = SITE + "/afula/" + encodeURIComponent("דירות-למכירה");
  const row = { ...ROWS[1], id: "apt-1", title: "דירת 4 חדרים", property_type: "דירה", price: 1250000, rooms: 4 };
  const res = await run(SALE, 200, [row]);
  const html = await res.text();
  const blocks = ldBlocks(html);
  const types = blocks.map((b) => b["@type"]);
  check("דירות למכירה: 200", res.status === 200 && html.includes('data-ssr="1"'));
  check("דירות למכירה: כותרת ו-H1", html.includes("<title>דירות למכירה בעפולה | שוק נדל״ן</title>")
    && html.includes('<h1 id="siloH1">דירות למכירה בעפולה</h1>'));
  check("דירות למכירה: canonical", html.includes('<link rel="canonical" href="https://shuknadlan.co.il/afula/דירות-למכירה">'));
  check("דירות למכירה: פתיח", html.includes("דירות למכירה בעפולה מיועצי הנדל״ן והמשרדים בעיר. בכל מודעה מופיעים המחיר, הגודל והתמונות."));
  check("דירות למכירה: תיאור", html.includes("דירות למכירה בעפולה מיועצי הנדל״ן והמשרדים בעיר: מחיר, גודל ותמונות לכל מודעה פעילה, ופנייה מהירה דרך האתר."));
  check("דירות למכירה: FAQ", html.includes("אלה נכסים למכירה בעפולה שיועצי נדל״ן ומשרדים מפרסמים באתר.")
    && html.includes("איפה רואים את המחיר ואת כל הפרטים?")
    && html.includes("בדף של כל נכס מופיעים המחיר שפורסם והמפרט המלא. אם אין מחיר במודעה, אפשר לפנות דרך האתר ולשאול.")
    && html.includes("מה עושים אם אין כרגע מודעות?"));
  const saleFaq = ldBlocks(html).find((b) => b["@type"] === "FAQPage") as { mainEntity?: { name: string; acceptedAnswer: { text: string } }[] } | undefined;
  check("דירות למכירה: FAQPage זהה לטקסט", saleFaq?.mainEntity?.[1]?.name === "איפה רואים את המחיר ואת כל הפרטים?"
    && saleFaq.mainEntity[1].acceptedAnswer.text.startsWith("בדף של כל נכס מופיעים המחיר שפורסם")
    && saleFaq.mainEntity.length === 4);
  check("דירות למכירה: בלי שם ובלי רישיון", !html.includes("תומר") && !html.includes("3134355"));
  check("דירות למכירה: שאילתת דירות", urls.some((u) => u.includes("/properties?")
    && u.includes("city=eq." + encodeURIComponent("עפולה"))
    && u.includes("property_type=in.")
    && u.includes(encodeURIComponent("דירה"))
    && u.includes(encodeURIComponent("גג/פנטהאוז"))
    && !u.includes("rooms=eq.")));
  check("דירות למכירה: JSON-LD", types.includes("WebPage") && types.includes("BreadcrumbList") && types.includes("ItemList") && types.includes("FAQPage"));
  check("דירות למכירה: קישור לנכס", html.includes('href="/property?id=apt-1"'));
}

if (failed) {
  console.error(`\n✗ ${failed} מקרים התנהגו אחרת.`);
  process.exit(1);
}
console.log("\n✓ דפי הנחיתה: מודעות, canonical, 503 בלי noindex, ו-JSON-LD.");
