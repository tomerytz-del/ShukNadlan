// עיר ברירת מחדל לנכס, וקיפול כפתורי עריכה. בלי מסד ובלי וואטסאפ.
//   node --experimental-strip-types scripts/gabriela_default_city_test.ts

import { readFileSync } from "node:fs";
import {
  collapseCreatedPropertyEdits,
  CRM_EDIT_LABEL,
  CTA_BODY_MAX,
  type CtaOutbox,
  propertyCityWhenOmitted,
  propertiesListUrl,
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

const sql = readFileSync(
  new URL("../supabase/migrations/20271028150000_agent_default_city.sql", import.meta.url),
  "utf8",
);
const agent = readFileSync(
  new URL("../supabase/functions/whatsapp-webhook/agent.ts", import.meta.url),
  "utf8",
);
const index = readFileSync(
  new URL("../supabase/functions/whatsapp-webhook/index.ts", import.meta.url),
  "utf8",
);

check("העמודה ריקה ומצביעה ל-cities", sql.includes("default_city_id uuid") && sql.includes("references public.cities(id) on delete set null"));
check("בלי פונקציה חדשה ובלי grant", !/create\s+(or\s+replace\s+)?function/i.test(sql) && !/\bgrant\b/i.test(sql));
check("השם נפתר ב-city_id_for_name", agent.includes('rpc("city_id_for_name"'));
check("נכס בלי עיר עובר בפונקציית הסדר", agent.includes("propertyCityWhenOmitted") && agent.includes("listingCityWhenOmitted"));
check("הפרופיל הנבחר אינו כולל את העמודה", agent.includes(
  '"slug, display_name, bio, photo_url, years_experience, service_area, " +\n  "credentials, specialties, tier, service_markets"',
));
check("טעינת הסוכן/ת אינה קוראת את העמודה", index.includes(
  '.select("id, agency_id, display_name, tier, active, billing_status")',
));
check("עמודה חסרה אינה מפילה שמירה אחרת", agent.includes('error?.code === "PGRST204"') && agent.includes("citySettingDropped"));
check("השליחה מקפלת נכסים שנוצרו", index.includes("collapseCreatedPropertyEdits(items)"));
check("יצירה מסמנת את הכפתור לקיפול", agent.includes('batch: "property_created"'));
check("ההוראה לא למלא את עיר המשרד", agent.includes("אל תשלח/י את השדה") && agent.includes("אל תאמרי שאין דרך לשמור אותה"));

if (failed) {
  console.error(`נכשלו ${failed}`);
  process.exit(1);
}
console.log("עיר ברירת מחדל וכפתור עריכה: כל הבדיקות עברו");
