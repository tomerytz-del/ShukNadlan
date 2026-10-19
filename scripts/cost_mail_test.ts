/* ============================================================================
   הבדיקה של קליטת הקבלות ל-+costs
   (supabase/functions/whatsapp-webhook/cost-mail.ts, ‏docs/platform-costs.md)

   המקרה שנכשל בשקט ב-18.10.2026: הסוכן של תומר העביר כ-200 קבלות, וכל
   אחת שנקלטה נכנסה כ"אחר" בלי סכום. שתי סיבות, ושתיהן נבדקות כאן על
   ההודעה בצורה שבה היא הגיעה:

   - השולח המקורי כתוב בשורת "מקור:" ולא "From:" / "מאת:"
   - חלק הטקסט הוא רק כותרת ההעברה; הקבלה עצמה בחלק ה-HTML
     (‏receiptText מחבר את שניהם - כאן ה-HTML כבר אחרי htmlToText)

   ומה שאסור שישתנה בדרך: התראת ה-top-up של Netlify (אותו חיוב כמו הקבלה)
   אינה נספרת פעמיים, חשבונית ואישור סליקה שאנחנו הנפקנו אינם הוצאה, וקבלה
   מספק מוכר שלא הועברה עדיין נקראת כמו קודם.

       node --experimental-strip-types scripts/cost_mail_test.ts
   ========================================================================== */
import {
  forwardedSender,
  parseCostMail,
  receiptText,
} from "../supabase/functions/whatsapp-webhook/cost-mail.ts";

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => {
  console.log((cond ? "✓ " : "✗ ") + name + (cond || got === undefined ? "" : `  (got ${JSON.stringify(got)})`));
  if (!cond) fail++;
};

/** כותרת ההעברה של הסוכן, כמו בחלק הטקסט של ההודעה האמיתית. */
const agentHeader = (from: string, subject: string) =>
  `הודעה זו הועברה אוטומטית על ידי הסוכן של תומר לצורך מעקב הוצאות אתר שוק הנדל"ן.\n` +
  `מקור: ${from}\n` +
  `תאריך מקורי: Sun, 18 Oct 2026 09:45:32 +0000\n` +
  `נושא מקורי: ${subject}\n\n` +
  `המייל המקורי מצורף בשלמותו למטה.\n${subject}`;

// ---------------------------------------------------------------------------
// השולח המקורי
// ---------------------------------------------------------------------------

ok("מקור: עם שם במירכאות", forwardedSender(agentHeader(`"Netlify, Inc." <noreply@netlify.com>`, "x")) === "noreply@netlify.com");
ok("מקור: בלי רווח לפני <", forwardedSender(agentHeader(`נייטס אנטרטיינמנט בע״מ<notify@morning.co>`, "x")) === "notify@morning.co");
ok(
  "מאת: עם סימן כיוון בתחילת השורה",
  forwardedSender("---------- הודעה שהועברה ---------\n‏מאת: ‏Netlify‏ <noreply@netlify.com>") === "noreply@netlify.com",
);
ok(
  "From: של Gmail נשאר כמו שהיה",
  forwardedSender("---------- Forwarded message ---------\nFrom: Supabase <invoice+statements@supabase.com>\nDate: x") ===
    "invoice+statements@supabase.com",
);

// ---------------------------------------------------------------------------
// הטקסט של הקבלה
// ---------------------------------------------------------------------------

ok("בלי HTML - הטקסט כמו שהוא", receiptText("abc", "") === "abc");
ok("HTML זהה לטקסט אינו מוכפל", receiptText("abc", "abc") === "abc");
ok("שניהם - הטקסט ואחריו ה-HTML", receiptText("a", "b") === "a\n\nb");

// ---------------------------------------------------------------------------
// הקבלה מקצה לקצה, כמו ש-handleCostMail קורא לה
// ---------------------------------------------------------------------------

