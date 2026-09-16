// ============================================================================
// התראת הצטרפות למנהל/ת הפלטפורמה
//
// כל מי שנכנס/ת לפלטפורמה מצלצל/ת אצל מנהל/ת הפלטפורמה — בפעמון, ומשם גם
// בוואטסאפ דרך `notification-push`. ההודעה נושאת את שני הדברים שנשאלים
// עליהם בפועל: **מי הצטרף/ה** ו**לאיזה מסלול**.
//
// ארבעה קהלים, וכל אחד "מסלול" משלו — כי אצל כל אחד מהם הכסף עובד אחרת:
//
// | קהל | הרגע שנספר כהצטרפות | מה נכתב כ"מסלול" |
// |---|---|---|
// | משרד תיווך | פתיחת המשרד | ‏tier של המנהל/ת (בד"כ הטבת ההשקה) |
// | מתווך/ת | הכניסה הראשונה לכרטיס | ‏tier שלו/ה |
// | בעל/ת מקצוע | שליחת טופס ההרשמה | מצב התשלום של הכרטיסייה |
// | חברה יזמית | פתיחת החברה | "ללא תשלום" — החיוב הוא לפי פרויקט |
//
// ## למה כאן ולא בטריגר במסד
//
// טריגר על `agency_members` היה נשמע נכון יותר — אי אפשר לשכוח אותו. אבל
// המסלול **אינו ידוע ברגע ה-INSERT**: ‎grant_launch_promo‎ רצה מיד אחריו,
// בקריאה נפרדת, ומעלה את השורה ל-Elite. טריגר שהיה קורא ‎tier‎ ברגע היצירה
// היה מדווח "Pay&GO" על כל מצטרף/ת חדש/ה — כלומר השדה היחיד שהתבקש כאן היה
// שקר עקבי.
//
// לכן ההתראה נשלחת מהקצה של מסלול ההצטרפות, אחרי שההטבה כבר הוענקה. שלוש
// נקודות הכניסה לעולם התיווך הן **בדיוק אותן שלוש** של
// ‎_shared/launch-promo.ts‎ — ‏`agency-signup`, ‏`create-own-agency` ו-
// ‏`join-agency` — ולכן הכלל פשוט: **איפה שקוראים ל-‎grantLaunchPromo‎,
// קוראים גם לכאן, בשורה שאחריה.**
//
// ‏בעלי מקצוע ויזמים אינם נוגעים ב-tier בכלל, ולכן הם נקראים פשוט בסוף
// ההרשמה שלהם.
//
// ## למה בעל/ת מקצוע מדווח/ת בהרשמה ולא בתשלום
//
// כרטיסיית בעל/ת מקצוע נולדת `pending_payment` ועולה לאוויר רק אחרי אימות
// תשלום, ולכן "ההצטרפות" שלה נראית כמו רגע התשלום. היא לא — **וכשאין
// סליקה היא בכלל לא מגיעה**: ‏`professional-signup` מחזירה
// ‏`payment_unavailable`, הכרטיסייה ממתינה, והטקסט שחוזר לגולש/ת מבטיח
// "ניצור קשר להשלמת התשלום". מי שאמור/ה ליצור את הקשר הזה הוא/היא בדיוק
// הנמען/ת של ההתראה — והתראה שתלויה בתשלום שלא קורה הייתה שותקת דווקא
// במקרה שדורש אדם.
//
// לכן הדיווח הוא ברגע ההרשמה, ומצב התשלום נכתב **בתוך** ההודעה.
//
// ## מה ההודעה לא נושאת
//
// אימייל וטלפון של המצטרף/ת. הם קיימים בכרטיס, אבל התראה היא לא מסך ניהול:
// היא יוצאת לוואטסאפ, נשארת שם, ואת פרטי הקשר ממילא רואים בדשבורד. אותה
// הפרדה בדיוק שנשמרת ב-`platform_admin_monthly_report` (ראו
// ‏docs/platform-admin-dashboard.md).
//
// **כישלון כאן לא מפיל הצטרפות.** משרד שנפתח והתראה שלא יצאה הם באג;
// התראה שמפילה פתיחת משרד היא נזק. הפונקציה בולעת כל שגיאה ומדווחת ללוג.
//
// ## אבל שקט מוחלט הוא כשל בפני עצמו — וכך זה קרה
//
// שאילתת ה-member נכתבה עם ‎agencies(name, slug)‎ כ-embed, ו-PostgREST מחזיר
// עליו ‎PGRST201 (HTTP 300)‎ — יש שני נתיבים בין `agency_members` ל-`agencies`
// והוא מסרב לבחור (ההסבר המלא ב-`agency-lookup.ts`). **השאילתה כולה נכשלה**,
// הפונקציה עשתה בדיוק מה שנכתב כאן — בלעה, רשמה ללוג, והמשיכה — ומנהל/ת
// הפלטפורמה לא קיבל/ה ולו התראה אחת על אף הצטרפות. ב-16.9.2026 היו בלוג שתי
// שורות ‎`member lookup failed`‎, ובטבלת `notifications` אפס שורות מסוג
// ‏`platform_signup`. שום דבר אחר לא נראה שבור.
//
// שני תיקונים, ושניהם נדרשים:
//
//   1. **אין embed.** שם המשרד נטען בשאילתה שנייה לפי `agency_id`, בדיוק
//      כמו ב-`crm.html` וב-`whatsapp-webhook/index.ts` שכבר נתקלו בזה.
//      ‏`scripts/check_agency_embed.py` חוסם ב-CI embed חדש כזה.
//   2. **כשל בשליפה מוריד פרטים, לא משתיק התראה.** התראה בלי שם משרד עדיין
//      אומרת "מישהו הצטרף עכשיו, לך/י לדשבורד"; היעדר התראה אומר שלא קרה
//      כלום. השקט הוא הכשל היקר מבין השניים, ולכן ‎announcePlatformSignup‎
//      שולחת התראה מצומצמת גם כשהשליפה נכשלה.
// ============================================================================

