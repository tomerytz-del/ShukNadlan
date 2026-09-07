// ============================================================================
// הטבת ההשקה — הצד של הקורא
//
// שלוש נקודות כניסה למערכת מעניקות את אותה הטבה: שיוך לפי הזמנה
// (‏join-agency), פתיחת משרד מתוך חשבון קיים (‏create-own-agency) והרשמת משרד
// חדש מהאתר (‏agency-signup). בלי הקובץ הזה אותה קריאה הייתה נכתבת שלוש
// פעמים, ומספר החודשים היה מתחיל להיות שונה בין המסלולים ברגע שמישהו משנה
// אותו במקום אחד.
//
// ‏ההענקה עצמה יושבת ב-‎grant_launch_promo‎ במסד והיא אידמפוטנטית: קריאה
// שנייה על אותה שורה לא מאריכה את התקופה, ולכן מותר וכדאי לקרוא לה בכל
// מסלול הצטרפות בלי לבדוק קודם.
//
// ‏**שליחה שנכשלת לא זורקת.** מתנה שלא ניתנה היא באג, אבל היא לא סיבה
// להכשיל פתיחת משרד או שיוך לצוות — הקורא ממשיך, וההענקה תיתפס בכניסה
// הבאה.
// ============================================================================

/** המזהים במסד. השמות המסחריים (Pay&GO / PROFESSIONAL / Elite) ב-assets/tiers.js. */
export const TIERS = ["free", "mid", "premium"] as const;
export type Tier = typeof TIERS[number];

export const TIER_NAMES: Record<Tier, string> = {
  free: "Pay&GO",
  mid: "PROFESSIONAL",
  premium: "Elite",
};

/** מחיר חודשי לפני מע"מ. משמש בהודעות בלבד — הגבייה אינה כאן. */
export const TIER_PRICES: Record<Tier, number> = { free: 0, mid: 750, premium: 950 };

/* תקופת ההשקה. שלושת המספרים האלה חוזרים ב-assets/tiers.js (תצוגה)
   וב-promo-lifecycle (התראות), ושלושתם חייבים להישאר זהים: דף שמבטיח חצי
   שנה ושרת שנותן שלושה חודשים הוא תלונה, לא באג נסבל. */
export const PROMO_TIER: Tier = "premium";
export const PROMO_MONTHS = 6;
/** ימים לפני הסיום שבהם נשלחות שתי ההתראות — חודש לפני, ואז שבועיים אחרי. */
export const PROMO_NOTICE_DAYS = [30, 14] as const;

export interface PromoGrant {
  tier: Tier;
  ends_at: string;
  months: number;
}

/* ‏PromiseLike ולא Promise: ‏rpc של supabase-js מחזירה בונה שאילתה שהוא
   thenable, לא Promise ממש. חתימה מדויקת כאן חוסכת המרה בכל קורא. */
type RpcCaller = {
  rpc: (fn: string, args: Record<string, unknown>) =>
    PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

/** מעניקה את הטבת ההשקה לשורה, אם היא זכאית. ‏null = לא הוענק דבר. */
export async function grantLaunchPromo(
  supabase: RpcCaller,
  memberId: string,
): Promise<PromoGrant | null> {
  const { data, error } = await supabase.rpc("grant_launch_promo", {
    p_member_id: memberId,
    p_tier: PROMO_TIER,
    p_months: PROMO_MONTHS,
  });
  if (error) {
    console.error("grant_launch_promo failed", error.message);
    return null;
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    { granted?: boolean; result_tier?: string; ends_at?: string } | null;
  if (!row?.granted || !row.result_tier || !row.ends_at) return null;
  return { tier: row.result_tier as Tier, ends_at: row.ends_at, months: PROMO_MONTHS };
}
