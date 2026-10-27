// מחיקת תמונה וביטול/הנפקת הסכם: ההחלטה, בלי מסד ובלי וואטסאפ.
//   node --experimental-strip-types scripts/gabriela_listing_actions_test.ts

import {
  agreementConfirmButtons,
  AGREEMENT_CANCEL_YES,
  AGREEMENT_REISSUE_YES,
  imageDeleteButtons,
  imageDeleteMatches,
  IMAGE_DELETE_STALE,
  IMAGE_DELETE_YES,
  imagesAfterRemove,
  newPendingActionId,
  ownsRow,
  parseAgreementButton,
  parseImageDeleteButton,
  pendingStoreMissing,
  REISSUE_EXPIRED,
  REISSUE_OLD_CANCELLED,
  reissueBlockedKind,
  reissueClickDecision,
  reissueDecisionText,
  reissueOverridePayload,
  reissuePrepareInput,
  type PendingActionRow,
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
const imgButtons = imageDeleteButtons(prop, [3, 1, 1], images);
check("כפתור מחיקה נושא את הנכס, המיקומים וטביעה", !!imgButtons && imgButtons[0].id.startsWith(`imgd:y:${prop}:1.3:`) && imgButtons[0].title === IMAGE_DELETE_YES);
check("כותרת המחיקה עד 20", [...IMAGE_DELETE_YES].length <= 20 && [...AGREEMENT_CANCEL_YES].length <= 20 && [...AGREEMENT_REISSUE_YES].length <= 20);
const parsedImg = parseImageDeleteButton(imgButtons![0].id);
check("הכפתור נקרא חזרה עם הטביעה", parsedImg?.yes === true && parsedImg.propertyId === prop && parsedImg.positions.join() === "1,3" && imageDeleteMatches(images, parsedImg.positions, parsedImg.hash));
check("סירוב מחיקה בלי מיקומים", parseImageDeleteButton(`imgd:n:${prop}`)?.yes === false);
check("כותרת בלי מזהה אינה פעולה", parseImageDeleteButton("כן, למחוק") === null);
check("כפתור בלי טביעה לא מוחק", imageDeleteMatches(images, [1, 3], null) === false);
const moved = ["u3", "u2", "u1"];
check(
  "אחרי שינוי סדר לא מוחקים תמונה אחרת",
  parsedImg != null && imageDeleteMatches(moved, parsedImg.positions, parsedImg.hash) === false,
);
check("ההודעה על אי-התאמה בעברית", IMAGE_DELETE_STALE.includes("לא מחקתי") && !IMAGE_DELETE_STALE.includes("—"));

const cancelButtons = agreementConfirmButtons("cancel", agr);
check("ביטול נושא את ההסכם", cancelButtons?.[0].id === `agcx:y:${agr}`);
const re = parseAgreementButton(agreementConfirmButtons("reissue", agr)![0].id);
check("הנפקה עם מזהה הסכם עדיין נקראת", re?.action === "reissue" && re.yes && re.agreementId === agr);
check("סירוב הנפקה", parseAgreementButton(`agrx:n:${agr}`)?.yes === false);

const requestId = "abc123def456";
const overrides = reissueOverridePayload({
  commission_pct: 1.5,
  notes: "בלי תיווך כפול",
  client_email: "a@b.co",
  exclusive_until: "2027-01-01",
  ignored: "לא נשמר",
});
const reissueButtons = agreementConfirmButtons("reissue", requestId);
const parsedReq = parseAgreementButton(reissueButtons![0].id);
const pending: PendingActionRow = {
  id: requestId,
  action: "reissue",
  subject_id: agr,
  payload: overrides,
  expires_at: new Date(Date.now() + 60_000).toISOString(),
};
const run = reissueClickDecision(pending, Date.now());
check("הכפתור נושא מזהה בקשה קצר", parsedReq?.agreementId === requestId && parsedReq.agreementId !== agr && reissueButtons![0].id.length <= 200);
check(
  "הלחיצה משחזרת את התיקונים ואת ההסכם",
  run.kind === "run" && run.agreementId === agr && run.overrides.commission_pct === 1.5 &&
    run.overrides.notes === "בלי תיווך כפול" && run.overrides.client_email === "a@b.co" &&
    run.overrides.exclusive_until === "2027-01-01" && run.overrides.ignored === undefined,
);
const again = reissueClickDecision(
  { ...pending, executed_at: new Date().toISOString(), result: "יצא הסכם חדש." },
  Date.now(),
);
check("לחיצה שנייה אחרי ביצוע לא מריצה", again.kind === "done" && again.text === "יצא הסכם חדש.");
const linked = reissueClickDecision({ ...pending, new_subject_id: agr }, Date.now());
check("הסכם חדש שכבר נקשר לא מונפק שוב", linked.kind === "done");
const superseded = reissueClickDecision(
  { ...pending, claimed_at: new Date().toISOString() },
  Date.now(),
  "cancelled",
);
check("ישן שבוטל בהנפקה הזו נדחה", superseded.kind === "superseded" && reissueDecisionText(superseded) === REISSUE_OLD_CANCELLED);
const expired = reissueClickDecision(
  { ...pending, expires_at: new Date(Date.now() - 1000).toISOString() },
  Date.now(),
);
check("בקשה שפגה לא רצה", expired.kind === "expired" && reissueDecisionText(expired) === REISSUE_EXPIRED);
const busy = reissueClickDecision({ ...pending, claimed_at: new Date().toISOString() }, Date.now());
check("בקשה באמצע טיפול לא רצה שוב", busy.kind === "busy");
check("בלי שורה אין הנפקה", reissueClickDecision(null, Date.now()).kind === "missing");
const freshId = newPendingActionId();
check("מזהה בקשה קצר והקסי", /^[0-9a-f]{12}$/.test(freshId));
check("טבלה חסרה מזוהה בלי ליפול", pendingStoreMissing({ code: "PGRST205" }) && pendingStoreMissing({ code: "42P01" }) && pendingStoreMissing({ code: "23505" }) === false);

check("הסכמה לשיווק לא מונפקת לבד", !!reissueBlockedKind("marketing_sell"));
check("בלעדיות כן", reissueBlockedKind("exclusive_sell") === null);

const prepared = reissuePrepareInput(
  {
    kind: "sell",
    client_ids: ["c1", "c9"],
    property_ids: ["p1"],
    commission_pct: 2,
    commission_note: "price",
    notes: "ישן",
  },
  [
    { full_name: "ראשי", ord: 0, client_id: "c1" },
    { full_name: "שותף", ord: 1, phone: "050", client_id: "c2" },
  ],
  { commission_pct: 1.5 },
);
check("החדש נוצר עם force_new והתיקון גובר", !("error" in prepared) && prepared.force_new === true && prepared.commission_pct === 1.5 && prepared.commission_basis === "price");
const extras = !("error" in prepared) && Array.isArray(prepared.extra_signers) ? prepared.extra_signers as { client_id?: string }[] : [];
check("חותם נוסף שומר את client_id שלו", extras.length === 1 && extras[0].client_id === "c2");
const fromList = reissuePrepareInput(
  { kind: "sell", client_ids: ["c1", "c9"], property_ids: ["p1"] },
  [{ full_name: "ראשי", ord: 0 }, { full_name: "שותף", ord: 1 }],
  {},
);
const listExtras = !("error" in fromList) && Array.isArray(fromList.extra_signers) ? fromList.extra_signers as { client_id?: string }[] : [];
check("client_ids אחרי הראשון עוברים לחותם בלי כרטיס", listExtras.length === 1 && listExtras[0].client_id === "c9");
check("בלי לקוח אין הנפקה", "error" in reissuePrepareInput({ kind: "sell", property_ids: ["p1"] }, [], {}));

if (failed) {
  console.error(`נכשלו ${failed}`);
  process.exit(1);
}
console.log("פעולות וואטסאפ: כל הבדיקות עברו");
