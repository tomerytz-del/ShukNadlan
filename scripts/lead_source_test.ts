/* ============================================================================
   מקורות ליד שהאתר שולח (supabase/functions/_shared/lead-routing.ts)

   מה שנשבר בשקט: ערך שאינו ב-KNOWN_SOURCES נופל לברירת המחדל של הפונקציה
   (‏property_page_inquiry) - הליד מגיע, ורק היומן וה-CRM מספרים מקור שגוי.

       node --experimental-strip-types scripts/lead_source_test.ts
   ========================================================================== */
// lead-routing.ts קורא ל-Deno.env בטעינה (דרך platform-mail-client.ts)
(globalThis as any).Deno ??= { env: { get: () => "" } };
const { normalizeSource } = await import("../supabase/functions/_shared/lead-routing.ts");

let failed = 0;
function eq(name: string, got: unknown, want: unknown) {
  if (got === want) return;
  failed++;
  console.error(`✗ ${name}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
}

// גלישה בהחלקה ובקשת תמונות (‏docs/swipe-mode.md, ‏docs/no-photo.md)
for (const s of ["swipe", "swipe_sponsored", "swipe_end", "photo_request", "swipe_seller", "swipe_fair", "nocommission_fair", "sell_page", "sell_page_agent"]) {
  eq(s, normalizeSource(s, ""), s);
}
// ערך לא מוכר - ברירת המחדל של הקורא
eq("unknown", normalizeSource("photo_requests", "property_page_inquiry"), "property_page_inquiry");
eq("non-string", normalizeSource(42, "x"), "x");
// מקור חברתי רק מקורא פנימי
eq("social untrusted", normalizeSource("facebook_dm", "x"), "x");

if (failed) { console.error(`${failed} בדיקות נכשלו`); process.exit(1); }
console.log("✓ מקורות הליד מוכרים, ומה שאינו מוכר נופל לברירת המחדל");
