/* ============================================================================
   ‏הבדיקה של עמודי התוצאות: מה נכנס לרשימה, ומה בשום אופן לא
   ----------------------------------------------------------------------------
   ‏`netlify/edge-functions/search-pages.ts` מחליטה, לכל בקשה לדף הבית, בין
   שני מצבים שנראים בדפדפן **בדיוק אותו דבר**:

     ‏1. הפרמטרים הם צירוף מהרשימה  → כותרת, תיאור, H1 ו-canonical משלו.
     ‏2. כל דבר אחר                 → הדף יוצא כמו שהוא, ומתאחד ל-/.

   שני הכיוונים שקטים כשהם נשברים. בכיוון אחד עמוד תוצאות מצהיר על / ולא
   נכנס לאינדקס לעולם - הבעיה שהקובץ הזה נולד כדי לפתור. בכיוון השני **כל**
   צירוף פרמטרים מקבל canonical עצמי, ואז ‎?minPrice=317000‎ ו-‎?q=כל דבר‎
   הופכים לאינסוף כתובות עם אותו תוכן. אין הבדל נראה לעין בין השניים.

   הרצה:

       node --experimental-strip-types scripts/search_pages_test.ts

   ‏יציאה 0 = הכול תקין. יציאה 1 = מקרה שהתנהג אחרת, והפלט מראה מי.
   התיעוד: ‎docs/search-landing-pages.md‎.
   ========================================================================== */

import { readFileSync } from "node:fs";
import handler, { SEARCH_PAGES } from "../netlify/edge-functions/search-pages.ts";

/* ‏אותו מבנה H1 כמו ב-index.html: שם עיר שהסקריפט מחליף, וכפתור בורר השוק.
   עמוד תוצאות חייב להחליף את הטקסט, להוריד את ‎#heroCityName‎ (אחרת
   הסקריפט מחליף את הכותרת אחרי הטעינה) ולהשאיר כפתור אחד. */
const H1 =
  '<h1>כל הנכסים ב<span id="heroCityName">עפולה והעמק</span>' +
  '<button type="button" class="mkt-menu-btn" data-market-menu hidden aria-label="בחירת אזור">' +
  "<svg></svg></button> <span class=\"hero-h1-break\">בכתובת אחת</span></h1>";

const PAGE = [
  "<!doctype html><html><head>",
  "<title>שוק נדל״ן | עפולה והעמק</title>",
  '<link rel="canonical" href="https://shuknadlan.co.il/">',
  '<meta name="description" content="העסקה הבאה שלך בעפולה מתחילה בשוק הנדל״ן.">',
  '<meta property="og:description" content="העסקה הבאה שלך בעפולה.">',
  /* ‏מאז 9.10.2026 דף הבית נושא og:title ו-og:url משלו - ועמוד תוצאות
     חייב להחליף אותם, לא להוסיף עוד אחד לצדם */
  '<meta property="og:title" content="שוק נדל״ן | עפולה והעמק">',
  '<meta property="og:url" content="https://shuknadlan.co.il/">',
  "</head><body>",
  H1,
  "<p>x</p></body></html>",
].join("\n");

const REAL = readFileSync(new URL("../index.html", import.meta.url), "utf8");

const contextFor = (html: string) =>
  ({
    next: async () =>
      new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } }),
  }) as never;

const context = () => contextFor(PAGE);

const SITE = "https://shuknadlan.co.il";

type Result = {
  untouched: boolean;
  canonical: string | null;
  canonicalCount: number;
  title: string | null;
  heading: string | null;
  h1: string | null;
  h1Count: number;
  citySlot: boolean;
  marketButtonInH1: boolean;
  ogTitles: string[];
  ogUrls: string[];
};

/* ‏מה שדפדפן קורא מהמאפיין. ‏‎&‎ בתוך ‎href="…"‎ **חייב** להיכתב ‎&amp;‎
   (וגרש כ-‎&#39;‎), וההשוואה כאן היא לערך אחרי הפענוח - כלומר למה שגוגל
   מקבלת, ולא לבייטים שבקובץ. */
