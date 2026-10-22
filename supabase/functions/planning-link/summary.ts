// ============================================================================
// התוצאה של דף הבדיקה (/plan) - ניקוי, וההודעה לסוכן/ת בוואטסאפ
//
// הרשומה מגיעה מהדפדפן (‏GovmapLookup.addressRecord), ולכן היא קלט זר: כל
// שדה כאן נבדק ונחתך, וקישור יוצא רק למבא"ת. המטמון של גבריאלה מאמת בנפרד
// במסד (‏_govmap_address_store) - כאן זה הסיכום שנשמר בקישור ונשלח בהודעה.
//
// טהור, בלי רשת: ‏scripts/planning_link_test.ts.
// ============================================================================

export interface PlanLine {
  number: string;
  name: string | null;
  kind: string | null;
  stage: string | null;
  notice: boolean;
  url: string | null;
  designation: string | null;
}

export interface PlanningSummary {
  gush: string | null;
  helka: string | null;
  area_sqm: number | null;
  parcel_status: string | null;
  designation: string | null;
  neighborhood: string | null;
  pin_source: "address" | "parcel" | null;
  plans: PlanLine[];
  detailed: string[];
}

const MAVAT_URL_RE = /^https:\/\/mavat\.iplan\.gov\.il\/[A-Za-z0-9\/]{1,200}$/;
const MAX_PLANS = 8;

// deno-lint-ignore no-explicit-any
type Rec = Record<string, any>;

function text(v: unknown, max: number): string | null {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
}

function digits(v: unknown, max: number): string | null {
  const s = String(v ?? "").trim();
  return new RegExp(`^\\d{1,${max}}$`).test(s) ? s : null;
}

/** רשומת הדפדפן -> סיכום בטוח. ‏null = "לא נמצא". */
export function summarize(record: unknown): PlanningSummary | null {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  const r = record as Rec;
  const area = Number(r.parcel_area_sqm);
  const plans: PlanLine[] = (Array.isArray(r.govmap_plans) ? r.govmap_plans : [])
    .filter((p: unknown) => p && typeof p === "object")
    .map((p: Rec) => ({
      number: text(p.number, 100) || "",
      name: text(p.name, 200),
      kind: text(p.kind, 100),
      stage: ["approved", "deposited", "notice"].includes(p.stage) ? p.stage : null,
      notice: p.notice === true,
      url: MAVAT_URL_RE.test(String(p.url || "")) ? String(p.url) : null,
      designation: text(p.designation, 100),
    }))
    .filter((p: PlanLine) => p.number)
    .slice(0, MAX_PLANS);
  const detailed = (Array.isArray(r.applicable_plans) ? r.applicable_plans : [])
    .map((p: Rec) => text(p && p.number, 100))
    .filter((n: string | null): n is string => !!n)
    .slice(0, MAX_PLANS);
  return {
    gush: digits(r.gush, 7),
    helka: digits(r.helka, 5),
    area_sqm: Number.isFinite(area) && area > 0 && area < 100_000_000 ? Math.round(area) : null,
    parcel_status: text(r.parcel_status, 60),
    // הייעוד של המגרש (‏retzefMigrashim) קודם; אחרת של התוכנית המאושרת הראשונה
    designation: text(r.land_use_designation, 100) ||
      (plans.find((p) => p.designation && !p.notice && p.stage === "approved")?.designation ?? null),
    neighborhood: text(r.neighborhood, 80),
    pin_source: r.pin_source === "parcel" ? "parcel" : r.pin_source === "address" ? "address" : null,
    plans,
    detailed,
  };
}

const STAGE_LABEL: Record<string, string> = { approved: "מאושרת", deposited: "בהפקדה" };

export interface LinkTarget {
  city?: string | null;
  street?: string | null;
  house_number?: string | null;
  gush?: string | null;
  helka?: string | null;
}

export function targetLabel(t: LinkTarget): string {
  if (t.street && t.house_number) return `${t.street} ${t.house_number}${t.city ? ", " + t.city : ""}`;
  return `גוש ${t.gush} חלקה ${t.helka}`;
}

/** ההודעה לוואטסאפ. בלי מקף ארוך ובלי `**` - וואטסאפ מדגיש בכוכבית אחת. */
export function whatsappMessage(t: LinkTarget, s: PlanningSummary | null, pageUrl: string): string {
  const head = `תוצאת הבדיקה התכנונית - ${targetLabel(t)}:`;
  if (!s) {
    return `${head}\nGovMap לא מצא את הכתובת. אם הגוש והחלקה ידועים, שלח/י לי אותם ואבדוק לפיהם.`;
  }
  const lines = [head];
  const parcel = [
    s.gush && s.helka ? `גוש ${s.gush} חלקה ${s.helka}` : null,
    s.area_sqm ? `${s.area_sqm.toLocaleString("en-US")} מ"ר` : null,
    s.parcel_status,
  ].filter(Boolean).join(" · ");
  if (parcel) lines.push(parcel);
  if (s.pin_source === "parcel") lines.push("(הכתובת אינה בשכבת הכתובות - לפי הגוש והחלקה)");
  lines.push(`ייעוד: ${s.designation || "לא נמצא בשכבות"}`);
  if (s.plans.length || s.detailed.length) {
    lines.push("", "תוכניות:");
    for (const n of s.detailed.slice(0, 3)) lines.push(`• ${n} (תוכנית מפורטת)`);
    for (const p of s.plans) {
      const tag = p.notice ? "⚠️ הודעה לפי סעיף 77-78" : [p.kind, p.stage ? STAGE_LABEL[p.stage] : null].filter(Boolean).join(", ");
      lines.push(`• ${p.number}${p.name ? " " + p.name : ""}${tag ? " (" + tag + ")" : ""}`);
    }
  }
  if (s.plans.some((p) => p.notice)) {
    lines.push("", "יש הודעה לפי סעיף 77-78: ייתכנו מגבלות על היתרים באזור עד שהתוכנית תאושר או תבוטל.");
  }
  lines.push("", `לפרטים וקישורים למבא"ת: ${pageUrl}`,
    "המידע כללי, מבוסס על GovMap ומבא\"ת, ואינו תחליף לבדיקה מול הוועדה המקומית.");
  return lines.join("\n");
}
