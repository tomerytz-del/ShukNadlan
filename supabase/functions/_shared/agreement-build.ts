// ---------------------------------------------------------------------------
// הרכבת הסכם תיווך בשרת
//
// עד כאן הסכם נולד רק בדפדפן: אשף "החתם לקוח" ב-`crm.html` אוסף את הפרטים,
// ‏`AgreementDoc.buildHtml` מרכיב את המסמך, וה-HTML נשמר ונחסם במסד
// (`agreements_freeze_body`). הקובץ הזה מאפשר לעשות את אותו הדבר בדיוק
// מהעוזר בוואטסאפ — **עם אותו נוסח ואותו קוד**, ולא עם עותק שני.
//
// ## למה יש עותק של שני הקבצים ב-_shared
//
// ‏`supabase functions deploy` בונה את הבאנדל מתוך `supabase/functions`
// בלבד; ייבוא מ-`assets/` פשוט אינו נפתר. לכן יושב שם עותק **זהה
// בייט-בייט**, ו-`scripts/check_agreement_assets.py` חוסם ב-CI כל PR
// שמשאיר פער. הפער הזה הוא מסוג התקלות שאינן נראות: הדף ייראה תקין,
// המסמך ייבנה, הלקוח/ה יחתום/תחתום — ורק כשתוגש תביעת דמי תיווך יתגלה
// שהסעיף שנחתם אינו הסעיף שבתיק.
//
// שני הקבצים נכתבו מלכתחילה בלי שום תלות ב-DOM ועם נפילה ל-`globalThis`
// כשאין `window`, ולכן הם נטענים כאן כמו שהם. ‏`signaturePad` ו-`downloadPdf`
// שבתוכם כן נוגעים ב-DOM — אבל רק בגוף הפונקציה, ואנחנו לא קוראים להן.
//
// ## מה **לא** עובר לשרת
//
// ‏`document_html` נכתב פעם אחת ביצירה ונחסם. תיקון הסכם, ביטול והחתמה
// ידנית נשארים באשף בדשבורד: שם יש תצוגה מקדימה מלאה של מה שהלקוח/ה
// יראה/תראה, וזה בדיוק מה שאי אפשר להראות בהודעת וואטסאפ.
// ---------------------------------------------------------------------------
import "./agreement-templates.js";
import "./agreement-doc.js";

// deno-lint-ignore no-explicit-any
const g = globalThis as any;
// deno-lint-ignore no-explicit-any
const Templates: any = g.AgreementTemplates;
// deno-lint-ignore no-explicit-any
const Doc: any = g.AgreementDoc;

if (!Templates || !Doc) {
  throw new Error("agreement modules failed to load (AgreementTemplates/AgreementDoc)");
}

/** מצב הנכס — התוויות שמודפסות במסמך. מקביל ל-AGR_CONDITION_LABELS ב-crm.html. */
const CONDITION_LABELS: Record<string, string> = {
  new_from_contractor: "חדש מקבלן",
  new: "חדש",
  renovated: "משופץ",
  maintained: "שמור",
  needs_renovation: "דרוש שיפוץ",
};

export interface AgreementProperty {
  property_id: string | null;
  label: string;
  row: Record<string, unknown>;
  planning?: Record<string, unknown> | null;
}

export interface AgreementSigner {
  party: "client" | "partner" | "agent";
  full_name: string;
  id_number?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  client_id?: string | null;
}

export interface AgreementAgentCard {
  name: string | null;
  id_number: string | null;
  license_number: string | null;
  phone: string | null;
  agency_name: string | null;
  agency_address: string | null;
}

export interface BuildInput {
  kind: string;
  agentId: string;
  agencyId: string | null;
  agent: AgreementAgentCard;
  signers: AgreementSigner[];
  properties: AgreementProperty[];
  commission: { pct?: number | null; amount?: number | null; basis?: string | null };
  exclusive?: { from?: string | null; until?: string | null } | null;
  notes?: string | null;
  language?: string;
}

export function templateFor(kind: string) {
  return Templates.get(kind);
}

export function templateKeys(): string[] {
  return Templates.keys();
}

