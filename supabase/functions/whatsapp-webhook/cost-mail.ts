// ============================================================================
// קבלות של ספקים → ‏platform_costs. ‏docs/platform-costs.md.
//
//   קבלה בתיבה הפרטית ──(מסנן Gmail)──► shuknadlan+costs@gmail.com
//        │
//        ▼
//   ‏email-intake.ts (אותו סבב IMAP, כל 2 דק׳) מזהה את הכתובת `+costs`
//        │
//        ▼
//   כאן: מי הספק, כמה, באיזה מטבע, מתי, ומספר החשבונית → שורה בטבלה
//
// ‏**בלי מודל.** הקבלות מגיעות מתריסר ספקים בתבניות קבועות, ו-regex לכל
// תבנית הוא גם חינמי וגם צפוי. מה שלא מזוהה בוודאות נכנס כ-`pending` —
// בלי סכום, או עם סכום שנמצא בתבנית כללית — ומחכה לאישור בפאנל. דוח
// עלויות שמנחש הוא דוח שאי אפשר לסמוך על אף שורה בו.
//
// הקובץ טהור (בלי רשת ובלי מסד), כדי שאפשר יהיה לבדוק אותו על טקסט.
// ============================================================================

export type Currency = "USD" | "ILS" | "EUR";

export interface CostDraft {
  service: string;
  charged_on: string; // YYYY-MM-DD, תאריך בישראל
  amount: number | null;
  currency: Currency;
  invoice_no: string | null;
  description: string | null;
  status: "confirmed" | "pending";
}

export interface CostMailInput {
  /** כתובת הספק — מאומתת (DKIM/DMARC), או מתוך כותרת ההעברה של מנהל/ת. */
  sender: string;
  subject: string;
  text: string;
  /** תאריך המייל — רק כשאין תאריך בגוף הקבלה. */
  mailDate: Date | null;
}

/* הספקים לפי הדומיין של השולח. סדר: הספציפי לפני הכללי. */
const BY_DOMAIN: [string, string][] = [
  ["netlify.com", "netlify"],
  ["supabase.com", "supabase"],
  ["supabase.io", "supabase"],
  ["anthropic.com", "anthropic_api"],
  ["make.com", "make"],
  ["openai.com", "openai"],
  ["twilio.com", "twilio"],
  ["facebookmail.com", "meta"],
  ["meta.com", "meta"],
  ["box.co.il", "domain"],
  ["github.com", "github"],
  ["resend.com", "resend"],
  ["fal.ai", "fal_ai"],
];

/**
 * החשבוניות של morning הן חשבוניות **שאנחנו** הנפקנו (טעינות ארנק של
 * סוכנים) — הכנסה, לא הוצאה. הן מגיעות לאותה תיבה ובאותו נוסח של "חשבונית
 * מס / קבלה", ולכן נחסמות בשם ולא לפי הנוסח.
 */
const NEVER: string[] = ["morning.co", "greeninvoice.co.il"];

function domainOf(email: string): string {
  return (email.split("@")[1] || "").toLowerCase();
}

function endsWithDomain(domain: string, suffix: string): boolean {
  return domain === suffix || domain.endsWith("." + suffix);
}

