// ============================================================================
// אימות ח״פ מול רשם החברות (data.gov.il)
//
// ‏data.gov.il הוא CKAN, וה-datastore שלו נשאל דרך נקודת קצה סטנדרטית אחת:
//
//   GET /api/3/action/datastore_search?resource_id=<id>&filters={"<שדה>":"<ערך>"}
//   → { success: true, result: { total, records: [...], fields: [...] } }
//
// ---------------------------------------------------------------------------
// שתי החלטות שמסבירות כמעט כל שורה כאן, ושתיהן נובעות מאותה עובדה:
// **הכשל הצפוי כאן אינו "החברה לא קיימת" אלא "שאלנו לא נכון".**
//
// מזהה ה-resource ושמות השדות בעברית הם פרטים של מערך הנתונים ולא של CKAN,
// והם משתנים כשהמפרסם מעלה גרסה חדשה. מזהה שגוי או שם שדה שהשתנה מחזירים
// אפס תוצאות לכל חברה בעולם — כלומר חוסמים כל הרשמה לגיטימית באתר.
//
//   1. **כל מה שספציפי לדאטהסט הוא הגדרה, לא קבוע.** ‏resource_id ושמות
//      השדות מגיעים ממשתני סביבה, עם ברירות מחדל בקוד. תיקון אינו דורש
//      פריסה מחדש — רק Secret ב-Supabase.
//
//   2. **‏fail-open, אף פעם לא fail-closed.** רק תשובה תקינה של CKAN
//      (‏success:true) שהחזירה אפס רשומות נחשבת "לא נמצא". כל השאר —
//      ‏CKAN שהחזיר שגיאה, timeout, שדה לא מוכר, JSON פגום, האתר למטה —
//      מחזיר `unverified`, וההרשמה ממשיכה. רשם החברות שנפל אינו סיבה
//      לסגור את ההרשמה לאתר.
//
// ההבחנה הזו אפשרית בדיוק כי CKAN מבדיל בעצמו: ‏resource_id שגוי או שם
// שדה שאינו קיים מחזירים `success:false` עם הודעת שגיאה, ולא רשימה ריקה.
// ---------------------------------------------------------------------------

const CKAN_BASE = Deno.env.get("COMPANY_REGISTRY_BASE") ??
  "https://data.gov.il/api/3/action/datastore_search";

/** כמה שניות מחכים ל-data.gov.il לפני שמוותרים ועוברים ל-unverified. */
const TIMEOUT_MS = Number(Deno.env.get("COMPANY_REGISTRY_TIMEOUT_MS") ?? 6000);

/**
 * המרשמים שנבדקים, לפי הסדר.
 *
 * ‏resource — מזהה ה-resource ב-CKAN.
 * ‏numberField / nameField / statusField — שמות העמודות **באותו** מערך נתונים.
 *
 * ברירות המחדל הן המזהים המוכרים של מערכי הנתונים של רשות התאגידים. הן
 * נכונות לרגע הכתיבה ואינן מובטחות: מערך נתונים שהוחלף מקבל מזהה חדש.
 * לכן כל ערך כאן ניתן לדריסה במשתנה סביבה, ולכן כשל מחזיר unverified.
 */
type Registry = {
  key: string;
  label: string;
  resource: string;
  numberField: string;
  nameField: string;
  statusField: string;
};

export const REGISTRIES: Registry[] = [
  {
    key: "companies",
    label: "רשם החברות",
    resource: Deno.env.get("COMPANY_REGISTRY_RESOURCE_ID") ?? "f004176c-b85f-4542-8901-7b3176f9a054",
    numberField: Deno.env.get("COMPANY_REGISTRY_NUMBER_FIELD") ?? "מספר חברה",
    nameField: Deno.env.get("COMPANY_REGISTRY_NAME_FIELD") ?? "שם חברה",
    statusField: Deno.env.get("COMPANY_REGISTRY_STATUS_FIELD") ?? "סטטוס חברה",
  },
  {
    key: "amutot",
    label: "רשם העמותות",
    resource: Deno.env.get("AMUTOT_REGISTRY_RESOURCE_ID") ?? "be5b7935-3922-45d4-9638-08871b17ec95",
    numberField: Deno.env.get("AMUTOT_REGISTRY_NUMBER_FIELD") ?? "מספר עמותה",
    nameField: Deno.env.get("AMUTOT_REGISTRY_NAME_FIELD") ?? "שם עמותה",
    statusField: Deno.env.get("AMUTOT_REGISTRY_STATUS_FIELD") ?? "סטטוס עמותה",
  },
];

