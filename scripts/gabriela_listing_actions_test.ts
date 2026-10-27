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
  parseUnpublishedNudgeButton,
  listingStatusForCreate,
  pendingStoreMissing,
  PUBLISH_DUPLICATE_ELSEWHERE,
  PUBLISH_EXCLUSIVE_ELSEWHERE,
  PUBLISH_FAILED,
  PUBLISH_STORE_MISSING,
  PUBLISH_EDIT,
  PUBLISH_YES,
  PUBLISH_NO,
  publishAskFirst,
  publishClickDecision,
  publishConfirmButtons,
  UNPUB_LATER,
  UNPUB_PUBLISH,
  UNPUB_SHARE,
  unpublishedNudgeButtons,
  unpublishedNudgeButtonFresh,
  unpublishedNudgeCanPublish,
  UNPUB_BUTTON_TTL_MS,
  publishDecisionText,
  draftElsewhereMissing,
  elsewhereDraftWarning,
  publishErrorText,
  publishStoreBlocked,
  unpublishedAfterUnconfirmedPublish,
  publishWritesNow,
  PUBLISH_DESTINATIONS,
  DEST_LIST_BUTTON,
  DEST_LIST_SECTION,
  SOCIAL_QUEUE_ROWS_PER_PROPERTY,
  publishDestinationList,
  parsePublishDestination,
  destinationSameRequest,
  destinationStatusPatch,
  socialEnqueuePlan,
  destinationReply,
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
const propertyUuid = "11111111-1111-4111-8111-111111111111";
const pubButtons = publishConfirmButtons(pubId, propertyUuid);
check("כפתורי פרסום", !!pubButtons
  && pubButtons.length === 3
  && pubButtons[0].id === `pubx:y:${pubId}:${propertyUuid}`
  && pubButtons[0].title === PUBLISH_YES
  && pubButtons[1].title === PUBLISH_NO
  && pubButtons[2].title === PUBLISH_EDIT
  && pubButtons[2].id === `pubx:e:${pubId}:${propertyUuid}`);
check("כותרת הפרסום בתוך 20", [PUBLISH_YES, PUBLISH_NO, PUBLISH_EDIT].every((t) =>
  [...t].reduce((n, ch) => n + (ch.codePointAt(0)! > 0xffff ? 2 : 1), 0) <= 20));
check("פרסור פרסום", parsePublishButton(`pubx:y:${pubId}:${propertyUuid}`)?.action === "yes"
  && parsePublishButton(`pubx:n:${pubId}`)?.action === "no"
  && parsePublishButton(`pubx:e:${pubId}:${propertyUuid}`)?.propertyId === propertyUuid);
check("כפתור ישן בלי מזהה נכס", parsePublishButton(`pubx:y:${pubId}`)?.action === "yes"
  && parsePublishButton(`pubx:y:${pubId}`)?.propertyId === null);
check("הנפקה אינה פרסום", parsePublishButton("agrx:y:abc123def456") === null);
const unpubButtons = unpublishedNudgeButtons(propertyUuid);
check("שלושה כפתורים לנכס שלא באוויר", !!unpubButtons && unpubButtons.length === 3
  && unpubButtons[0].title === UNPUB_PUBLISH
  && unpubButtons[1].title === UNPUB_SHARE
  && unpubButtons[2].title === UNPUB_LATER
  && unpubButtons[0].id === `unpub:p:${propertyUuid}`
  && unpubButtons[1].id === `unpub:s:${propertyUuid}`
  && unpubButtons[2].id === `unpub:n:${propertyUuid}`
  && unpubButtons.every((b) => b.title.length <= 20 && b.id.length <= 200));
