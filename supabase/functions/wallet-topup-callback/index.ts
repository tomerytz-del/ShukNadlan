import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { authorizeInternalCaller } from "../_shared/cron-auth.ts";
import {
  corsHeaders,
  extractReference,
  json,
  morningConfigured,
  secretsMatch,
  verifyPayment,
} from "../_shared/morning.ts";

// ============================================================================
// טעינת ארנק — סגירת התשלום
//
// **זו הפונקציה היחידה במערכת שמזכה ארנק בעקבות תשלום חיצוני**, ולכן היא
// כתובה מתוך הנחה שכל מי שקורא/ת לה עלול/ה לשקר.
//
// שני מסלולי כניסה:
//
//   1. ‏POST ?token=…            — מורנינג מדווח/ת שתשלום נסגר.
//   2. ‏POST ?mode=reconcile     — ‏pg_cron. סורק ניסיונות תקועים ושואל את
//      מורנינג בעצמו מה קרה להם.
//
// **למה מסלול 2 קיים:** ‏webhook הוא הבטחה, לא ערובה. אם מורנינג ניסה/תה
// לקרוא אלינו בזמן פריסה, או שהתשובה אבדה, הסוכן/ת שילם/ה ולא קיבל/ה כלום —
// והשורה תישאר 'pending' לנצח. זה הכשל היקר ביותר האפשרי כאן, ולכן הוא לא
// נשען על שיתוף פעולה של צד שלישי: ה-reconcile מגיע לכל ניסיון פתוח ומסיים
// אותו, לטוב או לרע.
//
// **הפונקציה רצה עם verify_jwt = false** — למורנינג אין JWT שלנו. שלוש
// שכבות אימות במקומו:
//
//   א. סוד בכתובת, מושווה בזמן קבוע מול MORNING_WEBHOOK_SECRET.
//   ב. **גוף ה-webhook אינו נאמן.** ממנו נלקח רק מזהה; המצב האמיתי נשלף
//      בקריאה חוזרת ל-API של מורנינג מול המפתח הפרטי שלנו.
//   ג. הסכום מושווה מול מה שרשמנו כשפתחנו את הניסיון, גם בקוד וגם שוב
//      בתוך complete_wallet_topup.
//
// שכבה ב' היא העיקר. בלעדיה כל מי שינחש את הסוד יוכל לטעון ארנק בכל סכום;
// איתה, גם מי שיודע/ת את הסוד יכול/ה לכל היותר לבקש מאיתנו לבדוק תשלום
// שלא קרה — ולקבל 'לא שולם'.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const webhookSecret = Deno.env.get("MORNING_WEBHOOK_SECRET") || "";

// ניסיון שלא זז יותר מזה נבדק מול מורנינג. חלון תשלום סביר הוא דקות בודדות,
// ולכן 10 דקות הן כבר בבירור "משהו לא הסתיים כמו שצריך".
//
// אין סיכון בבדיקה מוקדמת מדי: מי שעדיין מקליד/ה בעמוד התשלום פשוט יחזיר/תחזיר
// paid=false, והשורה תישאר pending לסבב הבא. לעומת זאת יש מחיר לבדיקה מאוחרת
// מדי — סוכן/ת ששילם/ה ושה-webhook שלו/ה אבד מחכה/ה בדיוק את הזמן הזה.
const STALE_MINUTES = 10;

// ומעבר לזה — הסוכן/ת מזמן סגר/ה את החלון. הניסיון נסגר ככושל. אין סיכון
// כספי בסגירה מוקדמת מדי: תשלום שיאושר אחר כך ייתפס בכל מקרה, כי
// complete_wallet_topup בודקת סטטוס ולא מסתמכת על זמן.
const EXPIRE_MINUTES = 180;

