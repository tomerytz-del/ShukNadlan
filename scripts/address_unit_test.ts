// כתובת משותפת: מספר שונה עובר, אותו מספר נחסם, ובלי מספר שואלים.
//   node --experimental-strip-types scripts/address_unit_test.ts

import { readFileSync } from "node:fs";
import {
  composeAddress,
  houseNumberPrefix,
  sameHouseNumber,
  shareStop,
  sharedBuildingDecision,
  UNIT_ASK_SAY,
  UNIT_BLOCK_SAY,
  UNIT_ELSEWHERE_SAY,
  type ListedUnit,
  type UnitAddress,
} from "../supabase/functions/whatsapp-webhook/address-unit.ts";
import { HOUSE_NUMBER_REQUIRED_MSG, publishErrorText, UNIT_REQUIRED_MSG } from "../supabase/functions/whatsapp-webhook/listing-actions.ts";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : " - " + JSON.stringify(detail)}`);
  if (!ok) failed++;
}

const other: ListedUnit = { floor: null, unit: null, listing_number: 1055, sameOffice: true };
const office5: ListedUnit = { floor: null, unit: "5", listing_number: 1055, sameOffice: true };
const office3: ListedUnit = { floor: 2, unit: "משרד 3", listing_number: 1071, sameOffice: true };
const apt = (over: Partial<ListedUnit>): ListedUnit => ({
  floor: 2, unit: null, rooms: 4, deal: "sale", sameOffice: true, listing_number: 20, ...over,
});
const incoming = (over: Partial<UnitAddress>): UnitAddress => ({
  floor: null, unit: null, ...over,
});

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
  "דירה בלי קומה, חדרים שונים: לא שואלים",
  sharedBuildingDecision(incoming({ rooms: 3, deal: "sale" }), [apt({ floor: null, rooms: 4, deal: "sale" })]) === "allow",
);
check(
  "אותה קומה, עסקה אחרת: לא נחסם",
  sharedBuildingDecision(incoming({ floor: 2, rooms: 4, deal: "rent" }), [apt({ deal: "sale" })]) === "allow",
);
check(
  "אותה קומה ואותם חדרים בלי מספר: שואלים, לא same_unit",
  sharedBuildingDecision(incoming({ floor: 2, rooms: 4, deal: "sale" }), [apt({})]) === "ask",
);
check(
  "משרד אחר, מספר שהומצא מול מודעה בלי מספר: נחסם",
  sharedBuildingDecision(
    incoming({ rooms: 4, deal: "rent", unit: "9" }),
    [apt({ floor: null, rooms: 4, deal: "rent", unit: null, sameOffice: false, listing_number: 1055 })],
  ) === "elsewhere"
    && shareStop(
      incoming({ rooms: 4, deal: "rent", unit: "9" }),
      [apt({ floor: null, rooms: 4, deal: "rent", unit: null, sameOffice: false, listing_number: 1055 })],
    )?.say === UNIT_ELSEWHERE_SAY,
);
check(
  "משרד אחר, קומה שמולאה מול מודעה בלי קומה: לא עוקף",
  sharedBuildingDecision(
    incoming({ floor: 2, rooms: 4, deal: "rent" }),
    [apt({ floor: null, rooms: 4, deal: "rent", sameOffice: false })],
  ) === "elsewhere",
);
check(
  "מסחרי בלי חדרים, מספר מול אין-מספר של משרד אחר: מותר",
  sharedBuildingDecision(
    incoming({ unit: "4", commercial: true, deal: "rent" }),
    [{ floor: null, unit: null, deal: "rent", sameOffice: false, listing_number: 1055 }],
  ) === "allow",
);
check(
  "אותו משרד, מספר מול אין-מספר: מותר",
  sharedBuildingDecision(incoming({ unit: "4", deal: "rent" }), [other]) === "allow",
);
check(
  "מספר בית עם רווח",
  sameHouseNumber("25א", "25 א") && sameHouseNumber("25א", "25  א")
    && houseNumberPrefix("25א") === "25" && houseNumberPrefix("25 א") === "25",
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

const sql = readFileSync(new URL("../supabase/migrations/20271116133000_property_unit_label.sql", import.meta.url), "utf8");
const elsewhereAt = sql.indexOf("duplicate_elsewhere");
const unitRequiredAt = sql.indexOf("unit_required");
check(
  "הטריגר מפריד לפי מספר משרד, ומשרד אחר קודם לבקשת מספר",
  sql.includes("property_units_conflict")
    && sql.includes("p_commercial")
    && sql.includes("coalesce(p_same_agency, false)")
    && elsewhereAt > 0 && unitRequiredAt > elsewhereAt
    && sql.includes("צריך מספר קומה או מספר משרד"),
);

// מודעה בלי מספר בית מול משרד אחר (20271202100000)
const hnSql = readFileSync(new URL("../supabase/migrations/20271202100000_guard_duplicate_without_house_number.sql", import.meta.url), "utf8");
const dbMsg = "במערכת כבר מפורסמת מודעה של משרד אחר באותו רחוב, עם אותו מספר חדרים וקומה ואותו סוג עסקה. כדי לפרסם יש להזין מספר בית. אם זו אותה דירה, אפשר לפרסם אותה רק על סמך הסכם בלעדיות חתום.";
check(
  "גבריאלה אומרת משפט בלי שמות כשחסר מספר בית",
  publishErrorText(dbMsg) === HOUSE_NUMBER_REQUIRED_MSG && !/https?:\/\//.test(HOUSE_NUMBER_REQUIRED_MSG),
);
check(
  "הטריגר: רק משרד אחר, חדרים וקומה וסוג עסקה חובה, ואותו hint שכבר מטופל",
  hnSql.includes("p.agency_id is distinct from new.agency_id")
    && hnSql.includes("new.rooms is not null")
    && hnSql.includes("new.floor is not null")
    && hnSql.includes("coalesce(p.deal_type, '') = coalesce(new.deal_type, '')")
    && hnSql.includes("property_text_key(new.house_number) is null")
    && hnSql.includes("hint = 'duplicate_elsewhere'"),
);
check(
  "הטריגר: ההגנה על עריכת מודעה פעילה (קטיעה מוקדמת) והחסימה אחריה נשמרו",
  hnSql.indexOf("old.status = 'active'") > 0
    && hnSql.indexOf("old.status = 'active'") < hnSql.indexOf("property_text_key(new.house_number) is null"),
);

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\naddress unit ok");
