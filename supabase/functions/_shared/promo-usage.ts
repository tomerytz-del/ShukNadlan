// ============================================================================
// "מה קיבלת בתקופת ההטבה" - סיכום שימוש בסוף ניסיון ההשקה
//
// נקרא מ-promo-lifecycle ונכנס למייל ההתראה השנייה (שבועיים לפני) ולמייל
// הסיום. שלוש החלטות:
//
//   1. **רק מה שנספר בוודאות, ורק מה שאינו אפס.** מספרים מ-head count על
//      טבלאות קיימות (בלי מיגרציה). מדד ב-0 לא מוצג: "קיבלת 0 לידים" הוא
//      הפוך ממה שהמכתב אמור לעשות. אם הכול אפס - אין בלוק בכלל.
//   2. **ההמלצה נגזרת ממה שנמדד ושמבדיל בין המסלולים:** סרטון שיווקי ו/או
//      הסכם בלעדיות חתום (docs/pricing-and-tiers.md: Elite למי שמגייס
//      בלעדיות ומפיק סרטונים). בלי אחד מהם - PROFESSIONAL כנראה מספיק, ואנחנו
//      אומרים את זה. שימו לב: הדמיות, 360° ו-CMA לכתובת אינם נמדדים כאן, ולכן
//      הנוסח זהיר ("כנראה"). המלצה שתמיד אומרת "Elite" אינה המלצה.
//   3. **שגיאה בשאילתה אינה מפילה את המייל.** סיכום חסר עדיף על מייל שלא יצא.
// ============================================================================

import type { Tier } from "./launch-promo.ts";

export interface PromoUsage {
  leads: number;
  properties: number;
  clients: number;
  signedAgreements: number;
  exclusiveSigned: number;
  videos: number;
  calls: number;
  /** false = לפחות שאילתה אחת נכשלה. מספרים חלקיים אינם מספיקים להמלצה. */
  complete: boolean;
}

const ZERO: PromoUsage = {
  leads: 0, properties: 0, clients: 0, signedAgreements: 0,
  exclusiveSigned: 0, videos: 0, calls: 0, complete: false,
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
    const [leads, properties, clients, signed, exclusive, videos, calls] = await Promise.all([
      count(supabase.from("leads").select("id", head).eq("agent_id", memberId).gte("created_at", since)),
      count(supabase.from("properties").select("id", head).eq("agent_id", memberId).gte("created_at", since)),
      count(supabase.from("agent_clients").select("id", head).eq("agent_id", memberId).gte("created_at", since)),
      count(supabase.from("agreements").select("id", head).eq("agent_id", memberId).eq("status", "signed").gte("signed_at", since)),
      count(supabase.from("agreements").select("id", head).eq("agent_id", memberId).eq("status", "signed")
        .in("kind", ["exclusive_sell", "exclusive_landlord"]).gte("signed_at", since)),
      count(supabase.from("property_video_jobs").select("id", head).eq("agent_id", memberId).eq("status", "done").gte("created_at", since)),
      count(supabase.from("agent_calls").select("id", head).eq("agent_id", memberId).gte("created_at", since)),
    ]);
    const all = [leads, properties, clients, signed, exclusive, videos, calls];
    const n = (v: number | null) => v ?? 0;
    return {
      leads: n(leads), properties: n(properties), clients: n(clients), signedAgreements: n(signed),
      exclusiveSigned: n(exclusive), videos: n(videos), calls: n(calls),
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
  add(u.clients, "לקוח/ה אחד/ת נוספ/ה לקובץ", (n) => `${n} לקוחות נוספו לקובץ`);
  add(u.signedAgreements, "הסכם אחד נחתם דיגיטלית", (n) => `${n} הסכמים נחתמו דיגיטלית`);
  add(u.videos, "סרטון שיווקי אחד הופק", (n) => `${n} סרטונים שיווקיים הופקו`);
  add(u.calls, "שיחה אחת נרשמה", (n) => `${n} שיחות נרשמו`);
  return out;
}

export interface PromoRecommendation {
  tier: Tier;
  reason: string;
}

/** ‏null = אין שימוש כלל, או שמדד אחד לא נספר (המלצה על נתון חלקי עלולה לטעון
 *  "לא חתמת על בלעדיות" למי שחתם/ה, ולהטות החלטת רכישה). */
export function recommendTier(u: PromoUsage): PromoRecommendation | null {
  if (!u.complete) return null;
  if (usageLines(u).length === 0) return null;
  if (u.exclusiveSigned > 0 || u.videos > 0) {
    const parts: string[] = [];
    if (u.exclusiveSigned > 0) parts.push("חתמת על בלעדיות");
    if (u.videos > 0) parts.push("הפקת סרטון שיווקי");
    return {
      tier: "premium",
      reason: `${parts.join(" ו")} - שני דברים שנמצאים ב-Elite, ולכן Elite מתאים לך.`,
    };
  }
  return {
    tier: "mid",
    reason: "לא חתמת על בלעדיות ולא הפקת סרטון בתקופה הזו, ולכן PROFESSIONAL (גבריאלה ופניות ללא הגבלה) כנראה מספיק לך, אלא אם השתמשת בהדמיות, ב-360° או ב-CMA לכתובת.",
  };
}