const orbSubject = "Payment received for Netlify, Inc. invoice (#NWIXDA-00063)";
const orbHtml = "Your invoice has been paid. $10.00 has been charged to your payment method.\n\n" +
  " Invoice No. NWIXDA-00063\n\n                            $10.00\n\nPaid on Oct 18, 2026";
const orbText = agentHeader(`"Netlify, Inc." <noreply@netlify.com>`, orbSubject);

const forwarded = (text: string, html: string, subject: string) =>
  parseCostMail(
    {
      sender: forwardedSender(text) || "",
      subject: `Fwd: ${subject}`,
      text: receiptText(text, html),
      mailDate: new Date("2026-10-18T18:32:51Z"),
    },
    "other",
  );

const netlify = forwarded(orbText, orbHtml, orbSubject);
ok("Netlify דרך הסוכן - השירות", netlify?.service === "netlify", netlify?.service);
ok("Netlify דרך הסוכן - הסכום", netlify?.amount === 10 && netlify?.currency === "USD", netlify?.amount);
ok("Netlify דרך הסוכן - מספר החשבונית", netlify?.invoice_no === "NWIXDA-00063", netlify?.invoice_no);
ok("Netlify דרך הסוכן - תאריך החיוב מהקבלה", netlify?.charged_on === "2026-10-18", netlify?.charged_on);
// ‏ספק מוכר שמנהל/ת העביר/ה נספר; רק ספק לא מוכר ממתין.
ok("Netlify דרך הסוכן - מאושר", netlify?.status === "confirmed", netlify?.status);

const before = forwarded(orbText, "", orbSubject);
ok("בלי ה-HTML (ההתנהגות הישנה) - אין סכום", before?.amount === null, before?.amount);

const topupSubject = "[Netlify] Automatic top-up successful: 1500.0 credits added to Nadlan Afula Netlify";
const topup = forwarded(
  agentHeader("Netlify <team@netlify.com>", topupSubject),
  "Automatic\n top-up successful\nYour automatic top-up has been triggered and 1500.0 credits have been successfully added.\n" +
    "Purchase details:\nCredits added: 1500.0\nAmount: $10.00\nTransaction date: October 18, 2026 at 9:45 AM",
  topupSubject,
);
ok("התראת top-up אינה נספרת (הקבלה של Orb כבר סופרת אותו חיוב)", topup === null, topup);

const morning = forwarded(
  agentHeader("שוק הנדל״ן <notify@morning.co>", 'חשבונית מס / קבלה 60001 - שוק הנדל"ן'),
  "חשבונית מס / קבלה 60001\nסה\"כ: 100.00 ₪",
  'חשבונית מס / קבלה 60001 - שוק הנדל"ן',
);
ok("חשבונית שאנחנו הנפקנו (morning) אינה הוצאה", morning === null, morning);

const grow = forwarded(
  agentHeader('שוק הנדל"ן <support@grow.security>', 'אישור תשלום משוק הנדל"ן'),
  "התשלום התקבל\nסכום: 118.00 ₪",
  'אישור תשלום משוק הנדל"ן',
);
ok("אישור סליקה של דף התשלום שלנו (grow) אינו הוצאה", grow === null, grow);

const unknown = forwarded(
  agentHeader("Some Vendor <billing@vendor.example>", "Your receipt #123"),
  "Total: $5.00",
  "Your receipt #123",
);
ok("ספק לא מוכר - other וממתין, עם הסכום", unknown?.service === "other" && unknown?.status === "pending" && unknown?.amount === 5, unknown);

// קבלה ישירה מהספק (מסנן Gmail, בלי HTML נוסף) - כמו קודם.
const direct = parseCostMail({
  sender: "noreply@netlify.com",
  subject: orbSubject,
  text: receiptText(orbHtml, ""),
  mailDate: null,
});
ok("קבלה ישירה מהספק - כמו קודם", direct?.service === "netlify" && direct?.amount === 10 && direct?.status === "confirmed", direct);

if (fail) {
  console.error(`\n${fail} בדיקות נכשלו`);
  process.exit(1);
}
console.log("\nכל הבדיקות עברו");