check("פרסור תזכורת", parseUnpublishedNudgeButton(`unpub:p:${propertyUuid}`)?.action === "publish"
  && parseUnpublishedNudgeButton(`unpub:s:${propertyUuid.toUpperCase()}`)?.action === "share"
  && parseUnpublishedNudgeButton(`unpub:n:${propertyUuid}`)?.action === "snooze"
  && parseUnpublishedNudgeButton(`unpub:m:${propertyUuid}`)?.action === "mute"
  && parseUnpublishedNudgeButton(`unpub:p:${propertyUuid}`)?.propertyId === propertyUuid);
check("פרסום אינו תזכורת", parseUnpublishedNudgeButton(`pubx:y:${pubId}:${propertyUuid}`) === null);
check("בלי מזהה נכס אין כפתורי תזכורת", unpublishedNudgeButtons("לא-מזהה") === null);
check("פרסום מהכפתור רק לטיוטה", unpublishedNudgeCanPublish("unpublished") && unpublishedNudgeCanPublish("draft") && !unpublishedNudgeCanPublish("sold") && !unpublishedNudgeCanPublish("archived") && !unpublishedNudgeCanPublish("rented") && !unpublishedNudgeCanPublish("active"));
const freshAt = new Date(Date.now() - 60 * 1000).toISOString();
const staleAt = new Date(Date.now() - UNPUB_BUTTON_TTL_MS - 60 * 1000).toISOString();
check("כפתור תזכורת טרי", unpublishedNudgeButtonFresh(freshAt, Date.now()));
check("כפתור תזכורת ישן לא מפרסם", unpublishedNudgeButtonFresh(staleAt, Date.now()) === false);
check("בלי תאריך הכפתור לא מפרסם", unpublishedNudgeButtonFresh(null, Date.now()) === false);
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
const elsewhere = elsewhereDraftWarning("duplicate_elsewhere");
check("טיוטה מול משרד אחר בלי שם", !!elsewhere && elsewhere.includes("הטיוטה נשמרה") && !elsewhere.includes("דנה"));
check("בלעדיות בטיוטה בלי שם", (elsewhereDraftWarning("exclusive_elsewhere") || "").includes("בלעדיות") && !(elsewhereDraftWarning("exclusive_elsewhere") || "").includes("יוסי"));
check("אותו משרד בטיוטה בלי שם עמית/ה", (elsewhereDraftWarning("duplicate_same_agency") || "").includes("הטיוטה נשמרה"));
check("clear אינו אזהרה", elsewhereDraftWarning("clear") === null && elsewhereDraftWarning("unknown") === null && elsewhereDraftWarning(null) === null);
check("פונקציית אזהרה חסרה אינה כשל יצירה", draftElsewhereMissing({ code: "42883" }) && draftElsewhereMissing({ code: "PGRST202" }) && draftElsewhereMissing({ code: "42P01" }) === false);
check("כפתור שפג משאיר unpublished", unpublishedAfterUnconfirmedPublish("expired") === "unpublished" && unpublishedAfterUnconfirmedPublish("no") === "unpublished" && unpublishedAfterUnconfirmedPublish("edit") === "unpublished");

function utf16(s: string): number {
  return [...s].reduce((n, ch) => n + (ch.codePointAt(0)! > 0xffff ? 2 : 1), 0);
}
const destList = publishDestinationList(pubId, propertyUuid);
const destRows = destList?.rows || [];
check("רשימת יעד", !!destList
  && destList.button === DEST_LIST_BUTTON
  && destList.section === DEST_LIST_SECTION
  && destRows.length === PUBLISH_DESTINATIONS.length
  && destRows.length === 6);
check("מגבלות רשימה", utf16(DEST_LIST_BUTTON) <= 20
  && utf16(DEST_LIST_SECTION) <= 24
  && destRows.every((row) => row.id.length <= 200 && utf16(row.title) <= 24 && utf16(row.description) <= 72));
check("מזהה שורה נושא נכס ובקשה", destRows.every((row) =>
  row.id === `dst:${parsePublishDestination(row.id)?.code}:${pubId}:${propertyUuid}`));
