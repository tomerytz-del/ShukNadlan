/* ============================================================================
   ‏הבדיקה של 14 עמודי התוצאות: מה נכנס לרשימה, ומה בשום אופן לא
   ----------------------------------------------------------------------------
   ‏`netlify/edge-functions/search-pages.ts` מחליטה, לכל בקשה לדף הבית, בין
   שני מצבים שנראים בדפדפן **בדיוק אותו דבר**:

     ‏1. הפרמטרים הם אחד מ-14 הצירופים  → כותרת, תיאור ו-canonical משלו.
     ‏2. כל דבר אחר                      → הדף יוצא כמו שהוא, ומתאחד ל-/.

   שני הכיוונים שקטים כשהם נשברים. בכיוון אחד עמוד תוצאות מצהיר על / ולא
   נכנס לאינדקס לעולם - הבעיה שהקובץ הזה נולד כדי לפתור. בכיוון השני **כל**
   צירוף פרמטרים מקבל canonical עצמי, ואז ‎?minPrice=317000‎ ו-‎?q=כל דבר‎
   הופכים לאינסוף כתובות עם אותו תוכן. אין הבדל נראה לעין בין השניים.

   הרצה:

       node --experimental-strip-types scripts/search_pages_test.ts

   ‏יציאה 0 = הכול תקין. יציאה 1 = מקרה שהתנהג אחרת, והפלט מראה מי.
   התיעוד: ‎docs/search-landing-pages.md‎.
   ========================================================================== */

import handler, { SEARCH_PAGES } from "../netlify/edge-functions/search-pages.ts";

const PAGE = [
  "<!doctype html><html><head>",
  "<title>שוק נדל״ן | עפולה והעמק</title>",
  '<link rel="canonical" href="https://shuknadlan.co.il/">',
  '<meta name="description" content="העסקה הבאה שלך בעפולה מתחילה בשוק הנדל״ן.">',
  '<meta property="og:description" content="העסקה הבאה שלך בעפולה.">',
  "</head><body>x</body></html>",
].join("\n");

const context = () =>
  ({
    next: async () =>
      new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } }),
  }) as never;

const SITE = "https://shuknadlan.co.il";

type Result = {
  untouched: boolean;
  canonical: string | null;
  canonicalCount: number;
  title: string | null;
  heading: string | null;
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

async function serve(url: string): Promise<Result> {
  const res = await handler(new Request(SITE + url), context());
  const html = await res.text();
  return {
    untouched: html === PAGE,
    canonical: decode((html.match(/<link rel="canonical" href="([^"]*)">/) || [])[1]),
    canonicalCount: (html.match(/rel="canonical"/g) || []).length,
    title: decode((html.match(/<title>([^<]*)<\/title>/) || [])[1]),
    heading: decode((html.match(/name="shuk-search-heading" content="([^"]*)"/) || [])[1]),
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
      r.heading === page.title,
    JSON.stringify(r),
  );
}

/* ‏2. אותו עמוד בכתיב אחר - הכתובת הקנונית היא של הרשימה ולא של הבקשה */
const SAME: [string, string][] = [
  ["סדר הפרמטרים הפוך", "/?rooms=4&deal=sale"],
  ["‏src=pwa מהאפליקציה", "/?deal=sale&rooms=4&src=pwa"],
  ["פרמטר קמפיין", "/?utm_source=facebook&deal=sale&rooms=4&utm_medium=cpc"],
  ["‏index.html במקום /", "/index.html?deal=sale&rooms=4"],
];
for (const [name, url] of SAME) {
  const r = await serve(url);
  check(name, r.canonical === `${SITE}/?deal=sale&rooms=4`, JSON.stringify(r));
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

if (failed) {
  console.error(`\n✗ ${failed} מקרים התנהגו אחרת.`);
  process.exit(1);
}
console.log(`\n✓ ${SEARCH_PAGES.length} עמודי תוצאות מוזרקים, וכל צירוף אחר מתאחד לדף הבית.`);
