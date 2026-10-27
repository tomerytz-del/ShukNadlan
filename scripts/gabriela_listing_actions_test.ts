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
  confirmWritesNow,
  parsePublishButton,
  listingStatusForCreate,
  pendingStoreMissing,
  PUBLISH_DUPLICATE_ELSEWHERE,
  PUBLISH_EXCLUSIVE_ELSEWHERE,
  PUBLISH_FAILED,
  PUBLISH_STORE_MISSING,
  PUBLISH_YES,
  PUBLISH_NO,
  publishAskFirst,
  publishClickDecision,
  publishConfirmButtons,
  publishDecisionText,
  publishErrorText,
  publishStoreBlocked,
  publishWritesNow,
  REISSUE_EXPIRED,
  reissueOldAgreementPlan,
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
check(
  "טבלה חסרה מזוהה רק ב-42P01 וב-PGRST205",
  pendingStoreMissing({ code: "PGRST205" }) &&
    pendingStoreMissing({ code: "42P01" }) &&
    pendingStoreMissing({ code: "PGRST204" }) === false &&
    pendingStoreMissing({ code: "23505" }) === false &&
    pendingStoreMissing({ message: "whatsapp_pending_actions schema cache" }) === false,
);
check("עם תור אין כתיבה גם אם confirm", confirmWritesNow(true, true) === false && confirmWritesNow(false, true) === true && confirmWritesNow(false, "true") === false);
check(
  "טיוטה מבוטלת ובלעדיות חתומה ממתינה לחתימה",
  reissueOldAgreementPlan("draft", "sell") === "cancel" &&
    reissueOldAgreementPlan("sent", "exclusive_sell") === "cancel" &&
    reissueOldAgreementPlan("signed", "exclusive_sell") === "supersede" &&
    reissueOldAgreementPlan("signed", "exclusive_landlord") === "supersede" &&
    reissueOldAgreementPlan("signed", "sell") === "keep",
);

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
const leftover = reissuePrepareInput(
  { kind: "exclusive_sell", client_ids: ["c1", "c9", "c8"], property_ids: ["p1"] },
  [{ full_name: "ראשי", ord: 0, client_id: "c1" }],
  {},
);
const kept = !("error" in leftover) && Array.isArray(leftover.also_client_ids)
  ? leftover.also_client_ids as string[]
  : [];
check(
  "לקוח בלי שורת חותם נשאר כלקוח",
  kept.join(",") === "c9,c8" && !("error" in leftover) && leftover.extra_signers === undefined,
);
const mixed = reissuePrepareInput(
  { kind: "sell", client_ids: ["c1", "c9", "c8"], property_ids: ["p1"] },
  [{ full_name: "ראשי", ord: 0, client_id: "c1" }, { full_name: "שותף", ord: 1 }],
  {},
);
const mixedKept = !("error" in mixed) && Array.isArray(mixed.also_client_ids)
  ? mixed.also_client_ids as string[]
  : [];
const mixedExtras = !("error" in mixed) && Array.isArray(mixed.extra_signers)
  ? mixed.extra_signers as { client_id?: string }[]
  : [];
check(
  "חותם בלי כרטיס לוקח את הראשון שנשאר, והשאר נשארים כלקוחות",
  mixedExtras.length === 1 && mixedExtras[0].client_id === "c9" && mixedKept.join(",") === "c8",
);
check("בלי לקוח אין הנפקה", "error" in reissuePrepareInput({ kind: "sell", property_ids: ["p1"] }, [], {}));

