/* ============================================================================
   דפי השווקים - ‎/haifa-krayot‎ וחבריו
   ----------------------------------------------------------------------------
   כל שוק שאינו ברירת המחדל מקבל כתובת משלו. ‏`_redirects` ממפה אותה לקובץ
   שמגיש אותה (‏`index.html` לשוק חי, ‏`market-soon.html` לשוק שעוד לא
   נפתח), והפונקציה כאן רצה לפני שהתשובה יוצאת ומזריקה את מה שקובץ סטטי
   אינו יכול לדעת: **איזה שוק זה.**

     • ‏`<title>`, התיאור ותגיות השיתוף - הקישור שנשלח בוואטסאפ למשרדים
       בחיפה נראה כמו חיפה, לא כמו עפולה.
     • ‏canonical לשוק חי; ‏noindex בלי canonical לשוק שעוד לא נפתח.
     • ‏`window.SHUK_MARKET` - לפני `markets.js` ו-`city-context.js`, כדי
       שההכרעה בדפדפן תהיה סינכרונית והמפה לא תקפוץ.

   ## ‏הרשימה אינה כאן

   היא ב-`assets/markets.js`, שמיובא כאן לתופעת הלוואי שלו (הוא מגדיר
   `globalThis.ShukMarkets`) ונטען אותו קובץ בדפדפן. ‏`config.path` למטה
   הוא ליטרל, כי Netlify קורא אותו בזמן הבנייה - ו-`check_markets.py` מוודא
   שהוא מכסה בדיוק את השווקים שאינם ברירת המחדל.

   ## כישלון אינו שובר דף

   אין כאן קריאת רשת. כל חריגה מחזירה את התשובה המקורית - ‏market-soon.html
   נושא noindex משלו, ו-JS בתוכו מסיק את השוק מהכתובת. כלומר הזרקה שנכשלה
   מאבדת את תגיות השיתוף, לא את הדף.

   התיעוד: ‎docs/regional-pages.md‎.
   ========================================================================== */

import type { Config, Context } from "https://edge.netlify.com/v1/index.ts";
import { esc, type Market, registry } from "./lib/markets.ts";

const SITE = "https://shuknadlan.co.il";

/* ‏מה שהדפדפן צריך מהשוק, ולא יותר. ‏JSON בתוך `<script>` - ולכן `<` מוחלף
   ברצף הבריחה של JSON: תווית שמכילה ‎</script>‎ לא תסגור את התג. */
function bootstrap(m: Market): string {
  const data = JSON.stringify({ slug: m.slug, label: m.label, live: m.live })
    .replace(/</g, "\\u003c");
  return `<script>window.SHUK_MARKET=${data};</script>`;
}

function setMeta(html: string, attr: string, value: string): string {
  const re = new RegExp(`<meta\\b[^>]*\\b${attr}[^>]*>\\s*`, "gi");
  const out = html.replace(re, "");
  return out.replace(/<\/head>/i, `<meta ${attr} content="${esc(value)}">\n</head>`);
}

export function inject(html: string, m: Market): string {
  let out = html;
  const url = `${SITE}${m.path}`;

  out = out.replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(m.title)}</title>`);
  out = setMeta(out, 'name="description"', m.description);
  out = setMeta(out, 'property="og:title"', m.title);
  out = setMeta(out, 'property="og:description"', m.description);
  out = setMeta(out, 'property="og:url"', url);

  /* ‏שתי תגיות canonical גורמות לגוגל להתעלם משתיהן - לכן תמיד מסירים את
     הקיימת (‏index.html מצהיר על ‎/‎) לפני שמחליטים. */
  out = out.replace(/<link\b[^>]*\brel="canonical"[^>]*>\s*/gi, "");
  out = out.replace(/<meta\b[^>]*\bname="robots"[^>]*>\s*/gi, "");
  const indexing = m.live
    ? `<link rel="canonical" href="${esc(url)}">`
    : `<meta name="robots" content="noindex,follow">`;
  out = out.replace(/<\/head>/i, `${indexing}\n</head>`);

  /* ‏לפני markets.js, כי city-context.js קורא את SHUK_MARKET ברגע שהוא רץ. */
  const boot = bootstrap(m);
  const anchor = /<script\s+src="assets\/markets\.js"><\/script>/i;
  out = anchor.test(out)
    ? out.replace(anchor, (tag) => `${boot}\n${tag}`)
    : out.replace(/<\/head>/i, `${boot}\n</head>`);

  return out;
}

export default async function handler(request: Request, context: Context) {
  const res = await context.next();
  const type = res.headers.get("content-type") || "";
  if (!type.includes("text/html")) return res;

  try {
    const reg = registry();
    const market = reg && reg.byPath(new URL(request.url).pathname);
    if (!market || market.isDefault) return res;

    const out = inject(await res.text(), market);
    const headers = new Headers(res.headers);
    headers.delete("content-length");
    return new Response(out, { status: res.status, headers });
  } catch {
    return res;
  }
}

/* ‏כל שוק שאינו ברירת המחדל. ‏check_markets.py חוסם פער מול markets.js. */
export const config: Config = {
  path: ["/haifa-krayot", "/akko-nahariya", "/karmiel-misgav"],
};
