// ============================================================================
// מנוע הקופי של המודעות הממומנות — שני מסלולים ורמת אגרסיביות
//
//   property  נכס שבאתר → קונים/שוכרים. רמה 1-2 בלבד (check גם במסד).
//             העובדות מ-property_marketing_facts, והחוקים הם PROPERTY_COPY_RULES
//             — אותם של התיאור השיווקי, לא עותק שמתפצל.
//   platform  שוק נדל"ן עצמה → מתווכים ומשרדים. רמה 1-5.
//             העובדות רק מ-ads_settings.platform_facts ומה-brief.
//
// ‏**הרמה משנה טון, לעולם לא עובדות.** רמה 5 מותרת לפתוח בפרובוקציה ולמסגר
// הפסד; היא אינה מותרת להמציא מספר, להבטיח תוצאה או להזכיר מתחרה בשם. את
// זה אומר הפרומפט, ואת מה שאפשר לבדוק במכונה בודק checkVariant() — כמו
// noLongDash אחרי הסעיף בפרומפט: הנחיה היא בקשה, הבדיקה היא הערובה.
//
// ‏checkVariant אינו חוסם שמירה: הוא מחזיר אזהרות שהפאנל מציג ליד הנוסח.
// מי שעורך/ת הוא תומר, ונוסח שחורג ב-3 תווים מכותרת עדיף לפעמים על נוסח
// שנחתך. החסימה האמיתית — שורת הגילוי ונכס שאינו באוויר — יושבת ביצירת
// הקמפיין (שלב 5).
// ============================================================================

import { factsText, MarketingCopyAuthError, noLongDash, PROPERTY_COPY_RULES } from "../_shared/marketing-copy.ts";

export type Audience = "property" | "platform";

export const MAX_INTENSITY: Record<Audience, number> = { property: 2, platform: 5 };

export const CTA_TYPES = ["LEARN_MORE", "SIGN_UP", "CONTACT_US", "WHATSAPP_MESSAGE", "GET_QUOTE"] as const;

export type Variant = {
  angle: string;
  primary_text: string;
  headline: string;
  description: string;
  cta: string;
};

export type Brief = {
  offer?: string;    // הצעה אמיתית בלבד ("חודש ראשון חינם") — אחרת ריק
  angle?: string;    // זווית מבוקשת ("חיסכון בזמן", "לידים")
  notes?: string;    // כל דבר אחר
  deadline?: string; // תאריך אמיתי. בלעדיו אסורה דחיפות
};

// מגבלות התצוגה של מטא בפיד (‎.claude/skills/meta-ads/references/ad-text-limits.md‎).
// ‏primary_text אין לו תקרה קשיחה; 500 הוא הגבול שלנו, כי מעבר לו אף אחד לא קורא.
export const LIMITS = { headline: 40, description: 25, primary_text: 500, hook: 125 };

const LADDER: Record<Audience, Record<number, string>> = {
  property: {
    1: "מידעי ושקט: עובדות הנכס בבהירות, בלי שום לחץ. קריאה לפעולה מזמינה.",
    2: "חם ומזמין: מה הנכס נותן ביום-יום, בשפה מדוברת ולא שיווקית. קריאה לפעולה ברורה.",
  },
  platform: {
    1: "מידעי ורגוע: יכולת אחת מוצגת בבהירות, בלי לחץ. קריאה לפעולה מזמינה.",
    2: "חם וענייני: תועלת יומיומית ברורה, בטון של עמית למקצוע.",
    3: "ישיר ונחוש: פתיחה בשאלה חדה או בתועלת חדה, משפטים קצרים, קריאה לפעולה תקיפה.",
    4: "אגרסיבי: פתיחה בכאב מוכר של העבודה (עבודה ידנית, לידים שהולכים לאיבוד, שעות על פרסום), " +
      "ניגוד חד בין איך עובדים היום לבין איך זה יכול להיות, וקריאה לפעולה סוגרת ולא מזמינה.",
    5: "אגרסיבי מאוד: פתיחה פרובוקטיבית שעוצרת גלילה, מסגור של מה מפסידים כל יום בלי הכלי, " +
      "וסיום בבחירה בין שתי דרכים. חד ונועז - אבל בלי צעקות, בלי הגזמות ובלי עלבון.",
  },
};

const PLATFORM_RULES = `1. מותר לטעון על שוק נדל"ן רק את מה שמופיע ברשימת העובדות או בתדריך. אסור להמציא
   מספרים, אחוזים, חיסכון בזמן, כמות משתמשים, מחירים או תוצאות.
2. אין "הכי", "מספר 1", "היחידים", "מובטח" - אלא אם זה מופיע בעובדות.
3. אסור להזכיר מתחרה בשם (לא אתרים, לא אפליקציות, לא תוכנות) ואסור להשוות לשירות מסוים.
4. מדיניות מטא: אסור לטעון או לרמוז משהו על מצבו האישי של הקורא/ת - כספי, בריאותי,
   משפחתי ("מפסידים כסף?", "בחובות?"). מדברים על העבודה ועל הכלים, לא על האדם.
   מותר לפנות למקצוע ("למתווכים", "למשרדי תיווך").
5. דחיפות ותאריכי יעד רק אם יש deadline אמיתי בתדריך. בלעדיו אין "רק היום", "אחרונים".
6. הצעה (מחיר, ניסיון חינם, הנחה) רק אם היא מופיעה בתדריך, ובדיוק כפי שנכתבה.
7. לא לכתוב טלפונים, אימיילים או קישורים. המערכת מוסיפה אותם בעצמה.
8. אין להשתמש במקף ארוך (\u2014 או \u2013). כשצריך מקף, לכתוב מקף רגיל: -
9. לכל היותר סימן קריאה אחד ושתי אימוג'י לכל נוסח.`;

