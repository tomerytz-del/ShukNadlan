// update_lead: בניית הבקשה, תרגום התשובות, ושהכלי רשום נכון (לא במייל, כן ב-MUTATING_TOOLS).
//   node --experimental-strip-types scripts/lead_update_test.ts
import { readFileSync } from "node:fs";
import {
  buildLeadUpdatePayload, LEAD_EDITABLE_KEYS, leadUpdateReply,
} from "../supabase/functions/whatsapp-webhook/lead-update.ts";

let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok  ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL ${name}\n  ${(err as Error).message}`);
  }
}
function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("הבקשה כוללת רק מפתחות שנשלחו, ושדה שלא נאמר אינו מגיע למסד", () => {
  const p = buildLeadUpdatePayload({ lead_id: "x", city: "עפולה" });
  assert(JSON.stringify(p) === JSON.stringify({ city: "עפולה" }), JSON.stringify(p));
  assert(!("lead_id" in p), "lead_id אינו שדה של הליד");
});

test("מחרוזת ריקה נשמרת (ניקוי שדה), ומספר חדרים עובר", () => {
  const p = buildLeadUpdatePayload({ lead_id: "x", city: "", rooms: 4.5 });
  assert(p.city === "" && p.rooms === 4.5, JSON.stringify(p));
});

test("מפתחות זרים וערכים מסוג אחר נזרקים", () => {
  const p = buildLeadUpdatePayload({
    lead_id: "x", status: "masked", agent_id: "evil", source: "website", raw_phone: "0501111111",
    city: { a: 1 }, phone: null, rooms: Number.NaN, notes: ["a"], full_name: "דנה",
  });
  assert(JSON.stringify(p) === JSON.stringify({ full_name: "דנה" }), JSON.stringify(p));
});

test("תשובת הצלחה: שמות שדות בעברית ובלי מזהה בהנחיה", () => {
  const r = leadUpdateReply({ success: true, lead_id: "l1", changed: ["city", "phone"] });
  assert(r.ok === true && JSON.stringify((r as { changed: string[] }).changed) === JSON.stringify(["עיר", "טלפון"]), JSON.stringify(r));
});

test("כפילות: ok true (תוצאה נכונה, לא כשל כלי), ולא עודכן", () => {
  const r = leadUpdateReply({ success: false, duplicate: true, lead_id: "l2", full_name: "דנה" }) as Record<string, unknown>;
  assert(r.ok === true && r.updated === false && r.duplicate === true && r.full_name === "דנה", JSON.stringify(r));
});

test("כל קוד שגיאה של המסד מתורגם להנחיה, ושגיאה לא מוכרת היא update_failed", () => {
  for (const code of ["lead_not_found", "not_editable", "locked", "archived", "bad_phone", "name_or_phone_required",
    "bad_rooms", "bad_deal_type", "nothing_to_update"]) {
    const r = leadUpdateReply({ success: false, error: code }) as { ok: boolean; error: string; guidance?: string };
    assert(r.ok === false && r.error === code && !!r.guidance, `${code}: ${JSON.stringify(r)}`);
  }
  const u = leadUpdateReply({ success: false, error: "weird" }) as { error: string };
  assert(u.error === "update_failed", "ברירת מחדל");
  assert((leadUpdateReply(null) as { error: string }).error === "update_failed", "null (שגיאת RPC)");
});

test("ליד שאינו מהזנה עצמית: ההנחיה אומרת למה ולאן לפנות", () => {
  const r = leadUpdateReply({ success: false, error: "not_editable", source: "website" }) as { guidance: string };
  assert(/הזין\/ה בעצמו\/ה/.test(r.guidance) && /CRM/.test(r.guidance), r.guidance);
});

test("הכלי: בסכמה כל השדות שהמודל יכול לשלוח, ובשום מקום לא כתוב ליד שאינו שלו", () => {
  const agent = read("supabase/functions/whatsapp-webhook/agent.ts");
  const start = agent.indexOf('name: "update_lead"');
  assert(start > 0, "update_lead לא מוגדר");
  const block = agent.slice(start, agent.indexOf('name: "open_demand_leads"', start));
  for (const k of LEAD_EDITABLE_KEYS) assert(new RegExp(`\\b${k}:`).test(block), `${k} חסר בסכמה`);
  assert(/required: \["lead_id"\]/.test(block), "lead_id חובה");
  assert(/case "update_lead": return await toolUpdateLead\(ctx, input\)/.test(agent), "dispatch");
  assert(/p_agent_id: ctx\.agent\.id/.test(agent.slice(agent.indexOf("async function toolUpdateLead"))),
    "ה-RPC חייב לקבל את הסוכן/ת מההקשר ולא מהמודל");
});

test("list_leads: חיפוש לפי שם, מצב עריכה בלי כפתורי CRM, והשורה הקיימת ו-source חוזרים למודל", () => {
  const agent = read("supabase/functions/whatsapp-webhook/agent.ts");
  const start = agent.indexOf("async function toolListLeads");
  const body = agent.slice(start, agent.indexOf("async function toolListNotifications", start));
  assert(/property_details/.test(body) && /details: l\.property_details/.test(body), "details חייב להגיע למודל (update_lead מחליף אותו כולו)");
  assert(/source: l\.source/.test(body), "source (agent_entered) חייב להגיע למודל");
  assert(/input\.query/.test(body) && /display_name\.ilike/.test(body), "חיפוש לפי שם");
  assert(/&& !forEdit/.test(body), "for_edit לא שולח כפתורי CRM");
  assert(/replace\(\/\[,\(\)\*%/.test(body), "ניקוי תווים של מסנן ה-or");
  const tool = agent.slice(agent.indexOf('name: "update_lead"'), agent.indexOf('name: "open_demand_leads"'));
  assert(/details ו-notes מחליפים את הקיים כולו/.test(tool), "התיאור אומר שהם מחליפים");
});

test("המיגרציה: ארכיון וטלפון לא תקין נדחים, ושינוי חדרים מעדכן את הקטע בשורת הפרטים", () => {
  const sql = read("supabase/migrations/20271201100000_agent_lead_update.sql");
  assert(/'archived'/.test(sql) && /lead_archives/.test(sql), "ארכיון");
  assert(/'bad_phone'/.test(sql) && /normalize_msisdn\(v_phone\) is null/.test(sql), "טלפון לא תקין");
  assert(/חדרים\$'/.test(sql) && /v_details/.test(sql), "סנכרון חדרים בשורת הפרטים");
});

test("update_lead אינו בתור המייל (טקסט של אחרים) וכן ב-MUTATING_TOOLS", () => {
  const email = read("supabase/functions/whatsapp-webhook/email-intake.ts");
  const set = email.slice(email.indexOf("export const EMAIL_TOOLS"), email.indexOf("]);", email.indexOf("export const EMAIL_TOOLS")));
  assert(!/update_lead/.test(set), "update_lead נכנס ל-EMAIL_TOOLS: הוראה במייל של אחר/ת הייתה משנה טלפון של ליד");
  const lookup = read("supabase/functions/whatsapp-webhook/lookup_turn.ts");
  assert(/"update_lead"/.test(lookup.slice(lookup.indexOf("MUTATING_TOOLS"))), "חסר ב-MUTATING_TOOLS");
});

test("המיגרציה: רק ליד של הסוכן/ת, מהזנה עצמית, פתוח, עם נעילה ובדיקת כפילות, ורק service_role", () => {
  const sql = read("supabase/migrations/20271201100000_agent_lead_update.sql");
  assert(/l\.agent_id is distinct from p_agent_id/.test(sql), "בעלות");
  assert(/l\.source is distinct from 'agent_entered'/.test(sql), "מהזנה עצמית בלבד");
  assert(/l\.status <> 'unlocked'/.test(sql), "פתוח בלבד");
  assert(/for update/.test(sql), "נעילת שורה");
  assert(/pg_advisory_xact_lock/.test(sql) && /d\.id <> l\.id/.test(sql), "כפילות, לא מול עצמו");
  assert(/revoke all on function public\.agent_lead_update\(uuid, uuid, jsonb\) from public, anon, authenticated/.test(sql), "revoke");
  assert(!/insert into public\.notifications/.test(sql), "עריכה אינה יוצרת התראה");
});

if (failed) {
  console.error(`נכשלו ${failed}`);
  process.exit(1);
}
console.log("עבר");