/**
 * שדה במסמך מתוך שורת הנכס. מקביל אחד לאחד ל-`agrFieldFromProperty`
 * ב-`crm.html`: אותם מקורות מיוחדים (‏feature:*, ‏gush/helka מהמידע התכנוני,
 * ‏neighborhood מ-sales_area, ‏condition מהתוויות) ואותה החזרת מחרוזת ריקה
 * כשאין ערך — שדה ריק במסמך הוא קו למילוי ידני, ולא שגיאה.
 */
function fieldFromProperty(
  field: { key: string; src?: string },
  p: Record<string, unknown>,
  planning: Record<string, unknown> | null | undefined,
): string {
  const src = field.src;
  if (!src) return "";
  if (src.indexOf("feature:") === 0) {
    const key = src.slice(8);
    const features = (p.features as string[] | null) || [];
    return features.includes(key) ? "יש" : "";
  }
  if (src === "gush") return String((planning && planning.gush) || "");
  if (src === "helka") return String((planning && planning.helka) || "");
  if (src === "neighborhood") return String(p.sales_area || "");
  if (src === "condition") return CONDITION_LABELS[String(p.condition || "")] || "";
  const v = p[src];
  return (v === null || v === undefined) ? "" : String(v);
}

/** תווית קריאה לנכס, כמו הצ'יפ באשף: "דירה — הרצל 5, עפולה". */
export function propertyLabel(p: Record<string, unknown>): string {
  const address = [p.street, p.house_number].filter(Boolean).join(" ");
  const place = [address, p.city].filter(Boolean).join(", ");
  return [p.property_type, place].filter(Boolean).join(" — ") ||
    String(p.title || "נכס");
}

/** ‏YYYY-MM-DD אחרי הוספת חודשים — כמו `agrAddMonthsIso` ב-crm.html. */
export function addMonthsIso(iso: string, months: number): string {
  const d = new Date(iso + "T00:00:00");
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  // ‏31/1 + חודש אחד הוא 28/2 ולא 3/3: `setMonth` גולש קדימה לבד, ותקופת
  // בלעדיות שנגמרת יום אחרי מה שסוכם היא בדיוק מה שאי אפשר להסביר ללקוח/ה.
  if (d.getDate() < day) d.setDate(0);
  return d.toISOString().slice(0, 10);
}

/**
 * מה חסר כדי שההזמנה תהיה הזמנה בכתב כדין. אותה רשימה בדיוק ש-`agrValidate`
 * מחשבת באשף, ובאותו סדר — כדי שהעוזר יבקש מהסוכן/ת את מה שהדשבורד היה
 * מבקש, ולא פחות.
 */
export function missingForAgreement(input: BuildInput): string[] {
  const tpl = templateFor(input.kind);
  const missing: string[] = [];

  if (!tpl) return ["סוג ההסכם אינו מוכר"];
  if (!input.properties.length) missing.push("לא נבחרו נכסים להסכם");
  if (!input.signers.length) missing.push("לא נבחרו חותמים להסכם");

  input.signers.forEach((s, i) => {
    const who = (s.full_name || "").trim() || `חותם/ת ${i + 1}`;
    if (!(s.full_name || "").trim()) missing.push(`חסר שם לחותם/ת ${i + 1}`);
    if (!(s.id_number || "").trim()) missing.push(`חסרה ת.ז. ל${who}`);
  });

  const hasPct = Number(input.commission.pct) > 0;
  const hasAmount = Number(input.commission.amount) > 0;
  if (!hasPct && !hasAmount) missing.push("לא הוזנה עמלה — אחוזים או סכום");

  if (tpl.exclusive && (!input.exclusive?.from || !input.exclusive?.until)) {
    missing.push("חסרה תקופת הבלעדיות (מתאריך ועד תאריך)");
  }
  if (!input.agent.id_number) {
    missing.push("חסרה ת.ז. בפרטי הסוכן/ת — אפשר להשלים אותה ב\"עדכון פרטי הסוכן/ת\" בדשבורד");
  }
  return missing;
}

