// סיורי מיניסייט: שם מתמלול, שעה, הקשר תשובה, והמיגרציה.
// בלי Deno ובלי מסד - node --experimental-strip-types.

import { readFileSync } from "node:fs";
import {
  CANCEL_NOTIFY_BUTTON_TITLE,
  CANCEL_SEARCH_FUTURE_MS,
  CANCEL_SEARCH_LIMIT,
  CANCEL_SEARCH_PAST_MS,
  cancelSearchBounds,
  clipWhatsappBody,
  clientNameMatches,
  showingCloseNotifyButton,
  extractClock,
  ilClock,
  notifiedRequestIds,
  pickShowings,
} from "../supabase/functions/whatsapp-webhook/showing-match.ts";
import {
  inboundReplyId,
  recentPushesNote,
  replyPrefix,
} from "../supabase/functions/whatsapp-webhook/wa-reply-context.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

assert(clientNameMatches("שיר הקץ", "שירה קאץ"), "transcription name");
assert(clientNameMatches("דנה", "דנה לוי"), "exact token via fuzzy");
assert(!clientNameMatches("רונית כהן", "שירה קאץ"), "unrelated names");
assert(extractClock("סיור ב-18:00") === "18:00", "clock");
assert(extractClock("אין שעה כאן") === null, "no clock");

// 27.10.2026 הוא אחרי המעבר לשעון חורף בישראל (UTC+2).
const at18 = "2026-10-27T16:00:00.000Z";
const at09 = "2026-10-27T07:00:00.000Z";
assert(ilClock(at18) === "18:00", `18:00 got ${ilClock(at18)}`);
assert(ilClock(at09) === "09:00", `09:00 got ${ilClock(at09)}`);

const rows = [
  { client_name: "שירה קאץ", starts_at: at18 },
  { client_name: "שירה קאץ", starts_at: at09 },
  { client_name: "דנה לוי", starts_at: at18 },
];
const picked = pickShowings(rows, "שיר הקץ ב-18:00", null);
assert(picked.length === 1 && picked[0].starts_at === at18, "pick name and clock");
const morning = pickShowings(rows, "שיר הקץ", "09:00");
assert(morning.length === 1 && morning[0].starts_at === at09, "explicit 09:00");
assert(pickShowings(rows, "", "18:00").length === 2, "clock only");

assert(inboundReplyId({ context: { id: "wamid.1", forwarded: true } }) === null, "forward is not a reply");
assert(inboundReplyId({ context: { id: "wamid.1", frequently_forwarded: true } }) === null, "frequent forward");
assert(inboundReplyId({ context: { id: "wamid.1" } }) === "wamid.1", "reply id");
assert(inboundReplyId({}) === null, "no context");

const prefix = replyPrefix({ title: "לפני הסיור", body: "18:00 עם לקוחה" });
assert(prefix.startsWith("[הסוכן/ת משיב/ה על הודעה שנשלחה:"), prefix);
assert(prefix.includes("לפני הסיור"), prefix);
assert(!prefix.includes("\u2014") && !prefix.includes("\u2013"), "prefix dash");
assert(replyPrefix(null) === "", "empty prefix");

const note = recentPushesNote([{ at: "27.10, 18:00", text: "סיור עם לקוחה" }]);
assert(note.includes("סיור עם לקוחה"), note);
assert(note.includes("שעתיים האחרונות"), note);
assert(!note.includes("\u2014") && !note.includes("\u2013"), "note dash");
assert(recentPushesNote([]) === "", "empty note");

assert(CANCEL_NOTIFY_BUTTON_TITLE.length > 0 && CANCEL_NOTIFY_BUTTON_TITLE.length <= 20,
  `button title length ${CANCEL_NOTIFY_BUTTON_TITLE.length}`);
assert(!CANCEL_NOTIFY_BUTTON_TITLE.includes("\u2014"), "button dash");

const cleared = notifiedRequestIds([
  { id: "sent-1", sent: true },
  { id: "no-phone", sent: false },
  { id: "no-window", sent: false },
  { id: "", sent: true },
]);
assert(cleared.length === 1 && cleared[0] === "sent-1", `clear only sent, got ${cleared.join(",")}`);

const sql = readFileSync(
  new URL("../supabase/migrations/20271028100000_gabriela_showings.sql", import.meta.url),
  "utf8",
);
assert(
  sql.includes("status in ('pending', 'sending', 'sent', 'postpone', 'confirmed')"),
  "non-final statuses",
);
assert(sql.includes("related_showcase_id"), "related showcase");
assert(sql.includes("s.status = 'active'"), "active showcase");
assert(sql.includes("cancel_unnotified"), "flag column");
assert(sql.includes("client_showcases_cancel_future_meetings"), "future meetings trigger");
assert(sql.includes("related_meeting_id"), "meeting on the notification");
assert(sql.includes("'סיור בוטל'"), "agent title, not a client message");
assert(
  sql.includes("עדכון למי שכבר קיבל בקשה נעשה רק אחרי אישור, מכרטיס הלקוח")
    && !sql.includes("הכפתור שולח"),
  "template copy does not mention a missing button",
);
assert(sql.includes("insert into public.notifications"), "agent is notified");
assert(!sql.includes("net.http_post"), "trigger does not call out");
assert(sql.includes("'meeting_id',    n.related_meeting_id"), "claim carries the meeting");

const bounds = cancelSearchBounds(Date.parse("2026-10-27T12:00:00.000Z"));
assert(Date.parse(bounds.toIso) - Date.parse(bounds.fromIso) === CANCEL_SEARCH_PAST_MS + CANCEL_SEARCH_FUTURE_MS, "window");
assert(CANCEL_SEARCH_LIMIT > 40, "name search is wider than the old cap");
const meet = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const btn = showingCloseNotifyButton([{ type: "showcase_meeting", title: "סיור בוטל עם דנה", meeting_id: meet }]);
assert(btn?.id === `scn:${meet}` && btn.title.length <= 20, "scn button");
assert(showingCloseNotifyButton([
  { type: "showcase_meeting", title: "סיור בוטל", meeting_id: meet },
  { type: "showcase_meeting", title: "סיור בוטל", meeting_id: meet },
]) === null, "two meetings, no single button");
assert(showingCloseNotifyButton([{ type: "new_lead", title: "סיור בוטל", meeting_id: meet }]) === null, "wrong type");
const long = "https://shuknadlan.co.il/crm?goto=accClients&client=" + "x".repeat(2000);
const clipped = clipWhatsappBody(`שורה\n${long}`, 80);
assert(clipped.length <= 80 && !clipped.includes("https://shuknadlan.co.il/crm?goto=accClients&client=x"), clipped);
assert(!sql.includes("5604fa17"), "no data cleanup of the meeting already handled");
assert(!/update\s+[\s\S]{0,40}5604fa17/i.test(sql), "no update of that meeting");

console.log("gabriela showings tests ok");