function decode(s: string | undefined): string | null {
  if (s === undefined) return null;
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function h1Text(html: string): string | null {
  const m = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (!m) return null;
  const text = decode(m[1].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
  return text;
}

async function serve(url: string, html = PAGE): Promise<Result> {
  const res = await handler(new Request(SITE + url), contextFor(html));
  const body = await res.text();
  const h1 = body.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/i);
  return {
    untouched: body === html,
    canonical: decode((body.match(/<link rel="canonical" href="([^"]*)">/) || [])[1]),
    canonicalCount: (body.match(/rel="canonical"/g) || []).length,
    title: decode((body.match(/<title>([^<]*)<\/title>/) || [])[1]),
    heading: decode((body.match(/name="shuk-search-heading" content="([^"]*)"/) || [])[1]),
    h1: h1Text(body),
    h1Count: (body.match(/<h1\b/gi) || []).length,
    citySlot: /id="heroCityName"/.test(body),
    marketButtonInH1: !!h1 && /data-market-menu/.test(h1[0]),
    ogTitles: [...body.matchAll(/property="og:title" content="([^"]*)"/g)].map((m) => decode(m[1])!),
    ogUrls: [...body.matchAll(/property="og:url" content="([^"]*)"/g)].map((m) => decode(m[1])!),
  };
}

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : "   " + detail}`);
}

/* דף נחיתה מחליף את כתובת הסינון. בלי שדה landing הכתובת היא הסינון עצמו. */
function canonOf(page: { query: string; landing?: string }): string {
  return page.landing ? `${SITE}${page.landing}` : `${SITE}/?${page.query}`;
}

/* ‏1. כל צירוף שברשימה מקבל את הכתיב שלו עצמו, כותרת משלו, ותגית אחת */
for (const page of SEARCH_PAGES) {
  const r = await serve("/?" + page.query);
  check(
    `‏${page.title}`,
    r.canonical === canonOf(page) &&
      r.canonicalCount === 1 &&
      r.title === `${page.title} | שוק נדל״ן` &&
      r.heading === page.title &&
      r.h1 === page.title &&
      r.h1Count === 1 &&
      !r.citySlot &&
      r.marketButtonInH1 &&
      r.ogTitles.length === 1 && r.ogTitles[0] === r.title &&
      r.ogUrls.length === 1 && r.ogUrls[0] === r.canonical,
    JSON.stringify(r),
  );
}

/* ‏2. אותו עמוד בכתיב אחר - הכתובת הקנונית היא של הרשימה ולא של הבקשה */
const SAME: [string, string, string][] = [
  ["סדר הפרמטרים הפוך", "/?rooms=4&deal=sale", "deal=sale&rooms=4"],
  ["‏src=pwa מהאפליקציה", "/?deal=sale&rooms=4&src=pwa", "deal=sale&rooms=4"],
  ["פרמטר קמפיין", "/?utm_source=facebook&deal=sale&rooms=4&utm_medium=cpc", "deal=sale&rooms=4"],
  ["‏gclid של גוגל אדס", "/?deal=commercial&ptype=%D7%9E%D7%A9%D7%A8%D7%93%D7%99%D7%9D&gclid=test", "deal=commercial&ptype=%D7%9E%D7%A9%D7%A8%D7%93%D7%99%D7%9D"],
  ["‏gad_source ליד gclid", "/?deal=sale&gclid=abc&gad_source=1&gad_campaignid=9", "deal=sale"],
  ["‏index.html במקום /", "/index.html?deal=sale&rooms=4", "deal=sale&rooms=4"],
  /* ‏A-SEO-3 (PR 1010): ‏beta=1 מדליק תצוגה בדפדפן ואינו תוכן - עמוד ברשימה שומר את הכותרת וה-canonical */
  ["דגל v10 על עמוד ברשימה", "/?deal=sale&rooms=4&beta=1", "deal=sale&rooms=4"],
];
for (const [name, url, query] of SAME) {
  const r = await serve(url);
  const page = SEARCH_PAGES.find((p) => p.query === query)!;
  check(
    name,
    r.canonical === canonOf(page) && r.h1 === page.title && r.h1Count === 1,
    JSON.stringify(r),
  );
}

/* עמוד "דירות…" נפתח על "דירות" (‏shuk-search-type), ועמוד מסחרי - לא */
{
  const sale = await serve("/?deal=sale");
  const comm = await serve("/?deal=commercial");
  const typeOf = async (u: string) => {
    const res = await handler(new Request(SITE + u), contextFor(PAGE));
    return ((await res.text()).match(/name="shuk-search-type" content="([^"]*)"/) || [])[1] || null;
  };
  check("דירות למכירה נפתח על flats", sale.heading !== null && (await typeOf("/?deal=sale")) === "flats");
  check("נכסים מסחריים - בלי סוג", comm.heading !== null && (await typeOf("/?deal=commercial")) === null);
}

/* ‏עברית גולמית בכתובת (מה שדפדפן שולח כשמדביקים קישור מווטסאפ) */
{
  const hebrew = SEARCH_PAGES.find((p) => p.query.includes("%D7%93"))!;
  const r = await serve("/?deal=sale&ptype=דירת גן");
  check("עברית לא מקודדת", r.canonical === canonOf(hebrew), JSON.stringify(r));
}

/* גרש גולמי, %27 וגרש עברי (׳) של בית פרטי/קוטג' הם אותה כתובת */
{
  const house = SEARCH_PAGES.find((p) => p.landing === "/afula/בתים-פרטיים")!;
  const raw = house.query.replace("%27", "'");
  const geresh = house.query.replace("%27", "%D7%B3");
  const a = await serve("/?" + raw);
  const b = await serve("/?" + house.query);
  const c = await serve("/?" + geresh);
  check(
    "קוטג' ו-%27 וגרש עברי לאותו canonical",
    a.canonical === canonOf(house) && b.canonical === a.canonical && c.canonical === a.canonical,
    JSON.stringify({ a: a.canonical, b: b.canonical, c: c.canonical }),
  );
}

/* ‏עיר על עמוד שכבר ברשימה: הכותרת של העיר, וה-canonical נשאר של העמוד (בלי העיר ובלי utm) */
{
  const rooms = SEARCH_PAGES.find((p) => p.query === "deal=sale&rooms=3")!;
  const city = encodeURIComponent("עפולה");
  const r = await serve(`/?deal=sale&rooms=3&city=${city}&utm_source=google&utm_campaign=3rooms&gclid=abc`);
  const desc = decode((await handler(
    new Request(`${SITE}/?deal=sale&rooms=3&city=${city}`),
    context(),
  ).then((res) => res.text())).match(/name="description" content="([^"]*)"/)?.[1]);
  check(
    "עיר על עמוד מוכר: כותרת של העיר, canonical של הרשימה",
    r.canonical === canonOf(rooms) &&
      r.canonicalCount === 1 &&
      r.h1 === "דירות 3 חדרים למכירה בעפולה" &&
      r.heading === "דירות 3 חדרים למכירה בעפולה" &&
      r.title === "דירות 3 חדרים למכירה בעפולה | שוק נדל״ן" &&
      r.ogTitles.length === 1 && r.ogTitles[0] === r.title &&
      r.ogUrls.length === 1 && r.ogUrls[0] === r.canonical &&
      desc === "כל דירות 3 החדרים שמוצעות היום למכירה בעפולה, מכל משרדי התיווך באזור, עם מחיר, תמונות ופרטי קשר ישירים." &&
      !r.citySlot,
    JSON.stringify({ ...r, desc }),
  );
}
{
  const rooms = SEARCH_PAGES.find((p) => p.query === "deal=sale&rooms=3")!;
  const r = await serve("/?deal=sale&rooms=3&city=" + encodeURIComponent("מגדל העמק"));
  check(
    "עיר אחרת מחליפה את העמק בכותרת",
    r.h1 === "דירות 3 חדרים למכירה במגדל העמק" &&
      r.heading === r.h1 &&
      r.canonical === canonOf(rooms),
    JSON.stringify(r),
  );
}
{
  const base = SEARCH_PAGES.find((p) => p.query === "deal=sale&rooms=3")!;
  const plain = await serve("/?deal=sale&rooms=3");
  const bad = await serve("/?deal=sale&rooms=3&city=" + encodeURIComponent("<script>"));
  const upper = await serve("/?deal=sale&q=" + encodeURIComponent("עפולה עילית") + "&city=" + encodeURIComponent("נוף הגליל"));
  const upperPage = SEARCH_PAGES.find((p) => p.title === "נכסים למכירה בעפולה עילית")!;
  check("בלי עיר נשאר העמק", plain.h1 === base.title, plain.h1 || "");
  check("עיר לא תקינה אינה משנה כותרת", bad.h1 === base.title && bad.canonical === canonOf(base), bad.h1 || "");
  check(
    "עפולה עילית אינה מתקצרת לעיר",
    upper.h1 === upperPage.title,
    upper.h1 || "",
  );
}
{
  const only = await serve("/?city=" + encodeURIComponent("עפולה"));
  const extra = await serve("/?deal=sale&rooms=4&page=3&city=" + encodeURIComponent("עפולה"));
  check("עיר לבדה אינה עמוד באינדקס", only.untouched, JSON.stringify(only));
  check("צירוף שאינו ברשימה נשאר כמו שהוא גם עם עיר", extra.untouched, JSON.stringify(extra));
}

/* ‏3. מה שחייב לצאת כמו שהוא: הדף מצהיר על / ומתאחד אליו */
const UNTOUCHED: [string, string][] = [
  ["דף הבית עצמו", "/"],
  ["דף הבית עם src בלבד", "/?src=pwa"],
  ["‏gclid בלי תוכן", "/?gclid=test&utm_source=google"],
  ["השכרה בלי סינון נוסף", "/?deal=rent"],
  ["צירוף שאינו ברשימה", "/?deal=sale&rooms=2"],
  ["ערך חופשי שמישהו הקליד", "/?deal=sale&q=משהו אחר"],
  ["מחיר שרירותי", "/?deal=sale&maxPrice=1317000"],
  ["צירוף ברשימה ועוד פרמטר", "/?deal=sale&rooms=4&page=3"],
  ["פרמטר סינון נוסף", "/?deal=sale&rooms=4&ai=1"],
  /* דגל v10 (‏docs/home-page-sections.md): התצוגה החדשה אינה כתובת חדשה */
  ["דגל v10 בדף הבית", "/?beta=1"],
  ["כיבוי דגל v10", "/?beta=0"],
];
for (const [name, url] of UNTOUCHED) {
  const r = await serve(url);
  check(name + " - יוצא כמו שהוא", r.untouched, JSON.stringify(r));
}

/* ‏4. הרשימה עצמה: כתיב קנוני יחיד לכל צירוף, וכותרות שונות זו מזו */
{
  const queries = new Set(SEARCH_PAGES.map((p) => p.query));
  check("אין צירוף כפול", queries.size === SEARCH_PAGES.length);
  const titles = new Set(SEARCH_PAGES.map((p) => p.title));
  check("אין שתי כותרות זהות", titles.size === SEARCH_PAGES.length);
  const descriptions = new Set(SEARCH_PAGES.map((p) => p.description));
  check("אין שני תיאורים זהים", descriptions.size === SEARCH_PAGES.length);
  check(
    "כל כותרת עד 60 תווים",
    SEARCH_PAGES.every((p) => `${p.title} | שוק נדל״ן`.length <= 60),
    SEARCH_PAGES.map((p) => `${p.title.length}`).join(","),
  );
  check(
    "כל תיאור בין 70 ל-160 תווים",
    SEARCH_PAGES.every((p) => p.description.length >= 70 && p.description.length <= 160),
    SEARCH_PAGES.map((p) => `${p.description.length}`).join(","),
  );
}

/* ‏5. ה-HTML האמיתי של דף הבית: ה-H1 שגולש/ת מקבל/ת, ודף הבית בלי שינוי */
{
  const offices = SEARCH_PAGES.find((p) => p.query.startsWith("deal=commercial&ptype="))!;
  const live = await serve("/?" + offices.query, REAL);
  const home = await serve("/", REAL);
  check(
    "‏H1 ב-index.html האמיתי",
    live.h1 === offices.title &&
      live.h1Count === 1 &&
      !live.citySlot &&
      live.marketButtonInH1 &&
      live.title === `${offices.title} | שוק נדל״ן` &&
      live.canonical === canonOf(offices),
    JSON.stringify({ h1: live.h1, h1Count: live.h1Count, citySlot: live.citySlot, title: live.title }),
  );
  check("דף הבית האמיתי יוצא כמו שהוא", home.untouched && home.h1 !== offices.title, `h1=${home.h1}`);
}

{
  const res = await handler(new Request(`${SITE}/?deal=sale&rooms=4&utm_source=google&gclid=abc`), contextFor(PAGE));
  await res.text();
  const vary = res.headers.get("Netlify-Vary") || "";
  const cdn = res.headers.get("Netlify-CDN-Cache-Control") || "";
  check(
    "עמוד תוצאות: אותו Vary ו-s-maxage",
    vary.includes("cookie=shuk_market|shuk_soon") && vary.includes("query=deal|") && !vary.includes("utm")
      && cdn.includes("s-maxage=3600") && cdn.includes("stale-while-revalidate=600")
      && res.headers.get("Cache-Control") === "public, max-age=0, must-revalidate"
      && !(res.headers.get("CDN-Cache-Control") || "").includes("s-maxage"),
    vary + " | " + cdn + " | " + res.headers.get("Cache-Control"),
  );
  const plain = await handler(new Request(`${SITE}/`), contextFor(PAGE));
  await plain.text();
  const missed = await handler(new Request(`${SITE}/?q=לא-ברשימה`), contextFor(PAGE));
  await missed.text();
  const other = await handler(
    new Request(`${SITE}/`),
    { next: async () => new Response("{}", { headers: { "content-type": "application/json" } }) } as never,
  );
  const broken = await handler(
    new Request(`${SITE}/?deal=sale&rooms=4`),
    {
      next: async () => {
        const r = new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
        r.text = async () => { throw new Error("read failed"); };
        return r;
      },
    } as never,
  );
  const brokenHtml = await broken.text();
  check(
    "כשל קריאה: גוף חדש ו-Vary",
    broken.status === 200 && brokenHtml === PAGE
      && (broken.headers.get("Netlify-Vary") || "").includes("cookie=shuk_market|shuk_soon")
      && broken.headers.get("Netlify-CDN-Cache-Control") === "no-store",
    String(broken.status) + " " + brokenHtml.slice(0, 40),
  );
  check(
    "יציאה בלי עמוד תוצאות: אותו Vary",
    (plain.headers.get("Netlify-Vary") || "").includes("cookie=shuk_market|shuk_soon")
      && (missed.headers.get("Netlify-Vary") || "").includes("cookie=shuk_market|shuk_soon")
      && (other.headers.get("Netlify-Vary") || "").includes("cookie=shuk_market|shuk_soon")
      && !plain.headers.get("Netlify-CDN-Cache-Control"),
  );
}

if (failed) {
  console.error(`\n✗ ${failed} מקרים התנהגו אחרת.`);
  process.exit(1);
}
console.log(`\n✓ ${SEARCH_PAGES.length} עמודי תוצאות מוזרקים, וכל צירוף אחר מתאחד לדף הבית.`);
