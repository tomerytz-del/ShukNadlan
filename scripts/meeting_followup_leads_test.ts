// אישור ותזכורת לפגישה עם ליד מ"הלידים שלי": מתי שולחים, מתי שואלים טלפון, ומתי לא.
//   node --experimental-strip-types scripts/meeting_followup_leads_test.ts
import { readFileSync } from "node:fs";
import { fetchOwnLead, leadFollowupPlan, type OwnLead, saveLeadPhone } from "../supabase/functions/whatsapp-webhook/agenda-lead.ts";
import { agentStopNotification, isMeetingOptOutText } from "../supabase/functions/whatsapp-webhook/meeting-optout.ts";

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

await test("ליד בלי טלפון, והסוכן/ת אמר/ה מספר: מאשרים שליחה, אבל התוכנית אינה כותבת לליד", async () => {
  const noPhone = { ...LEAD, raw_phone: null };
  const { sb, calls } = fakeSb(noPhone);
  const plan = await leadFollowupPlan(sb, "agent-1", noPhone, " 0501234567 ");
  assert(plan.notify === true, "עם מספר תקין צריך לשלוח");
  assert(plan.phoneToSave === "0501234567", "המספר מוחזר לקורא, בלי רווחים");
  assert(!calls.some((c) => c.op === "update"), "אסור לכתוב לליד לפני שהפגישה נשמרה");
});

await test("saveLeadPhone: נכתב רק לליד של הסוכן/ת ורק כשהוא פתוח, ומחזיר false בכשל", async () => {
  const ok = fakeSb(LEAD);
  assert(await saveLeadPhone(ok.sb, "agent-1", "lead-1", "0501234567") === true, "שמירה תקינה");
  const upd = ok.calls.find((c) => c.op === "update");
  const f = Object.fromEntries(upd!.filters);
  assert(f.id === "lead-1" && f.agent_id === "agent-1" && f.status === "unlocked",
    "העדכון חייב להיות מוגבל לליד, לסוכן/ת ולליד פתוח");
  assert((upd!.patch as { raw_phone: string }).raw_phone === "0501234567", "נשמר המספר");
  const bad = fakeSb(LEAD, { message: "boom" });
  assert(await saveLeadPhone(bad.sb, "agent-1", "lead-1", "0501234567") === false, "כשל נראה לקורא");
});

await test("מספר לא תקין לא נשמר ולא נשלח אליו", async () => {
  const noPhone = { ...LEAD, raw_phone: null };
  const { sb, calls } = fakeSb(noPhone);
  const plan = await leadFollowupPlan(sb, "agent-1", noPhone, "12345");
  assert(plan.notify === false, "מספר קצר אינו טלפון");
  assert(!calls.some((c) => c.op === "update"), "אסור לשמור מספר לא תקין");
});

await test("מספר שנאמר עם טקסט או עם שני מספרים לא נשמר, גם כשיש בו מספיק ספרות", async () => {
  for (const bad of ["0501234567 או 0521234567", "בית 12, 050123456", "050-123-4567 ו-052-111-2222"]) {
    const noPhone = { ...LEAD, raw_phone: null };
    const { sb, calls } = fakeSb(noPhone);
    const plan = await leadFollowupPlan(sb, "agent-1", noPhone, bad);
    assert(plan.notify === false && !plan.phoneToSave, `"${bad}" אינו מספר אחד`);
    assert(!calls.some((c) => c.op === "update"), `"${bad}" אסור שיישמר`);
  }
});

await test("טלפון שמור שהשולח ידחה נחשב חסר: שואלים מספר במקום להגיד 'נשלח'", async () => {
  const junk = { ...LEAD, raw_phone: "אין" };
  const { sb } = fakeSb(junk);
  const plan = await leadFollowupPlan(sb, "agent-1", junk, undefined);
  assert(plan.notify === false && /מה המספר/.test(plan.note || ""), "צריך לבקש מספר");
});

await test("מספר בפורמטים מקובלים נשמר", async () => {
  for (const good of ["050-123-4567", "+972 50 123 4567", "(03) 123-4567"]) {
    const noPhone = { ...LEAD, raw_phone: null };
    const { sb, calls } = fakeSb(noPhone);
    const plan = await leadFollowupPlan(sb, "agent-1", noPhone, good);
    assert(plan.notify === true && !!plan.phoneToSave, `"${good}" צריך להתקבל ולחזור לשמירה`);
    assert(!calls.some((c) => c.op === "update"), `"${good}": התוכנית אינה כותבת`);
  }
});

await test("ליד נעול: לא שולחים וגם לא כותבים, גם כשנאמר מספר", async () => {
  const locked = { ...LEAD, status: "masked", raw_phone: null };
  const { sb, calls } = fakeSb(locked);
  const plan = await leadFollowupPlan(sb, "agent-1", locked, "0501234567");
  assert(plan.notify === false, "ליד נעול אינו נשלח");
  assert(!(plan.note || "").includes("דנה"), "ההערה על ליד נעול אינה כוללת את שמו");
  assert(!calls.some((c) => c.op === "update"), "אסור לכתוב לליד נעול");
});

