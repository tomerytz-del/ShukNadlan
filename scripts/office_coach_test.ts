/* ============================================================================
   ‏הבדיקה של supabase/functions/office-coach/payload.ts
   ----------------------------------------------------------------------------
   ‏שלושת המאמנים (סוכן/ת, צוות, משרד) מבטיחים דברים שאי אפשר לראות שנשברו:

     ‏· מה שיוצא למודל הוא אגרגטים ושמות סוכנים בלבד - בלי כותרת נכס, בלי
       שם או טלפון של לקוח/ה ובלי מזהים. שדה חדש שנוסף ל-office_dashboard
       לא עובר הלאה מעצמו.
     ‏· מה שנשמר ומוצג הוא עד 3 צעדים, בלי מקף ארוך, ותשובה ריקה או שבורה
       אינה נשמרת בכלל.
     ‏· כפתור רק מהרשימה הסגורה של אותו מאמן (CTA_KINDS), ו-ref רק מהאסימונים
       שנשלחו - שמומרים חזרה למזהה האמיתי. המודל לא רואה UUID.

   הרצה:

       node --experimental-strip-types scripts/office_coach_test.ts

   התיעוד: ‎docs/coaches.md‎, ‎docs/office-coach.md‎.
   ========================================================================== */

import {
  addDays,
  agentFingerprintSource,
  cleanSummaryV2,
  compactAgent,
  compactPeriod,
  compactTeams,
  CTA_KINDS,
  ctaKindsFor,
  monthlyTotals,
  previousTitles,
  Refs,
  summarySchema,
  targetPct,
} from "../supabase/functions/office-coach/payload.ts";
import { SYSTEM_PROMPTS } from "../supabase/functions/office-coach/prompts.ts";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    console.log(`✓ ${name}`);
  } else {
    failed++;
    console.log(`✗ ${name}`, detail ?? "");
  }
}

// ---------------------------------------------------------------------------
// compactPeriod: מה שיוצא למודל
// ---------------------------------------------------------------------------
const AGENT_ID = "11111111-1111-1111-1111-111111111111";
const dash = {
  period: { from: "2026-10-04", to: "2026-10-10" },
  agents: [
    {
      agent_id: AGENT_ID,
      agent: "דנה כהן",
      role: "manager",
      email: "dana@example.com",
      phone: "0501234567",
      photo_url: "https://example.com/dana.jpg",
      leads: 12,
      responded: 10,
      fast_15: 7,
      avg_response_min: 22,
      commission: 45000,
      target_note: null,
    },
  ],
  response_buckets: [
    { agent_id: AGENT_ID, bucket_order: 1, leads: 7 },
    { agent_id: "someone-else", bucket_order: 1, leads: 99 },
  ],
  lead_sources: [{ source: "אתר", leads: 12 }],
  expiring: [
    {
      agent_id: AGENT_ID,
      property_id: "22222222-2222-2222-2222-222222222222",
      title: "דירת 4 חדרים ברחוב הרצל 12",
      exclusivity_end: "2026-10-30",
      days_on_market: 40,
      showings: 3,
      asking_price: 1900000,
    },
  ],
  unanswered: [{ lead_id: "x", name: "ישראל ישראלי", phone: "0529999999" }],
};

const out = compactPeriod(dash);
const json = JSON.stringify(out);

for (const secret of [
  "dana@example.com",
  "0501234567",
  "dana.jpg",
  "הרצל",
  "ישראל ישראלי",
  "0529999999",
  AGENT_ID,
  "22222222-2222-2222-2222-222222222222",
]) {
  check(`לא יוצא למודל: ${secret}`, !json.includes(secret));
}
check("שם הסוכן/ת יוצא", out.agents[0].agent === "דנה כהן");
check("התפקיד מתורגם", out.agents[0].role === "מנהל/ת");
check("מדד יוצא", out.agents[0].leads === 12 && out.agents[0].commission === 45000);
check("ערך null אינו יוצא", !("target_note" in out.agents[0]));
check(
  "זמני התגובה של הסוכן/ת בלבד",
  JSON.stringify(out.agents[0].response_buckets) === JSON.stringify({ "1": 7 }),
  out.agents[0].response_buckets,
);
check(
  "בלעדיות שפוקעת: שם הסוכן/ת והמספרים, בלי כותרת",
  out.expiring.length === 1 && out.expiring[0].agent === "דנה כהן" && out.expiring[0].showings === 3,
  out.expiring,
);
check("נתונים חסרים אינם מפילים", compactPeriod({}).agents.length === 0);

