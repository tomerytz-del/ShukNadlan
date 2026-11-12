// מודעות יד2/מדלן בחיפוש של גבריאלה. בלי מסד ובלי וואטסאפ.
//   node --experimental-strip-types scripts/board_listings_test.ts

import { readFileSync } from "node:fs";
import {
  BOARD_CAP,
  BOARD_COLUMNS,
  BOARD_HEADING,
  boardButtonLabel,
  boardCriteria,
  boardLine,
  boardQueryOps,
  boardToolFields,
  fetchBoardListings,
  presentBoardListings,
  safeListingUrl,
  type BoardListingRow,
} from "../supabase/functions/whatsapp-webhook/board-listings.ts";
import { dropLookupOnMutation } from "../supabase/functions/whatsapp-webhook/lookup_turn.ts";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : " - " + JSON.stringify(detail)}`);
  if (!ok) failed++;
}

const taanachIds = [
  "11111111-1111-4111-8111-111111111101",
  "11111111-1111-4111-8111-111111111102",
  "11111111-1111-4111-8111-111111111103",
  "11111111-1111-4111-8111-111111111104",
  "11111111-1111-4111-8111-111111111105",
  "11111111-1111-4111-8111-111111111106",
  "11111111-1111-4111-8111-111111111107",
  "11111111-1111-4111-8111-111111111108",
  "11111111-1111-4111-8111-111111111109",
  "11111111-1111-4111-8111-11111111110a",
  "11111111-1111-4111-8111-11111111110b",
  "11111111-1111-4111-8111-11111111110c",
];
const officeIds = ["22222222-2222-4222-8222-222222222201"];

const group = boardCriteria({
  askedCity: true,
  cityIds: taanachIds,
  cityNames: ["חבל תענך", "אביטל"],
  fallbackCityIds: officeIds,
  dealType: "sale",
  propertyTypes: ["דירה"],
  minPrice: 800000,
  maxPrice: 1500000,
  minRooms: 4,
  maxRooms: 4.5,
});
const ops = boardQueryOps(group);
const inn = ops?.find((op) => op.op === "in" && op.column === "city_id");
check("חבל תענך הוא city_id.in עם 12 מזהים",
  !!inn && inn.op === "in" && inn.value.length === 12 && taanachIds.every((id) => inn.value.includes(id)));
check("עיר שנשאלה לא נופלת לשוק המשרד",
  !!inn && inn.op === "in" && !inn.value.some((id) => officeIds.includes(id)));
check("רק מודעות באוויר", ops?.some((op) => op.op === "is" && op.column === "removed_at" && op.value === null) === true);
check("עסקה חדרים ומחיר",
  ops?.some((op) => op.op === "eq" && op.column === "deal_type" && op.value === "sale") === true &&
  ops?.some((op) => op.op === "gte" && op.column === "rooms" && op.value === 4) === true &&
  ops?.some((op) => op.op === "lte" && op.column === "rooms" && op.value === 4.5) === true &&
  ops?.some((op) => op.op === "gte" && op.column === "price" && op.value === 800000) === true &&
  ops?.some((op) => op.op === "lte" && op.column === "price" && op.value === 1500000) === true);
const typeOr = ops?.find((op) => op.op === "or");
check("דירה מסננת סוג", !!typeOr && typeOr.op === "or" && typeOr.value.includes("property_type.ilike") && typeOr.value.includes("דירה"));
check("תקרה 5 לפי עדכון אחרון",
  ops?.some((op) => op.op === "limit" && op.value === BOARD_CAP) === true &&
  ops?.some((op) => op.op === "order" && op.column === "last_seen_at" && op.ascending === false) === true);
check("השאילתה לא קוראת טלפון או שם",
  !BOARD_COLUMNS.includes("phone") && !BOARD_COLUMNS.includes("name") && !BOARD_COLUMNS.includes("address"));

const fallback = boardQueryOps(boardCriteria({
  askedCity: false,
  cityIds: taanachIds,
  fallbackCityIds: officeIds,
}));
const fallbackIn = fallback?.find((op) => op.op === "in");
check("בלי עיר מחפשים בשוק המשרד",
  !!fallbackIn && fallbackIn.op === "in" && fallbackIn.column === "city_id" && fallbackIn.value.join() === officeIds.join());

const named = boardQueryOps(boardCriteria({
  askedCity: true,
  cityIds: [],
  cityNames: ["עפולה"],
  fallbackCityIds: officeIds,
}));
const namedIn = named?.find((op) => op.op === "in");
check("עיר בלי מזהה נשארת לפי שם ולא לפי השוק",
  !!namedIn && namedIn.op === "in" && namedIn.column === "city" && namedIn.value.includes("עפולה"));
check("בלי עיר ובלי שוק אין שאילתה", boardQueryOps(boardCriteria({ askedCity: false })) === null);

function row(n: number, extra: Partial<BoardListingRow> = {}): BoardListingRow {
  return {
    source: n % 2 === 0 ? "yad2" : "madlan",
    city: "עפולה",
    deal_type: "sale",
    property_type: "דירה",
    rooms: 4,
    price: 1000000 + n,
    url: `https://www.yad2.co.il/realestate/item/n${n}`,
    ...extra,
  };
}

