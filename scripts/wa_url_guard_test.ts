// כלל 30.10.2026: גוף וואטסאפ בלי כתובת גלויה. הכפתור נבנה מהכתובת.
//
//   node --experimental-strip-types scripts/wa_url_guard_test.ts

import {
  buttonLabelForUrl,
  countBeforeFollowups,
  deliverWaPayloads,
  flushWaDropLog,
  followupKinds,
  outboxRetry,
  MAX_WA_MESSAGES,
  payloadsForText,
  planWaText,
  selectBurstFollowups,
  sendOutboxItem,
  setWaDropLogger,
  WA_EMPTY_BODY,
  WA_NO_BUTTON,
  WaBodyNotSentError,
  type OutboxLogRow,
  type WaPlannedLink,
} from "../supabase/functions/_shared/wa-url-guard.ts";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`ok  ${name}`);
  else {
    failed++;
    console.log(`FAIL  ${name}`, detail === undefined ? "" : detail);
  }
}

const clean = planWaText("שלום, הנכס מחכה.");
check("בלי כתובת לא נוגעים", !clean.stripped && clean.text === "שלום, הנכס מחכה." && clean.links.length === 0);

const one = planWaText("לפרטים: https://shuknadlan.co.il/crm?goto=accLeads");
check("כתובת אחת יוצאת מהגוף", one.stripped && !one.text.includes("http") && one.links.length === 1);
check("כפתור CRM", one.links[0]?.label === "פתיחה ב-CRM" && one.links[0]?.kind === "cta");
check("המשפט נשאר", one.text.startsWith("לפרטים"));

const several = planWaText(
  "דף הנכס https://shuknadlan.co.il/property?id=abc וגם https://shuknadlan.co.il/pricing",
);
check("שתי כתובות", several.links.length === 2 && !several.text.includes("http"));
check("תוויות שונות", several.links.map((l) => l.label).join(",") === "לדף הנכס,למסלולים");

const dup = planWaText("https://shuknadlan.co.il/pricing https://shuknadlan.co.il/pricing");
check("כפילות נספרת פעם", dup.links.length === 1);

const wa = planWaText("אפשר גם לכתוב ישירות.\nwa.me/972501234567");
check("wa.me בלי סכמה", wa.links[0]?.url === "https://wa.me/972501234567" && wa.links[0]?.label === "שליחת הודעה");
check("המספר לא בגוף", !wa.text.includes("972") && !wa.text.includes("wa.me"));

const video = planWaText("הסרטון: https://abc.supabase.co/storage/v1/object/public/v/clip.mp4");
check("mp4 הוא מדיה", video.links[0]?.kind === "video" && !video.text.includes("http"));

const home = planWaText("האתר: https://shuknadlan.co.il/");
check("שורש האתר", home.links[0]?.label === "לאתר");

const payloads = payloadsForText("972500000000", several.text.includes("http") ? "" : 
  "דף https://shuknadlan.co.il/property?id=abc\nhttps://shuknadlan.co.il/pricing\nhttps://shuknadlan.co.il/sign?t=1");
check("כפתור אחד בהודעה הראשונה", payloads.payloads[0]?.type === "interactive");
check("שלושה יעדים הם שלוש הודעות", payloads.payloads.length === 3);
check("גוף בלי כתובת", JSON.stringify(payloads.payloads).includes("https://") 
  ? (payloads.payloads as { type: string; interactive?: { body?: { text?: string } }; text?: { body?: string } }[])
      .every((p) => {
        const body = p.interactive?.body?.text || p.text?.body || "";
        return !body.includes("http") && !body.includes("wa.me");
      })
  : false);
