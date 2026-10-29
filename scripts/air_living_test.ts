// כיווני אוויר ושטח סלון: פענוח, נוסח ללקוחות, ושההתראות לא נדלקות ממילוי נכס.
//   node --experimental-strip-types scripts/air_living_test.ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  airCountOnly,
  customerAirLine,
  customerLivingLine,
  customerMatchLines,
  customerSeekAir,
  customerSeekLiving,
  AIR_LIVING_GAP_NOTE,
  airLivingGapNote,
  airLivingRowKept,
  airLivingFilterGroups,
  jsonLdAirLiving,
  mentionsLivingSizeClaim,
  metaAirLivingClause,
  minAirCountKept,
  parseAirDirections,
  writeAirDirections,
} from "../supabase/functions/_shared/air-living.ts";

let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  if (!ok) failed++;
}

check("סדר קבוע", parseAirDirections("מערב/דרום").join(",") === "דרום,מערב");
check("קיצורים", parseAirDirections("צ, מע, north").join(",") === "צפון,מערב");
check("רק ספירה", airCountOnly("3 כיווני אוויר") === 3);
check("ספירה עם שם אינה ספירה", airCountOnly("3 כיוונים צפון") === null);

check("שורה ללקוח", customerAirLine(["מערב", "דרום"]) === "כיווני אוויר: דרום, מערב");
check("כיוון אחד בדף", customerAirLine(["מערב"]) === "כיוון אוויר: מערב");
check("סלון ללקוח", customerLivingLine(30) === "גודל הסלון: כ־30 מ״ר");
check("בלי סלון גדול", !customerLivingLine(30).includes("סלון גדול") && !customerLivingLine(null));
check("מטא", metaAirLivingClause(["צפון", "דרום", "מערב"], 35) === "3 כיווני אוויר, סלון של כ־35 מ״ר");
check("מטא כיוון אחד", metaAirLivingClause(["מערב"], 35) === "כיוון אוויר אחד, סלון של כ־35 מ״ר");
check("מטא לא מונה 1", metaAirLivingClause("מערב", null) === "כיוון אוויר אחד");
check("קונה", customerSeekAir(["מערב", "דרום"]) === "מחפשים כיווני אוויר: דרום, מערב");
check("קונה נשאר ברבים גם בכיוון אחד", customerSeekAir(["מערב"]) === "מחפשים כיווני אוויר: מערב");
check("JSON-LD נשאר כיווני אוויר", jsonLdAirLiving(["מערב"], null)[0]?.name === "כיווני אוויר");
check("מינימום", customerSeekLiving(25) === "גודל סלון מינימלי: 25 מ״ר");
const matched = customerMatchLines(["דרום"], ["דרום", "צפון"], 20, 28);
check("התאמה מציגה רק מה שמתאים", matched.length === 2 && matched[0] === "כיווני אוויר: צפון, דרום");
check("התאמה בכיוון אחד", customerMatchLines(["מערב"], ["מערב"], null, null)[0] === "כיוון אוויר: מערב");
check("פער לא מוצג", customerMatchLines(["מערב"], ["צפון"], 40, 20).length === 0);
check("בלי רווח אחרי כ", customerLivingLine(30) === "גודל הסלון: כ־30 מ״ר" && !/כ־\s/.test(customerLivingLine(30)));
check("מטא בלי רווח אחרי כ", !/כ־\s/.test(metaAirLivingClause(["צפון", "דרום", "מערב"], 35)));

const missing = { air_directions: null, living_room_sqm: null };
const south = { air_directions: ["דרום"], living_room_sqm: 22 };
check("חסר נשאר בתוצאות", airLivingRowKept(missing, { air_directions: ["דרום"], min_living_room_sqm: 25 }));
check("נתון שלא מתאים יורד", !airLivingRowKept({ air_directions: ["צפון"], living_room_sqm: 10 }, { air_directions: ["דרום"], min_living_room_sqm: 25 }));
check("המשפט כשחסר נתון", airLivingGapNote([missing, south], { air_directions: ["דרום"] }) === AIR_LIVING_GAP_NOTE);
check("בלי בקשה אין משפט", airLivingGapNote([missing], {}) === null);
check("רשימה ריקה אינה המשפט", airLivingGapNote([], { air_directions: ["דרום"] }) === null);