// ---------------------------------------------------------------------------
// מין: רק male / female יוצאים, והתפקיד מוטה לפיו
// ---------------------------------------------------------------------------
const withGender = compactPeriod(dash, { [AGENT_ID]: "female" });
check("מין ידוע יוצא", withGender.agents[0].gender === "female", withGender.agents[0]);
check("התפקיד מוטה לפי המין", withGender.agents[0].role === "מנהלת", withGender.agents[0].role);
const junk = compactPeriod(dash, { [AGENT_ID]: "<script>" });
check("ערך מין לא חוקי אינו יוצא", !("gender" in junk.agents[0]) && junk.agents[0].role === "מנהל/ת", junk.agents[0]);
check("בלי מין - אין שדה ונשאר לוכסן", !("gender" in out.agents[0]) && out.agents[0].role === "מנהל/ת");

// ---------------------------------------------------------------------------
// monthlyTotals: סיכום כל הסוכנים לחודש, ממוין
// ---------------------------------------------------------------------------
const totals = monthlyTotals({
  monthly: [
    { month: "2026-09", agent_id: "a", leads: 3, deals: 1, commission: "1000" },
    { month: "2026-08", agent_id: "a", leads: 2 },
    { month: "2026-09", agent_id: "b", leads: 4, deals: null },
  ],
});
check("חודשים ממוינים", totals.map((t) => t.month).join(",") === "2026-08,2026-09", totals);
check("סכום לחודש", totals[1].leads === 7 && totals[1].deals === 1 && totals[1].commission === 1000, totals[1]);
check("אין agent_id בסיכום", !JSON.stringify(totals).includes("agent_id"));

// ---------------------------------------------------------------------------
// אסימונים במקום מזהים: משרד וצוות
// ---------------------------------------------------------------------------
const officeRefs = new Refs();
const withRefs = compactPeriod(dash, {}, officeRefs);
check("סוכן/ת מקבל/ת אסימון", withRefs.agents[0].ref === "S1", withRefs.agents[0]);
check("האסימון ממופה למזהה", officeRefs.map.S1?.id === AGENT_ID && officeRefs.map.S1?.type === "agent");
check("אותו/ה סוכן/ת - אותו אסימון", compactPeriod(dash, {}, officeRefs).agents[0].ref === "S1");
check("גם עם אסימונים המזהה לא יוצא", !JSON.stringify(withRefs).includes(AGENT_ID));

const teams = compactTeams({
  teams: [{ team_id: "33333333-3333-3333-3333-333333333333", name: "צפון", lead_member_id: AGENT_ID, lead: "דנה כהן",
    agents: 3, commission: 1000, commission_target: null }],
});
check("צוותים: שם, מנהל/ת ומספרים", teams[0].team === "צפון" && teams[0].lead === "דנה כהן" && teams[0].agents === 3, teams);
check("צוותים: בלי מזהים", !JSON.stringify(teams).includes("3333") && !JSON.stringify(teams).includes(AGENT_ID));
check("צוותים: null אינו יוצא", !("commission_target" in teams[0]));
check("עמידה ביעד", targetPct({ agents: [{ commission: 50, commission_target: 100 }, { commission: 999 }] }) === 0.5);
check("בלי יעד - null", targetPct({ agents: [{ commission: 50 }] }) === null);

