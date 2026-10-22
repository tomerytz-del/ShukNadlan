/* ============================================================================
   דף הבדיקה התכנונית (/plan) - הסיכום שנשמר, בלי רשת

   ‏planning-link מקבלת רשומה מהדפדפן - קלט זר - ושומרת ממנה סיכום.
   נבדק: קישור רק למבא"ת, מספרים לא תקינים נזרקים, הייעוד של המגרש קודם.

       node --experimental-strip-types scripts/planning_link_test.ts

   ‏docs/govmap.md, "דף הבדיקה".
   ========================================================================== */
import { summarize, targetLabel } from "../supabase/functions/planning-link/summary.ts";

let fail = 0;
const ok = (name: string, cond: unknown) => {
  console.log((cond ? "✓ " : "✗ ") + name);
  if (!cond) fail++;
};

// ‏GovmapLookup.addressRecord - דפנה 4 עפולה, בקיצור
const REC = {
  gush: "16746", helka: "147", parcel_area_sqm: 512.4, parcel_status: "מוסדר",
  land_use_designation: "מגורים א", pin_source: "address", lat: 32.61, lng: 35.29,
  applicable_plans: [{ number: "ג/20010", date: "2015-01-01" }],
  govmap_plans: [
    { number: "תמא/ 15/ ג/ סעיף-77-78", name: "שדה תעופה משלים בנבטים", kind: "הודעה על הכנת תוכנית (סעיף 77-78)",
      stage: "notice", notice: true, url: "https://mavat.iplan.gov.il/SV4/1/99005336124/310", designation: "מגבלות בניה ופיתוח" },
    { number: "215-0898114", name: "תכנית מתאר כוללנית עפולה", kind: "תכנית כוללנית", stage: "approved",
      notice: false, url: "javascript:alert(1)", designation: "מגורים" },
  ],
};

const s = summarize(REC)!;
ok("גוש, חלקה ושטח", s.gush === "16746" && s.helka === "147" && s.area_sqm === 512);
ok("הייעוד של המגרש קודם לייעוד התוכנית", s.designation === "מגורים א");
ok("קישור שאינו למבא\"ת נזרק", s.plans[1].url === null && s.plans[0].url !== null);
ok("גוש לא מספרי נזרק", summarize({ ...REC, gush: "16746; drop" })!.gush === null);
ok("בלי ייעוד מגרש - של התוכנית המאושרת, לא של ההודעה",
  summarize({ ...REC, land_use_designation: null })!.designation === "מגורים");
ok("רשומה ריקה / מערך / null -> לא נמצא", summarize(null) === null && summarize([]) === null);
ok("עד 8 תוכניות", summarize({ ...REC, govmap_plans: Array(20).fill(REC.govmap_plans[1]) })!.plans.length === 8);

ok("תווית כתובת", targetLabel({ city: "עפולה", street: "דפנה", house_number: "4" }) === "דפנה 4, עפולה");
ok("תווית גוש/חלקה", targetLabel({ gush: "1", helka: "2" }) === "גוש 1 חלקה 2");

if (fail) {
  console.log(`${fail} נכשלו`);
  process.exit(1);
}
