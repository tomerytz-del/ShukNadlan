// קישור פגישה לכרטיס: רק לפי שם שהסוכן/ת אמר/ה.
//   node --experimental-strip-types scripts/link_guard_test.ts
import { readFileSync } from "node:fs";
import {
  linkGuard, nameSupportedByWords, normalizeName, recentAgentWords,
} from "../supabase/functions/whatsapp-webhook/link-guard.ts";

let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok  ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${name}\n  ${(err as Error).message}`);
  }
}
const eq = (a: unknown, b: unknown, m = "") => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`);
};

test("המקרה מ-24.11: שם פרטי בלבד מול כרטיס עם שם מלא - לא נתמך", () => {
  eq(nameSupportedByWords("אברהים זועבי", ["תקבע לי חתימת הסכם עם אברהים ביום חמישי ב-12"]), false);
});

test("שם מלא שנאמר - נתמך, גם עם קידומת ובכל סדר", () => {
  eq(nameSupportedByWords("אברהים זועבי", ["קבע פגישה עם אברהים זועבי"]), true);
  eq(nameSupportedByWords("אברהים זועבי", ["פגישה לאברהים זועבי"]), true);
  eq(nameSupportedByWords("אברהים זועבי", ["זועבי אברהים מחר"]), true);
});

test("כרטיס עם מילה אחת - נתמך כשהיא נאמרה", () => {
  eq(nameSupportedByWords("רונית", ["שלחי לרונית את הפרטים"]), true);
  eq(nameSupportedByWords("רונית", ["שלחי לרות את הפרטים"]), false);
});

test("ניקוד, גרשיים ורישיות לא משנים", () => {
  eq(normalizeName("ג׳ורג'"), "גורג");
  eq(nameSupportedByWords("John Smith", ["meeting with john smith"]), true);
});

test("שם ריק או בלי מילים שאפשר לבדוק - לא נתמך", () => {
  eq(nameSupportedByWords("", ["כלום"]), false);
  eq(nameSupportedByWords("א", ["א"]), false);
  eq(nameSupportedByWords(null, ["כלום"]), false);
});

test("דברי הסוכן/ת: מההיסטוריה (רק הודעות משתמש, האחרונות) ומהתור הנוכחי", () => {
  const history = [
    { role: "user", content: "אברהים זועבי התקשר" },
    { role: "assistant", content: "רשמתי את שם הלקוח אחמד כהן" },
  ];
  const words = recentAgentWords(history, "קבע לו פגישה מחר");
  eq(words, ["אברהים זועבי התקשר", "קבע לו פגישה מחר"]);
  eq(nameSupportedByWords("אחמד כהן", words), false, "דברי הבוט אינם נחשבים");
  eq(nameSupportedByWords("אברהים זועבי", words), true);
});

test("ההיסטוריה נחתכת לתורים האחרונים", () => {
  const history = Array.from({ length: 10 }, (_, i) => ({ role: "user", content: `הודעה ${i}` }));
  eq(recentAgentWords(history, "x", 3), ["הודעה 7", "הודעה 8", "הודעה 9", "x"]);
});

test("linkGuard: שם לא נתמך חוסם ושואל, אישור מפורש מתיר", () => {
  const g = linkGuard("אברהים זועבי", ["עם אברהים"], undefined);
  if (!g || g.error !== "needs_link_confirmation") throw new Error("expected block");
  if (!g.guidance.includes("לקשר לכרטיס של אברהים זועבי?")) throw new Error("question missing");
  eq(linkGuard("אברהים זועבי", ["עם אברהים"], true), null);
  eq(linkGuard("אברהים זועבי", ["עם אברהים"], "true"), g, "רק true בוליאני מאשר");
  eq(linkGuard("אברהים זועבי", ["עם אברהים זועבי"], undefined), null);
});

test("linkGuard: שם חסר בכרטיס חוסם", () => {
  eq(linkGuard(null, ["עם מישהו"], undefined)?.error, "needs_link_confirmation");
});

test("agent.ts: השער לפני הפולואפ, בהוספה ובעדכון ליד, והסכמה מכירה client_confirmed", () => {
  const s = readFileSync("supabase/functions/whatsapp-webhook/agent.ts", "utf8");
  const add = s.indexOf("async function toolAgendaAdd");
  const gate = s.indexOf("linkGuard(linkedName", add);
  const plan = s.indexOf("await clientFollowupPlan(ctx, kind", add);
  if (gate < 0 || plan < 0 || gate > plan) throw new Error("gate must precede clientFollowupPlan in toolAgendaAdd");
  const upd = s.indexOf("async function toolAgendaUpdate");
  const g2 = s.indexOf("linkGuard(leadRef.row.raw_name", upd);
  const p2 = s.indexOf("patch.lead_id = leadRef.row.id", upd);
  if (g2 < 0 || g2 > p2) throw new Error("gate must precede patch.lead_id in toolAgendaUpdate");
  if ((s.match(/client_confirmed: \{/g) || []).length < 2) throw new Error("schema");
  if (!/userText: userSummary/.test(s)) throw new Error("ctx.userText");
});

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
