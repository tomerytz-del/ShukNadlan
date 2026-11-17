// deno test --no-lock supabase/functions/whatsapp-webhook/lead_import_test.ts
import { assertEquals } from "jsr:@std/assert@1";
import {
  applyAnswer,
  dealFromText,
  kindFromText,
  looksLikeLeads,
  normalizePhone,
  parseLeadRows,
} from "./lead-import-core.ts";
import { answerLeadImport, runLeadImport } from "./lead-import.ts";

Deno.test("טלפון: אקסל מוריד אפס, +972, מקפים וכמה מספרים בתא", () => {
  assertEquals(normalizePhone("522784243"), "0522784243");
  assertEquals(normalizePhone("+972-52-278-4243"), "0522784243");
  assertEquals(normalizePhone("052 278 4243"), "0522784243");
  assertEquals(normalizePhone("03-1234567"), "031234567");
  assertEquals(normalizePhone("123 / 050-1112233"), "0501112233");
  assertEquals(normalizePhone("12345"), "");
  // שני מספרים בתא בלי מפריד, ותא מספרי עם שבר
  assertEquals(normalizePhone("0501234567 0527654321"), "0501234567");
  assertEquals(normalizePhone("501234567.0"), "0501234567");
  assertEquals(normalizePhone(""), "");
});

Deno.test("סוג ועסקה מטקסט חופשי", () => {
  assertEquals(kindFromText("מוכרים"), "owner");
  assertEquals(kindFromText("משכיר"), "owner");
  assertEquals(kindFromText("קונה"), "seeker");
  assertEquals(kindFromText("מחפש לשכור"), "seeker");
  assertEquals(dealFromText("משכיר"), "rent");
  assertEquals(dealFromText("מחפש לשכור"), "rent");
  assertEquals(dealFromText("מוכר"), "sale");
  assertEquals(kindFromText("אולי"), "");
  // "להשכרה" בתוך תיאור של מחפש/ת אינו הופך אותו לבעלים
  assertEquals(kindFromText("מחפש דירה להשכרה"), "seeker");
  assertEquals(kindFromText("מחפש 4 חדרים למכירה"), "seeker");
  assertEquals(kindFromText("דירה להשכרה"), "owner");
});

Deno.test("כותרות: שם פרטי ומשפחה מתחברים, קובץ בלי טלפון אינו לידים", () => {
  assertEquals(looksLikeLeads(["שם", "טלפון"]), true);
  assertEquals(looksLikeLeads(["שם פרטי", "שם משפחה", "נייד"]), true);
  assertEquals(looksLikeLeads(["שם", "עיר"]), false);
  const { drafts } = parseLeadRows(["שם פרטי", "שם משפחה", "נייד"], [["צבי", "חכמון", "522784243"]]);
  assertEquals(drafts[0].fields.full_name, "צבי חכמון");
  assertEquals(drafts[0].fields.phone, "0522784243");
});

Deno.test("חסר: טלפון, שם וסוג נשאלים; ברירת מחדל של הקובץ ממלאת סוג", () => {
  const headers = ["שם", "טלפון", "כתובת", "רצינות"];
  const rows = [
    ["צבי חכמון", "0522784243", "סביון 9 גן נר", "בהמשך השנה"],
    ["דנה", "", "", ""],
    ["", "0501112233", "", ""],
    ["", "", "", ""],
    ["רון", "12345", "", ""],
  ];
  const a = parseLeadRows(headers, rows).drafts;
  assertEquals(a[0].missing, ["kind"]);
  assertEquals(a[1].missing, ["phone", "kind"]);
  assertEquals(a[2].missing, ["name", "kind"]);
  assertEquals(a[3].blank, true);
  assertEquals(a[4].badPhone, "12345");
  const b = parseLeadRows(headers, rows, { kind: "owner", deal_type: "sale" }).drafts;
  assertEquals(b[0].missing, []);
  assertEquals(b[0].fields.deal_type, "sale");
  assertEquals(b[1].missing, ["phone"]);
});

Deno.test("תשובה: טלפון לא תקין לא נכנס, תקין משלים", () => {
  const d = parseLeadRows(["שם", "טלפון"], [["דנה", ""]], { kind: "seeker" }).drafts[0];
  assertEquals(d.missing, ["phone"]);
  const bad = applyAnswer(d, { phone: "abc12" });
  assertEquals(bad.draft.missing, ["phone"]);
  assertEquals(bad.badPhone, "abc12");
  const ok = applyAnswer(d, { phone: "050-111-2233" });
  assertEquals(ok.draft.missing, []);
  assertEquals(ok.draft.fields.phone, "0501112233");
});