const PROPERTY_AD_RULES = `${PROPERTY_COPY_RULES}
9. אין דחיפות מזויפת ("אחרון", "רק היום", "לפני שייגמר") - אלא אם יש deadline אמיתי בתדריך,
   כמו ביקור פתוח בתאריך.
10. לא לכתוב שהמודעה מבעלים או "ללא תיווך". זו מודעה של מתווך/ת.
11. שורת הגילוי (שם ורישיון) נוספת בעצמה מתחת לטקסט - לא לכתוב אותה.`;

const OUTPUT_SPEC = `פלט: JSON תקין בלבד במבנה {"variants": [...]}, כשכל נוסח הוא:
- angle: שם קצר לזווית (3-5 מילים), כדי שאפשר יהיה להשוות ביניהן.
- primary_text: הטקסט הראשי. 125 התווים הראשונים חייבים לעמוד בפני עצמם, כי השאר
  מוסתר מאחורי "עוד". שורות קצרות. עד ${LIMITS.primary_text} תווים.
- headline: עד ${LIMITS.headline} תווים.
- description: עד ${LIMITS.description} תווים, משלים את הכותרת.
- cta: אחד מ: ${CTA_TYPES.join(", ")}.
כל נוסח בזווית אחרת - לא אותו טקסט במילים אחרות.`;

export function systemPrompt(audience: Audience, intensity: number, platformFacts: string): string {
  const tone = LADDER[audience][intensity];
  if (audience === "property") {
    return `את/ה קופירייטר/ית נדל"ן ישראלי/ת שכותב/ת מודעה ממומנת בפייסבוק ובאינסטגרם לנכס
שמפורסם בלוח הנכסים שוק נדל"ן. הקהל: מי שמחפש/ת דירה לקנות או לשכור.

רמת הטון (${intensity} מתוך ${MAX_INTENSITY.property}): ${tone}

חוקים מוחלטים:
${PROPERTY_AD_RULES}

${OUTPUT_SPEC}`;
  }
  return `את/ה קופירייטר/ית של מודעות ביצועים, שכותב/ת בעברית מודעה ממומנת בפייסבוק ובאינסטגרם
עבור שוק נדל"ן - פלטפורמה למתווכים ולמשרדי תיווך. הקהל: מתווכים ומנהלי משרדים, אנשי
מקצוע שמכירים את העבודה מבפנים.

רמת האגרסיביות (${intensity} מתוך ${MAX_INTENSITY.platform}): ${tone}

העובדות היחידות על שוק נדל"ן:
${platformFacts || "(הרשימה ריקה - לכתוב רק מה שבתדריך)"}

חוקים מוחלטים, בכל רמה:
${PLATFORM_RULES}

${OUTPUT_SPEC}`;
}

export function briefText(brief: Brief): string {
  return [
    brief.angle ? `זווית מבוקשת: ${brief.angle}` : null,
    brief.offer ? `הצעה (אמיתית, לכתוב בדיוק כך): ${brief.offer}` : "אין הצעה - לא להמציא הנחה, מחיר או ניסיון חינם",
    brief.deadline ? `תאריך יעד אמיתי: ${brief.deadline}` : "אין תאריך יעד - אסורה דחיפות",
    brief.notes ? `הערות: ${brief.notes}` : null,
  ].filter(Boolean).join("\n");
}

export function userMessage(opts: {
  audience: Audience;
  facts?: Record<string, unknown> | null;
  brief: Brief;
  count: number;
  previous?: Variant[];
  feedback?: string;
}): string {
  const parts: string[] = [];
  if (opts.audience === "property" && opts.facts) parts.push(`נתוני הנכס:\n${factsText(opts.facts)}`);
  parts.push(`תדריך:\n${briefText(opts.brief)}`);
  if (opts.previous?.length && opts.feedback) {
    parts.push(`הנוסחים הקודמים:\n${JSON.stringify(opts.previous, null, 1)}`);
    parts.push(`ההערה על הנוסחים הקודמים - לכתוב מחדש לפיה, בלי לחרוג מהחוקים:\n${opts.feedback}`);
  }
  parts.push(`לכתוב ${opts.count} נוסחים.`);
  return parts.join("\n\n");
}

