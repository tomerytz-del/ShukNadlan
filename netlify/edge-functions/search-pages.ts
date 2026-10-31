/* ============================================================================
   ‏16 עמודי תוצאות — כותרת, תיאור, H1 ו-canonical משלהם, מוזרקים בשרת
   ----------------------------------------------------------------------------
   ## הבעיה

   בפוטר של 21 דפים יושב הבלוק "חיפושים פופולריים בעפולה והעמק", ובו 14
   קישורים לתוצאות מסוננות (‏‎/?deal=sale&rooms=4‎ וחבריו). ההערה בקוד
   אומרת למה הוא שם: **"זה הבלוק שמאפשר למנוע החיפוש להגיע לעמודי תוצאות
   ולא רק לדף הבית הכללי".**

   הוא לא עשה את זה. ‏Search Console דיווח על חמש מהכתובות האלה תחת
   "נסרק - לא נכלל באינדקס כרגע", וזו הייתה החלטה נכונה של גוגל: כל 14
   הכתובות מגישות את **אותו HTML בדיוק** — אותה כותרת, אותו תיאור, ומאז
   ‏PR ‎#358 גם אותה תגית ‎canonical‎ שמצביעה על ‎/‎. כלומר הדף עצמו הצהיר
   "אני העתק של דף הבית", והן לא יכלו להתאנדקס לעולם.

   ## מה הפונקציה עושה

   רצה על ה-edge לפני שדף הבית יוצא, בודקת אם הפרמטרים בכתובת הם אחד מ-16
   הצירופים שברשימה למטה, ואם כן מחליפה את ה-‎<title>‎, את התיאור, את
   ה-‎canonical‎ ואת ה-‎<h1>‎ בשלה. ‏HTML אחד מגיש מעכשיו 17 דפים: דף הבית
   ו-16 עמודי תוצאות, לכל אחד כתובת אחת משלו. ה-H1 הוא נושא הכותרת (בלי
   שם האתר), כי דף נחיתה של מודעה נמדד גם לפי הכותרת שגולש/ת רואה.

   ## הרשימה סגורה, וזה העיקר

   ‏**כל צירוף שאינו ברשימה יוצא כמו שהוא** — כלומר עם ה-‎canonical‎ של דף
   הבית, ומתאחד אליו. זו ההגנה מפני הכשל ההפוך: ‎?deal=sale&rooms=4&page=3‎,
   ‎?q=כל דבר שמישהו הקליד‎ ו-‎?minPrice=317000‎ הם אינסוף כתובות עם אותו
   תוכן, ו-canonical עצמי לכל אחת מהן היה מציף את האינדקס במשוכפל.

   ‏**14 נבחרו כי מישהו כתב להן קישור** — הן מקושרות מהפוטר, יש להן ביקוש
   בחיפוש, והניסוח שלהן נבדק. ‎scripts/check_canonical.py‎ מוודא שהשלושה
   מסכימים: הרשימה כאן, הקישורים בפוטר, והשורות ב-‎sitemap.xml‎. קישור חדש
   בפוטר בלי שורה כאן הוא ממצא, ולהפך.

   ## שלוש החלטות

   ‏**1. ההשוואה מנורמלת, והכתובת הקנונית היא של הרשימה.** ‎?rooms=4&deal=sale‎,
   ‎?deal=sale&rooms=4&src=pwa‎ ו-‎?deal=sale&ptype=דירת גן‎ בעברית גולמית
   הם אותו עמוד — סדר הפרמטרים, פרמטרי מעקב וצורת הקידוד אינם תוכן. כולם
   מצהירים על הכתיב שברשימה, ולכן שיתוף מקמפיין אינו יוצר כתובת שנייה.

   ‏**2. הכותרת נכתבת פעם אחת, כאן.** אותו ‎title‎ נכנס ל-‎<title>‎, ל-H1
   ול-‎<meta name="shuk-search-heading">‎. הדף אינו מחזיק עותק של הרשימה:
   את התגית הוא קורא ומציג מעל התוצאות (‏‎renderSearchRows‎ ב-‎assets/home.js‎,
   כותרת ‎h2‎ ולא ‎h1‎ שני). שתי רשימות שצריכות להסכים הן רשימה אחת
   שמתיישנת — הכלל שכבר נלמד ב-‎maskHouseNumber‎.

   ה-H1 המוזרק אינו כולל את ‎#heroCityName‎. הסקריפט שאחרי ה-H1 בדף הבית
   כותב לשם את שם השוק, ובעמוד תוצאות זה היה מחליף את הכותרת אחרי הטעינה.

   ‏**3. כישלון אינו שובר דף.** אין כאן קריאת רשת בכלל (הרשימה סטטית),
   וכל מסלול שאינו התאמה מדויקת מחזיר את התשובה המקורית בלי לקרוא את הגוף.
   דף הבית עצמו — הכתובת הנפוצה ביותר באתר — יוצא מכאן בלי שנגענו בו.

   ## מטמון

   שעה ב-CDN עם ‎stale-while-revalidate‎ ליממה: התוכן כאן נגזר מהכתובת
   בלבד ואינו תלוי במסד, ולכן הוא מתיישן רק כשמשנים את הקובץ הזה.
   ‏Netlify מפתח את המטמון לפי הכתובת המלאה, כולל הפרמטרים.

   התיעוד: ‎docs/search-landing-pages.md‎.
   ========================================================================== */

