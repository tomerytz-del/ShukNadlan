// כתובת משותפת: מספר שונה עובר, אותו מספר נחסם, ובלי מספר שואלים.
//   node --experimental-strip-types scripts/address_unit_test.ts

import { readFileSync } from "node:fs";
import {
  composeAddress,
  shareStop,
  sharedBuildingDecision,
  UNIT_ASK_SAY,
  UNIT_BLOCK_SAY,
  type ListedUnit,
} from "../supabase/functions/whatsapp-webhook/address-unit.ts";
import { publishErrorText, UNIT_REQUIRED_MSG } from "../supabase/functions/whatsapp-webhook/listing-actions.ts";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : " - " + JSON.stringify(detail)}`);
  if (!ok) failed++;
}

const other: ListedUnit = { floor: null, unit: null, listing_number: 1055 };
const office5: ListedUnit = { floor: null, unit: "5", listing_number: 1055 };
const office3: ListedUnit = { floor: 2, unit: "משרד 3", listing_number: 1071 };

check(
  "אותו רחוב, מספר משרד אחר: מותר",
  sharedBuildingDecision({ floor: null, unit: "4" }, [office5]) === "allow"
    && shareStop({ floor: null, unit: "משרד 4" }, [office5]) === null,
);
check(
  "אותו רחוב, אותה קומה אחרת: מותר",
  sharedBuildingDecision({ floor: 3, unit: null }, [other]) === "allow",
);
check(
  "אותו רחוב, אותו מספר משרד: חסום",
  sharedBuildingDecision({ floor: null, unit: "5" }, [office5]) === "block"
    && shareStop({ floor: null, unit: "5" }, [office5])?.ok === false
    && shareStop({ floor: 2, unit: "משרד  3" }, [office3])?.blocked === true,
);
check(
  "בלי מספר: גבריאלה שואלת ולא שומרת",
  sharedBuildingDecision({ floor: null, unit: null }, [other]) === "ask"
    && sharedBuildingDecision({ floor: null, unit: "  " }, [office5]) === "ask"
    && shareStop({ floor: null, unit: null }, [other])?.needs_unit === true
    && shareStop({ floor: null, unit: null }, [other])?.say === UNIT_ASK_SAY,
);
check(
  "אין מודעה בכתובת: אין שאלה",
  sharedBuildingDecision({ floor: null, unit: null }, []) === "allow",
);
check(
  "הכתובת שנשמרת כוללת את המספר שנאמר, בלי ברירת מחדל",
  composeAddress("המלאכה", "25", 2, "משרד 4") === "המלאכה 25, קומה 2, משרד 4"
    && composeAddress("המלאכה", "25", null, null) === "המלאכה 25"
    && !composeAddress("המלאכה", "25", null, null)!.includes("קומה 1"),
);

const ask = shareStop({ floor: null, unit: null }, [other]);
const block = shareStop({ floor: null, unit: "5" }, [office5]);
const shown = `${ask?.say || ""} ${ask?.guidance || ""} ${block?.say || ""} ${UNIT_BLOCK_SAY}`;
check(
  "בלי טלפון ובלי כתובת אתר",
  !/https?:\/\//.test(shown) && !shown.includes("shuknadlan") && !/0\d{8,}/.test(shown),
);
check(
  "הודעת המסד בלי מספר עוברת כמו שהיא",
  publishErrorText(UNIT_REQUIRED_MSG) === UNIT_REQUIRED_MSG
    && publishErrorText("duplicate key") !== UNIT_REQUIRED_MSG,
);

const sql = readFileSync(new URL("../supabase/migrations/20271116120000_property_unit_label.sql", import.meta.url), "utf8");
check(
  "הטריגר מפריד לפי מספר משרד ועדיין מבקש מספר כשאין",
  sql.includes("property_units_conflict")
    && sql.includes("unit_required")
    && sql.includes("צריך מספר קומה או מספר משרד"),
);

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\naddress unit ok");
