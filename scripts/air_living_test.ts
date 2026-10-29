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
  metaAirLivingClause,
  parseAirDirections,
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
check("סלון ללקוח", customerLivingLine(30) === "גודל הסלון: כ־30 מ״ר");
check("בלי סלון גדול", !customerLivingLine(30).includes("סלון גדול") && !customerLivingLine(null));
check("מטא", metaAirLivingClause(["צפון", "דרום", "מערב"], 35) === "3 כיווני אוויר, סלון של 35 מ״ר");
check("קונה", customerSeekAir(["מערב", "דרום"]) === "מחפשים כיווני אוויר: דרום, מערב");
check("מינימום", customerSeekLiving(25) === "גודל סלון מינימלי: 25 מ״ר");
const matched = customerMatchLines(["דרום"], ["דרום", "צפון"], 20, 28);
check("התאמה מציגה רק מה שמתאים", matched.length === 2 && matched[0].startsWith("כיווני אוויר"));
check("פער לא מוצג", customerMatchLines(["מערב"], ["צפון"], 40, 20).length === 0);

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
check("דף נכס", prop.includes("customerLivingLine") && page.includes("גודל הסלון: כ־"));
check("מטא בשרת", read("netlify/edge-functions/og-tags.ts").includes("metaClause"));
check("בלי סלון גדול בשיווק", read("supabase/functions/_shared/marketing-copy.ts").includes("noLivingClaim"));

if (failed) {
  console.error(`נכשלו ${failed}`);
  process.exit(1);
}
console.log("עבר");
