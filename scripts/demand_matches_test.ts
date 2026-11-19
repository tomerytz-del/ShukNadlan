// פוסטים בפייסבוק בהודעת ההתאמות של גבריאלה (demand-matches.ts).
//   node --experimental-strip-types scripts/demand_matches_test.ts
import { readFileSync } from "node:fs";
import {
  combinedMatchMessage,
  demandButton,
  demandItems,
  demandLine,
  demandListings,
  demandRowId,
  demandTokenFromRowId,
  demandUrl,
  mergeByScore,
} from "../supabase/functions/whatsapp-webhook/demand-matches.ts";
import {
  BOARD_HEADING,
  DEMAND_HEADING,
  replyPresentsBoard,
  type BoardListingRow,
} from "../supabase/functions/whatsapp-webhook/board-listings.ts";

let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  if (!ok) failed++;
}

const BASE = "https://shuknadlan.co.il";
const tok = (n: number) => n.toString(16).padStart(32, "0");
const uid = (n: number) => `00000000-0000-0000-0000-${n.toString().padStart(12, "0")}`;
function item(n: number, extra: Record<string, unknown> = {}) {
  return {
    id: uid(n), link_token: tok(n), city: "עפולה", deal_type: "sale", property_type: "דירה",
    rooms: 4, price: 1300000, score: 100, days_ago: 2, mine: false, summary: "דירה בעפולה", ...extra,
  };
}
function board(n: number, score: number): BoardListingRow {
  return {
    id: uid(1000 + n), source: n % 2 ? "yad2" : "madlan", city: "עפולה", deal_type: "sale",
    property_type: "דירה", rooms: 4, price: 1200000 + n, score,
    url: `https://www.yad2.co.il/realestate/item/b${n}`,
  };
}

// --- קלט מהמסד
const parsed = demandItems({
  status: "ok",
  items: [item(1), item(2, { link_token: "nope" }), item(3, { id: "x" }), item(4, { score: null }), null, item(5)],
});
check("פריט בלי טוקן, מזהה או ציון תקינים נושר", parsed.length === 2 && parsed[0].id === uid(1) && parsed[1].id === uid(5));
check("תשובה בלי items היא אפס פריטים", demandItems({ status: "none" }).length === 0 && demandItems(null).length === 0);

// --- שורת הרשימה והטוקן
check("הטוקן עובר הלוך ושוב", demandTokenFromRowId(demandRowId(tok(7)) as string) === tok(7));
check("מזהה שורה שאינו טוקן תקין נדחה",
  demandTokenFromRowId("dc:xyz") === null && demandTokenFromRowId("bu:https://x") === null &&
  demandTokenFromRowId("dc:" + tok(7) + "0") === null && demandRowId("short") === null);
check("הקישור הוא /demand?k=", demandUrl(BASE + "/", tok(7)) === `${BASE}/demand?k=${tok(7)}` && demandUrl("", tok(7)) === null);
check("הכפתור אחרי הבחירה אומר שהלחיצה היא אני פונה",
  (demandButton(tok(7), BASE)?.body || "").includes("אני פונה") && demandButton("bad", BASE) === null);

// --- מה שהמודל רואה: בלי טוקן, בלי קישור
const seen = demandListings(parsed);
const seenText = JSON.stringify(seen);
check("המודל לא רואה טוקן, מזהה פוסט או כתובת", !seenText.includes(tok(1)) && !seenText.includes(uid(1)) && !/https?:/.test(seenText));
check("שורת הפוסט אנונימית ואומרת שהמחיר מבוקש",
  demandLine(parsed[0]).includes("(מבוקש)") && demandLine(parsed[0]).startsWith("פייסבוק") && !/\d{9,}/.test(demandLine(parsed[0])));
check("שכירות: לחודש", demandLine({ ...parsed[0], dealType: "rent", price: 4500 }).includes("4,500 ₪ לחודש"));
check("פוסט שכבר תפסתי מסומן", demandLine({ ...parsed[0], mine: true }).includes("כבר תפסת"));

// --- חיתוך משותף: חמש שורות לפי ציון, בשוויון הלוח קודם
const d = demandItems({ items: [item(1, { score: 100 }), item(2, { score: 95 }), item(3, { score: 90 })] });
const b = [board(1, 100), board(2, 100), board(3, 80)];
const m = mergeByScore(b, d, 5);
check("חמש שורות בסך הכול", m.boards.length + m.demand.length === 5);
check("הציון הנמוך ביותר נחתך", !m.boards.some((x) => x.score === 80) || m.boards.length === 3);
const tie = mergeByScore([board(1, 100)], demandItems({ items: [item(1, { score: 100 })] }), 1);
check("בשוויון הלוח קודם: הקישור שלו חופשי", tie.boards.length === 1 && tie.demand.length === 0);
const mine = mergeByScore([], demandItems({ items: [item(1, { score: 100 }), item(2, { score: 100, mine: true })] }), 1);
check("בשוויון בין פוסטים, מי שכבר תפסתי קודם", mine.demand.length === 1 && mine.demand[0].id === uid(2));
check("סדר המסד נשמר בתוך כל מקור",
  mergeByScore([board(1, 100), board(2, 99)], [], 5).boards.map((x) => x.url).join() === [board(1, 100), board(2, 99)].map((x) => x.url).join());
check("cap אפס חותך הכול", mergeByScore(b, d, 0).boards.length === 0 && mergeByScore(b, d, 0).demand.length === 0);