import { PROMO_TIER, TIER_NAMES, type Tier } from "./launch-promo.ts";
import { loadAgency } from "./agency-lookup.ts";

const SITE_BASE = (Deno.env.get("SITE_BASE_URL") || "https://shuknadlan.co.il")
  .replace(/\/+$/, "");

/* שני סוגי ההתראה של מנהל/ת הפלטפורמה. חייבים להישאר זהים ל-
   ‏`notifications_type_check` ול-NOTIF_TYPES ב-crm.html.

   החלוקה היא לפי השאלה שההודעה עונה עליה, ולא לפי הקהל: מי **הגיע**
   (‏signup) מול **כסף** — שדרוג מסלול, בקשת שדרוג, ותשלום של בעל/ת מקצוע
   (‏upgrade). לכן תשלום שהתקבל אינו signup שני על אותו אדם. */
export const PLATFORM_SIGNUP_TYPE = "platform_signup";
export const PLATFORM_UPGRADE_TYPE = "platform_upgrade";

/* ‏rpc אינו בשימוש כאן — הכתיבה היא INSERT רגיל עם service_role, שעוקף RLS
   בדיוק כמו בכל שאר יצרני ההתראות. הטיפוס מצומצם למתודה היחידה שנדרשת, כדי
   שהמודול לא ייקשר לגרסת supabase-js מסוימת. */
type QueryResult<T> = PromiseLike<{ data: T; error: { message: string } | null }>;
type Client = {
  from: (table: string) => any;
};

type SignupKind = "agency" | "agent";

interface AgencyRef {
  name: string | null;
  slug: string | null;
}

interface MemberRow {
  agency_id: string | null;
  display_name: string | null;
  slug: string | null;
  role: string | null;
  tier: string | null;
  promo_tier: string | null;
  promo_ends_at: string | null;
  promo_ended_at: string | null;
}

/** שם המשרד והכתובת שלו — בשאילתה נפרדת ולא ב-embed. ראו `_shared/agency-lookup.ts`. */
async function agencyOf(
  supabase: Client,
  agencyId: string | null,
): Promise<AgencyRef | null> {
  return (await loadAgency(supabase, agencyId)) as AgencyRef | null;
}

/**
 * שם המסלול כפי שהוא ברגע ההצטרפות.
 *
 * בתוך תקופת ההטבה זו אינה "בחירה" אלא הענקה, וההודעה אומרת את זה במפורש:
 * "Elite · הטבת השקה עד 3.2027". בלי הסיומת הזו ההתראה נראית כאילו נמכר
 * מסלול בתשלום, וזו בדיוק הטעות שהייתה מתגלה בחשבונית שלא הגיעה.
 */
