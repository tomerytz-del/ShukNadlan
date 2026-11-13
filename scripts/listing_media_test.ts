/* ============================================================================
   alt לתמונת נכס וכתובת render/image (assets/listing-media.js)
   ----------------------------------------------------------------------------
   הרצה: node --experimental-strip-types scripts/listing_media_test.ts
   ========================================================================== */

import "../assets/listing-media.js";

const LM = (globalThis as {
  ListingMedia: {
    renderUrl: (url: string, width: number, quality?: number) => string;
    srcset: (url: string, widths?: number[]) => string;
    alt: (listing: Record<string, unknown>, opts?: { index?: number; total?: number }) => string;
  };
}).ListingMedia;

const ORIG = "https://obookujgolazrwycsiyn.supabase.co/storage/v1/object/public/property-images/a.jpg?token=1";
const BASE = "https://obookujgolazrwycsiyn.supabase.co/storage/v1/render/image/public/property-images/a.jpg";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) {
    failed++;
    console.log("✗ " + name + (detail != null ? " — " + JSON.stringify(detail) : ""));
  } else {
    console.log("✓ " + name);
  }
}

const full = {
  property_type: "דירה",
  rooms: 4,
  deal_type: "sale",
  neighborhoods: { name: "עפולה עילית" },
  city: "עפולה",
};
check("alt מלא עם אינדקס", LM.alt(full, { index: 1, total: 8 }) === "דירת 4 חדרים למכירה בעפולה עילית, תמונה 2 מתוך 8");
check("שכונה בלי העיר כשהשם כבר כולל אותה", !LM.alt(full).includes("בעפולה עילית, עפולה"));
check("בלי חדרים אין דירת", LM.alt({ property_type: "דירה", deal_type: "rent", city: "עפולה" }) === "דירה להשכרה בעפולה");
check("בלי סוג", LM.alt({ rooms: 3, deal_type: "sale", city: "חיפה" }) === "3 חדרים למכירה בחיפה");
check("שכונה ועיר נפרדות", LM.alt({
  property_type: "בית פרטי/קוטג'", rooms: 5, deal_type: "sale",
  neighborhoods: { name: "גבעת המורה" }, city: "עפולה",
}) === "בית פרטי/קוטג' 5 חדרים למכירה בגבעת המורה, עפולה");
check("שדה חסר נשמט", LM.alt({ property_type: "מגרש", city: "עפולה" }) === "מגרש בעפולה");
check("בלי שדות ובלי אינדקס: ריק", LM.alt({}) === "");
check("רק אינדקס", LM.alt({}, { index: 0, total: 2 }) === "תמונה 1 מתוך 2");
check("כרטיס בלי אינדקס אינו מונה תמונות", !LM.alt(full).includes("תמונה"));
check("אין ספירת מודעות", !/נכסים/.test(LM.alt(full, { index: 0, total: 3 })));
check("חדר אחד", LM.alt({ property_type: "דירה", rooms: 1, deal_type: "sale" }) === "דירת חדר אחד למכירה");
check("4.5 חדרים", LM.alt({ rooms: 4.5, deal_type: "rent", sales_area: "המושבה" }) === "4.5 חדרים להשכרה בהמושבה");
check("הרצליה", LM.alt({ property_type: "דירה", rooms: 3, deal_type: "sale", city: "הרצליה" }) === "דירת 3 חדרים למכירה בהרצליה");
check("הוד השרון", LM.alt({ deal_type: "rent", city: "הוד השרון" }) === "להשכרה בהוד השרון");
check("היוגב", LM.alt({ property_type: "בית", city: "היוגב" }) === "בית בהיוגב");
check("עפולה עלית", LM.alt({
  property_type: "דירה", rooms: 4, deal_type: "sale",
  neighborhoods: { name: "עפולה עלית" }, city: "עפולה",
}) === "דירת 4 חדרים למכירה בעפולה עלית");

check("המרת object ל-render", LM.renderUrl(ORIG, 400) === `${BASE}?width=400&quality=70`);
check("איכות מפורשת", LM.renderUrl(ORIG, 800, 60) === `${BASE}?width=800&quality=60`);
check("כתובת זרה נשארת", LM.renderUrl("https://cdn.example/a.jpg", 400) === "https://cdn.example/a.jpg");
check("נתיב מקומי נשאר", LM.renderUrl("/assets/property-placeholder.jpg", 800) === "/assets/property-placeholder.jpg");
check("ריק נשאר ריק", LM.renderUrl("", 400) === "");
check("render קיים לא נעטף שוב", LM.renderUrl(`${BASE}?width=400&quality=70`, 800) === `${BASE}?width=400&quality=70`);
const set = LM.srcset(ORIG, [400, 800, 1200]);
check("srcset", set === [400, 800, 1200].map((w) => `${BASE}?width=${w}&quality=70 ${w}w`).join(", "));
check("srcset לכתובת זרה ריק", LM.srcset("https://cdn.example/a.jpg") === "");

if (failed) {
  console.log("\n✗ " + failed + " נכשלו");
  process.exit(1);
}
console.log("\n✓ alt וכתובת התמונה");