const first = payloads.payloads[0] as { interactive: { body: { text: string }; action: { parameters: { display_text: string; url?: string } } } };
const second = payloads.payloads[1] as { interactive: { body: { text: string }; action: { parameters: { display_text: string } } } };
const third = payloads.payloads[2] as { interactive: { action: { parameters: { display_text: string } } } };
check("כל יעד בכפתור משלו", second.interactive.action.parameters.display_text === "למסלולים"
  && third.interactive.action.parameters.display_text === "לחתימה");
check("כותרת בתוך 20", Array.from(first.interactive.action.parameters.display_text).length <= 20);

const two = payloadsForText("972500000000", "דף https://shuknadlan.co.il/property?id=abc\nhttps://shuknadlan.co.il/pricing");
const twoSecond = two.payloads[1] as { interactive: { body: { text: string }; action: { parameters: { display_text: string } } } };
check("המשך של יעד אחד הוא שם היעד", two.payloads.length === 2 && twoSecond.interactive.body.text === "למסלולים" && twoSecond.interactive.action.parameters.display_text === "למסלולים");

const tooMany = planWaText(Array.from({ length: 8 }, (_, i) => `https://shuknadlan.co.il/property?id=${i}`).join("\n"));
const capped = payloadsForText("972500000000", tooMany.text + "\n" + Array.from({ length: 8 }, (_, i) => `https://shuknadlan.co.il/crm?goto=accProperties&property=${i}`).join(" "));
check("תקרה של שלוש הודעות", capped.payloads.length === MAX_WA_MESSAGES);

const empty = planWaText("https://shuknadlan.co.il/agreement?t=1");
check("גוף ריק מקבל משפט", empty.text === WA_EMPTY_BODY && empty.links[0]?.label === "להסכם");

check("הרשמה אינה חתימה", buttonLabelForUrl("https://shuknadlan.co.il/signup") === "להצטרפות");
check("agency-signup אינה משרד ואינה חתימה", buttonLabelForUrl("https://shuknadlan.co.il/agency-signup") === "להצטרפות");
check("חתימה נשארת חתימה", buttonLabelForUrl("https://shuknadlan.co.il/sign?t=abc") === "לחתימה");
check("תווית פגישה", buttonLabelForUrl("https://shuknadlan.co.il/meeting?t=abc") === "לפגישה");
check("תווית מיניסייט", buttonLabelForUrl("https://shuknadlan.co.il/showcase?t=abc") === "לעמוד האישי");
check("קישור קצר לנכס", buttonLabelForUrl("https://shuknadlan.co.il/p/1147") === "לדף הנכס");
check("קישור קצר למיניסייט", buttonLabelForUrl("https://shuknadlan.co.il/m/ab") === "לעמוד האישי");
check("תווית הסרה", buttonLabelForUrl("https://example.com/saved-search-manage?action=unsubscribe&token=1") === "הפסקת עדכונים");
check("משפט בלי כפתור", WA_NO_BUTTON === "פרטים ב-CRM" && !WA_NO_BUTTON.includes("http"));

const long = `${"א".repeat(1100)} https://shuknadlan.co.il/property?id=abc`;
const split = payloadsForText("972500000000", long);
check("גוף ארוך יוצא כטקסט ואז כפתור", split.payloads.length === 2
  && (split.payloads[0] as { type?: string }).type === "text"
  && (split.payloads[1] as { type?: string }).type === "interactive");
const longBody = (split.payloads[0] as { text: { body: string } }).text.body;
check("הטקסט הארוך לא נחתך ל-1024", longBody.length > 1024 && !longBody.includes("http"));
check("הכפתור שאחריו קצר", (split.payloads[1] as { interactive: { body: { text: string } } }).interactive.body.text === "לדף הנכס");

const withButton = payloadsForText(
  "972500000000",
  "הסרטון https://cdn.example.com/a.mp4 והדף https://shuknadlan.co.il/property?id=abc",
);
check("טקסט ואז וידאו ואז כפתור", withButton.payloads.map((p) => (p as { type?: string }).type).join(",") === "text,video,interactive"
  && payloadBody(withButton.payloads[0]).includes("הסרטון"));

