// מודעות יד2/מדלן בחיפוש של גבריאלה. בלי מסד ובלי וואטסאפ.
//   node --experimental-strip-types scripts/board_listings_test.ts

import { readFileSync } from "node:fs";
import {
  BOARD_CAP,
  BOARD_COLUMNS,
  BOARD_HEADING,
  boardButtonLabel,
  BOARD_FEATURE_LINE,
  BOARD_NONE_LINE,
  boardCriteria,
  boardInteractiveForReply,
  boardSearchStatus,
  boardStatusFields,
  boardLine,
  boardPresentationLog,
  boardQueryOps,
  boardToolFields,
  replyPresentsBoard,
  boardUrlFromRowId,
  fetchBoardListings,
  presentBoardListings,
  recordBoardPresentation,
  safeListingUrl,
  shouldAttachBoardListings,
  type BoardListingRow,
} from "../supabase/functions/whatsapp-webhook/board-listings.ts";

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
  { buttons: true },
);
check("מוצגות 5 והשאר נספרות", shown?.shown === 5 && shown.more === 7 && shown.total === 12);
check("כמה מודעות הן הודעת רשימה אחת, בלי כתובת",
  shown?.message?.kind === "list" &&
  shown.message.rows.length === 5 &&
  !shown.message.body.includes("http") &&
  shown.message.rows.every((item) => item.id.startsWith("bu:https://") && !item.title.includes("http") && !(item.description || "").includes("http")) &&
  shown.message.button.length <= 20 &&
  shown.message.rows.every((item) => item.title.length <= 24 && (item.description || "").length <= 72));
check("המודל לא רואה כתובת כשיש כפתורים",
  shown?.listings.every((item) => !("url" in item) && !("id" in item) && !("phone" in item) && !JSON.stringify(item).includes("http")) === true);
check("הכותרת והאיסור על טלפון ב-note",
  !!shown && shown.note.includes(BOARD_HEADING) && shown.note.includes("אין טלפון") && shown.note.includes("אין שכונה"));
const fields = boardToolFields(shown);
check("השדה נפרד מהנכסים של הסוכן/ת",
  fields.board_heading === BOARD_HEADING && !("properties" in fields) && !("matches" in fields) && !("board_buttons_sent" in fields));
const opened = shown?.message?.kind === "list" ? boardUrlFromRowId(shown.message.rows[0].id) : null;
check("לחיצה על שורה פותחת רק כתובת לוח",
  !!opened && opened.startsWith("https://") && boardUrlFromRowId("bu:https://evil.example/a") === null);
const sent = boardInteractiveForReply(`מצאתי אצלך שתיים.\n${BOARD_HEADING}`, shown?.lines || [], shown?.message || null);
check("הודעה אחת רק אם התשובה מציגה את הלוחות",
  sent === shown?.message &&
  boardInteractiveForReply("יש שתי דירות שלך.", shown?.lines || [], shown?.message || null) === null &&
  boardInteractiveForReply("אין מודעות מהלוחות.", shown?.lines || [], shown?.message || null) === null);
const one = presentBoardListings([row(2)], 1, { buttons: true });
check("מודעה אחת היא כפתור קישור אחד",
  one?.message?.kind === "cta" && one.message.label === "פתיחה ביד2" && !one.message.body.includes("http"));
check("חיפוש עם ממ״ד לא מצרף לוחות", shouldAttachBoardListings({ features: ["mamad"] }) === false);
check("חיפוש עם מעלית או חניה לא מצרף",
  shouldAttachBoardListings({ features: ["elevator"] }) === false &&
  shouldAttachBoardListings({ features: ["parking"] }) === false);
check("חיפוש בלי מאפיין מצרף", shouldAttachBoardListings({ features: [] }) === true);
check("לקוח/ה עם מעלית חובה לא מצרף", shouldAttachBoardListings({ required: ["elevator"], waived: [] }) === false);
check("ויתור על כל החובה מצרף", shouldAttachBoardListings({ required: ["elevator"], waived: ["elevator"] }) === true);
check("חובה שלא ויתרו עליה חוסמת",
  shouldAttachBoardListings({ required: ["mamad", "parking"], waived: ["parking"] }) === false);
const noneFields = boardStatusFields(boardSearchStatus({ filtered: 0, cityStock: 12 }));
check("אפס בעיר עם מלאי הוא none והשורה המדויקת",
  noneFields.board_status === "none" && noneFields.board_say === BOARD_NONE_LINE &&
  !("message" in noneFields));
