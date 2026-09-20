// ============================================================================
// השער — הבדיקה שארבעת מסלולי הכניסה חולקים
//
// ‏broker-registry.ts יודע לשאול את רשם המתווכים. הקובץ הזה הוא מה שנעשה עם
// התשובה: מטמון, עקיפה ידנית, מדיניות חסימה, התראה להנהלה, ותיעוד על השורה.
// הוא נקרא מ-agency-signup, create-own-agency, add-team-member ו-join-agency,
// וקיים כדי שארבעתם לא יתפצלו בהתנהגות.
//
// ---------------------------------------------------------------------------
// שלוש החלטות
//
//   1. **הבדיקה חד-פעמית, בכניסה בלבד.** היא רצה ברגע שנוצר הקשר בין אדם
//      לכרטיס סוכן/ת, והתוצאה נכתבת על השורה (‏license_status,
//      ‏license_checked_at). אין בדיקה חוזרת, אין cron, ואין רגע שבו סוכן/ת
//      ותיק/ה מגלה/ת בוקר אחד שהמאגר עודכן והחשבון ננעל.
//
//   2. **`not_found` חוסם; `unverified` לעולם לא.** ראו broker-registry.ts —
//      ‏CKAN מבדיל בעצמו בין "ענינו ולא מצאנו" לבין "השאילתה נכשלה", ורק
//      הראשון הוא עובדה על הרישיון. השני הוא עובדה על הרשת.
//
//   3. **אישור ידני גובר על המאגר.** שורת ערעור מאושרת ב-
//      ‏broker_license_appeals היא התשובה הסופית, ואפילו לא שואלים את
//      ‏data.gov.il. זה מה שמאפשר למי שקיבל/ה רישיון החודש להיכנס לפני
//      שהמאגר הרבעוני מתעדכן.
// ---------------------------------------------------------------------------

import { sendPlatformEmail, PLATFORM_CONTACT_EMAIL } from "./platform-mail-client.ts";
import {
  brokerMessage, normalizeLicense, verifyBrokerLicense,
  type BrokerResult, type BrokerStatus,
} from "./broker-registry.ts";

const DEFAULT_CACHE_DAYS = 30;

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function configNumber(supabase: any, key: string, fallback: number): Promise<number> {
  try {
    const { data } = await supabase.from("pricing_config").select("value").eq("key", key).maybeSingle();
    const n = Number(data?.value);
    return Number.isFinite(n) ? n : fallback;
  } catch { return fallback; }
}

/** האם השער פעיל בכלל. מתג כיבוי מהיר בלי פריסה מחדש. */
export async function brokerGateEnabled(supabase: any): Promise<boolean> {
  return (await configNumber(supabase, "broker_registry_enabled", 1)) === 1;
}

/**
 * האם `not_found` חוסם.
 *
 * ברירת המחדל כאן היא 1 — חוסם — וזה ההבדל מהשער של רשם החברות, ששם
 * ברירת המחדל היא 0. ההבדל מכוון: שם מאמתים תאגיד שמשווק פרויקטים, וכאן
 * מאמתים את הרישיון שבלעדיו אסור לעסוק בתיווך כלל.
 */
async function blocksNotFound(supabase: any): Promise<boolean> {
  return (await configNumber(supabase, "broker_registry_block_unknown", 1)) === 1;
}

// ---------------------------------------------------------------------------
// מטמון
//
// אותו מספר רישיון נשאל פעמיים במסלול הרשמה אחד — בהקלדה (חיווי חי) ובשליחת
// הטופס — ובלי מטמון כל הקלדה יוצאת ל-data.gov.il.
//
// ‏unverified אינו נשמר: הוא אומר "לא הצלחנו לשאול", ואין טעם לזכור כישלון
// רשת. כישלון של המטמון עצמו אינו מפיל את הבדיקה — הוא אופטימיזציה, לא תלות.
// ---------------------------------------------------------------------------
export async function cachedBrokerLookup(supabase: any, license: string): Promise<BrokerResult> {
  const days = await configNumber(supabase, "broker_registry_cache_days", DEFAULT_CACHE_DAYS);
  const freshAfter = new Date(Date.now() - Math.max(days, 1) * 86400_000).toISOString();

  try {
    const { data: hit } = await supabase
      .from("broker_registry_cache")
      .select("status, registry_name, entity_status, payload")
      .eq("license_number", license)
      .gte("checked_at", freshAfter)
      .maybeSingle();
    if (hit) {
      return {
        status: hit.status as BrokerStatus,
        name: hit.registry_name,
        entity_status: hit.entity_status,
        reason: null,
        raw: hit.payload ?? null,
      };
    }
  } catch { /* מטמון שאינו זמין אינו סיבה לא לשאול */ }

  const result = await verifyBrokerLicense(license);

  if (result.status !== "unverified") {
    try {
      await supabase.from("broker_registry_cache").upsert({
        license_number: license,
        status: result.status,
        registry_name: result.name,
        entity_status: result.entity_status,
        payload: result.raw,
        checked_at: new Date().toISOString(),
      }, { onConflict: "license_number" });
    } catch { /* כישלון כתיבה אינו משנה את התשובה */ }
  }

  return result;
}