const longVideo = payloadsForText(
  "972500000000",
  `${"א".repeat(1500)} https://cdn.example.com/a.mp4 https://shuknadlan.co.il/property?id=abc https://shuknadlan.co.il/pricing`,
);
const longTypes = longVideo.payloads.map((p) => (p as { type?: string }).type);
const longButton = longVideo.payloads[2] as { interactive?: { body?: { text?: string }; action?: { parameters?: { url?: string; display_text?: string } } } };
check("גוף ארוך עם וידאו יוצא כטקסט קודם", longTypes.join(",") === "text,video,interactive"
  && longVideo.dropped === 1
  && longVideo.payloads.length === MAX_WA_MESSAGES
  && (longVideo.payloads[0] as { text: { body: string } }).text.body.length > 1024);
check("הכפתור הוא היעד הראשון ולא דף הבית", longButton.interactive?.action?.parameters?.display_text === "לדף הנכס"
  && String(longButton.interactive?.action?.parameters?.url || "").includes("/property")
  && longButton.interactive?.body?.text === "לדף הנכס");

function payloadBody(payload: Record<string, unknown>): string {
  if (payload.type === "text") return String((payload.text as { body?: string } | undefined)?.body || "");
  const interactive = payload.interactive as { body?: { text?: string } } | undefined;
  return String(interactive?.body?.text || "");
}

async function deliverMock(
  payloads: Record<string, unknown>[],
  fail: (payload: Record<string, unknown>, posted: { type: string; body: string }[]) => boolean,
) {
  const posted: { type: string; body: string; id: string }[] = [];
  let n = 0;
  const id = await deliverWaPayloads(payloads, async (payload) => {
    if (fail(payload, posted)) throw new Error("meta 400");
    n++;
    const sent = { type: String(payload.type), body: payloadBody(payload), id: `wamid.${n}` };
    posted.push(sent);
    return sent.id;
  }, () => ({ type: "text", text: { body: "FALLBACK" } }));
  return { id, posted };
}

const twoLinks = payloadsForText(
  "972500000000",
  "שלום https://shuknadlan.co.il/property?id=a https://shuknadlan.co.il/pricing",
);
const continued = await deliverMock(twoLinks.payloads, (payload, posted) =>
  payload.type === "interactive" && posted.some((part) => part.type === "interactive"));
check("כפתור המשך שנדחה לא שולח את הגוף שוב",
  continued.posted.filter((part) => part.body.includes("שלום")).length === 1
  && !continued.posted.some((part) => part.type === "text")
  && continued.id === continued.posted[0]?.id);

const longOnly = payloadsForText("972500000000", `${"א".repeat(1500)} https://shuknadlan.co.il/property?id=a`);
const longRejected = await deliverMock(longOnly.payloads, (payload) => payload.type === "interactive");
check("טקסט ארוך לא יוצא פעמיים כשהכפתור נדחה",
  longRejected.posted.filter((part) => part.type === "text" && part.body.length > 1024).length === 1
  && longRejected.id === longRejected.posted[0]?.id);

const longAndVideo = payloadsForText(
  "972500000000",
  `${"א".repeat(1500)} https://cdn.example.com/a.mp4 https://shuknadlan.co.il/property?id=a`,
);
const longVideoRejected = await deliverMock(longAndVideo.payloads, (payload) => payload.type === "interactive");
check("טקסט ארוך עם וידאו לא יוצא פעמיים",
  longVideoRejected.posted.filter((part) => part.type === "text" && part.body.length > 1024).length === 1
  && longVideoRejected.posted.some((part) => part.type === "video")
  && longVideoRejected.id === longVideoRejected.posted[0]?.id);

