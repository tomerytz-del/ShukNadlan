/* כינוי הרחוב קק״ל בעפולה, ושערים שלא דולפים לעיר אחרת.
   node --experimental-strip-types scripts/street_alias_test.ts */
import {
  aliasDisplayName,
  aliasStreetLabel,
  canonicalStreet,
  equivalentStreetKeys,
  replaceStreetInAddress,
  storedStreetMatches,
  streetCanonIndex,
  streetKey,
  type StreetAliasRow,
  type StreetNameRow,
} from "../supabase/functions/_shared/geocode/street-alias.ts";

let fail = 0;
const ok = (name: string, cond: boolean) => {
  console.log((cond ? "✓ " : "✗ ") + name);
  if (!cond) fail++;
};

const OFFICIAL = "קרן קיימת לישראל";
const registry: StreetNameRow[] = [
  { city: "עפולה", name: OFFICIAL },
  { city: "עפולה", name: "קרן היסוד" },
  { city: "חיפה", name: OFFICIAL },
  { city: "יהוד-מונוסון", name: "בר סימנטוב יעקב" },
  { city: "קריית ים", name: "קרן קימת" },
  { city: "בדיקה", name: "קקל" },
  { city: "בדיקה", name: "רחוב אחר" },
];
const aliases: StreetAliasRow[] = [
  { city: "עפולה", alias: "קק״ל", name: OFFICIAL },
  { city: "חיפה", alias: "קקל", name: OFFICIAL },
  { city: "יהוד-מונוסון", alias: "קקל", name: "בר סימנטוב יעקב" },
  { city: "קריית ים", alias: 'קק"ל', name: "קרן קימת" },
  { city: "בדיקה", alias: "קק״ל", name: "רחוב אחר" },
];
const index = streetCanonIndex(registry, aliases);

const afula = [
  "קק״ל",
  'קק"ל',
  "קק'ל",
  "קקל",
  'רח\' קק"ל',
  "רחוב קק״ל",
  "רח קקל",
];
for (const typed of afula) {
  ok(`עפולה «${typed}» → ${OFFICIAL}`, canonicalStreet(index, "עפולה", typed) === OFFICIAL);
}

ok("עפולה: השם המלא נשאר השם המלא", canonicalStreet(index, "עפולה", OFFICIAL) === OFFICIAL);
ok("עפולה: קרן היסוד אינו קק״ל", canonicalStreet(index, "עפולה", "קרן היסוד") === "קרן היסוד");

ok("יהוד: קקל הוא הרחוב של יהוד, לא של עפולה",
  canonicalStreet(index, "יהוד-מונוסון", "קק״ל") === "בר סימנטוב יעקב");
ok("קריית ים: השם הרשמי הקצר נשאר, לא השם של עפולה",
  canonicalStreet(index, "קריית ים", "קקל") === "קרן קימת");
ok("נצרת: בלי כינוי, קק״ל נשאר כמו שהוקלד",
  canonicalStreet(index, "נצרת", "קק״ל") === "קק״ל");
ok("חיפה: הכינוי של חיפה, לא בגלל השורה של עפולה",
  canonicalStreet(index, "חיפה", "קקל") === OFFICIAL);
ok("רחוב אמיתי גובר על כינוי באותו מפתח",
  canonicalStreet(index, "בדיקה", "קק״ל") === "קקל");

const both = equivalentStreetKeys(index, "עפולה", "קק״ל");
ok("עפולה: חיפוש בכינוי כולל את מפתח השם המלא",
  both.includes(streetKey(OFFICIAL)) && both.includes(streetKey("קקל")));
const back = equivalentStreetKeys(index, "עפולה", OFFICIAL);
ok("עפולה: חיפוש בשם המלא כולל את מפתח הכינוי",
  back.includes(streetKey("קקל")) && back.includes(streetKey(OFFICIAL)));
ok("נצרת: אין מפתח שני", equivalentStreetKeys(index, "נצרת", "קק״ל").length === 1);
ok("יהוד: המפתח השני הוא של הרחוב של יהוד",
  equivalentStreetKeys(index, "יהוד-מונוסון", "קקל").includes(streetKey("בר סימנטוב יעקב"))
  && !equivalentStreetKeys(index, "יהוד-מונוסון", "קקל").includes(streetKey(OFFICIAL)));

ok("נכס שמור בשם המלא נמצא מחיפוש קק״ל בעפולה",
  storedStreetMatches(index, "עפולה", OFFICIAL, "קק״ל"));
