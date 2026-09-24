import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { authorizeInternalCaller } from "../_shared/cron-auth.ts";
import {
  chargeCardToken,
  corsHeaders,
  findCardToken,
  json,
  morningConfigured,
  verifyPaymentByReference,
} from "../_shared/morning.ts";
import { sendPlatformEmail, PLATFORM_CONTACT_EMAIL } from "../_shared/platform-mail-client.ts";

// ============================================================================
// החיוב החודשי של בעלי מקצוע
//
// ‏pg_cron קורא לכאן פעם בשעה, רק כשיש מנוי שהגיע תאריכו או הודעה שממתינה
// (‏20270102090000_professional_auto_renew.sql). שני שלבים:
//
//   ‏1. **חיוב.** ‏claim_due_professional_renewals פותחת הזמנת חידוש לכל מנוי
//      שהגיע זמנו ומסמנת אותה על המנוי — לפני שמורנינג שומע/ת עליה. כאן
//      מחייבים את הכרטיס השמור, ואז מאמתים מול מסמך ה-320 בדיוק כמו כל תשלום
//      אחר באתר. רק אחרי האימות — ‏complete_ad_order.
//   ‏2. **הודעות.** לכל הזמנה שהסתיימה (כאן, ב-webhook או ב-reconcile) יוצא
//      מייל אחד: חויב, נכשל ונוסה שוב, או הופסק.
//
// **מה לא קורה כאן:** עדכון מצב המנוי. הטריגר על ad_orders עושה את זה, כך
// שלא משנה איזה מסלול סגר את ההזמנה.
//
// **תשובה עמומה ממורנינג אינה כישלון.** אם אין לדעת אם הכרטיס חויב (רשת,
// ‏5xx, או "חויב" בלי מסמך עדיין) — ההזמנה נשארת pending. ה-reconcile של
// ‏wallet-topup-callback מחפש את המסמך, ובתום 180 דקות בלי מסמך סוגר אותה
// ככושלת. עד אז אין חיוב נוסף, כי המנוי תפוס. חיוב מתעכב — לעולם לא כפול.
//
// **המתג.** ‏recurring_charging_enabled נבדק כאן **וגם** בתוך claim. כבוי =
// לא נוגעים במורנינג בכלל.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const siteBaseUrl = (Deno.env.get("SITE_BASE_URL") || "https://shuknadlan.co.il").replace(/\/+$/, "");

// ‏escapeHtml של האתר חי ב-assets/esc.js, בדפדפן. כאן נבנה HTML של מייל
// בשרת, ושם הפרטי של בעל/ת המקצוע מגיע מטופס פתוח — כל חמשת התווים.
function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const fmtDate = (d: string | null) =>
  d ? new Date(d + (d.length === 10 ? "T00:00:00" : "")).toLocaleDateString("he-IL") : "";
const fmtMoney = (n: number) => "₪" + Math.round(Number(n)).toLocaleString("he-IL");

async function chargingEnabled(supabase: any): Promise<boolean> {
  const { data } = await supabase
    .from("pricing_config").select("value").eq("key", "recurring_charging_enabled").maybeSingle();
  return Number(data?.value) === 1;
}

// ---------------------------------------------------------------------------
// 1. חיוב
// ---------------------------------------------------------------------------
async function chargeDue(supabase: any) {
  const stats = { claimed: 0, charged: 0, declined: 0, no_token: 0, pending: 0 };

  const { data: due, error } = await supabase.rpc("claim_due_professional_renewals", { p_limit: 20 });
  if (error) {
    console.error("billing-renew: claim failed", error.message);
    return stats;
  }

  for (const row of due ?? []) {
    stats.claimed++;
    const fail = (reason: string) =>
      supabase.rpc("fail_ad_order", { p_order_id: row.order_id, p_reason: reason });

    // הכרטיס. נשמר על המנוי אחרי הפעם הראשונה שנמצא.
    let token: string | null = row.card_token;
    if (!token && row.contact_email) {
      const found = await findCardToken(row.contact_email);
      if (!found.ok) {
        // תקלה בחיפוש אינה "אין כרטיס". ההזמנה נשארת, ה-reconcile יסגור אותה
        // בלי מסמך, והניסיון הבא יחפש שוב.
        console.error("billing-renew: token search failed", row.subscription_id, found.error);
        stats.pending++;
        continue;
      }
      token = found.token;
      if (token) {
        await supabase.from("billing_subscriptions")
          .update({ card_token: token, updated_at: new Date().toISOString() })
          .eq("id", row.subscription_id);
      }
    }
    if (!token) {
      await fail("no_card_token");
      stats.no_token++;
      continue;
    }

    const who = row.business_name || row.advertiser_name || "בעל/ת מקצוע";
    const charge = await chargeCardToken(token, {
      amount: Number(row.amount),
      description: 'חידוש חודשי - כרטיסיית בעל/ת מקצוע - שוק נדל"ן',
      reference: row.order_id,
      clientName: who,
      clientEmail: row.contact_email,
    });

    if (charge.outcome === "declined") {
      await fail(`declined: ${charge.error}`.slice(0, 300));
      stats.declined++;
      continue;
    }
    if (charge.outcome === "unknown") {
      console.error("billing-renew: charge outcome unknown - left pending", row.order_id, charge.error);
      stats.pending++;
      continue;
    }

    // מורנינג אמר/ה "חויב". סוגרים רק מול המסמך, כמו כל תשלום אחר.
    const verified = await verifyPaymentByReference(row.order_id, new Date().toISOString());
    if (!verified.ok || !verified.paid) {
      // המסמך עוד לא נמצא. ה-reconcile ימשיך לחפש.
      stats.pending++;
      continue;
    }
    const { data: done, error: doneErr } = await supabase.rpc("complete_ad_order", {
      p_order_id: row.order_id,
      p_verified_amount: verified.amount,
      p_provider_charge_id: verified.transactionId ?? charge.transactionId,
      p_document_id: verified.documentId,
      p_pdf_url: verified.pdfUrl,
    });
    if (doneErr || done?.error) {
      console.error("billing-renew: complete failed", row.order_id, doneErr?.message ?? done?.error);
      stats.pending++;
      continue;
    }
    stats.charged++;
  }
  return stats;
}

