/* ============================================================================
   ‏14 עמודי תוצאות — כותרת, תיאור ו-canonical משלהם, מוזרקים בשרת
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

   רצה על ה-edge לפני שדף הבית יוצא, בודקת אם הפרמטרים בכתובת הם אחד מ-14
   הצירופים שברשימה למטה, ואם כן מחליפה את ה-‎<title>‎, את התיאור ואת
   ה-‎canonical‎ בשלה. ‏HTML אחד מגיש מעכשיו 15 דפים: דף הבית ו-14 עמודי
   תוצאות, לכל אחד כתובת אחת משלו.

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

   ‏**2. הכותרת נכתבת פעם אחת, כאן.** הדף אינו מחזיק עותק של הרשימה: הוא
   קורא את ‎<meta name="shuk-search-heading">‎ שמוזרק כאן ומציג אותו מעל
   התוצאות (‏‎renderSearchRows‎ ב-‎assets/home.js‎). שתי רשימות שצריכות
   להסכים הן רשימה אחת שמתיישנת — הכלל שכבר נלמד ב-‎maskHouseNumber‎.

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
  /* הכתיב הקנוני של הפרמטרים. זו הכתובת שנכנסת ל-canonical ול-sitemap. */
  query: string;
  title: string;
  description: string;
};

/* ‏14 הצירופים שמקושרים מבלוק "חיפושים פופולריים" בפוטר. הוספה כאן מחייבת
   קישור בפוטר ושורה ב-sitemap.xml — ‎check_canonical.py‎ חוסם אחרת. */
