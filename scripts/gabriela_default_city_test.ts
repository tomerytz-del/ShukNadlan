// עיר ברירת מחדל לנכס, וקיפול כפתורי עריכה. בלי מסד ובלי וואטסאפ.
//   node --experimental-strip-types scripts/gabriela_default_city_test.ts

import {
  cachedListingCityName,
  collapseCreatedPropertyEdits,
  CRM_EDIT_LABEL,
  CTA_BODY_MAX,
  type CtaOutbox,
  listingCityColumnMissing,
  listingCityPromptLine,
  loadListingCityOnce,
  profilePatchIfCityColumnMissing,
  propertyCityWhenOmitted,
  propertiesListUrl,
  storeListingCity,
} from "../supabase/functions/whatsapp-webhook/listing-defaults.ts";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : " - " + JSON.stringify(detail)}`);
  if (!ok) failed++;
}

check("עיר שמורה לפני עיר המשרד", propertyCityWhenOmitted("עפולה", "כפר גדעון") === "עפולה");
check("בלי עיר שמורה - עיר המשרד", propertyCityWhenOmitted(null, "כפר גדעון") === "כפר גדעון");
check("עיר שמורה ריקה נזרקת", propertyCityWhenOmitted("  ", "כפר גדעון") === "כפר גדעון");
check("שתיהן ריקות - עפולה", propertyCityWhenOmitted(null, "  ") === "עפולה");
check("עיר שמורה בלי משרד", propertyCityWhenOmitted("עפולה", null) === "עפולה");

const one = (n: number, batch?: "property_created"): CtaOutbox => ({
  kind: "cta",
  body: "לעריכה, לתמונות ולשאר הפרטים:",
  label: CRM_EDIT_LABEL,
  url: `https://shuknadlan.co.il/crm?goto=accProperties&property=p${n}`,
  ...(batch ? { batch, listLine: `דירה ${n}` } : {}),
});

const single = collapseCreatedPropertyEdits([one(1, "property_created")]);
check("נכס אחד נשאר עם הקישור שלו", single.length === 1 && single[0].url.includes("property=p1"));

const six = [1, 2, 3, 4, 5, 6].map((n) => one(n, "property_created"));
const folded = collapseCreatedPropertyEdits(six);
check("שישה נכסים - הודעה אחת", folded.length === 1);
check("ההודעה מפרטת את כולם", folded[0].kind === "cta" && folded[0].body.includes("1. דירה 1") && folded[0].body.includes("6. דירה 6"));
check("כפתור אחד לרשימת הנכסים", folded[0].kind === "cta" && folded[0].url === "https://shuknadlan.co.il/crm?goto=accProperties");
check("הכותרת נשארת עריכה ב-CRM", folded[0].kind === "cta" && folded[0].label === CRM_EDIT_LABEL);
check("כותרת הכפתור עד 20", CRM_EDIT_LABEL.length <= 20, CRM_EDIT_LABEL.length);

const update = one(9);
const mixed = collapseCreatedPropertyEdits([one(1, "property_created"), one(2, "property_created"), update]);
check("שני נכסים חדשים ועדכון - שתי הודעות", mixed.length === 2);
check("העדכון נשאר על הנכס שלו", mixed[1].kind === "cta" && mixed[1].url.includes("property=p9"));

const dozen = Array.from({ length: 12 }, (_, i) => one(i + 1, "property_created"));
const clipped = collapseCreatedPropertyEdits(dozen);
check("יותר מעשר שורות - ועוד", clipped[0].kind === "cta" && clipped[0].body.includes("10. דירה 10") && clipped[0].body.includes("ועוד 2") && !clipped[0].body.includes("11. דירה"));
check("הגוף בתוך מגבלת וואטסאפ", clipped[0].kind === "cta" && clipped[0].body.length <= CTA_BODY_MAX);

const other: CtaOutbox = {
  kind: "cta",
  body: "הדוח:",
  label: "📊 דוח CMA",
  url: "https://shuknadlan.co.il/cma?k=1",
};
const kept = collapseCreatedPropertyEdits([other, one(1, "property_created"), one(2, "property_created")]);
check("כפתור שאינו עריכת נכס נשאר", kept.length === 2 && kept[0].label === "📊 דוח CMA");

