// ============================================================================
// עולם הפרויקטים החדשים — מה שמשותף לארבע פונקציות הקצה
//
// שלוש הפונקציות שנוגעות בפרויקטים (developer-signup, project-manage,
// project-lead-*) חלקו עד כדי כך הרבה קוד ניקוי קלט שהעתקה ביניהן הייתה
// מבטיחה שהן ייפרדו: מספיק שאחת תוסיף סוג מדיה והשנייה לא, כדי שפריט
// שנשמר לא ייקרא. הקטלוגים כאן הם מקור אמת אחד לשלושתן — ולאותם ערכים
// בדיוק שה-CHECK במסד אוכף.
// ============================================================================

export function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

export function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: corsHeaders() });
}

export function text(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/[ \t]+/g, " ");
  return trimmed ? trimmed.slice(0, maxLen) : null;
}

/** טקסט ארוך — שומר שורות חדשות (תיאור הפרויקט, טקסט שיווקי). */
export function longText(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLen) : null;
}

/** ‏http(s) בלבד. ‏javascript: בשדה שנשמר ומוצג כקישור הוא XScript מאוחסן. */
export function safeUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return /^https?:$/.test(url.protocol) ? url.href.slice(0, 1000) : null;
  } catch { return null; }
}

export function num(value: unknown, min: number, max: number): number | null {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

export function int(value: unknown, min: number, max: number): number | null {
  const n = num(value, min, max);
  return n === null ? null : Math.trunc(n);
}

export function bool(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

export function email(value: unknown): string | null {
  const v = text(value, 254);
  return v && /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(v) ? v : null;
}

/** אותו נרמול של professional-manage — wa.me ו-tel: רוצים ספרות עם קידומת. */
export function phoneE164(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let digits = value.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = "972" + digits.slice(1);
  else if (!digits.startsWith("972") && digits.length <= 10) digits = "972" + digits;
  return digits.length >= 11 && digits.length <= 15 ? digits : null;
}

/**
 * מספר ח״פ / עוסק מורשה ישראלי.
 *
 * מנורמל לתשע ספרות: מספרי חברה ועמותה הם תשע ספרות, ומספר עוסק מורשה
 * נכתב לא פעם בשמונה כשהאפס המוביל נשמט בהקלדה או בהעתקה מ-Excel. השלמת
 * האפס כאן ולא בתצוגה, כדי ששתי הכתיבות של אותו עסק לא ייראו כשני עסקים.
 *
 * מקפים, רווחים ותווי כיווניות מוסרים לפני הבדיקה — הם נפוצים בהדבקה
 * מאתר רשם החברות ואינם חלק מהמספר.
 */
export function companyNumber(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 8) return "0" + digits;
  return digits.length === 9 ? digits : null;
}

/** ‏[^\p{L}\p{N}] משאיר אותיות עבריות ולועזיות וספרות. הסיומת מבטיחה ייחודיות. */
export function slugify(value: string, fallback: string): string {
  const base = value.trim().toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return base ? base.slice(0, 60) : fallback;
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? value as T : null;
}

export function stringList(value: unknown, allowed: readonly string[], maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item === "string" && allowed.includes(item)) seen.add(item);
    if (seen.size >= maxItems) break;
  }
  return [...seen];
}

export function freeList(value: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const t = text(item, maxLen);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= maxItems) break;
  }
  return out;
}