// --- ההודעה
check("בלי פוסטים אין הודעה משולבת (ההודעה הרגילה של הלוחות)", combinedMatchMessage([board(1, 90)], [], BASE) === null);
const one = combinedMatchMessage([], d.slice(0, 1), BASE);
check("פוסט אחד לבדו: כפתור קישור ל-/demand",
  one?.kind === "cta" && one.url === `${BASE}/demand?k=${tok(1)}` && one.body.includes("אני פונה") && !/https?:/.test(one.body));
const mixed = combinedMatchMessage([board(1, 100), board(2, 99)], d, BASE);
check("לוחות ופוסטים: רשימה אחת", mixed?.kind === "list" && mixed.rows.length === 5);
check("שורת פוסט נושאת dc: ושורת לוח נושאת bu:",
  mixed?.kind === "list" && mixed.rows.filter((r) => r.id.startsWith("dc:")).length === 3 &&
  mixed.rows.filter((r) => r.id.startsWith("bu:")).length === 2);
check("מגבלות וואטסאפ: כותרת עד 24, תיאור עד 72, כפתור עד 20",
  mixed?.kind === "list" && mixed.rows.every((r) => Array.from(r.title).length <= 24 && Array.from(r.description || "").length <= 72) &&
  Array.from(mixed.button).length <= 20);
check("הגוף אומר שהלחיצה על הכפתור היא התפיסה, בלי כתובת",
  mixed?.kind === "list" && mixed.body.includes("אני פונה") && !/https?:/.test(mixed.body));
check("עד עשר שורות",
  (combinedMatchMessage([], demandItems({ items: Array.from({ length: 14 }, (_, i) => item(i + 1)) }), BASE) as { rows?: unknown[] })?.rows?.length === 10);
check("בלי SITE_BASE אין שורת פוסט", combinedMatchMessage([], d, "") === null);

// --- "ללא תיווך": נשאר בהתאמות, עם תגית והנחיה
const nb = demandItems({ items: [item(1, { no_broker: "post" }), item(2, { no_broker: "group" }), item(3, { no_broker: "x" })] });
check("no_broker נקרא כ-post או group, וערך אחר כאין", nb[0].noBroker === "post" && nb[1].noBroker === "group" && nb[2].noBroker === null);
check("השורה אומרת ללא תיווך", demandLine(nb[0]).includes("ללא תיווך") && !demandLine(nb[2]).includes("ללא תיווך"));
const nbSeen = demandListings(nb) as { no_broker_rule: string | null }[];
check("המודל מקבל את ההנחיה: הצעת שיווק ולא קונים",
  (nbSeen[0].no_broker_rule || "").includes("לא להציע קונים") && (nbSeen[1].no_broker_rule || "").includes("רק בהודעה פרטית") && nbSeen[2].no_broker_rule === null);
check("בשורת הרשימה יש תגית", (combinedMatchMessage([], nb, BASE) as { rows?: { description?: string }[] })?.rows?.[0]?.description?.includes("ללא תיווך") === true);

// --- שער ההצגה: התשובה חייבת להציג את הפוסטים
check("כותרת הפוסטים מוציאה את ההודעה", replyPresentsBoard(`התאמות ללקוח\n${DEMAND_HEADING}\n- דירה`, []));
check("שורת פוסט בתשובה מוציאה את ההודעה", replyPresentsBoard("יש: " + demandLine(parsed[0]), [demandLine(parsed[0])]));
check("בלי הכותרת ובלי שורה אין הודעה", !replyPresentsBoard("יש כמה פוסטים", [demandLine(parsed[0])]) && BOARD_HEADING.length > 0);

// --- החיווט בקוד
const agent = readFileSync(new URL("../supabase/functions/whatsapp-webhook/agent.ts", import.meta.url), "utf8");
const index = readFileSync(new URL("../supabase/functions/whatsapp-webhook/index.ts", import.meta.url), "utf8");
const ranked = agent.slice(agent.indexOf("async function clientBoardRanked"), agent.indexOf("async function toolSearchProperties"));
check("הפוסטים נקראים עם הוויתור של הסוכן/ת ובמקביל ללוחות",
  ranked.includes('"agent_client_demand_matches_for_agent"') && ranked.includes("Promise.all") && ranked.includes("p_waive_features: waive"));
check("כשל בפוסטים לא מפיל את הלוחות", ranked.includes("demandError") && ranked.includes("SITE_BASE_URL"));
check("הודעה אחת: הלוחות והפוסטים ברשימה משולבת", ranked.includes("combinedMatchMessage(") && ranked.includes("logged: presented ? presented.logged : []"));
const create = agent.slice(agent.indexOf("async function toolCreateClient"), agent.indexOf("async function toolUpdateClient"));
check("create_client מריץ התאמות רק לקונה עם עסקה ועיר",
  create.includes("autoClientMatches(ctx, saved.id)") && create.includes("!ownerWrite && payload.deal_type") && create.includes("payload.cities.length > 0"));
check("כשל בהתאמות אוטומטיות לא מפיל את שמירת הכרטיס", agent.includes("auto client matches skipped"));
check("הבחירה בשורת פוסט שולחת כפתור ואינה תופסת",
  index.includes("demandTokenFromRowId(buttonId)") && !index.slice(index.indexOf("demandTokenFromRowId(buttonId)"), index.indexOf("boardUrlFromRowId(buttonId)")).includes("open_demand_claim"));
check("אין קישור לפוסט ואין טלפון במודול", !/post_url|source_post_url|raw_phone|property_details/.test(readFileSync(new URL("../supabase/functions/whatsapp-webhook/demand-matches.ts", import.meta.url), "utf8").replace(/\/\/.*$/gm, "")));

if (failed) {
  console.error(`נכשלו ${failed}`);
  process.exit(1);
}
console.log("demand matches ok");
