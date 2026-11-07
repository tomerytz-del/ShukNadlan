/* ============================================================================
   כרטיס "רוצים לדעת עוד על השכונה?" בדף הנכס
   ----------------------------------------------------------------------------
   ‏`og-tags.ts` (‏hoodCard) כותבת לתוך ‎<aside id="hoodCard" hidden>‎ קישור לדף
   השכונה, כך שכל נכס מצביע על שכונתו ב-HTML הראשון, בלי JS. הכרטיס כשל שקט
   משני הכיוונים: קישור לדף שאינו לאינדקס (שכונה בלי מודעה, או שוק שאינו חי)
   מבזבז סריקה, וקישור שנעלם נראה תקין בדפדפן כי ‏property.js ממלא אותו אחר כך.

   מה נבדק:
     · שכונה עם מודעה פעילה בשוק חי - הקישור ב-HTML, והכרטיס נחשף (בלי hidden).
     · שכונה בלי מודעה, שוק שאינו חי, אין שורה, שגיאת מסד, וכתובת בלי
       שכונה - הכרטיס נשאר מוסתר וריק, והנכס עצמו יוצא כרגיל (canonical).
     · המבנה בשרת זהה ל-renderHoodCard ב-assets/property.js (אותן מחרוזות).

   הרצה:

       node --experimental-strip-types scripts/hood_card_test.ts

   ‏יציאה 0 = הכול תקין. התיעוד: ‎docs/neighborhood-pages.md‎.
   ========================================================================== */

import { readFileSync } from "node:fs";
import handler from "../netlify/edge-functions/og-tags.ts";
import { resetLastGood } from "../netlify/edge-functions/lib/last-good.ts";

const realFetch = globalThis.fetch;

const PAGE =
  `<!doctype html><html><head><title>נכס | שוק נדל״ן</title></head><body>` +
  `<aside class="hood-card" id="hoodCard" hidden></aside></body></html>`;

const context = () =>
  ({
    next: async () =>
      new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } }),
  }) as never;

const PROPERTY = {
  title: "דירת 4 חדרים ברחוב הרצל 12",
  house_number: "12",
  address: "הרצל 12",
  city: "עפולה",
  city_id: "afula",
  images: ["/a.jpg"],
  price: 1500000,
  deal_type: "sale",
  rooms: "4.0",
  size_sqm: "100",
  status: "active",
  lat: "32.61",
  lng: "35.29",
  neighborhoods: { name: "גבעת המורה" },
};

type Case = {
  name: string;
  property?: Record<string, unknown>;
  /* התשובה של neighborhood_pages_public. undefined = אסור לקרוא לה בכלל */
  hood?: { status: number; body: unknown };
  card: boolean;
};

const HOOD_OK = { status: 200, body: { city_slug: "afula", slug: "גבעת-המורה", props: 3 } };

const CASES: Case[] = [
  { name: "שכונה עם מודעה פעילה בשוק חי", hood: HOOD_OK, card: true },
  { name: "שכונה בלי מודעה פעילה (props 0)", hood: { status: 200, body: { city_slug: "afula", slug: "גבעת-המורה", props: 0 } }, card: false },
  { name: "אין שורה לשכונה (406)", hood: { status: 406, body: { code: "PGRST116" } }, card: false },
  { name: "שגיאת מסד (500) - הנכס יוצא כרגיל", hood: { status: 500, body: {} }, card: false },
  { name: "נכס בשוק שאינו חי (אשדוד)", property: { ...PROPERTY, city: "אשדוד", city_id: "ashdod", lat: "31.80", lng: "34.65" }, hood: HOOD_OK, card: false },
  { name: "נכס בלי קואורדינטות", property: { ...PROPERTY, lat: null, lng: null }, hood: HOOD_OK, card: false },
  { name: "נכס בלי שכונה - בלי קריאה", property: { ...PROPERTY, neighborhoods: null }, card: false },
  { name: "שכונה בשם העיר - בלי קריאה", property: { ...PROPERTY, neighborhoods: { name: "עפולה" } }, card: false },
];

const EMPTY_CARD = /<aside class="hood-card" id="hoodCard" hidden><\/aside>/;
const OPEN_CARD = /<aside class="hood-card" id="hoodCard"><a class="hood-card-link" href="([^"]+)" data-hood-card>/;
const CANONICAL = /<link rel="canonical" href="[^"]+">/;

async function run(c: Case): Promise<string> {
  resetLastGood();
  let hoodCalls = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.includes("rpc/neighborhood_pages_public")) {
      hoodCalls++;
      if (!c.hood) throw new Error("יצאה קריאה ל-neighborhood_pages_public שלא הייתה צריכה לצאת");
      return json(c.hood.status, c.hood.body);
    }
    if (url.includes("agency_members_public")) return json(404, {});
    if (url.includes("id=eq.")) return json(200, c.property || PROPERTY);
    return json(200, []); // אחים באותה כתובת
  }) as typeof fetch;

  const res = await handler(
    new Request("https://shuknadlan.co.il/property?id=11111111-1111-4111-8111-111111111111"),
    context(),
  );
  const html = await res.text();
  if (!CANONICAL.test(html)) return "הנכס לא יצא עם canonical";
  if (c.hood === undefined && hoodCalls) return "נקראה הפונקציה בלי שכונה";
  const open = html.match(OPEN_CARD);
  if (c.card) {
    if (!open) return "אין קישור בכרטיס";
    const want = "/n/afula/" + encodeURIComponent("גבעת-המורה");
    if (open[1] !== want) return `הקישור ${open[1]} במקום ${want}`;
    if (/<aside class="hood-card" id="hoodCard" hidden/.test(html)) return "הכרטיס נשאר hidden";
    return "ok";
  }
  if (open) return "הכרטיס נחשף בלי דף שנכנס לאינדקס";
  if (!EMPTY_CARD.test(html)) return "האלמנט השתנה בלי קישור";
  return "ok";
}

let failed = 0;
for (const c of CASES) {
  const got = await run(c);
  const ok = got === "ok";
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${c.name.padEnd(40)} ${ok ? "" : got}`);
}
globalThis.fetch = realFetch;

/* השרת והדפדפן כותבים אותו כרטיס: מחרוזות המבנה חייבות להופיע בשני הקבצים */
const server = readFileSync(new URL("../netlify/edge-functions/og-tags.ts", import.meta.url), "utf8");
const client = readFileSync(new URL("../assets/property.js", import.meta.url), "utf8");
const PARTS = [
  'class="hood-card-link"',
  "data-hood-card",
  'src="/assets/gabriela-avatar.webp"',
  'class="hood-card-ava"',
  "רוצים לדעת עוד על השכונה?",
  "נכסים נוספים ב",
  ", מחירי עסקאות ושכונות סמוכות",
  'class="hood-card-go"',
];
for (const part of PARTS) {
  const both = server.includes(part) && client.includes(part);
  if (!both) failed++;
  console.log(`${both ? "✓" : "✗"} מבנה זהה בשרת ובדפדפן: ${part}`);
}

if (failed) {
  console.error(`\n${failed} מקרים נכשלו`);
  process.exit(1);
}
console.log("\nהכול תקין");