function tierLabel(row: MemberRow): string {
  const promoActive = !!row.promo_ends_at && !row.promo_ended_at &&
    new Date(row.promo_ends_at) > new Date();

  if (promoActive) {
    const tier = (row.promo_tier || PROMO_TIER) as Tier;
    const until = new Date(row.promo_ends_at!).toLocaleDateString("he-IL", {
      month: "numeric",
      year: "numeric",
    });
    return `${TIER_NAMES[tier] ?? tier} · הטבת השקה עד ${until}`;
  }

  const tier = (row.tier || "free") as Tier;
  return TIER_NAMES[tier] ?? String(row.tier);
}

/** שורה אחת, בלי תווי שורה חדשה: הגוף נכנס גם לפרמטר של תבנית Meta. */
function joinParts(parts: (string | null | undefined)[]): string {
  return parts
    .map((p) => String(p ?? "").trim())
    .filter(Boolean)
    .join(" · ");
}

/**
 * מודיעה למנהלי הפלטפורמה על הצטרפות חדשה.
 *
 * ‏kind='agency' — משרד חדש נפתח, וה-member הוא המנהל/ת המייסד/ת.
 * ‏kind='agent'  — מתווך/ת נכנס/ת לראשונה למשרד קיים.
 *
 * שני המסלולים מדווחים אירוע אחד ולא שניים: פתיחת משרד היא גם הצטרפות של
 * המנהל/ת, ושתי התראות על אותו רגע היו שתי שורות שאומרות את אותו הדבר.
 */
export async function announcePlatformSignup(
  supabase: Client,
  memberId: string,
  kind: SignupKind,
): Promise<void> {
  try {
    const { data: member, error: memberErr } = await (supabase
      .from("agency_members")
      .select(
        "agency_id, display_name, slug, role, tier, promo_tier, promo_ends_at, promo_ended_at",
      )
      .eq("id", memberId)
      .maybeSingle() as QueryResult<MemberRow | null>);

    if (memberErr || !member) {
      // התראה מצומצמת ולא שתיקה. ראו ההסבר בראש הקובץ: זו בדיוק הנקודה שבה
      // הבאג הקודם נעלם — כשל בשליפה הפך לאפס התראות במשך שבועות.
      console.error("platform signup alert: member lookup failed", memberErr?.message);
      await notifyPlatformAdmins(
        supabase,
        kind === "agency" ? "משרד תיווך חדש הצטרף" : "מתווך/ת חדש/ה הצטרף/ה",
        joinParts([
          "לא הצלחנו לשלוף את הפרטים — הם בדשבורד",
          `${SITE_BASE}/crm.html?goto=accSubscriptions`,
        ]),
      );
      return;
    }

    const agency = await agencyOf(supabase, member.agency_id);
    const agencyName = agency?.name || "";
    const agencySlug = agency?.slug || "";
    const who = member.display_name || "ללא שם";
    const tier = tierLabel(member);

    const title = kind === "agency"
      ? `משרד תיווך חדש: ${agencyName || who}`
      : `מתווך/ת חדש/ה: ${who}`;

    const body = kind === "agency"
      ? joinParts([
        `מנהל/ת: ${who}`,
        `מסלול ${tier}`,
        agencySlug ? `${SITE_BASE}/agency.html?slug=${encodeURIComponent(agencySlug)}` : null,
      ])
      : joinParts([
        agencyName,
        member.role === "manager" ? "מנהל/ת" : null,
        `מסלול ${tier}`,
        member.slug ? `${SITE_BASE}/agent.html?slug=${encodeURIComponent(member.slug)}` : null,
      ]);

    await notifyPlatformAdmins(supabase, title, body);
  } catch (err) {
    console.error("platform signup alert failed", err);
  }
}

/**
 * הכתיבה עצמה: שורת התראה לכל מנהל/ת פלטפורמה פעיל/ה.
 *
 * נקודה אחת לכל ארבעת הקהלים, כדי ששינוי בכללי הנמענים לא יצטרך להיזכר
 * בארבעה מקומות. **לעולם לא זורקת** — ראו ההסבר בראש הקובץ.
 */
