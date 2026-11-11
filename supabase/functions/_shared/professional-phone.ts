// הטלפון של כרטיסיית בעל מקצוע (‏ad_placements.phone_e164).
//
// נשמר כספרות בלבד בפורמט 972521112222 — בדיוק מה ש-wa.me ו-tel: בעמוד
// הפרופיל מצפים לו (‏PHONE_RE ב-professional.html), ולכן אין שם נרמול.
// משותף ל-professional-signup ול-professional-manage, כדי שמספר שעבר בהרשמה
// לא ייפסל בשמירה הבאה במסך העריכה.
//
// ‏null = אין מספר תקין. שתי הפונקציות דוחות אותו: כרטיסייה בלי טלפון היא עמוד
// בלי כפתור וואטסאפ ובלי חיוג (docs/professional-cards.md, "הטלפון חובה").
export function normalizeProfessionalPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let digits = value.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = "972" + digits.slice(1);
  else if (!digits.startsWith("972") && digits.length <= 10) digits = "972" + digits;
  return digits.length >= 11 && digits.length <= 15 ? digits : null;
}