const shown = presentBoardListings(
  [row(1), row(2, { url: "http://insecure.example/a" }), row(3, { source: "facebook" }), ...[4, 5, 6, 7, 8].map(row)],
  12,
  { buttons: true, featuresUnchecked: true },
);
check("מוצגות 5 והשאר נספרות", shown?.shown === 5 && shown.more === 7 && shown.total === 12);
check("כפתור אחד למודעה, בלי כתובת בגוף",
  shown?.outbox.length === 5 &&
  shown.outbox.every((item) => item.kind === "cta" && item.url.startsWith("https://") && !item.body.includes("http")) &&
  shown.outbox[0].body.startsWith(BOARD_HEADING));
check("כותרת הכפתור בתקרת 20",
  shown?.outbox.every((item) => item.label.length <= 20 && (item.label === "פתיחה ביד2" || item.label === "פתיחה במדלן")) === true);
check("המודל לא רואה כתובת כשיש כפתורים",
  shown?.listings.every((item) => !("url" in item) && !("phone" in item) && !JSON.stringify(item).includes("http")) === true);
check("הכותרת והאיסור על טלפון ב-note",
  !!shown && shown.note.includes(BOARD_HEADING) && shown.note.includes("אין טלפון") &&
  shown.note.includes("ממ״ד") && shown.note.includes("אין שכונה"));
const fields = boardToolFields(shown);
check("השדה נפרד מהנכסים של הסוכן/ת",
  fields.board_heading === BOARD_HEADING && !("properties" in fields) && !("matches" in fields));
check("בורר חיפוש יורד בתור כתיבה",
  dropLookupOnMutation(shown?.outbox || [], true).length === 0 &&
  dropLookupOnMutation(shown?.outbox || [], false).length === 5);

const mailed = presentBoardListings([row(1, { deal_type: "rent", price: 4500, rooms: 3 })], 1, { buttons: false });
check("בלי כפתורים ה-url נשאר לתוצאה",
  mailed?.listings.length === 1 && mailed.listings[0].url === "https://www.yad2.co.il/realestate/item/n1" && mailed.outbox.length === 0);
check("שכירות לא נראית כמחיר קנייה",
  String(mailed?.listings[0].line || "").includes("לחודש") && String(mailed?.listings[0].line || "").includes("להשכרה"));
check("כתובת לא תקינה לא מוצגת",
  presentBoardListings([row(1, { url: "notaurl" })], 1, { buttons: true }) === null);
check("השורה בלי כתובת אתר", boardLine(row(2))?.includes("http") === false && boardLine(row(2))?.startsWith("יד2") === true);
check("תוויות", boardButtonLabel("yad2") === "פתיחה ביד2" && boardButtonLabel("madlan") === "פתיחה במדלן" && safeListingUrl("http://x") === null);

type Rec = { op: string; column?: string; value?: unknown };
class FakeDb {
  table = "";
  ops: Rec[] = [];
  result: { data: BoardListingRow[] | null; error: { message?: string } | null; count: number | null } = {
    data: [], error: null, count: 0,
  };
  from(table: string) {
    this.table = table;
    return this;
  }
  select() { return this; }
  is(column: string, value: null) { this.ops.push({ op: "is", column, value }); return this; }
  eq(column: string, value: string) { this.ops.push({ op: "eq", column, value }); return this; }
  gte(column: string, value: number) { this.ops.push({ op: "gte", column, value }); return this; }
  lte(column: string, value: number) { this.ops.push({ op: "lte", column, value }); return this; }
  in(column: string, value: string[]) { this.ops.push({ op: "in", column, value }); return this; }
  or(value: string) { this.ops.push({ op: "or", value }); return this; }
  order(column: string) { this.ops.push({ op: "order", column }); return this; }
  limit(value: number) { this.ops.push({ op: "limit", value }); return this; }
  then(resolve: (value: FakeDb["result"]) => void) { resolve(this.result); }
}

const db = new FakeDb();
db.result = { data: [row(1)], error: null, count: 1 };
const got = await fetchBoardListings(db, group);
check("הקריאה היא listing_inventory", db.table === "listing_inventory" && got?.rows.length === 1 && got.total === 1);
check("הפעולות כוללות את 12 הערים",
  db.ops.some((op) => op.op === "in" && Array.isArray(op.value) && op.value.length === 12));

const broken = new FakeDb();
broken.result = { data: null, error: { message: "relation listing_inventory does not exist" }, count: null };
const skipped = await fetchBoardListings(broken, group);
check("שגיאה נבלעת", skipped === null);

const none = new FakeDb();
const noQuery = await fetchBoardListings(none, null);
check("בלי קריטריון אין קריאה", noQuery === null && none.table === "");

const src = readFileSync(new URL("../supabase/functions/whatsapp-webhook/board-listings.ts", import.meta.url), "utf8");
check("אין ליד, התראה או ארנק במסלול",
  !src.includes("scraped_lead") && !src.includes("notifications") && !src.includes("credit_balance") && !src.includes("listing_inventory_sync"));

const agent = readFileSync(new URL("../supabase/functions/whatsapp-webhook/agent.ts", import.meta.url), "utf8");
check("המשרד נשאר מקור agency", agent.includes('p.agency_id === pools.agencyId ? "agency"'));
check("הפרומפט מכיר את שלושת המקורות",
  agent.includes(BOARD_HEADING) && agent.includes("board_listings") && agent.includes("של המשרד"));

if (failed) {
  console.error(`נכשלו ${failed}`);
  process.exit(1);
}
console.log("board listings ok");
