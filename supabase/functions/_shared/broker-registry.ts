// ============================================================================
// אימות רישיון תיווך מול רשם המתווכים (data.gov.il)
//
// המקור הוא מערך הנתונים "מאגר מתווכים פעילים" של משרד המשפטים, וה-resource
// שבו יושבת רשימת המתווכים המורשים. אותו CKAN ואותה נקודת קצה שמשמשים את
// אימות הח״פ מול רשם החברות:
//
//   GET /api/3/action/datastore_search?resource_id=<id>&filters={"<שדה>":"<ערך>"}
//   → { success: true, result: { total, records: [...], fields: [...] } }
//
// ---------------------------------------------------------------------------
// ההבדל המהותי מ-company-registry.ts, וכל מה שנגזר ממנו
//
// שם אנחנו **יודעים** את שמות העמודות ("מספר חברה", "סטטוס חברה"). כאן לא:
// המאגר מתפרסם בגרסאות, ושם העמודה של מספר הרישיון אינו מובטח. ומכיוון
// שכאן התשובה **חוסמת** הרשמה — ולא רק מתעדת אותה כמו בצד של רשם החברות —
// שם עמודה שהשתנה היה חוסם כל מתווך/ת בארץ בבת אחת.
//
// לכן הבדיקה כאן בנויה בשלוש שכבות, מהחזקה לחלשה, וכל אחת נכנסת רק כשזו
// שלפניה לא הצליחה:
//
//   1. **שם עמודה מפורש** ממשתנה הסביבה BROKER_REGISTRY_NUMBER_FIELD.
//      כשהוא מוגדר הוא הסמכות, ואין ניחושים.
//   2. **גילוי עצמי.** שאילתת limit=1 מחזירה מ-CKAN את `result.fields` —
//      רשימת העמודות של המאגר כפי שהן **עכשיו**. מתוכה נבחרת העמודה
//      ששמה מכיל "רישיון"/"רשיון". עמודה שהמפרסם שינה את שמה נמצאת מחדש
//      מעצמה, בלי פריסה ובלי Secret.
//   3. **חיפוש חופשי** (q) עם אימות ספרות. רשת הביטחון האחרונה, למקרה
//      שגם הגילוי לא זיהה עמודה.
//
// ---------------------------------------------------------------------------
// ‏fail-open, תמיד. גם כשהתוצאה חוסמת.
//
// רק תשובה תקינה של CKAN (‏success:true) שהחזירה אפס רשומות נחשבת
// `not_found` — וזו התשובה היחידה שחוסמת. כל השאר — ‏CKAN שהחזיר שגיאה,
// timeout, מאגר שהוחלף, JSON פגום, data.gov.il שלא זמין — מחזיר
// `unverified`, וההרשמה ממשיכה. אתר ממשלתי שנפל אינו סיבה לסגור את
// ההרשמה לפלטפורמה.
//
// ההבחנה אפשרית כי CKAN מבדיל בעצמו: ‏resource_id שגוי או שם שדה שאינו
// קיים מחזירים `success:false` עם הודעת שגיאה, ולא רשימה ריקה.
// ---------------------------------------------------------------------------
//
// **המאגר מתעדכן אחת לשלושה חודשים.** מי שקיבל/ה רישיון החודש עשוי/ה שלא
// להופיע בו, ולכן `not_found` אינו "אין לך רישיון" אלא "לא מצאנו" — ומולו
// עומד מסלול הערעור (‏broker-license-appeal): צילום הרישיון עובר להנהלת
// הפלטפורמה, ואישור ידני פותח את המשרד. ראו docs/broker-registry.md.
// ============================================================================

const CKAN_BASE = Deno.env.get("BROKER_REGISTRY_BASE") ??
  "https://data.gov.il/api/3/action/datastore_search";

/** ה-resource של "רשימת מתווכים מורשים" במאגר metavhim של משרד המשפטים. */
const RESOURCE = Deno.env.get("BROKER_REGISTRY_RESOURCE_ID") ??
  "a0f56034-88db-4132-8803-854bcdb01ca1";

/** כמה שניות מחכים ל-data.gov.il לפני שמוותרים ועוברים ל-unverified. */
const TIMEOUT_MS = Number(Deno.env.get("BROKER_REGISTRY_TIMEOUT_MS") ?? 6000);

/** שם עמודת מספר הרישיון, כשהוא ידוע. ריק = גילוי עצמי (שכבה 2). */
const NUMBER_FIELD = (Deno.env.get("BROKER_REGISTRY_NUMBER_FIELD") ?? "").trim();
const NAME_FIELD = (Deno.env.get("BROKER_REGISTRY_NAME_FIELD") ?? "").trim();
const STATUS_FIELD = (Deno.env.get("BROKER_REGISTRY_STATUS_FIELD") ?? "").trim();