const counted = { air_directions: "3 כיווני אוויר" } as Record<string, unknown>;
writeAirDirections(counted, counted.air_directions, false);
check("ספירה לא נשמרת", !("air_directions" in counted));
const namedDir = { air_directions: "צפון" } as Record<string, unknown>;
writeAirDirections(namedDir, "צפון", false);
check("כיוון בשם נשמר", Array.isArray(namedDir.air_directions) && namedDir.air_directions[0] === "צפון");

const kept = "הסלון מרווח מאוד";
check("סלון מרווח מזוהה ולא נחתך", mentionsLivingSizeClaim(kept) && kept === "הסלון מרווח מאוד");
check("סלון גדול", mentionsLivingSizeClaim("יש סלון גדול בבית"));
check("מרווחת לא נתפסת", !mentionsLivingSizeClaim("דירה מרווחת"));
check("מרווחים לא נתפס", !mentionsLivingSizeClaim("חדרים מרווחים"));
check("משרד מרווח לא נתפס", !mentionsLivingSizeClaim("משרד מרווח במרכז"));
check("לא מרווח בתוך מילה", !mentionsLivingSizeClaim("מרוח"));

check("כיוון חסר עובר במינימום", minAirCountKept(null, 3) && minAirCountKept([], 3));
check("כיוון ידוע שלא מספיק יורד", !minAirCountKept(["דרום"], 3));
check("כיוון ידוע שמספיק נשאר", minAirCountKept(["צפון", "דרום", "מערב"], 3));
const filterGroups = airLivingFilterGroups({ air_directions: ["דרום"], min_living_room_sqm: 25 });
check("סינון משאיר NULL",
  filterGroups.some((g) => g.includes("air_directions.is.null")) &&
  filterGroups.some((g) => g.includes("living_room_sqm.is.null")));
check("סינון תופס נתון ידוע",
  filterGroups.some((g) => g.some((part) => part.includes("air_directions.cs."))) &&
  filterGroups.some((g) => g.some((part) => part.startsWith("living_room_sqm.gte."))));

