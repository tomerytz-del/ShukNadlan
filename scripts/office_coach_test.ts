/* ============================================================================
   ‏הבדיקה של supabase/functions/_shared/coach/payload.ts
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
  coachNotification,
  splitGap,
  agentFingerprintSource,
  cleanAnswer,
  cleanQuestion,
  cleanSummaryV2,
  compactAgent,
  compactPeriod,
  compactPlatform,
  compactTeams,
  newTriggers,
  platformTriggers,
  CTA_KINDS,
  ctaKindsFor,
  monthlyTotals,
  previousTitles,
  quietListings,
  Refs,
  summarySchema,
  summaryForAsk,
  askHistory,
  experienceLabel,
  targetPct,
} from "../supabase/functions/_shared/coach/payload.ts";
import { agentSystemPrompt, askSystemPrompt, cleanTone, PLATFORM_SYSTEM_PROMPT, SYSTEM_PROMPTS } from "../supabase/functions/_shared/coach/prompts.ts";
import { CSM_PLAYBOOK, MANAGER_PLAYBOOK, OFFICE_PLAYBOOK, PLAYBOOK, playbookFor, TOPICS } from "../supabase/functions/_shared/coach/playbook.ts";
import { CSM_SYSTEM, csmPortfolio } from "../supabase/functions/_shared/coach/csm-prompt.ts";
import { callAnalysisText, cleanCallAnalysis, csmCallSystem } from "../supabase/functions/_shared/csm-call-format.ts";
import { CSM_KIND_TIPS, callFollowupHint, kindTipLine } from "../supabase/functions/whatsapp-webhook/csm-tips.ts";
import { CSM_TIP_QUESTION } from "../supabase/functions/_shared/coach/csm-prompt.ts";
import { CSM_LINKS, csmLinkFor, csmLinkIsPublic, csmOutreachText, ilMobileDigits, waComposeUrl } from "../supabase/functions/whatsapp-webhook/csm-links.ts";
import { CSM_GREETING, CSM_TOOLS, csmCapabilities, gcalTemplateUrl, ilLocalToIso, isCapabilitiesQuestion } from "../supabase/functions/whatsapp-webhook/csm-tools.ts";
import { readFileSync } from "node:fs";

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
// נכסים שקטים: רק מהם מותר להציע קידום (promote_property)
const QUIET_ID = "77777777-7777-4777-8777-777777777777";
const listingRows = [
  { id: QUIET_ID, created_at: "2026-09-01T00:00:00Z", promoted_until: null, leads_14d: 0 },
  { id: "q-new", created_at: "2026-10-10T00:00:00Z", promoted_until: null, leads_14d: 0 },
  { id: "q-leads", created_at: "2026-08-01T00:00:00Z", promoted_until: null, leads_14d: 2 },
  { id: "q-promo", created_at: "2026-08-01T00:00:00Z", promoted_until: "2026-11-01T00:00:00Z", leads_14d: 0 },
  { id: "q-old-promo", created_at: "2026-07-01T00:00:00Z", promoted_until: "2026-09-01T00:00:00Z", leads_14d: 0 },
];
const quiet = quietListings(listingRows, now);
check("שקטים: 14 יום ומעלה, בלי ליד ובלי קידום פעיל, הוותיק קודם",
  quiet.map((q) => q.id).join(",") === "q-old-promo," + QUIET_ID, quiet);
const qRefs = new Refs();
const withQuiet = compactAgent(myDash(), myDash(), null, qRefs, now, listingRows);
const tq = (withQuiet.todo as Record<string, Record<string, unknown>[]>).listings_quiet;
check("שקטים: אסימון וימים בלבד, בלי מזהה", tq.length === 2 && /^P\d$/.test(String(tq[0].ref)) &&
  !JSON.stringify(withQuiet).includes(QUIET_ID), tq);
check("שקטים: ריק כשאין נכסים", (agentOut.todo as Record<string, unknown[]>).listings_quiet.length === 0);
const qLater = compactAgent(myDash(), myDash(), null, new Refs(), new Date("2026-10-19T06:00:00Z"), listingRows);
check("טביעת אצבע: יום נוסף של נכס שקט - זהה", agentFingerprintSource(qLater) === agentFingerprintSource(withQuiet));
const qTok = String(tq[0].ref);
const promoOk = cleanSummaryV2({ headline: "x", actions: [act({ kind: "promote_property", ref: qTok }, "לקדם את הנכס שפעיל 48 יום")] }, "agent", qRefs.map);
check("קידום: כפתור הקידום עם נכס שקט נשאר", promoOk?.actions[0].cta?.kind === "promote_property", promoOk?.actions[0]);
for (const wrong of ["open_prefs", "open_leads_unanswered"]) {
  const s = cleanSummaryV2({ headline: "x", actions: [act({ kind: wrong }, "קדם/י נכס אחד מתוך ה-13")] }, "agent", qRefs.map);
  check(`קידום: כפתור ${wrong} על צעד קידום יורד`, s?.actions[0].cta === null, s?.actions[0]);
}
const hop = cleanSummaryV2({ headline: "x", actions: [act({ kind: "open_prefs" }, "להקפיץ את המודעה")] }, "agent", qRefs.map);
check("קידום: גם 'להקפיץ'", hop?.actions[0].cta === null);
const progress = cleanSummaryV2({ headline: "x", actions: [act({ kind: "new_agenda_item" }, "לבדוק את ההתקדמות עם הבעלים")] }, "agent", qRefs.map);
check("קידום: 'התקדמות' אינה קידום - הכפתור נשאר", progress?.actions[0].cta?.kind === "new_agenda_item");
check("פרומפט הסוכן/ת: קידום רק מ-listings_quiet", /רק לנכס מ-listings_quiet/.test(SYSTEM_PROMPTS.agent));

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
// "שאל את המאמן" (coach-ask): מה יוצא עם השאלה, ומה חוזר
// ---------------------------------------------------------------------------
const askSummary = summaryForAsk({
  v: 2, headline: "h", summary: "s", strength: "x", focus: "y", questions: ["q"],
  actions: [{ priority: "high", title: "t", why: "w", impact: "i", cta: { kind: "open_lead", ref: LEAD_ID } }],
});
check("שאל: הסיכום יוצא בלי מזהי הכפתורים", askSummary !== null && !JSON.stringify(askSummary).includes(LEAD_ID), askSummary);
check("שאל: הצעדים יוצאים כטקסט", JSON.stringify((askSummary as Record<string, unknown>).actions) === '[{"title":"t","why":"w","impact":"i"}]');
check("שאל: סיכום v1 נקרא", (summaryForAsk({ headline: "h", points: [{ title: "a", body: "b", owner: "o" }] }) as Record<string, unknown>)?.points !== undefined);
check("שאל: בלי סיכום - null", summaryForAsk(null) === null);
check("שאל: שאלה נחתכת ל-300 ומנוקה", cleanQuestion("  א\nב " + "x".repeat(400)).length === 300 && !cleanQuestion("א\nב").includes("\n"));
const ans = cleanAnswer("## כותרת\n**חשוב** — כך\n* אחד\n\n\n\nשני");
check("שאל: התשובה בלי Markdown ובלי מקף ארוך", ans === "כותרת\nחשוב - כך\n- אחד\n\nשני", ans);
check("שאל: תשובה ארוכה נחתכת ב-2,400", cleanAnswer("a".repeat(3000)).length === 2400);
check("שאל: תשובה מקצועית של 250 מילים לא נחתכת", cleanAnswer("מילה ".repeat(250)).length < 2400);

// ידע מקצועי (playbook.ts) וטון (coach_preferences)
check("ידע: עמלה 2% ובלעדיות 4-6 חודשים", PLAYBOOK.includes("2%") && PLAYBOOK.includes("4-6 חודשים"));
check("ידע: מה לא אומרים בפגישת גיוס", PLAYBOOK.includes("אביא לך את המחיר שאתה רוצה") && PLAYBOOK.includes("ארד ל-1%"));
check("ידע: אין מקף ארוך", !/[–—―]/.test(PLAYBOOK));
check("ידע: תסריטים, קונים ומשא ומתן", ["תסריטי שיחה", "חידוש בלעדיות", "עבודה עם קונים", "הצעה נגדית", "שני קונים במקביל"].every((h) => PLAYBOOK.includes(h)));
check("ידע: 30 הימים הראשונים, דיווח שבועי והורדת מחיר", ["30 הימים הראשונים", "דיווח שבועי", "שיחת הורדת מחיר"].every((h) => PLAYBOOK.includes(h)));
check("ידע: שגרת עבודה, וליד שנכנס באמצע הבלוק מקבל מענה", PLAYBOOK.includes("שגרת עבודה") && PLAYBOOK.includes("זמן התגובה נמדד"));
// המנטור כותב בלי אימוג'י, ותבנית עם אימוג'י הייתה מלמדת אותו את ההפך
check("ידע: פחד משיחות בבוקר, בלי ההסבר ההורמונלי", PLAYBOOK.includes("call reluctance") && PLAYBOOK.includes("חוק 5 השניות") && !PLAYBOOK.includes("קורטיזול") && !PLAYBOOK.includes("אני יודע שקיבלת"));
check("ידע: גישור ומבוי סתום, בלי לחשוף קו אדום", ["BATNA", "שיחות נפרדות", "להקפיא ולעבור לסעיף אחר", "סכום בנאמנות", "מה שנאמר בחדר נשאר בחדר", "שאלות לשיחה הנפרדת", "בלי אישור מפורש ממך", "החזרה לחדר המשותף", "לחיצת יד היא לא חוזה"].every((h) => PLAYBOOK.includes(h)));
check("ידע: ניהול צוות רק למנהלים", ["ניהול צוות", "90 הימים הראשונים", "משחקן למאמן", "תוכנית התנעה", "שעות זהב", "לצפות - ", "אלה דוגמאות", "מחוץ למערכת", "בהסכמתם"].every((h) => MANAGER_PLAYBOOK.includes(h))
  && !askSystemPrompt("agent").includes("משחקן למאמן") && askSystemPrompt("team").includes("משחקן למאמן") && askSystemPrompt("office").includes("משחקן למאמן"));
check("ידע: ניהול צוות כללי, בלי שם של רשת, ובלי מקף ארוך", !/רימקס|RE\/MAX/i.test(MANAGER_PLAYBOOK) && !/[–—―]/.test(MANAGER_PLAYBOOK));
check("ידע: ניהול משרד רק למנטור המשרד", ["שרשרת פיקוד", "ישיבת מנהלים שבועית", "הסוכנים המייצרים", "תוכנית שיפור", "מחוץ למערכת", "שואלים", "ישיבת ההנהלה השבועית", "מיומנות ניהולית"].every((h) => OFFICE_PLAYBOOK.includes(h))
  && askSystemPrompt("office").includes("שרשרת פיקוד") && !askSystemPrompt("team").includes("שרשרת פיקוד") && !askSystemPrompt("agent").includes("שרשרת פיקוד")
  && !/[–—―]/.test(OFFICE_PLAYBOOK) && !/\p{Extended_Pictographic}/u.test(OFFICE_PLAYBOOK));
check("מנהל/ת שהוא/היא גם סוכן/ת: מנטור הסוכן/ת מקבל/ת ידע ניהול לפי manages",
  !askSystemPrompt("agent").includes("משחקן למאמן")
  && askSystemPrompt("agent", "warm", "team").includes("משחקן למאמן") && !askSystemPrompt("agent", "warm", "team").includes("שרשרת פיקוד")
  && askSystemPrompt("agent", "warm", "office").includes("שרשרת פיקוד")
  && askSystemPrompt("agent", "warm", "team").includes("בדאשבורד הצוות"));
check("מנהל/ת שהוא/היא גם סוכן/ת: מנטור הצוות והמשרד עונים על שאלת שטח ומפנים למספרים האישיים", ["team", "office"].every((k) => askSystemPrompt(k as "team" | "office").includes('ב"הדשבורד שלי"')) && !askSystemPrompt("agent").includes("רוב המנהלים הם גם סוכנים"));
// שאלה למנטור דרך גבריאלה: אותה פונקציה של ה-CRM, ולא בתורים שהטקסט בהם נכתב בידי אחרים
{
  const agentSrc = readFileSync(new URL("../supabase/functions/whatsapp-webhook/agent.ts", import.meta.url), "utf8");
  const emailSrc = readFileSync(new URL("../supabase/functions/whatsapp-webhook/email-intake.ts", import.meta.url), "utf8");
  const mediaSrc = readFileSync(new URL("../supabase/functions/whatsapp-webhook/media-intake.ts", import.meta.url), "utf8");
  const askSrc = readFileSync(new URL("../supabase/functions/coach-ask/index.ts", import.meta.url), "utf8");
  const set = (src: string, name: string) => (src.match(new RegExp(name + "[^=]*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\)")) || [])[1] || "";
  check("גבריאלה: ask_mentor מוגדר ומנותב, דרך askCoach המשותפת",
    agentSrc.includes('name: "ask_mentor"') && agentSrc.includes('case "ask_mentor"') && agentSrc.includes("askCoach(ctx.supabase, ctx.agent.id")
    && askSrc.includes("askCoach(service"));
  check("גבריאלה: ask_mentor לא בתור מייל ולא בתור הקלטה/מסמך",
    set(emailSrc, "EMAIL_TOOLS").length > 0 && set(mediaSrc, "MEDIA_TOOLS").length > 0
    && !set(emailSrc, "EMAIL_TOOLS").includes("ask_mentor") && !set(mediaSrc, "MEDIA_TOOLS").includes("ask_mentor"));
  // ask.ts נשען על Deno ועל npm:/jsr: - רץ רק תחת deno (ב-CI הבדיקה רצה ב-node)
  // deno-lint-ignore no-explicit-any
  const Deno = (globalThis as any).Deno;
  if (Deno) {
    const { askCoach } = await import("../supabase/functions/_shared/coach/ask.ts");
    const prevKey = Deno.env.get("ANTHROPIC_API_KEY");
    Deno.env.set("ANTHROPIC_API_KEY", "test");
    // deno-lint-ignore no-explicit-any
    const noDb = null as any;
    const badKind = await askCoach(noDb, "x", "boss" as "agent", "שאלה ארוכה מספיק");
    const badQ = await askCoach(noDb, "x", "agent", "א");
    check("askCoach: סוג ושאלה נבדקים לפני המסד", "error" in badKind && badKind.error === "bad_kind" && "error" in badQ && badQ.error === "bad_question");
    if (prevKey === undefined) Deno.env.delete("ANTHROPIC_API_KEY"); else Deno.env.set("ANTHROPIC_API_KEY", prevKey);
  }
}
check("המנטורים יודעים שאפשר לשאול דרך גבריאלה", askSystemPrompt("agent").includes("שאלה למנטור"));
{
  const n = coachNotification({ v: 2, headline: "יום\nשל גיוס", summary: "s", strength: "", focus: "f",
    actions: [{ priority: "high", title: "לחזור\nלליד", why: "", impact: "", cta: null }, { priority: "mid", title: "CMA לפגישה", why: "", impact: "", cta: null }],
    questions: [] });
  check("התראת הבוקר: שורה אחת, כותרת וצעדים ממוספרים", n.title === "המנטור: יום של גיוס" && n.body === "1. לחזור לליד · 2. CMA לפגישה" && !/\n/.test(n.title + n.body), n);
}
{
  const g = splitGap("[נושא חסר: עסקאות ירושה]\nעל זה עוד אין לי את השיטה.");
  const none = splitGap("תשובה רגילה [נושא חסר: באמצע] לא נחשבת");
  check("כשאין ידע: הסימון בשורה הראשונה יורד ונשמר", g.gap === "עסקאות ירושה" && g.answer === "על זה עוד אין לי את השיטה." && none.gap === null, g);
  check("כשאין ידע: הפרומפט אוסר להמציא ומגדיר את הסימון", ["agent", "team", "office"].every((k) => {
    const p = askSystemPrompt(k as "agent");
    return p.includes("[נושא חסר:") && p.includes("לא ממציאים") && p.includes("העברתי את הנושא לצוות") && !p.includes("ומתוך ניסיון בתיווך");
  }));
}
check("ידע: קרקע חקלאית - בדיקות, תקן 22, איחוד וחלוקה והיטלים, בלי מספרים שלא נבדקו",
  ["מכירת קרקע חקלאית", "תקן 22", "איחוד וחלוקה", "היטל השבחה", "מס שבח", "להמחשה בלבד", "לא מחשב/ת מס"].every((h) => PLAYBOOK.includes(h))
  && !PLAYBOOK.includes("7 ימים לפני") && !PLAYBOOK.includes("40+") && !PLAYBOOK.includes("בשנת 2016"));
check("ידע: נדל\"ן מסחרי - בדיקות, תמחור, שיווק ומסמך עקרונות שעלול לחייב",
  ["תיווך נדל\"ן מסחרי", "רישיון עסק", "NOI", "מסמך עקרונות", "עלול להיות מחייב", "ברוטו לנטו"].every((h) => PLAYBOOK.includes(h)) && !PLAYBOOK.includes("NOINOI"));
check("ידע: נחלה - הסדרה מול רמ\"י כתמונת מצב, בלי סיווג מלאכותי לבלעדיות ארוכה",
  ["נחלה ומשק חקלאי", "חלקה א'", "לבדוק בהחלטה העדכנית", "ועדת קבלה", "שאלה לעורך/ת דין, לא מכריעים לבד", "רק למי שהסכים לקבל"].every((h) => PLAYBOOK.includes(h))
  && !PLAYBOOK.includes("פרק משנה 8.4") && !PLAYBOOK.includes("בממוצע בין 6 ל-18"));
check("ידע: ניהול נכסים - סינון בלי הפליה ובלי ת.ז., סירוב אמיתי, בטוחות לפי החוק",
  ["ניהול נכסים למשכירים", "פרוטוקול מסירה", "לא שואלים על מצב משפחתי", "לא אוספים בשלב הסינון", "לא ממציאים \"הנכס כבר הובטח\"", "רק בהסכמה בכתב"].every((h) => PLAYBOOK.includes(h))
  && !PLAYBOOK.includes("ילדים וגילאיהם") && !PLAYBOOK.includes("90% מהתמונה"));
check("ידע: יד ראשונה - חוק המכר, גילוי שהעמלה מהיזם, דחיפות אמיתית ובלי מענה אוטומטי",
  ["מכירת דירות יד ראשונה", "פנקס השוברים", "מקבל/ת את העמלה מהיזם", "רק כשהיא אמיתית", "מענה אוטומטי ללידים אין במערכת", "מבצעי מימון"].every((h) => PLAYBOOK.includes(h))
  && !PLAYBOOK.includes("בעשרות אחוזים") && !PLAYBOOK.includes("24 ימים"));
check("ידע: מכירת עסק - דיסקרטיות, לא עסקת מקרקעין, ומתווה שלא מחתימים לבד",
  ["מכירת עסק פעיל", "אינה עסקת מקרקעין", "פרופיל \"עיוור\"", "נאכף רק כשהוא סביר", "ולא מחתימים עליו לבד"].every((h) => PLAYBOOK.includes(h))
  && !PLAYBOOK.includes("סעיף 30 לחוק מע\"מ"));
{
  const base = playbookFor("מה להכין לפגישת גיוס?");
  const agri = playbookFor("איך מוכרים שטח חקלאי");
  const lease = playbookFor("איך מסננים שוכר לדירה");
  const proj = playbookFor("ליד מקמפיין של פרויקט קבלן");
  const biz = playbookFor("רוצה למכור עסק פעיל של המוניטין");
  check("ידע לפי נושא: שאלה כללית - הליבה ורשימת הפרקים בלבד", base.topics.length === 0 && base.text.includes("פרקים נוספים בשיטה") && !base.text.includes("תקן 22") && base.text.includes("מה לא אומרים"), base.topics);
  check("ידע לפי נושא: כל פרק נבחר לפי השאלה", agri.topics.includes("agri") && lease.topics.includes("mgmt") && proj.topics.includes("newbuild") && biz.topics.includes("business") && playbookFor("נחלה במושב").topics.includes("nahala") && playbookFor("השכרת מחסן לוגיסטי").topics.includes("commercial"));
  check("ידע לפי נושא: שאלת המשך יורשת את הנושא מהשאלות הקודמות", askSystemPrompt("agent", "warm", null, "ואם הוא מסרב?\nאיך מוכרים שטח חקלאי").includes("תקן 22") && !askSystemPrompt("agent").includes("תקן 22"));
  check("ידע לפי נושא: הפרקים חוסכים - שאלה כללית קצרה בהרבה מכל הידע", base.text.length < PLAYBOOK.length * 0.7 && TOPICS.length === 6, [base.text.length, PLAYBOOK.length]);
}
check("ידע: בלי אימוג'י", !/\p{Extended_Pictographic}/u.test(PLAYBOOK));
// שני משפטים מהמקור שסותרים את "מה לא אומרים" - לא נכנסים בחזרה
check("ידע: לא מבטיחים קונה סגור, ולא ממציאים סיורים", !PLAYBOOK.includes("מתחייב להביא לך קונה") && !PLAYBOOK.includes("יש לי עוד שני סיורים"));
check("ידע: ארבעת צירי ההכשרה והתאמה לניסיון", PLAYBOOK.includes("ארבעה צירים") && PLAYBOOK.includes("experience בנתונים") && PLAYBOOK.includes("ותיק/ה"));
check("שאל agent: הוותק מתואר בפרומפט", askSystemPrompt("agent").includes("experience - כמה זמן"));
// הוותק: התשובה הפרטית במנטור גוברת על השנים שבפרופיל הציבורי
check("ותק: הטווח שנבחר גובר", experienceLabel("lt1", 12) === "פחות משנה");
check("ותק: בלי בחירה - מהשנים בפרופיל", experienceLabel(null, 0) === "פחות משנה" && experienceLabel(null, 3) === "שנה עד 5 שנים" && experienceLabel(undefined, 5) === "5 שנים ומעלה");
check("ותק: בלי כלום - null", experienceLabel(null, null) === null && experienceLabel("x", "") === null);
check("ידע: מפנים לעו\"ד/רו\"ח בשאלות משפטיות ומס", PLAYBOOK.includes("עורך/ת דין") && PLAYBOOK.includes("רואה/ת חשבון"));
check("טון: ברירת מחדל warm", cleanTone(undefined) === "warm" && cleanTone("x") === "warm" && cleanTone("direct") === "direct");
check("טון: direct בשאלה", askSystemPrompt("agent", "direct").includes("מאמן ישיר וקשוח") && !askSystemPrompt("agent", "direct").includes("חבר/ה מקצועי/ת וחם/ה"));
check("טון: warm כברירת מחדל בשאלה", askSystemPrompt("office").includes("חבר/ה מקצועי/ת וחם/ה"));
check("טון: הסיכום היומי נושא את הטון", agentSystemPrompt("direct").startsWith(SYSTEM_PROMPTS.agent) && agentSystemPrompt("direct").includes("מאמן ישיר"));
const hist = askHistory([
  { question: "ג", answer: "3" }, { question: "ב", answer: null }, { question: "א", answer: "1" }, { question: "ז", answer: "0" },
]);
// השורות מגיעות מהחדשה לישנה (order desc); בלי התשובה החסרה נשארות שלוש
check("שיחת המשך: מהישנה לחדשה, בלי שאלה בלי תשובה, עד 3", JSON.stringify(hist.map((m) => m.content)) ===
  JSON.stringify(["השאלה: ז", "0", "השאלה: א", "1", "השאלה: ג", "3"]), hist);
check("שיחת המשך: התורות מתחלפות", hist.every((m, i) => m.role === (i % 2 ? "assistant" : "user")));
for (const kind of ["agent", "team", "office"] as const) {
  const p = askSystemPrompt(kind);
  check(`שאל ${kind}: אותה רשימת כלים`, p.includes("גבריאלה אינה פונה ללידים") && p.includes("העברת ליד"));
  check(`שאל ${kind}: תשובה בלבד, בלי פעולות`, p.includes("לא מבצע/ת פעולות"));
  check(`שאל ${kind}: אין מקף ארוך בפרומפט`, !/[–—―]/.test(p));
  check(`שאל ${kind}: הידע המקצועי (הליבה) בפרומפט`, p.includes(playbookFor("").text));
}

// ---------------------------------------------------------------------------
// עלות AI לפי יכולת (docs/platform-costs.md): כל קריאה רושמת את טוקני המטמון
// בנפרד, אחרת ai_usage_costs מתמחר קריאת מטמון במחיר קלט מלא (פי 10)
// ---------------------------------------------------------------------------
{
  const askLib = readFileSync(new URL("../supabase/functions/_shared/coach/ask.ts", import.meta.url), "utf8");
  const coachFn = readFileSync(new URL("../supabase/functions/office-coach/index.ts", import.meta.url), "utf8");
  check("עלות: askCoach רושם טוקני מטמון", /cache_read_tokens:/.test(askLib) && /cache_write_tokens:/.test(askLib));
  // ‏3 טבלאות המנטורים של המשרדים, ו-platform_coach_summaries (שגם נרשמת ב-ai_usage_log)
  check("עלות: ארבעת הסיכומים רושמים טוקני מטמון",
    (coachFn.match(/cache_read_tokens: out\.cache_read_tokens/g) ?? []).length === 4);
  check("עלות: המנטור של הפלטפורמה ביומן ai_usage_log, כי ai_usage_costs לא קוראת את הטבלה שלו",
    /logAiUsage\(anthropicRow\("platform_coach"/.test(coachFn));
}

// ---------------------------------------------------------------------------
// אזור ההטמעה: המנטור, ניתוח ההקלטות וגבריאלה מול הצוות (docs/csm-adoption.md)
// ---------------------------------------------------------------------------
{
  const now = Date.parse("2026-10-18T09:00:00Z");
  const d = (n: number) => new Date(now - n * 86400000).toISOString();
  const rows = [
    { agent_id: "a1", display_name: "דנה", phone: "+972501234567", email: "dana@example.com", agency_id: "o1",
      agency_name: "משרד צפון", agency_address: "הרצל 1", agency_city: "עפולה", role: "manager", tier: "premium",
      joined_at: d(30), last_gabriela_at: d(1), gabriela_7d: 9, active_listings: 4, clients: 3, stage: "active_pilot", sessions: 1 },
    { agent_id: "a2", display_name: "יוסי", phone: "0527654321", email: "yossi@example.com", agency_id: "o1",
      agency_name: "משרד צפון", role: "agent", tier: "mid", joined_at: d(20), last_gabriela_at: d(9),
      gabriela_7d: 0, active_listings: 1, clients: 0, stage: "onboarded", sessions: 1, next_followup_at: d(1) },
    { agent_id: "a3", display_name: "חדשה", phone: "0520000000", agency_id: "o2", agency_name: "משרד דרום",
      role: "agent", tier: "free", joined_at: d(2), last_gabriela_at: null, stage: "registered" },
  ];
  const p = csmPortfolio(rows, [{ title: "שדה מחסן", category: "pilot_blocker", severity: "blocker", votes: 3 }], now);
  const out = JSON.stringify(p);
  check("מנטור ההטמעה: טלפון, מייל וכתובת לא יוצאים למודל",
    !/972501234567|0527654321|0520000000|example\.com|הרצל/.test(out), out);
  check("מנטור ההטמעה: מי בסיכון - 5 ימים בלי גבריאלה, ולא מי שהצטרף/ה לפני יומיים",
    p.at_risk.length === 1 && p.at_risk[0].name === "יוסי", p.at_risk);
  check("מנטור ההטמעה: משרד מסוכם עם מנהל/ת שמשתמש/ת וסוכנים פעילים",
    p.offices[0].office === "משרד צפון" && p.offices[0].manager_uses_gabriela === true && p.offices[0].agents_active_on_gabriela_7d === 1);
  check("מנטור ההטמעה: מועד קשר שהגיע, ובקשות פיתוח עם מספר המבקשים",
    p.followups_due.length === 1 && p.followups_due[0].name === "יוסי" && p.open_feedback[0].requested_by === 3);
  check("מנטור ההטמעה: הידע וסימון החוסר בפרומפט, בלי מקף ארוך",
    CSM_SYSTEM.includes(CSM_PLAYBOOK) && CSM_SYSTEM.includes("[נושא חסר:") && !/[–—]/.test(CSM_SYSTEM));
  check("מנטור ההטמעה: הידע שלו לא מגיע לשלושת המנטורים של הסוכנים",
    (["agent", "team", "office"] as const).every((k) => !askSystemPrompt(k, "warm", k === "agent" ? "office" : null, "גיוס משרד הטמעה").includes("משרדי מגדלור")));
  check("מנטור ההטמעה: בלי שם רשת ובלי אחוז שלא נמדד",
    !/רימקס|re\/max|אנגלו|century|keller/i.test(CSM_PLAYBOOK) && !/\d+%/.test(CSM_PLAYBOOK));

  // ניתוח הקלטה: רק השדות הצפויים, שלב רק מהרשימה, בלי מקף ארוך
  const a = cleanCallAnalysis({
    summary: "שיחה עם מנהל המשרד — סיכמנו פיילוט", mood: "hesitant", pains: ["אין זמן", ""],
    suggested_stage: "admin", followup_date: "2026-10-23", next_steps: [{ action: "פגישה", when: "מחר" }],
    feedback_items: [{ title: "שדה מחסן", severity: "huge" }], message_draft: "היי – נדבר בחמישי", extra: "x",
  });
  check("ניתוח הקלטה: ניקוי - מקף ארוך, שלב לא מוכר, תאריך לא תקין וחומרה לא מוכרת",
    !!a && !/[–—]/.test(JSON.stringify(a)) && a.suggested_stage === null && a.followup_date === "2026-10-23"
      && a.next_steps[0].when === null && a.feedback_items[0].severity === "usability" && a.pains.length === 1
      && !("extra" in (a as unknown as Record<string, unknown>)), a);
  check("ניתוח הקלטה: בלי סיכום - לא נשמר", cleanCallAnalysis({ mood: "positive" }) === null);
  check("ניתוח הקלטה: ההודעה בוואטסאפ עם הסיכום, הצעדים וההודעה לסוכן/ת",
    !!a && /סיכום השיחה עם דנה/.test(callAnalysisText(a, "דנה")) && /הודעה מוצעת/.test(callAnalysisText(a)));
  check("ניתוח הקלטה: הפרומפט עם השיטה ובלי מקף ארוך",
    csmCallSystem().includes(CSM_PLAYBOOK) && !/[–—]/.test(csmCallSystem()));

  const src = (f: string) => readFileSync(new URL("../supabase/functions/" + f, import.meta.url), "utf8");
  const agentSrc = src("whatsapp-webhook/agent.ts");
  const indexSrc = src("whatsapp-webhook/index.ts");
  const chatSrc = src("whatsapp-webhook/csm-chat.ts");
  const emailSrc = src("whatsapp-webhook/email-intake.ts");
  const mediaSrc = src("whatsapp-webhook/media-intake.ts");
  const wsSrc = src("csm-workspace/index.ts");
  check("גבריאלה לצוות ההטמעה: תור נפרד - העוזרת של הסוכנים לא נגעה בכלי ההטמעה",
    !/csm_|csm-tools|csm-chat/.test(agentSrc) && chatSrc.includes("tools: CSM_TOOLS"));
  const iAgent = indexSrc.indexOf('.eq("phone_e164", from)');
  const iStaff = indexSrc.indexOf('from("csm_staff")');
  const iPublic = indexSrc.indexOf("await handlePublicMessage(msg)");
  check("גבריאלה לצוות ההטמעה: מזוהה אחרי הסוכנים ולפני הבוט הציבורי",
    iAgent > 0 && iStaff > iAgent && iPublic > iStaff);
  check("גבריאלה לצוות ההטמעה: כלי ההטמעה לא בתור מייל ולא בתור הקלטה/מסמך",
    !/csm_/.test(emailSrc) && !/csm_/.test(mediaSrc));
  // "מה אפשר לעשות כאן": נוסח קבוע שמכסה כל כלי, ונשלח בהודעה הראשונה
  const caps = csmCapabilities("רותם", true);
  const capAreas: Record<string, RegExp> = {
    csm_overview: /תמונת מצב/, csm_find_agent: /סוכן\/ת או משרד/, csm_office: /משרד/, csm_set_stage: /שלב ומועד קשר/,
    csm_log_session: /לרשום פגישה/, csm_add_feedback: /בקשת פיתוח/, csm_recent_calls: /הקלטת שיחה/,
    csm_link_call: /הקלטת שיחה/, csm_ask_mentor: /המנטור/,
    csm_agenda_list: /היומן/, csm_agenda_add: /היומן/, csm_agenda_update: /היומן/,
    csm_notifications: /התראות/, csm_settings: /הגדרות/,
    csm_links: /קישורים לסוכנים/, csm_send_to_agent: /קישורים לסוכנים/, csm_draft_message: /הודעה לסוכן\/ת/,
  };
  check("גבריאלה לצוות ההטמעה: ההיכרות מפרטת כל כלי, בשם, בלי מקף ארוך",
    CSM_TOOLS.every((t) => capAreas[t.name] && capAreas[t.name].test(caps)) && /^היי רותם, אני גבריאלה/.test(caps)
      && !/[\u2013\u2014]/.test(caps) && !csmCapabilities(null, false).startsWith("היי"),
    CSM_TOOLS.map((t) => t.name).filter((n) => !capAreas[n]));
  check("גבריאלה לצוות ההטמעה: \"מה אפשר לעשות כאן\" מזוהה, ובקשה רגילה לא",
    ["מה אני יכולה לעשות כאן?", "מה אפשר לעשות פה", "מה את יודעת לעשות", "עזרה", "תפריט"].every(isCapabilitiesQuestion)
      && !["מי בסיכון?", "תני לי את הטלפון של יוסי", "מה אפשר לעשות עם יוסי?", "מה את יודעת על המשרד בעפולה?"].some(isCapabilitiesQuestion)
      && CSM_GREETING.test("היי") && !CSM_GREETING.test("היי, מי בסיכון?"));
  check("גבריאלה לצוות ההטמעה: ההיכרות בהודעה הראשונה ובשאלה, ולפני התור",
    chatSrc.indexOf("csmCapabilities(staff.display_name, first)") > 0
      && chatSrc.indexOf("csmCapabilities(staff.display_name, first)") < chatSrc.indexOf("answer = await runCsmTurn"));
  // היומן: שעון ישראל עם קיץ/חורף, וקישור Google בלי OAuth
  check("יומן ההטמעה: שעה מקומית → UTC בקיץ ובחורף, ותאריך לא תקין נדחה",
    ilLocalToIso("2026-07-01", "10:00") === "2026-07-01T07:00:00.000Z"
      && ilLocalToIso("2026-12-01", "10:00") === "2026-12-01T08:00:00.000Z"
      && ilLocalToIso("2026-13-01", "10:00") === null && ilLocalToIso("2026-12-01", "25:00") === null);
  const gurl = new URL(gcalTemplateUrl({ title: "פגישה עם יוסי", starts_at: "2026-12-01T08:00:00.000Z", duration_minutes: 45, location: "עפולה" }));
  check("יומן ההטמעה: קישור \"הוספה ליומן Google\" עם הכותרת והטווח",
    gurl.host === "calendar.google.com" && gurl.searchParams.get("text") === "פגישה עם יוסי"
      && gurl.searchParams.get("dates") === "20261201T080000Z/20261201T084500Z", gurl.toString());
  const toolsSrc = src("whatsapp-webhook/csm-tools.ts");
  check("יומן ההטמעה: גבריאלה כותבת ומעדכנת רק פגישות של אשת הצוות שמולה",
    /\.eq\("staff_id", staff\.id\)\.maybeSingle\(\)/.test(toolsSrc) && /staff_id: staff\.id, agent_id/.test(toolsSrc)
      && /p_allow_phone: false/.test(toolsSrc));
  // קישורים לסוכנים: רשימה סגורה, וכל קישור הוא דף אמיתי או מסך שקיים ב-CRM
  const root = (f: string) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
  const crmHtml = root("crm.html");
  const deadLinks = CSM_LINKS.filter((l) => l.path).filter((l) => {
    const [page, query] = l.path.split("?");
    const goto = /goto=(acc[A-Za-z]+)/.exec(query || "")?.[1];
    if (goto) return !crmHtml.includes(`id="${goto}"`);
    const file = page === "/" ? "index.html" : page.slice(1) + ".html";
    try { root(file); return false; } catch { return true; }
  }).map((l) => l.key);
  check("קישורים לסוכנים: כל קישור הוא דף באתר או מסך ב-CRM", deadLinks.length === 0, deadLinks);
  check("קישורים לסוכנים: דף אישי רק עם slug, ומפתח לא מוכר נדחה",
    csmLinkFor("agent_page", {}) === null && csmLinkFor("agent_page", { agent_slug: "יוסי-כהן" })?.url === "https://shuknadlan.co.il/agent?slug=" + encodeURIComponent("יוסי-כהן")
      && csmLinkFor("https://evil.example") === null && csmLinkFor("crm_properties")?.path === "/crm?goto=accProperties");
  const outreach = csmOutreachText("עופרי", "היי יוסי — הנה המסך", csmLinkFor("crm_properties"));
  check("קישורים לסוכנים: ההודעה בשם אשת הצוות, עם הקישור ובלי מקף ארוך",
    /עופרי, צוות ההטמעה/.test(outreach) && outreach.includes("https://shuknadlan.co.il/crm?goto=accProperties") && !/[\u2013\u2014]/.test(outreach), outreach);
  check("קישורים: למי שעוד לא במערכת - רק דף ציבורי, נייד ישראלי, וקישור לשליחה מהטלפון שלה",
    csmLinkIsPublic("pricing") && csmLinkIsPublic("signup") && !csmLinkIsPublic("crm_properties") && !csmLinkIsPublic("agent_page")
      && ilMobileDigits("052-123-4567") === "972521234567" && ilMobileDigits("+972 52 1234567") === "972521234567"
      && ilMobileDigits("04-6543210") === null
      && waComposeUrl("972521234567", "היי").startsWith("https://wa.me/972521234567?text=%D7%94")
      && !/הודעה מ/.test(csmOutreachText("עופרי", "היי", csmLinkFor("pricing"), true)));
  // עצה מהמנטור: שורה קבועה לכל סוג, זהה בוואטסאפ ובפעמון; והעצה היומית
  const csmJs = root("assets/crm-csm.js");
  const jsTips = /const CSM_NOTIF_TIP = \{([\s\S]*?)\n\};/.exec(csmJs)?.[1] || "";
  check("עצה מהמנטור: אותו נוסח בפעמון (crm-csm.js) ובוואטסאפ (csm-tips.ts), בלי מקף ארוך ובלי אחוזים",
    Object.entries(CSM_KIND_TIPS).every(([k, t]) => jsTips.includes(`${k}: '${t.replace(/'/g, "\\'")}'`))
      && (jsTips.match(/^\s+[a-z_]+:/gm) || []).length === Object.keys(CSM_KIND_TIPS).length
      && Object.values(CSM_KIND_TIPS).every((t) => !/[\u2013\u2014]|\d+%/.test(t))
      && kindTipLine("daily_digest") === "" && /^💡 המנטור:/.test(kindTipLine("at_risk")),
    jsTips);
  check("עצה מהמנטור: שאלת הבוקר קצרה, עם שמות מהנתונים ובלי מקף ארוך, ו\"שלחי לו\" אחרי סיכום",
    /שלוש עצות/.test(CSM_TIP_QUESTION) && /שם מהנתונים/.test(CSM_TIP_QUESTION) && !/[\u2013\u2014]/.test(CSM_TIP_QUESTION)
      && /שלחי לו/.test(callFollowupHint("יוסי")) && /input\.call_id/.test(toolsSrc));
  check("קישורים לסוכנים: שליחה רק אחרי אישור - confirmed בכלי, ובפרומפט",
    /input\.confirmed !== true/.test(toolsSrc) && /confirmed=true/.test(chatSrc));
  check("אזור ההטמעה: אשת הצוות נגזרת מה-JWT, לא מה-body",
    /\.eq\("user_id", userData\.user\.id\)/.test(wsSrc) && !/body\.staff_id/.test(wsSrc));
}

// ---------------------------------------------------------------------------
// מנהל/ת הפלטפורמה (?kind=platform): אגרגטים בלבד, חריגות, וכפתורים משלו
// ---------------------------------------------------------------------------
{
  const raw = {
    generated_at: "2026-10-22T08:00:00Z",
    cc: {
      marketplace: { agents_active: 60, agencies: 35, leads_30d: 34, leads_prev_30d: 60, paying: 0, on_promo: 50,
        response: { total: 34, measured: 5, within_12h: 4, median_hours: 2.1, secret: "x" }, owner_phone: "0501234567" },
      health: { findings_high: 1, findings_medium: 3, cron_failed_24h: ["deals-sync"], markets_errors: 0,
        news_last_at: "2026-10-22T02:00:00Z" },
    },
    report: {
      months: [{ month: "2026-08", leads_total: 1 }, { month: "2026-09", leads_total: 60, agencies_new: 5 },
        { month: "2026-10", leads_total: 34, revenue_total: 140, leads: { rss: 0 } }],
      agencies: [{ name: "משרד הדוגמה בע\"מ", agents: 4 }],
    },
    counts: { total: 3, overdue: 2, kinds: { refund: { total: 2, overdue: 2 }, article: { total: 0, overdue: 0 },
      license_appeal: { total: 1, overdue: 0 } } },
    growth: {
      funnel: { "30d": { signed: 23, licensed: 22, first_property: 14, paying: 0 }, all: { signed: 33 } },
      markets: [{ slug: "afula-emek", agencies: 32, agents: 55, props_active: 207, props_new_30d: 132, leads_30d: 37 },
        { slug: "safed", agencies: 0, agents: 0, props_active: 0, leads_30d: 0 }],
      stuck_license: [{ id: "4ac2f5e9-9759-41bd-a6d1-5189f50ef11b", name: "משרד תקוע", slug: "stuck" }],
      campaigns: [{ name: "קמפיין סודי" }],
    },
    budget: { categories: [{ key: "ai", spent: 1633, budget: 1250, pct: 131, approved: false },
      { key: "infra", spent: 1780, budget: 1350, pct: 132, approved: true }] },
    ads: { total: 546.99, channels: [{ channel: "google", spend: 454, clicks: 67, leads: 0,
      campaigns: [{ name: "שוק נדלן | גיוס מתווכים", spend: 231 }] }] },
  };
  const refs = new Refs();
  const p = compactPlatform(raw, refs, { "afula-emek": ["עפולה", "בית שאן", "עפולה עילית", "גבע"] });
  const out = JSON.stringify(p);
  check("מנהל/ת הפלטפורמה: בלי שם משרד, שם קמפיין, טלפון או מזהה",
    !out.includes("משרד הדוגמה") && !out.includes("משרד תקוע") && !out.includes("קמפיין סודי")
      && !out.includes("גיוס מתווכים") && !out.includes("0501234567") && !out.includes("4ac2f5e9") && !out.includes("secret"), out);
  check("מנהל/ת הפלטפורמה: לידים לסוכן/ת - המדד המרכזי", (p.marketplace_30_days as Record<string, unknown>).leads_per_agent === 0.57);
  check("מנהל/ת הפלטפורמה: רק שווקים עם פעילות, עם עד 3 ערים, ו-ref שהוא ה-slug",
    p.markets.length === 1 && p.markets[0].ref === "afula-emek" && p.markets[0].cities.length === 3 && p.markets_planned_empty === 1);
  check("מנהל/ת הפלטפורמה: חודשיים אחרונים בלבד, בלי פירוט הלידים", p.months.length === 2 && !("leads" in p.months[1]));
  check("מנהל/ת הפלטפורמה: תיבת המשימות - רק סוגים עם פריטים", p.inbox.kinds.map((k) => k.ref).join() === "refund,license_appeal");
  check("מנהל/ת הפלטפורמה: רישיון תקוע נספר ולא נקרא בשמו", p.recruitment.license_stuck === 1);
  const trig = platformTriggers(p);
  check("חריגות: איחור בתיבה, ממצא, cron, תקציב מאושר מעל 100% וירידת לידים - לא תקציב שלא אושר",
    trig.join() === ["budget_over:infra", "cron_failed", "findings_high", "inbox_overdue:refund", "leads_drop"].join(), trig);
  check("חריגות: מה שכבר היה בסיכום האחרון אינו חדש",
    newTriggers(trig, ["cron_failed", "findings_high", "inbox_overdue:refund", "leads_drop", "budget_over:infra"]).length === 0
      && newTriggers(trig, null).length === 5 && newTriggers(["findings_high"], ["cron_failed"]).join() === "findings_high");
  const ps = cleanSummaryV2({
    headline: "שבוע של גיוס", summary: "", strength: "", focus: "", questions: [],
    actions: [
      { priority: "high", title: "בקשות החזר שמחכות", why: "שתיים חרגו", impact: "", cta: { kind: "open_inbox", ref: "refund" } },
      { priority: "mid", title: "שוק שלא קיים", why: "x", impact: "", cta: { kind: "open_market", ref: "tel-aviv" } },
      { priority: "win", title: "ליד", why: "x", impact: "", cta: { kind: "open_lead", ref: "afula-emek" } },
    ],
  }, "platform", refs.map);
  check("מנהל/ת הפלטפורמה: כפתור מהרשימה שלו, ref רק משוק או סוג שנשלחו",
    ps?.actions[0].cta?.kind === "open_inbox" && ps?.actions[0].cta?.ref === "refund"
      && ps?.actions[1].cta === null && ps?.actions[2].cta === null, ps);
  check("מנהל/ת הפלטפורמה: הכפתורים של המשרדים אינם שלו, ושלו אינם של המשרדים",
    !ctaKindsFor("platform").includes("open_lead") && !ctaKindsFor("office").includes("open_inbox")
      && ctaKindsFor("platform").sort().join() === "new_campaign,open_content,open_costs,open_health,open_inbox,open_market");
  check("מנהל/ת הפלטפורמה: הפרומפט - לידים לסוכן/ת, שבועי וחריגה, ובלי מקף ארוך",
    PLATFORM_SYSTEM_PROMPT.includes("המדד המרכזי הוא לידים לסוכן/ת") && PLATFORM_SYSTEM_PROMPT.includes("new_exceptions")
      && !/[\u2013\u2014]/.test(PLATFORM_SYSTEM_PROMPT));
  check("מנהל/ת הפלטפורמה: כל כפתור בסכמה מתואר בפרומפט",
    ctaKindsFor("platform").every((k) => PLATFORM_SYSTEM_PROMPT.includes("- " + k)));
  const ui = readFileSync(new URL("../assets/crm-coach.js", import.meta.url), "utf8");
  check("מנהל/ת הפלטפורמה: כל כפתור קיים גם ב-COACH_CTA",
    ctaKindsFor("platform").every((k) => new RegExp("\\b" + k + ":\\s*\\{").test(ui)));
}

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
