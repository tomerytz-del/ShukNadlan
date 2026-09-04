// ============================================================================
// הטקסט השיווקי של נכס — הפרומפט, העובדות והקריאה ל-Claude, במקום אחד.
//
// למה קובץ משותף: עד עכשיו הנוסח הזה חי בתוך property-marketing-publish, כלומר
// היכולת לכתוב תיאור שיווקי הייתה חלק מהפוסט לפייסבוק. מרגע ש-property-description
// כותבת תיאורים גם בלי שום ערוץ פרסום מחובר, שתי הפונקציות חייבות לדבר באותה
// שפה בדיוק — אחרת אותו נכס היה מקבל טקסט אחר לפי מי הגיע אליו קודם, ותיקון
// בפרומפט היה צריך להיזכר פעמיים.
//
// שתי תוצרות בקריאה אחת: תיאור ארוך (marketing_description, נשמר על הנכס
// ומשמש בכל ערוץ) ופוסט קצר (post_text). הפרדה לשתי קריאות הייתה מכפילה עלות
// ומזמינה שני נוסחים שלא מדברים זה עם זה.
// ============================================================================

/** שורת העובדות של נכס אחד — התוצאה של property_marketing_facts במסד. */
// deno-lint-ignore no-explicit-any
export type PropertyFacts = Record<string, any>;

export interface MarketingCopy {
  description: string;
  post: string;
}

// ---------------------------------------------------------------------------
// עובדות הנכס — אותה שפה שהאתר מדבר בה
// ---------------------------------------------------------------------------

export const nis = (n: number | null | undefined) =>
  n === null || n === undefined ? "" : "₪" + Math.round(Number(n)).toLocaleString("he-IL");

/** "₪1,850,000" למכירה · "₪4,800 לחודש" להשכרה. */
export function priceLine(row: PropertyFacts): string {
  if (row.price === null || row.price === undefined) return "";
  return row.deal_type === "rent" ? `${nis(row.price)} לחודש` : nis(row.price);
}

/** "4 חדרים · 98 מ״ר · קומה 3 מתוך 8" — רק מה שקיים במודעה. */
export function specLine(row: PropertyFacts): string {
  const floor = row.floor === null || row.floor === undefined
    ? null
    : row.total_floors ? `קומה ${row.floor} מתוך ${row.total_floors}` : `קומה ${row.floor}`;
  return [
    row.rooms ? `${row.rooms} חדרים` : null,
    row.size_sqm ? `${Math.round(row.size_sqm)} מ״ר` : null,
    row.garden_sqm ? `גינה ${Math.round(row.garden_sqm)} מ״ר` : null,
    floor,
  ].filter(Boolean).join(" · ");
}

/** "רובע יזרעאל, עפולה" — השכונה קודמת, היא מה שמזהה את המיקום בעין. */
export function placeLine(row: PropertyFacts): string {
  return [row.neighborhood, row.street, row.city].filter(Boolean).join(", ");
}

/** כל מה שידוע על הנכס, בטקסט אחד — הקלט של Claude ושל בונה הפוסט. */
export function factsText(row: PropertyFacts): string {
  const dealType = row.deal_type === "rent" ? "להשכרה" : "למכירה";
  // מידע תכנוני נכנס רק לקרקע/מגרש: על דירה הוא לא קיים ממילא, ועל נכס
  // מסחרי הוא לא מה שמוכר אותו.
  const planning = [
    row.land_zoning ? `ייעוד קרקע: ${row.land_zoning}` : null,
    row.land_building_rights_pct ? `אחוזי בנייה: ${row.land_building_rights_pct}%` : null,
    row.land_max_units ? `יחידות דיור מותרות: ${row.land_max_units}` : null,
    row.land_max_floors ? `קומות מותרות: ${row.land_max_floors}` : null,
    row.land_planning_notes ? `הערה תכנונית: ${row.land_planning_notes}` : null,
  ].filter(Boolean);

  return [
    row.title ? `כותרת המודעה: ${row.title}` : null,
    `סוג עסקה: ${dealType}`,
    row.property_type ? `סוג נכס: ${row.property_type}` : null,
    row.category === "commercial" ? "מדובר בנכס מסחרי" : null,
    placeLine(row) ? `מיקום: ${placeLine(row)}` : null,
    specLine(row) ? `נתונים: ${specLine(row)}` : null,
    row.built_size_sqm ? `שטח בנוי: ${Math.round(row.built_size_sqm)} מ״ר` : null,
    priceLine(row) ? `מחיר: ${priceLine(row)}` : null,
    row.condition ? `מצב הנכס: ${row.condition}` : null,
    row.project_status ? `סטטוס הפרויקט: ${row.project_status}` : null,
    row.features?.length ? `מאפיינים: ${row.features.join(", ")}` : null,
    row.furniture_details ? `ריהוט: ${row.furniture_details}` : null,
    row.move_in_date ? `כניסה: ${row.move_in_date}` : null,
    ...planning,
    row.description ? `תיאור המודעה כפי שנכתב על ידי הסוכן/ת: ${row.description}` : null,
    row.agent_name ? `סוכן/ת: ${row.agent_name}` : null,
    row.agency_name ? `משרד: ${row.agency_name}` : null,
  ].filter(Boolean).join("\n");
}