/** האם יש ערעור מאושר על מספר הרישיון הזה. התשובה הסופית, לפני כל שאלה חיצונית. */
export async function manuallyApproved(supabase: any, license: string) {
  try {
    const { data } = await supabase
      .from("broker_license_appeals")
      .select("id, applicant_name, decided_at")
      .eq("license_number", license)
      .eq("status", "approved")
      .order("decided_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data ?? null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// השער
// ---------------------------------------------------------------------------

export type GateDecision = {
  /** האם ההרשמה ממשיכה. */
  allowed: boolean;
  /** מה נכתב על שורת agency_members. */
  columns: Record<string, unknown>;
  /** מה מוצג למשתמש/ת. */
  message: string;
  status: BrokerStatus | "manual";
  /** השם שבמאגר — הדפדפן מציג אותו כאישור שהמספר נכון. */
  registry_name: string | null;
  /** האם להציע את מסלול הערעור. רק כשהחסימה נובעת מהמאגר. */
  appealable: boolean;
};

const columnsFor = (status: string, name: string | null, entityStatus: string | null) => ({
  license_status: status,
  license_registry_name: name,
  license_entity_status: entityStatus,
  license_checked_at: new Date().toISOString(),
});

/**
 * הבדיקה המלאה עבור מספר רישיון אחד.
 *
 * ‏context מתאר מאיפה הגיעה הבקשה, ונכנס להתראה להנהלה בלבד.
 */
export async function checkBrokerLicense(
  supabase: any,
  rawLicense: string,
  context: { who?: string; email?: string; source: string },
): Promise<GateDecision> {
  const license = normalizeLicense(rawLicense);

  // ------------------------------------------------------------------
  // 1. השער כבוי — לא שואלים, לא חוסמים, ומסמנים שלא נבדק.
  // ------------------------------------------------------------------
  if (!(await brokerGateEnabled(supabase))) {
    return {
      allowed: true,
      columns: columnsFor("unverified", null, null),
      message: "",
      status: "unverified",
      registry_name: null,
      appealable: false,
    };
  }

  // ------------------------------------------------------------------
  // 2. אישור ידני — התשובה הסופית, בלי לצאת לרשת.
  // ------------------------------------------------------------------
  const approved = await manuallyApproved(supabase, license);
  if (approved) {
    return {
      allowed: true,
      columns: {
        ...columnsFor("manual", approved.applicant_name ?? null, null),
        license_approved_at: approved.decided_at ?? new Date().toISOString(),
      },
      message: "הרישיון אושר ידנית על ידי הנהלת הפלטפורמה.",
      status: "manual",
      registry_name: approved.applicant_name ?? null,
      appealable: false,
    };
  }

  // ------------------------------------------------------------------
  // 3. המאגר.
  // ------------------------------------------------------------------
  const result = await cachedBrokerLookup(supabase, license);
  const columns = columnsFor(result.status, result.name, result.entity_status);
  const message = brokerMessage(result);

  const blocking = result.status === "inactive" ||
    (result.status === "not_found" && await blocksNotFound(supabase));

  if (blocking) {
    // ההתראה היא חלק מהדרישה, ולכן היא נשלחת כאן — בנקודה שבה כל ארבעת
    // המסלולים עוברים — ולא בכל פונקציה בנפרד. כישלון שליחה אינו משנה את
    // ההחלטה: החסימה כבר נקבעה.
    await alertPlatform(license, result, context);
  }

  return {
    allowed: !blocking,
    columns,
    message,
    status: result.status,
    registry_name: result.name,
    appealable: blocking,
  };
}

/** התראה להנהלת הפלטפורמה על הרשמה שנחסמה. */
async function alertPlatform(
  license: string,
  result: BrokerResult,
  context: { who?: string; email?: string; source: string },
) {
  const who = `${context.who || "ללא שם"} (${context.email || "ללא אימייל"})`;
  const why = result.status === "inactive"
    ? `רשום ברשם המתווכים אך סטטוסו "${result.entity_status}"`
    : "לא נמצא ברשם המתווכים";

  await sendPlatformEmail({
    to: [PLATFORM_CONTACT_EMAIL],
    subject: `הרשמה נחסמה - רישיון תיווך ${license} ${result.status === "inactive" ? "אינו בתוקף" : "לא נמצא"}`,
    html: `<div dir="rtl" style="font-family:system-ui,Arial,sans-serif;font-size:15px;line-height:1.7">
      <p><b>${esc(who)}</b> ניסה/תה להיכנס למערכת עם מספר רישיון <b>${esc(license)}</b>, וההרשמה נחסמה.</p>
      <p>הסיבה: ${esc(why)}.</p>
      <p>מסלול: <code>${esc(context.source)}</code></p>
      <p>אם יישלח צילום רישיון, הבקשה תופיע בלוח הבקרה תחת <b>ערעורי רישיון</b>,
         ואישור שלך שם יפתח את המשרד.</p>
      <p style="color:#666;font-size:13px">המאגר הממשלתי מתעדכן אחת לשלושה חודשים -
         רישיון שהונפק לאחרונה עשוי שלא להופיע בו עדיין.</p>
    </div>`,
    text: `${who} נחסם/ה בכניסה. רישיון ${license}: ${why}. מסלול: ${context.source}.`,
  });
}

/** גוף התשובה שהדפדפן מקבל כשההרשמה נחסמה. אחיד בכל ארבעת המסלולים. */
export function blockedResponse(decision: GateDecision, license: string) {
  return {
    error: "license_not_verified",
    license_status: decision.status,
    license_number: normalizeLicense(license),
    appealable: decision.appealable,
    detail: decision.message,
  };
}