/** האובייקט ש-`AgreementDoc.buildHtml` מצפה לו. מקביל ל-`agrBuildDoc`. */
function docInput(input: BuildInput, verifyCode: string, createdAt: Date | string) {
  const tpl = templateFor(input.kind);
  const bases = Templates.commissionBases[tpl.dealType] || [];
  // deno-lint-ignore no-explicit-any
  const basis = bases.find((b: any) => b.key === input.commission.basis);

  return {
    template: tpl,
    agent: {
      name: input.agent.name,
      id_number: input.agent.id_number,
      license_number: input.agent.license_number,
      phone: input.agent.phone,
      agency_name: input.agent.agency_name,
      agency_address: input.agent.agency_address,
    },
    signers: input.signers.map((s) => ({
      full_name: s.full_name,
      id_number: s.id_number || "",
      phone: s.phone || "",
      email: s.email || "",
      address: s.address || "",
      party: s.party,
    })),
    properties: input.properties.map((p) => ({
      fields: fieldsFor(tpl, p),
      notes: "",
    })),
    commission: {
      pct: input.commission.pct ?? "",
      amount: input.commission.amount ?? "",
      basisSuffix: basis ? basis.suffix : "",
    },
    exclusive: tpl.exclusive ? (input.exclusive || null) : null,
    // המשאלון נענה בדפדפן מול הלקוח/ה ואינו נשאל בצ'אט — במסמך הוא מודפס
    // עם קווים למילוי ידני, בדיוק כמו טופס שממלאים בפגישה.
    questionnaire: {},
    notes: input.notes || "",
    createdAt,
    verifyCode,
  };
}

// deno-lint-ignore no-explicit-any
function fieldsFor(tpl: any, p: AgreementProperty): Record<string, string> {
  const fields: Record<string, string> = {};
  // deno-lint-ignore no-explicit-any
  tpl.propertyFields.forEach((f: any) => {
    fields[f.key] = fieldFromProperty(f, p.row, p.planning);
  });
  return fields;
}

/** ה-payload שנכנס ל-`agreements`, בלי `document_html` (הוא נכתב אחרי ה-insert). */
export function insertPayload(input: BuildInput) {
  const tpl = templateFor(input.kind);
  const doc = docInput(input, "—", new Date());

  return {
    agent_id: input.agentId,
    agency_id: input.agencyId,
    kind: input.kind,
    title: tpl.docTitle,
    commission_pct: input.commission.pct ?? null,
    commission_amount: input.commission.amount ?? null,
    commission_note: input.commission.basis || null,
    exclusive_from: tpl.exclusive ? (input.exclusive?.from || null) : null,
    exclusive_until: tpl.exclusive ? (input.exclusive?.until || null) : null,
    language: input.language || "he",
    notes: input.notes || null,
    // אותו כלל כמו באשף: אימות בקוד חד-פעמי בטופסי קונה/שוכר, שבהם רשימת
    // הנכסים שבמסמך היא עצמה המידע שמוגן.
    require_otp: tpl.side === "client",
    property_ids: input.properties.map((p) => p.property_id).filter(Boolean),
    client_ids: input.signers.map((s) => s.client_id).filter(Boolean),
    snapshot: {
      property_line: input.properties.map((p) => p.label).join(" · "),
      properties: input.properties.map((p) => ({
        property_id: p.property_id,
        fields: fieldsFor(tpl, p),
        notes: "",
      })),
      signers: doc.signers,
      commission: doc.commission,
      exclusive: doc.exclusive,
      questionnaire: {},
      agent: doc.agent,
    },
  };
}

/**
 * גוף המסמך. נבנה **אחרי** ה-insert ולא לפניו, כי `verify_code` נוצר במסד
 * והוא מודפס בתחתית המסמך — בדיוק הסיבה שהאשף בדשבורד עושה insert, קורא את
 * הקוד, ורק אז שומר את ה-HTML.
 */
export function documentHtml(
  input: BuildInput,
  verifyCode: string,
  createdAt: string,
): string {
  return Doc.buildHtml(docInput(input, verifyCode, createdAt));
}

/** שורות `agreement_signers` בסדר שבו הן מודפסות במסמך. */
export function signerRows(agreementId: string, signers: AgreementSigner[]) {
  return signers.map((s, i) => ({
    agreement_id: agreementId,
    ord: i,
    party: s.party,
    full_name: s.full_name.trim(),
    id_number: (s.id_number || "").trim() || null,
    phone: (s.phone || "").trim() || null,
    email: (s.email || "").trim() || null,
    address: (s.address || "").trim() || null,
  }));
}