// ---------------------------------------------------------------------------
// מאמן הסוכן/ת: מה יוצא למודל
// ---------------------------------------------------------------------------
const LEAD_ID = "44444444-4444-4444-4444-444444444444";
const PROP_ID = "55555555-5555-5555-5555-555555555555";
const AGR_ID = "66666666-6666-6666-6666-666666666666";
const AG_ID = "77777777-7777-7777-7777-777777777777";
const now = new Date("2026-10-18T06:00:00Z");
const myDash = (extra: Record<string, unknown> = {}) => ({
  period: { from: "2026-09-18", to: "2026-10-17" },
  me: {
    agent_id: AGENT_ID, agent: "דנה כהן", first_name: "דנה", email: "dana@example.com",
    leads: 9, responded: 8, avg_response_min: 14, commission: 30000, commission_target: null, open_unanswered: 1,
  },
  office_avg: null,
  todo: {
    leads: [{ kind: "lead", ref_id: LEAD_ID, created_at: "2026-10-18T03:00:00Z", lead_type: "property_inquiry",
      city: "עפולה", property: "דירת 4 חדרים ברחוב הרצל 12" }],
    exclusivity: [{ kind: "exclusivity", ref_id: PROP_ID, property: "דירת 4 חדרים ברחוב הרצל 12", city: "עפולה",
      ends_on: "2026-10-30", days_on_market: 40, showings: 2 }],
    agreements: [{ kind: "agreement", ref_id: AGR_ID, agreement_kind: "exclusive_sell", property: "הרצל 12",
      sent_at: "2026-10-15T06:00:00Z", viewed: true }],
    agenda: [{ kind: "agenda", ref_id: AG_ID, agenda_kind: "meeting", title: "פגישה עם ישראל ישראלי 0529999999",
      due_at: "2026-10-18T05:00:00Z" }],
  },
  ...extra,
});
const agentRefs = new Refs();
const agentOut = compactAgent(myDash(), myDash({ office_avg: { agents: 4, leads: 7, avg_response_min: 30 } }), "female", agentRefs, now);
const agentJson = JSON.stringify(agentOut);
for (const secret of [
  "dana@example.com", "דנה", "הרצל", "עפולה", "ישראל ישראלי", "0529999999", AGENT_ID, LEAD_ID, PROP_ID, AGR_ID, AG_ID,
]) {
  check(`סוכן/ת - לא יוצא למודל: ${secret}`, !agentJson.includes(secret));
}
const t = agentOut.todo as Record<string, Record<string, unknown>[]>;
check("ליד: אסימון, סוג ושעות המתנה", t.leads_waiting[0].ref === "L1" && t.leads_waiting[0].hours_waiting === 3, t.leads_waiting);
check("בלעדיות: ימים עד הפקיעה", t.exclusivity_ending[0].ref === "P1" && t.exclusivity_ending[0].days_left === 12, t.exclusivity_ending);
check("הסכם: ימים מאז השליחה ונצפה", t.agreements_unsigned[0].days_since_sent === 3 && t.agreements_unsigned[0].viewed === true);
check("יומן: באיחור, בלי כותרת", t.agenda_today[0].overdue === true && !("title" in t.agenda_today[0]));
check("ממוצע המשרד יוצא כשיש", (agentOut.last_30_days as Record<string, Record<string, unknown>>).office_avg?.agents === 4);
check("ממוצע null נשאר null", (compactAgent(myDash(), myDash(), null, new Refs(), now).last_30_days as Record<string, unknown>).office_avg === null);
check("מין יוצא רק כ-male/female", agentOut.gender === "female" && !("gender" in compactAgent(myDash(), myDash(), "x", new Refs(), now)));
check("מספר אישי יוצא", (agentOut.last_7_days as Record<string, Record<string, unknown>>).me.leads === 9);
check("null אינו יוצא", !("commission_target" in (agentOut.last_7_days as Record<string, Record<string, unknown>>).me));

// טביעת האצבע: הזמן שעבר לבדו אינו משנה אותה, ליד חדש כן
const later = compactAgent(myDash(), myDash({ office_avg: { agents: 4, leads: 7, avg_response_min: 30 } }), "female", new Refs(),
  new Date("2026-10-19T06:00:00Z"));
check("טביעת אצבע: רק הזמן עבר - זהה", agentFingerprintSource(later) === agentFingerprintSource(agentOut));
const moreLeads = myDash();
(moreLeads.me as Record<string, unknown>).leads = 10;
check("טביעת אצבע: מספר השתנה - שונה",
  agentFingerprintSource(compactAgent(myDash(), moreLeads, "female", new Refs(), now)) !== agentFingerprintSource(agentOut));

// ---------------------------------------------------------------------------
// cleanSummaryV2: מה שנשמר
// ---------------------------------------------------------------------------
const act = (cta: Record<string, unknown> | null, title = "צעד") => ({ priority: "high", title, why: "למה — כי", impact: "+2", cta });
const v2 = cleanSummaryV2({
  headline: "בוקר טוב — יש ליד שמחכה",
  summary: "סיכום",
  strength: "זמן תגובה",
  focus: "גיוס",
  actions: [
    act({ kind: "open_lead", ref: "L1" }),
    act({ kind: "open_lead", ref: "L9" }, "ref שלא נשלח"),
    act({ kind: "transfer_lead", ref: "L1" }, "כפתור שאינו ברשימה"),
    act({ kind: "open_lead" }, "רביעי"),
  ],
  questions: ["א", "ב", "ג", "ד"],
}, "agent", agentRefs.map);
check("v2: לכל היותר 3 צעדים", v2?.actions.length === 3, v2);
check("v2: ref הומר למזהה האמיתי", v2?.actions[0].cta?.ref === LEAD_ID, v2?.actions[0]);
check("v2: ref שלא נשלח - בלי כפתור, הצעד נשאר", v2?.actions[1].cta === null && v2?.actions[1].title === "ref שלא נשלח");
check("v2: כפתור שאינו ברשימה נמחק", v2?.actions[2].cta === null);
check("v2: אין מקף ארוך", v2 !== null && !/[–—―]/.test(JSON.stringify(v2)), v2);
check("v2: גרסה 2", v2?.v === 2);
check("v2: עד 3 שאלות", v2?.questions.length === 3);
check("v2: אין agenda לסוכן/ת", v2 !== null && !("agenda" in v2));

