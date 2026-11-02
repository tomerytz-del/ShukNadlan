// ארבעת המקרים מ-2.11.2026: שאלה שכבר נענתה, תוספות שלא התבקשו,
// תפריט על קריאה אחת, והודעה קולית בלי מילים.
// בלי מודל, בלי מסד, בלי וואטסאפ.
//
//   node --experimental-strip-types scripts/gabriela_reply_style_test.ts

import { readFileSync } from "node:fs";
import { recentPushesNote } from "../supabase/functions/whatsapp-webhook/wa-reply-context.ts";
import {
  clientOfferLine,
  isClearAnswer,
  likelyReading,
  offerAlready,
  personNameFromTitle,
  sameClockMinute,
  sameTimeConflictLine,
  settledFromHistory,
  shapeAgentReply,
  styleContext,
  type HistoryMsg,
} from "../supabase/functions/whatsapp-webhook/reply-style.ts";
import {
  extFromAudioMime,
  readWhisperBody,
  shouldRetryBare,
  VOICE_NOTE_EMPTY_REPLY,
  VOICE_NOTE_HINT,
  VOICE_NOTE_HINT_MAX_BYTES,
  whisperHintFor,
} from "../supabase/functions/_shared/whisper-read.ts";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : " - " + JSON.stringify(detail)}`);
  if (!ok) failed++;
}

const agentSrc = readFileSync(new URL("../supabase/functions/whatsapp-webhook/agent.ts", import.meta.url), "utf8");
const intakeSrc = readFileSync(new URL("../supabase/functions/whatsapp-webhook/media-intake.ts", import.meta.url), "utf8");
const indexSrc = readFileSync(new URL("../supabase/functions/whatsapp-webhook/index.ts", import.meta.url), "utf8");
const domain = "שיחת נדל״ן בין מתווך ללקוח";

// --- 1. אבירם כבר זוהה, ו"כן" הוא תשובה ---

const aviramHistory: HistoryMsg[] = [
  { role: "assistant", content: "אבירם זה אבירם כהן מקובץ הלקוחות?" },
  { role: "user", content: "הכוונה לאבירם כהן מקובץ הלקוחות" },
  { role: "assistant", content: "שייכתי את הפגישה לאבירם כהן." },
];
const settled = settledFromHistory(aviramHistory);
check("אבירם נענה", settled.some((s) => s.q.includes("אבירם כהן") && s.a.includes("הכוונה לאבירם כהן")));
check("כן הוא תשובה", isClearAnswer("כן") && isClearAnswer("כן."));
check("בקשה חדשה אינה תשובה", !isClearAnswer("תתקני, הפגישה עם עליזה היא היום בקפה קפה"));

const reask = shapeAgentReply(
  "הזזתי את הפגישה ל-11:00.\nועוד דבר אחד: אבירם זה אבירם כהן?",
  { userText: "תזיזי ל-11", history: aviramHistory },
);
check("אין שאלה חוזרת על אבירם", !reask.includes("אבירם זה") && reask.includes("11:00"), reask);

const yesTurn = styleContext(
  [{ role: "assistant", content: "אבירם זה אבירם כהן?" }],
  "כן",
);
check("כן בתור הנוכחי נסגר בהקשר", yesTurn.includes("כבר נענה") && yesTurn.includes("כן"));
check("ההוראה בפרומפט", /אין לשאול שוב[\s\S]{0,120}כן/.test(agentSrc));

// --- 2. בלי תזכורת על נושא אחר, ובלי שאלון אחרי פגישה ---

const meetingReply = [
  "קבעתי פגישה עם עליזה היום ב-16:00.",
  "שים לב: יש לך גם פגישה עם שרון ב-10:00, להזיז אחת?",
  "תזכורת: היום ב-13:00 פגישה עם חגי.",
  "להוסיף אותה לקובץ הלקוחות? תגידי קנייה, שכירות או בעלת נכס, ותשלחי טלפון.",
].join("\n");
const shaped = shapeAgentReply(meetingReply, {
  userText: "תקבעי פגישה עם עליזה היום ב-16:00",
  history: [],
});
check("נשאר האישור", shaped.includes("עליזה") && shaped.includes("16:00"), shaped);
check("בלי שרון", !shaped.includes("שרון"), shaped);
check("בלי תזכורת על חגי", !shaped.includes("תזכורת") && !shaped.includes("13:00"), shaped);
check("בלי שאלון", !shaped.includes("קנייה") && !shaped.includes("טלפון") && !shaped.includes("?"), shaped);
check("הצעה אחת בלי שאלה", shaped.includes(clientOfferLine("עליזה")), shaped);

const again = shapeAgentReply(meetingReply, {
  userText: "תקבעי עוד פגישה עם עליזה מחר ב-9",
  history: [{ role: "assistant", content: clientOfferLine("עליזה") }],
});
check("אין הצעה שנייה", !again.includes("קובץ"), again);
check("כבר הוצע", offerAlready([{ role: "assistant", content: clientOfferLine("עליזה") }], "עליזה"));

const ten = "2026-11-02T08:00:00.000Z";
const tenThirty = "2026-11-02T08:30:00.000Z";
const clash = sameTimeConflictLine("meeting", ten, [
  { id: "self", title: "פגישה עם עליזה", due_at: ten, kind: "meeting", status: "open" },
  { id: "sharon", title: "פגישה עם שרון", due_at: ten, kind: "meeting", status: "open" },
], "self");
check("התנגשות באותה דקה", clash === "באותה שעה כבר קבוע: פגישה עם שרון.", clash);
check("חצי שעה אינה אותה שעה", sameTimeConflictLine("meeting", ten, [
  { id: "sharon", title: "פגישה עם שרון", due_at: tenThirty, kind: "meeting", status: "open" },
], "self") === null);
check("משימה אינה התנגשות", sameTimeConflictLine("task", ten, [
  { id: "sharon", title: "פגישה עם שרון", due_at: ten, kind: "meeting", status: "open" },
], "self") === null);
check("אותה דקה", sameClockMinute(ten, "2026-11-02T08:00:30.000Z") && !sameClockMinute(ten, tenThirty));

const keptClash = shapeAgentReply(
  "קבעתי פגישה עם עליזה היום ב-10:00.\nבאותה שעה כבר קבוע: פגישה עם שרון.",
  { userText: "תקבעי עם עליזה ב-10", history: [] },
);
check("שורת אותה שעה נשארת", keptClash.includes("באותה שעה כבר קבוע"), keptClash);
const reminderOk = shapeAgentReply("קבעתי תזכורת למחר ב-9:00, להתקשר לרונית.", {
  userText: "תוסיפי תזכורת למחר ב-9 להתקשר לרונית",
  history: [],
});
check("אישור תזכורת שהתבקשה נשאר", reminderOk.includes("רונית") && reminderOk.includes("9:00"), reminderOk);

const pushes = recentPushesNote([{ at: "2.11, 12:00", text: "תזכורת: פגישה עם חגי ב-13:00" }]);
check("התראות אינן להזכיר שוב", pushes.includes("אין להזכיר") && pushes.includes("שעתיים האחרונות"));
check("שם מהכותרת", personNameFromTitle("פגישה עם עליזה") === "עליזה");
check("היום אינו שם", personNameFromTitle("פגישה להיום") === null);

// --- 3. עליזה בקפה קפה, לא תפריט על חגי ---

const correction = "תתקני, הפגישה עם עליזה היא היום בקפה קפה. ולא עם חגי";
const reading = likelyReading(correction) || "";
check("קריאה אחת על עליזה", reading.includes("עליזה") && reading.includes("חגי") && reading.includes("בלי תפריט"), reading);
check("ביטול מפורש אינו תיקון", likelyReading("תבטלי את הפגישה עם חגי") === null);

const menu = shapeAgentReply(
  [
    "עדכנתי: הפגישה עם עליזה היום בקפה קפה.",
    "מה לעשות עם הפגישה של חגי?",
    "1. לבטל",
    "2. להשאיר",
    "3. להזיז",
  ].join("\n"),
  { userText: correction, history: [] },
);
check("אושר המקום", menu.includes("קפה קפה") && menu.includes("עליזה"), menu);
check("בלי תפריט על חגי", !menu.includes("לבטל") && !menu.includes("חגי") && !menu.includes("?"), menu);
check("ההקשר אומר לבצע", (styleContext([], correction)).includes("בלי תפריט"));

// --- 4. הודעה קולית של 4 שניות בלי טקסט ---

const fourSeconds = 8_000;
check("קליפ קצר בלי פרומפט של שיחת לקוח", whisperHintFor({
  call: false, bytes: fourSeconds, domain, places: "עפולה",
}) === "");
check("הודעה ארוכה אינה פרומפט של שיחה", whisperHintFor({
  call: false, bytes: VOICE_NOTE_HINT_MAX_BYTES + 1, domain, places: "",
}) === VOICE_NOTE_HINT);
check("הקלטת שיחה נשארת עם אוצר המילים", whisperHintFor({
  call: true, bytes: fourSeconds, domain, places: "עפולה",
}).includes(domain) && whisperHintFor({
  call: true, bytes: fourSeconds, domain, places: "עפולה",
}).includes("עפולה"));

const fromSegments = readWhisperBody({
  duration: 4.1,
  text: "",
  segments: [{ text: " תתקני את הפגישה עם עליזה", no_speech_prob: 0.12 }],
}, domain);
check("segments ממלאים טקסט ריק", fromSegments.text === "תתקני את הפגישה עם עליזה" && !fromSegments.silent, fromSegments);

const silent = readWhisperBody({
  duration: 4,
  text: " ",
  segments: [{ text: "", no_speech_prob: 0.95 }],
}, "");
check("4 שניות בלי דיבור", silent.text === null && silent.silent && !shouldRetryBare(silent, false), silent);

const echoed = readWhisperBody({
  duration: 4.2,
  text: domain,
  segments: [{ text: domain, no_speech_prob: 0.2 }],
}, domain);
check("פרומפט שהוחזר אינו תמלול", echoed.text === null && echoed.echoed && shouldRetryBare(echoed, true), echoed);
check("שתיקה גבוהה אינה ניסיון שני", !shouldRetryBare(silent, true));

check("ogg עם codecs", extFromAudioMime("audio/ogg; codecs=opus") === "ogg");
check("תשובה קצרה בלי שאלות פתוחות",
  VOICE_NOTE_EMPTY_REPLY.includes("לשלוח שוב") &&
  !VOICE_NOTE_EMPTY_REPLY.includes("ועוד") &&
  (VOICE_NOTE_EMPTY_REPLY.match(/\?/g) || []).length === 1,
  VOICE_NOTE_EMPTY_REPLY);
check("הודעה קולית מקבלת את השורה הקצרה", intakeSrc.includes("VOICE_NOTE_EMPTY_REPLY") && intakeSrc.includes("transcription_silent"));
const failAt = indexSrc.indexOf("if (!result.ok)");
const afterFail = indexSrc.slice(failAt, failAt + 400);
check("כישלון תמלול יוצא בלי המודל", failAt > 0 && afterFail.includes("result.reply") && afterFail.includes("return"), afterFail);

// שאלה אחת נשארת כשיש שתיים אמיתיות
const oneQ = shapeAgentReply("חסר מחיר?\nואיזו קומה?", { userText: "דירה למכירה", history: [] });
check("שאלה אחת בסוף", oneQ === "ואיזו קומה?", oneQ);
check("בלי מקף ארוך בתשובה הריקה", !VOICE_NOTE_EMPTY_REPLY.includes("\u2014") && !VOICE_NOTE_EMPTY_REPLY.includes("\u2013"));
check("הפרומפט אוסר תזכורת על נושא אחר", agentSrc.includes("אין לצרף לתשובה תזכורת"));

if (failed) {
  console.error(`נכשלו ${failed}`);
  process.exit(1);
}
console.log("עבר");