const withVideo = payloadsForText(
  "972500000000",
  "שלום https://cdn.example.com/a.mp4 https://shuknadlan.co.il/property?id=a",
);
check("גוף קצר עם וידאו יוצא כטקסט קודם",
  withVideo.payloads.map((p) => (p as { type?: string }).type).join(",") === "text,video,interactive"
  && payloadBody(withVideo.payloads[0]) === "שלום");
const buttonRejected = await deliverMock(withVideo.payloads, (payload) => payload.type === "interactive");
check("כפתור אחרי וידאו שנדחה משאיר את הטקסט",
  buttonRejected.posted.filter((part) => part.type === "text" && part.body === "שלום").length === 1
  && buttonRejected.posted.some((part) => part.type === "video")
  && buttonRejected.id === buttonRejected.posted[0]?.id);
const videoFailed = await deliverMock(withVideo.payloads, (payload) => payload.type === "video");
check("וידאו שנכשל לא מונע טקסט וכפתור",
  videoFailed.posted.some((part) => part.type === "text" && part.body === "שלום")
  && videoFailed.posted.some((part) => part.type === "interactive")
  && videoFailed.id === videoFailed.posted[0]?.id);
let nothingSent = false;
try {
  await deliverMock(withVideo.payloads, () => true);
} catch {
  nothingSent = true;
}
check("אם לא יצא כלום נזרקת שגיאה", nothingSent);

check("כפתורים בלי יעד CRM לא שולחים את הגוף שוב", outboxRetry(true, false) === "note");
check("רשימה עם יעד CRM אחרי שהטקסט יצא היא כפתור בלי הגוף", outboxRetry(true, true) === "crm-short");
check("רשימה עם יעד CRM לפני שהטקסט יצא נושאת את הגוף", outboxRetry(false, true) === "crm-body");

let bodyLost = false;
try {
  let interactiveSeen = 0;
  await deliverWaPayloads(twoLinks.payloads, async (payload) => {
    if (payload.type === "text") throw new Error("fallback");
    if (payload.type === "interactive" && interactiveSeen++ === 0) throw new Error("first button");
    return "wamid.second";
  }, () => ({ type: "text", text: { body: "FALLBACK" } }), "שלום");
} catch {
  bodyLost = true;
}
check("כפתור ראשון והנפילה נדחו: הגוף לא יצא", bodyLost);

const longProbe = `${"ב".repeat(1500)} https://shuknadlan.co.il/property?id=z`;
const longPlan = payloadsForText("972500000000", longProbe);
let longLost = false;
try {
  await deliverWaPayloads(longPlan.payloads, async (payload) => {
    if (payload.type !== "interactive") throw new Error("text");
    return "wamid.button";
  }, () => ({ type: "text", text: { body: "FALLBACK" } }), longPlan.visibleText);
} catch {
  longLost = true;
}
check("טקסט ארוך והנפילה נדחו: לא מדווחים הצלחה", longLost);

let posts = 0;
try {
  await deliverWaPayloads(withVideo.payloads, async () => {
    posts++;
    throw new Error("no");
  }, () => {
    posts++;
    throw new Error("fb");
  }, "שלום");
} catch { /* expected */ }
check("נפילה לטקסט פעם אחת", posts === 4);

const videoPayloads = payloadsForText("972500000000", "מוכן https://cdn.example.com/a.mp4");
check("וידאו לא כפתור", videoPayloads.payloads.length === 2
  && videoPayloads.payloads.some((p) => (p as { type?: string }).type === "video")
  && videoPayloads.payloads.every((p) => (p as { type?: string }).type !== "interactive"));

const burstText = "יש נכס https://cdn.example.com/a.mp4 https://shuknadlan.co.il/property?id=a https://shuknadlan.co.il/pricing https://shuknadlan.co.il/sign?t=1";
const burst = payloadsForText("972500000000", burstText);
check("טקסט ווידאו ושלושה קישורים הן שלוש הודעות",
  burst.payloads.map((p) => (p as { type?: string }).type).join(",") === "text,video,interactive"
  && burst.payloads.length === 3
  && burst.dropped === 2
  && payloadBody(burst.payloads[0]).includes("יש נכס"));

