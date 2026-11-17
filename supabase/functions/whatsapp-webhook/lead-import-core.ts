/**
 * ליבת הייבוא של לידים מקובץ (Excel/CSV) - פונקציות טהורות, בלי מסד ובלי רשת,
 * כדי שאפשר לבדוק אותן (lead_import_test.ts). הכתיבה למסד ב-lead-import.ts.
 *
 * מה נחשב ליד שלם: טלפון תקין, שם, וסוג (מוכר/ת-משכיר/ה או מחפש/ת). מה שחסר
 * נשאל על כל שורה בנפרד (גבריאלה), ולא מנוחש: טלפון שנוחש הוא ליד שאי אפשר
 * לחזור אליו, וסוג שנוחש הופך מוכר למחפש בכרטיס.
 */

export type LeadKind = "owner" | "seeker";
export type LeadDeal = "sale" | "rent";

export interface LeadFields {
  full_name: string;
  phone: string;
  kind: LeadKind | "";
  deal_type: LeadDeal | "";
  city: string;
  address: string;
  floor: string;
  rooms: string;
  property_type: string;
  seriousness: string;
  notes: string;
}

export type LeadMissing = "phone" | "name" | "kind";

export interface LeadDraft {
  /** מספר השורה בקובץ כפי שהסוכן/ת רואה אותו (הכותרת היא שורה 1) */
  rowNumber: number;
  /** האינדקס ב-rows של העבודה */
  index: number;
  fields: LeadFields;
  missing: LeadMissing[];
  /** שורה ריקה לגמרי מבחינת ליד: נדלגת בלי לשאול */
  blank: boolean;
  /** טלפון שהוקלד אבל אינו תקין, כדי לומר זאת בשאלה */
  badPhone: string;
}

export const LEAD_IMPORT_MAX_ROWS = 300;

type Col = keyof LeadFields | "first_name" | "last_name";

/** כותרות בעברית ובאנגלית, מנורמלות (בלי רווחים, גרשיים ומקפים). שם עמודה כללי מדי ("סוג") לא מופיע. */
const HEADER_SYNONYMS: Record<Col, string[]> = {
  full_name: ["שם", "שםמלא", "שםהלקוח", "שםהפונה", "שםהליד", "לקוח", "אישקשר", "name", "fullname", "contact", "customer"],
  first_name: ["שםפרטי", "פרטי", "firstname", "first"],
  last_name: ["שםמשפחה", "משפחה", "lastname", "last"],
  phone: ["טלפון", "נייד", "פלאפון", "פלפון", "סלולרי", "טל", "מספרטלפון", "מספרנייד", "טלפוןנייד", "phone", "mobile", "tel", "cell", "whatsapp", "וואטסאפ"],
  kind: ["סוגליד", "סוגלקוח", "סוגהפונה", "צד", "קטגוריה", "מוכרקונה", "מוכרמחפש", "kind", "leadtype"],
  deal_type: ["עסקה", "סוגעסקה", "מכירההשכרה", "מכירהאוהשכרה", "deal", "dealtype"],
  city: ["עיר", "יישוב", "ישוב", "מיקום", "city"],
  address: ["כתובת", "כתובתהנכס", "רחוב", "נכס", "address", "street"],
  floor: ["קומה", "floor"],
  rooms: ["חדרים", "מספרחדרים", "מסחדרים", "rooms"],
  property_type: ["סוגנכס", "סוגהנכס", "סוגדירה", "propertytype"],
  seriousness: ["רצינות", "דחיפות", "מועד", "זמן", "מתי", "עד מתי", "seriousness", "urgency", "timing"],
  notes: ["הערות", "הערה", "פרטים", "פרטיםנוספים", "תיאור", "הודעה", "מידענוסף", "notes", "comments", "remarks"],
};