check("כל יעד חוזר מהמזהה", PUBLISH_DESTINATIONS.every((row) => {
  const id = `dst:${row.code}:${pubId}:${propertyUuid}`;
  const parsed = parsePublishDestination(id);
  return !!parsed
    && parsed.code === row.code
    && parsed.edit === row.edit
    && parsed.channels.join(",") === row.channels.join(",")
    && parsed.propertyId === propertyUuid
    && parsed.requestId === pubId;
}));
check("כפתור ישן אינו יעד", parsePublishDestination(`pubx:y:${pubId}:${propertyUuid}`) === null);
check("יעד בלי נכס נופל", publishDestinationList(pubId, "not-a-uuid") === null);
const siteSocial = destRows.find((row) => row.title === "אתר + רשתות");
const saveOnly = destRows.find((row) => row.title === "רק לשמור במאגר");
check("שתי שורות של אותה בקשה", !!siteSocial && !!saveOnly
  && destinationSameRequest(siteSocial.id, saveOnly.id));
check("בקשה אחרת אינה אותה לחיצה", !destinationSameRequest(
  siteSocial?.id || "",
  `dst:a:${"ab".repeat(6)}:${propertyUuid}`,
));
check("נכס אחר אינו אותה לחיצה", !destinationSameRequest(
  siteSocial?.id || "",
  `dst:as:${pubId}:22222222-2222-4222-8222-222222222222`,
));
check("לחיצה שנייה על אותה בקשה לא רצה", publishClickDecision(
  { ...pubRow, id: pubId, executed_at: new Date().toISOString(), result: "הנכס באתר." },
  Date.now(),
).kind === "done");
check("מאגר מוריד נכס שבאוויר", destinationStatusPatch(["save"], "active") === "unpublished");
check("אתר מעלה טיוטה", destinationStatusPatch(["site", "social"], "unpublished") === "active"
  && destinationStatusPatch(["site"], "draft") === "active");
check("מאגר על טיוטה לא משנה סטטוס", destinationStatusPatch(["save"], "unpublished") === null);
check("נמכר לא זז", destinationStatusPatch(["site"], "sold") === null
  && destinationStatusPatch(["save"], "archived") === null);
check("בלי רשתות אין תור", socialEnqueuePlan(["site"], true, true) === "skip");
check("דגל כבוי רק רושם", socialEnqueuePlan(["site", "social"], false, true) === "record");
check("נכס שלא באוויר רק רושם", socialEnqueuePlan(["social"], true, false) === "record");
check("דגל דלוק ונכס באוויר נכנס לתור", socialEnqueuePlan(["site", "social", "brokers"], true, true) === "queue");
check("לכל נכס שתי שורות תור", SOCIAL_QUEUE_ROWS_PER_PROPERTY === 2);
const queued = destinationReply({
  channels: ["site", "social", "brokers"],
  status: "active",
  licenseHeld: false,
  social: "queue",
  brokersSent: true,
});
const recorded = destinationReply({
  channels: ["site", "brokers"],
  status: "active",
  licenseHeld: false,
  social: "skip",
  brokersSent: false,
});
const saved = destinationReply({
  channels: ["save"],
  status: "unpublished",
  licenseHeld: false,
  social: "skip",
  brokersSent: false,
});
check("תשובת תור בלי מקף ארוך ובלי שם", !queued.includes(longDash)
  && !queued.includes("תומר")
  && !queued.includes("יצחק")
  && queued.includes("תור")
  && queued.includes("תקרה")
  && queued.includes("בלי מספר טלפון"));
check("שת״פ שנרשם אומר תקרה ובלי טלפון", recorded.includes("תקרה") && recorded.includes("בלי מספר טלפון"));
check("רק מאגר לא מפרסם", saved.includes("נשמר במאגר") && saved.includes("לא פורסם"));

if (failed) {
  console.error(`נכשלו ${failed}`);
  process.exit(1);
}
console.log("פעולות וואטסאפ: כל הבדיקות עברו");
