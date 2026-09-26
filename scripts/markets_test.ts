/* ============================================================================
   ‏הבדיקה של השווקים המקומיים: לאן מפנים, מה מזריקים, ומה בשום אופן לא
   ----------------------------------------------------------------------------
   שלושה חלקים, וכל אחד מהם שקט כשהוא נשבר:

     ‏1. ‏ShukMarkets.locate - נקודה → שוק. שוק שגוי הוא דף של עיר אחרת.
     ‏2. ‏decide() - ההפניה מ-‎/‎. הפניה לשוק שעוד לא נפתח, הפניה של סורק או
        הפניה שדורסת בחירה מפורשת - כולן נראות תקינות למי שבודק מהבית.
     ‏3. ‏inject() - שוק שעוד לא נפתח חייב noindex ואסור לו canonical; שוק
        חי חייב canonical עצמי ואחת בלבד.

   הרצה:

       node --experimental-strip-types scripts/markets_test.ts

   התיעוד: ‎docs/regional-pages.md‎.
   ========================================================================== */

import { decide, registry } from "../netlify/edge-functions/lib/markets.ts";
import { inject } from "../netlify/edge-functions/market-pages.ts";
import searchPages from "../netlify/edge-functions/search-pages.ts";

const reg = registry()!;

/* ‏הבדיקה בודקת התנהגות ולא את המצב היום: חיפה מתחילה סגורה כאן בזיכרון,
   ונדלקת במקרים שצריכים אותה - כדי שהבדיקה לא תיכשל ביום שחיפה באמת
   נדלקת ב-assets/markets.js. */
const haifaLiveInFile = reg.bySlug("haifa-krayot")!.live;
reg.bySlug("haifa-krayot")!.live = false;
let failed = 0;

function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`✓ ${name}`);
  else { failed++; console.log(`✗ ${name}${detail ? "\n    " + detail : ""}`); }
}

/* ---------- 1. נקודה → שוק ---------- */

const AFULA = [32.6078, 35.2897];
const KIRYAT_BIALIK = [32.8275, 35.0857];
const NESHER = [32.766, 35.044];
const TEL_AVIV = [32.0853, 34.7818];
/* מרכזי יישוב בקירוב (מעלות-דקות) - מספיק למבחן תיבה, לא לפין */
const KIRYAT_TIVON = [32.717, 35.133];
const REKHASIM = [32.75, 35.1];
const RAMAT_YISHAI = [32.705, 35.167]; // הגבול: 3 ק"מ מזרחית לטבעון, בעמק

check("עפולה → afula-emek", reg.locate(AFULA[0], AFULA[1])?.slug === "afula-emek");
check("קריית ביאליק → haifa-krayot", reg.locate(KIRYAT_BIALIK[0], KIRYAT_BIALIK[1])?.slug === "haifa-krayot");
check("נשר → haifa-krayot", reg.locate(NESHER[0], NESHER[1])?.slug === "haifa-krayot");
check("קריית טבעון → haifa-krayot", reg.locate(KIRYAT_TIVON[0], KIRYAT_TIVON[1])?.slug === "haifa-krayot");
check("רכסים → haifa-krayot", reg.locate(REKHASIM[0], REKHASIM[1])?.slug === "haifa-krayot");
check("רמת ישי (מעבר לגבול עם טבעון) → afula-emek", reg.locate(RAMAT_YISHAI[0], RAMAT_YISHAI[1])?.slug === "afula-emek");
check("תל אביב → אין שוק (ולא הקרוב ביותר, 80 ק\"מ משם)", reg.locate(TEL_AVIV[0], TEL_AVIV[1]) === null);
check("רק שווקים חיים: קריית ביאליק → אין (חיפה עוד לא נפתחה)",
  reg.locate(KIRYAT_BIALIK[0], KIRYAT_BIALIK[1], true) === null);
check("קואורדינטה פסולה → אין", reg.locate(NaN, 35) === null);

/* ---------- 2. ההפניה מ-‎/‎ ---------- */

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";
const IL = (p: number[]) => ({ latitude: p[0], longitude: p[1], country: { code: "IL" } });

/* ‏חיפה אינה חיה עדיין - ולכן לבדוק את ההפניה עצמה צריך שוק חי שאינו
   ברירת המחדל. מדליקים אותו כאן בזיכרון בלבד, ומכבים בסוף. */
const haifa = reg.bySlug("haifa-krayot")!;

let d = decide(reg, { cookie: "", userAgent: UA, geo: IL(KIRYAT_BIALIK), search: "" });
check("שוק שאינו חי: IP מהקריות אינו מפנה", d.location === null);

d = decide(reg, { cookie: "shuk_market=haifa-krayot%7Cgps", userAgent: UA, geo: null, search: "" });
check("שוק שאינו חי: GPS שמור אינו מפנה", d.location === null);

haifa.live = true;

d = decide(reg, { cookie: "", userAgent: UA, geo: IL(KIRYAT_BIALIK), search: "" });
check("IP מהקריות → ‎/haifa-krayot‎", d.location === "/haifa-krayot", JSON.stringify(d));
check("וגם עוגיית shuk_geo של השוק", (d.geoCookie || "").startsWith("haifa-krayot|"));

d = decide(reg, { cookie: "", userAgent: UA, geo: IL(KIRYAT_BIALIK), search: "?utm_source=fb" });
check("פרמטרי מעקב נוסעים עם ההפניה", d.location === "/haifa-krayot?utm_source=fb");