export const SEARCH_PAGES: SearchPage[] = [
  {
    query: "deal=sale&rooms=3",
    title: "דירות 3 חדרים למכירה בעפולה והעמק",
    description: "כל דירות 3 החדרים שמוצעות היום למכירה בעפולה ובעמק יזרעאל, מכל משרדי התיווך באזור, עם מחיר, תמונות ופרטי קשר ישירים.",
  },
  {
    query: "deal=sale&rooms=4",
    title: "דירות 4 חדרים למכירה בעפולה והעמק",
    description: "כל דירות 4 החדרים שמוצעות היום למכירה בעפולה ובעמק יזרעאל, מכל משרדי התיווך באזור, עם מחיר, תמונות ופרטי קשר ישירים.",
  },
  {
    query: "deal=sale&rooms=5",
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
  },
  {
    query: "deal=sale&ptype=%D7%92%D7%92%2F%D7%A4%D7%A0%D7%98%D7%94%D7%90%D7%95%D7%96",
    title: "פנטהאוזים ודירות גג למכירה בעפולה",
    description: "כל הפנטהאוזים ודירות הגג שמוצעים היום למכירה בעפולה ובעמק יזרעאל, מכל משרדי התיווך באזור, עם מחיר ותמונות.",
  },
  {
    query: "deal=sale&ptype=%D7%91%D7%99%D7%AA%20%D7%A4%D7%A8%D7%98%D7%99%2F%D7%A7%D7%95%D7%98%D7%92'",
    title: "בתים פרטיים וקוטג׳ים למכירה בעפולה והעמק",
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
    title: "דירות 3 חדרים להשכרה בעפולה והעמק",
    description: "כל דירות 3 החדרים שמוצעות היום להשכרה בעפולה ובעמק יזרעאל, מכל משרדי התיווך באזור, עם שכר דירה, תמונות ופרטי קשר.",
  },
  {
    query: "deal=rent&rooms=4",
    title: "דירות 4 חדרים להשכרה בעפולה והעמק",
    description: "כל דירות 4 החדרים שמוצעות היום להשכרה בעפולה ובעמק יזרעאל, מכל משרדי התיווך באזור, עם שכר דירה, תמונות ופרטי קשר.",
  },
  {
    query: "deal=rent&maxPrice=4000",
    title: "דירות להשכרה בעפולה עד 4,000 ₪ לחודש",
    description: "כל הדירות שמוצעות היום להשכרה בעפולה ובעמק בשכר דירה של עד 4,000 ₪ לחודש, מכל משרדי התיווך באזור, עם תמונות ופרטי קשר.",
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
const NOT_CONTENT = new Set(["src", "fbclid", "gclid", "gbraid", "wbraid", "msclkid", "ref"]);

/* ‏המפתח שמשווים לפיו: זוגות מפוענחים, ממוינים, בלי פרמטרי מעקב. כך
   ‎?rooms=4&deal=sale‎, ‎?deal=sale&rooms=4&src=pwa‎ וקידוד עברית גולמי
   נופלים כולם על אותה שורה ברשימה. */
function matchKey(params: URLSearchParams): string {
  const pairs: string[] = [];
  for (const [key, raw] of params) {
    if (NOT_CONTENT.has(key) || key.startsWith("utm_")) continue;
    const value = raw.trim();
    if (!value) continue;
    pairs.push(`${key}=${value}`);
  }
  return pairs.sort().join("&");
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
  const canonical = `${SITE}/?${page.query}`;
  const title = `${page.title} | ${SITE_NAME}`;
  let out = html;
  const add: string[] = [];

  for (const [selector, value] of [
    ['name="description"', page.description],
    ['property="og:description"', page.description],
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
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:url" content="${esc(canonical)}">`,
    /* הכותרת שמעל התוצאות. הדף קורא אותה מכאן ולא מרשימה משלו. */
    `<meta name="shuk-search-heading" content="${esc(page.title)}">`,
  );

  out = out.replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(title)}</title>`);
  return out.replace(/<\/head>/i, `${add.join("\n")}\n</head>`);
}

/* ---------- ההפניה לשוק המקומי (docs/regional-pages.md) ----------

   ‏‎/‎ בלי פרמטרי תוכן, ורק שם: מי ששוקו/ה אחר מברירת המחדל מופנה/ית
   לכתובת שלו (‏‎/haifa-krayot‎). ההחלטה עצמה - בחירה, GPS, ‏IP, סורקים -
   ב-‎decide()‎ שב-lib/markets.ts. היא יושבת כאן ולא בפונקציה משלה
   (‏geo-city.ts, שנדחה ב-‎#346‎) כי זו כבר רצה על כל בקשה ל-‎/‎: הרחבה
   שלה אינה מוסיפה אף הפעלה בחיוב.

   ‏‎302‎ ולא ‎301‎, ו-‎no-store‎: הפניה לפי מיקום שנשמרה במטמון הייתה שולחת את
   כל מי שבא אחריו לאותו שוק. */
function marketRouting(request: Request, context: Context, url: URL) {
  if (request.method !== "GET" || matchKey(url.searchParams) !== "") return null;
  const reg = registry();
  if (!reg) return null;
  return decide(reg, {
    cookie: request.headers.get("cookie") || "",
    userAgent: request.headers.get("user-agent") || "",
    geo: (context as unknown as { geo?: Parameters<typeof decide>[1]["geo"] }).geo || null,
    search: url.search,
  });
}

const GEO_COOKIE_TAIL = "; Max-Age=86400; Path=/; SameSite=Lax; Secure";

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
    const headers = new Headers({
      "Location": routing.location,
      "Cache-Control": "private, no-store",
    });
    if (routing.geoCookie) {
      headers.append("Set-Cookie", `shuk_geo=${encodeURIComponent(routing.geoCookie)}${GEO_COOKIE_TAIL}`);
    }
    return new Response(null, { status: 302, headers });
  }

  const res = await withGeoCookie(await context.next(), routing?.geoCookie || null);

  // רק HTML
  const type = res.headers.get("content-type") || "";
  if (!type.includes("text/html")) return res;

  try {
    const url = new URL(request.url);
    const page = url.pathname.replace(/\.html$/, "").replace(/\/+$/, "") || "/";
    if (page !== "/" && page !== "/index") return res;

    // ‏דף הבית עצמו, וכל צירוף שאינו ברשימה: יוצאים בלי שנקרא את הגוף
    const match = BY_KEY.get(matchKey(url.searchParams));
    if (!match) return res;

    const out = inject(await res.text(), match);

    const headers = new Headers(res.headers);
    headers.set("Netlify-CDN-Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    headers.set("Cache-Control", "public, max-age=0, must-revalidate");
    return new Response(out, { status: res.status, headers });
  } catch {
    return res; // הזרקה שנכשלה לא תשבור את דף הבית
  }
}

/* ‏עוגיית shuk_geo על התשובה הרגילה: הדפדפן קורא אותה בדפים שאינם שייכים
   לשוק (‏‎/agencies‎). התשובה המקורית אינה ניתנת לשינוי, ולכן עותק - ורק
   כשיש מה לכתוב, כך שרוב הבקשות יוצאות בדיוק כמו קודם. */
function withGeoCookie(res: Response, value: string | null): Response {
  if (!value) return res;
  const copy = new Response(res.body, res);
  copy.headers.append("Set-Cookie", `shuk_geo=${encodeURIComponent(value)}${GEO_COOKIE_TAIL}`);
  return copy;
}

/* שתי הצורות שבהן Netlify מגיש את דף הבית. */
export const config: Config = {
  path: ["/", "/index.html"],
};
