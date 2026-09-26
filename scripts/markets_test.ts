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
const AKKO = [32.927, 35.083];
const NAHARIYA = [33.006, 35.095];
const SHLOMI = [33.075, 35.145];
const MAALOT = [33.016, 35.27]; // ברצועה הצפונית של עכו, מעל כרמיאל
const KFAR_VRADIM = [32.995, 35.27];
const KARMIEL = [32.919, 35.296];
const YODFAT = [32.838, 35.272];
const NAZARETH = [32.70, 35.30];
const NOF_HAGALIL = [32.71, 35.33];
const MIGDAL_HAEMEK = [32.68, 35.24];
const TEL_ADASHIM = [32.656, 35.303]; // מפיני העסקאות - הגבול הדרומי של נצרת
const KFAR_TAVOR = [32.69, 35.42];
const ATLIT = [32.688, 34.94];
const EIN_AYALA = [32.633, 34.95]; // הדרומי שבחלק של חוף הכרמל שבשוק
const ZICHRON = [32.57, 34.955];
const RAMAT_YISHAI = [32.705, 35.167]; // הגבול: 3 ק"מ מזרחית לטבעון, בעמק

check("עפולה → afula-emek", reg.locate(AFULA[0], AFULA[1])?.slug === "afula-emek");
check("קריית ביאליק → haifa-krayot", reg.locate(KIRYAT_BIALIK[0], KIRYAT_BIALIK[1])?.slug === "haifa-krayot");
check("נשר → haifa-krayot", reg.locate(NESHER[0], NESHER[1])?.slug === "haifa-krayot");
check("קריית טבעון → haifa-krayot", reg.locate(KIRYAT_TIVON[0], KIRYAT_TIVON[1])?.slug === "haifa-krayot");
check("רכסים → haifa-krayot", reg.locate(REKHASIM[0], REKHASIM[1])?.slug === "haifa-krayot");
check("רמת ישי (מעבר לגבול עם טבעון) → afula-emek", reg.locate(RAMAT_YISHAI[0], RAMAT_YISHAI[1])?.slug === "afula-emek");
check("עכו → akko-nahariya", reg.locate(AKKO[0], AKKO[1])?.slug === "akko-nahariya");
check("נהריה → akko-nahariya", reg.locate(NAHARIYA[0], NAHARIYA[1])?.slug === "akko-nahariya");
check("שלומי → akko-nahariya", reg.locate(SHLOMI[0], SHLOMI[1])?.slug === "akko-nahariya");
check("מעלות-תרשיחא → akko-nahariya (לא כרמיאל, 11 ק\"מ דרומה)", reg.locate(MAALOT[0], MAALOT[1])?.slug === "akko-nahariya");
check("כפר ורדים → akko-nahariya", reg.locate(KFAR_VRADIM[0], KFAR_VRADIM[1])?.slug === "akko-nahariya");
check("כרמיאל → karmiel-misgav", reg.locate(KARMIEL[0], KARMIEL[1])?.slug === "karmiel-misgav");
check("יודפת (משגב) → karmiel-misgav", reg.locate(YODFAT[0], YODFAT[1])?.slug === "karmiel-misgav");
check("הגבול: 32.975 → כרמיאל, 32.98 → עכו (הרצועה של מעלות)",
  reg.locate(32.975, 35.27)?.slug === "karmiel-misgav" && reg.locate(32.98, 35.27)?.slug === "akko-nahariya");

/* תיבות locate של שני שווקים לעולם אינן חופפות - אחרת סדר השורות מחליט */
{
  type Box = [number, number, number, number];
  const boxesOf = (m: { bbox: Box; boxes?: Box[] }) => m.boxes || [m.bbox];
  const hit = (a: Box, b: Box) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
  const list = reg.list as unknown as Array<{ slug: string; bbox: Box; boxes?: Box[] }>;
  const clashes: string[] = [];
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++)
      for (const a of boxesOf(list[i])) for (const b of boxesOf(list[j]))
        if (hit(a, b)) clashes.push(`${list[i].slug} ↔ ${list[j].slug}`);
  check("אין חפיפה בין תיבות locate של שווקים", clashes.length === 0, clashes.join(", "));
  /* והמסגרת מכילה את התיבות - הסריקה של ייבוא השכונות רצה עליה */
  const inside = (a: Box, f: Box) => a[0] >= f[0] && a[1] >= f[1] && a[2] <= f[2] && a[3] <= f[3];
  const outside = list.filter((m) => !boxesOf(m).every((b) => inside(b, m.bbox))).map((m) => m.slug);
  check("כל תיבת locate בתוך המסגרת של השוק", outside.length === 0, outside.join(", "));
}
check("הגבול: 32.89 (קצה חיפה) → haifa-krayot, 32.9 → akko-nahariya",
  reg.locate(32.89, 35.08)?.slug === "haifa-krayot" && reg.locate(32.9, 35.08)?.slug === "akko-nahariya");
check("נצרת (לא בשום שוק) → נוף הגליל ומגדל העמק כשוק הקרוב, עד שיהיה שוק לנצרת", reg.locate(NAZARETH[0], NAZARETH[1])?.slug === "nof-hagalil-migdal");
check("נוף הגליל → nof-hagalil-migdal", reg.locate(NOF_HAGALIL[0], NOF_HAGALIL[1])?.slug === "nof-hagalil-migdal");
check("מגדל העמק → nof-hagalil-migdal", reg.locate(MIGDAL_HAEMEK[0], MIGDAL_HAEMEK[1])?.slug === "nof-hagalil-migdal");
check("תל עדשים (צמודה מדרום) → afula-emek", reg.locate(TEL_ADASHIM[0], TEL_ADASHIM[1])?.slug === "afula-emek");
check("כפר תבור (ממזרח) → afula-emek", reg.locate(KFAR_TAVOR[0], KFAR_TAVOR[1])?.slug === "afula-emek");
check("רק שווקים חיים: נוף הגליל → עפולה והעמק כשוק הקרוב, עד שהשוק ייפתח",
  reg.locate(NOF_HAGALIL[0], NOF_HAGALIL[1], true)?.slug === "afula-emek");
check("עתלית → haifa-krayot", reg.locate(ATLIT[0], ATLIT[1])?.slug === "haifa-krayot");
check("עין איילה → haifa-krayot", reg.locate(EIN_AYALA[0], EIN_AYALA[1])?.slug === "haifa-krayot");
check("זכרון יעקב → לא חיפה (דרומה מהתיבה, ומעבר ל-NEAR_KM)", reg.locate(ZICHRON[0], ZICHRON[1])?.slug !== "haifa-krayot");
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