const VARIANTS_SCHEMA = {
  type: "object",
  properties: {
    variants: {
      type: "array",
      items: {
        type: "object",
        properties: {
          angle: { type: "string" },
          primary_text: { type: "string" },
          headline: { type: "string" },
          description: { type: "string" },
          cta: { type: "string", enum: [...CTA_TYPES] },
        },
        required: ["angle", "primary_text", "headline", "description", "cta"],
        additionalProperties: false,
      },
    },
  },
  required: ["variants"],
  additionalProperties: false,
};

// ניקוי שחל על כל נוסח — גם על מה שהמודל כתב וגם על מה שנערך ביד.
export function cleanVariant(v: any): Variant {
  const s = (x: unknown, max: number) => noLongDash(String(x ?? "").trim()).slice(0, max);
  return {
    angle: s(v?.angle, 80),
    primary_text: s(v?.primary_text, 2000),
    headline: s(v?.headline, 200),
    description: s(v?.description, 200),
    cta: (CTA_TYPES as readonly string[]).includes(v?.cta) ? v.cta : "LEARN_MORE",
  };
}

const PHONE_RE = /(?:\+972|\b0)[\s-]?\d{1,2}[\s-]?\d{3}[\s-]?\d{4}\b/;
const URL_RE = /(?:https?:\/\/|www\.|\b[a-z0-9-]+\.(?:co\.il|com|net|org|il)\b)/i;
const URGENCY_RE = /(רק היום|אחרונ(?:ים|ות)?\b|לפני שייגמר|מבצע מסתיים|מהרו)/;
const SUPERLATIVE_RE = /(הכי טוב|מספר 1|#1|היחידים|מובטח)/;
const PROPERTY_HYPE_RE = /(מדהים|חלומי|הזדמנות שלא תחזור|ללא תיווך|מבעלים)/;

// אזהרות לנוסח אחד. לא חוסם — הפאנל מציג אותן ליד הנוסח.
export function checkVariant(audience: Audience, v: Variant, brief: Brief): string[] {
  const w: string[] = [];
  if (!v.primary_text) w.push("טקסט ראשי ריק");
  if (!v.headline) w.push("כותרת ריקה");
  if (v.headline.length > LIMITS.headline) w.push(`כותרת ${v.headline.length} תווים - מטא חותכת אחרי ${LIMITS.headline}`);
  if (v.description.length > LIMITS.description) w.push(`תיאור ${v.description.length} תווים - מעל ${LIMITS.description}`);
  if (v.primary_text.length > LIMITS.primary_text) w.push(`טקסט ראשי ${v.primary_text.length} תווים - מעל ${LIMITS.primary_text}`);
  const firstLine = v.primary_text.split("\n")[0] ?? "";
  if (firstLine.length > LIMITS.hook) w.push(`השורה הראשונה ${firstLine.length} תווים - מה שאחרי ${LIMITS.hook} מוסתר`);
  const all = `${v.primary_text}\n${v.headline}\n${v.description}`;
  if (PHONE_RE.test(all)) w.push("יש מספר טלפון בטקסט - המערכת מוסיפה את פרטי הקשר בעצמה");
  if (URL_RE.test(all)) w.push("יש קישור בטקסט - הקישור נקבע ביעד המודעה");
  if (!brief.deadline && URGENCY_RE.test(all)) w.push("דחיפות בלי תאריך יעד אמיתי בתדריך");
  if (SUPERLATIVE_RE.test(all)) w.push("טענת 'הכי' / 'מובטח' - מותרת רק אם היא עובדה מוכחת");
  if ((all.match(/!/g) ?? []).length > 1) w.push("יותר מסימן קריאה אחד");
  if (audience === "property" && PROPERTY_HYPE_RE.test(all)) w.push("ניסוח שאסור במודעת נכס (הגזמה או 'ללא תיווך')");
  return w;
}

export async function generateVariants(opts: {
  apiKey: string;
  model: string;
  audience: Audience;
  intensity: number;
  platformFacts: string;
  facts?: Record<string, unknown> | null;
  brief: Brief;
  count: number;
  previous?: Variant[];
  feedback?: string;
}): Promise<Variant[]> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": opts.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: opts.model,
      // אותו נימוק כמו ב-marketing-copy.ts: החשיבה נספרת ב-max_tokens.
      max_tokens: 8000,
      system: systemPrompt(opts.audience, opts.intensity, opts.platformFacts),
      output_config: { format: { type: "json_schema", schema: VARIANTS_SCHEMA } },
      messages: [{ role: "user", content: userMessage(opts) }],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (res.status === 401 || res.status === 403) {
    throw new MarketingCopyAuthError((await res.text()).slice(0, 200));
  }
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const data = await res.json();
  const text = (data?.content ?? [])
    .filter((b: any) => b?.type === "text")
    .map((b: any) => b.text)
    .join("")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`תשובת Claude אינה JSON (stop_reason=${data?.stop_reason}): ${text.slice(0, 200)}`);
  }
  const variants = (Array.isArray(parsed?.variants) ? parsed.variants : []).map(cleanVariant);
  if (!variants.length) throw new Error("Claude לא החזיר נוסחים");
  return variants;
}