// ---------------------------------------------------------------------------
// הפרומפט
//
// המגבלה החשובה בו היא "רק מה שכתוב": מודל שממציא "קרוב לפארק" על נכס שלא
// נאמר עליו דבר יוצר מודעה שקרית, וזו חשיפה משפטית של הפלטפורמה — לא רק טקסט
// פחות טוב.
// ---------------------------------------------------------------------------

export const SYSTEM_PROMPT = `את/ה קופירייטר/ית נדל"ן ישראלי/ת שכותב/ת עבור לוח הנכסים שוק נדל"ן.

חוקים מוחלטים:
1. מותר להשתמש אך ורק בעובדות שמופיעות בנתוני הנכס. אסור להמציא מרחק ממוסדות,
   נוף, שכנים, פוטנציאל השבחה, תשואה, או כל פרט שלא נמסר.
2. אין הבטחות תשואה, אין "השקעה בטוחה", אין הצהרות על מגמות מחירים.
3. אין אזכור של מוצא, דת, לאום או הרכב משפחתי — לא ישיר ולא ברמז.
4. לא לכתוב טלפונים, אימיילים או קישורים. המערכת מוסיפה אותם בעצמה.
5. עברית תקנית, גוף שלישי, ללא סימני קריאה כפולים וללא מילים כמו "מדהים",
   "חלומי", "הזדמנות שלא תחזור".
6. כשהנתונים דלים — לכתוב קצר. טקסט קצר ומדויק עדיף על טקסט ארוך ומנופח.

פלט: JSON תקין בלבד, בלי טקסט לפניו או אחריו, במבנה:
{"marketing_description": "...", "post_text": "..."}

marketing_description — 50 עד 90 מילים, פסקה אחת רציפה, מתארת את הנכס
ומסתיימת בהזמנה לצפייה.

post_text — פוסט לפייסבוק, עד 45 מילים, משפט פותח שמושך את העין, שתיים עד
שלוש אימוג'י לכל היותר, ובסוף שורה אחת עם 3 עד 5 האשטגים בעברית
(לדוגמה: #נדלן #עפולה #דירהלמכירה). בלי קישור ובלי טלפון.`;

// ---------------------------------------------------------------------------
// הקריאה
//
// מחזירה null כשאין מפתח — ולא זורקת. הקוראים מבחינים בין "לא מוגדר" (מצב
// התקנה, שצריך לומר אותו במפורש) לבין "נכשל" (שצריך לנסות שוב).
// ---------------------------------------------------------------------------

export async function generateMarketingCopy(
  row: PropertyFacts,
  opts: { apiKey: string; model: string },
): Promise<MarketingCopy | null> {
  if (!opts.apiKey) return null;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": opts.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `נתוני הנכס:\n${factsText(row)}` }],
    }),
  });

  if (!res.ok) {
    throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const data = await res.json();
  const text = (data?.content ?? [])
    // deno-lint-ignore no-explicit-any
    .filter((b: any) => b?.type === "text")
    // deno-lint-ignore no-explicit-any
    .map((b: any) => b.text)
    .join("")
    .trim();

  // המודל התבקש ל-JSON נקי, אבל גדר ```json היא הסטייה הנפוצה ולא שווה
  // להיכשל עליה.
  const raw = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  // deno-lint-ignore no-explicit-any
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error(`תשובת Claude אינה JSON: ${raw.slice(0, 200)}`);
    parsed = JSON.parse(m[0]);
  }

  const description = String(parsed?.marketing_description ?? "").trim();
  const post = String(parsed?.post_text ?? "").trim();
  if (!description) throw new Error("Claude החזיר תיאור ריק");
  return { description, post: post || description };
}
