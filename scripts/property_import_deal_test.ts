// ייבוא בלי סוג עסקה: שורה-שורה, "הכל למכירה" רק על תאים ריקים,
// תשובה לפי שורה, ודילוג. בלי מסד ובלי שליחה.
//   node --experimental-strip-types scripts/property_import_deal_test.ts

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyDealText,
  awaitingRows,
  choiceOverrides,
  dealAskBody,
  dealButtons,
  DEAL_BUTTON_TITLES,
  emptyHold,
  fillEmptyDeals,
  holdExpired,
  importSummary,
  interpretDealText,
  isEmptyDealOnly,
  parseDealButtonId,
  perRowBody,
  snapshotHeld,
  splitImportRows,
  stripPrivate,
  type DealHold,
  type ParsedLike,
} from "../supabase/functions/whatsapp-webhook/property-import-deal.ts";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
require(path.join(root, "assets/property-import-core.js"));
const C = (globalThis as { PropertyImportCore: {
  configure: (v: unknown) => void;
  autoMap: (h: string[]) => Record<string, number>;
  parseAll: (s: unknown) => ParsedLike[];
  detectFeatureColumns: (h: string[], m: Record<string, number>) => unknown[];
} }).PropertyImportCore;

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : " - " + JSON.stringify(detail)}`);
  if (!ok) failed++;
}

C.configure({ residentialTypes: ["דירה", "דירת גן"], commercialTypes: ["חנות"], features: [] });

function parse(rows: unknown[][], overrides: Record<number, { deal_type: string }> = {}): ParsedLike[] {
  const headers = ["סוג נכס", "סוג עסקה", "מחיר", "עיר", "כתובת", "מספר בית"];
  const mapping = C.autoMap(headers);
  const S = {
    headers,
    rows,
    mapping,
    overrides,
    featureColumns: C.detectFeatureColumns(headers, mapping),
    neighborhoods: [],
    hoodAliases: [],
    existingKeys: new Set(),
    canonicalStreet: (v: string) => ({ ok: true, name: String(v || "").trim() }),
    agent: { id: "me", agency_id: "office" },
    maxImages: 8,
  };
  return C.parseAll(S);
}

const file = [
  ["דירה", "מכירה", 1500000, "עפולה", "הרצל", "1"],
  ["דירה", "השכרה", 4000, "עפולה", "הנשיא", "2"],
  ["דירה", "", 1800000, "עפולה", "ויצמן", "3"],
  ["דירה", "", "", "עפולה", "העצמאות", "4"],
  ["דירה", "המכירה", 900000, "עפולה", "הגלבוע", "5"],
];
const parsed = parse(file);
const split = splitImportRows(parsed);
check("שורה תקינה למכירה", parsed[0].errors?.length === 0 && parsed[0].payload?.deal_type === "sale", parsed[0].errors);
check("שורה תקינה להשכרה", parsed[1].errors?.length === 0 && parsed[1].payload?.deal_type === "rent", parsed[1].errors);
check(
  "מעורב: תקינות נשמרות, רק סוג עסקה ריק מוחזק, חסר מחיר וערך שגוי נפסלים",
  split.ready.map((r) => r.rowNumber).join() === "2,3" &&
    split.hold.map((r) => r.rowNumber).join() === "4" &&
    split.rejected.map((r) => r.rowNumber).join() === "5,6" &&
    isEmptyDealOnly(parsed[2]) &&
    !isEmptyDealOnly(parsed[3]) &&
    !isEmptyDealOnly(parsed[4]),
  { ready: split.ready.map((r) => r.rowNumber), hold: split.hold.map((r) => r.rowNumber), rejected: split.rejected.map((r) => r.rowNumber), e4: parsed[2].errors, e5: parsed[3].errorFields, e6: parsed[4].errors },
);

const holdRows = split.hold.map(snapshotHeld);
const prior: DealHold = emptyHold([
  ...holdRows,
  { row: 9, address: "יצחק שמיר 93, עפולה", label: "דירת גן" },
], "2099-01-01T00:00:00.000Z");
prior.choices["9"] = "rent";
const filled = fillEmptyDeals(prior, "sale");
check(
  "הכל למכירה ממלא רק תא ריק בלי בחירה",
  filled.choices["4"] === "sale" && filled.choices["9"] === "rent" && filled.choices["2"] === undefined && filled.choices["3"] === undefined,
  filled.choices,
);

const again = parse(file, choiceOverrides(filled));
check("אחרי המילוי ההשכרה נשארת והתא הריק הופך למכירה", again[1].payload?.deal_type === "rent" && again[2].payload?.deal_type === "sale" && !again[2].errors?.length, again[2].errors);
check("ערך שגוי לא נדרס בהכל למכירה", !!again[4].errors?.length && again[4].payload?.deal_type !== "sale", again[4].errors);
check("שורה בלי מחיר לא הופכת לתקינה", !!again[3].errors?.length);

const listed: DealHold = emptyHold([
  { row: 3, address: "יצחק שמיר 93, עפולה", label: "דירת גן" },
  { row: 4, address: "הרצל 5, עפולה", label: "דירה" },
  { row: 5, address: "העבודה 39, עפולה", label: "דירה" },
], "2099-01-01T00:00:00.000Z");
const per = applyDealText(listed, "שורה 3 מכירה, הרצל 5 השכרה, דלג על שורה 5");
check("לפי שורה: מספר, כתובת ודילוג", !!per && per.hold.choices["3"] === "sale" && per.hold.choices["4"] === "rent" && per.hold.skipped.includes(5) && !per.hold.choices["5"], per?.hold);
check("שורה שדילגו עליה לא נכנסת לבחירה", !choiceOverrides(per!.hold)[5] && !!per!.hold.skipped_reasons.some((s) => s.row === 5 && s.why === "ביקשת לדלג"));
check("אחרי מענה ודילוג לא נשארת שורה פתוחה", awaitingRows(per!.hold).length === 0);

const skipOnly = applyDealText(listed, "דלג על שורה 4");
check("דילוג על שורה אחת לא ממלא את השאר", !!skipOnly && skipOnly.hold.skipped.includes(4) && !skipOnly.hold.choices["4"] && awaitingRows(skipOnly.hold).map((r) => r.row).join() === "3,5", skipOnly?.hold.skipped);

const ambHold = emptyHold([
  ...listed.rows,
  { row: 8, address: "יצחק שמיר 95, עפולה", label: "דירת גן" },
], listed.expires_at);
const amb = interpretDealText("שמיר 9 מכירה", ambHold);
check("משפט רגיל עם המילה מכירה אינו נתפס", interpretDealText("מה עם המכירה של אתמול", listed) === null);
check("כתובת שמתאימה ליותר משורה לא נבחרת", amb?.clarify?.includes("מספר השורה") === true && amb.assignments.length === 0, amb);

const buttons = dealButtons("11111111-1111-4111-8111-111111111111");
check(
  "שלושה כפתורים עד 20 תווים",
  buttons.map((b) => b.title).join("|") === `${DEAL_BUTTON_TITLES.sale}|${DEAL_BUTTON_TITLES.rent}|${DEAL_BUTTON_TITLES.row}` &&
    buttons.every((b) => b.title.length >= 1 && b.title.length <= 20) &&
    parseDealButtonId(buttons[0].id)?.key === "sale" &&
    parseDealButtonId("ops_q:x:0") === null,
);
check("גוף השאלה בלי ניחוש", dealAskBody(4).includes("לא אמלא לבד") && !perRowBody(listed.rows).includes("http"));

const summary = importSummary({
  inserted: 2,
  updated: 0,
  skipped: [{ row: 5, why: "ביקשת לדלג. תתקשרו ל-050-1234567 או ל-https://shuknadlan.co.il/crm" }],
});
check("סיכום: כמה נקלטו וכמה דולגו, בלי טלפון ובלי כתובת", summary.startsWith("נקלטו 2 נכסים.") && summary.includes("דילגתי על שורה אחת") && summary.includes("ביקשת לדלג") && !/05\d/.test(summary) && !/https?:/.test(summary) && !summary.includes("shuknadlan"), summary);
check("ניקוי טלפון", stripPrivate("התקשרו 972-50-1234567") === "התקשרו");
check("פג תוקף", holdExpired(emptyHold([], "2000-01-01T00:00:00.000Z"), Date.parse("2026-11-16T00:00:00.000Z")) && !holdExpired(listed, Date.parse("2026-11-16T00:00:00.000Z")));

if (failed) {
  console.error(`נכשלו ${failed}`);
  process.exit(1);
}
console.log("עבר");