import type { Config, Context } from "https://edge.netlify.com/v1/index.ts";
import { decide, registry } from "./lib/markets.ts";

const SITE = "https://shuknadlan.co.il";
const SITE_NAME = "שוק נדל״ן";

export type SearchPage = {
  /* הכתיב הקנוני של הפרמטרים. זו הכתובת שנכנסת ל-canonical ול-sitemap,
     אלא אם יש landing: אז שתי צורות הקידוד של הסינון מצהירות על הדף ההוא. */
  query: string;
  title: string;
  description: string;
  landing?: string;
  /* סוג הנכס שהעמוד נפתח עליו, כשהכותרת מבטיחה אותו ("דירות למכירה"):
     ‏flats = דירה, דירת גן וגג/פנטהאוז (‏chipOnly ב-sentence-search.js).
     בלעדיו ‎?deal=sale‎ הציג גם מגרשים ומשרדים מתחת לכותרת "דירות".
     נכתב ל-‎<meta name="shuk-search-type">‎ ואינו משנה את הכתובת. */
  type?: "flats";
};

/* ‏16 הצירופים שמקושרים מבלוק "חיפושים פופולריים" בפוטר. הוספה כאן מחייבת
   קישור בפוטר ושורה ב-sitemap.xml — ‎check_canonical.py‎ חוסם אחרת.
   ‏‎deal=sale‎ ו-‎deal=commercial‎ לבדם הם דפי הנחיתה הרחבים (דירות למכירה,
   נכסים מסחריים). ‏‎deal=rent‎ לבדו אינו כאן: המלאי דל, והרשימה נשארת סגורה. */
