/* ============================================================================
   ‏הבדיקה של ההחלטה האחת ב-og-tags.ts שאי אפשר לראות שהיא נשברה
   ----------------------------------------------------------------------------
   ‏`netlify/edge-functions/og-tags.ts` מחליטה, לכל דף פירוט, בין שלושה
   מצבים — ושלושתם נראים בדפדפן **בדיוק אותו דבר**:

     ‏1. יש רשומה  → מזריקים canonical ותגיות שיתוף.
     ‏2. אין רשומה (המסד ענה 406/404) → ‎noindex,follow‎.
     ‏3. לא הצלחנו לשאול (‏timeout, ‏5xx, ‏401) → הדף יוצא **כמו שהוא**.

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
  ["‏BreadcrumbList", () => ld?.["@graph"]?.some((n: { "@type": string }) => n["@type"] === "BreadcrumbList")],
  ["מספר הבית אינו בנתונים המובנים", () => !/הרצל 12/.test(JSON.stringify(ld))],
  ["‏</script> מתיאור אינו סוגר את התגית", (h) => (h.match(/<script/g) || []).length === 1],
  ["‏H1 מלא בכותרת ממוסכת", (h) => /<h1 class="prop-title" id="propTitle">דירת 4 חדרים ברחוב הרצל<\/h1>/.test(h)],
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

const total = CASES.length + checks.length + 3 + more.length;
if (failed) {
  console.error(`\n✗ ${failed} מתוך ${total} מקרים התנהגו אחרת.`);
  process.exit(1);
}
console.log(`\n✓ ${total} מקרים: הרשומה שאינה קיימת מקבלת noindex, הכשל הזמני אינו, ודף נכס יוצא עם תוכן לסורק.`);
