// כפתורי משוב על ריכוז ההתאמות (match-feedback.ts): המזהים, מגבלות Meta,
// ומה התשובה ללחיצה - בלי מסד ובלי וואטסאפ.
//   node --experimental-strip-types scripts/match_feedback_test.ts

import { readFileSync } from "node:fs";
import {
  feedbackButtons,
  feedbackDoneText,
  matchDigestButtons,
  matchFeedbackReply,
  matchListRows,
  MF_LIST_BUTTON,
  MF_LIST_SECTION,
  MF_MARK,
  MF_NOT_RELEVANT,
  MF_RELEVANT,
  parseMatchFeedbackButton,
  type MatchRow,
} from "../supabase/functions/whatsapp-webhook/match-feedback.ts";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) return;
  failed++;
  console.error(`FAIL ${name}`, detail ?? "");
}

const A1 = "11111111-1111-4111-8111-111111111111";
const A2 = "22222222-2222-4222-8222-222222222222";
const N1 = "33333333-3333-4333-8333-333333333333";
const AGENT = "44444444-4444-4444-8444-444444444444";

// מגבלות Meta: כותרת כפתור עד 20 יחידות UTF-16, כפתור רשימה עד 20.
for (const t of [MF_RELEVANT, MF_NOT_RELEVANT, MF_MARK, MF_LIST_BUTTON, "📋 פתיחה ב-CRM"]) {
  check(`title ${t} <= 20 utf16`, t.length <= 20, t.length);
}
check("section <= 24", Array.from(MF_LIST_SECTION).length <= 24);

// הכותרת ב-notification-push זהה לזו שנבדקה כאן
const push = readFileSync("supabase/functions/notification-push/index.ts", "utf8");
check("push crm title", push.includes(`const MATCH_CRM_TITLE = "📋 פתיחה ב-CRM";`));
// הדגל נקרא עם שאר דגלי התקציר, ולא בשאילתה נפרדת
check("flag in loadDigestFlags", push.includes(`matchFeedback: on("match_feedback_buttons_enabled")`));

// המזהים
check("parse r", JSON.stringify(parseMatchFeedbackButton(`mfb:r:${A1}`)) === JSON.stringify({ action: "relevant", id: A1 }));
check("parse n upper", parseMatchFeedbackButton(`mfb:n:${A1.toUpperCase()}`)?.id === A1);
check("parse l", parseMatchFeedbackButton(`mfb:l:${N1}`)?.action === "list");
check("parse p", parseMatchFeedbackButton(`mfb:p:${A1}`)?.action === "pick");
check("parse junk", parseMatchFeedbackButton(`mfb:x:${A1}`) === null);
check("parse other prefix", parseMatchFeedbackButton(`unpub:p:${A1}`) === null);
check("parse not uuid", parseMatchFeedbackButton("mfb:r:abc") === null);

const row = (id: string, total: number, extra: Partial<MatchRow> = {}): MatchRow => ({
  alert_id: id, client_name: "דנה לוי", property_title: "4 חדרים בגבעת המורה", score: 92, feedback: null, total, ...extra,
});

// סיכום: אחת - שני כפתורים; כמה - כפתור רשימה אחד; אפס - כלום
const one = matchDigestButtons(N1, [row(A1, 1)]);
check("single -> 2 buttons", one?.length === 2 && one[0].id === `mfb:r:${A1}` && one[1].id === `mfb:n:${A1}`, one);
const many = matchDigestButtons(N1, [row(A1, 4)]);
check("many -> list button", many?.length === 1 && many[0].id === `mfb:l:${N1}` && many[0].title === MF_MARK, many);
check("none -> null", matchDigestButtons(N1, []) === null);
check("bad notification -> null", matchDigestButtons("x", [row(A1, 1)]) === null);
check("bad alert -> null", feedbackButtons("nope") === null);
for (const b of [...(one || []), ...(many || [])]) check(`id ${b.id} <= 256`, b.id.length <= 256);

// שורות הרשימה: כותרת עד 24, תיאור עד 72, עד 10 שורות
const longRows = Array.from({ length: 12 }, (_, i) =>
  row(`${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`, 12, {
    client_name: "שם ארוך מאוד של לקוחה עם שם משפחה כפול",
    property_title: "דירת גן מרווחת עם חצר גדולה ומרפסת שמש ברחוב ארוך מאוד בשכונה חדשה",
  }));
const lr = matchListRows(longRows);
check("list <= 10 rows", lr.length === 10, lr.length);
check("row title <= 24", lr.every((r) => Array.from(r.title).length <= 24), lr.map((r) => r.title));
check("row desc <= 72", lr.every((r) => Array.from(r.description).length <= 72), lr.map((r) => r.description));
check("row id pick", lr[0].id.startsWith("mfb:p:"));