async function notifyPlatformAdmins(
  supabase: Client,
  title: string,
  body: string,
  type: string = PLATFORM_SIGNUP_TYPE,
): Promise<void> {
  // ‏active=true בלבד: מנהל/ת פלטפורמה שכרטיסו/ה כובה אינו/ה מקבל/ת התראות,
  // בדיוק כמו ב-alert_platform_admin_on_low_review.
  const { data: admins, error: adminErr } = await (supabase
    .from("agency_members")
    .select("id")
    .eq("is_platform_admin", true)
    .eq("active", true) as QueryResult<{ id: string }[] | null>);

  if (adminErr || !admins?.length) {
    if (adminErr) console.error("platform signup alert: admin lookup failed", adminErr.message);
    return;
  }

  // ‏INSERT אחד לכל המנהלים. הטריגר notifications_apply_preferences מסנן
  // בשקט שורה של מי שכיבה/תה את הסוג — ולכן אין כאן בדיקת העדפות.
  const { error: insErr } = await (supabase.from("notifications").insert(
    admins.map((a) => ({
      agent_id: a.id,
      type,
      title,
      body,
    })),
  ) as QueryResult<unknown>);

  if (insErr) console.error("platform signup alert: insert failed", insErr.message);
}

/* תוויות תחומי העיסוק. עותק מכוון של TYPE_LABELS ב-professional-signup:
   ‏_shared אינו מייבא מפונקציה, וייבוא הפוך (פונקציה מייבאת מ-_shared) היה
   מחייב להוציא לכאן גם את VALID_TYPES שחי בשתי פונקציות נוספות. שש שורות
   תצוגה, שנקראות במקום אחד. */
const PROFESSIONAL_TYPE_LABELS: Record<string, string> = {
  mortgage_advisor: "יועץ/ת משכנתאות",
  appraiser: "שמאי/ת מקרקעין",
  architect: "אדריכל/ית",
  interior_designer: "מעצב/ת פנים",
  real_estate_lawyer: "עו״ד מקרקעין",
  general: "בעל/ת מקצוע",
};

interface PlacementRow {
  advertiser_name: string | null;
  business_name: string | null;
  advertiser_type: string | null;
  target_region: string | null;
  slug: string | null;
  status: string | null;
}

/**
 * בעל/ת מקצוע שנרשם/ה לכרטיסייה.
 *
 * ‏`payment` הוא מה שקרה מיד אחרי ההרשמה, ולא מצב סופי:
 *   ‏· `{ months, amount }` — נפתחה הזמנה והגולש/ת הופנה/תה לתשלום.
 *   ‏· `null`               — אין סליקה. הכרטיסייה ממתינה **ליצירת קשר**,
 *                             וזו בדיוק השורה שהופכת את ההתראה למשימה.
 */
export async function announceProfessionalSignup(
  supabase: Client,
  placementId: string,
  payment: { months: number; amount: number } | null,
): Promise<void> {
  try {
    const { data: p, error } = await (supabase
      .from("ad_placements")
      .select("advertiser_name, business_name, advertiser_type, target_region, slug, status")
      .eq("id", placementId)
      .maybeSingle() as QueryResult<PlacementRow | null>);

    if (error || !p) {
      console.error("platform signup alert: placement lookup failed", error?.message);
      return;
    }

    const who = p.advertiser_name || p.business_name || "ללא שם";
    const field = PROFESSIONAL_TYPE_LABELS[p.advertiser_type || ""] || "בעל/ת מקצוע";

    const payLine = payment
      ? `הופנה/תה לתשלום · ${payment.months} חודשים · ₪${Math.round(payment.amount)}`
      // הניסוח כאן הוא הפעולה הנדרשת ולא מצב השורה במסד: "pending_payment"
      // נכון ולא אומר למי שקורא/ת את ההודעה מה לעשות עכשיו.
      : "אין סליקה — ממתין/ה ליצירת קשר להשלמת התשלום";

    const title = `בעל/ת מקצוע חדש/ה: ${who}`;
    const body = joinParts([
      field,
      p.business_name && p.business_name !== who ? p.business_name : null,
      p.target_region,
      payLine,
      p.slug ? `${SITE_BASE}/professional.html?slug=${encodeURIComponent(p.slug)}` : null,
    ]);

    await notifyPlatformAdmins(supabase, title, body);
  } catch (err) {
    console.error("platform signup alert failed", err);
  }
}