export const SEARCH_PAGES: SearchPage[] = [
  {
    query: "deal=sale",
    type: "flats",
    title: "דירות למכירה בעפולה והעמק",
    description: "כל הדירות שמוצעות היום למכירה בעפולה ובעמק יזרעאל, מכל משרדי התיווך באזור, עם מחיר, תמונות ופרטי קשר ישירים.",
    landing: "/afula/דירות-למכירה",
  },
  {
    query: "deal=sale&rooms=3",
    type: "flats",
    title: "דירות 3 חדרים למכירה בעפולה והעמק",
    description: "כל דירות 3 החדרים שמוצעות היום למכירה בעפולה ובעמק יזרעאל, מכל משרדי התיווך באזור, עם מחיר, תמונות ופרטי קשר ישירים.",
    landing: "/afula/דירות-3-חדרים",
  },
  {
    query: "deal=sale&rooms=4",
    type: "flats",
    title: "דירות 4 חדרים למכירה בעפולה והעמק",
    description: "כל דירות 4 החדרים שמוצעות היום למכירה בעפולה ובעמק יזרעאל, מכל משרדי התיווך באזור, עם מחיר, תמונות ופרטי קשר ישירים.",
  },
  {
    query: "deal=sale&rooms=5",
    type: "flats",
    title: "דירות 5 חדרים למכירה בעפולה והעמק",
    description: "כל דירות 5 החדרים שמוצעות היום למכירה בעפולה ובעמק יזרעאל, מכל משרדי התיווך באזור, עם מחיר, תמונות ופרטי קשר ישירים.",
  },
  {
    query: "deal=sale&maxPrice=1500000",
    title: "נכסים למכירה בעפולה עד 1.5 מיליון ₪",
    description: "כל הנכסים שמוצעים היום למכירה בעפולה ובעמק במחיר של עד 1.5 מיליון ₪, מכל משרדי התיווך באזור, עם מחיר ותמונות.",
  },
  {
    query: "deal=sale&ptype=%D7%93%D7%99%D7%A8%D7%AA%20%D7%92%D7%9F",
    title: "דירות גן למכירה בעפולה והעמק",
    description: "כל דירות הגן שמוצעות היום למכירה בעפולה ובעמק יזרעאל, מכל משרדי התיווך באזור, עם מחיר, גודל, תמונות ופרטי קשר.",
    landing: "/afula/דירות-גן",
  },
  {
    query: "deal=sale&ptype=%D7%92%D7%92%2F%D7%A4%D7%A0%D7%98%D7%94%D7%90%D7%95%D7%96",
    title: "פנטהאוזים ודירות גג למכירה בעפולה",
    description: "כל הפנטהאוזים ודירות הגג שמוצעים היום למכירה בעפולה ובעמק יזרעאל, מכל משרדי התיווך באזור, עם מחיר ותמונות.",
  },
  {
    query: "deal=sale&ptype=%D7%91%D7%99%D7%AA%20%D7%A4%D7%A8%D7%98%D7%99%2F%D7%A7%D7%95%D7%98%D7%92%27",
    title: "בתים פרטיים וקוטג׳ים למכירה בעפולה והעמק",
    landing: "/afula/בתים-פרטיים",
    description: "כל הבתים הפרטיים והקוטג׳ים שמוצעים היום למכירה בעפולה ובעמק יזרעאל, מכל משרדי התיווך באזור, עם מחיר, גודל ותמונות.",
  },
  {
    query: "deal=sale&q=%D7%92%D7%91%D7%A2%D7%AA%20%D7%94%D7%9E%D7%95%D7%A8%D7%94",
    title: "נכסים למכירה בגבעת המורה, עפולה",
    description: "כל הנכסים שמוצעים היום למכירה בשכונת גבעת המורה בעפולה, מכל משרדי התיווך באזור, עם מחיר, תמונות ופרטי קשר ישירים.",
  },
  {
    query: "deal=sale&q=%D7%A2%D7%A4%D7%95%D7%9C%D7%94%20%D7%A2%D7%99%D7%9C%D7%99%D7%AA",
    title: "נכסים למכירה בעפולה עילית",
    description: "כל הנכסים שמוצעים היום למכירה בעפולה עילית, מכל משרדי התיווך באזור, עם מחיר, תמונות ופרטי קשר ישירים.",
  },
  {
    query: "deal=rent&rooms=3",
    type: "flats",
    title: "דירות 3 חדרים להשכרה בעפולה והעמק",
    description: "כל דירות 3 החדרים שמוצעות היום להשכרה בעפולה ובעמק יזרעאל, מכל משרדי התיווך באזור, עם שכר דירה, תמונות ופרטי קשר.",
  },
  {
    query: "deal=rent&rooms=4",
    type: "flats",
    title: "דירות 4 חדרים להשכרה בעפולה והעמק",
    description: "כל דירות 4 החדרים שמוצעות היום להשכרה בעפולה ובעמק יזרעאל, מכל משרדי התיווך באזור, עם שכר דירה, תמונות ופרטי קשר.",
  },
  {
    query: "deal=rent&maxPrice=4000",
    type: "flats",
    title: "דירות להשכרה בעפולה עד 4,000 ₪ לחודש",
    description: "כל הדירות שמוצעות היום להשכרה בעפולה ובעמק בשכר דירה של עד 4,000 ₪ לחודש, מכל משרדי התיווך באזור, עם תמונות ופרטי קשר.",
  },
  {
    query: "deal=commercial",
    title: "נכסים מסחריים בעפולה והעמק",
    description: "כל הנכסים המסחריים שמוצעים היום בעפולה ובעמק יזרעאל, מכל משרדי התיווך באזור, עם מחיר, גודל ופרטי קשר ישירים.",
  },
  {
    query: "deal=commercial&ptype=%D7%9E%D7%A9%D7%A8%D7%93%D7%99%D7%9D",
    title: "משרדים להשכרה בעפולה והעמק",
    description: "כל המשרדים ושטחי המשרד שמוצעים היום בעפולה ובעמק יזרעאל, מכל משרדי התיווך באזור, עם מחיר, גודל ופרטי קשר ישירים.",
  },
  {
    query: "deal=commercial&ptype=%D7%97%D7%A0%D7%95%D7%99%D7%95%D7%AA%2F%D7%A9%D7%98%D7%97%20%D7%9E%D7%A1%D7%97%D7%A8%D7%99",
    title: "חנויות ושטחי מסחר בעפולה והעמק",
    description: "כל החנויות ושטחי המסחר שמוצעים היום בעפולה ובעמק יזרעאל, מכל משרדי התיווך באזור, עם מחיר, גודל ופרטי קשר ישירים.",
  },
];

