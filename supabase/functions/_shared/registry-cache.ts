// ============================================================================
// מטמון תשובות רשם החברות
//
// אותו ח״פ נשאל שלוש פעמים במסלול הרשמה אחד — בהקלדה (חיווי חי), בשליחת
// הטופס, ובבדיקה חוזרת — ולכן בלי מטמון כל הקלדה יוצאת ל-data.gov.il.
//
// שתי החלטות:
//
//   1. **‏unverified לא נשמר.** תשובה כזו אומרת "לא הצלחנו לשאול", ואין
//      טעם לזכור כישלון רשת ל-30 יום: הבדיקה הבאה צריכה לנסות שוב.
//   2. **כשל במטמון אינו מפיל את הבדיקה.** אם הטבלה חסרה או הכתיבה
//      נכשלת, התוצאה מוחזרת כרגיל. מטמון הוא אופטימיזציה, לא תלות.
// ============================================================================

import type { RegistryResult } from "./company-registry.ts";

const DEFAULT_CACHE_DAYS = 30;

async function cacheDays(supabase: any): Promise<number> {
  try {
    const { data } = await supabase.from("pricing_config")
      .select("value").eq("key", "company_registry_cache_days").maybeSingle();
    const n = Number(data?.value);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_CACHE_DAYS;
  } catch { return DEFAULT_CACHE_DAYS; }
}

/** האם האימות פעיל בכלל. מתג כיבוי מהיר בלי פריסה מחדש. */
export async function registryEnabled(supabase: any): Promise<boolean> {
  try {
    const { data } = await supabase.from("pricing_config")
      .select("value").eq("key", "company_registry_enabled").maybeSingle();
    return data ? Number(data.value) === 1 : true;
  } catch { return true; }
}

/** האם "לא נמצא" חוסם הרשמה. ברירת המחדל: לא. */
export async function blockUnknown(supabase: any): Promise<boolean> {
  try {
    const { data } = await supabase.from("pricing_config")
      .select("value").eq("key", "company_registry_block_unknown").maybeSingle();
    return Number(data?.value) === 1;
  } catch { return false; }
}

export async function cachedLookup(
  supabase: any,
  number: string,
  lookup: (n: string) => Promise<RegistryResult>,
): Promise<RegistryResult> {
  const days = await cacheDays(supabase);
  const freshAfter = new Date(Date.now() - days * 86400_000).toISOString();

  try {
    const { data: hit } = await supabase
      .from("company_registry_cache")
      .select("status, name, entity_status, registry_source, payload, checked_at")
      .eq("company_number", number)
      .gte("checked_at", freshAfter)
      .maybeSingle();
    if (hit) {
      return {
        status: hit.status, name: hit.name, entity_status: hit.entity_status,
        registry: hit.registry_source, reason: null, raw: hit.payload ?? null,
      };
    }
  } catch { /* מטמון שאינו זמין אינו סיבה לא לשאול */ }

  const result = await lookup(number);

  if (result.status !== "unverified") {
    try {
      await supabase.from("company_registry_cache").upsert({
        company_number: number,
        status: result.status,
        name: result.name,
        entity_status: result.entity_status,
        registry_source: result.registry,
        payload: result.raw,
        checked_at: new Date().toISOString(),
      }, { onConflict: "company_number" });
    } catch { /* כישלון כתיבה אינו משנה את התשובה */ }
  }

  return result;
}

/** השדות שנכתבים על שורת החברה. במקום אחד, כי שני מסלולי הרשמה כותבים אותם. */
export function registryColumns(r: RegistryResult) {
  return {
    registry_status: r.status,
    registry_name: r.name,
    registry_entity_status: r.entity_status,
    registry_source: r.registry,
    registry_checked_at: new Date().toISOString(),
  };
}