d = decide(reg, { cookie: "shuk_market=afula-emek%7Cchoice", userAgent: UA, geo: IL(KIRYAT_BIALIK), search: "" });
check("בחירה מפורשת בעפולה גוברת על IP מהקריות", d.location === null);

d = decide(reg, { cookie: "shuk_market=haifa-krayot%7Cgps", userAgent: UA, geo: IL(AFULA), search: "" });
check("GPS שמור בקריות גובר על IP מעפולה", d.location === "/haifa-krayot");

d = decide(reg, { cookie: "", userAgent: UA, geo: IL(AFULA), search: "" });
check("IP מעפולה → אין הפניה (ברירת המחדל), עם עוגייה", d.location === null && !!d.geoCookie);

d = decide(reg, { cookie: "", userAgent: UA, geo: IL(TEL_AVIV), search: "" });
check("IP מתל אביב → אין הפניה ואין עוגייה", d.location === null && d.geoCookie === null);

d = decide(reg, { cookie: "", userAgent: UA, geo: { ...IL(KIRYAT_BIALIK), country: { code: "US" } }, search: "" });
check("IP מחוץ לישראל → אין הפניה", d.location === null);

for (const bot of ["Googlebot/2.1", "WhatsApp/2.23", "facebookexternalhit/1.1"]) {
  d = decide(reg, { cookie: "shuk_market=haifa-krayot%7Cchoice", userAgent: bot, geo: IL(KIRYAT_BIALIK), search: "" });
  check(`סורק אינו מופנה (${bot})`, d.location === null);
}

d = decide(reg, { cookie: "shuk_market=%3Cscript%3E", userAgent: UA, geo: null, search: "" });
check("עוגייה פסולה → אין הפניה", d.location === null);

haifa.live = false;

/* ---------- 3. ההזרקה ---------- */

const PAGE = [
  "<!doctype html><html><head>",
  "<title>נפתחים בקרוב | שוק נדל״ן</title>",
  '<meta name="robots" content="noindex,follow">',
  '<link rel="canonical" href="https://shuknadlan.co.il/">',
  '<meta name="description" content="כללי">',
  '<script src="assets/markets.js"></script>',
  "</head><body></body></html>",
].join("\n");

let html = inject(PAGE, haifa);
check("שוק שאינו חי: noindex", /<meta name="robots" content="noindex,follow">/.test(html));
check("שוק שאינו חי: בלי canonical", !/rel="canonical"/.test(html));
check("הכותרת של השוק", html.includes("<title>שוק נדל״ן | חיפה והקריות</title>"));
check("og:url של השוק", html.includes('property="og:url" content="https://shuknadlan.co.il/haifa-krayot"'));
check("תיאור אחד בלבד", (html.match(/name="description"/g) || []).length === 1);
check("SHUK_MARKET לפני markets.js",
  html.indexOf("window.SHUK_MARKET") > -1 && html.indexOf("window.SHUK_MARKET") < html.indexOf('src="assets/markets.js"'));

haifa.live = true;
html = inject(PAGE, haifa);
check("שוק חי: canonical עצמי, אחת בלבד",
  (html.match(/rel="canonical"/g) || []).length === 1 &&
  html.includes('<link rel="canonical" href="https://shuknadlan.co.il/haifa-krayot">'));
check("שוק חי: בלי noindex", !/noindex/.test(html));
haifa.live = false;

const evil = { ...haifa, label: "</script><script>alert(1)</script>" };
html = inject(PAGE, evil);
check("תווית עם ‎</script>‎ אינה סוגרת את התג", !html.includes("</script><script>alert(1)"));

/* ---------- 4. הפונקציה עצמה: ‎search-pages.ts‎ על ‎/‎ ---------- */

const HOME = "<!doctype html><html><head><title>בית</title></head><body></body></html>";
const ctx = (geo: unknown = null) => ({
  geo,
  next: async () => new Response(HOME, { headers: { "content-type": "text/html; charset=utf-8" } }),
}) as never;
const req = (path: string, cookie = "") =>
  new Request("https://shuknadlan.co.il" + path, { headers: { cookie, "user-agent": UA } });

haifa.live = true;
let r = await searchPages(req("/", "shuk_market=haifa-krayot%7Cchoice"), ctx());
check("‎/‎ עם בחירה בחיפה → 302 ל-‎/haifa-krayot‎, בלי מטמון",
  r.status === 302 && r.headers.get("location") === "/haifa-krayot" &&
  (r.headers.get("cache-control") || "").includes("no-store"));

r = await searchPages(req("/?deal=sale&rooms=4", "shuk_market=haifa-krayot%7Cchoice"), ctx());
check("עמוד תוצאות אינו מופנה (הפרמטרים הם תוכן)", r.status === 200);

r = await searchPages(req("/", ""), ctx(IL(AFULA)));
check("‎/‎ מעפולה: 200, עם עוגיית shuk_geo", r.status === 200 && (r.headers.get("set-cookie") || "").startsWith("shuk_geo=afula-emek"));
haifa.live = false;

r = await searchPages(req("/", "shuk_market=haifa-krayot%7Cchoice"), ctx());
check("‎/‎ עם בחירה בשוק שאינו חי: 200, הדף כמו שהוא", r.status === 200 && (await r.text()) === HOME);

reg.bySlug("haifa-krayot")!.live = haifaLiveInFile;

console.log(failed ? `\n✗ ${failed} מקרים נכשלו` : "\n✓ השווקים: זיהוי, הפניה והזרקה מתנהגים כמתוכנן.");
if (failed) (globalThis as unknown as { process: { exit(n: number): void } }).process.exit(1);