// נוסח
check("relevant text", feedbackDoneText("relevant", row(A1, 1)).includes("רלוונטי לדנה לוי"));
check("not relevant text", feedbackDoneText("not_relevant", row(A1, 1)).includes("לא יופיע שוב"));
check("no long dash", ![feedbackDoneText("relevant", row(A1, 1)), feedbackDoneText("not_relevant", row(A1, 1))]
  .some((t) => /[—–]/.test(t)));

// ‏matchFeedbackReply מול לקוח מזויף
type Call = { fn: string; args: Record<string, unknown> };
function fakeSb(rpcData: Record<string, unknown>, pick: unknown = null) {
  const calls: Call[] = [];
  const filters: [string, unknown][] = [];
  const sb = {
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      const d = rpcData[fn];
      return Promise.resolve(d instanceof Error ? { data: null, error: { message: d.message } } : { data: d, error: null });
    },
    from(_t: string) {
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => { filters.push([k, v]); return q; },
        maybeSingle: () => Promise.resolve({ data: pick, error: null }),
      };
      return q;
    },
  };
  // deno-lint-ignore no-explicit-any
  return { sb: sb as any, calls, filters };
}

const run = async () => {
  check("not ours -> null", await matchFeedbackReply(fakeSb({}).sb, AGENT, `unpub:p:${A1}`) === null);

  let f = fakeSb({ match_feedback_set: [{ client_name: "דנה", property_title: "בית" }] });
  let out = await matchFeedbackReply(f.sb, AGENT, `mfb:n:${A1}`);
  check("dismiss text", !!out?.text?.includes("הורדתי") && !out.outbox, out);
  check("dismiss rpc args", JSON.stringify(f.calls[0]) === JSON.stringify(
    { fn: "match_feedback_set", args: { p_agent: AGENT, p_alert: A1, p_feedback: "not_relevant" } }), f.calls);

  f = fakeSb({ match_feedback_set: [] });
  out = await matchFeedbackReply(f.sb, AGENT, `mfb:r:${A1}`);
  check("gone -> text", !!out?.text?.includes("כבר לא קיימת"), out);

  f = fakeSb({ match_feedback_set: new Error("boom") });
  out = await matchFeedbackReply(f.sb, AGENT, `mfb:r:${A1}`);
  check("error -> crm hint", !!out?.text?.includes("CRM"), out);

  f = fakeSb({ match_digest_alerts: [row(A1, 3), row(A2, 3, { client_name: "יוסי" })] });
  out = await matchFeedbackReply(f.sb, AGENT, `mfb:l:${N1}`);
  const list = out?.outbox?.[0];
  check("list out", list?.kind === "list" && list.rows.length === 2 && list.rows[1].title === "יוסי", out);
  check("list says more", list?.kind === "list" && list.body.includes("מתוך 3"), out);
  check("list rpc scoped to agent", f.calls[0].args.p_agent === AGENT && f.calls[0].args.p_notification === N1);

  f = fakeSb({ match_digest_alerts: [row(A1, 1)] });
  out = await matchFeedbackReply(f.sb, AGENT, `mfb:l:${N1}`);
  const one1 = out?.outbox?.[0];
  check("list of one -> buttons", one1?.kind === "buttons" && one1.buttons[0].id === `mfb:r:${A1}`, out);

  f = fakeSb({ match_digest_alerts: [] });
  out = await matchFeedbackReply(f.sb, AGENT, `mfb:l:${N1}`);
  check("empty list -> text", !!out?.text && !out.outbox, out);

  f = fakeSb({}, { id: A1, score: 80, agent_clients: { full_name: "דנה" }, properties: { title: "בית" } });
  out = await matchFeedbackReply(f.sb, AGENT, `mfb:p:${A1}`);
  const picked = out?.outbox?.[0];
  check("pick -> buttons", picked?.kind === "buttons" && picked.body.includes('"בית" לדנה (80%)'), out);
  check("pick filtered by agent", f.filters.some(([k, v]) => k === "agent_id" && v === AGENT), f.filters);

  f = fakeSb({}, null);
  out = await matchFeedbackReply(f.sb, AGENT, `mfb:p:${A1}`);
  check("pick other agent -> text", !!out?.text?.includes("כבר לא קיימת"), out);

  // הוובהוק תופס את הכפתור לפני הכותרת שעוברת למודל
  const hook = readFileSync("supabase/functions/whatsapp-webhook/index.ts", "utf8");
  const at = hook.indexOf("matchFeedbackReply(supabase, agent.id, buttonId)");
  // ‏case "interactive": הלחיצה נתפסת לפני השורה שמעבירה את הכותרת למודל
  const caseAt = hook.indexOf('case "interactive": {');
  const modelAt = hook.indexOf("userText = msg.interactive?.button_reply?.title ||", caseAt);
  check("webhook catches before model", caseAt > 0 && at > caseAt && modelAt > at, { caseAt, at, modelAt });

  if (failed) {
    console.error(`${failed} failed`);
    process.exit(1);
  }
  console.log("match feedback: ok");
};
run();
