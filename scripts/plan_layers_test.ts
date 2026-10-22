/* ============================================================================
   התוכניות של XPlan בבוט - אותו ניקוי כמו באתר, והממסר

   ‏cleanPlanLayers קיימת פעמיים: ב-assets/govmap.js (האתר, מול GovMap) וב-
   supabase/functions/_shared/xplan.ts (הבוט, מול XPlan דרך הממסר). כאן שתיהן
   רצות על אותן תשובות, וכל הבדל נכשל. התשובות הן **האמיתיות** מ-XPlan
   (‏iplan_probe.py ריצה 2, ‏22.10.2026, דפנה 4 עפולה), בקיצור - עם תאריכים
   ב-epoch כמו ש-XPlan מחזיר, דרך toGovmapAttributes של הממסר.

       node --experimental-strip-types scripts/plan_layers_test.ts

   ‏docs/parcels-open.md, הסקיל govmap.
   ========================================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanPlanLayers, primaryDesignation } from "../supabase/functions/_shared/xplan.ts";
import relay, { parsePoint, tokenOk, toGovmapAttributes } from "../netlify/functions/xplan.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "assets", "govmap.js"), "utf8");
const win: Record<string, unknown> = { proj4: (_a: unknown, _b: unknown, xy: unknown) => xy };
new Function("window", "document", "console", src)(win, { head: { appendChild() {} }, createElement: () => ({}) }, { warn() {} });
// deno-lint-ignore no-explicit-any
const siteClean = (win.GovmapLookup as any)._cleanPlanLayers;

let fail = 0;
const ok = (name: string, cond: unknown) => {
  console.log((cond ? "✓ " : "✗ ") + name);
  if (!cond) fail++;
};

// ‏XPlan שכבה 1 (= 203) ושכבה 4 (= 14), כמו שחזרו
const X1 = [
  { entity_subtype_desc: "הודעה לפי סעיף 77 ו 78 לחוק התכנון והבניה", pl_number: "תמא/ 15/ ג/ סעיף-77-78",
    pl_name: "שדה תעופה משלים בנבטים", pl_date_8: 1764806400000, depositing_date: null,
    plan_charactor_name: "תכנית שמכוחה לא ניתן להוציא היתרים או הרשאות",
    pl_url: "https://mavat.iplan.gov.il/SV4/1/99005336124/310" },
  { entity_subtype_desc: "תכנית כוללנית", pl_number: "215-0898114", pl_name: "תכנית מתאר כוללנית עפולה",
    depositing_date: 1649030400000, pl_date_8: 1752624000000,
    plan_charactor_name: "תכנית שמכוחה לא ניתן להוציא היתרים או הרשאות",
    pl_url: "https://mavat.iplan.gov.il/SV4/1/2005093152/310" },
  { entity_subtype_desc: "תכנית מתאר ארצית", pl_number: "תמא/ 15/ ד", pl_name: "שדה תעופה משלים ברמת דוד",
    pl_date_8: null, depositing_date: null, plan_charactor_name: "תכנית שמכוחה ניתן להוציא היתרים או הרשאות",
    pl_url: "javascript:alert(1)" },
];
const X4 = [
  { mavat_name: 'יעוד עפ"י תכנית מאושרת אחרת', mavat_code: 995, pl_number: "תמא/ 15/ ד" },
  { mavat_name: "מגבלות בניה ופיתוח", mavat_code: 996, pl_number: "תמא/ 15/ ג/ סעיף-77-78" },
  { mavat_name: "מגורים", mavat_code: 10, pl_number: "215-0898114" },
];
const layers = {
  "203": X1.map((a) => ({ attributes: toGovmapAttributes(a) })),
  "14": X4.map((a) => ({ attributes: toGovmapAttributes(a) })),
};

const bot = cleanPlanLayers(layers);
const site = siteClean(layers);
ok("הבוט והאתר מנקים זהה", JSON.stringify(bot) === JSON.stringify(site));
ok("תשובה ריקה זהה", JSON.stringify(cleanPlanLayers({})) === JSON.stringify(siteClean({})));

const m = bot.find((p) => p.number === "215-0898114");
ok("epoch -> אושרה 2025-07-16, כמו ב-GovMap", m && m.stage === "approved" && m.date === "2025-07-16");
ok("ייעוד מגורים מוצמד למתאר הכוללנית", m && m.designation === "מגורים");
const n = bot.find((p) => p.notice);
ok("הודעה 77-78 מזוהה", n && n.stage === "notice");
ok("קישור שאינו למבא\"ת נזרק", bot.find((p) => p.number === "תמא/ 15/ ד")?.url === null);
ok("הייעוד הראשי - מגורים, לא מגבלות של הודעה", primaryDesignation(bot) === "מגורים");
ok("בלי ייעוד -> null", primaryDesignation(cleanPlanLayers({ "203": layers["203"] })) === null);

ok("נקודה בישראל מתקבלת", parsePoint(new URLSearchParams("lat=32.61&lng=35.29")) !== null);
ok("נקודה מחוץ לישראל נדחית", parsePoint(new URLSearchParams("lat=40&lng=35")) === null);
ok("נקודה לא מספרית נדחית", parsePoint(new URLSearchParams("lat=x&lng=35")) === null);
ok("טוקן נכון", tokenOk("abc123", "abc123"));
ok("טוקן שגוי / חסר / באורך אחר", !tokenOk("abc124", "abc123") && !tokenOk(null, "abc123") && !tokenOk("abc", "abc123"));
ok("בלי סוד מוגדר - גם טוקן ריק לא עובר", !tokenOk("", ""));

const call = (q: string, headers: Record<string, string> = {}) =>
  relay(new Request("https://shuknadlan.co.il/.netlify/functions/xplan?" + q, { headers }));

delete process.env.XPLAN_RELAY_TOKEN;
ok("בלי XPLAN_RELAY_TOKEN - ‏503 ולא שאילתה", (await call("lat=32.61&lng=35.29")).status === 503);
process.env.XPLAN_RELAY_TOKEN = "t0ken";
ok("טוקן שגוי - ‏401", (await call("lat=32.61&lng=35.29", { "x-relay-token": "nope" })).status === 401);
ok("נקודה שגויה - ‏400", (await call("lat=1&lng=1", { "x-relay-token": "t0ken" })).status === 400);

if (fail) {
  console.log(`${fail} נכשלו`);
  process.exit(1);
}
