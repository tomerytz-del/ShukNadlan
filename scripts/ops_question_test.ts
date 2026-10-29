// שאלה תפעולית: רשימה סגורה, שער מסלול, כיבוי וואטסאפ, תקרות, retry,
// ולחיצה שנרשמת רק אם נשלחה. בלי מסד, בלי Meta ובלי שליחה.
//   node --experimental-strip-types scripts/ops_question_test.ts

import { readFileSync } from "node:fs";
import {
  claimDecision,
  customerWindowOpen,
  inboundOpsButton,
  OPS_AGENT_DAILY_CAP,
  OPS_GLOBAL_DAILY_CAP,
  OPS_HISTORY_NOTE,
  OPS_QUESTIONS,
  OPS_TAP_REPLY,
  OPS_WINDOW_MS,
  appendOpsHistory,
  opsQuestionAuthRefusal,
  questionMessages,
  recordOpsTap,
  runOpsQuestion,
  whatsappAgentBlock,
  whatsappFullyOptedOut,
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

const PURPOSE = "shai_dup_warehouse_2026_10";
const SHAI = "83d91018-29f0-477c-9088-9ecabc3237f8";
const OTHER = "22222222-2222-4222-8222-222222222222";
const NOW = Date.parse("2026-10-29T12:00:00.000Z");
const OPEN_INBOUND = new Date(NOW - 60 * 60 * 1000).toISOString();
const CLOSED_INBOUND = new Date(NOW - OPS_WINDOW_MS).toISOString();
const KNOWN = ["new_lead", "agenda_reminder", "security_alert"];

const q = OPS_QUESTIONS[PURPOSE];
const titles = [...q.buttons, ...q.followup.buttons];
check("כל כותרת עד 20", titles.every((t) => t.length >= 1 && t.length <= 20));
check(
  "כפתורי ההודעה הראשונה",
  q.buttons.join("|") === "כולם אותו נכס|13 ו-9 מ' שונים|שלושה נכסים שונים" &&
    q.buttons.every((t) => t.length <= 20),
);
check(
  "הנוסח המאושר כלשונו",
  q.body === "היי שי, שמתי לב שיש אצלך שלושה מרלו\"גים של 4,800 מ\"ר להשכרה באותה נקודה במפה: שניים עם תקרה של 13 מטר (ב-65 ₪ וב-68 ₪ למ\"ר) ואחד עם תקרה של 9 מטר (ב-65 ₪ למ\"ר). זה אותו נכס שעלה כמה פעמים?" &&
    q.followup.body.includes("נכס 1306") && q.followup.buttons.join("|") === "נכון|צריך לתקן",
);
check("סוכן/ת מאושר אחד", q.allowedAgentIds.length === 1 && q.allowedAgentIds[0] === SHAI);
check("תקרות", OPS_AGENT_DAILY_CAP === 1 && OPS_GLOBAL_DAILY_CAP === 5);

check("רק service_role", opsQuestionAuthRefusal({ ok: true, via: "service_role" }) === null);
check("סוד cron אינו מספיק", opsQuestionAuthRefusal({ ok: true, via: "cron_secret" })?.status === 401);
check("חינם", whatsappAgentBlock({ active: true, tier: "free", billing_status: "active" }) === "free_plan");
check("לא פעיל", whatsappAgentBlock({ active: false, tier: "premium", billing_status: "active" }) === "inactive");
check("חיוב לא פעיל", whatsappAgentBlock({ active: true, tier: "mid", billing_status: "past_due" }) === "billing_inactive");
check("mid פעיל עובר", whatsappAgentBlock({ active: true, tier: "mid", billing_status: "active" }) === null);
check("premium פעיל עובר", whatsappAgentBlock({ active: true, tier: "premium", billing_status: "active" }) === null);
check("בלי שורה הערוץ דלוק", whatsappFullyOptedOut(null, KNOWN) === false);
check(
  "whatsapp_types ריק לבד אינו כיבוי",
  whatsappFullyOptedOut({ whatsapp_types: [], whatsapp_off_types: [] }, KNOWN) === false,
);
check(
  "כיבוי סוג אחד אינו כיבוי הערוץ",
  whatsappFullyOptedOut({ whatsapp_types: [], whatsapp_off_types: ["new_lead"] }, KNOWN) === false,
);
check(
  "רשימת סוגים ריקה עם כיבוי נחסמת",
  whatsappFullyOptedOut({ whatsapp_types: [], whatsapp_off_types: ["new_lead"] }, []) === true &&
    whatsappFullyOptedOut({ whatsapp_types: [], whatsapp_off_types: ["new_lead"] }, null) === true,
);
check(
  "ברירת מחדל דלוקה גם בלי רשימת סוגים",
  whatsappFullyOptedOut({ whatsapp_types: [], whatsapp_off_types: [] }, []) === false,
);
check(
  "opt-out מלא",
  whatsappFullyOptedOut({ whatsapp_types: [], whatsapp_off_types: KNOWN }, KNOWN) === true,
);
check("חלון פתוח", customerWindowOpen(OPEN_INBOUND, NOW));
check("בדיוק 24 שעות סגור", customerWindowOpen(CLOSED_INBOUND, NOW) === false);

type Sent = { to: string; body: string; ids: string[]; titles: string[] };

function memory(agent: OpsAgent | null, opts?: {
  lastInbound?: string | null;
  off?: boolean;
  claimCode?: string;
  prior?: string[];
}): {
  db: OpsQuestionDb;
  sends: Sent[];
  claims: OpsClaim[];
  outbound: OpsOutbound[];
  history: unknown[];
  status: () => string | null;
} {
  const sends: Sent[] = [];
  const claims: OpsClaim[] = [];
  const outbound: OpsOutbound[] = [];
  const history: unknown[] = [];
  let marked: string | null = null;
  const db: OpsQuestionDb = {
    async getAgent(id) {
      return agent && agent.id === id ? agent : null;
    },
    async whatsappOff() {
      return opts?.off === true;
    },
    async lastInboundAt() {
      return opts?.lastInbound === undefined ? OPEN_INBOUND : opts.lastInbound;
    },
    async priorWaIds() {
      return opts?.prior ?? [];
    },
    async claim(row) {
      claims.push(row);
      if (opts?.claimCode) return opts.claimCode;
      const prev = claims.filter((c) => c.agentId === row.agentId && c.purpose === row.purpose);
      if (prev.length > 1 && !row.retry) return "already_sent";
      if (prev.length > 1 && row.retry) return "reclaimed";
      return "claimed";
    },
    async markSent(_a, _p, _ids, status) {
      marked = status;
    },
    async appendHistory(_a, _p, _in, text) {
      history.push(...appendOpsHistory([], text));
    },
    async logOutbound(row) {
      outbound.push(row);
    },
  };
  return {
    db,
    sends,
    claims,
    outbound,
    history,
    status: () => marked,
  };
}

function paid(): OpsAgent {
  return { id: SHAI, tier: "premium", phone: "972501234567", active: true, billing_status: "active" };
}

function input(extra: Record<string, unknown> = {}) {
  return { purpose: PURPOSE, agent_member_id: SHAI, ...extra };
}

async function sender(mem: { sends: Sent[] }) {
  return async (to: string, body: string, buttons: { id: string; title: string }[]) => {
    mem.sends.push({ to, body, ids: buttons.map((b) => b.id), titles: buttons.map((b) => b.title) });
    return `wamid.${mem.sends.length}`;
  };
}

const unknown = await runOpsQuestion({
  db: memory(paid()).db,
  input: { purpose: "free-text", agent_member_id: SHAI, body: "טקסט מהקורא", buttons: [{ title: "כן" }] },
  sendButtons: async () => {
    throw new Error("send");
  },
  now: NOW,
});
check("purpose לא ברשימה נדחה לפני שליחה", unknown.status === 400 && unknown.body.error === "unknown_purpose");

const wrongAgent = await runOpsQuestion({
  db: memory(null).db,
  input: { purpose: PURPOSE, agent_member_id: OTHER },
  sendButtons: async () => "wamid",
  now: NOW,
});
check("סוכן/ת לא ברשימה", wrongAgent.status === 403 && wrongAgent.body.error === "agent_not_allowed");

const freeMem = memory({ ...paid(), tier: "free" });
const free = await runOpsQuestion({ db: freeMem.db, input: input(), sendButtons: await sender(freeMem), now: NOW });
check("מסלול חינם", free.status === 403 && free.body.error === "free_plan" && freeMem.sends.length === 0);

const inactive = await runOpsQuestion({
  db: memory({ ...paid(), active: false }).db,
  input: input(),
  sendButtons: async () => "wamid",
  now: NOW,
});
check("חשבון לא פעיל", inactive.status === 403 && inactive.body.error === "inactive");

const billing = await runOpsQuestion({
  db: memory({ ...paid(), billing_status: "canceled" }).db,
  input: input(),
  sendButtons: async () => "wamid",
  now: NOW,
});
check("חיוב לא פעיל", billing.status === 403 && billing.body.error === "billing_inactive");

const offMem = memory(paid(), { off: true });
const off = await runOpsQuestion({ db: offMem.db, input: input(), sendButtons: await sender(offMem), now: NOW });
check("וואטסאפ כבוי", off.status === 403 && off.body.error === "whatsapp_off" && offMem.sends.length === 0 && offMem.claims.length === 0);

const closedMem = memory(paid(), { lastInbound: CLOSED_INBOUND });
const closed = await runOpsQuestion({ db: closedMem.db, input: input(), sendButtons: await sender(closedMem), now: NOW });
check(
  "חלון סגור מחזיר את הזמן",
  closed.status === 409 && closed.body.error === "window_closed" && closed.body.last_inbound === CLOSED_INBOUND && closedMem.claims.length === 0,
);

const cap = await runOpsQuestion({
  db: memory(paid(), { claimCode: "agent_cap" }).db,
  input: input(),
  sendButtons: async () => "wamid",
  now: NOW,
});
check("תקרת סוכן/ת", cap.status === 429 && cap.body.error === "agent_daily_cap");
const globalCap = claimDecision("global_cap");
check("תקרה גלובלית", globalCap?.status === 429 && globalCap.body.error === "global_daily_cap");

const okMem = memory(paid());
const ok = await runOpsQuestion({
  db: okMem.db,
  input: input({ body: "לא לשלוח את זה", buttons: [{ title: "לא" }], followup: { body: "גם לא", buttons: [{ title: "לא" }] } }),
  sendButtons: await sender(okMem),
  now: NOW,
});
const approved = questionMessages(PURPOSE)!;
check("נשלח הנוסח המאושר, לא מה שהקורא שלח", ok.status === 200 && okMem.sends.length === 2 && okMem.sends[0].body === approved[0].body && okMem.sends[1].body === approved[1].body);
check(
  "הכפתורים המאושרים והמזהים",
  okMem.sends[0].titles.join("|") === q.buttons.join("|") &&
    okMem.sends[0].ids.join() === `ops_q:${PURPOSE}:0,ops_q:${PURPOSE}:1,ops_q:${PURPOSE}:2` &&
    okMem.sends[1].titles.join("|") === q.followup.buttons.join("|") &&
    okMem.sends[1].ids[0] === `ops_q:${PURPOSE}:3`,
);
check("המזהים ביומן", okMem.outbound[0].body.includes(`ops_q:${PURPOSE}:0`) && okMem.outbound[0].body.includes(q.buttons[0]));
const users = okMem.history.filter((m) => (m as { role?: string }).role === "user") as { content: string }[];
check("ההיסטוריה היא הערת מערכת", users.length === 2 && users.every((m) => m.content === OPS_HISTORY_NOTE));

const again = await runOpsQuestion({ db: okMem.db, input: input(), sendButtons: await sender(okMem), now: NOW });
check("פעם שנייה לא שולחת", again.status === 409 && again.body.error === "already_sent" && okMem.sends.length === 2);

const retryMem = memory(paid(), { claimCode: "reclaimed", prior: ["wamid.1"] });
const retry = await runOpsQuestion({
  db: retryMem.db,
  input: input({ retry: true }),
  sendButtons: await sender(retryMem),
  now: NOW,
});
check(
  "retry שולח רק את ההודעה שלא יצאה",
  retry.status === 200 && retryMem.claims[0].retry === true && retryMem.sends.length === 1 &&
    retryMem.sends[0].body === approved[1].body && !retryMem.sends.some((s) => s.body === approved[0].body),
);
check("בלי retry כשל קודם לא נשרף", claimDecision("failed")?.body.detail?.toString().includes("retry=true") === true);
check("claimed תקוע לא נשאר בלי דרך", claimDecision("in_progress")?.body.detail?.toString().includes("retry=true") === true);

const answers: OpsAnswer[] = [];
let sent = true;
const tapDb: OpsTapDb = {
  async agentIdByPhone(phone) {
    check("חיפוש לפי השולח", phone === "972501234567");
    return SHAI;
  },
  async sentButton(agentId, purpose, buttonId) {
    return sent && agentId === SHAI && purpose === PURPOSE && buttonId === `ops_q:${PURPOSE}:1`;
  },
  async insertAnswer(row) {
    answers.push(row);
  },
};
const at = new Date("2026-10-29T12:05:00.000Z");
const tap = inboundOpsButton({
  type: "interactive",
  interactive: { button_reply: { id: `ops_q:${PURPOSE}:1`, title: q.buttons[1] } },
});
const agentId = await recordOpsTap(tapDb, "972501234567", tap!, at);
check(
  "לחיצה על כפתור שנשלח נרשמת",
  agentId === SHAI && answers[0].purpose === PURPOSE && answers[0].button_title === q.buttons[1] &&
    answers[0].answered_at === at.toISOString() && OPS_TAP_REPLY === "תודה, העברתי לבדיקה",
);
sent = false;
await recordOpsTap(tapDb, "972501234567", tap!, at);
check("כפתור שלא נשלח הוא unmatched בלי סוכן/ת", answers[1].purpose === "unmatched" && answers[1].agent_id === null);
const broken = inboundOpsButton({
  type: "interactive",
  interactive: { button_reply: { id: "ops_q:not-a-question:0", title: "משהו" } },
});
await recordOpsTap(tapDb, "972501234567", broken!, at);
check("קידומת לא מוכרת unmatched ולא למודל", answers[2].purpose === "unmatched" && answers[2].agent_id === null && !!broken);
check(
  "כפתור אחר אינו ops_q",
  inboundOpsButton({ type: "interactive", interactive: { button_reply: { id: "poffer:share:yes:x", title: "כן" } } }) === null,
);

const src = readFileSync(new URL("../supabase/functions/whatsapp-webhook/index.ts", import.meta.url), "utf8");
const tapAt = src.indexOf("inboundOpsButton(msg)");
check("המשימה דורשת service_role", src.includes("opsQuestionAuthRefusal(auth)"));
check("הלחיצה לפני המודל", tapAt > 0 && tapAt < src.indexOf("runAgentTurn(") && tapAt < src.indexOf("await handlePublicMessage(msg)"));
check("אחרי התפיסה יש return", src.slice(tapAt, tapAt + 500).includes("return;"));
check("השער המשותף ו-TIER_ALLOWED", src.includes("whatsappAgentBlock(") && src.includes("TIER_ALLOWED.has("));
check("היסטוריה אטומית", src.includes("whatsapp_ops_history_append") && src.includes("appendOpsHistory([], assistantText)"));

const sql = readFileSync(new URL("../supabase/migrations/20271031100000_whatsapp_ops_question.sql", import.meta.url), "utf8");
for (const table of ["whatsapp_ops_questions", "whatsapp_ops_answers"]) {
  check(
    `${table} סגור`,
    sql.includes(`enable row level security`) &&
      sql.includes(`revoke all on table public.${table} from public, anon, authenticated`) &&
      sql.includes(`grant select, insert, update, delete on table public.${table} to service_role`),
  );
}
check("תקרות במסד", sql.includes("v_agent_n >= 1") && sql.includes("v_global_n >= 5") && sql.includes("p_retry"));
check("retry משחרר failed ו-claimed", sql.includes("v_status in ('failed', 'claimed') and p_retry"));
check("היסטוריה ב-||", sql.includes("coalesce(public.whatsapp_conversations.history, '[]'::jsonb)") && sql.includes("|| coalesce(excluded.history"));

if (failed) {
  console.error(`נכשלו ${failed}`);
  process.exit(1);
}
console.log("שאלת ops בוואטסאפ: כל הבדיקות עברו");
