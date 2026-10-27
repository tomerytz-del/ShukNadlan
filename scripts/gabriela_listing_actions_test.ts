// מחיקת תמונה וביטול/הנפקת הסכם: ההחלטה, בלי מסד ובלי וואטסאפ.
//   node --experimental-strip-types scripts/gabriela_listing_actions_test.ts

import {
  agreementConfirmButtons,
  AGREEMENT_CANCEL_YES,
  AGREEMENT_REISSUE_YES,
  imageDeleteButtons,
  IMAGE_DELETE_YES,
  imagesAfterRemove,
  ownsRow,
  parseAgreementButton,
  parseImageDeleteButton,
  reissueBlockedKind,
  reissuePrepareInput,
} from "../supabase/functions/whatsapp-webhook/listing-actions.ts";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : " - " + JSON.stringify(detail)}`);
  if (!ok) failed++;
}

const agent = { id: "a", agency_id: "office" };
check("שורה של הסוכן/ת באותו משרד", ownsRow(agent, { agent_id: "a", agency_id: "office" }));
check("סוכן/ת אחר/ת לא", ownsRow(agent, { agent_id: "b", agency_id: "office" }) === false);
check("משרד אחר לא", ownsRow(agent, { agent_id: "a", agency_id: "other" }) === false);
check("בלי משרד על השורה עדיין של הסוכן/ת", ownsRow(agent, { agent_id: "a", agency_id: null }));

const images = ["u1", "u2", "u3"];
const removed = imagesAfterRemove(images, [1, 3]);
check("מחיקה לפי מיקום משאירה את האמצע", removed.ok && removed.next.join() === "u2" && removed.removed === 2);
check("מספר מחוץ לטווח לא מוחק", imagesAfterRemove(images, [4]).ok === false);
check("בלי תמונות אין מחיקה", imagesAfterRemove([], [1]).ok === false);

const prop = "11111111-1111-1111-1111-111111111111";
const agr = "22222222-2222-2222-2222-222222222222";
const imgButtons = imageDeleteButtons(prop, [3, 1, 1]);
check("כפתור מחיקה נושא את הנכס ואת המיקומים", imgButtons?.[0].id === `imgd:y:${prop}:1.3` && imgButtons[0].title === IMAGE_DELETE_YES);
check("כותרת המחיקה עד 20", [...IMAGE_DELETE_YES].length <= 20 && [...AGREEMENT_CANCEL_YES].length <= 20 && [...AGREEMENT_REISSUE_YES].length <= 20);
const parsedImg = parseImageDeleteButton(imgButtons![0].id);
check("הכפתור נקרא חזרה", parsedImg?.yes === true && parsedImg.propertyId === prop && parsedImg.positions.join() === "1,3");
check("סירוב מחיקה בלי מיקומים", parseImageDeleteButton(`imgd:n:${prop}`)?.yes === false);
check("כותרת בלי מזהה אינה פעולה", parseImageDeleteButton("כן, למחוק") === null);

const cancelButtons = agreementConfirmButtons("cancel", agr);
check("ביטול נושא את ההסכם", cancelButtons?.[0].id === `agcx:y:${agr}`);
const re = parseAgreementButton(agreementConfirmButtons("reissue", agr)![0].id);
check("הנפקה נקראת כהסכמה", re?.action === "reissue" && re.yes && re.agreementId === agr);
check("סירוב הנפקה", parseAgreementButton(`agrx:n:${agr}`)?.yes === false);

check("הסכמה לשיווק לא מונפקת לבד", !!reissueBlockedKind("marketing_sell"));
check("בלעדיות כן", reissueBlockedKind("exclusive_sell") === null);

const prepared = reissuePrepareInput(
  {
    kind: "sell",
    client_ids: ["c1"],
    property_ids: ["p1"],
    commission_pct: 2,
    commission_note: "price",
    notes: "ישן",
  },
  [{ full_name: "ראשי", ord: 0, client_id: "c1" }, { full_name: "שותף", ord: 1, phone: "050" }],
  { commission_pct: 1.5 },
);
check("החדש נוצר עם force_new והתיקון גובר", !("error" in prepared) && prepared.force_new === true && prepared.commission_pct === 1.5 && prepared.commission_basis === "price");
check("חותם נוסף עובר", !("error" in prepared) && Array.isArray(prepared.extra_signers) && prepared.extra_signers.length === 1);
check("בלי לקוח אין הנפקה", "error" in reissuePrepareInput({ kind: "sell", property_ids: ["p1"] }, [], {}));

if (failed) {
  console.error(`נכשלו ${failed}`);
  process.exit(1);
}
console.log("פעולות וואטסאפ: כל הבדיקות עברו");
