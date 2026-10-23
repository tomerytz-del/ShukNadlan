/* ============================================================================
   התראת וואטסאפ על ליד מטופס מטא
   (supabase/functions/_shared/lead-alert.ts, wa-send.ts)

   מה שנשבר בשקט: פרמטר תבנית עם שורה חדשה נדחה על ידי Meta בדיוק מחוץ
   לחלון 24 השעות, ליד ישן מהסנכרון (48 שעות) היה מציף את תומר, וטופס
   "להתעלם" היה מקבל אותה הודעה כמו ליד אמיתי.

       node --experimental-strip-types scripts/meta_lead_alert_test.ts
   ========================================================================== */
import {
  alertKindAllowed,
  buildLeadAlert,
  decideLeadAlert,
  DEFAULT_ALERT_KINDS,
  inServiceWindow,
  leadAlertExpired,
  LEAD_ALERT_MAX_AGE_MS,
  LEAD_ALERT_WINDOW_MS,
  phoneDigits,
} from "../supabase/functions/_shared/lead-alert.ts";
import {
  flattenTemplateParam,
  leadAlertTemplateMessage,
} from "../supabase/functions/_shared/wa-send.ts";

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => {
  console.log((cond ? "✓ " : "✗ ") + name + (cond || got === undefined ? "" : `  (got ${JSON.stringify(got)})`));
  if (!cond) fail++;
};

const NOW = Date.parse("2026-10-23T12:00:00Z");
const fresh = new Date(NOW - 60_000).toISOString();
const recentChat = new Date(NOW - 60 * 60 * 1000).toISOString();

const fields = [
  { name: "full_name", values: ["דנה כהן"] },
  { name: "phone_number", values: ["0501234567"] },
  { name: "email", values: ["dana@example.com"] },
  { name: "עיר", values: ["עפולה"] },
  { name: "הערות", values: ["שורה ראשונה", "שורה שנייה"] },
  { name: "ריק", values: ["  "] },
];

// ---------------------------------------------------------------------------
// פרמטר תבנית: שורה אחת, בלי מקף ארוך, חיתוך בגבול תו
// ---------------------------------------------------------------------------
{
  const flat = flattenTemplateParam("א\nב\tג    ד");
  ok("שורה חדשה, טאב וארבעה רווחים נהיים שורה אחת", flat === "א ב ג   ד", flat);
  ok("אין ירידת שורה בפרמטר", !/[\r\n\t]/.test(flat));
  ok("פרמטר ריק הוא מקף", flattenTemplateParam("  \n  ") === "-");
  ok("מקף ארוך בפרמטר נהיה מקף רגיל", flattenTemplateParam("א—ב") === "א-ב");
  const emoji = "🔔".repeat(10);
  const cut = flattenTemplateParam(emoji, 4);
  ok("חיתוך אינו שובר אימוג'י", cut.endsWith("…") && Array.from(cut).length === 4, cut);
}

// ---------------------------------------------------------------------------
// תבנית ייעודית מול נפילה לתבנית ההתראות
// ---------------------------------------------------------------------------
{
  const params = ["טופס\nא", "מתווך/ת", "דנה", "050", "מייל: a@b.com\nעיר: עפולה"];
  const lead = leadAlertTemplateMessage("972546929991", params, { leadTemplate: "ads_lead_alert" });
  const tmpl = (lead.template as { name: string; language: { code: string }; components: any[] });
  ok("תבנית הליד בשם שהוגדר", tmpl.name === "ads_lead_alert");
  ok("שפת תבנית הליד היא he", tmpl.language.code === "he");
  ok("אין כפתור בתבנית הסטטית", tmpl.components.length === 1 && tmpl.components[0].type === "body");
  const body = tmpl.components[0].parameters.map((p: { text: string }) => p.text);
  ok("חמישה פרמטרים", body.length === 5, body);
  ok("פרמטר עם שורה חדשה שוטח", body[0] === "טופס א" && !body[4].includes("\n"), body);
  ok("הנמען הוא המספר", lead.to === "972546929991");

  const fallback = leadAlertTemplateMessage("972546929991", params, {
    notifyTemplate: "notify_he",
    notifyLang: "he",
  });
  const fb = (fallback.template as { name: string; components: any[] });
  ok("בלי תבנית ליד נופלים לתבנית ההתראות", fb.name === "notify_he");
  const fbBody = fb.components[0].parameters.map((p: { text: string }) => p.text);
  ok("נפילה: {{1}} הוא תומר", fbBody[0] === "תומר", fbBody);
  ok("נפילה: {{2}} מחבר את החמישה בנקודה אמצעית", fbBody[1].includes(" · ") && !fbBody[1].includes("\n"), fbBody[1]);
  const button = fb.components[1];
  ok("נפילה: סיומת הכפתור קבועה", button.sub_type === "url" && button.parameters[0].text === "crm?goto=accNotifPrefs", button);

  let threw = false;
  try {
    leadAlertTemplateMessage("972", params, {});
  } catch {
    threw = true;
  }
  ok("בלי אף תבנית נזרקת שגיאה", threw);
}