export type RegistryStatus = "verified" | "inactive" | "not_found" | "unverified";

export type RegistryResult = {
  status: RegistryStatus;
  /** השם הרשום במרשם — מה שמוצג למשתמש/ת כאישור שהמספר נכון. */
  name: string | null;
  /** סטטוס התאגיד כלשונו במרשם ("פעילה", "מחוסלת", "בפירוק"…). */
  entity_status: string | null;
  registry: string | null;
  /** למה לא אימתנו. מלא רק ב-unverified, ונרשם ביומן. */
  reason: string | null;
  raw: Record<string, unknown> | null;
};

const unverified = (reason: string): RegistryResult =>
  ({ status: "unverified", name: null, entity_status: null, registry: null, reason, raw: null });

/**
 * תאגיד "פעיל" לפי לשון המרשם.
 *
 * המרשם אינו מחזיר דגל בוליאני אלא טקסט חופשי בעברית, והניסוחים משתנים בין
 * מערכי הנתונים. הבדיקה היא לכן על מה ש**פוסל** ולא על מה שמאשר: חברה
 * מחוסלת, בפירוק, מחוקה או ללא סטטוס ידוע לא תשווק פרויקטים חדשים, וכל
 * ניסוח אחר (כולל כזה שטרם ראינו) נחשב פעיל. ההפך היה חוסם חברה תקינה
 * בגלל מילה חדשה.
 */
const INACTIVE_HINTS = ["מחוסל", "מחוק", "פירוק", "חיסול", "לא פעיל", "בוטל"];

function isInactive(statusText: string | null): boolean {
  if (!statusText) return false;
  const t = statusText.trim();
  return INACTIVE_HINTS.some((hint) => t.includes(hint));
}