/** השירות לפי השולח, או null כשהשולח אינו ספק מוכר. */
export function vendorOf(sender: string, subject: string, text: string): string | null {
  const email = sender.toLowerCase();
  const domain = domainOf(email);
  if (!domain) return null;
  if (NEVER.some((d) => endsWithDomain(domain, d))) return null;

  for (const [suffix, service] of BY_DOMAIN) {
    if (endsWithDomain(domain, suffix)) return service;
  }

  // ‏Orb שולח את החשבוניות של כמה ספקים מאותה כתובת; השם בנושא.
  if (endsWithDomain(domain, "withorb.com")) {
    if (/\bfal\b/i.test(subject)) return "fal_ai";
    if (/netlify/i.test(subject)) return "netlify";
    if (/supabase/i.test(subject)) return "supabase";
    return null;
  }

  if (endsWithDomain(domain, "google.com")) {
    // ‏Google Play מחייב גם על מנויים פרטיים (YouTube Music) — רק Claude.
    if (email.startsWith("googleplay-noreply")) {
      return /anthropic|claude/i.test(subject + "\n" + text) ? "claude_subscription" : null;
    }
    if (/^(payments-noreply|cloudplatform-noreply|billing-noreply)/.test(email)) return "gemini";
    return null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// סכום, תאריך, חשבונית
// ---------------------------------------------------------------------------

function num(s: string): number {
  return Math.round(Number(s.replace(/,/g, "")) * 100) / 100;
}

/* תבניות שהן קבלה מפורשת: סכום ששולם. התאמה כאן = `confirmed`. */
const PAID: { re: RegExp; currency: Currency }[] = [
  { re: /\$\s?([\d,]+(?:\.\d{1,2})?) has been charged/i, currency: "USD" }, // Orb
  { re: /Amount paid\s*\$\s?([\d,]+(?:\.\d{1,2})?)/i, currency: "USD" }, // Stripe
  { re: /We charged \$\s?([\d,]+(?:\.\d{1,2})?)/i, currency: "USD" }, // OpenAI
  { re: /Invoice from [^:\n]+:\s*\$\s?([\d,]+(?:\.\d{1,2})?) due/i, currency: "USD" }, // Orb, חשבונית חדשה
  { re: /סה"כ:\s*([\d,]+(?:\.\d{1,2})?)\s*₪/, currency: "ILS" }, // Google Play
  { re: /שולם\s*([\d,]+(?:\.\d{1,2})?)/, currency: "ILS" }, // box.co.il
];

/* תבנית כללית: סכום שנראה כמו סה"כ. התאמה כאן = `pending`. */
const LOOSE: RegExp =
  /(?:Total|Amount due|Amount charged|Total charged|Total due)\s*:?\s*(US\$|\$|€|₪)\s?([\d,]+(?:\.\d{1,2})?)/i;

const INVOICE: RegExp[] = [
  /Invoice No\.\s*([A-Z0-9][A-Z0-9-]{3,})/,
  /Invoice number\s+([A-Z0-9][A-Z0-9-]{3,})/,
  /מספר הזמנה:\s*(GPA\.[0-9.\-]+)/,
  /Meta Invoice (\d{5,})/,
  /Receipt (?:number|#)\s*([0-9][0-9-]{3,})/,
];

const EN_MONTH: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const HE_MONTH: [string, number][] = [
  ["ינו", 1], ["פבר", 2], ["מרץ", 3], ["אפר", 4], ["מאי", 5], ["יוני", 6],
  ["יולי", 7], ["אוג", 8], ["ספט", 9], ["אוק", 10], ["נוב", 11], ["דצמ", 12],
];

function ymd(y: number, m: number, d: number): string | null {
  if (!(y > 2000 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** התאריך בישראל של רגע נתון. */
export function israelDate(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(at);
}

/**
 * תאריך החיוב מתוך גוף הקבלה ("Paid on Sep 28, 2026", ‏"Paid September 22,
 * 2026", ‏"תאריך הזמנה: 28 בספט׳ 2026"). עדיף על תאריך המייל: קבלה שהועברה
 * ידנית שבוע אחרי נושאת את תאריך ההעברה.
 */
export function chargeDate(text: string): string | null {
  const en = text.match(
    /(?:Paid on|Paid|Date paid|due)\s+([A-Za-z]{3,9})\.?\s+(\d{1,2}),\s*(\d{4})/,
  );
  if (en) {
    const m = EN_MONTH[en[1].slice(0, 3).toLowerCase()];
    if (m) return ymd(Number(en[3]), m, Number(en[2]));
  }
  const he = text.match(/תאריך הזמנה:\s*(\d{1,2})\s+ב-?([א-ת]+)[׳']?\s+(\d{4})/);
  if (he) {
    const hit = HE_MONTH.find(([p]) => he[2].startsWith(p));
    if (hit) return ymd(Number(he[3]), hit[1], Number(he[1]));
  }
  return null;
}

function currencyOf(sym: string): Currency {
  if (sym === "₪") return "ILS";
  if (sym === "€") return "EUR";
  return "USD";
}

/* נושא שהוא בוודאות לא חיוב שבוצע: החזר, תשלום שנכשל, טעינה שלא עברה. */
const NOT_A_CHARGE = /refund|failed|unsuccessful|declined|past due|at risk|החזר|נכשל/i;
/* נושא שנראה כמו קבלה — כדי להבדיל קבלה בלי סכום מניוזלטר של אותו ספק. */
const RECEIPT_LIKE = /receipt|invoice|payment|funded|statement|קבלה|חשבונית|הזמנה/i;

function memo(text: string): string | null {
  const m = text.match(/Memo:\s*([^\n]+?)(?:\s+Powered by|\n|$)/);
  // ‏Supabase כותבת שם הערת מס קבועה, שאינה אומרת דבר על החיוב.
  if (!m || /applicable taxes/i.test(m[1])) return null;
  return m[1].trim().slice(0, 200);
}

/** "Fwd: …", ‏"FW: …", ‏"הועבר: …" — הנושא המקורי. */
export function stripForwardPrefix(subject: string): string {
  return subject.replace(/^\s*(?:(?:fwd?|fw|הועבר|הועברה)\s*:\s*)+/i, "").trim();
}

/**
 * השולח המקורי מתוך גוף של מייל שהועבר ידנית ("---------- Forwarded message
 * ---------\nFrom: Netlify <noreply@netlify.com>"). ‏**לא מאומת** — ולכן
 * נקרא רק כשמי שהעביר/ה הוא/היא מנהל/ת פלטפורמה מאומת/ת.
 */
export function forwardedSender(text: string): string | null {
  const marker = text.search(/Forwarded message|הודעה שהועברה|הודעה מצורפת|Original Message/i);
  const tail = marker >= 0 ? text.slice(marker) : text;
  const m = tail.match(/^(?:From|מאת)\s*:\s*[^\n]*?<?([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})>?/m);
  return m ? m[1].toLowerCase() : null;
}

/**
 * הקבלה כשורה ב-`platform_costs`, או null כשזה אינו חיוב (ניוזלטר של ספק,
 * החזר, תשלום שנכשל, חשבונית שאנחנו הנפקנו).
 *
 * ‏`fallbackService` — לקבלה שמנהל/ת העביר/ה מספק שאינו ברשימה: נכנסת
 * כ-`other` וממתינה, במקום להיעלם.
 */
export function parseCostMail(input: CostMailInput, fallbackService: string | null = null): CostDraft | null {
  const subject = stripForwardPrefix(input.subject || "");
  const text = input.text || "";
  if (NEVER.some((d) => endsWithDomain(domainOf(input.sender.toLowerCase()), d))) return null;
  if (NOT_A_CHARGE.test(subject)) return null;

  const service = vendorOf(input.sender, subject, text) || fallbackService;
  if (!service) return null;

  let amount: number | null = null;
  let currency: Currency = "USD";
  let status: CostDraft["status"] = "pending";

  for (const p of PAID) {
    const m = text.match(p.re);
    if (m) {
      amount = num(m[1]);
      currency = p.currency;
      status = "confirmed";
      break;
    }
  }
  if (amount === null) {
    const m = text.match(LOOSE);
    if (m) {
      amount = num(m[2]);
      currency = currencyOf(m[1].replace("US", ""));
    }
  }

  // ספק מוכר, בלי סכום ובלי נוסח של קבלה — ניוזלטר או התראה. לא נכנס.
  if (amount === null && !RECEIPT_LIKE.test(subject)) return null;
  // ספק שאינו ברשימה תמיד ממתין, גם כשהסכום נמצא בתבנית מפורשת.
  if (service === fallbackService) status = "pending";

  let invoice: string | null = null;
  for (const re of INVOICE) {
    const m = (subject + "\n" + text).match(re);
    if (m) {
      invoice = m[1];
      break;
    }
  }

  const charged = chargeDate(text) ||
    israelDate(input.mailDate && !Number.isNaN(input.mailDate.getTime()) ? input.mailDate : new Date());

  return {
    service,
    charged_on: charged,
    amount,
    currency,
    invoice_no: invoice,
    description: memo(text) || subject.slice(0, 200) || null,
    status,
  };
}