/* ---------- עזרים ---------- */

/* אותה בריחה כמו assets/esc.js. הערכים כאן הם שלנו ולא מהמסד, אבל הם
   נכנסים ל-content="…" ולכן עוברים בה כמו כל ערך אחר. */
function esc(s: unknown): string {
  return String(s === null || s === undefined ? "" : s)
    .replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
    );
}

/* ‏פרמטרים שאינם תוכן: מאיפה הגיעו, לא מה מציגים. ‎src‎ הוא של האתר עצמו
   (‏PWA, קמפיינים פנימיים), והשאר הם מה שרשתות הפרסום מדביקות. */
/* ‏gad_source ו-gad_campaignid הם מה שגוגל אדס מדביקה ליד gclid. בלי זה
   קליק ממודה היה מאבד את הכותרת ואת ה-H1 ומתאחד לדף הבית. */
const NOT_CONTENT = new Set([
  "src", "fbclid", "gclid", "gbraid", "wbraid", "gad_source", "gad_campaignid", "msclkid", "ref",
  /* אזור מפורש בקישור קמפיין. decide() מטפל בו ומוריד אותו מהכתובת. */
  "region",
  /* ‏A-SEO-3 (PR 1010): ‏?beta=1 מדליק את העיצוב החדש בדפדפן ואינו תוכן - בלעדיו
     ‏/?deal=sale&beta=1 איבד את הכותרת וה-canonical של עמוד התוצאות */
  "beta",
]);

/* ‏המפתח שמשווים לפיו: זוגות מפוענחים, ממוינים, בלי פרמטרי מעקב. כך
   ‎?rooms=4&deal=sale‎, ‎?deal=sale&rooms=4&src=pwa‎ וקידוד עברית גולמי
   נופלים כולם על אותה שורה ברשימה. */