const root = new URL("..", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const sql = read("supabase/migrations/20271031140000_air_living.sql");
for (const needle of [
  "required_directions text[]",
  "min_air_directions smallint",
  "living_room_sqm numeric",
  "צפון",
  "least(16, 8",
  "then 10 else 0",
  "then 5 else 0",
  "agent_clients_match_alerts_upd",
]) check("מיגרציה " + needle, sql.includes(needle));
check("בלי דגל", !sql.includes("large_living_room") && !sql.includes("wants_large_living_room"));
check("בלי שער קשיח על כיוון", !sql.includes("p_property.air_directions && p_client"));

function lastTrigger(name: string): string {
  const dir = new URL("supabase/migrations/", root);
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  let body = "";
  const re = new RegExp(`create trigger ${name}[\\s\\S]*?execute function[^;]*;`, "i");
  for (const file of files) {
    const text = readFileSync(join(dir.pathname, file), "utf8");
    const matches = text.match(new RegExp(re.source, "gi"));
    if (matches) body = matches[matches.length - 1];
  }
  return body;
}
for (const name of [
  "properties_client_match_alerts_upd",
  "properties_prune_stale_alerts",
  "properties_saved_search_alerts_upd",
]) {
  const body = lastTrigger(name);
  check(name + " לא כולל את השדות החדשים",
    !!body && !/air_directions|living_room_sqm|required_directions|min_air_directions|min_living_room_sqm/.test(body));
}
const clientTrig = lastTrigger("agent_clients_match_alerts_upd");
check("טריגר הקונה כן כולל את הדרישות",
  clientTrig.includes("required_directions") && clientTrig.includes("min_living_room_sqm"));

const html = read("crm.html");
const crm = read("assets/crm.js");
const prop = read("assets/property.js");
const page = read("assets/air-living.js");
check("צ'יפים", html.includes('value="צפון"') && html.includes('id="npAirCount"') && html.includes("סלון גדול"));
check("סינון", html.includes("בלי כיווני אוויר או סלון") && html.includes('id="propLivingMin"'));
check("שמירה בלי דגל", crm.includes("living_room_sqm:") && !crm.includes("large_living_room:"));
check("חסימת סלון גדול מהשטח", crm.includes("הסלון גדול משטח הנכס"));
check("דף נכס", prop.includes("customerLivingLine") && page.includes("כיוון אוויר: ") && page.includes("סלון של כ־"));
check("מטא בשרת", read("netlify/edge-functions/og-tags.ts").includes("metaClause"));
const copy = read("supabase/functions/_shared/marketing-copy.ts");
check("בלי חיתוך מרווח",
  copy.includes("mentionsLivingSizeClaim") &&
  !copy.includes("mentionsMaruah") &&
  !copy.includes("replace(/מרווח") &&
  copy.includes("category === \"commercial\"") &&
  copy.includes("customerAirLine"));
const pub = read("supabase/functions/whatsapp-webhook/public-agent.ts");
const getAt = pub.indexOf("async function getProperty");
const cardsAt = pub.indexOf("async function sendPropertyCards");
check("הבוט הציבורי לא מפיל עמודה חסרה", pub.includes("keep_missing_air_living") && pub.includes("airLivingGapNote"));
check("כרטיס ופירוט בלי עמודה חסרה",
  getAt > 0 && cardsAt > getAt &&
  pub.slice(getAt, cardsAt).includes("withoutAirLivingColumns") &&
  pub.slice(cardsAt).includes("withoutAirLivingColumns"));
const searchSrc = read("supabase/functions/whatsapp-webhook/property-search.ts");
const groupsAt = searchSrc.indexOf("airLivingFilterGroups");
const orAt = searchSrc.indexOf("if (groups.length === 1)");
check("סינון כיוון לפני or", groupsAt > 0 && orAt > groupsAt);
check("בלי סינון contains על כיוון", !searchSrc.includes(".contains(\"air_directions\"") && !searchSrc.includes(".gte(\"living_room_sqm\""));
check("מסחרי מאפס דרישות", crm.includes("clientFormCategory === 'commercial'") && crm.includes("min_air_directions: null"));
check("סיבה בלי נקודה אחרי מספר שלם", sql.includes("rtrim(trim(to_char(p_client.min_living_room_sqm - p_property.living_room_sqm, 'FM999.9')), '.')"));
const agent = read("supabase/functions/whatsapp-webhook/agent.ts");
check("סלון מחוץ לטווח נשמר", agent.includes("הערך הקודם נשמר") && agent.includes("delete payload[sqmKey]") && agent.includes("minAirCountKept"));
check("defer לסקריפט", read("crm.html").includes('defer src="assets/air-living.js"'));
const facts = sql.slice(sql.indexOf("function public.property_marketing_facts"));
check("עובדות כוללות סלון וכיוון", facts.includes("living_room_sqm") && facts.includes("p.air_directions"));
check("הטביעה לא השתנתה", !sql.includes("property_marketing_fingerprint"));
const finger = read("supabase/migrations/20260925090000_property_marketing_description.sql");
const fingerBody = finger.slice(finger.indexOf("function public.property_marketing_fingerprint"), finger.indexOf("comment on function public.property_marketing_fingerprint"));
check("הטביעה בלי השדות החדשים", !fingerBody.includes("living_room_sqm") && !fingerBody.includes("air_directions"));

if (failed) {
  console.error(`נכשלו ${failed}`);
  process.exit(1);
}
console.log("עבר");
