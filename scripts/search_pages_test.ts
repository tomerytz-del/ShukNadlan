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

/* ‏1. כל צירוף שברשימה מקבל את הכתיב שלו עצמו, כותרת משלו, ותגית אחת */
for (const page of SEARCH_PAGES) {
  const r = await serve("/?" + page.query);
  check(
    `‏${page.title}`,
    r.canonical === `${SITE}/?${page.query}` &&
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
];
for (const [name, url, query] of SAME) {
  const r = await serve(url);
  const page = SEARCH_PAGES.find((p) => p.query === query)!;
  check(
    name,
    r.canonical === `${SITE}/?${query}` && r.h1 === page.title && r.h1Count === 1,
    JSON.stringify(r),
  );
}

/* ‏עברית גולמית בכתובת (מה שדפדפן שולח כשמדביקים קישור מווטסאפ) */
{
  const hebrew = SEARCH_PAGES.find((p) => p.query.includes("%D7%93"))!;
  const r = await serve("/?deal=sale&ptype=דירת גן");
  check("עברית לא מקודדת", r.canonical === `${SITE}/?${hebrew.query}`, JSON.stringify(r));
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
      live.canonical === `${SITE}/?${offices.query}`,
    JSON.stringify({ h1: live.h1, h1Count: live.h1Count, citySlot: live.citySlot, title: live.title }),
  );
  check("דף הבית האמיתי יוצא כמו שהוא", home.untouched && home.h1 !== offices.title, `h1=${home.h1}`);
}

if (failed) {
  console.error(`\n✗ ${failed} מקרים התנהגו אחרת.`);
  process.exit(1);
}
console.log(`\n✓ ${SEARCH_PAGES.length} עמודי תוצאות מוזרקים, וכל צירוף אחר מתאחד לדף הבית.`);
