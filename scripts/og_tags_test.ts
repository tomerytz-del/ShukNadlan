/* ============================================================================
   ‏הבדיקה של ההחלטה האחת ב-og-tags.ts שאי אפשר לראות שהיא נשברה
   ----------------------------------------------------------------------------
   ‏`netlify/edge-functions/og-tags.ts` מחליטה, לכל דף פירוט, בין שלושה
   מצבים — ושלושתם נראים בדפדפן **בדיוק אותו דבר**:

     ‏1. יש רשומה  → מזריקים canonical ותגיות שיתוף.
     ‏2. אין רשומה (המסד ענה 406/404) → ‎noindex,follow‎.
     ‏3. לא הצלחנו לשאול (‏timeout, ‏5xx, ‏401) → הגוף יוצא **כמו שהוא**,
        בלי noindex. בדף נכס, בלי עותק קודם, הסטטוס הוא 503; אם נשמר
        דף מלא הוא מוגש 200. בשאר דפי הפירוט 200.

   ההפרדה בין 2 ל-3 היא כל העניין. מי שיאחד אותן — `if (!res.ok)` אחד
   במקום סיווג לפי סטטוס — יקבל ‎noindex‎ על **כל דפי הפירוט באתר** בכל
   דקה שבה Supabase איטי או מפתח הוחלף. שום דבר לא ייראה שבור: הדפים
   ייטענו, הגולשים לא ירגישו, וגוגל תוציא אותם מהאינדקס בשקט. את זה
   מגלים חודש אחרי, מהודעה של Search Console.

   לכן ההחלטה נבדקת כאן, ולא נשענת על קריאה בקוד.

   הרצה:

       node --experimental-strip-types scripts/og_tags_test.ts

   ‏יציאה 0 = הכול תקין. יציאה 1 = מקרה שהתנהג אחרת, והפלט מראה מי.
   התיעוד: ‎docs/social-preview.md‎.
   ========================================================================== */

import handler from "../netlify/edge-functions/og-tags.ts";
import { resetLastGood } from "../netlify/edge-functions/lib/last-good.ts";

const PAGE =
  `<!doctype html><html><head><title>נכס | שוק נדל״ן</title></head><body>x</body></html>`;

/* ‏‎context.next()‎ של Netlify — מחזיר את הקובץ הסטטי כפי שהוא על הדיסק */
const context = () =>
  ({
    next: async () =>
      new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } }),
  }) as never;

/* השורה מהמסד, כפי ש-PostgREST מחזיר אותה: numeric כמחרוזת */
const PROPERTY = {
  title: "דירת 4 חדרים ברחוב הרצל 12",
  house_number: "12",
  address: "הרצל 12",
  city: "עפולה",
  images: ["/a.jpg"],
  price: 1500000,
  deal_type: "sale",
  rooms: "4.0",
  size_sqm: "100",
  status: "active",
  neighborhoods: { name: "גבעת המורה" },
};

type Expected = "noindex" | "tags" | "untouched";

type Case = {
  name: string;
  url: string;
  /* התשובה ש-Supabase יחזיר. חסר = אין קריאה למסד בכלל. */
  status?: number;
  body?: unknown;
  expect: Expected;
};

const CASES: Case[] = [
  /* ‏1. דף פירוט בלי המפתח שלו. אין מה לשאול את המסד: הדף מציג "לא נמצא",
        וה-HTML שלו זהה בכל שבעת הדפים — האשכול שגוגל קוראת לו "עותק
        משוכפל בלי שנבחר דף קנוני". */
  { name: "‏/property בלי ?id=", url: "/property", expect: "noindex" },
  { name: "‏/property.html בלי ?id=", url: "/property.html", expect: "noindex" },
  { name: "‏/agency בלי ?slug=", url: "/agency", expect: "noindex" },
  { name: "‏/agent בלי ?slug=", url: "/agent", expect: "noindex" },
  { name: "‏/project בלי ?slug=", url: "/project", expect: "noindex" },
  { name: "‏/developer בלי ?slug=", url: "/developer", expect: "noindex" },
  { name: "‏/professional בלי מפתח", url: "/professional", expect: "noindex" },
  { name: "‏/article בלי מפתח", url: "/article", expect: "noindex" },
  /* ‏‎?slug=‎ על דף שהמפתח שלו הוא ‎?id=‎ אינו כתובת של נכס */
  { name: "‏/property עם ?slug= במקום ?id=", url: "/property?slug=x", expect: "noindex" },

  /* ‏2. המסד ענה במפורש "אין שורה": נכס שנמכר ואינו active, כתבה שנמחקה.
        ‏406 הוא PGRST116 של PostgREST, ו-404 הוא נתיב שאינו קיים. */
  { name: "נכס שאינו active (‏406)", url: "/property?id=9", status: 406, body: { code: "PGRST116" }, expect: "noindex" },
  { name: "משרד שנמחק (‏406)", url: "/agency?slug=a", status: 406, body: { code: "PGRST116" }, expect: "noindex" },
  { name: "כתבה שאינה קיימת (‏404)", url: "/article?slug=a", status: 404, body: {}, expect: "noindex" },

  /* ‏3. לא ידענו. כאן אסור להסיק דבר, והדף חייב לצאת בדיוק כמו שהוא —
        ‏noindex כאן היה מוחק נכסים חיים מגוגל בגלל תקלה של דקה. */
  { name: "‏Supabase 500", url: "/property?id=9", status: 500, body: {}, expect: "untouched" },
  { name: "מפתח שנשלל (‏401)", url: "/property?id=9", status: 401, body: {}, expect: "untouched" },
  { name: "‏RLS חוסם (‏403)", url: "/agency?slug=a", status: 403, body: {}, expect: "untouched" },
  { name: "‏PostgREST החזיר 400", url: "/agent?slug=a", status: 400, body: {}, expect: "untouched" },

  /* ‏4. המסלול הרגיל, כדי שהבדיקה לא תעבור על פונקציה שהפסיקה להזריק */
  { name: "נכס קיים", url: "/property?id=9", status: 200, body: PROPERTY, expect: "tags" },
  { name: "משרד קיים", url: "/agency?slug=a", status: 200, body: { name: "משרד", description: "ד" }, expect: "tags" },
  { name: "כתבה קיימת", url: "/article?slug=a", status: 200, body: { slug: "a", title: "כותרת" }, expect: "tags" },
];