const pubId = "abc123def456";
const pubButtons = publishConfirmButtons(pubId);
check("כפתורי פרסום", !!pubButtons && pubButtons[0].id === `pubx:y:${pubId}` && pubButtons[1].title === PUBLISH_NO);
check("כותרת הפרסום בתוך 20", [...PUBLISH_YES].reduce((n, ch) => n + (ch.codePointAt(0)! > 0xffff ? 2 : 1), 0) <= 20);
check("פרסור פרסום", parsePublishButton(`pubx:y:${pubId}`)?.yes === true && parsePublishButton(`pubx:n:${pubId}`)?.yes === false);
check("הנפקה אינה פרסום", parsePublishButton("agrx:y:abc123def456") === null);
const propertyId = "11111111-1111-1111-1111-111111111111";
const pubRow = {
  id: pubId,
  action: "publish",
  subject_id: propertyId,
  expires_at: new Date(Date.now() + 60_000).toISOString(),
  claimed_at: null,
  executed_at: null,
  result: null,
};
check("לחיצה ראשונה מפרסמת", publishClickDecision(pubRow, Date.now()).kind === "run");
check("לחיצה שנייה לא מפרסמת שוב", publishClickDecision(
  { ...pubRow, executed_at: new Date().toISOString(), result: "הנכס פורסם." },
  Date.now(),
).kind === "done");
check("בקשה שפגה לא מפרסמת", publishClickDecision(
  { ...pubRow, expires_at: new Date(Date.now() - 1000).toISOString() },
  Date.now(),
).kind === "expired");
check("תפיסה בלי סיום היא עסוק", publishClickDecision(
  { ...pubRow, claimed_at: new Date().toISOString() },
  Date.now(),
).kind === "busy");
check("הנפקה אינה בקשת פרסום", publishClickDecision({ ...pubRow, action: "reissue" }, Date.now()).kind === "missing");
check("טקסט של לחיצה שנייה הוא מה שנשמר", publishDecisionText(publishClickDecision(
  { ...pubRow, executed_at: new Date().toISOString(), result: "הנכס פורסם." },
  Date.now(),
)) === "הנכס פורסם.");
check("23514 חוסם פרסום", publishStoreBlocked({ code: "23514" }) && publishStoreBlocked({ code: "42P01" }));
check("מפתח כפול אינו מחסור בטבלה", publishStoreBlocked({ code: "23505" }) === false);
check("טבלה חסרה אומרת לפרסם באתר", PUBLISH_STORE_MISSING.includes("אזור האישי") && pendingStoreMissing({ code: "42P01" }));
check("confirm עם כפתורים לא מפרסם", publishWritesNow(true, true) === false);
check("בלי כפתורים confirm מפרסם", publishWritesNow(false, true) === true);
check("בלי כפתורים ובלי confirm לא מפרסם", publishWritesNow(false, false) === false);
check("ברירת מחדל שואלת לפני פרסום", publishAskFirst(undefined) && publishAskFirst(1) && publishAskFirst(null, true));
check("0 מחזיר פרסום מיידי", publishAskFirst(0) === false && publishAskFirst("0") === false);
check("יצירה שואלת נשמרת unpublished", listingStatusForCreate(true) === "unpublished");
check("יצירה בלי שאלה נשמרת active", listingStatusForCreate(false) === "active");
const exclusive = "הנכס נמצא בבלעדיות של יוסי לוי ממשרד רימקס עפולה, ולכן אי אפשר לפרסם אותו.";
const exclusiveSafe = publishErrorText(exclusive);
check("בלעדיות בלי שם של משרד אחר", exclusiveSafe === PUBLISH_EXCLUSIVE_ELSEWHERE && !exclusiveSafe.includes("יוסי") && !exclusiveSafe.includes("רימקס"));
const otherOffice = "הנכס כבר מפורסם במערכת על ידי דנה כהן ממשרד אחר. אפשר לפרסם אותו רק על סמך הסכם בלעדיות חתום.";
const otherSafe = publishErrorText(otherOffice);
check("מודעה של משרד אחר בלי שם", otherSafe === PUBLISH_DUPLICATE_ELSEWHERE && !otherSafe.includes("דנה"));
const sameOffice = "הנכס כבר מפורסם במשרד שלכם על ידי רונית (מודעה #12). אין צורך במודעה שנייה.";
const sameSafe = publishErrorText(sameOffice);
check("אותו משרד בלי שם עמית/ה", sameSafe.includes("מודעה #12") && !sameSafe.includes("רונית"));
check("עברית לא מוכרת לא עוברת", publishErrorText("שלום דנה מהמשרד השני") === PUBLISH_FAILED);
check("שגיאה באנגלית לא עוברת", publishErrorText("duplicate key value violates unique constraint") === PUBLISH_FAILED);
const longDash = String.fromCharCode(0x2014);
check("מקף ארוך בשגיאה מוחלף", !publishErrorText(`הנכס ${longDash} באוויר`).includes(longDash));

if (failed) {
  console.error(`נכשלו ${failed}`);
  process.exit(1);
}
console.log("פעולות וואטסאפ: כל הבדיקות עברו");
