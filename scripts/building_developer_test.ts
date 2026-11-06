// חברה יזמית של בניין: החלטות בלי מסד ובלי שליחה.
//   node --experimental-strip-types scripts/building_developer_test.ts

import { readFileSync } from "node:fs";
import {
  DEVELOPER_UNKNOWN_TITLE,
  addressLinkable,
  applyDeveloperClaim,
  buildingAddressKey,
  developerAskBody,
  developerAskHasVisibleUrl,
  developerSpeech,
  developerUnknownButton,
  exactProjectMatch,
  isNewConstruction,
  isUnknownDeveloperAnswer,
  parseDeveloperUnknownButton,
  propertyAddressKey,
  shouldEnqueueDeveloperAsk,
  shouldSendDeveloperAsk,
  type DeveloperRow,
} from "../supabase/functions/whatsapp-webhook/building-developer-rules.ts";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : " - " + JSON.stringify(detail)}`);
  if (!ok) failed++;
}

const blank: DeveloperRow = {
  developer_company: null,
  verification_status: "unverified",
  source_type: "manual",
  source_note: null,
  partners: [],
};

check("רווחים מתכווצים", buildingAddressKey("  הרצל   12 ") === "הרצל 12");
check("בלי רווח אינו אותו מפתח", buildingAddressKey("הרצל12") !== buildingAddressKey("הרצל 12"));
check("מספר בית אחר אינו אותו מפתח", buildingAddressKey("הרצל 12") !== buildingAddressKey("הרצל 13"));
check("רחוב בלי מספר אינו ניתן לקישור", addressLinkable(buildingAddressKey("הרצל")) === false);
check("רחוב ומספר כן", addressLinkable(propertyAddressKey("הרצל", "12", null)) === true);
check("הכתובת המפורשת לא גוברת על רחוב ומספר", propertyAddressKey("הרצל", "12", "אחר 1") === "הרצל 12");

check("חדש מקבלן", isNewConstruction("new_from_contractor", null));
check("פרויקט עם היתר", isNewConstruction(null, "permit_issued"));
check("משופץ אינו פרויקט", isNewConstruction("renovated", null) === false);
check("בלי מצב אינו פרויקט", isNewConstruction(null, null) === false);

const ask = {
  enabled: true,
  condition: "new_from_contractor",
  addressKey: "הרצל 12",
  knownDeveloper: false,
  alreadyPrompted: false,
};
check("שואלים כשאין יזם", shouldEnqueueDeveloperAsk(ask));
check("הדגל הכבוי לא שואל", shouldEnqueueDeveloperAsk({ ...ask, enabled: false }) === false);
check("יזם ידוע לא שואל", shouldEnqueueDeveloperAsk({ ...ask, knownDeveloper: true }) === false);
check("כבר נשאל לא שואל", shouldEnqueueDeveloperAsk({ ...ask, alreadyPrompted: true }) === false);
check("בלי מספר בית לא שואל", shouldEnqueueDeveloperAsk({ ...ask, addressKey: "הרצל" }) === false);
check("שליחה רק בחלון וגם ב-24 שעות", shouldSendDeveloperAsk({ windowOpen: true, within24h: true }));
check("שבת או שישי אחר הצהריים לא שולחים", shouldSendDeveloperAsk({ windowOpen: false, within24h: true }) === false);
check("מחוץ ל-24 שעות לא שולחים", shouldSendDeveloperAsk({ windowOpen: true, within24h: false }) === false);

check("לא יודע אינו שם", isUnknownDeveloperAnswer("לא יודע?") === true);
const ignored = applyDeveloperClaim(blank, { company: "לא יודע", source_type: "agent" });
check("לא יודע לא נרשם", ignored.action === "ignored" && ignored.row.developer_company === null);

const set = applyDeveloperClaim(blank, { company: "  אבני   דרך ", source_type: "agent", source_note: "נמסר" });
check("שם ראשון נרשם ולא מאומת", set.action === "set" && set.row.developer_company === "אבני דרך" && set.row.verification_status === "unverified");

const same = applyDeveloperClaim(
  { ...set.row, verification_status: "verified" },
  { company: "אבני דרך", source_type: "web" },
);
check("אותו שם לא מוריד אימות", same.action === "same" && same.row.verification_status === "verified" && same.row.source_type === "agent");

const clash = applyDeveloperClaim(set.row, { company: "אלמוגים", source_type: "agent" });
check(
  "ערך סותר לא דורס",
  clash.action === "conflict" &&
    clash.row.developer_company === "אבני דרך" &&
    clash.row.verification_status === "conflict" &&
    clash.row.source_type === "agent",
);
const clashAgain = applyDeveloperClaim(clash.row, { company: "אלמוגים", source_type: "agent" });
check("התנגשות לא נכפלת בהערה", (clashAgain.row.source_note || "").split("התנגשות:").length === 2);

const projects = [
  { name: "א", city: "עפולה", addresses: ["הרצל 12"], developer_company: "אבני דרך" },
  { name: "ב", city: "עפולה", addresses: ["הרצל 13"], developer_company: "אלמוגים" },
  { name: "ג", city: "נצרת", addresses: ["הרצל 12"], developer_company: "אחר" },
];
const hit = exactProjectMatch(projects, "עפולה", "הרצל 12");
check("התאמה מדויקת אחת", hit !== "none" && hit !== "many" && hit.name === "א");
check("עיר אחרת אינה התאמה", exactProjectMatch(projects, "נצרת", "הרצל 13") === "none");
check("בלי מספר אין התאמה", exactProjectMatch(projects, "עפולה", "הרצל") === "none");
const many = exactProjectMatch(
  [...projects, { name: "ד", city: "עפולה", addresses: ["הרצל 12"], developer_company: "שני" }],
  "עפולה",
  "הרצל 12",
);
check("שתי התאמות לא בוחרות", many === "many");

const button = developerUnknownButton("11111111-1111-4111-8111-111111111111");
check("כותרת הכפתור עד 20 יחידות", button.title === DEVELOPER_UNKNOWN_TITLE && button.title.length <= 20);
check("המזהה חוזר", parseDeveloperUnknownButton(button.id) === "11111111-1111-4111-8111-111111111111");
check("מזהה זר לא נתפס", parseDeveloperUnknownButton("poffer:share:yes:11111111-1111-4111-8111-111111111111") === null);
const body = developerAskBody("הרצל 12, עפולה");
check("גוף השאלה בלי כתובת אתר", developerAskHasVisibleUrl(body) === false && body.includes("לא יודע"));

check("בלי נתון לא מנחשים", developerSpeech({ found: false }).includes("לא מנחשת"));
check("בלי מספר בית לא עונים", developerSpeech({ house_number_required: true }).includes("מספר בית"));
check("עמימות לא בוחרת", developerSpeech({ ambiguous: true }).includes("לא בוחרת"));
const unverified = developerSpeech({
  found: true, company: "אבני דרך", source_label: "אתר", verification: "unverified", partners: ["אגדים"],
});
check("מקור ולא אומת", unverified.includes("אבני דרך") && unverified.includes("אתר") && unverified.includes("הנתון לא אומת") && unverified.includes("אגדים"));
check("סתירה לא מציגה שם מוחלף", developerSpeech({
  found: true, company: "אבני דרך", source_label: "אתר", verification: "conflict",
}).includes("יש סתירה בין מקורות"));
check("מאומת נאמר כמאומת", developerSpeech({
  found: true, company: "אבני דרך", source_label: "רשות מקומית", verification: "verified",
}).includes("הנתון אומת"));

const migration = readFileSync("supabase/migrations/20271106100000_building_projects.sql", "utf8");
for (const name of ["שהם וטופז", "עדן המושבה הקטנה", "אדרת העמק", "קדמת נופר", "נוף בראשית", "פארק ATECH"]) {
  check(`זרע ${name}`, migration.includes(name));
}
check("הדגל נולד כבוי", migration.includes("('building_projects_enabled', 'false'"));
check("הפרויקט השביעי לא הומצא", migration.includes("פרויקט שביעי לא נמצא"));
check("אין דריסת יזם בזרע", migration.includes("on conflict (city, name) do nothing"));
check("הדוח עובר דרך הצירוף", migration.includes("cma_attach_building_developer"));

const render = readFileSync("assets/cma-render.js", "utf8");
check("הדוח מציג את השורה", render.includes("function cmaDeveloperLine") && render.includes("cmaDeveloperLine(s)"));
check("הדוח אומר לא אומת", render.includes("הנתון לא אומת") && render.includes("יש סתירה בין מקורות, והשם לא הוחלף"));

if (failed) {
  console.error(`\n${failed} נכשלו`);
  process.exit(1);
}
console.log("\nהכל עבר");