function contentKey(params: URLSearchParams, drop?: ReadonlySet<string>): string {
  const pairs: string[] = [];
  for (const [key, raw] of params) {
    if (NOT_CONTENT.has(key) || key.startsWith("utm_") || drop?.has(key)) continue;
    /* גרש, גרשיים עבריים ו-%27 הם אותו סוג נכס. בלי זה
       בית פרטי/קוטג' ו-קוטג%27 נופלים לשתי כתובות. */
    const value = raw.trim().replace(/[\u2018\u2019\u05f3']/g, "'");
    if (!value) continue;
    pairs.push(`${key}=${value}`);
  }
  return pairs.sort().join("&");
}

/* מפתח התוכן, כולל city. הפניה לשוק המקומי רצה רק כשאין שום תוכן,
   ו-?city=עפולה לבדה אינה דף הבית הריק. */
function matchKey(params: URLSearchParams): string {
  return contentKey(params);
}

/* city= מסנן את הרשימה (sentence-search) ואינו צירוף חדש ברשימה הסגורה.
   בחיפוש העמוד הוא יורד, כדי ש-?deal=sale&rooms=3&city=עפולה יישאר העמוד
   של 3 חדרים. ה-canonical נשאר בלי העיר ובלי utm. */
const CITY_PARAM = new Set(["city"]);

/* עיר לכותרת: עברית, רווח, גרש ומקף. ערך אחר אינו משנה את הכותרת. */
function cityFromParams(params: URLSearchParams): string | null {
  const raw = (params.get("city") || "").replace(/\s+/g, " ").trim();
  if (!raw || raw.length > 40) return null;
  if (!/^[\u0590-\u05FF][\u0590-\u05FF '"״׳-]{0,39}$/.test(raw)) return null;
  return raw;
}

/* "בעפולה והעמק" הופך ל"בעפולה" (או "במגדל העמק"). "בעפולה עילית" נשארת:
   זו שכונה, לא שם השוק. */
function localizePlace(text: string, city: string): string {
  const here = "ב" + city;
  return text.replace(
    /בעפולה והעמק|בעפולה ובעמק יזרעאל|בעפולה ובעמק|בעפולה(?! עילית)/g,
    here,
  );
}

function withCity(page: SearchPage, city: string): SearchPage {
  return {
    query: page.query,
    title: localizePlace(page.title, city),
    description: localizePlace(page.description, city),
    landing: page.landing,
  };
}

const BY_KEY = new Map(
  SEARCH_PAGES.map((page) => [matchKey(new URLSearchParams(page.query)), page]),
);

/* ‏מילוי ‎content‎ של תגית קיימת. מחזירה null כשאין תגית כזו, וכך הקורא
   יודע אם להוסיף אותה — בדיוק כמו ‎fillById‎ ב-og-tags.ts. */
function fillMeta(html: string, selector: string, value: string): string | null {
  const re = new RegExp(`<meta\\b[^>]*\\b${selector}[^>]*>`, "i");
  const found = html.match(re);
  if (!found) return null;

  const tag = /content="[^"]*"/i.test(found[0])
    ? found[0].replace(/content="[^"]*"/i, `content="${esc(value)}"`)
    : found[0].replace(/\s*\/?>$/, ` content="${esc(value)}">`);

  return html.replace(re, tag);
}

function inject(html: string, page: SearchPage): string {
  const canonical = page.landing ? `${SITE}${page.landing}` : `${SITE}/?${page.query}`;
  const title = `${page.title} | ${SITE_NAME}`;
  let out = html;
  const add: string[] = [];

  /* ‏og:title ו-og:url נכתבים **במקום** הקיימים: מאז 9.10.2026 index.html
     נושא אותם בעצמו, ותגית כפולה משאירה לסורק לבחור - והוא בוחר את של
     דף הבית. */
  for (const [selector, value] of [
    ['name="description"', page.description],
    ['property="og:description"', page.description],
    ['property="og:title"', title],
    ['property="og:url"', canonical],
  ] as const) {
    const filled = fillMeta(out, selector, value);
    if (filled) out = filled;
    else add.push(`<meta ${selector} content="${esc(value)}">`);
  }

  /* ‏ה-canonical של דף הבית (‏‎/‎) יורדת. **שתי תגיות canonical גורמות
     לגוגל להתעלם משתיהן**, וזה כשל שקט לגמרי — אותו לקח שכתוב ב-og-tags.ts. */
  out = out.replace(/<link\b[^>]*\brel="canonical"[^>]*>\s*/gi, "");

  add.unshift(`<link rel="canonical" href="${esc(canonical)}">`);
  add.push(
    /* הכותרת שמעל התוצאות (‏h2). הדף קורא אותה מכאן ולא מרשימה משלו. */
    `<meta name="shuk-search-heading" content="${esc(page.title)}">`,
  );
  if (page.type) add.push(`<meta name="shuk-search-type" content="${esc(page.type)}">`);

  out = out.replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(title)}</title>`);
  out = out.replace(/<\/head>/i, `${add.join("\n")}\n</head>`);
  return injectH1(out, page.title);
}

/* ‏ה-H1 של דף הבית ("כל הנכסים בעפולה והעמק…") מוחלף בנושא העמוד.
   כפתור בורר השוק נשאר בתוך ה-H1, בלי ‎#heroCityName‎: הסקריפט שאחריו
   כותב לשם את שם השוק, וזה היה מחליף את הכותרת אחרי שהדף נטען. */
function injectH1(html: string, title: string): string {
  const re = /<h1\b([^>]*)>([\s\S]*?)<\/h1>/i;
  const found = html.match(re);
  if (!found) return html;
  const button = found[2].match(/<button\b[^>]*\bdata-market-menu\b[^>]*>[\s\S]*?<\/button>/i);
  const attrs = /\bclass\s*=/.test(found[1]) ? found[1] : `${found[1]} class="is-topic"`;
  return html.replace(re, `<h1${attrs}>${esc(title)}${button ? button[0] : ""}</h1>`);
}

/* ---------- ההפניה לשוק המקומי (docs/regional-pages.md) ----------

   ‏‎/‎ בלי פרמטרי תוכן, ורק שם: מי ששוקו/ה אחר מברירת המחדל מופנה/ית
   לכתובת שלו (‏‎/haifa‎). ההחלטה עצמה - קישור `?region=`, בחירה, GPS,
   סורקים - ב-‎decide()‎ שב-lib/markets.ts. זיהוי IP אינו בוחר שוק.
   היא יושבת כאן ולא בפונקציה משלה (‏geo-city.ts, שנדחה ב-‎#346‎) כי זו
   כבר רצה על כל בקשה ל-‎/‎: הרחבה שלה אינה מוסיפה אף הפעלה בחיוב.

   ‏‎302‎ ולא ‎301‎, ו-‎no-store‎: הפניה לפי בחירה שנשמרה במטמון הייתה שולחת
   את כל מי שבא אחריו לאותו שוק. `?region=` נשמר גם כשיש פרמטרי תוכן,
   אבל לא מחליף את עמוד התוצאות בכתובת של שוק אחר. */
function marketRouting(request: Request, context: Context, url: URL) {
  if (request.method !== "GET") return null;
  const reg = registry();
  if (!reg) return null;
  const hasContent = matchKey(url.searchParams) !== "";
  /* בלי region ובלי תוכן אין מה להחליט כאן מעבר לעוגיות, וגם זה ב-decide. */
  if (hasContent && !url.searchParams.has("region")) return null;
  return decide(reg, {
    cookie: request.headers.get("cookie") || "",
    userAgent: request.headers.get("user-agent") || "",
    geo: (context as unknown as { geo?: Parameters<typeof decide>[1]["geo"] }).geo || null,
    search: url.search,
    region: url.searchParams.has("region") ? (url.searchParams.get("region") ?? "") : null,
    hasContent,
  });
}

const GEO_COOKIE_TAIL = "; Max-Age=86400; Path=/; SameSite=Lax; Secure";
const MARKET_COOKIE_TAIL = "; Max-Age=31536000; Path=/; SameSite=Lax; Secure";

function decisionCookies(routing: NonNullable<ReturnType<typeof marketRouting>>): string[] {
  const out: string[] = [];
  if (routing.marketCookie) {
    out.push(`shuk_market=${encodeURIComponent(routing.marketCookie)}${MARKET_COOKIE_TAIL}`);
  }
  if (routing.geoCookie) {
    out.push(`shuk_geo=${encodeURIComponent(routing.geoCookie)}${GEO_COOKIE_TAIL}`);
  }
  if (routing.soon) {
    out.push(`shuk_soon=${encodeURIComponent(routing.soon)}${GEO_COOKIE_TAIL}`);
  } else if (routing.clearSoon) {
    out.push("shuk_soon=; Max-Age=0; Path=/; SameSite=Lax; Secure");
  }
  return out;
}

export default async function handler(request: Request, context: Context) {
  let routing: ReturnType<typeof marketRouting> = null;
  try {
    const url = new URL(request.url);
    const page = url.pathname.replace(/\.html$/, "").replace(/\/+$/, "") || "/";
    if (page === "/" || page === "/index") routing = marketRouting(request, context, url);
  } catch {
    routing = null; // ‏הפניה שנכשלה לא תשבור את דף הבית
  }

  if (routing?.location) {
    let here = "/";
    try {
      const url = new URL(request.url);
      const page = url.pathname.replace(/\.html$/, "").replace(/\/+$/, "") || "/";
      here = (page === "/index" ? "/" : page) + url.search;
    } catch { /* בלי כתובת אין לאן להשוות, וההפניה תצא */ }
    if (routing.location !== here) {
      const headers = new Headers({
        "Location": routing.location,
        "Cache-Control": "private, no-store",
      });
      for (const cookie of decisionCookies(routing)) headers.append("Set-Cookie", cookie);
      return new Response(null, { status: 302, headers });
    }
  }

  const res = withDecisionCookies(await context.next(), routing);

  // רק HTML
  const type = res.headers.get("content-type") || "";
  if (!type.includes("text/html")) return res;

  try {
    const url = new URL(request.url);
    const page = url.pathname.replace(/\.html$/, "").replace(/\/+$/, "") || "/";
    if (page !== "/" && page !== "/index") return res;

    // ‏דף הבית עצמו, וכל צירוף שאינו ברשימה: יוצאים בלי שנקרא את הגוף.
    // city יורד רק מההתאמה: הוא משכתב את כותרת העמוד המוכר, לא פותח עמוד חדש.
    const params = url.searchParams;
    const match = BY_KEY.get(contentKey(params, CITY_PARAM));
    if (!match) return res;
    const city = cityFromParams(params);
    const out = inject(await res.text(), city ? withCity(match, city) : match);

    const headers = new Headers(res.headers);
    /* עוגייה אישית (אזור, או מחיקת פס ישן) לא נכנסת למטמון המשותף. */
    if (!headers.has("set-cookie")) {
      headers.set("Netlify-CDN-Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
      headers.set("Cache-Control", "public, max-age=0, must-revalidate");
    }
    return new Response(out, { status: res.status, headers });
  } catch {
    return res; // הזרקה שנכשלה לא תשבור את דף הבית
  }
}

/* עוגיות האזור על התשובה הרגילה. התשובה המקורית אינה ניתנת לשינוי, ולכן
   עותק - ורק כשיש מה לכתוב, כך שרוב הבקשות יוצאות בדיוק כמו קודם.

   ‏shuk_market: בחירה מקישור `?region=` (שנה). shuk_soon: פס "נפתחים
   בקרוב" כשהבחירה השמורה היא שוק שעוד לא נפתח. clearSoon מוחק פס ישן
   שנקבע מזיהוי IP. תשובה עם עוגייה היא פרטית, כדי שמטמון לא ידביק אותה
   לגולש/ת הבא/ה. */
function withDecisionCookies(res: Response, routing: ReturnType<typeof marketRouting>): Response {
  const cookies = routing ? decisionCookies(routing) : [];
  if (!cookies.length) return res;
  const copy = new Response(res.body, res);
  for (const cookie of cookies) copy.headers.append("Set-Cookie", cookie);
  copy.headers.set("Cache-Control", "private, no-store");
  copy.headers.set("Netlify-CDN-Cache-Control", "private, no-store");
  return copy;
}

/* שתי הצורות שבהן Netlify מגיש את דף הבית.
   cache: "manual" גם כאן: הפונקציה הזו רצה על אותן כתובות כמו
   home-listings, ולפעמים היא זו שמחזירה את התשובה ל-CDN. בלי ההסכמה
   הזו הכותרות של הרשימה לא נשמרות. תשובה בלי כותרת מטמון אינה נשמרת. */
export const config: Config = {
  cache: "manual",
  path: ["/", "/index.html"],
};