const refOfWrongType = cleanSummaryV2({ headline: "x", actions: [act({ kind: "open_property", ref: "L1" })] }, "agent", agentRefs.map);
check("v2: ref מסוג אחר - בלי כפתור", refOfWrongType?.actions[0].cta === null, refOfWrongType);
const optional = cleanSummaryV2({ headline: "x", actions: [act({ kind: "open_agenda", ref: "" })] }, "agent", agentRefs.map);
check("v2: כפתור עם ref לא חובה נשאר בלי ref", optional?.actions[0].cta?.kind === "open_agenda" && !optional?.actions[0].cta?.ref);
const agentOnly = cleanSummaryV2({ headline: "x", actions: [act({ kind: "open_lead", ref: "L1" })] }, "team", agentRefs.map);
check("v2: כפתור של סוכן/ת אינו עובר אצל מאמן הצוות", agentOnly?.actions[0].cta === null);
const team = cleanSummaryV2({
  headline: "x", actions: [act({ kind: "open_team_agent", ref: "S1" })], agenda: ["פתיחה — 5 דק׳", ""],
}, "team", officeRefs.map);
check("v2: צוות - סוכן/ת לפי אסימון", team?.actions[0].cta?.ref === AGENT_ID, team);
check("v2: צוות - סדר יום נוקה", JSON.stringify(team?.agenda) === JSON.stringify(["פתיחה - 5 דק׳"]), team?.agenda);
check("v2: עדיפות לא חוקית הופכת ל-mid",
  cleanSummaryV2({ headline: "x", actions: [{ ...act(null), priority: "urgent" }] }, "office")?.actions[0].priority === "mid");
check("v2: צעד בלי למה נזרק", cleanSummaryV2({ headline: "x", actions: [{ ...act(null), why: " " }] }, "office") === null);
check("v2: כותרת ריקה אינה נשמרת", cleanSummaryV2({ headline: " ", actions: [act(null)] }, "office") === null);
check("v2: תשובה שבורה אינה נשמרת", cleanSummaryV2(null, "office") === null && cleanSummaryV2({ headline: "x" }, "office") === null);
check("v2: טקסט ארוך נחתך", (cleanSummaryV2({ headline: "x", actions: [{ ...act(null), why: "a".repeat(2000) }] }, "office")?.actions[0].why.length ?? 0) === 400);

// הסיכום הקודם נקרא גם בחוזה הישן (v1)
check("previousTitles קורא v1", JSON.stringify(previousTitles({ headline: "x", points: [{ title: "א" }] })) === '["א"]');
check("previousTitles קורא v2", JSON.stringify(previousTitles({ actions: [{ title: "ב" }] })) === '["ב"]');
check("previousTitles בלי סיכום", previousTitles(null) === null);

// ---------------------------------------------------------------------------
// הרשימה הסגורה: סכמה, פרומפט ו-CTA_KINDS מסכימים
// ---------------------------------------------------------------------------
for (const kind of ["agent", "team", "office"] as const) {
  const schema = summarySchema(kind) as unknown as {
    properties: { actions: { items: { properties: { cta: { properties: { kind: { enum: string[] } } } } } } };
    required: string[];
  };
  const enumKinds = schema.properties.actions.items.properties.cta.properties.kind.enum;
  check(`${kind}: הסכמה מתירה רק את הכפתורים של המאמן הזה`,
    JSON.stringify(enumKinds) === JSON.stringify([...ctaKindsFor(kind), "none"]), enumKinds);
  for (const k of ctaKindsFor(kind)) {
    check(`${kind}: הפרומפט מתאר את ${k}`, SYSTEM_PROMPTS[kind].includes(k));
  }
  check(`${kind}: agenda רק בצוות`, schema.required.includes("agenda") === (kind === "team"));
  check(`${kind}: אין מקף ארוך בפרומפט`, !/[–—―]/.test(SYSTEM_PROMPTS[kind]));
  check(`${kind}: הפרומפט אוסר העברת ליד`, SYSTEM_PROMPTS[kind].includes("העברת ליד"));
}
check("אין העברת ליד ברשימת הכפתורים", !Object.keys(CTA_KINDS).some((k) => /transfer|route|assign/.test(k)));

// ---------------------------------------------------------------------------
// תאריכים
// ---------------------------------------------------------------------------
check("addDays חוצה חודש", addDays("2026-09-28", 7) === "2026-10-05");
check("addDays אחורה", addDays("2026-10-04", -7) === "2026-09-27");

if (failed) {
  console.log(`\n${failed} בדיקות נכשלו`);
  process.exit(1);
}
console.log("\n✓ office-coach (שלושת המאמנים): כל הבדיקות עברו");
