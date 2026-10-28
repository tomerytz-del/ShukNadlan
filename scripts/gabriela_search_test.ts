// חיפוש של גבריאלה: שורת לוג, ודרישות מהערות. בלי מסד.
//   node --experimental-strip-types scripts/gabriela_search_test.ts

import {
  cityMatchGroup,
  searchMissRow,
  searchMissStoreMissing,
  shouldLogSearchMiss,
} from "../supabase/functions/whatsapp-webhook/property-search.ts";
import {
  capCities,
  featureWritePlan,
  hoodBelongsToCities,
  mergePreferredFeatures,
  neighborhoodAllows,
  requirementsFromNotes,
  shouldClearNeighborhood,
} from "../supabase/functions/whatsapp-webhook/client-requirements.ts";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : " - " + JSON.stringify(detail)}`);
  if (!ok) failed++;
}

const row = searchMissRow("agent-1", {
  city: "עפולה",
  area: "גבעת המורה",
  deal_type: "sale",
  notes: "טלפון 050-0000000",
  phone: "050",
});
check("הלוג שומר רק עיר אזור ועסקה", row.city === "עפולה" && row.area === "גבעת המורה" && row.deal_type === "sale");
check("הלוג בלי טלפון ובלי הערות", !("phone" in row) && !("notes" in row));
check("טבלה חסרה לא נחשבת תקלה", searchMissStoreMissing({ code: "PGRST205" }) && searchMissStoreMissing({ code: "23505" }) === false);

const fromNotes = requirementsFromNotes("דירה עם ממ״ד וחניה", {});
check("הערות ממלאות מאפיין כשהשדה ריק", fromNotes.features.includes("mamad") && fromNotes.features.includes("parking"));
check("בלי עסקה עיר ותקציב שואלים", fromNotes.ask.join() === "עסקה,עיר,תקציב");
const kept = requirementsFromNotes("עם מעלית", { required_features: ["mamad"], deal_type: "sale", cities: ["עפולה"], max_price: 1000000 });
check("שדה מלא לא נדרס", kept.features.length === 0 && kept.ask.length === 0);
const neg = requirementsFromNotes("בלי מעלית", {});
check("שלילה אינה בקשה", !neg.features.includes("elevator"));

const phoneOnly = featureWritePlan({
  isCreate: false,
  notesSent: false,
  notes: "עם ממ״ד",
  requiredSent: false,
  deal_type: null,
  cities: [],
  min_price: null,
  max_price: null,
});
check("עדכון בלי הערות לא גוזר מאפיינים", phoneOnly.preferred === undefined && phoneOnly.suggested.length === 0);
check("עדכון לא שואל שוב", phoneOnly.ask === undefined);

const fromUpdateNotes = featureWritePlan({
  isCreate: false,
  notesSent: true,
  notes: "דירה עם ממ״ד וחניה",
  requiredSent: false,
  deal_type: null,
  cities: [],
});
check("הערות בעדכון הן דירוג", fromUpdateNotes.preferred?.includes("mamad") && fromUpdateNotes.preferred?.includes("parking"));
check("הערות בעדכון אינן שואלות", fromUpdateNotes.ask === undefined);

const confirmed = featureWritePlan({
  isCreate: false,
  notesSent: true,
  notes: "עם ממ״ד",
  requiredSent: true,
  deal_type: "sale",
  cities: ["עפולה"],
  max_price: 1000000,
});
check("אישור לא דורס את הדירוג מההערות", confirmed.preferred === undefined);

const created = featureWritePlan({
  isCreate: true,
  notesSent: true,
  notes: "עם חניה",
  requiredSent: false,
});
check("יצירה שואלת על מה שחסר", created.ask?.join() === "עסקה,עיר,תקציב");
check("יצירה שומרת דירוג ולא חובה", created.preferred?.includes("parking") === true);

const hood = { city: "עפולה", city_id: "city-a" };
check("שכונה בלי ערים שייכת", hoodBelongsToCities(hood, []));
check("שכונה שייכת לפי מזהה גם בכתיב אחר", hoodBelongsToCities(hood, [{ name: "קריית עפולה", id: "city-a" }]));
check("שכונה מעיר אחרת לא שייכת", hoodBelongsToCities(hood, [{ name: "חיפה", id: "city-b" }]) === false);

check("בלי שכונה הכל עובר", neighborhoodAllows({
  clientHoodId: null, hoodBelongs: true, propertyInHoodCity: true, propertyHoodId: "other",
}));
check("שכונה ישנה לא מסתירה", neighborhoodAllows({
  clientHoodId: "h1", hoodBelongs: false, propertyInHoodCity: true, propertyHoodId: "other",
}));
check("עיר אחרת עוברת", neighborhoodAllows({
  clientHoodId: "h1", hoodBelongs: true, propertyInHoodCity: false, propertyHoodId: "other",
}));
check("אותה עיר ושכונה אחרת נחסמת", neighborhoodAllows({
  clientHoodId: "h1", hoodBelongs: true, propertyInHoodCity: true, propertyHoodId: "h2",
}) === false);
check("אותה שכונה עוברת", neighborhoodAllows({
  clientHoodId: "h1", hoodBelongs: true, propertyInHoodCity: true, propertyHoodId: "h1",
}));
check("שכונה לא מולאה במודעה עדיין מתאימה", neighborhoodAllows({
  clientHoodId: "h1", hoodBelongs: true, propertyInHoodCity: true, propertyHoodId: null,
}));
check("דירוג זהה לא נכתב שוב", mergePreferredFeatures(["mamad", "parking"], ["parking", "mamad"]) === undefined);
check("דירוג חדש מתווסף בלי למחוק", (mergePreferredFeatures(["mamad"], ["parking"]) || []).join() === "mamad,parking");
check("הערות בלי מאפיין לא מוחקות דירוג", mergePreferredFeatures(["mamad"], []) === undefined);

check("שינוי עיר מוחק שכונה שלא שייכת", shouldClearNeighborhood({
  citiesChanged: true, neighborhoodSent: false, hasHood: true, belongs: false, resolved: true,
}));
check("שכונה שעדיין שייכת נשארת", shouldClearNeighborhood({
  citiesChanged: true, neighborhoodSent: false, hasHood: true, belongs: true, resolved: true,
}) === false);
check("כשל בפענוח לא מוחק", shouldClearNeighborhood({
  citiesChanged: true, neighborhoodSent: false, hasHood: true, belongs: false, resolved: false,
}) === false);
check("שכונה שנשלחה לא נמחקת כאן", shouldClearNeighborhood({
  citiesChanged: true, neighborhoodSent: true, hasHood: true, belongs: false, resolved: true,
}) === false);

const capped = capCities(["א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"]);
check("עיר תשיעית לא נשמרת בשקט", capped.kept.length === 8 && capped.dropped === 1);

check("חיפוש בלי מאגר אינו לוג", shouldLogSearchMiss(0, false) === false);
check("אפס תוצאות אחרי חיפוש הוא לוג", shouldLogSearchMiss(0, true));
check("יש תוצאות - אין לוג", shouldLogSearchMiss(2, true) === false);

const group = cityMatchGroup(
  "קריית מלאכי",
  "קרית מלאכי",
  "11111111-1111-1111-1111-111111111111",
);
check("התאמת עיר כוללת מזהה ואת שני הכתיבים",
  group.some((p) => p.startsWith("city_id.eq.")) &&
  group.some((p) => p.includes("קריית")) &&
  group.some((p) => p.includes("קרית")));

if (failed) {
  console.error(`נכשלו ${failed}`);
  process.exit(1);
}
console.log("חיפוש גבריאלה: כל הבדיקות עברו");