check("קישור הרשימה מאותו אתר", propertiesListUrl("https://shuknadlan.co.il/crm?goto=accProperties&property=abc") === "https://shuknadlan.co.il/crm?goto=accProperties");
check("כתובת לא מלאה אינה קישור נכס", propertiesListUrl("/crm?goto=accProperties&property=abc") === null);
check("טקסט בלי אתר אינו קישור נכס", propertiesListUrl("property=abc") === null);

const relative = collapseCreatedPropertyEdits([
  { ...one(1, "property_created"), url: "/crm?property=1" },
  { ...one(2, "property_created"), url: "/crm?property=2" },
]);
check("בלי אתר מלא לא מתקפלים לנכס הראשון", relative.length === 2 && relative[0].kind === "cta" && relative[0].url === "/crm?property=1" && relative[1].kind === "cta" && relative[1].url === "/crm?property=2");

check("42703 הוא עמודה חסרה", listingCityColumnMissing({ code: "42703" }) === true);
check("PGRST204 הוא עמודה חסרה", listingCityColumnMissing({ code: "PGRST204" }) === true);
check("אזכור השם בלי הקוד אינו עמודה חסרה", listingCityColumnMissing({ code: "23503", message: "default_city_id" }) === false);
check("בלי שגיאה אין עמודה חסרה", listingCityColumnMissing(null) === false);

const cityPatch = { display_name: "דנה", default_city_id: "city-1", updated_at: "t" };
const dropped = profilePatchIfCityColumnMissing(cityPatch, { code: "PGRST204" });
check("PGRST204 מוריד רק את העיר מהשמירה", !!dropped && !("default_city_id" in dropped) && dropped.display_name === "דנה" && dropped.updated_at === "t");
check("42703 מוריד את העיר כמו PGRST204", profilePatchIfCityColumnMissing(cityPatch, { code: "42703" })?.display_name === "דנה");
check("שגיאה אחרת לא נוגעת ב-patch", profilePatchIfCityColumnMissing(cityPatch, { code: "23505" }) === null);
check("בלי עיר ב-patch אין מה להוריד", profilePatchIfCityColumnMissing({ display_name: "דנה" }, { code: "PGRST204" }) === null);

const cold = { loaded: false, name: null as string | null };
check("זיכרון ריק אינו שם עיר לפרומפט", cachedListingCityName(cold) === undefined);
check("פרומפט בלי זיכרון לא טוען שאין עיר", !listingCityPromptLine(undefined).includes("אין עיר") && listingCityPromptLine(undefined).includes("אל תשלח/י city"));
storeListingCity(cold, null);
check("עיר שנבדקה ואין - הפרומפט אומר זאת", cachedListingCityName(cold) === null && listingCityPromptLine(null).includes("אין עיר ברירת מחדל"));
storeListingCity(cold, "עפולה");
check("הפרומפט משתמש בשם שבזיכרון", cachedListingCityName(cold) === "עפולה" && listingCityPromptLine("עפולה").includes("עפולה") && listingCityPromptLine("עפולה").includes("אל תשלח/י city"));

let reads = 0;
const slot = { loaded: false, name: null as string | null };
const first = await loadListingCityOnce(slot, async () => { reads++; return "עפולה"; });
const second = await loadListingCityOnce(slot, async () => { reads++; return "חיפה"; });
check("העיר נטענת פעם אחת בתור", first === "עפולה" && second === "עפולה" && reads === 1);
storeListingCity(slot, "נהריה");
const afterSave = await loadListingCityOnce(slot, async () => { reads++; return "חיפה"; });
check("שמירה באמצע התור נראית בלי שאילתה נוספת", afterSave === "נהריה" && reads === 1);

if (failed) {
  console.error(`נכשלו ${failed}`);
  process.exit(1);
}
console.log("עיר ברירת מחדל וכפתור עריכה: כל הבדיקות עברו");
