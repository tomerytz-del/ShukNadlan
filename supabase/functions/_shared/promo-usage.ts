// ============================================================================
// "מה קיבלת בתקופת ההטבה" - סיכום שימוש בסוף ניסיון ההשקה
//
// נקרא מ-promo-lifecycle ונכנס למייל ההתראה השנייה (שבועיים לפני) ולמייל
// הסיום. שלוש החלטות:
//
//   1. **רק מה שנספר בוודאות, ורק מה שאינו אפס.** מספרים מ-head count על
//      טבלאות קיימות (בלי מיגרציה). מדד ב-0 לא מוצג: "קיבלת 0 לידים" הוא
//      הפוך ממה שהמכתב אמור לעשות. אם הכול אפס - אין בלוק בכלל.
//   2. **אין המלצת מסלול** (תומר, 11.11.2026). עד אז הבלוק המליץ Elite או
//      "PROFESSIONAL כנראה מספיק" לפי בלעדיות וסרטון, אבל הדמיות, 360° ו-CMA
//      לכתובת אינם נמדדים, והמלצה על נתון חלקי עלולה להוריד מסלול למי שמשתמש
//      בהם. הבלוק אומר מה היה, והבחירה נשארת של הסוכן/ת.
//   3. **שגיאה בשאילתה אינה מפילה את המייל.** סיכום חסר עדיף על מייל שלא יצא.
// ============================================================================

export interface PromoUsage {
  leads: number;
  properties: number;
  clients: number;
  signedAgreements: number;
  videos: number;
  calls: number;
  /** false = לפחות שאילתה אחת נכשלה. מספרים חלקיים אינם מספיקים להמלצה. */
  complete: boolean;
}

const ZERO: PromoUsage = {
  leads: 0, properties: 0, clients: 0, signedAgreements: 0,
  videos: 0, calls: 0, complete: false,
};

/** ‏null = השאילתה נכשלה. אפס אמיתי ושגיאה אינם אותו דבר. */
async function count(q: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number | null> {
  const { count: n, error } = await q;
  if (error) { console.error("promo usage count failed", error.message); return null; }
  return n ?? 0;
}

/** המספרים מתחילת החברות של הסוכן/ת ועד עכשיו. ‏supabase = לקוח service_role. */
// deno-lint-ignore no-explicit-any
export async function fetchPromoUsage(supabase: any, memberId: string, since: string): Promise<PromoUsage> {
  try {
    const head = { count: "exact", head: true } as const;
    const [leads, properties, clients, signed, videos, calls] = await Promise.all([
      count(supabase.from("leads").select("id", head).eq("agent_id", memberId).gte("created_at", since)),
      count(supabase.from("properties").select("id", head).eq("agent_id", memberId).gte("created_at", since)),
      count(supabase.from("agent_clients").select("id", head).eq("agent_id", memberId).gte("created_at", since)),
      // מסמך ההסכמה לשיווק (marketing_*) אינו הסכם: חתימה על בלעדיות יוצרת שניים, ו-agreement_is_consent
      // במסד מוציאה אותו מכל מונה אחר (docs/client-agreements.md). הרשימה היא ההפך שלה.
      count(supabase.from("agreements").select("id", head).eq("agent_id", memberId).eq("status", "signed")
        .in("kind", ["buy", "sell", "tenant", "landlord", "exclusive_sell", "exclusive_landlord"]).gte("signed_at", since)),
      count(supabase.from("property_video_jobs").select("id", head).eq("agent_id", memberId).eq("status", "done").gte("created_at", since)),
      count(supabase.from("agent_calls").select("id", head).eq("agent_id", memberId).gte("created_at", since)),
    ]);
    const all = [leads, properties, clients, signed, videos, calls];
    const n = (v: number | null) => v ?? 0;
    return {
      leads: n(leads), properties: n(properties), clients: n(clients), signedAgreements: n(signed),
      videos: n(videos), calls: n(calls),
      complete: all.every((v) => v !== null),
    };
  } catch (err) {
    console.error("promo usage failed", memberId, String((err as Error)?.message ?? err));
    return { ...ZERO };
  }
}

/** שורות לתצוגה, רק מדדים חיוביים, בלשון נכונה לכל מספר. */
export function usageLines(u: PromoUsage): string[] {
  const out: string[] = [];
  const add = (n: number, one: string, many: (n: number) => string) => {
    if (n > 0) out.push(n === 1 ? one : many(n));
  };
  add(u.leads, "ליד אחד נכנס אליך", (n) => `${n} לידים נכנסו אליך`);
  add(u.properties, "נכס אחד הועלה", (n) => `${n} נכסים הועלו`);
  add(u.clients, "לקוח אחד נוסף לקובץ", (n) => `${n} לקוחות נוספו לקובץ`);
  add(u.signedAgreements, "הסכם אחד נחתם דיגיטלית", (n) => `${n} הסכמים נחתמו דיגיטלית`);
  add(u.videos, "סרטון שיווקי אחד הופק", (n) => `${n} סרטונים שיווקיים הופקו`);
  add(u.calls, "שיחה אחת נרשמה", (n) => `${n} שיחות נרשמו`);
  return out;
}