async function ckan(url: string): Promise<{ ok: true; body: any } | { ok: false; reason: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    const body = await res.json();
    // ‏CKAN מסמן שגיאת שאילתה (resource_id שגוי, שדה לא מוכר) ב-success:false,
    // ולא ברשימה ריקה. זו בדיוק ההבחנה שמפרידה "לא נמצא" מ"שאלנו לא נכון".
    if (!body || body.success !== true) {
      return { ok: false, reason: "ckan_error:" + String(body?.error?.message ?? "unknown").slice(0, 120) };
    }
    return { ok: true, body };
  } catch (err) {
    const name = (err as Error)?.name;
    return { ok: false, reason: name === "AbortError" ? "timeout" : "network:" + String((err as Error)?.message ?? err).slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * שתי צורות הכתיבה של אותו מספר.
 *
 * ‏developers.company_number מנורמל לתשע ספרות עם אפס מוביל, אבל אין ערובה
 * שמערך הנתונים שומר אותו כך — מספר שיושב שם כמספר שלם מאבד את האפס. שתי
 * הצורות נבדקות, וכל התאמה נחשבת.
 */
function variants(companyNumber: string): string[] {
  const out = [companyNumber];
  const stripped = companyNumber.replace(/^0+/, "");
  if (stripped && stripped !== companyNumber) out.push(stripped);
  return out;
}

async function lookupIn(reg: Registry, companyNumber: string): Promise<RegistryResult | null> {
  for (const value of variants(companyNumber)) {
    const filters = encodeURIComponent(JSON.stringify({ [reg.numberField]: value }));
    const attempt = await ckan(`${CKAN_BASE}?resource_id=${encodeURIComponent(reg.resource)}&limit=1&filters=${filters}`);

    // שגיאת CKAN אינה "לא נמצא" — היא אומרת שהשאילתה עצמה פסולה, ולכן
    // מפילה את כל הבדיקה ל-unverified במקום לפסול את החברה.
    if (!attempt.ok) return unverified(`${reg.key}:${attempt.reason}`);

    const record = attempt.body?.result?.records?.[0];
    if (record) {
      const name = record[reg.nameField] ?? null;
      const entityStatus = record[reg.statusField] ?? null;
      return {
        status: isInactive(entityStatus) ? "inactive" : "verified",
        name: name ? String(name).trim() : null,
        entity_status: entityStatus ? String(entityStatus).trim() : null,
        registry: reg.label,
        reason: null,
        raw: record,
      };
    }
  }
  return null; // ‏CKAN ענה כשורה ולא מצא — "לא נמצא" אמיתי במרשם הזה
}

/**
 * חיפוש חופשי כרשת ביטחון.
 *
 * ‏filters דורש התאמה מדויקת בשדה מסוים; ‏q סורק את כל השדות. אם המספר
 * שמור במערך הנתונים בפורמט שלא צפינו (רווחים, מקף, עמודה אחרת), החיפוש
 * המסונן יחזיר אפס והחיפוש הזה עדיין ימצא. בלעדיו כל שינוי פורמט אצל
 * המפרסם היה נראה כמו "החברה לא קיימת".
 */
async function freeTextFallback(reg: Registry, companyNumber: string): Promise<RegistryResult | null> {
  const attempt = await ckan(
    `${CKAN_BASE}?resource_id=${encodeURIComponent(reg.resource)}&limit=5&q=${encodeURIComponent(companyNumber)}`,
  );
  if (!attempt.ok) return unverified(`${reg.key}:${attempt.reason}`);

  const records: Record<string, unknown>[] = attempt.body?.result?.records ?? [];
  const digits = companyNumber.replace(/^0+/, "");
  const match = records.find((r) =>
    Object.values(r).some((v) => String(v ?? "").replace(/\D/g, "").replace(/^0+/, "") === digits)
  );
  if (!match) return null;

  const entityStatus = match[reg.statusField] == null ? null : String(match[reg.statusField]).trim();
  return {
    status: isInactive(entityStatus) ? "inactive" : "verified",
    name: match[reg.nameField] ? String(match[reg.nameField]).trim() : null,
    entity_status: entityStatus,
    registry: reg.label,
    reason: null,
    raw: match,
  };
}

/**
 * מאמת מספר תאגיד מול המרשמים.
 *
 * מחזיר `not_found` רק כששני המרשמים ענו כשורה ולא מצאו. די בכשל אחד כדי
 * להחזיר `unverified` — עדיף לא לדעת מאשר לפסול חברה אמיתית.
 */
export async function verifyCompanyNumber(companyNumber: string): Promise<RegistryResult> {
  if (!/^\d{9}$/.test(companyNumber)) {
    return { status: "not_found", name: null, entity_status: null, registry: null, reason: "bad_format", raw: null };
  }

  let sawFailure: string | null = null;

  for (const reg of REGISTRIES) {
    if (!reg.resource) continue;
    const direct = await lookupIn(reg, companyNumber);
    if (direct && direct.status !== "unverified") return direct;
    if (direct?.status === "unverified") { sawFailure ??= direct.reason; continue; }

    const loose = await freeTextFallback(reg, companyNumber);
    if (loose && loose.status !== "unverified") return loose;
    if (loose?.status === "unverified") sawFailure ??= loose.reason;
  }

  return sawFailure ? unverified(sawFailure)
    : { status: "not_found", name: null, entity_status: null, registry: null, reason: null, raw: null };
}

/** ההודעה שמוצגת למשתמש/ת. במקום אחד, כי שלושה מסכים מציגים אותה. */
export function registryMessage(r: RegistryResult): string {
  switch (r.status) {
    case "verified":
      return r.name ? `נמצא ב${r.registry}: ${r.name}` : `המספר אומת מול ${r.registry}`;
    case "inactive":
      return `התאגיד רשום ב${r.registry} אך סטטוסו "${r.entity_status}". אי אפשר לשווק פרויקטים בשם תאגיד שאינו פעיל.`;
    case "not_found":
      return "המספר לא נמצא ברשם החברות ולא ברשם העמותות. יש להזין מספר תאגיד רשום.";
    default:
      return "לא הצלחנו לאמת מול רשם החברות כרגע. ההרשמה תמשיך, והאימות ייבדק שוב מאוחר יותר.";
  }
}
