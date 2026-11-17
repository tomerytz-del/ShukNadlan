/* שיוך שכונה רק מפין מדויק, ושם של אזור בתכנון לא יוצא לציבור.
   node --experimental-strip-types scripts/neighborhood_exact_pin_test.ts
*/
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { neighborhoodPublicName } from "../supabase/functions/_shared/neighborhood-public.ts";

let failed = 0;
function check(name: string, ok: boolean) {
  if (!ok) {
    failed += 1;
    console.error("FAIL", name);
  } else {
    console.log("ok", name);
  }
}

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

check("planned name hidden", neighborhoodPublicName({ name: "B1 אזור בתכנון", is_planned: true }) === "");
check("industrial name kept", neighborhoodPublicName({ name: "אזור התעשייה", is_planned: false }) === "אזור התעשייה");
check("missing row", neighborhoodPublicName(null) === "");
check("blank name", neighborhoodPublicName({ name: "  ", is_planned: false }) === "");

const sql = read("supabase/migrations/20271117160000_neighborhood_exact_pin_only.sql");
check("trigger skips non-exact", sql.includes("if not public.location_pin_is_exact(new.location_precision) then"));
check("report verdict approx_pin", sql.includes("then 'approx_pin'"));
check("apply still checks precision", sql.includes("and public.location_pin_is_exact(p.location_precision)"));
for (const n of ["1306", "1307", "1315", "1316"]) {
  check("protected listing " + n, sql.includes(n));
}
check("saved-search alerts paused", sql.includes("disable trigger properties_saved_search_alerts_upd"));
check("match alerts paused", sql.includes("disable trigger properties_client_match_alerts_upd"));
check("locate trigger paused", sql.includes("disable trigger properties_locate_street_trg"));
check("alerts restored", sql.includes("enable trigger properties_saved_search_alerts_upd")
  && sql.includes("enable trigger properties_client_match_alerts_upd"));
check("geocode retry uses the existing counter", sql.includes("geocode_attempts = case")
  && sql.includes("p.house_number"));
check("public name in marketing facts", sql.includes("public.neighborhood_public_name(n.is_planned, n.name)"));
check("no description queue", !sql.includes("queue_property_description"));
const cleanup = sql.slice(sql.indexOf("ניקוי השיוך השגוי"), sql.indexOf("create or replace function public.share_digest_preview"));
check("cleanup does not insert a notification", !cleanup.includes("insert into public.notifications"));

const property = read("assets/property.js");
check("property page helper", property.includes("function publicNeighborhoodName(p)")
  && property.includes("if (!n || n.is_planned) return '';"));
check("property select loads the flag", property.includes("neighborhoods(name,is_planned)"));

const home = read("assets/home.js");
check("home cards skip planned", home.includes("!p.neighborhoods.is_planned"));
check("home filter hides planned with stock", home.includes("!h.is_planned ||")
  && !home.includes("(hoodState.counts.get(h.id) || 0) > 0 ||"));

const og = read("netlify/edge-functions/og-tags.ts");
check("og tags use the shared helper", og.includes("neighborhoodPublicName")
  && og.includes("neighborhoods(name,is_planned)"));

const bot = read("supabase/functions/whatsapp-webhook/public-agent.ts");
check("public whatsapp", bot.includes("neighborhoodPublicName(nb)")
  && bot.includes("neighborhoods(name,is_planned)"));

const reel = read("supabase/functions/reel-producer/index.ts");
check("reel data omits planned name", reel.includes("nbRes.data?.is_planned ? null"));

const py = spawnSync("python3", ["-c", `
import importlib.util
spec = importlib.util.spec_from_file_location("q", "marketing/reel_worker/tools/queue.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
assert m.public_neighborhood({"neighborhood": "B1 אזור בתכנון", "is_planned": True}) == ""
assert m.public_neighborhood({"neighborhood": "אזור התעשייה"}) == "אזור התעשייה"
assert m.public_neighborhood({"neighborhood": {"name": "B1 אזור בתכנון", "is_planned": True}}) == ""
print("ok python headline")
`], { cwd: new URL(".", root) });
if (py.status !== 0) {
  failed += 1;
  console.error(py.stderr?.toString() || py.stdout?.toString());
} else {
  process.stdout.write(py.stdout);
}

if (failed) {
  console.error(failed + " failed");
  process.exit(1);
}
console.log("neighborhood exact pin: ok");
