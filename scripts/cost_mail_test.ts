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
  findDuplicate,
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
const agentHeader = (from: string, subject: string, date = "Sun, 18 Oct 2026 09:45:32 +0000") =>
  `הודעה זו הועברה אוטומטית על ידי הסוכן של תומר לצורך מעקב הוצאות אתר שוק הנדל"ן.\n` +
  `מקור: ${from}\n` +
  `תאריך מקורי: ${date}\n` +
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

// ---------------------------------------------------------------------------
// ההעברה שהגיעה בפועל: כותרת בלבד, בלי HTML (19.10.2026: text 278, html 0)
// ---------------------------------------------------------------------------

const bare = (from: string, subject: string, date: string) =>
  parseCostMail(
    {
      sender: forwardedSender(agentHeader(from, subject, date)) || "",
      subject: `Fwd: ${subject}`,
      text: receiptText(agentHeader(from, subject, date), ""),
      mailDate: new Date("2026-10-18T18:32:51Z"),
    },
    "other",
  );

const n52 = bare(`"Netlify, Inc." <noreply@netlify.com>`, "Payment received for Netlify, Inc. invoice (#NWIXDA-00052)", "Mon, 21 Sep 2026 22:30:00 +0000");
ok("בלי גוף - מספר החשבונית של Orb מהנושא", n52?.invoice_no === "NWIXDA-00052", n52?.invoice_no);
ok("בלי גוף - תאריך החיוב מ'תאריך מקורי', בשעון ישראל", n52?.charged_on === "2026-09-22", n52?.charged_on);
ok("בלי גוף - ממתין בלי סכום", n52?.amount === null && n52?.status === "pending", n52);

const anth = bare(`"Anthropic, PBC" <invoice+statements@mail.anthropic.com>`, "Your receipt from Anthropic, PBC #2184-5046-9629", "Tue, 22 Sep 2026 11:10:00 +0000");
ok("Anthropic - מספר הקבלה מהנושא אינו נלקח כמספר חשבונית", anth?.service === "anthropic_api" && anth?.invoice_no === null, anth);

const repl = bare("Replicate <invoice+statements@replicate.com>", "New invoice from Replicate, LLC #6P70QIZE-0001", "Tue, 22 Sep 2026 11:10:00 +0000");
ok("Stripe - מספר חשבונית מהנושא", repl?.invoice_no === "6P70QIZE-0001", repl?.invoice_no);

// ---------------------------------------------------------------------------
// כפילות בלי מספר חשבונית
// ---------------------------------------------------------------------------

const backfill = { id: 7, amount: "60.00", invoice_no: "QEKGK6A2-0002", status: "confirmed" };
ok("קבלה בלי מספר ובלי סכום מול שורה מאותו יום - כפולה", findDuplicate(anth!, [backfill])?.id === 7);
ok("קבלה בלי מספר עם אותו סכום - כפולה", findDuplicate({ ...anth!, amount: 60 }, [backfill])?.id === 7);
ok("קבלה בלי מספר עם סכום אחר - לא כפולה", findDuplicate({ ...anth!, amount: 25 }, [backfill]) === null);
ok("ספק לא מוכר (other) אינו נבדק לפי יום", findDuplicate({ ...anth!, service: "other" }, [backfill]) === null);
ok("שורה שנדחתה אינה תופסת", findDuplicate(anth!, [{ ...backfill, status: "rejected" }]) === null);
ok(
  "קבלה עם מספר חשבונית אינה נבדקת כאן (שתי חשבוניות של $10 ביום אחד)",
  findDuplicate({ ...n52!, amount: 10 }, [{ id: 9, amount: 10, invoice_no: null, status: "confirmed" }]) === null,
);

// ---------------------------------------------------------------------------
// ספקים שנכנסו בלי סכום (19.10.2026) - הנוסח מהמיילים המקוריים
// ---------------------------------------------------------------------------

const direct2 = (sender: string, subject: string, text: string) =>
  parseCostMail({ sender, subject, text, mailDate: new Date("2026-10-19T08:00:00Z") });

const twilio = direct2(
  "noreply@twilio.com",
  "Your Twilio account has been funded",
  "We charged the ShukNadlan Credit Card ( **** **** **** 3417 ) $50.00\nto bring the balance to $50.00.\nand transaction CX7b53ab469ca71c459587842ae95fb88f",
);
ok("Twilio - $50 מאושר", twilio?.service === "twilio" && twilio?.amount === 50 && twilio?.status === "confirmed", twilio);
ok("Twilio - מזהה העסקה כמספר", twilio?.invoice_no === "CX7b53ab469ca71c459587842ae95fb88f", twilio?.invoice_no);

const openai = direct2(
  "noreply@tm.openai.com",
  "Your OpenAI API account has been funded",
  "Hi there, We charged $20.00 to your credit card ending in 2687 to fund your OpenAI API credit balance.",
);
ok("OpenAI - עדיין $20", openai?.service === "openai" && openai?.amount === 20, openai);

const gcloud = direct2(
  "payments-noreply@google.com",
  "Google Cloud Platform & APIs: קיבלנו את התשלום שלך עבור 01066F-004CEE-7EAB07",
  "התשלום שלך בסך 300.00 ₪ (סימוכין CLOUD xBMKTW ב-מאסטרקארד  • • • • 3417)\nהוחל על Google Cloud Platform & APIs בתאריך 11 באוק׳ 2026.",
);
ok("Google Cloud - ₪300 מאושר", gcloud?.service === "gemini" && gcloud?.amount === 300 && gcloud?.currency === "ILS" && gcloud?.status === "confirmed", gcloud);
ok("Google Cloud - סימוכין ותאריך", gcloud?.invoice_no === "CLOUD xBMKTW" && gcloud?.charged_on === "2026-10-11", gcloud);
const gnot = direct2("payments-noreply@google.com", "אפשרות הוספת הכסף האוטומטית מופעלת", "הפעלת הוספה אוטומטית");
ok("Google Payments שאינו חיוב - לא נכנס", gnot === null, gnot);

const play = direct2(
  "googleplay-noreply@google.com",
  "הקבלה שלך על הזמנה ב-Google Play מ-9 ביולי 2026",
  "מספר הזמנה: GPA.3309-0629-0926-75028\nתאריך הזמנה: 9 ביולי 2026 17:47:55 GMT+3\nClaude Pro Subscription (Claude by Anthropic) 88.00 ₪/חודש\nסה״כ:‏ 88.00‏ ₪/חודש",
);
ok("Google Play - ₪88 גם עם גרשיים וסימני כיוון", play?.service === "claude_subscription" && play?.amount === 88 && play?.currency === "ILS", play);
ok("Google Play - תאריך ההזמנה", play?.charged_on === "2026-07-09", play?.charged_on);

const replicate = direct2(
  "invoice+statements@replicate.com",
  "New invoice from Replicate, LLC #6P70QIZE-0001",
  "Invoice from Replicate, LLC $0.00 Due August 12, 2026\nInvoice #6P70QIZE-0001 One-time credit purchase Qty 1 $20.00 Total due $20.00 Amount paid -$20.00 Amount remaining $0.00",
);
ok("Replicate - שירות משלו ו-$20 (לא $0 של 'Due')", replicate?.service === "replicate" && replicate?.amount === 20 && replicate?.status === "confirmed", replicate);
ok("Replicate - מספר החשבונית ותאריך", replicate?.invoice_no === "6P70QIZE-0001" && replicate?.charged_on === "2026-08-12", replicate);

if (fail) {
  console.error(`\n${fail} בדיקות נכשלו`);
  process.exit(1);
}
console.log("\nכל הבדיקות עברו");