// ---------------------------------------------------------------------------
// זרימה מול מסד מדומה
// ---------------------------------------------------------------------------
// deno-lint-ignore no-explicit-any
function fakeDb(job: any) {
  const inserted: Record<string, unknown>[] = [];
  const notes: Record<string, unknown>[] = [];
  let n = 0;
  // deno-lint-ignore no-explicit-any
  const db: any = {
    from(table: string) {
      if (table === "notifications") return { insert: (r: Record<string, unknown>) => { notes.push(r); return Promise.resolve({ error: null }); } };
      return {
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: job, error: null }) }) }) }),
        // deno-lint-ignore no-explicit-any
        update: (patch: any) => ({ eq: () => { Object.assign(job, patch); return Promise.resolve({ error: null }); } }),
      };
    },
    rpc(name: string, args: { p: Record<string, unknown> }) {
      if (name !== "agent_lead_add") return Promise.resolve({ data: null, error: { message: "?" } });
      if (args.p.phone === "0509999999") return Promise.resolve({ data: { success: false, duplicate: true, lead_id: "dup" }, error: null });
      inserted.push(args.p);
      return Promise.resolve({ data: { success: true, lead_id: `lead-${++n}` }, error: null });
    },
  };
  return { db, inserted, notes };
}

Deno.test("ייבוא: שלמות נכנסות אחת-אחת, חסרות נשאלות אחת-אחת, אפשר לדלג", async () => {
  const job = {
    id: "00000000-0000-4000-8000-000000000001", agent_id: "a1", source: "whatsapp", status: "pending",
    created_at: new Date().toISOString(), state: {},
    headers: ["שם", "טלפון", "כתובת", "סוג ליד"],
    rows: [
      ["צבי חכמון", "0522784243", "סביון 9", "מוכר"],
      ["דנה", "", "", "מחפש"],
      ["רון", "0509999999", "", "קונה"],
      ["", "", "", ""],
      ["אבי", "0501112233", "", ""],
    ],
  };
  const { db, inserted, notes } = fakeDb(job);
  const agent = { id: "a1", agency_id: "g1" };

  const run = await runLeadImport(db, agent, job.id);
  assertEquals(run.inserted, 1);
  assertEquals(run.duplicates, 1);
  assertEquals(run.pending, 2);
  assertEquals(run.next.row, 3); // דנה: חסר טלפון
  assertEquals(run.next.missing, ["phone"]);
  assertEquals(inserted.length, 1);
  assertEquals(inserted[0].notify, false);
  assertEquals(inserted[0].kind, "owner");
  assertEquals(notes.length, 0); // ההתראה אחת לקובץ, כשהוא נסגר

  // טלפון שגוי: נשארת באותה שורה
  const bad = await answerLeadImport(db, agent, job.id, { phone: "abc" });
  assertEquals(bad.next.row, 3);
  assertEquals(inserted.length, 1);

  // טלפון תקין: דנה נכנסת, עוברים לאבי (חסר סוג)
  const ok = await answerLeadImport(db, agent, job.id, { phone: "050-777-8899" });
  assertEquals(inserted.length, 2);
  assertEquals(ok.next.row, 6);
  assertEquals(ok.next.missing, ["kind"]);

  // דילוג על אבי סוגר את הקובץ
  const skip = await answerLeadImport(db, agent, job.id, { skip: true });
  assertEquals(skip.next, null);
  assertEquals(skip.inserted, 2);
  assertEquals(skip.skipped, 2); // שורה ריקה + אבי
  assertEquals(job.status, "done");
  assertEquals(notes.length, 1);
  assertEquals(notes[0].type, "lead_entered");
  assertEquals(notes[0].title, "2 לידים נקלטו");
});

Deno.test("ייבוא: default_kind ממלא סוג לכל הקובץ, ו-skip_all סוגר", async () => {
  const job = {
    id: "00000000-0000-4000-8000-000000000002", agent_id: "a1", source: "email", status: "pending",
    created_at: new Date().toISOString(), state: {},
    headers: ["שם", "טלפון"],
    rows: [["א", "0501111111"], ["ב", ""], ["ג", ""]],
  };
  const { db, inserted } = fakeDb(job);
  const agent = { id: "a1", agency_id: "g1" };
  const run = await runLeadImport(db, agent, job.id, { default_kind: "seeker", default_deal_type: "rent" });
  assertEquals(run.inserted, 1);
  assertEquals(run.pending, 2);
  assertEquals(inserted[0].kind, "seeker");
  assertEquals(inserted[0].deal_type, "rent");
  const all = await answerLeadImport(db, agent, job.id, { skip_all: true });
  assertEquals(all.pending, 0);
  assertEquals(all.next, null);
  assertEquals(job.status, "done");
});