export function numberList(value: unknown, min: number, max: number, maxItems: number): number[] {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  for (const item of value) {
    const n = num(item, min, max);
    if (n !== null && !out.includes(n)) out.push(n);
    if (out.length >= maxItems) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// הקטלוגים — חייבים להישאר זהים ל-CHECK במסד ולרשימות ב-projects.html
// ---------------------------------------------------------------------------
export const PROJECT_STAGES = ["planning","pre_sale","under_construction","ready","completed"] as const;
export const PROJECT_STATUSES = ["draft","active","paused","archived"] as const;
export const MEDIA_KINDS = ["image","video","tour_3d","floor_plan","document"] as const;
export const UNIT_AVAILABILITY = ["available","few_left","sold_out"] as const;
export const LEAD_TIMELINES = ["now","3_months","6_months","12_months","exploring"] as const;
export const LEAD_PURPOSES = ["residence","investment","upgrade","first_home"] as const;

/** סוגי הנכס שפרויקט חדש מציע. תת-קבוצה של סוגי הנכס באתר — פרויקט חדש
 *  לא מוכר "דירת נופש" או "מחסן". */
export const PROJECT_PROPERTY_TYPES = [
  "דירה", "דירת גן", "פנטהאוז", "דופלקס", "מיני פנטהאוז",
  "בית פרטי/קוטג'", "דו משפחתי", "מסחרי", "משרדים",
] as const;

/** המאפיינים שמופיעים כצ׳יפים בדף הפרויקט ובסינון בדף הפרויקטים. */
export const PROJECT_FEATURES = [
  "elevator", "parking", "mamad", "balcony", "storage", "garden",
  "pool", "gym", "lobby", "concierge", "accessible", "green_building",
  "smart_home", "solar", "playground", "synagogue_nearby",
] as const;

/** ניקוד ההתעניינות של ליד — מה שקובע אם הוא נכנס למדף ובאיזה סדר.
 *  לוח זמנים קרוב ותקציב מוגדר הם האותות היחידים שיש לנו לפני שיחה. */
export function intentScore(input: {
  timeline?: string | null; max_price?: number | null; rooms?: number[];
  cities?: string[]; message?: string | null; email?: string | null;
}): number {
  let score = 40;
  const byTimeline: Record<string, number> = {
    now: 30, "3_months": 22, "6_months": 14, "12_months": 6, exploring: 0,
  };
  score += byTimeline[input.timeline ?? "exploring"] ?? 0;
  if (input.max_price) score += 10;
  if (input.rooms?.length) score += 6;
  if (input.cities?.length) score += 6;
  if (input.message) score += 5;
  if (input.email) score += 3;
  return Math.max(0, Math.min(100, score));
}

/**
 * השדות שחברה חייבת למלא כדי להירשם ולהישאר רשומה.
 *
 * שלושה מסלולים מגיעים לאותה דרישה — טופס ההרשמה, מסך "פתיחת חברה" של
 * מי שנכנס/ה עם Google, ומסך "דף החברה" בדשבורד — ולכן הרשימה יושבת כאן
 * ולא משוכפלת בשלושתם. חברה שתוכל להשאיר את הח״פ ריק במסך העריכה אחרי
 * שמילאה אותו בהרשמה היא בדיוק אותה חברה בלי ח״פ.
 */
export const REQUIRED_DEVELOPER_FIELDS = [
  "company_name", "company_number", "contact_name", "phone", "address", "city",
] as const;

export type DeveloperCore = {
  name: string; company_number: string; contact_name: string;
  phone: string; phone_e164: string; address: string; city: string;
};

/**
 * מנקה ומאמת את גרעין פרטי החברה. מחזיר את השדות החסרים או הפסולים
 * במקום לזרוק, כדי שהטופס יוכל להצביע על כולם בבת אחת ולא אחד־אחד.
 */
export function developerCore(body: Record<string, unknown>): {
  ok: true; value: DeveloperCore;
} | {
  ok: false; missing: string[]; invalid: string[];
} {
  const name = text(body.company_name ?? body.name, 120);
  const number = companyNumber(body.company_number);
  const contact = text(body.contact_name, 120);
  const phoneRaw = text(body.phone, 40);
  const e164 = phoneE164(body.phone);
  const address = text(body.address, 200);
  const city = text(body.city, 80);

  const missing: string[] = [];
  const invalid: string[] = [];
  if (!name) missing.push("company_name");
  if (!contact) missing.push("contact_name");
  if (!address) missing.push("address");
  if (!city) missing.push("city");
  // מספר שהוקלד אך אינו תקין הוא לא "חסר" — ההודעה למשתמש/ת שונה לגמרי
  if (!body.company_number) missing.push("company_number");
  else if (!number) invalid.push("company_number");
  if (!phoneRaw) missing.push("phone");
  else if (!e164) invalid.push("phone");

  if (missing.length || invalid.length) return { ok: false, missing, invalid };
  return {
    ok: true,
    value: {
      name: name!, company_number: number!, contact_name: contact!,
      phone: phoneRaw!, phone_e164: e164!, address: address!, city: city!,
    },
  };
}
