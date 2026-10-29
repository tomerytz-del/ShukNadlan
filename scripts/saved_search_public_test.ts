// כפילות של חיפוש שמור לא מחזירה מזהה לקורא הציבורי.
//   node --experimental-strip-types scripts/saved_search_public_test.ts
import { readFileSync } from "node:fs";
import { publicSavedSearchBody } from "../supabase/functions/_shared/saved-search-public.ts";

let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  if (!ok) failed++;
}

const dup = publicSavedSearchBody({
  success: true,
  duplicate: true,
  search_id: "11111111-1111-1111-1111-111111111111",
  consent_token: "secret",
  saved: { cities: ["עפולה"] },
  saved_labels: ["האזור", "החדרים"],
}, false);
check("כפילות בלי מזהה", !("search_id" in dup) && !("consent_token" in dup) && !("saved" in dup));
check("רק שמות שדות", Array.isArray(dup.saved_labels) && dup.saved_labels.join(",") === "האזור,החדרים");

const created = publicSavedSearchBody({
  success: true,
  search_id: "22222222-2222-2222-2222-222222222222",
  consent_token: "tok",
}, true);
check("יצירה מחזירה מזהה", created.search_id === "22222222-2222-2222-2222-222222222222" && created.consent_token === "tok");

const intake = readFileSync(new URL("../supabase/functions/saved-search-intake/index.ts", import.meta.url), "utf8");
const logAt = intake.indexOf("await logLeadRouting");
const dupReturn = intake.indexOf("result?.duplicate === true");
check("כפילות לא נרשמת כניתוב", dupReturn > 0 && dupReturn < logAt);
check("הסכמה דורשת אסימון", intake.includes('eq("consent_token", token)') && intake.includes("consent_token"));

if (failed) {
  console.error(`נכשלו ${failed}`);
  process.exit(1);
}
console.log("עבר");