await test("ליד שאינו של הסוכן/ת או שלא קיים: אין שליחה", async () => {
  const { sb } = fakeSb(LEAD);
  assert((await fetchOwnLead(sb, "agent-2", "lead-1")) === null, "ליד של סוכן/ת אחר/ת אינו מוחזר");
  const plan = await leadFollowupPlan(sb, "agent-2", null, undefined);
  assert(plan.notify === false, "בלי ליד אין שליחה");
});

await test("בקשת הסרה: מילים נפוצות מתאימות, ומשפט ארוך או 'סירו' לבד לא", () => {
  for (const t of ["הסר", "הסירו", "הסירי", "הסר אותי", "תסירו אותי", "לא רלוונטי", "לא רלוונטית",
    "לא מעוניין", "לא מעוניינת", "הסרה", "הסר!", "STOP", "לא מעוניין בבקשה", "  הסר  ", "לא רלוונטי תודה"]) {
    assert(isMeetingOptOutText(t), `"${t}" צריך להיחשב בקשת הסרה`);
  }
  for (const t of ["הסר את הדירה מהרשימה שלי בבקשה היא נמכרה", "לא רלוונטי לי הדירה הזאת גדולה מדי", "כן", "שלום",
    "אשמח לפרטים", "לא", "אפשר להסיר את ההסכם?", "", "סירו", "לא מעוניין בנכס הזה בגלל המחיר", null, 42]) {
    assert(!isMeetingOptOutText(t as unknown), `"${t}" אינו בקשת הסרה`);
  }
});

await test("התראת העצירה לסוכן/ת: שם איש הקשר וכותרת, בלי טלפון", () => {
  const n = agentStopNotification({ item_id: "i", agent_id: "a", title: "סיור בהרצל 12", due_at: null,
    contact_name: "דנה לוי", cancelled: 3 }, "יום שלישי 14.10 בשעה 17:00");
  assert(n.title.includes("דנה לוי"), "הכותרת כוללת את השם");
  assert(n.body.includes("סיור בהרצל 12") && n.body.includes("בוטלו"), "הגוף כולל את הפגישה ואת הביטול");
  assert(!/\d{9}/.test(n.title + n.body), "בלי מספר טלפון");
});

await test("המיגרציה: חשבון הדגמה, עצירה לפי טלפון, וכיבוי הפריט אחרי סימון השורות", () => {
  const sql = readFileSync(
    new URL("../supabase/migrations/20271130120000_meeting_followup_optout_demo.sql", import.meta.url), "utf8");
  assert(/cf863e10-c25d-41ed-8b22-d6899a56e95d/.test(sql), "משרד ההדגמה");
  assert(/play\.review@shuknadlan\.co\.il/.test(sql), "חשבון הבדיקה של גוגל פליי");
  assert(/not public\.agent_agenda_is_demo\(p_agent_id\)/.test(sql), "agent_agenda_contact מדלגת על הדגמה");
  assert(/v_demo := public\.agent_agenda_is_demo\(r\.agent_id\)/.test(sql), "claim מדלגת על הדגמה");
  assert(/'demo_account'/.test(sql), "סיבת הדילוג נרשמת");
  const mark = sql.indexOf("set status = 'opted_out'");
  const off = sql.indexOf("set client_notify = false");
  assert(mark > 0 && off > mark, "קודם מסמנים את השורות opted_out ורק אחר כך מכבים את הפריט (הטריגר מוחק pending)");
});

await test("המיגרציה: ליד נלקח רק כשהוא של הסוכן/ת ופתוח, ולקוח/ה גובר/ת", () => {
  const sql = readFileSync(
    new URL("../supabase/migrations/20271130110000_meeting_followup_leads.sql", import.meta.url), "utf8");
  assert(/l\.agent_id = p_agent_id/.test(sql), "חייבת להיות בדיקת בעלות על הליד");
  assert(/l\.status = 'unlocked'/.test(sql), "ליד נעול אסור לשליחה");
  assert(/p_client_id is null/.test(sql), "לקוח/ה גובר/ת על ליד");
  assert(/lead_id, due_at/.test(sql), "העמודה lead_id חייבת להפעיל את הטריגר");
  assert(/v_item\.lead_id\);/.test(sql), "המשימה האוטומטית אחרי משוב נקשרת לליד");
  assert(/not exists \(select 1 from public\.agent_agenda_client_messages m where m\.item_id = i\.id\)/.test(sql),
    "ה-backfill חייב להיות אידמפוטנטי: רק פריט בלי הודעות בתור");
});

if (failed) {
  console.error(`נכשלו ${failed}`);
  process.exit(1);
}
console.log("עבר");