// ---------------------------------------------------------------------------
// נוסח, סוגים, גיל וחלון
// ---------------------------------------------------------------------------
{
  const built = buildLeadAlert({ formName: "מתווכים בעפולה", kind: "broker", fields });
  ok("הטקסט נפתח בהתראה", built.text.startsWith("🔔 ליד חדש ממטא"), built.text);
  ok("הטקסט רב-שורות", built.text.includes("\n"));
  ok("סוג מתווך/ת", built.text.includes("סוג: מתווך/ת"));
  ok("שם וטלפון ומייל בטקסט", built.text.includes("דנה כהן") && built.text.includes("0501234567") && built.text.includes("dana@example.com"));
  ok("תשובה אחרת נכנסת", built.text.includes("עיר: עפולה"));
  ok("שדה שם אינו מופיע שוב כתשובה", !built.text.includes("full_name:"));
  ok("שדה ריק אינו נכנס", !built.text.includes("ריק:"));
  ok("פרמטר 5 כולל מייל ותשובות", built.params[4].includes("מייל: dana@example.com") && built.params[4].includes("עיר: עפולה"), built.params[4]);
  ok("מפתחות השם והטלפון אינם בפרמטר 5", !built.params[4].includes("full_name") && !built.params[4].includes("phone_number"));

  const labels: Record<string, string> = {
    broker: "מתווך/ת",
    owner: "בעל/ת נכס",
    property: "פנייה על נכס",
    buyer: "מחפש/ת",
    unmapped: "טופס לא משויך",
  };
  for (const [kind, label] of Object.entries(labels)) {
    const row = buildLeadAlert({ formName: kind === "unmapped" ? "" : "טופס", kind, fields: [] });
    ok(`תווית ${kind}`, row.params[1] === label, row.params[1]);
  }
  ok("בלי שם טופס נכתב טופס לא משויך", buildLeadAlert({ kind: "unmapped", fields: [] }).params[0] === "טופס לא משויך");
  ok("בלי שם אדם נכתב לא צוין", buildLeadAlert({ kind: "buyer", fields: [] }).params[2] === "לא צוין");

  ok("ברירת המחדל כוללת unmapped ולא ignore", DEFAULT_ALERT_KINDS.includes("unmapped") && !DEFAULT_ALERT_KINDS.includes("ignore"));
  ok("בלי רשימה מתווך מותר ו-ignore לא", alertKindAllowed("broker", null) && !alertKindAllowed("ignore", null));
  ok("רשימה ריקה אינה מתירה דבר", !alertKindAllowed("broker", []));
  ok("מספר עם פלוס ומקפים", phoneDigits("+972-54-692-9991") === "972546929991");
  ok("ערך שאינו מחרוזת אינו מספר", phoneDigits({ n: 1 }) === "");

  ok("לפני 6 שעות בדיוק עדיין בחלון", !leadAlertExpired(new Date(NOW - LEAD_ALERT_MAX_AGE_MS).toISOString(), NOW));
  ok("אחרי 6 שעות נדחה", leadAlertExpired(new Date(NOW - LEAD_ALERT_MAX_AGE_MS - 1).toISOString(), NOW));
  ok("בלי created_time נדחה", leadAlertExpired(null, NOW));
  ok("שיחה מלפני שעה בחלון", inServiceWindow(recentChat, NOW));
  ok("שיחה מלפני 23 שעות בדיוק מחוץ לחלון", !inServiceWindow(new Date(NOW - LEAD_ALERT_WINDOW_MS).toISOString(), NOW));
  ok("בלי שיחה מחוץ לחלון", !inServiceWindow(null, NOW));

  const text = decideLeadAlert({
    createdTime: fresh, formName: "מתווכים בעפולה", kind: "broker", kinds: null,
    fields, lastMessageAt: recentChat, now: NOW,
  });
  ok("בתוך החלון יוצא טקסט חופשי", text.action === "text" && text.text.startsWith("🔔 ליד חדש ממטא"), text.action);

  const tmpl = decideLeadAlert({
    createdTime: fresh, formName: "מתווכים בעפולה", kind: "owner", kinds: null,
    fields, lastMessageAt: null, now: NOW,
  });
  ok("מחוץ לחלון יוצאת תבנית", tmpl.action === "template" && tmpl.params[1] === "בעל/ת נכס", tmpl.action);

  const old = decideLeadAlert({
    createdTime: new Date(NOW - LEAD_ALERT_MAX_AGE_MS - 1000).toISOString(),
    kind: "broker", kinds: null, now: NOW,
  });
  ok("ליד ישן מדולג", old.action === "skip" && old.reason === "expired", old);

  const ignored = decideLeadAlert({
    createdTime: fresh, kind: "ignore", kinds: null, now: NOW,
  });
  ok("ignore מדולג בברירת המחדל", ignored.action === "skip" && ignored.reason === "kind", ignored);

  const unmapped = decideLeadAlert({
    createdTime: fresh, formName: null, kind: "unmapped", kinds: null, fields, now: NOW,
  });
  ok("טופס לא משויך נשלח", unmapped.action === "template" && unmapped.params[1] === "טופס לא משויך", unmapped.action);
}

if (fail) {
  console.error(`\n${fail} בדיקות נכשלו`);
  process.exit(1);
}
console.log("\nהכל עבר");