const droppedRows: { wa_phone: string; body: string; error: string }[] = [];
setWaDropLogger(async (row) => { droppedRows.push(row); });
const burstLogged = payloadsForText("972500000001", burstText);
await flushWaDropLog();
setWaDropLogger(null);
check("קישור שנזרק נרשם ביומן",
  burstLogged.dropped === 2
  && droppedRows.length === 1
  && droppedRows[0].wa_phone === "972500000001"
  && droppedRows[0].error.includes("dropped")
  && droppedRows[0].body.includes("למסלולים")
  && !droppedRows[0].body.includes("http"));

const longButtonsBody = `${"ג".repeat(1500)} https://cdn.example.com/a.mp4 https://shuknadlan.co.il/property?id=a https://shuknadlan.co.il/pricing`;
const longButtonsPlan = planWaText(longButtonsBody);
const longButtonsAlready = countBeforeFollowups(longButtonsPlan.text);
const longButtonsFollow = selectBurstFollowups(longButtonsAlready, longButtonsPlan.links);
check("sendButtons ארוך: טקסט, כפתור, ואז וידאו בלי קישור מעבר למכסה",
  longButtonsAlready === 2
  && followupKinds(longButtonsFollow).join(",") === "video"
  && longButtonsFollow.ctas.length === 0
  && longButtonsFollow.dropped.filter((link) => link.kind === "cta").length === 2);

const cardBody = "דירה יפה https://shuknadlan.co.il/pricing https://shuknadlan.co.il/sign?t=1 https://shuknadlan.co.il/crm";
const cardPlan = planWaText(cardBody);
const cardAlready = countBeforeFollowups(cardPlan.text);
const cardFollow = selectBurstFollowups(cardAlready, cardPlan.links, "https://shuknadlan.co.il/property?id=1");
check("כרטיס תמונה נספר עם הכפתור שלו ונשארים שני קישורים",
  cardAlready === 1
  && cardFollow.ctas.length === 2
  && cardFollow.dropped.length === 1
  && !cardFollow.video
  && followupKinds(cardFollow).join(",") === "interactive,interactive");

const shortVideoLinks: WaPlannedLink[] = [
  { url: "https://cdn.example.com/a.mp4", label: "", kind: "video" },
  { url: "https://shuknadlan.co.il/property?id=a", label: "לדף הנכס", kind: "cta" },
  { url: "https://shuknadlan.co.il/pricing", label: "למסלולים", kind: "cta" },
];
const shortFollow = selectBurstFollowups(countBeforeFollowups("שלום"), shortVideoLinks);
check("sendButtons קצר: וידאו לפני קישור אחד",
  followupKinds(shortFollow).join(",") === "video,interactive"
  && shortFollow.dropped.length === 1);

type SentCall = { body: string; label?: string; reply?: string };
async function runOutbox(opts: {
  kind?: "list" | "buttons";
  body: string;
  rows?: { id: string; title: string }[];
  listThrows?: boolean;
  crmThrows?: boolean;
  textFirst?: boolean;
}) {
  const logs: OutboxLogRow[] = [];
  const calls: SentCall[] = [];
  const rows = opts.rows || [];
  await sendOutboxItem({
    kind: opts.kind || "list",
    body: opts.body,
    button: "בחירה",
    section: "לאן",
    rows,
    buttons: [{ id: "yes", title: "כן" }],
    label: "פתיחה",
    url: "https://shuknadlan.co.il/crm",
  } as Parameters<typeof sendOutboxItem>[0], {
    sendCtaUrl: async (body, label) => {
      calls.push({ body, label });
      if (opts.crmThrows) throw new Error("crm rejected");
      return "wamid.crm";
    },
    sendList: async (body, _button, _section, _rows, parts) => {
      if (opts.textFirst) {
        parts.push({ id: "wamid.text", kind: "text", body });
        return "wamid.text";
      }
      if (opts.listThrows) throw new Error("list rejected");
      parts.push({ id: "wamid.list", kind: "interactive", body });
      return "wamid.list";
    },
    sendButtons: async (body, _buttons, parts) => {
      if (opts.textFirst) {
        parts.push({ id: "wamid.text", kind: "text", body });
        return "wamid.text";
      }
      throw new Error("buttons rejected");
    },
    reply: async (text) => { calls.push({ body: text, reply: text }); },
    log: async (row) => { logs.push(row); },
    crmUrl: (id) => id.startsWith("nav:") ? `https://shuknadlan.co.il${id.slice(4)}` : null,
  });
  return { logs, calls };
}