check("עיר בלי מלאי אינה none",
  boardSearchStatus({ filtered: 0, cityStock: 0 }) === "unavailable" &&
  boardSearchStatus({ filtered: 0, cityStock: null }) === "unavailable" &&
  !("board_say" in boardStatusFields("unavailable")));
check("כשל חיפוש אינו none", boardSearchStatus({ filtered: null, cityStock: 4 }) === "unavailable");
check("יש התאמה", boardSearchStatus({ filtered: 2, cityStock: 0 }) === "matches");
const featureFields = boardStatusFields("skipped_feature");
check("מאפיין חובה אומר שלא נבדק, לא שאין",
  featureFields.board_status === "skipped_feature" &&
  featureFields.board_say === BOARD_FEATURE_LINE &&
  !String(featureFields.board_say).includes("אין כרגע מודעות"));
check("שורת אין בלוחות אינה הודעת וואטסאפ", replyPresentsBoard(BOARD_NONE_LINE, []) === false);

const agentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const idYad = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const idMad = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const loggedShown = presentBoardListings(
  [row(2, { id: idYad }), row(1, { id: idMad })],
  2,
  { buttons: true },
);
const logRow = boardPresentationLog({
  agentId,
  tool: "search_properties",
  reply: `שתיים שלך, ואחר כך ${BOARD_HEADING}`,
  lines: loggedShown?.lines || [],
  message: loggedShown?.message || null,
  logged: loggedShown?.logged || [],
});
check("יומן להצגת חיפוש",
  logRow?.tool === "search_properties" &&
  logRow.agent_id === agentId &&
  logRow.listing_ids.join() === `${idYad},${idMad}` &&
  logRow.sources.join() === "yad2,madlan" &&
  !JSON.stringify(logRow).includes("http"));
check("בלי הצגה אין שורת יומן",
  boardPresentationLog({
    agentId,
    tool: "search_properties",
    reply: "יש שתי דירות שלך.",
    lines: loggedShown?.lines || [],
    message: loggedShown?.message || null,
    logged: loggedShown?.logged || [],
  }) === null);
check("התאמה נרשמת בשם הכלי",
  boardPresentationLog({
    agentId,
    tool: "client_matches",
    reply: BOARD_HEADING,
    lines: loggedShown?.lines || [],
    message: loggedShown?.message || null,
    logged: loggedShown?.logged || [],
  })?.tool === "client_matches");
let inserted: { table?: string; row?: unknown } | null = null;
await recordBoardPresentation({
  from(table: string) {
    return {
      insert: async (row: unknown) => {
        inserted = { table, row };
        return { error: null };
      },
    };
  },
}, logRow);
check("שורה אחת לטבלת ההצגות",
  inserted?.table === "board_listing_presentations" && inserted.row === logRow);
let threw = false;
try {
  await recordBoardPresentation({
    from() {
      return { insert: async () => { throw new Error("relation missing"); } };
    },
  }, logRow);
} catch {
  threw = true;
}
check("כשל יומן לא שובר את התשובה", threw === false);

const mailed = presentBoardListings([row(1, { deal_type: "rent", price: 4500, rooms: 3 })], 1, { buttons: false });
check("בלי כפתורים ה-url נשאר לתוצאה",
  mailed?.listings.length === 1 && mailed.listings[0].url === "https://www.yad2.co.il/realestate/item/n1" && mailed.message === null);
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
const searchFn = agent.slice(agent.indexOf("async function toolSearchProperties"), agent.indexOf("async function logAgentSearchMiss"));
const clientFn = agent.slice(agent.indexOf("async function toolClientMatches"), agent.indexOf("async function clientBoardScope"));
check("חיפוש עם מאפיין חובה לא מצרף לוחות",
  searchFn.includes("features: feats") && searchFn.includes("boardSection"));
check("התאמה עם מאפיין חובה לא מצרפת לוחות",
  clientFn.includes("shouldAttachBoardListings({ required, waived: waive })"));
check("היומן נכתב רק אחרי שהתשובה מציגה",
  agent.includes("boardPresentationLog") && agent.includes("recordBoardPresentation"));

if (failed) {
  console.error(`נכשלו ${failed}`);
  process.exit(1);
}
console.log("board listings ok");