export type BrokerStatus = "verified" | "inactive" | "not_found" | "unverified";

export type BrokerResult = {
  status: BrokerStatus;
  /** השם הרשום במאגר — מה שמוצג כאישור שהמספר נכון, ומה שמוצלב מול השם שהוקלד. */
  name: string | null;
  /** סטטוס הרישיון כלשונו במאגר, כשיש עמודה כזו. */
  entity_status: string | null;
  /** למה לא אימתנו. מלא רק ב-unverified, ונרשם ביומן. */
  reason: string | null;
  raw: Record<string, unknown> | null;
};

const unverified = (reason: string): BrokerResult =>
  ({ status: "unverified", name: null, entity_status: null, reason, raw: null });

/** רק ספרות. מספרי רישיון מוקלדים עם רווחים, מקפים ולעיתים אפס מוביל. */
export const normalizeLicense = (raw: unknown): string =>
  String(raw ?? "").replace(/\D/g, "").replace(/^0+/, "");

/**
 * רישיון "לא בתוקף" לפי לשון המאגר.
 *
 * **נכון להיום זה קוד רדום, בכוונה.** למאגר יש שלוש עמודות בלבד — מספר
 * רישיון, שם ועיר — ואין בו עמודת סטטוס כלל. הוא *רשימת המתווכים הפעילים*,
 * ולכן עצם הנוכחות בו היא אישור התוקף, ו-`inactive` לעולם אינו נוצר בפועל.
 *
 * הקוד נשאר כי המפרסם עשוי להוסיף עמודה כזו בגרסה הבאה, ואז נרצה לכבד
 * אותה מיד. וכשהיא תתווסף — הבדיקה היא על מה ש**פוסל** ולא על מה שמאשר:
 * המאגר לא יחזיר דגל בוליאני אלא טקסט חופשי, וניסוח שטרם ראינו צריך
 * להיחשב תקין. ההפך היה חוסם מתווך/ת מורשה/ית בגלל מילה שהמפרסם הוסיף.
 */
const INACTIVE_HINTS = ["מבוטל", "בוטל", "פקע", "הותלה", "מושעה", "לא בתוקף", "לא פעיל", "נמחק"];