ok("נכס שמור כקקל נמצא מחיפוש השם המלא בעפולה",
  storedStreetMatches(index, "עפולה", "קק״ל", OFFICIAL));
ok("אותו כינוי בנצרת אינו התאמה",
  !storedStreetMatches(index, "נצרת", OFFICIAL, "קק״ל"));
ok("קרן היסוד אינו התאמה לכינוי",
  !storedStreetMatches(index, "עפולה", "קרן היסוד", "קק״ל"));

ok("תווית לעפולה היא השם המלא",
  aliasStreetLabel(index, ["עפולה", "יהוד-מונוסון"], "קק״ל", "עפולה") === OFFICIAL);
ok("תווית לנצרת ריקה גם כשעפולה באינדקס",
  aliasStreetLabel(index, ["עפולה", "נצרת"], "קק״ל", "נצרת") === null);
ok("בלי עיר, שתי ערים עם שמות שונים לא נמרחות",
  aliasStreetLabel(index, ["עפולה", "יהוד-מונוסון"], "קקל", null) === null);

const gis = [OFFICIAL, "קרן היסוד"];
ok("גאוקוד עפולה: הכינוי חוזר כשם הרשמי",
  aliasDisplayName("עפולה", 'קק"ל', gis, [{ alias: "קק״ל", name: OFFICIAL }]) === OFFICIAL);
ok("גאוקוד: גרשיים",
  aliasDisplayName("עפולה", "קק״ל", gis, [{ alias: "קק״ל", name: OFFICIAL }]) === OFFICIAL);
ok("גאוקוד: בלי גרשיים",
  aliasDisplayName("עפולה", "קקל", gis, [{ alias: "קק״ל", name: OFFICIAL }]) === OFFICIAL);
ok("גאוקוד: רשימת gis ריקה אינה מתרגמת (עיר אחרת)",
  aliasDisplayName("חיפה", "קקל", [], [{ alias: "קקל", name: OFFICIAL }]) === null);
ok("גאוקוד: קריית ים לא מקבלת את השם של עפולה",
  aliasDisplayName("קריית ים", "קקל", ["קרן קימת"], [{ alias: "קקל", name: "קרן קימת" }]) === "קרן קימת");
ok("גאוקוד: השם המלא עצמו אינו תרגום",
  aliasDisplayName("עפולה", OFFICIAL, gis, [{ alias: "קק״ל", name: OFFICIAL }]) === null);

// הכתובת בכרטיס נשמרת לעיתים בגרשיים אחרים מעמודת הרחוב. ההחלפה לא דורשת
// התאמה תו-תו: אותם גרשיים ש-street_name_key מוריד, וגם "רח'".
const addressForms: Array<[string, string]> = [
  ['קק"ל 12', OFFICIAL + " 12"],
  ["קק״ל 12", OFFICIAL + " 12"],
  ["קק'ל 12", OFFICIAL + " 12"],
  ["קקל 12", OFFICIAL + " 12"],
  ['רח\' קק"ל 12', OFFICIAL + " 12"],
  ["רחוב קק״ל 9", OFFICIAL + " 9"],
  ['קק"ל 12, קומה 3', OFFICIAL + " 12, קומה 3"],
];
for (const [address, want] of addressForms) {
  ok(`כתובת «${address}» מוצגת בשם המלא`,
    replaceStreetInAddress(address, "קק״ל", OFFICIAL) === want);
}
ok("עמודת רחוב בגרש ASCII והכתובת בגרשיים",
  replaceStreetInAddress("קק״ל 8", 'קק"ל', OFFICIAL) === OFFICIAL + " 8");
ok("יהוד: הכתובת מקבלת את הרחוב של יהוד",
  replaceStreetInAddress('קק"ל 2', "קקל", "בר סימנטוב יעקב") === "בר סימנטוב יעקב 2");
ok("קרן היסוד בכתובת לא מוחלף",
  replaceStreetInAddress("קרן היסוד 4", "קק״ל", OFFICIAL) === "קרן היסוד 4");
ok("מילה שמכילה את האותיות לא נתפסת",
  replaceStreetInAddress("הקקלון 1", "קק״ל", OFFICIAL) === "הקקלון 1");
ok("השם המלא בכתובת נשאר",
  replaceStreetInAddress(OFFICIAL + " 35", OFFICIAL, OFFICIAL) === OFFICIAL + " 35");

if (fail) {
  console.error(`\n${fail} נכשלו`);
  process.exit(1);
}
console.log("\nהכל עבר");
