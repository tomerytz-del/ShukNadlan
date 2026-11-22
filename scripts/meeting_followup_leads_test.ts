// אישור ותזכורת לפגישה עם ליד מ"הלידים שלי": מתי שולחים, מתי שואלים טלפון, ומתי לא.
//   node --experimental-strip-types scripts/meeting_followup_leads_test.ts
import { readFileSync } from "node:fs";
import { fetchOwnLead, leadFollowupPlan, type OwnLead } from "../supabase/functions/whatsapp-webhook/agenda-lead.ts";

let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`ok  ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL ${name}\n  ${(err as Error).message}`);
  }
}
function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

type Call = { table: string; op: "select" | "update"; patch?: unknown; filters: Array<[string, unknown]> };

/** לקוח מדומה: רושם כל שאילתה, ומחזיר את הליד שהוגדר או את תוצאת העדכון. */
function fakeSb(lead: OwnLead | null, updateError: unknown = null) {
  const calls: Call[] = [];
  const sb = {
    from(table: string) {
      const call: Call = { table, op: "select", filters: [] };
      calls.push(call);
      const chain = {
        select() { call.op = "select"; return chain; },
        update(patch: unknown) { call.op = "update"; call.patch = patch; return chain; },
        eq(col: string, val: unknown) { call.filters.push([col, val]); return chain; },
        maybeSingle() {
          const agentOk = call.filters.some(([c, v]) => c === "agent_id" && v === "agent-1");
          return Promise.resolve({ data: agentOk ? lead : null, error: null });
        },
        // deno-lint-ignore no-explicit-any
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown): any {
          return Promise.resolve({ error: updateError }).then(resolve, reject);
        },
      };
      return chain;
    },
  };
  return { sb, calls };
}

const LEAD: OwnLead = { id: "lead-1", raw_name: "דנה לוי", raw_phone: "052-2222222", status: "unlocked" };

await test("ליד עם טלפון: נשלח אישור ותזכורת, בלי לכתוב דבר", async () => {
  const { sb, calls } = fakeSb(LEAD);
  const plan = await leadFollowupPlan(sb, "agent-1", LEAD, undefined);
  assert(plan.notify === true, "צריך לשלוח");
  assert(!calls.some((c) => c.op === "update"), "אסור לכתוב לליד שיש לו טלפון");
});

await test("ליד בלי טלפון: לא שולחים, שואלים את המספר ולא מנחשים", async () => {
  const noPhone = { ...LEAD, raw_phone: null };
  const { sb, calls } = fakeSb(noPhone);
  const plan = await leadFollowupPlan(sb, "agent-1", noPhone, undefined);
  assert(plan.notify === false, "בלי טלפון אין שליחה");
  assert(/מה המספר/.test(plan.note || ""), "ההערה צריכה לבקש מהסוכן/ת את המספר");
  assert(/לא לנחש/.test(plan.note || ""), "ההערה צריכה לאסור ניחוש");
  assert(/lead_phone/.test(plan.note || ""), "ההערה צריכה להסביר איך ממשיכים");
  assert(!calls.some((c) => c.op === "update"), "אסור לכתוב בלי מספר");
});

await test("ליד בלי טלפון, והסוכן/ת אמר/ה מספר: נשמר על הליד של הסוכן/ת ונשלח", async () => {
  const noPhone = { ...LEAD, raw_phone: null };
  const { sb, calls } = fakeSb(noPhone);
  const plan = await leadFollowupPlan(sb, "agent-1", noPhone, " 0501234567 ");
  assert(plan.notify === true, "עם מספר תקין צריך לשלוח");
  const upd = calls.find((c) => c.op === "update");
  assert(upd, "המספר צריך להישמר");
  assert((upd!.patch as { raw_phone: string }).raw_phone === "0501234567", "נשמר המספר כמו שנאמר, בלי רווחים");
  const f = Object.fromEntries(upd!.filters);
  assert(f.id === "lead-1" && f.agent_id === "agent-1" && f.status === "unlocked",
    "העדכון חייב להיות מוגבל לליד, לסוכן/ת ולליד פתוח");
});

await test("מספר לא תקין לא נשמר ולא נשלח אליו", async () => {
  const noPhone = { ...LEAD, raw_phone: null };
  const { sb, calls } = fakeSb(noPhone);
  const plan = await leadFollowupPlan(sb, "agent-1", noPhone, "12345");
  assert(plan.notify === false, "מספר קצר אינו טלפון");
  assert(!calls.some((c) => c.op === "update"), "אסור לשמור מספר לא תקין");
});

await test("כשל בשמירת המספר: לא שולחים", async () => {
  const noPhone = { ...LEAD, raw_phone: null };
  const { sb } = fakeSb(noPhone, { message: "boom" });
  const plan = await leadFollowupPlan(sb, "agent-1", noPhone, "0501234567");
  assert(plan.notify === false, "אם השמירה נכשלה אין טלפון בליד, ואין שליחה");
});

await test("ליד נעול: לא שולחים וגם לא כותבים, גם כשנאמר מספר", async () => {
  const locked = { ...LEAD, status: "masked", raw_phone: null };
  const { sb, calls } = fakeSb(locked);
  const plan = await leadFollowupPlan(sb, "agent-1", locked, "0501234567");
  assert(plan.notify === false, "ליד נעול אינו נשלח");
  assert(!calls.some((c) => c.op === "update"), "אסור לכתוב לליד נעול");
});

await test("ליד שאינו של הסוכן/ת או שלא קיים: אין שליחה", async () => {
  const { sb } = fakeSb(LEAD);
  assert((await fetchOwnLead(sb, "agent-2", "lead-1")) === null, "ליד של סוכן/ת אחר/ת אינו מוחזר");
  const plan = await leadFollowupPlan(sb, "agent-2", null, undefined);
  assert(plan.notify === false, "בלי ליד אין שליחה");
});

await test("המיגרציה: ליד נלקח רק כשהוא של הסוכן/ת ופתוח, ולקוח/ה גובר/ת", () => {
  const sql = readFileSync(
    new URL("../supabase/migrations/20271129110000_meeting_followup_leads.sql", import.meta.url), "utf8");
  assert(/l\.agent_id = p_agent_id/.test(sql), "חייבת להיות בדיקת בעלות על הליד");
  assert(/l\.status = 'unlocked'/.test(sql), "ליד נעול אסור לשליחה");
  assert(/p_client_id is null/.test(sql), "לקוח/ה גובר/ת על ליד");
  assert(/lead_id, due_at/.test(sql), "העמודה lead_id חייבת להפעיל את הטריגר");
  assert(/v_item\.lead_id\);/.test(sql), "המשימה האוטומטית אחרי משוב נקשרת לליד");
});

if (failed) {
  console.error(`נכשלו ${failed}`);
  process.exit(1);
}
console.log("עבר");
