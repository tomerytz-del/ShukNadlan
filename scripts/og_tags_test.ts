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

if (failed) {
  console.error(`\n✗ ${failed} מתוך ${CASES.length} מקרים התנהגו אחרת.`);
  process.exit(1);
}
console.log(`\n✓ ${CASES.length} מקרים: הרשומה שאינה קיימת מקבלת noindex, והכשל הזמני אינו.`);