const NOINDEX = /<meta name="robots" content="noindex,follow">/;
const CANONICAL = /<link rel="canonical" href="([^"]+)">/;

async function actual(c: Case): Promise<Expected | string> {
  // ‏אין status = הבדיקה מצפה שלא תצא קריאה בכלל, ולכן כל קריאה היא כשל
  globalThis.fetch = (async () => {
    if (c.status === undefined) throw new Error("יצאה קריאה למסד שלא הייתה צריכה לצאת");
    return new Response(JSON.stringify(c.body), {
      status: c.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const res = await handler(new Request(`https://shuknadlan.co.il${c.url}`), context());
  const html = await res.text();

  if (html === PAGE) return "untouched";
  const hasNoindex = NOINDEX.test(html);
  const canonical = html.match(CANONICAL);

  if (hasNoindex && canonical) return "‏noindex **וגם** canonical — שתי הצהרות סותרות";
  if (hasNoindex) return "noindex";
  if (canonical) return "tags";
  return "הדף שונה אבל בלי noindex ובלי canonical";
}

let failed = 0;
for (const c of CASES) {
  const got = await actual(c);
  const ok = got === c.expect;
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${c.name.padEnd(34)} ציפינו ל-${c.expect}, קיבלנו ${got}`);
}

/* ---------------------------------------------------------------------------
   ‏תוכן לסורק בדף נכס: JSON-LD, וה-H1 והתיאור כבר ב-HTML
   ---------------------------------------------------------------------------
   ‏מנועי AI אינם מריצים JS, ולכן מה שלא יוצא מהשרת לא קיים בשבילם. וכל
   שדה כאן הוא טקסט שסוכן/ת הקליד/ה - ולכן גם הבריחה נבדקת, וגם שמספר
   הבית לא דולף לנתונים המובנים. */
const PROP_PAGE =
  `<!doctype html><html><head><title>נכס | שוק נדל״ן</title></head><body>` +
  `<h1 class="prop-title" id="propTitle">-</h1>` +
  `<div class="prop-address" id="propAddress"></div>` +
  `<div class="desc-block" id="descSection" hidden>` +
  `<p class="prop-desc" id="propDescription"></p></div></body></html>`;

const RICH = {
  ...PROPERTY,
  property_type: "דירה",
  floor: 3,
  updated_at: "2026-10-01T10:00:00+00:00",
  description: "תיאור ישן",
  marketing_description: "דירה מוארת </script><script>alert(1)</script> ליד הפארק",
  marketing_description_stale: false,
};

async function render(row: unknown): Promise<string> {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(row), { status: 200, headers: { "content-type": "application/json" } })
  ) as typeof fetch;
  const ctx = {
    next: async () => new Response(PROP_PAGE, { headers: { "content-type": "text/html; charset=utf-8" } }),
  } as never;
  const res = await handler(new Request("https://shuknadlan.co.il/property?id=9"), ctx);
  return res.text();
}

const checks: [string, (html: string) => boolean][] = [];
const richHtml = await render(RICH);
const ld = (() => {
  const m = richHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  try { return m ? JSON.parse(m[1]) : null; } catch { return null; }
})();
const listing = ld?.["@graph"]?.find((n: { "@type": string }) => n["@type"] === "RealEstateListing");

checks.push(
  ["JSON-LD נפרס כ-JSON תקין", () => !!ld],
  ["‏RealEstateListing עם מחיר ב-ILS", () => listing?.offers?.price === 1500000 && listing?.offers?.priceCurrency === "ILS"],
  ["‏Apartment עם 4 חדרים, 100 מ״ר וקומה 3", () =>
    listing?.about?.["@type"] === "Apartment" && listing?.about?.numberOfRooms === 4 &&
    listing?.about?.floorSize?.value === 100 && listing?.about?.floorLevel === "3"],
  ["‏BreadcrumbList עיר, שכונה, מודעה", () => {
    const crumbs = ld?.["@graph"]?.find((n: { "@type": string }) => n["@type"] === "BreadcrumbList");
    const names = (crumbs?.itemListElement || []).map((x: { name: string }) => x.name);
    const hood = (crumbs?.itemListElement || []).find((x: { name: string }) => x.name === "גבעת המורה");
    return names.join("|") === "שוק נדל״ן|עפולה|גבעת המורה|דירה 4 חד׳ בהרצל 12, עפולה"
      && decodeURIComponent(hood?.item || "").includes("/n/afula/גבעת-המורה");
  }],
  ["רחוב ומספר בכתובת המובנית, בלי גוש", () =>
    listing?.about?.address?.streetAddress === "הרצל 12" &&
    listing?.about?.address?.addressLocality === "עפולה" &&
    !/גוש|חלקה|geo/.test(JSON.stringify(ld))],
  ["‏</script> מתיאור אינו סוגר את התגית", (h) => (h.match(/<script/g) || []).length === 1],
  ["‏H1 עם רחוב ומספר", (h) => /<h1 class="prop-title" id="propTitle">דירה 4 חד׳ בהרצל 12, עפולה<\/h1>/.test(h)],
  ["שורת כתובת ב-HTML", (h) => /id="propAddress">הרצל 12, גבעת המורה, עפולה</.test(h)],
  ["התיאור השיווקי בגוף הדף, מוברח", (h) => /id="propDescription">דירה מוארת &lt;\/script&gt;/.test(h)],
  ["‏descSection נחשף", (h) => /<div class="desc-block" id="descSection">/.test(h)],
);

for (const [name, ok] of checks) {
  const pass = ok(richHtml);
  if (!pass) failed++;
  console.log(`${pass ? "✓" : "✗"} ${name}`);
}

/* נוסח מתיישן: תיאור המודעה עדיף - כמו renderDescription */
const staleHtml = await render({ ...RICH, marketing_description_stale: true });
const stalePass = /id="propDescription">תיאור ישן</.test(staleHtml);
if (!stalePass) failed++;
console.log(`${stalePass ? "✓" : "✗"} נוסח שיווקי מתיישן מוחלף בתיאור המודעה`);

/* נכס מסחרי: Place, בלי חדרים */
const shopHtml = await render({ ...RICH, property_type: "חנויות/שטח מסחרי" });
const shopLd = JSON.parse(shopHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
const shop = shopLd["@graph"][0].about;
const shopPass = shop["@type"] === "Place" && shop.numberOfRooms === undefined;
if (!shopPass) failed++;
console.log(`${shopPass ? "✓" : "✗"} נכס מסחרי הוא Place בלי חדרים`);

/* בלי תיאור: הבלוק נשאר מוסתר, כמו ב-JS */
const bareHtml = await render({ ...RICH, description: null, marketing_description: null });
const barePass = /id="descSection" hidden>/.test(bareHtml);
if (!barePass) failed++;
console.log(`${barePass ? "✓" : "✗"} בלי תיאור הבלוק נשאר מוסתר`);

/* ---------------------------------------------------------------------------
   ‏משרד, סוכן/ת וכתבה: הנתונים המובנים של כל אחד
   --------------------------------------------------------------------------- */
async function ldAt(url: string, row: unknown): Promise<Record<string, any> | null> {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(row), { status: 200, headers: { "content-type": "application/json" } })
  ) as typeof fetch;
  const res = await handler(new Request(`https://shuknadlan.co.il${url}`), context());
  const m = (await res.text()).match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  try { return m ? JSON.parse(m[1]) : null; } catch { return null; }
}

const agencyLd = await ldAt("/agency?slug=a", { name: "משרד הדר", description: "ד", logo_url: "/l.png", address: "הנשיא 5, עפולה", tagline: "ס" });
const agentLd = await ldAt("/agent?slug=a", { display_name: "דנה", bio: "ב", photo_url: "/p.jpg", license_number: "123456" });
const agentNoLicense = await ldAt("/agent?slug=a", { display_name: "דנה", bio: "ב", license_number: null });
const articleLd = await ldAt("/article?slug=a", { slug: "a", title: "כותרת", subtitle: "תת", published_at: "2026-10-01T00:00:00Z", author_name: null });

/* ‏משרד עם דירוג: שתי שאילתות, ולכן ה-fetch המדומה עונה לפי הנתיב */
async function agencyWithRating(rating: unknown, status = 200): Promise<Record<string, any> | null> {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const u = String(input instanceof Request ? input.url : input);
    const body = u.includes("agency_ratings_public") ? rating : { id: "ag1", name: "משרד הדר", description: "ד" };
    const st = u.includes("agency_ratings_public") ? status : 200;
    return new Response(JSON.stringify(body), { status: st, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const res = await handler(new Request("https://shuknadlan.co.il/agency?slug=a"), context());
  const m = (await res.text()).match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  try { return m ? JSON.parse(m[1]) : null; } catch { return null; }
}
const rated = await agencyWithRating({ score: "4.67", review_count: 3 });
const ratedOne = await agencyWithRating({ score: "5", review_count: 1 });
const ratedNull = await agencyWithRating({ score: null, review_count: 0 });
const ratedErr = await agencyWithRating({}, 500);

const more: [string, boolean][] = [
  ["משרד עם 3 ביקורות: AggregateRating 4.7 מתוך 3", rated?.aggregateRating?.ratingValue === 4.7 &&
    rated?.aggregateRating?.reviewCount === 3],
  ["משרד עם ביקורת אחת: בלי דירוג (הדף אינו מציג מתחת ל-2)", ratedOne?.["@type"] === "RealEstateAgent" &&
    ratedOne?.aggregateRating === undefined],
  ["משרד בלי ביקורות: בלי דירוג", ratedNull?.["@type"] === "RealEstateAgent" && ratedNull?.aggregateRating === undefined],
  ["כשל בשאילתת הדירוג: הדף יוצא בלי דירוג", ratedErr?.["@type"] === "RealEstateAgent" && ratedErr?.aggregateRating === undefined],
  ["משרד: RealEstateAgent עם כתובת ולוגו", agencyLd?.["@type"] === "RealEstateAgent" &&
    agencyLd?.address?.streetAddress === "הנשיא 5, עפולה" && agencyLd?.logo === "https://shuknadlan.co.il/l.png"],
  ["סוכן/ת: Person עם רישיון התיווך", agentLd?.["@type"] === "Person" &&
    agentLd?.hasCredential?.identifier === "123456"],
  ["סוכן/ת בלי רישיון: בלי hasCredential", agentNoLicense?.["@type"] === "Person" && agentNoLicense?.hasCredential === undefined],
  ["כתבה: Article עם תאריך ו-author", articleLd?.["@type"] === "Article" &&
    articleLd?.datePublished === "2026-10-01T00:00:00Z" && articleLd?.author?.name === "שוק נדל״ן"],
];
for (const [name, pass] of more) {
  if (!pass) failed++;
  console.log(`${pass ? "✓" : "✗"} ${name}`);
}

/* ---------------------------------------------------------------------------
   ‏גוף הכתבה ו"על המשרד" בשרת - בדפים האמיתיים, כי ה-id-ים שם הם החוזה
   --------------------------------------------------------------------------- */
import { readFileSync } from "node:fs";
async function serve(file: string, url: string, row: unknown): Promise<string> {
  const page = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(row), { status: 200, headers: { "content-type": "application/json" } })
  ) as typeof fetch;
  const ctx = { next: async () => new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } }) } as never;
  return (await handler(new Request(`https://shuknadlan.co.il${url}`), ctx)).text();
}

const LONG = "פסקה ראשונה ארוכה מספיק כדי לקבל את האות המוגדלת. ".repeat(4).trim();
const art = await serve("article.html", "/article?slug=a", {
  slug: "a", title: "כותרת", subtitle: "תת כותרת", published_at: "2026-10-01T00:00:00Z",
  body: `${LONG}\n\nמה חשוב לדעת:\n- פריט <b>ראשון</b>\n- פריט שני\n\n"ציטוט"\nשורה שנייה\nשל אותה פסקה`,
});
const artBare = await serve("article.html", "/article?slug=a", { slug: "a", title: "כותרת", body: "" });
const ag = await serve("agency.html", "/agency?slug=a", { id: "x", name: "משרד הדר", description: "פסקה א\n\nפסקה <ב>", address: "הנשיא 5, עפולה" });
const agFallback = await serve("agency.html", "/agency?slug=a", { id: "x", name: "אביה גולדברג - תיווך", description: null, address: "עפולה", specialty_areas: ["עפולה", "גבעת המורה", "בית שאן"] });
const agEmpty = await serve("agency.html", "/agency?slug=a", { id: "x", name: "משרד", description: null, address: null, specialty_areas: [] });

const bodies: [string, boolean][] = [
  ["כתבה: H1 בשרת", /<h1 class="title" id="articleTitle">כותרת<\/h1>/.test(art)],
  ["כתבה: כותרת משנה בשרת ונחשפת", /<p class="subtitle" id="articleSubtitle">תת כותרת<\/p>/.test(art)],
  ["כתבה: הגוף בשרת - פסקה עם אות מוגדלת, h2, רשימה, ציטוט", /id="articleBody"><p class="lead-para">פסקה ראשונה/.test(art) &&
    art.includes("<h2>מה חשוב לדעת</h2>") && art.includes("<li>פריט &lt;b&gt;ראשון&lt;/b&gt;</li>") &&
    art.includes("<blockquote>&quot;ציטוט&quot;</blockquote>") && art.includes("<p>שורה שנייה של אותה פסקה</p>")],
  ["כתבה בלי גוף: הגוף נשאר ריק וכותרת המשנה מוסתרת", /id="articleBody"><\/div>/.test(artBare) && /id="articleSubtitle" hidden>/.test(artBare)],
  ["משרד: התיאור בשתי פסקאות, מוברח, והמקטע נחשף", /id="aboutText"><p>פסקה א<\/p><p>פסקה &lt;ב&gt;<\/p>/.test(ag) && /id="aboutSec" aria-labelledby="aboutHeading">/.test(ag)],
  ["משרד: H1 בשרת", /id="brandName">משרד הדר<\/h1>/.test(ag)],
  ["משרד בלי תיאור: משפט עובדתי עם הכתובת והאזורים", agFallback.includes("<p>משרד התיווך אביה גולדברג - תיווך, עפולה. אזורי פעילות: עפולה, גבעת המורה ובית שאן.</p>")],
  ["משרד בלי תיאור, כתובת ואזורים: המקטע מוסתר", /id="aboutSec" aria-labelledby="aboutHeading" hidden>/.test(agEmpty) && /id="aboutText"><\/div>/.test(agEmpty)],
];

/* ‏סוכן/ת, פרויקט, יזם ובעל/ת מקצוע: H1 ותוכן מהשרת, ונתונים מובנים */
const ldOf = (h: string) => {
  const m = h.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  try { return m ? JSON.parse(m[1]) : null; } catch { return null; }
};
const agentPage = await serve("agent.html", "/agent?slug=a", { display_name: "דנה <לוי>", bio: null, license_number: "1" });
const projPage = await serve("project.html", "/project?slug=a", { name: "מגדלי העמק", city: "עפולה", tagline: "ס", description: "על <הפרויקט>" });
const projBare = await serve("project.html", "/project?slug=a", { name: "מגדלי העמק", city: null, tagline: null, description: null });
const devPage = await serve("developer.html", "/developer?slug=a", { name: "יזם בע\"מ", city: "עפולה", tagline: null, description: "על החברה", logo_url: "/l.png" });
const proPage = await serve("professional.html", "/professional?slug=a", { slug: "a", advertiser_name: "רון", business_name: "שמאות רון", advertiser_type: "appraiser", target_region: "עפולה", headline: "שמאי מוסמך", description: "תיאור" });
bodies.push(
  ["סוכן/ת: H1 מוברח וביו ברירת מחדל בשרת", /id="profileName">דנה &lt;לוי&gt;<\/h1>/.test(agentPage) &&
    agentPage.includes('id="profileBio">סוכן/ת נדל״ן פעיל/ה באזור עפולה והעמק.</p>')],
  ["פרויקט: ApartmentComplex עם עיר, H1, סלוגן ותיאור נחשפים", ldOf(projPage)?.["@type"] === "ApartmentComplex" &&
    ldOf(projPage)?.address?.addressLocality === "עפולה" && /id="projectName">מגדלי העמק<\/h1>/.test(projPage) &&
    /id="projectTagline">ס<\/p>/.test(projPage) && /id="aboutSec">/.test(projPage) && projPage.includes("על &lt;הפרויקט&gt;")],
  ["פרויקט בלי תיאור: המקטע נשאר מוסתר", /id="aboutSec" hidden>/.test(projBare) && /id="projectTagline" hidden>/.test(projBare)],
  ["יזם: Organization עם לוגו, H1 ו'על החברה' בשרת", ldOf(devPage)?.["@type"] === "Organization" &&
    ldOf(devPage)?.logo === "https://shuknadlan.co.il/l.png" && /id="devName">יזם בע&quot;מ<\/h1>/.test(devPage) &&
    /id="devAbout">על החברה<\/div>/.test(devPage)],
  ["בעל/ת מקצוע: ProfessionalService עם employee, H1, כותרת ותיאור בשרת", ldOf(proPage)?.["@type"] === "ProfessionalService" &&
    ldOf(proPage)?.employee?.name === "רון" && ldOf(proPage)?.serviceType === "שמאי מקרקעין" &&
    /id="profileName">שמאות רון<\/h1>/.test(proPage) && /id="profilePerson">רון<\/span>/.test(proPage) &&
    /id="profileHeadline" dir="auto">שמאי מוסמך<\/span>/.test(proPage) &&
    /id="profileSub">/.test(proPage) && /id="aboutBlock">/.test(proPage)],
);
for (const [name, pass] of bodies) {
  if (!pass) failed++;
  console.log(`${pass ? "✓" : "✗"} ${name}`);
}

/* כותרת המשרד, ספירת הנכסים, ו-301 מ-/agency.html. הספירה נקראת רק
   כשיש Content-Range; מוק בלי הכותרת הזו משאיר את הדף בלי מספר. */
const agTitle = (ag.match(/<title>([^<]*)<\/title>/) || [])[1];
const agMeta = (ag.match(/<meta name="description" content="([^"]*)">/) || [])[1];
const agLd = ldOf(ag);
async function agencyCounted(row: Record<string, unknown>, range: string | null): Promise<string> {
  const page = readFileSync(new URL("../agency.html", import.meta.url), "utf8");
  globalThis.fetch = (async (input: string | URL | Request) => {
    const u = String(input instanceof Request ? input.url : input);
    if (u.includes("/properties?")) {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (range) headers["content-range"] = range;
      return new Response("[]", { status: 200, headers });
    }
    return new Response(JSON.stringify(row), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const ctx = { next: async () => new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } }) } as never;
  return (await handler(new Request("https://shuknadlan.co.il/agency?slug=adel"), ctx)).text();
}
const ADEL = {
  id: "adel",
  name: "אדל נכסים - פתרונות נדל״ן",
  description: "משרד מקומי.",
  address: "הולנד 12 עפולה",
};
const SP = {
  id: "sp",
  name: "s.p שיווק ניהול ומכירת נכסים",
  description: "משרד מקומי.",
  address: "יצחק נבון 3 עפולה",
};
const adelHtml = await agencyCounted(ADEL, "0-0/2");
const spHtml = await agencyCounted(SP, "0-0/2");
const oneHtml = await agencyCounted({ ...ADEL, description: "משרד מקומי." }, "0-0/1");
const noRange = await agencyCounted(ADEL, null);
const areasFirst = await agencyCounted({
  id: "avia",
  name: "אביה גולדברג - תיווך",
  description: null,
  address: "עפולה",
  specialty_areas: ["בית שאן", "גבעת המורה"],
}, null);
function metaOf(html: string): string {
  return (html.match(/<meta name="description" content="([^"]*)">/) || [])[1] || "";
}
function titleOf(html: string): string {
  return (html.match(/<title>([^<]*)<\/title>/) || [])[1] || "";
}
let redirected = false;
globalThis.fetch = (async () => { throw new Error("הפניה אינה קוראת למסד"); }) as typeof fetch;
const redir = await handler(new Request("https://shuknadlan.co.il/agency.html?slug=%D7%90%D7%93%D7%9C&utm=1"), {
  next: async () => { redirected = true; return new Response(PAGE, { headers: { "content-type": "text/html" } }); },
} as never);
const headRedir = await handler(new Request("https://shuknadlan.co.il/agency.html?slug=a", { method: "HEAD" }), {
  next: async () => new Response(PAGE, { headers: { "content-type": "text/html" } }),
} as never);
const agencyHead: [string, boolean][] = [
  ["משרד הדר: כותרת עם העיר מהכתובת", agTitle === "משרד הדר - משרד תיווך בעפולה | שוק נדל״ן"],
  ["בלי Content-Range: התיאור בלי מספר מומצא", !!agMeta && !agMeta.includes("נכסים פעילים") && agMeta.includes("פסקה א")],
  ["JSON-LD נשאר RealEstateAgent והתיאור שבו הוא על המשרד, לא שורת הספירה",
    agLd?.["@type"] === "RealEstateAgent" && agLd?.description === "פסקה א פסקה <ב>" && agLd?.name === "משרד הדר"],
  ["אדל נכסים: כותרת ו-2 נכסים פעילים",
    titleOf(adelHtml) === "אדל נכסים - פתרונות נדל״ן - משרד תיווך בעפולה | שוק נדל״ן"
    && metaOf(adelHtml).includes("2 נכסים פעילים")],
  ["s.p: כותרת עם העיר",
    titleOf(spHtml) === "s.p שיווק ניהול ומכירת נכסים - משרד תיווך בעפולה | שוק נדל״ן"],
  ["נכס אחד: נכס פעיל אחד", metaOf(oneHtml).includes("נכס פעיל אחד")],
  ["בלי Content-Range גם כשיש id: בלי מספר", !metaOf(noRange).includes("נכסים פעילים")],
  ["הכתובת גוברת על עיר ארוכה יותר באזורי הפעילות",
    titleOf(areasFirst) === "אביה גולדברג - תיווך - משרד תיווך בעפולה | שוק נדל״ן"],
  ["/agency.html?slug= מופנה ל-/agency עם אותה שאילתה, בלי לקרוא למסד",
    redir.status === 301 && redir.headers.get("Location") === "/agency?slug=%D7%90%D7%93%D7%9C&utm=1" && !redirected],
  ["HEAD ל-/agency.html מופנה גם הוא",
    headRedir.status === 301 && headRedir.headers.get("Location") === "/agency?slug=a"],
];
for (const [name, pass] of agencyHead) {
  if (!pass) failed++;
  console.log(`${pass ? "✓" : "✗"} ${name}`);
}

/* נכס: 404 כשאין רשומה, 503 בלי noindex כשהמסד נכשל, ושאר הדפים לא זזים. */
async function responseOf(url: string, status: number, body: unknown): Promise<Response> {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
  ) as typeof fetch;
  return await handler(new Request(`https://shuknadlan.co.il${url}`), context());
}
resetLastGood();
const propDown = await responseOf("/property?id=9", 500, {});
const propDownHtml = await propDown.text();
const propMiss = await responseOf("/property?id=9", 406, { code: "PGRST116" });
const propMissHtml = await propMiss.text();
globalThis.fetch = (async () => {
  throw new Error("לא הייתה צריכה לצאת קריאה");
}) as typeof fetch;
const propBare = await handler(new Request("https://shuknadlan.co.il/property"), context());
const propBareHtml = await propBare.text();
const agencyDown = await responseOf("/agency?slug=a", 403, {});
const agencyDownHtml = await agencyDown.text();
const propHttp: [string, boolean][] = [
  ["נכס, מסד 500: 503, הגוף כמו שהוא, בלי noindex", propDown.status === 503 && propDownHtml === PAGE && !NOINDEX.test(propDownHtml)],
  ["נכס, מסד 500: no-store ו-Retry-After", propDown.headers.get("Cache-Control") === "no-store"
    && propDown.headers.get("Netlify-CDN-Cache-Control") === "no-store"
    && propDown.headers.get("Retry-After") === "60"],
  ["נכס חסר: 404 ו-noindex, פסקה ולא H1", propMiss.status === 404 && NOINDEX.test(propMissHtml)
    && propMissHtml.includes('class="prop-missing"') && !/<h1[^>]*>הנכס לא נמצא</.test(propMissHtml)],
  ["נכס חסר: no-store בלי Retry-After", propMiss.headers.get("Cache-Control") === "no-store" && !propMiss.headers.get("Retry-After")],
  ["‏/property בלי id: 404", propBare.status === 404 && NOINDEX.test(propBareHtml)],
  ["משרד, 403: נשאר 200 בלי שינוי", agencyDown.status === 200 && agencyDownHtml === PAGE],
];

