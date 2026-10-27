// חיפוש של גבריאלה: שורת לוג, ודרישות מהערות. בלי מסד.
//   node --experimental-strip-types scripts/gabriela_search_test.ts

import { searchMissRow, searchMissStoreMissing } from "../supabase/functions/whatsapp-webhook/property-search.ts";
import { requirementsFromNotes } from "../supabase/functions/whatsapp-webhook/client-requirements.ts";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : " - " + JSON.stringify(detail)}`);
  if (!ok) failed++;
}

const row = searchMissRow("agent-1", {
  city: "עפולה",
  area: "גבעת המורה",
  deal_type: "sale",
  notes: "טלפון 050-0000000",
  phone: "050",
});
check("הלוג שומר רק עיר אזור ועסקה", row.city === "עפולה" && row.area === "גבעת המורה" && row.deal_type === "sale");
check("הלוג בלי טלפון ובלי הערות", !("phone" in row) && !("notes" in row));
check("טבלה חסרה לא נחשבת תקלה", searchMissStoreMissing({ code: "PGRST205" }) && searchMissStoreMissing({ code: "23505" }) === false);

const fromNotes = requirementsFromNotes("דירה עם ממ״ד וחניה", {});
check("הערות ממלאות מאפיין כשהשדה ריק", fromNotes.features.includes("mamad") && fromNotes.features.includes("parking"));
check("בלי עסקה עיר ותקציב שואלים", fromNotes.ask.join() === "עסקה,עיר,תקציב");
const kept = requirementsFromNotes("עם מעלית", { required_features: ["mamad"], deal_type: "sale", cities: ["עפולה"], max_price: 1000000 });
check("שדה מלא לא נדרס", kept.features.length === 0 && kept.ask.length === 0);
const neg = requirementsFromNotes("בלי מעלית", {});
check("שלילה אינה בקשה", !neg.features.includes("elevator"));

if (failed) {
  console.error(`נכשלו ${failed}`);
  process.exit(1);
}
console.log("חיפוש גבריאלה: כל הבדיקות עברו");