interface DeveloperRow {
  name: string | null;
  contact_name: string | null;
  city: string | null;
  slug: string | null;
}

/**
 * חברה יזמית שנפתחה.
 *
 * "המסלול" כאן הוא שאין מסלול: פתיחת החברה חינם, והחיוב הוא לפי פרויקט
 * (‏`project-manage`). ההודעה אומרת את זה במפורש — אחרת "חברה יזמית חדשה"
 * נקראת כמו הכנסה, ואין כאן עדיין שקל.
 */
export async function announceDeveloperSignup(
  supabase: Client,
  developerId: string,
): Promise<void> {
  try {
    const { data: d, error } = await (supabase
      .from("developers")
      .select("name, contact_name, city, slug")
      .eq("id", developerId)
      .maybeSingle() as QueryResult<DeveloperRow | null>);

    if (error || !d) {
      console.error("platform signup alert: developer lookup failed", error?.message);
      return;
    }

    const title = `חברה יזמית חדשה: ${d.name || "ללא שם"}`;
    const body = joinParts([
      d.contact_name ? `איש/אשת קשר: ${d.contact_name}` : null,
      d.city,
      "פתיחת החברה ללא תשלום · החיוב הוא לפי פרויקט",
      d.slug ? `${SITE_BASE}/developer.html?slug=${encodeURIComponent(d.slug)}` : null,
    ]);

    await notifyPlatformAdmins(supabase, title, body);
  } catch (err) {
    console.error("platform signup alert failed", err);
  }
}

interface PaidOrderRow {
  months: number | null;
  amount: number | null;
  period_end: string | null;
  ad_placements: PlacementRow | PlacementRow[] | null;
}

/**
 * בעל/ת מקצוע ששילם/ה — הכרטיסייה עלתה לאוויר.
 *
 * האירוע השני והאחרון במסלול שלו/ה, ושונה מההרשמה: שם נרשם מי רוצה, כאן
 * נכנס כסף. לכן הסוג הוא `platform_upgrade` ולא `platform_signup` — החלוקה
 * בין שני הסוגים היא "מי הגיע" מול "כסף", ולא לפי קהל.
 *
 * נקראת מ-`wallet-topup-callback` בנקודת ההצלחה היחידה של `settleOrder`,
 * שמשרתת גם את ה-webhook וגם את סבב ה-reconcile. כפילות אינה אפשרית:
 * ‏`settleOrder` יוצאת מוקדם על הזמנה שאינה `pending`.
 */
export async function announceProfessionalPaid(
  supabase: Client,
  orderId: string,
): Promise<void> {
  try {
    const { data: o, error } = await (supabase
      .from("ad_orders")
      .select("months, amount, period_end, ad_placements(advertiser_name, business_name, advertiser_type, target_region, slug, status)")
      .eq("id", orderId)
      .maybeSingle() as QueryResult<PaidOrderRow | null>);

    if (error || !o) {
      console.error("platform paid alert: order lookup failed", error?.message);
      return;
    }

    const pl = Array.isArray(o.ad_placements) ? (o.ad_placements[0] ?? null) : o.ad_placements;
    const who = pl?.advertiser_name || pl?.business_name || "בעל/ת מקצוע";
    const field = PROFESSIONAL_TYPE_LABELS[pl?.advertiser_type || ""] || "בעל/ת מקצוע";
    const until = o.period_end
      ? new Date(o.period_end).toLocaleDateString("he-IL", { day: "numeric", month: "numeric", year: "numeric" })
      : null;

    const title = `תשלום התקבל: ${who}`;
    const body = joinParts([
      `כרטיסיית ${field} עלתה לאוויר`,
      o.months ? `${o.months} חודשים` : null,
      o.amount ? `₪${Math.round(Number(o.amount))}` : null,
      until ? `עד ${until}` : null,
      pl?.slug ? `${SITE_BASE}/professional.html?slug=${encodeURIComponent(pl.slug)}` : null,
    ]);

    await notifyPlatformAdmins(supabase, title, body, PLATFORM_UPGRADE_TYPE);
  } catch (err) {
    console.error("platform paid alert failed", err);
  }
}