/* מחיר, מאפיינים, משרד וסוכן/ת ב-HTML הראשון. שאילתת הסוכן/ת נפרדת. */
const VISIBLE =
  `<!doctype html><html><head><title>x</title></head><body>` +
  `<div id="loadingState">טוען</div><div id="propertyContent">` +
  `<div class="bento" id="bentoGrid"></div>` +
  `<h1 id="propTitle">-</h1>` +
  `<div class="hero-price" id="heroPrice" hidden><div class="num" id="heroPriceNum"></div><div class="sub" id="heroPriceSub"></div></div>` +
  `<span id="agentPriceLabel">מחיר</span><span id="agentPriceValue">-</span>` +
  `<div id="sbPriceLabel">מחיר</div><div id="sbPriceValue">-</div>` +
  `<div id="agencyName">-</div><div id="agentCardName">צוות שוק נדל״ן</div>` +
  `<div id="agentName" hidden></div>` +
  `<div id="specPills"></div>` +
  `<section id="highlightsSection" hidden><div id="highlightsList"></div></section>` +
  `</div></body></html>`;
const VISIBLE_ROW = {
  ...PROPERTY,
  price_per_sqm: "15000",
  rooms: "4.0",
  size_sqm: "100",
  features: ["parking", "mamad"],
  agent_id: "agent-1",
  agent2_name: "שותף <ב>",
  agencies: { name: "משרד הדר" },
};
async function visible(row: unknown, agent: unknown, agentStatus = 200): Promise<string> {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const u = String(input instanceof Request ? input.url : input);
    const isAgent = u.includes("agency_members_public");
    return new Response(JSON.stringify(isAgent ? agent : row), {
      status: isAgent ? agentStatus : 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  const res = await handler(new Request("https://shuknadlan.co.il/property?id=9"), {
    next: async () => new Response(VISIBLE, { headers: { "content-type": "text/html; charset=utf-8" } }),
  } as never);
  return await res.text();
}
const seen = await visible(VISIBLE_ROW, { display_name: "דנה כהן" });
const commercial = await visible({
  ...VISIBLE_ROW, deal_type: "rent", category: "commercial", price_includes_vat: false, agent2_name: null,
}, { display_name: "" }, 500);
propHttp.push(
  ["מחיר ומשרד ב-HTML, H1 אחד", seen.includes("1,500,000 ₪") && seen.includes("מחיר מבוקש")
    && seen.includes(">משרד הדר<") && seen.includes(">דנה כהן<")
    && seen.includes("בשיתוף: שותף &lt;ב&gt;") && seen.includes(">חניה<") && seen.includes(">ממ״ד<")
    && seen.includes("100 מ״ר") && seen.includes("4 חדרים")
    && /<div class="hero-price" id="heroPrice">/.test(seen)
    && (seen.match(/<h1\b/g) || []).length === 1 && !seen.includes("הנכס לא נמצא")
    && /<body class="property-ready has-sticky-bar">/.test(seen)
    && seen.includes('id="bentoGrid" data-count="1"')
    && seen.includes('data-lcp="1" src="https://shuknadlan.co.il/a.jpg"')
    && seen.includes('rel="preload" as="image" href="https://shuknadlan.co.il/a.jpg"')
    && seen.includes(`rel="preconnect" href="https://obookujgolazrwycsiyn.supabase.co"`)
    && !seen.includes("<video")],
  ["מסחרי להשכרה: מע״מ וחודש, וכשל סוכן/ת לא מפיל את הדף", commercial.includes("שכר דירה חודשי")
    && commercial.includes("/ חודש") && commercial.includes("+ מע״מ") && commercial.includes(">משרד הדר<")],
);
const reel = await visible({
  ...VISIBLE_ROW,
  video_url: "https://cdn.example/property-videos/marketing-reel-a.mp4",
  video_poster_url: "https://cdn.example/poster.jpg",
  images: ["https://cdn.example/1.jpg", "https://cdn.example/2.jpg"],
}, { display_name: "דנה כהן" });
propHttp.push(
  ["שער סרטון ב-HTML בלי src, עם preload", reel.includes('class="bento-video-bg"')
    && reel.includes('src="https://cdn.example/poster.jpg"')
    && reel.includes('data-count="3"')
    && reel.includes('rel="preload" as="image" href="https://cdn.example/poster.jpg"')
    && reel.includes('rel="preconnect" href="https://cdn.example"')
    && !reel.includes("<video")],
  ["404 בלי חשיפת המודעה", !propMissHtml.includes("property-ready") && !propMissHtml.includes("bento-video-bg")],
);
const ORIG = "https://obookujgolazrwycsiyn.supabase.co/storage/v1/object/public/property-images/a.jpg?token=1";
const PATH = "https://obookujgolazrwycsiyn.supabase.co/storage/v1/render/image/public/property-images/a.jpg";
const R800 = `${PATH}?width=800&height=500&resize=cover&quality=60`;
const R1200 = `${PATH}?width=1200&height=800&resize=cover&quality=60`;
const amp = (s: string) => s.replace(/&/g, "&amp;");
const stored = await visible({
  ...VISIBLE_ROW,
  images: [ORIG, "https://cdn.example/2.jpg"],
}, { display_name: "דנה כהן" });
const storedReel = await visible({
  ...VISIBLE_ROW,
  video_url: "https://cdn.example/property-videos/marketing-reel-a.mp4",
  video_poster_url: ORIG,
  images: ["https://cdn.example/1.jpg"],
}, { display_name: "דנה כהן" });
propHttp.push(
  ["שער מהאחסון: render 800, srcset 1200, והמקור ב-og", stored.includes(`src="${amp(R800)}"`)
    && stored.includes(`srcset="${amp(`${R800} 800w, ${R1200} 1200w`)}"`)
    && stored.includes('sizes="(min-width:640px) 640px, 100vw"')
    && stored.includes(`data-full="${amp(ORIG)}"`)
    && stored.includes("this.removeAttribute('srcset')")
    && stored.includes(`rel="preload" as="image" href="${amp(R800)}"`)
    && stored.includes(`property="og:image" content="${ORIG}"`)
    && stored.includes(`"${ORIG}"`)
    && !stored.includes("<video")],
  ["שער סרטון מהאחסון: אותה כתובת ב-src וב-preload", storedReel.includes('class="bento-video-bg"')
    && storedReel.includes(`src="${amp(R800)}"`)
    && storedReel.includes(`rel="preload" as="image" href="${amp(R800)}"`)
    && storedReel.includes(`data-full="${amp(ORIG)}"`)
    && !storedReel.includes("<video>")
    && !storedReel.includes("property-placeholder.jpg")],
);
const bare = await visible({
  ...VISIBLE_ROW,
  images: [],
  video_url: null,
  video_poster_url: null,
}, { display_name: "דנה כהן" });
propHttp.push(
  ["בלי תמונת שער: preload לפלייסהולדר, בלי לגעת ב-JSON-LD", bare.includes('rel="preload" as="image" href="/assets/property-placeholder.jpg" fetchpriority="high"')
    && bare.includes('id="bentoGrid"')
    && !bare.includes("data-lcp")
    && bare.includes("application/ld+json")
    && bare.includes('rel="canonical"')],
);
resetLastGood();
const propGood = await responseOf("/property?id=9", 200, PROPERTY);
const propGoodHtml = await propGood.text();
const propStale = await responseOf("/property?id=9", 500, {});
const propStaleHtml = await propStale.text();
const agencyStale = await responseOf("/agency?slug=a", 500, {});
const agencyStaleHtml = await agencyStale.text();
propHttp.push(
  ["נכס, כשל אחרי הצלחה: 200 ואותו HTML", propStale.status === 200 && propStaleHtml === propGoodHtml && propGoodHtml !== PAGE && !propStale.headers.get("Retry-After")],
  ["משרד, כשל נשאר התשובה המקורית", agencyStale.status === 200 && agencyStaleHtml === PAGE],
);
for (const [name, pass] of propHttp) {
  if (!pass) failed++;
  console.log(`${pass ? "✓" : "✗"} ${name}`);
}

const total = CASES.length + checks.length + 3 + more.length + bodies.length + propHttp.length;
if (failed) {
  console.error(`\n✗ ${failed} מתוך ${total} מקרים התנהגו אחרת.`);
  process.exit(1);
}
console.log(`\n✓ ${total} מקרים: הרשומה שאינה קיימת מקבלת noindex, הכשל הזמני אינו, ודף נכס יוצא עם תוכן לסורק.`);
