// ============================================================================
// התראת הצטרפות למנהל/ת הפלטפורמה
//
// כל משרד תיווך שנפתח וכל מתווך/ת שנכנס/ת למערכת בפעם הראשונה מצלצל/ת אצל
// מנהל/ת הפלטפורמה — בפעמון, ומשם גם בוואטסאפ דרך `notification-push`.
// ההודעה נושאת את שני הדברים שנשאלים עליהם בפועל: **מי הצטרף/ה** ו**לאיזה
// מסלול**.
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
// נקודות הכניסה הן **בדיוק אותן שלוש** של ‎_shared/launch-promo.ts‎ —
// ‏`agency-signup`, ‏`create-own-agency` ו-`join-agency` — ולכן הכלל פשוט:
// **איפה שקוראים ל-‎grantLaunchPromo‎, קוראים גם לכאן, בשורה שאחריה.**
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
// ============================================================================

import { PROMO_TIER, TIER_NAMES, type Tier } from "./launch-promo.ts";

const SITE_BASE = (Deno.env.get("SITE_BASE_URL") || "https://shuknadlan.co.il")
  .replace(/\/+$/, "");

/** סוג ההתראה. חייב להישאר זהה ל-`notifications_type_check` ול-NOTIF_TYPES ב-crm.html. */
export const PLATFORM_SIGNUP_TYPE = "platform_signup";

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
  display_name: string | null;
  slug: string | null;
  role: string | null;
  tier: string | null;
  promo_tier: string | null;
  promo_ends_at: string | null;
  promo_ended_at: string | null;
  // ‏supabase-js מחזיר קשר to-one כאובייקט, אבל מערך של אחד הוא צורה חוקית
  // באותה ספרייה בדיוק (ראו השימושים ב-‎(x as any).agencies?.name‎ בפונקציות
  // האחרות). התראה בלי שם משרד אינה שווה כלום, ולכן שתי הצורות נתמכות.
  agencies: AgencyRef | AgencyRef[] | null;
}

function agencyOf(row: MemberRow): AgencyRef | null {
  const a = row.agencies;
  return Array.isArray(a) ? (a[0] ?? null) : a;
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
        "display_name, slug, role, tier, promo_tier, promo_ends_at, promo_ended_at, agencies(name, slug)",
      )
      .eq("id", memberId)
      .maybeSingle() as QueryResult<MemberRow | null>);

    if (memberErr || !member) {
      console.error("platform signup alert: member lookup failed", memberErr?.message);
      return;
    }

    const agency = agencyOf(member);
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
        type: PLATFORM_SIGNUP_TYPE,
        title,
        body,
      })),
    ) as QueryResult<unknown>);

    if (insErr) console.error("platform signup alert: insert failed", insErr.message);
  } catch (err) {
    console.error("platform signup alert failed", err);
  }
}