function isInactive(statusText: string | null): boolean {
  if (!statusText) return false;
  return INACTIVE_HINTS.some((hint) => statusText.trim().includes(hint));
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
    return {
      ok: false,
      reason: name === "AbortError" ? "timeout" : "network:" + String((err as Error)?.message ?? err).slice(0, 120),
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// שכבה 2 — גילוי שמות העמודות מהמאגר עצמו
//
// ‏CKAN מחזיר `result.fields` בכל תשובה, ולכן שאילתת limit=1 אחת מספיקה כדי
// לדעת איך נקראות העמודות **היום**. התוצאה נשמרת בזיכרון המודול: מופע חם של
// הפונקציה שואל פעם אחת, לא פעם לכל הרשמה.
// ---------------------------------------------------------------------------
type Discovered = { number: string | null; name: string | null; status: string | null };
let discovered: Discovered | null = null;

/** העמודה הראשונה ששמה מכיל אחד מהרמזים. הסדר בין הרמזים הוא סדר העדיפות. */
function pickField(ids: string[], hints: string[]): string | null {
  for (const hint of hints) {
    const hit = ids.find((id) => id.includes(hint));
    if (hit) return hit;
  }
  return null;
}

async function discoverFields(): Promise<Discovered | { error: string }> {
  if (discovered) return discovered;

  const attempt = await ckan(`${CKAN_BASE}?resource_id=${encodeURIComponent(RESOURCE)}&limit=1`);
  if (!attempt.ok) return { error: attempt.reason };

  const ids: string[] = (attempt.body?.result?.fields ?? [])
    .map((f: any) => String(f?.id ?? ""))
    .filter(Boolean);
  if (ids.length === 0) return { error: "no_fields" };

  // -------------------------------------------------------------------------
  // רשימות הרמזים, לפי סדר עדיפות.
  //
  // **הראשון בכל רשימה הוא השם שנצפה בפועל במאגר** (נבדק מול data.gov.il,
  // 13.9.2026): ‏`מס רשיון`, `שם המתווך`, ולצידם `עיר מגורים` שאיננו צריכים.
  // השאר הם רשתות ביטחון למקרה שהמפרסם ישנה את הכותרות.
  //
  // שימו לב לכתיב: העמודה היא **`רשיון` בלי יו״ד**. הרמז "רישיון" (עם יו״ד)
  // נשאר ברשימה כי הוא הכתיב התקני וסביר שגרסה עתידית תשתמש בו — אבל הוא
  // אינו תופס את השם הנוכחי, ומי שמוחק את "רשיון" מהרשימה שובר את הבדיקה
  // לכל מתווך/ת בארץ.
  //
  // "מספר" ו-"שם" לבדם הם רמזים חלשים (יש גם "מספר זהות", "שם משרד"), ולכן
  // הם אחרונים.
  // -------------------------------------------------------------------------
  discovered = {
    number: pickField(ids, ["מס רשיון", "רשיון", "רישיון", "רשיונ", "תעודה", "מספר"]),
    name: pickField(ids, ["שם המתווך", "שם מלא", "שם"]),
    status: pickField(ids, ["סטטוס", "מצב", "תוקף"]),
  };
  return discovered;
}

// ---------------------------------------------------------------------------
// בניית התוצאה מרשומה שנמצאה
// ---------------------------------------------------------------------------

/**
 * שם המתווך/ת מתוך הרשומה.
 *
 * חלק ממאגרי הרשם שומרים שם פרטי ושם משפחה בשתי עמודות נפרדות. אם העמודה
 * שנבחרה אינה עמודת "שם מלא", מחברים כאן כל עמודה ששמה מכיל "שם" — אחרת
 * ההצלבה מול השם שהוקלד הייתה נכשלת על חצי שם. במאגר הנוכחי יש עמודה אחת
 * (‏`שם המתווך`), ולכן הענף הזה רדום — הוא נועד לגרסה שתפצל אותה.
 *
 * **אזהרה למי שיוסיף/תוסיף הצלבת שם:** המאגר כותב שם משפחה תחילה
 * ("יצחק תומר"), ואצלנו ‏display_name הוא לרוב ההפך ("תומר יצחק").
 * השוואת מחרוזות ישירה תיכשל על רוב המתווכים. השם מוחזר כאן לתצוגה
 * ולאישור ויזואלי שהמספר נכון, ולא כמפתח השוואה.
 */
function recordName(record: Record<string, unknown>, field: string | null): string | null {
  if (NAME_FIELD && record[NAME_FIELD] != null) return String(record[NAME_FIELD]).trim() || null;

  const nameKeys = Object.keys(record).filter((k) => k.includes("שם"));
  if (nameKeys.length > 1) {
    const joined = nameKeys.map((k) => String(record[k] ?? "").trim()).filter(Boolean).join(" ").trim();
    if (joined) return joined;
  }
  if (field && record[field] != null) {
    const single = String(record[field]).trim();
    if (single) return single;
  }
  return null;
}

function recordStatus(record: Record<string, unknown>, field: string | null): string | null {
  const key = STATUS_FIELD || field;
  if (!key || record[key] == null) return null;
  return String(record[key]).trim() || null;
}

function fromRecord(record: Record<string, unknown>, fields: Discovered): BrokerResult {
  const entityStatus = recordStatus(record, fields.status);
  return {
    // נוכחות במאגר המתווכים הפעילים היא **עצמה** אישור התוקף: זו רשימת בעלי
    // תעודת הסמכה בתוקף. עמודת סטטוס, כשהיא קיימת, יכולה רק לפסול.
    status: isInactive(entityStatus) ? "inactive" : "verified",
    name: recordName(record, fields.name),
    entity_status: entityStatus,
    reason: null,
    raw: record,
  };
}

// ---------------------------------------------------------------------------
// שכבה 1+2 — שאילתה מסוננת על עמודת מספר הרישיון
// ---------------------------------------------------------------------------

/**
 * שתי צורות הכתיבה של אותו מספר.
 *
 * ‏normalizeLicense מסיר אפסים מובילים, אבל אין ערובה שהמאגר שומר אותו כך:
 * עמודת טקסט עשויה לשמר "0034521". שתי הצורות נבדקות, וכל התאמה נחשבת.
 */
function variants(license: string): string[] {
  const out = [license];
  for (const width of [5, 6, 7]) {
    if (license.length < width) out.push(license.padStart(width, "0"));
  }
  return out;
}

async function filteredLookup(field: string, license: string, fields: Discovered) {
  for (const value of variants(license)) {
    const filters = encodeURIComponent(JSON.stringify({ [field]: value }));
    const attempt = await ckan(
      `${CKAN_BASE}?resource_id=${encodeURIComponent(RESOURCE)}&limit=1&filters=${filters}`,
    );
    // שגיאת CKAN אינה "לא נמצא" — היא אומרת שהשאילתה עצמה פסולה (למשל שם
    // עמודה שהשתנה), ולכן היא מפילה ל-unverified במקום לחסום את הנרשם/ת.
    if (!attempt.ok) return unverified(attempt.reason);

    const record = attempt.body?.result?.records?.[0];
    if (record) return fromRecord(record, fields);
  }
  return null; // ‏CKAN ענה כשורה ולא מצא — "לא נמצא" אמיתי
}

// ---------------------------------------------------------------------------
// שכבה 3 — חיפוש חופשי, עם אימות ספרות
//
// ‏filters דורש שם עמודה מדויק; ‏q סורק את כל העמודות. הסכנה היא התאמת שווא:
// מספר רישיון בן ארבע ספרות יכול להיראות כמו שנה או כמו ציון בחינה בעמודה
// אחרת. לכן ההתאמה מאומתת פעמיים — הערך חייב להיות זהה בספרותיו למספר
// שחיפשנו, **וגם** לשבת בעמודה ששמה נראה כמו עמודת רישיון. בלי התנאי השני
// החיפוש הזה היה מאשר מספרים שאינם רישיונות כלל.
// ---------------------------------------------------------------------------
async function freeTextLookup(license: string, fields: Discovered) {
  const attempt = await ckan(
    `${CKAN_BASE}?resource_id=${encodeURIComponent(RESOURCE)}&limit=20&q=${encodeURIComponent(license)}`,
  );
  if (!attempt.ok) return unverified(attempt.reason);

  const records: Record<string, unknown>[] = attempt.body?.result?.records ?? [];
  const licenseish = (key: string) => key.includes("רישיון") || key.includes("רשיון") || key.includes("רשיונ");

  const match = records.find((r) =>
    Object.entries(r).some(([k, v]) => licenseish(k) && normalizeLicense(v) === license)
  );
  if (!match) return null;
  return fromRecord(match, fields);
}

// ---------------------------------------------------------------------------
// הבדיקה עצמה
// ---------------------------------------------------------------------------

/**
 * מאמת מספר רישיון תיווך מול רשם המתווכים.
 *
 * מחזיר `not_found` — התשובה היחידה שחוסמת — רק כש-CKAN ענה כשורה ולא מצא.
 * כל כשל בדרך מחזיר `unverified`, שאינו חוסם לעולם.
 */
export async function verifyBrokerLicense(rawLicense: string): Promise<BrokerResult> {
  const license = normalizeLicense(rawLicense);
  // מספר רישיון תיווך הוא בן 3–8 ספרות. קלט שאינו כזה אינו יוצא לרשת כלל:
  // הוא שגיאת הקלדה, לא רישיון שלא נמצא.
  if (!/^\d{3,8}$/.test(license)) {
    return { status: "not_found", name: null, entity_status: null, reason: "bad_format", raw: null };
  }

  if (!RESOURCE) return unverified("no_resource_configured");

  const fields = await discoverFields();
  if ("error" in fields) return unverified("discover:" + fields.error);

  const numberField = NUMBER_FIELD || fields.number;

  if (numberField) {
    const direct = await filteredLookup(numberField, license, fields);
    if (direct && direct.status !== "unverified") return direct;
    // שאילתה מסוננת שנכשלה אינה סוף הדרך: ייתכן ששם העמודה שנבחר אינו הנכון,
    // והחיפוש החופשי עדיין ימצא. נכשל גם הוא — מקבלים unverified משם.
    if (direct?.status === "unverified") {
      const loose = await freeTextLookup(license, fields);
      return loose ?? direct;
    }
  }

  const loose = await freeTextLookup(license, fields);
  if (loose) return loose;

  // הגענו לכאן רק אם CKAN ענה כשורה בכל הניסיונות ולא הייתה התאמה.
  return { status: "not_found", name: null, entity_status: null, reason: null, raw: null };
}

/** ההודעה שמוצגת למשתמש/ת. במקום אחד, כי חמישה מסכים מציגים אותה. */
export function brokerMessage(r: BrokerResult): string {
  switch (r.status) {
    case "verified":
      return r.name ? `נמצא ברשם המתווכים: ${r.name}` : "מספר הרישיון אומת מול רשם המתווכים";
    case "inactive":
      return `הרישיון רשום אצל רשם המתווכים אך סטטוסו "${r.entity_status}". ` +
        "אפשר לשלוח צילום של רישיון בתוקף לבדיקת הנהלת הפלטפורמה.";
    case "not_found":
      return "מספר הרישיון לא נמצא ברשם המתווכים. " +
        "המאגר הממשלתי מתעדכן אחת לשלושה חודשים, ולכן רישיון חדש עדיין לא מופיע בו — " +
        "אפשר לשלוח צילום של רישיון בתוקף, והנהלת הפלטפורמה תאשר את הפתיחה ידנית.";
    default:
      return "לא הצלחנו לאמת מול רשם המתווכים כרגע. ההרשמה ממשיכה, והאימות ייבדק שוב מאוחר יותר.";
  }
}