// ---------------------------------------------------------------------------
// 2. הודעות — מייל אחד לכל הזמנת חידוש שהסתיימה
// ---------------------------------------------------------------------------
async function sendNotices(supabase: any) {
  const stats = { sent: 0, waiting: 0 };

  const { data: subs } = await supabase
    .from("billing_subscriptions")
    .select("id, placement_id, status, contact_email, notice_order_id, failed_attempts, next_retry_at, next_charge_on")
    .not("notice_order_id", "is", null)
    .limit(50);

  for (const sub of subs ?? []) {
    const { data: order } = await supabase
      .from("ad_orders").select("id, status, amount, period_end, failure_reason")
      .eq("id", sub.notice_order_id).maybeSingle();

    if (order && order.status === "pending") { stats.waiting++; continue; }

    const [{ data: p }, { data: access }] = await Promise.all([
      supabase.from("ad_placements").select("advertiser_name, ends_at").eq("id", sub.placement_id).maybeSingle(),
      supabase.from("ad_placement_access").select("manage_token").eq("placement_id", sub.placement_id).maybeSingle(),
    ]);
    const manageUrl = access?.manage_token
      ? `${siteBaseUrl}/professional-manage?token=${encodeURIComponent(access.manage_token)}`
      : null;

    let subject: string;
    let lines: string[];
    if (order?.status === "success") {
      subject = "הפרסום שלך בשוק נדל\"ן חודש לחודש נוסף";
      lines = [
        `חויב ${fmtMoney(order.amount)} (כולל מע״מ), והכרטיסייה שלך באוויר עד ${fmtDate(p?.ends_at ?? null)}.`,
        "החשבונית נשלחת בנפרד מחברת הסליקה.",
        "אפשר לבטל את החידוש בכל עת במסך העריכה, והפרסום יימשך עד סוף התקופה ששולמה.",
      ];
    } else if (sub.status === "failed") {
      subject = "החידוש החודשי של הפרסום שלך הופסק";
      lines = [
        "ניסינו לחייב את הכרטיס שלוש פעמים ולא הצלחנו, ולכן החידוש האוטומטי הופסק.",
        `הכרטיסייה תישאר באוויר עד ${fmtDate(p?.ends_at ?? null)}.`,
        "כדי להמשיך, אפשר להאריך את הפרסום במסך העריכה - עם כרטיס בתוקף.",
      ];
    } else if (sub.status === "active" && sub.next_retry_at) {
      subject = "לא הצלחנו לחייב את הכרטיס לחידוש הפרסום";
      lines = [
        `ננסה שוב ב-${new Date(sub.next_retry_at).toLocaleDateString("he-IL")}.`,
        "אם הכרטיס פג או הוחלף, אפשר להאריך במסך העריכה עם כרטיס אחר.",
      ];
    } else {
      // הזמנה שנכשלה אחרי ביטול, או מצב שאין בו מה לומר — אין מייל.
      subject = "";
      lines = [];
    }

    if (subject && sub.contact_email) {
      const hello = p?.advertiser_name ? `שלום ${p.advertiser_name},` : "שלום,";
      const html =
        `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6">` +
        `<p>${esc(hello)}</p>` + lines.map((l) => `<p>${esc(l)}</p>`).join("") +
        (manageUrl ? `<p><a href="${esc(manageUrl)}">למסך העריכה</a></p>` : "") +
        `<p style="color:#666;font-size:13px">שאלות? ${esc(PLATFORM_CONTACT_EMAIL)}</p></div>`;
      const text = [hello, ...lines, manageUrl ? `מסך העריכה: ${manageUrl}` : "", `שאלות? ${PLATFORM_CONTACT_EMAIL}`]
        .filter(Boolean).join("\n\n");
      const sent = await sendPlatformEmail({ to: [sub.contact_email], subject, html, text });
      if (!sent.sent) {
        // המייל נכשל — משאירים את ההודעה ממתינה לסבב הבא.
        console.error("billing-renew: notice mail failed", sub.id, sent.error);
        stats.waiting++;
        continue;
      }
      stats.sent++;
    }

    await supabase.from("billing_subscriptions")
      .update({ notice_order_id: null, updated_at: new Date().toISOString() })
      .eq("id", sub.id).eq("notice_order_id", sub.notice_order_id);
  }
  return stats;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = authorizeInternalCaller(req);
  if (!auth.ok) return json({ error: auth.error, detail: auth.detail }, auth.status);

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // ההודעות יוצאות גם כשהמתג כבוי: הזמנה שנפתחה לפני שכובה הוא עדיין
  // מסתיימת (ב-reconcile), ומי ששילם/ה צריך/ה לשמוע על זה.
  const notices = await sendNotices(supabase);

  if (!(await chargingEnabled(supabase))) {
    return json({ ok: true, charging: "disabled", notices });
  }
  if (!morningConfigured()) {
    return json({ ok: true, charging: "morning_not_configured", notices });
  }

  const charges = await chargeDue(supabase);
  // הודעות על מה שהסתיים בסבב הזה, בלי לחכות שעה.
  const late = await sendNotices(supabase);
  return json({ ok: true, charges, notices: { sent: notices.sent + late.sent, waiting: late.waiting } });
});