export function normHeader(h: unknown): string {
  return String(h ?? "").replace(/[\s"'״׳`_\-.:/\\()]/g, "").toLowerCase();
}

/** אינדקס העמודה לכל שדה (-1 כשאין). עמודה אחת משרתת שדה אחד: הראשונה שמתאימה. */
export function mapLeadHeaders(headers: string[]): Record<Col, number> {
  const norm = headers.map(normHeader);
  const used = new Set<number>();
  const out = {} as Record<Col, number>;
  // שמות ספציפיים (שם פרטי/משפחה) לפני "שם", כדי ש"שם פרטי" לא ייתפס כ"שם"
  const order: Col[] = [
    "first_name", "last_name", "full_name", "phone", "kind", "deal_type", "property_type",
    "city", "address", "floor", "rooms", "seriousness", "notes",
  ];
  for (const col of order) {
    const wanted = HEADER_SYNONYMS[col].map(normHeader);
    let at = -1;
    for (const w of wanted) {
      const k = norm.findIndex((n, i) => !used.has(i) && n === w);
      if (k >= 0) { at = k; break; }
    }
    if (at >= 0) used.add(at);
    out[col] = at;
  }
  return out;
}

/** קובץ של אנשים לחזור אליהם: יש עמודת טלפון, ויש שם (או שם פרטי) */
export function looksLikeLeads(headers: string[]): boolean {
  const m = mapLeadHeaders(headers);
  return m.phone > -1 && (m.full_name > -1 || m.first_name > -1);
}

/**
 * טלפון ישראלי לפי הצורה שמוקלדת באקסל: ‏+972, בלי אפס מוביל (אקסל מוריד אותו
 * ממספר), עם מקפים וסוגריים, או כמה מספרים בתא ("050-111 / 052-222" - הראשון התקין).
 * מחזיר "" כשאין מספר תקין.
 */
export function normalizePhone(raw: unknown): string {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  for (const part of text.split(/[\/,;\n]|\s{2,}|\s+או\s+/)) {
    let d = part.replace(/\D/g, "");
    if (!d) continue;
    if (d.startsWith("00972")) d = d.slice(5);
    else if (d.startsWith("972")) d = d.slice(3);
    if (!d.startsWith("0")) d = "0" + d;
    // נייד: 05X + 7 ספרות. קווי: 0[2-4,8,9] + 7 ספרות
    if (/^05\d{8}$/.test(d) || /^0[23489]\d{7}$/.test(d) || /^07\d{8}$/.test(d)) return d;
  }
  return "";
}

export function kindFromText(text: unknown): LeadKind | "" {
  const t = String(text ?? "");
  if (/מוכר|משכיר|בעל\s?נכס|בעלים|בעלת|owner|seller|landlord|למכירה|להשכרה/i.test(t)) return "owner";
  if (/קונה|קונים|מחפש|שוכר|רוכש|קנייה|קניה|seeker|buyer|tenant|renter/i.test(t)) return "seeker";
  return "";
}

export function dealFromText(text: unknown): LeadDeal | "" {
  const t = String(text ?? "");
  if (/השכר|משכיר|שוכר|שכירות|שכיר|שכור|rent|tenant|landlord/i.test(t)) return "rent";
  if (/מכיר|מוכר|קונה|קנייה|קניה|קנות|רוכש|מכור|sale|sell|buy/i.test(t)) return "sale";
  return "";
}

function cell(row: unknown[], at: number): string {
  if (at < 0) return "";
  return String(row[at] ?? "").replace(/\s+/g, " ").trim();
}

export interface LeadDefaults {
  kind?: LeadKind | "";
  deal_type?: LeadDeal | "";
}

/**
 * שורה אחת לטיוטת ליד. סוג וסוג עסקה: מעמודה ייעודית, ואם אין - מברירת המחדל
 * שהסוכן/ת אמר/ה על כל הקובץ ("אלה מוכרים"). מעמודת הסוג נגזרת גם העסקה
 * ("משכיר" = בעלים + השכרה), אבל לא להפך: עסקה לבדה לא קובעת אם זה בעלים.
 */
export function draftFromRow(
  headers: string[],
  row: unknown[],
  index: number,
  defaults: LeadDefaults = {},
  map: Record<Col, number> = mapLeadHeaders(headers),
): LeadDraft {
  const first = cell(row, map.first_name);
  const last = cell(row, map.last_name);
  const fullName = cell(row, map.full_name) || [first, last].filter(Boolean).join(" ");
  const phoneRaw = cell(row, map.phone);
  const phone = normalizePhone(phoneRaw);

  const kindText = cell(row, map.kind);
  const dealText = cell(row, map.deal_type);
  let kind: LeadKind | "" = kindFromText(kindText) || (defaults.kind || "");
  // "קונה" בעמודת העסקה, או "מוכר" בעמודת העסקה, מכריעים גם כשאין עמודת סוג
  if (!kind && dealText) kind = kindFromText(dealText);
  let deal: LeadDeal | "" = dealFromText(dealText) || dealFromText(kindText) || (defaults.deal_type || "");

  const fields: LeadFields = {
    full_name: fullName,
    phone,
    kind,
    deal_type: deal,
    city: cell(row, map.city),
    address: cell(row, map.address),
    floor: cell(row, map.floor),
    rooms: cell(row, map.rooms),
    property_type: cell(row, map.property_type),
    seriousness: cell(row, map.seriousness),
    notes: cell(row, map.notes),
  };

  const hasAnything = Object.values(fields).some((v) => v !== "") || phoneRaw !== "";
  const missing = missingOf(fields);
  return {
    rowNumber: index + 2,
    index,
    fields,
    missing,
    blank: !hasAnything,
    badPhone: phoneRaw && !phone ? phoneRaw : "",
  };
}

export function missingOf(f: LeadFields): LeadMissing[] {
  const out: LeadMissing[] = [];
  if (!f.phone) out.push("phone");
  if (!f.full_name) out.push("name");
  if (!f.kind) out.push("kind");
  return out;
}

const MISSING_LABEL: Record<LeadMissing, string> = {
  phone: "טלפון",
  name: "שם",
  kind: "סוג (מוכר/ת או מחפש/ת)",
};

export function missingText(m: LeadMissing[]): string {
  return m.map((k) => MISSING_LABEL[k]).join(", ");
}

/** שורה אחת בשאלה: מי זה, מה ידוע, מה חסר */
export function describeDraft(d: LeadDraft): string {
  const f = d.fields;
  const bits = [
    f.full_name || "(בלי שם)",
    f.phone || (d.badPhone ? `טלפון לא תקין: ${d.badPhone}` : ""),
    f.address || f.city,
    f.kind === "owner" ? "בעלים" : f.kind === "seeker" ? "מחפש/ת" : "",
    f.notes ? f.notes.slice(0, 60) : "",
  ].filter(Boolean);
  return `שורה ${d.rowNumber}: ${bits.join(" · ")}`;
}

export interface LeadParse {
  drafts: LeadDraft[];
  map: Record<Col, number>;
}

export function parseLeadRows(headers: string[], rows: unknown[][], defaults: LeadDefaults = {}): LeadParse {
  const map = mapLeadHeaders(headers);
  const drafts = rows.map((r, i) => draftFromRow(headers, r, i, defaults, map));
  return { drafts, map };
}

export interface AnswerInput {
  full_name?: unknown;
  phone?: unknown;
  kind?: unknown;
  deal_type?: unknown;
  city?: unknown;
  address?: unknown;
  notes?: unknown;
}

/** מיישם תשובה של הסוכן/ת על שורה אחת. טלפון לא תקין לא נכנס, והשורה נשארת עם החסר. */
export function applyAnswer(d: LeadDraft, a: AnswerInput): { draft: LeadDraft; badPhone: string } {
  const f: LeadFields = { ...d.fields };
  let badPhone = "";
  const str = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
  if (str(a.full_name)) f.full_name = str(a.full_name).slice(0, 80);
  if (a.phone !== undefined && str(a.phone) !== "") {
    const p = normalizePhone(a.phone);
    if (p) f.phone = p;
    else badPhone = str(a.phone);
  }
  const kind = a.kind === "owner" || a.kind === "seeker" ? a.kind : kindFromText(a.kind);
  if (kind) f.kind = kind;
  const deal = a.deal_type === "sale" || a.deal_type === "rent" ? a.deal_type : dealFromText(a.deal_type);
  if (deal) f.deal_type = deal;
  if (str(a.city)) f.city = str(a.city).slice(0, 80);
  if (str(a.address)) f.address = str(a.address).slice(0, 200);
  if (str(a.notes)) f.notes = f.notes ? `${f.notes} · ${str(a.notes)}` : str(a.notes);
  const missing = missingOf(f);
  return { draft: { ...d, fields: f, missing, badPhone: badPhone || (f.phone ? "" : d.badPhone) }, badPhone };
}

/** הקלט ל-agent_lead_add */
export function rpcPayload(f: LeadFields): Record<string, unknown> {
  return {
    kind: f.kind || "owner",
    full_name: f.full_name,
    phone: f.phone,
    deal_type: f.deal_type,
    city: f.city,
    address: f.address,
    floor: f.floor,
    rooms: f.rooms,
    property_type: f.property_type,
    seriousness: f.seriousness,
    notes: f.notes,
    notify: false,
  };
}
