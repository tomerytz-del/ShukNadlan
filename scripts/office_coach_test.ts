/* ============================================================================
   ‏הבדיקה של supabase/functions/office-coach/payload.ts
   ----------------------------------------------------------------------------
   ‏המאמן השבועי מבטיח שני דברים שאי אפשר לראות שנשברו:

     ‏· מה שיוצא למודל הוא אגרגטים ושמות סוכנים בלבד - בלי כותרת נכס, בלי
       שם או טלפון של לקוח/ה ובלי מזהים. שדה חדש שנוסף ל-office_dashboard
       לא עובר הלאה מעצמו.
     ‏· מה שנשמר ומוצג למנהל/ת הוא עד 3 נקודות, בלי מקף ארוך, ותשובה ריקה
       או שבורה אינה נשמרת בכלל.

   הרצה:

       node --experimental-strip-types scripts/office_coach_test.ts

   התיעוד: ‎docs/office-coach.md‎.
   ========================================================================== */

import {
  addDays,
  cleanSummary,
  compactPeriod,
  monthlyTotals,
} from "../supabase/functions/office-coach/payload.ts";

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
// cleanSummary: מה שנשמר
// ---------------------------------------------------------------------------
const cleaned = cleanSummary({
  headline: "שבוע טוב — הלידים עלו",
  points: [
    { title: "א – ראשון", body: "גוף", owner: "דנה" },
    { title: "ב", body: "גוף", owner: "" },
    { title: "ג", body: "גוף", owner: "" },
    { title: "ד", body: "גוף", owner: "" },
  ],
});
check("לכל היותר 3 נקודות", cleaned?.points.length === 3, cleaned);
check("אין מקף ארוך בכותרת", cleaned !== null && !/[–—―]/.test(JSON.stringify(cleaned)), cleaned);
check("המקף הוחלף במקף רגיל", cleaned?.headline === "שבוע טוב - הלידים עלו", cleaned?.headline);
check("נקודה בלי גוף נזרקת", cleanSummary({ headline: "x", points: [{ title: "t", body: "  ", owner: "" }] }) === null);
check("כותרת ריקה אינה נשמרת", cleanSummary({ headline: " ", points: [{ title: "t", body: "b", owner: "" }] }) === null);
check("תשובה שבורה אינה נשמרת", cleanSummary(null) === null && cleanSummary({ headline: "x" }) === null);
check("טקסט ארוך נחתך", (cleanSummary({ headline: "x", points: [{ title: "t", body: "a".repeat(2000), owner: "" }] })?.points[0].body.length ?? 0) === 600);

// ---------------------------------------------------------------------------
// תאריכים
// ---------------------------------------------------------------------------
check("addDays חוצה חודש", addDays("2026-09-28", 7) === "2026-10-05");
check("addDays אחורה", addDays("2026-10-04", -7) === "2026-09-27");

if (failed) {
  console.log(`\n${failed} בדיקות נכשלו`);
  process.exit(1);
}
console.log("\n✓ office-coach: כל הבדיקות עברו");
