// שאלה תפעולית בוואטסאפ: אימות, מסלול חינם, חלון סגור, אידמפוטנטיות,
// ולחיצה שנרשמת ולא מגיעה למודל. בלי מסד, בלי Meta ובלי שליחה.
//   node --experimental-strip-types scripts/ops_question_test.ts

import { readFileSync } from "node:fs";
import {
  appendOpsHistory,
  customerWindowOpen,
  inboundOpsButton,
  OPS_HISTORY_NOTE,
  OPS_TAP_REPLY,
  OPS_WINDOW_MS,
  opsQuestionAuthRefusal,
  purposeOf,
  recordOpsTap,
  runOpsQuestion,
  whatsappTierAllowed,
  type OpsAgent,
  type OpsAnswer,
  type OpsClaim,
  type OpsOutbound,
  type OpsQuestionDb,
  type OpsTapDb,
} from "../supabase/functions/whatsapp-webhook/ops-question.ts";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : " - " + JSON.stringify(detail)}`);
  if (!ok) failed++;
}

const AGENT = "11111111-1111-4111-8111-111111111111";
const NOW = Date.parse("2026-10-29T12:00:00.000Z");
const OPEN_INBOUND = new Date(NOW - 60 * 60 * 1000).toISOString();
const CLOSED_INBOUND = new Date(NOW - OPS_WINDOW_MS).toISOString();

check("רק service_role", opsQuestionAuthRefusal({ ok: true, via: "service_role" }) === null);
check(
  "סוד cron אינו מספיק",
  opsQuestionAuthRefusal({ ok: true, via: "cron_secret" })?.status === 401 &&
    opsQuestionAuthRefusal({ ok: true, via: "cron_secret" })?.error === "unauthorized",
);
check(
  "בלי אימות נשמר הסטטוס",
  opsQuestionAuthRefusal({ ok: false, status: 401, error: "unauthorized", detail: "x" })?.status === 401 &&
    opsQuestionAuthRefusal({ ok: false, status: 503, error: "cron_secret_not_configured", detail: "y" })?.status === 503,
);

check("חינם לא", whatsappTierAllowed("free") === false && whatsappTierAllowed(null) === false);
check("mid ו-premium כן", whatsappTierAllowed("mid") && whatsappTierAllowed("premium"));
check("חלון פתוח בתוך 24 שעות", customerWindowOpen(OPEN_INBOUND, NOW));
check("בדיוק 24 שעות כבר סגור", customerWindowOpen(CLOSED_INBOUND, NOW) === false);
check("בלי נכנסת החלון סגור", customerWindowOpen(null, NOW) === false);

type Sent = { to: string; body: string; ids: string[] };
type Mem = {
  db: OpsQuestionDb;
  sends: Sent[];
  claims: OpsClaim[];
  outbound: OpsOutbound[];
  history: unknown[];
  status: () => string | null;
};

function memory(agent: OpsAgent | null, lastInbound: string | null): Mem {
  const sends: Sent[] = [];
  const claims: OpsClaim[] = [];
  const outbound: OpsOutbound[] = [];
  const history: unknown[] = [{ role: "assistant", content: "היי" }];
  let marked: string | null = null;
  const db: OpsQuestionDb = {
    async getAgent(id) {
      return agent && agent.id === id ? agent : null;
    },
    async lastInboundAt() {
      return lastInbound;
    },
    async claim(row) {
      if (claims.some((c) => c.agentId === row.agentId && c.purpose === row.purpose)) return "exists";
      claims.push(row);
      return "claimed";
    },
    async markSent(_agentId, _purpose, _waIds, status) {
      marked = status;
    },
    async appendHistory(_agentId, _phone, _lastInbound, assistantText) {
      const next = appendOpsHistory(history, assistantText);
      history.length = 0;
      history.push(...next);
    },
    async logOutbound(row) {
      outbound.push(row);
    },
  };
  return { db, sends, claims, outbound, history, status: () => marked };
}

function paid(tier = "mid"): OpsAgent {
  return { id: AGENT, tier, phone: "972501234567" };
}

const input = {
  agent_id: AGENT,
  purpose: "winback-q1",
  body: "רצינו לשאול אם לחזור אליך השבוע.",
  buttons: [{ title: "כן, תחזרו" }, { title: "לא עכשיו" }],
  followup: {
    body: "תודה. נחזור אליך.",
    buttons: [{ title: "בסדר" }],
  },
};

async function sendOf(mem: Mem) {
  return async (to: string, body: string, buttons: { id: string; title: string }[]) => {
    mem.sends.push({ to, body, ids: buttons.map((b) => b.id) });
    return `wamid.${mem.sends.length}`;
  };
}

const refused = await runOpsQuestion({
  db: memory(null, OPEN_INBOUND).db,
  input: {},
  sendButtons: async () => {
    throw new Error("send");
  },
  now: NOW,
});
check("בקשה חסרה נעצרת לפני מסד ושליחה", refused.status === 400 && refused.body.error === "bad_request");

const freeMem = memory({ ...paid(), tier: "free" }, OPEN_INBOUND);
const free = await runOpsQuestion({
  db: freeMem.db,
  input,
  sendButtons: await sendOf(freeMem),
  now: NOW,
});
check("מסלול חינם נדחה", free.status === 403 && free.body.error === "free_plan");
check("מסלול חינם לא שולח ולא תופס", freeMem.sends.length === 0 && freeMem.claims.length === 0);

const closedMem = memory(paid(), CLOSED_INBOUND);
const closed = await runOpsQuestion({
  db: closedMem.db,
  input,
  sendButtons: await sendOf(closedMem),
  now: NOW,
});
check(
  "חלון סגור מחזיר את זמן הנכנסת",
  closed.status === 409 && closed.body.error === "window_closed" && closed.body.last_inbound === CLOSED_INBOUND,
);
check("חלון סגור לא שולח ולא תופס", closedMem.sends.length === 0 && closedMem.claims.length === 0);

const noneMem = memory(paid(), null);
const none = await runOpsQuestion({
  db: noneMem.db,
  input,
  sendButtons: await sendOf(noneMem),
  now: NOW,
});
check("בלי נכנסת last_inbound הוא null", none.status === 409 && none.body.last_inbound === null);

const longTitle = await runOpsQuestion({
  db: memory(paid(), OPEN_INBOUND).db,
  input: { ...input, buttons: [{ title: "א".repeat(21) }] },
  sendButtons: async () => "wamid",
  now: NOW,
});
check("כותרת מעל 20 נדחית", longTitle.status === 400 && longTitle.body.error === "bad_request");

const okMem = memory(paid("premium"), OPEN_INBOUND);
const ok = await runOpsQuestion({
  db: okMem.db,
  input,
  sendButtons: await sendOf(okMem),
  now: NOW,
});
check("שליחה ראשונה מצליחה", ok.status === 200 && ok.body.ok === true && okMem.status() === "sent");
check(
  "שתי הודעות, ומזהים עם הקידומת",
  okMem.sends.length === 2 &&
    okMem.sends[0].to === "972501234567" &&
    okMem.sends[0].ids.join() === "ops_q:winback-q1:0,ops_q:winback-q1:1" &&
    okMem.sends[1].ids.join() === "ops_q:winback-q1:2" &&
    (ok.body.button_ids as string[]).join() === okMem.sends[0].ids.join(),
);
check(
  "המזהים נרשמים בתפיסה וביומן",
  okMem.claims[0].buttonIds.join() === "ops_q:winback-q1:0,ops_q:winback-q1:1" &&
    okMem.claims[0].followupButtonIds?.join() === "ops_q:winback-q1:2" &&
    okMem.outbound[0].body.includes("ops_q:winback-q1:0") &&
    okMem.outbound[0].body.includes("כן, תחזרו"),
);
const userLines = okMem.history.filter((m) => (m as { role?: string }).role === "user") as { content: string }[];
const assistantLines = okMem.history.filter((m) => (m as { role?: string }).role === "assistant") as { content: string }[];
check(
  "ההיסטוריה כמו הודעה יוצאת: הערה ואז גוף, לא לחיצה",
  userLines.length === 2 &&
    userLines.every((m) => m.content === OPS_HISTORY_NOTE) &&
    assistantLines.some((m) => m.content.includes("ops_q:winback-q1:0")) &&
    !userLines.some((m) => m.content.includes("כן, תחזרו")),
);

const again = await runOpsQuestion({
  db: okMem.db,
  input,
  sendButtons: await sendOf(okMem),
  now: NOW,
});
check(
  "פעם שנייה לאותו purpose לא שולחת",
  again.status === 409 && again.body.error === "already_sent" && okMem.sends.length === 2,
);

const oneMem = memory(paid(), OPEN_INBOUND);
const one = await runOpsQuestion({
  db: oneMem.db,
  input: { agent_id: AGENT, purpose: "once", body: "שאלה אחת.", buttons: [{ title: "כן" }] },
  sendButtons: await sendOf(oneMem),
  now: NOW,
});
check(
  "בלי הודעה שנייה יוצאת אחת",
  one.status === 200 && oneMem.sends.length === 1 && one.body.followup_button_ids === null &&
    oneMem.sends[0].ids.join() === "ops_q:once:0",
);

const failMem = memory(paid(), OPEN_INBOUND);
let failCalls = 0;
const logErr = console.error;
console.error = () => {};
const failedSend = await runOpsQuestion({
  db: failMem.db,
  input: { agent_id: AGENT, purpose: "boom", body: "שאלה.", buttons: [{ title: "כן" }] },
  sendButtons: async () => {
    failCalls++;
    throw new Error("meta down");
  },
  now: NOW,
});
const retry = await runOpsQuestion({
  db: failMem.db,
  input: { agent_id: AGENT, purpose: "boom", body: "שאלה.", buttons: [{ title: "כן" }] },
  sendButtons: async () => {
    failCalls++;
    return "wamid.retry";
  },
  now: NOW,
});
console.error = logErr;
check(
  "כישלון שליחה לא נשלח שוב",
  failedSend.status === 502 && failedSend.body.error === "send_failed" &&
    retry.status === 409 && retry.body.error === "already_sent" && failCalls === 1 &&
    failMem.status() === "failed",
);

const answers: OpsAnswer[] = [];
const tapDb: OpsTapDb = {
  async agentIdByPhone(phone) {
    check("החיפוש הוא לפי המספר ששלח", phone === "972501234567");
    return AGENT;
  },
  async insertAnswer(row) {
    answers.push(row);
  },
};
const at = new Date("2026-10-29T12:05:00.000Z");
const tapMsg = {
  type: "interactive",
  interactive: { button_reply: { id: "ops_q:winback-q1:1", title: "לא עכשיו" } },
};
const tap = inboundOpsButton(tapMsg);
check("לחיצה מזוהה", !!tap && tap.id === "ops_q:winback-q1:1" && tap.title === "לא עכשיו");
const agentId = await recordOpsTap(tapDb, "972501234567", tap!, at);
check(
  "הלחיצה נרשמת עם סוכן, purpose, כותרת וזמן",
  agentId === AGENT &&
    answers.length === 1 &&
    answers[0].agent_id === AGENT &&
    answers[0].purpose === "winback-q1" &&
    answers[0].button_title === "לא עכשיו" &&
    answers[0].button_id === "ops_q:winback-q1:1" &&
    answers[0].answered_at === at.toISOString() &&
    OPS_TAP_REPLY === "תודה, העברתי לבדיקה",
);

const broken = inboundOpsButton({
  type: "interactive",
  interactive: { button_reply: { id: "ops_q:not a purpose", title: "משהו" } },
});
const listBroken = inboundOpsButton({
  type: "interactive",
  interactive: { list_reply: { id: "ops_q:", title: "עוד" } },
});
check("קידומת לא מוכרת עדיין נתפסת", !!broken && !!listBroken && purposeOf(broken!.id) === "unparsed");
const before = answers.length;
await recordOpsTap(tapDb, "972501234567", broken!, at);
check("קידומת לא מוכרת נרשמת ולא נזרקת", answers.length === before + 1 && answers[answers.length - 1].purpose === "unparsed");
check(
  "כפתור אחר אינו ops_q",
  inboundOpsButton({
    type: "interactive",
    interactive: { button_reply: { id: "poffer:share:yes:11111111-1111-4111-8111-111111111111", title: "כן" } },
  }) === null,
);
check(
  "טקסט חופשי עם הקידומת אינו לחיצה",
  inboundOpsButton({ type: "text", button: { payload: "ops_q:winback-q1:0", text: "כן" } }) === null,
);

const src = readFileSync(
  new URL("../supabase/functions/whatsapp-webhook/index.ts", import.meta.url),
  "utf8",
);
const tapAt = src.indexOf("inboundOpsButton(msg)");
const turnAt = src.indexOf("runAgentTurn(");
const publicAt = src.indexOf("await handlePublicMessage(msg)");
const taskAt = src.indexOf('=== "ops-question"');
const signatureAt = src.indexOf("verifySignature(");
const fallbackAt = src.indexOf("כפתור ops_q נענה למעלה, לפני הסוכן/ת והמודל");
check("המשימה פנימית, לפני חתימת Meta", taskAt > 0 && signatureAt > taskAt);
check("המשימה דורשת service_role", src.includes("opsQuestionAuthRefusal(auth)"));
check("הלחיצה לפני המודל ולפני הבוט הציבורי", tapAt > 0 && tapAt < turnAt && tapAt < publicAt);
check("הנפילה לכותרת כטקסט באה אחרי התפיסה", fallbackAt > tapAt && src.indexOf("userText = msg.interactive?.button_reply?.title", fallbackAt) > fallbackAt);
check("אחרי התפיסה יש return", src.slice(tapAt, tapAt + 500).includes("return;"));

const sql = readFileSync(
  new URL("../supabase/migrations/20271031100000_whatsapp_ops_question.sql", import.meta.url),
  "utf8",
);
for (const table of ["whatsapp_ops_questions", "whatsapp_ops_answers"]) {
  check(
    `${table} סגור ל-anon ול-authenticated`,
    sql.includes(`alter table public.${table} enable row level security`) &&
      sql.includes(`revoke all on table public.${table} from public, anon, authenticated`) &&
      sql.includes(`grant select, insert, update, delete on table public.${table} to service_role`),
  );
}
check("ייחוד של purpose לסוכן/ת", sql.includes("unique (agent_id, purpose)"));

if (failed) {
  console.error(`נכשלו ${failed}`);
  process.exit(1);
}
console.log("שאלת ops בוואטסאפ: כל הבדיקות עברו");