// ---------------------------------------------------------------------------
// סגירת ניסיון בודד מול מורנינג
//
// הלב של שתי הכניסות גם יחד: אותה שאלה, אותה החלטה, בלי קשר למי העיר אותנו.
// ---------------------------------------------------------------------------
async function settleTopup(
  supabase: any,
  topup: { id: string; amount: number; status: string; provider_form_id: string | null },
): Promise<string> {
  if (topup.status !== "pending") return topup.status;

  // אין מזהה טופס — כלומר יצירת הטופס נכשלה אחרי שהשורה כבר נפתחה. אין למה
  // לפנות, ואין תשלום שיכול היה להיווצר.
  if (!topup.provider_form_id) {
    await supabase.rpc("fail_wallet_topup", { p_topup_id: topup.id, p_reason: "no_provider_form_id" });
    return "failed";
  }

  const status = await verifyPayment(topup.provider_form_id);

  // מורנינג לא ענה/תה. **לא נוגעים בשורה** — היא נשארת pending והסבב הבא
  // ינסה שוב. סגירה ככושלת כאן הייתה מוחקת תשלום אמיתי בגלל תקלת רשת רגעית.
  if (!status.ok) {
    console.error("wallet-topup-callback: lookup failed", topup.id, status.error);
    return "pending";
  }

  if (!status.paid) {
    // עדיין בתוך חלון התשלום — ייתכן שהסוכן/ת פשוט עדיין מקליד/ה.
    return "pending";
  }

  const { data: result, error } = await supabase.rpc("complete_wallet_topup", {
    p_topup_id: topup.id,
    p_verified_amount: status.amount,
    p_provider_charge_id: status.transactionId,
    p_document_id: status.documentId,
    p_pdf_url: status.pdfUrl,
  });

  if (error) {
    console.error("wallet-topup-callback: complete failed", topup.id, error.message);
    return "pending";
  }
  if (result?.error) {
    console.error("wallet-topup-callback: complete rejected", topup.id, JSON.stringify(result));
    return result.error === "amount_mismatch" ? "failed" : "pending";
  }
  return "success";
}

// ---------------------------------------------------------------------------
// ה-reconcile
// ---------------------------------------------------------------------------
async function reconcile(supabase: any): Promise<Record<string, number>> {
  const staleCutoff = new Date(Date.now() - STALE_MINUTES * 60_000).toISOString();
  const expireCutoff = new Date(Date.now() - EXPIRE_MINUTES * 60_000).toISOString();

  const { data: rows } = await supabase
    .from("wallet_topups")
    .select("id, amount, status, provider_form_id, created_at")
    .eq("status", "pending")
    .lt("created_at", staleCutoff)
    .order("created_at", { ascending: true })
    .limit(50);

  const stats = { checked: 0, credited: 0, failed: 0, still_pending: 0 };

  for (const row of rows ?? []) {
    stats.checked++;
    const outcome = await settleTopup(supabase, row);

    if (outcome === "success") { stats.credited++; continue; }
    if (outcome === "failed") { stats.failed++; continue; }

    // עדיין תלוי, וכבר זקן מדי מכדי להיות אמיתי.
    if (row.created_at < expireCutoff) {
      await supabase.rpc("fail_wallet_topup", { p_topup_id: row.id, p_reason: "expired_unpaid" });
      stats.failed++;
    } else {
      stats.still_pending++;
    }
  }

  return stats;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = new URL(req.url);
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // ---- מסלול ה-cron ----------------------------------------------------
  if (url.searchParams.get("mode") === "reconcile") {
    const auth = authorizeInternalCaller(req);
    if (!auth.ok) return json({ error: auth.error, detail: auth.detail }, auth.status);
    if (!morningConfigured()) return json({ ok: true, skipped: "morning_not_configured" });
    const stats = await reconcile(supabase);
    return json({ ok: true, ...stats });
  }

  // ---- מסלול ה-webhook -------------------------------------------------
  // ‏fail-closed: סוד שלא הוגדר אינו "אין צורך באימות". זה בדיוק הכשל
  // שתועד ב-_shared/cron-auth.ts, ואין סיבה לחזור עליו כאן.
  if (!webhookSecret) {
    console.error("wallet-topup-callback: MORNING_WEBHOOK_SECRET not configured");
    return json({ error: "webhook_secret_not_configured" }, 503);
  }
  if (!secretsMatch(url.searchParams.get("token") || "", webhookSecret)) {
    return json({ error: "bad_token" }, 403);
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  // מהגוף נלקחים **מזהים בלבד**, ורק כדי לדעת איזו שורה לבדוק.
  const { topupId, formId } = extractReference(body);
  if (!topupId && !formId) return json({ error: "missing_reference" }, 400);

  const query = supabase
    .from("wallet_topups")
    .select("id, amount, status, provider_form_id");
  const { data: topup } = topupId
    ? await query.eq("id", topupId).maybeSingle()
    : await query.eq("provider_form_id", formId).maybeSingle();

  if (!topup) return json({ error: "topup_not_found" }, 404);

  const outcome = await settleTopup(supabase, topup);

  // ‏200 גם כשעדיין pending: מבחינת מורנינג ההודעה נקלטה. תשובת שגיאה כאן
  // הייתה מייצרת סבב ניסיונות חוזרים על מצב שאיננו שגיאה.
  return json({ ok: true, status: outcome });
});
