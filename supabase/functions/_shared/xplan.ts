// ============================================================================
// ייעוד ותוכניות מ-XPlan של מינהל התכנון, לכל הארץ, בשרת - בלי GovMap
//
// ## למה דרך ממסר
//
// ‏XPlan (‏ags.iplan.gov.il) מציע רק צפנים ישנים. ‏Deno - כלומר כל Edge
// Function - נכשל שם ב-HandshakeFailure, ואין לו הגדרה שמשנה את זה (נבדק
// ב-scripts/iplan_probe.py, ‏22.10.2026). ‏Node כן: ‏netlify/functions/xplan.mjs
// שואל את XPlan עם SECLEVEL=1 **ועם אימות תעודה**, ומחזיר את התשובה בדיוק
// בצורה של שכבות 203/14 של GovMap - אלה אותן שכבות, באותם שדות.
//
// ## אותו ניקוי כמו באתר
//
// ‏`cleanPlanLayers` כאן היא העתק של זו שב-assets/govmap.js, ו-
// scripts/plan_layers_test.ts מריץ את שתיהן על אותן תשובות ומשווה. שדה חדש
// מהשכבות נכנס לשתיהן באותו PR (הסקיל govmap).
//
// ## החוזה
//
//   Plan[]  - XPlan ענה. ‏[] = אין תוכניות בנקודה.
//   null    - לא שאלנו או לא הצלחנו: אין ממסר מוגדר, אין סוד, תקלה, זמן.
//
// זו העשרה, ולכן היא לעולם לא זורקת: מי שקורא נופל לקישור לכלי ב-CRM.
// ============================================================================

export interface XplanPlan {
  number: string;
  name: string | null;
  kind: string | null;
  stage: "notice" | "approved" | "deposited" | null;
  date: string | null;
  permits: boolean | null;
  notice: boolean;
  url: string | null;
  designation: string | null;
}

type Feature = { attributes?: Record<string, unknown> };
type Layers = { "203"?: Feature[]; "14"?: Feature[] };

// "ייעוד עפ"י תכנית מאושרת אחרת" ו"גבול הודעה" אינם ייעוד - הם אומרים "לא כאן"
const MAVAT_NOT_A_DESIGNATION = new Set([994, 995]);
const MAVAT_URL_RE = /^https:\/\/mavat\.iplan\.gov\.il\/[A-Za-z0-9\/]+$/;

function planKey(n: unknown): string {
  return String(n || "").replace(/\s+/g, "");
}

function dateOnly(v: unknown): string | null {
  const s = v == null ? "" : String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

/** תשובת השכבות 203 ו-14 -> רשימת תוכניות. העתק של cleanPlanLayers ב-assets/govmap.js. */
export function cleanPlanLayers(layers: Layers | null | undefined): XplanPlan[] {
  const byKey: Record<string, XplanPlan> = {};
  const out: XplanPlan[] = [];
  for (const f of (layers && layers["203"]) || []) {
    const a = (f && f.attributes) || {};
    const number = String(a.pl_number || "").replace(/\s+/g, " ").trim();
    if (!number || byKey[planKey(number)]) continue;
    const kind = String(a.entity_subtype_desc || "").trim();
    const notice = /סעיף\s*-?\s*77/.test(kind + " " + number);
    const chr = String(a.plan_charactor_name || "");
    const approved = dateOnly(a.pl_date_8);
    const p: XplanPlan = {
      number,
      name: String(a.pl_name || "").trim() || null,
      kind: notice ? "הודעה על הכנת תוכנית (סעיף 77-78)" : (kind || null),
      // ‏pl_date_8 בהודעה הוא תאריך פרסום ההודעה, לא אישור תוכנית
      stage: notice ? "notice" : approved ? "approved" : dateOnly(a.depositing_date) ? "deposited" : null,
      date: approved || dateOnly(a.depositing_date),
      // ‏"שמכוחה ניתן להוציא היתרים" מול "לא ניתן" - שני הנוסחים כוללים "ניתן"
      permits: /לא ניתן/.test(chr) ? false : /ניתן/.test(chr) ? true : null,
      notice,
      url: MAVAT_URL_RE.test(String(a.pl_url || "")) ? String(a.pl_url) : null,
      designation: null,
    };
    byKey[planKey(number)] = p;
    out.push(p);
  }
  for (const f of (layers && layers["14"]) || []) {
    const a = (f && f.attributes) || {};
    const p = byKey[planKey(a.pl_number)];
    const name = String(a.mavat_name || "").trim();
    if (p && name && !p.designation && !MAVAT_NOT_A_DESIGNATION.has(Number(a.mavat_code))) p.designation = name;
  }
  return out;
}

// מפורטת לפני מתאר מקומית, לפני כוללנית, לפני ארצית/מחוזית: הייעוד של התוכנית
// הקרובה ביותר לקרקע הוא זה שקובע מה מותר בה.
const KIND_RANK: Array<[RegExp, number]> = [
  [/מפורטת/, 0],
  [/מתאר מקומית/, 1],
  [/כוללנית/, 2],
  [/מחוזית/, 3],
  [/ארצית|תשתית לאומית/, 4],
];

function kindRank(kind: string | null): number {
  for (const [re, rank] of KIND_RANK) if (re.test(kind || "")) return rank;
  return 5;
}

/** הייעוד שמציגים: של התוכנית המאושרת הספציפית ביותר שיש לה ייעוד. ‏null = אין. */
export function primaryDesignation(plans: XplanPlan[]): string | null {
  const withDesignation = plans.filter((p) => p.designation && !p.notice);
  if (!withDesignation.length) return null;
  const approvedFirst = (p: XplanPlan) => (p.stage === "approved" ? 0 : 1);
  withDesignation.sort((a, b) => approvedFirst(a) - approvedFirst(b) || kindRank(a.kind) - kindRank(b.kind));
  return withDesignation[0].designation;
}

/** התוכניות החלות על הנקודה. ‏null = לא שאלנו או לא הצלחנו (ראו החוזה למעלה). */
export async function xplanPlansAt(lat: number, lng: number): Promise<XplanPlan[] | null> {
  const base = (Deno.env.get("SITE_BASE_URL") || "").replace(/\/$/, "");
  const token = Deno.env.get("XPLAN_RELAY_TOKEN") || "";
  if (!base || !token || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  try {
    const url = `${base}/.netlify/functions/xplan?lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}`;
    const res = await fetch(url, {
      headers: { "x-relay-token": token, accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      console.warn("xplan relay:", res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const body = await res.json() as { layers?: Layers };
    return cleanPlanLayers(body.layers);
  } catch (err) {
    console.warn("xplan relay failed", err);
    return null;
  }
}