const crmRows = [
  { id: "nav:/crm?goto=accProperties", title: "הכול" },
  { id: "nav:/crm?goto=accLeads", title: "לידים" },
];
const shortList = await runOutbox({ body: "בחרו", rows: crmRows, listThrows: true });
const crmCall = shortList.calls.find((call) => call.label === "פתיחה ב-CRM");
check("רשימה קצרה שנדחתה: כפתור ה-CRM נושא את הגוף",
  crmCall?.body === "בחרו"
  && !shortList.calls.some((call) => call.reply)
  && shortList.logs.some((row) => row.error === "list rejected")
  && shortList.logs.some((row) => row.body === "בחרו" && row.status === "sent"));

const bothRejected = await runOutbox({ body: "בחרו", rows: crmRows, listThrows: true, crmThrows: true });
check("גם כפתור ה-CRM נדחה: השגיאה נרשמת ויוצא טקסט עם הגוף",
  bothRejected.logs.some((row) => row.error === "list rejected")
  && bothRejected.logs.some((row) => String(row.error || "").includes("crm rejected") && String(row.body || "").includes("בחרו"))
  && bothRejected.calls.some((call) => call.reply && call.reply.includes("בחרו") && call.reply.includes(WA_NO_BUTTON)));

const longButtons = await runOutbox({
  kind: "buttons",
  body: "ד".repeat(1500),
  textFirst: true,
});
check("כפתורים ארוכים בלי CRM לא שולחים את הגוף שוב",
  longButtons.calls.length === 1
  && longButtons.calls[0].reply === WA_NO_BUTTON
  && !longButtons.calls[0].reply.includes("דדד")
  && longButtons.logs.filter((row) => row.msg_type === "text" && String(row.body || "").length > 1024).length === 1);

const longList = await runOutbox({
  body: "ה".repeat(1500),
  rows: [],
  textFirst: true,
});
check("רשימה ארוכה בלי CRM לא שולחת את הגוף שוב",
  longList.calls.length === 1
  && longList.calls[0].reply === WA_NO_BUTTON
  && !String(longList.calls[0].reply).includes("ההה"));

let deliveredButton = false;
try {
  const carried = payloadsForText(
    "972500000000",
    "שלום עולם https://shuknadlan.co.il/property?id=a https://shuknadlan.co.il/pricing",
  );
  await deliverWaPayloads(carried.payloads, async (payload) => {
    const body = payloadBody(payload);
    if (body.includes("שלום")) throw new Error("body button");
    return "wamid.kept";
  }, () => { throw new Error("fallback"); }, "שלום עולם");
} catch (err) {
  deliveredButton = err instanceof WaBodyNotSentError
    && err.delivered.some((part) => part.id === "wamid.kept" && part.type === "interactive");
}
check("כפתור שנמסר אחרי שהגוף לא יצא נרשם על השגיאה", deliveredButton);

if (failed) {
  console.log(`\n${failed} בדיקות נכשלו`);
  process.exit(1);
}
console.log("\n✓ שמירת כתובות בוואטסאפ: כל הבדיקות עברו");
