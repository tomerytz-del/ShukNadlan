// ============================================================================
// מנוע ההדמיות — משותף ל-property-visualize ול-property-visualize-base
//
// מיובא מ-nadlan-afula.co.il (‏business-visualizer). המנוע הוא img2img של
// Gemini: התמונה האמיתית של הנכס נכנסת פנימה יחד עם פרומפט עריכה, והמודל
// מחזיר את *אותה* תמונה עם שינוי מוגבל. זו לא יצירת תמונה מאפס — וזה ההבדל
// שמפריד בין הדמיה שימושית לבין תמונה יפה של נכס אחר.
//
// עקרון הפרומפט (הועתק מאפולה ומורחב כאן גם לחוץ של בית פרטי): כל פרומפט
// בנוי משני חלקים — רשימת האיסורים (מה אסור לגעת בו: פתחים, מבנה, זווית
// צילום) ואחריה רשימת ההיתרים (מה מותר לשנות). האיסורים תמיד ראשונים ותמיד
// מפורשים, כי מודל תמונה שלא נאמר לו אחרת ישמח לצייר בניין חדש לגמרי.
// ============================================================================

const IMAGE_MODEL = Deno.env.get("GEMINI_IMAGE_MODEL") ?? "gemini-3.1-flash-image-preview";
const VISION_MODEL = Deno.env.get("GEMINI_VISION_MODEL") ?? "gemini-3.1-flash-lite";

export const VISUALIZATION_BUCKET = "property-visualizations";

// ---------------------------------------------------------------------------
// סוגי נכס שיש להם "חוץ" משלהם
//
// בדירה בבניין החזית היא רכוש משותף — הדמיה שלה מציגה שיפוץ שאיש לא מתחייב
// אליו, ולכן דירות מקבלות סלון ומטבח בלבד.
// ---------------------------------------------------------------------------
const HOUSE_TYPES = ["בית פרטי", "בית פרטי/קוטג'", "קוטג'", "דו משפחתי", "וילה", "פנטהאוז"];

export function hasOwnExterior(propertyType: string | null): boolean {
  if (!propertyType) return false;
  return HOUSE_TYPES.some((t) => propertyType.includes(t));
}

// ---------------------------------------------------------------------------
// קרקע — אין מה לדמות
//
// המנוע כולו הוא img2img: הוא עורך תמונה קיימת ומוגבל למה שכבר בפריים. למגרש
// אין "מצב קיים" לערוך — הדמיה שלו הייתה מציירת מבנה שלא תוכנן ולא אושר,
// כלומר מציגה זכויות בנייה שאיש לא התחייב אליהן. דף הנכס מציג לקרקע מידע
// תכנוני במקום הדמיה, והבדיקה חוזרת גם כאן כדי שהנקודה תיאכף בשרת ולא רק ב-UI.
//
// הביטוי זהה ל-TYPE_RULES ב-assets/specialties.js ול-LAND_TYPE_RE ב-HTML.
// ---------------------------------------------------------------------------
const LAND_TYPE_RE = /מגרש|קרקע|נחל|משק|חקלא/;

export function isLandType(propertyType: string | null): boolean {
  return !!propertyType && LAND_TYPE_RE.test(propertyType);
}

export type PrivateTarget = "exterior" | "living_room" | "kitchen";
export type CommercialTarget = "exterior" | "interior_main";

// התמונה שמזינה כל מטרה, לפי התיוג של classify-property-images
export const PRIVATE_TARGET_ROOMS: Record<PrivateTarget, string[]> = {
  exterior: ["facade", "yard"],
  living_room: ["living_room"],
  kitchen: ["kitchen"],
};

// ---------------------------------------------------------------------------
// קטלוג הסגנונות — מכוון לשוק הישראלי
//
// ארבעה סגנונות שמכסים את רוב טעם השוק: המודרני-נקי הוא ברירת המחדל ("איך
// זה ייראה אחרי שיפוץ קבלן"), הים-תיכוני הוא הסגנון המקומי המובהק, הסקנדינבי
// החמים הוא מה שמככב בפיד של קוני דירות צעירים, והיוקרה היא לנכסים היקרים.
//
// ‏key חייב להישאר יציב — הוא נשמר ב-property_visualizations.style_key ומהווה
// חלק ממפתח הייחודיות של הדמיה פרטית.
// ---------------------------------------------------------------------------
export type StyleKey = "modern_clean" | "mediterranean_white" | "warm_scandi" | "modern_luxury";

export const DEFAULT_STYLE: StyleKey = "modern_clean";

interface StyleDef {
  key: StyleKey;
  label: string;
  tagline: string;
  /** הנחיות הסגנון לכל מטרה — הטקסט שנדבק אחרי בלוק האיסורים */
  directives: Record<PrivateTarget, string>;
}

export const STYLES: Record<StyleKey, StyleDef> = {
  modern_clean: {
    key: "modern_clean",
    label: "מודרני נקי",
    tagline: "הקו של קבלן משודרג — לבן, אפור בהיר ואלון טבעי",
    directives: {
      exterior:
        "חיפוי חזית בטיח לבן-שמנת חלק, עם רצועות חיפוי אבן בהירה או קרמיקה דמוית בטון סביב הכניסה. " +
        "מעקות ומסגרות באלומיניום אפור כהה (RAL 7016). פרגולת אלומיניום ישרה מעל חנייה או מרפסת. " +
        "שביל כניסה באבן משתלבת אפורה בהירה בפורמט גדול, דשא מטופח משני צדדיו ותאורת קרקע שקועה. " +
        "דלת כניסה מודרנית בגוון עץ כהה או אפור גרפיט.",
      living_room:
        "קירות בלבן שבור, ריצוף גרניט פורצלן אפור בהיר בפורמט גדול (60×120) עם פוגות דקות. " +
        "ספה אפורה בהירה בקו ישר, שולחן סלון נמוך בשילוב עץ אלון ומתכת שחורה, שטיח גיאומטרי מינימלי. " +
        "יחידת טלוויזיה תלויה בגימור עץ אלון, תאורת LED שקועה בתקרה ותאורה עקיפה חמימה. " +
        "אביזרים מעטים ומדודים — חלל פתוח ולא עמוס.",
      kitchen:
        "ארונות מטבח בחזיתות חלקות ללא ידיות בלבן מט, יחידות תחתונות בגוון אלון טבעי. " +
        "משטח קוורץ לבן בעל גוון אחיד, חיפוי קיר בין הארונות מאותו חומר המשטח. " +
        "כיור גרניט אפור מונמך, ברז שחור מט, מכשירי חשמל מנירוסטה משולבים. " +
        "תאורת LED מתחת לארונות העליונים ותאורת פס מעל אי או משטח העבודה.",
    },
  },

  mediterranean_white: {
    key: "mediterranean_white",
    label: "ים-תיכוני לבן",
    tagline: "טיח לבן, אבן טבעית וקשתות — הקלאסיקה המקומית",
    directives: {
      exterior:
        "חזית בטיח לבן בגוון גירי עם מרקם ידני עדין, ושילוב אבן ירושלמית או אבן טבעית מנוסרת בבסיס ובעמודי הכניסה. " +
        "תריסים או מסגרות בגוון עץ טבעי או ירוק זית עמוק. פרגולת עץ עם צמחייה מטפסת (בוגנוויליה). " +
        "חצר עם ריצוף אבן טבעית בגוון חול, עצי זית בכדים גדולים, לבנדר ורוזמרין, וכדי חרס. " +
        "תאורת קיר חמימה בגוון ברונזה. אווירה של בית ים-תיכוני מטופח באור אחר הצהריים.",
      living_room:
        "קירות בטיח לבן בעל מרקם עדין, ריצוף אבן טבעית או קרמיקה בגוון חול-בז'. " +
        "ספה בבד פשתן לבן-שמנת, שולחן עץ מלא בגוון טבעי, סלסלות קש וכרים ברקמה עדינה. " +
        "אלמנטים מקומרים בגומחות או במעברים, אם קיימים כבר בחלל. " +
        "עציצי זית וקקטוסים, מנורות קש או קרמיקה, שטיח ברבר בגווני חול. " +
        "אור יום חם ורך, אווירה נינוחה ואוורירית.",
      kitchen:
        "ארונות בגוון לבן-שמנת עם חזיתות מסוגננות קלות וידיות פליז מוברש. " +
        "משטח אבן טבעית או קוורץ בגוון חול בהיר, חיפוי קיר באריחי קרמיקה מרובעים בגימור ידני (זליג'). " +
        "כיור קרמיקה לבן עמוק, ברז פליז. מדפים פתוחים מעץ טבעי עם כלי חרס וכדי זכוכית. " +
        "תאורת מנורות תלויות בקש או קרמיקה מעל האי או משטח העבודה.",
    },
  },

  warm_scandi: {
    key: "warm_scandi",
    label: "סקנדינבי חמים",
    tagline: "Japandi — עץ אלון, בז' רך וצמחייה",
    directives: {
      exterior:
        "חזית בטיח בגוון בז' חם או אפרפר-חול, עם חיפוי קרשי עץ אנכיים (או דמוי-עץ) סביב הכניסה. " +
        "מסגרות ומעקות בשחור מט דק. דק עץ טבעי בכניסה או במרפסת. " +
        "גינה בעיצוב רך — דשא, עשבי נוי גבוהים, אדניות עץ, שיחים בגוונים ירוקים-אפורים. " +
        "תאורת גן חמימה נמוכה, ספסל עץ ליד הכניסה. אווירה שקטה, טבעית ולא ראוותנית.",
      living_room:
        "קירות בבז' חם או לבן שמנת, פרקט עץ אלון בהיר ברוחב לוח גדול. " +
        "ספה בבד ארוג בגוון חול או חמרה בהירה, שולחן סלון עגול מעץ אלון, שטיח צמר עבה בגוון טבעי. " +
        "צמחייה ירוקה אמיתית בעציצי חרס (פיקוס למון, מונסטרה), מדף ספרים נמוך מעץ. " +
        "גימורים מטים בלבד — בלי ברק. תאורה עקיפה חמימה ומנורת רצפה בגוון פשתן. " +
        "מעט חפצים, הרבה אוויר, תחושה חמה ורגועה.",
      kitchen:
        "ארונות מטבח בחזיתות עץ אלון טבעי בשילוב יחידות בגוון חול מט, ידיות עץ או ללא ידיות. " +
        "משטח קוורץ בגוון אבן בהירה או עץ מלא באי. חיפוי קיר באריחי קרמיקה מטים בגוון שמנת. " +
        "כיור נירוסטה או קרמיקה לבן, ברז שחור מט. " +
        "מדף עץ פתוח אחד עם כלי קרמיקה בגווני טבע וצמח ירוק. " +
        "תאורה חמימה, אווירה ביתית ולא סטרילית.",
    },
  },

  modern_luxury: {
    key: "modern_luxury",
    label: "יוקרה מודרנית",
    tagline: "שיש, פליז ותאורה דרמטית — לנכסים היוקרתיים",
    directives: {
      exterior:
        "חזית בשילוב אבן טבעית מנוסרת בגוון בהיר עם אלמנטים בבטון אדריכלי חשוף. " +
        "מסגרות, מעקות ופרופילים באלומיניום שחור מט או ברונזה כהה. " +
        "דלת כניסה גבוהה בגימור עץ אגוז כהה או ברונזה, עם תאורת קו לינארית מוסתרת מסביבה. " +
        "שביל כניסה מאבן טבעית בפורמט גדול, גינון אדריכלי מדויק, עצי נוי מוארים מלמטה. " +
        "צילום בשעת בין ערביים עם תאורת חוץ דולקת — אווירה יוקרתית ומרשימה.",
      living_room:
        "קיר טלוויזיה בחיפוי שיש קלקטה או פורצלן דמוי שיש עם עורקים אפורים, בשילוב עץ אגוז כהה. " +
        "ריצוף פורצלן בגימור מלוטש בגוון בהיר. ספה מודולרית גדולה בגוון שמנת או אפור עמוק בבד קטיפתי. " +
        "שולחנות צד בפליז ושיש, שטיח בעל מרקם עשיר. " +
        "גופי תאורה עיצוביים — נברשת לינארית או מנורות תלויות בפליז. תאורה עקיפה בתקרה ובנישות. " +
        "אווירה מוקפדת, יוקרתית ומאופקת — לא ראוותנית.",
      kitchen:
        "ארונות בגימור לכה מבריקה בגוון כהה או עץ אגוז, בשילוב יחידות בלבן. " +
        "משטח ואי בשיש קלקטה או קוורץ עם עורקים בולטים, כולל חיפוי קיר מאותו החומר בחיתוך רציף. " +
        "ידיות ופרזול בפליז מוברש, ברז פליז, כיור מונמך. " +
        "מכשירי חשמל מובנים מנירוסטה מקצועית, מנורות תלויות מעל האי. " +
        "תאורת LED מוסתרת בכל הנישות. מראה של מטבח מעוצב אישית, יוקרתי ומדויק.",
    },
  },
};

export const STYLE_KEYS = Object.keys(STYLES) as StyleKey[];

export function isStyleKey(v: unknown): v is StyleKey {
  return typeof v === "string" && v in STYLES;
}

// ---------------------------------------------------------------------------
// בלוקי האיסורים
//
// זה החלק שקובע אם ההדמיה שימושית או מטעה. הוא נכתב בגוף ציווי, ממוספר,
// ותמיד מסתיים באותה הוראת ברירת מחדל: בספק — לא לגעת.
// ---------------------------------------------------------------------------
const INVARIANTS_INTERIOR =
  `זוהי תמונת פנים אמיתית של נכס למכירה. המשימה שלך היא עריכה שמרנית של הגימורים והריהוט — לא ציור של חלל חדש.\n\n` +
  `אסור בהחלט לשנות, להזיז, לשנות גודל, להוסיף או להסתיר:\n` +
  `- מיקום, גודל וצורה של כל חלון קיים\n` +
  `- מיקום, גודל וצורה של כל דלת ופתח קיים\n` +
  `- גובה התקרה, קורות, עמודים ומרכיבים מבניים גלויים\n` +
  `- מיקום הקירות, הפינות וקווי המתאר של החלל\n` +
  `- זווית הצילום, נקודת המבט והפרספקטיבה\n` +
  `- כמות ועוצמת אור היום הנכנס מהחלונות הקיימים\n` +
  `- מיקום ארון חשמל, מזגן מיני-מרכזי, ממ"ד או כל אלמנט קבוע אחר\n\n`;

const INVARIANTS_EXTERIOR_PRIVATE =
  `זוהי תמונת חוץ אמיתית של בית פרטי למכירה. המשימה שלך היא להראות את אותו הבית בדיוק אחרי שיפוץ חזית וגינון — לא בית אחר.\n\n` +
  `אסור בהחלט לשנות, להזיז, לשנות גודל, להוסיף או להסיר:\n` +
  `- כל חלון קיים — מיקומו, גודלו, צורתו וכמותו\n` +
  `- כל דלת, כניסה או פתח קיים — מיקומם, גודלם וצורתם\n` +
  `- קווי המתאר של הבית, מספר הקומות, הגובה והפרופורציות\n` +
  `- צורת הגג ושיפועיו, מרפסות, בליטות וגגונים קיימים\n` +
  `- זווית הצילום, נקודת המבט, הרקע (רחוב, שמיים, בתים שכנים) ותוואי הקרקע\n` +
  `- דוד שמש, קולטים, מזגנים ומתקנים קבועים אחרים — הם חלק מהנכס ואסור להעלים אותם\n\n` +
  `מותר לשנות אך ורק גימור וסביבה, בלי לגעת במבנה:\n` +
  `- חיפוי וצבע החזית, חיפוי אבן, גוון המסגרות והמעקות\n` +
  `- החלפת דלת הכניסה באותו פתח בדיוק, בלי לשנות את מידותיו\n` +
  `- גינון, ריצוף חצר, דק, פרגולה מעל שטח פתוח קיים ותאורת חוץ\n` +
  `- פינוי חפצים ניידים בלבד (פחי אשפה, צינורות, רכבים חונים, גרוטאות)\n\n`;

const INVARIANTS_EXTERIOR_COMMERCIAL =
  `זוהי תמונת חוץ אמיתית של נכס מסחרי. המשימה שלך היא עריכה שמרנית בלבד — לא ציור מחדש של הבניין.\n\n` +
  `אסור בהחלט לשנות, להזיז, לשנות גודל, או להוסיף:\n` +
  `- כל חלון קיים — מיקומו, גודלו, צורתו וכמותו\n` +
  `- כל דלת או כניסה קיימת — מיקומה, גודלה וצורתה\n` +
  `- קווי המתאר, הגובה והפרופורציות של הבניין\n` +
  `- זווית הצילום, נקודת המבט, והרקע (רחוב, שמיים, מבנים שכנים)\n` +
  `- חומרי הבנייה והחזית הקיימים\n\n`;

const CLOSING_RULE =
  `אם יש לך ספק אם שינוי מסוים משנה את המבנה — אל תבצע אותו. ` +
  `התוצאה חייבת להיראות כמו צילום אמיתי של אותו נכס בדיוק, מאותה הזווית, רק אחרי שיפוץ ועיצוב — ` +
  `לא איור, לא רינדור אמנותי ולא נכס אחר. שמור על רזולוציה גבוהה ואיכות צילום אדריכלי.`;

// ---------------------------------------------------------------------------
// בניית הפרומפט — נכס פרטי
// ---------------------------------------------------------------------------
export function buildPrivatePrompt(
  target: PrivateTarget,
  style: StyleKey,
  ctx: { propertyType?: string | null; sizeSqm?: number | null; rooms?: number | null }
): string {
  const def = STYLES[style];
  const invariants = target === "exterior" ? INVARIANTS_EXTERIOR_PRIVATE : INVARIANTS_INTERIOR;

  const allowed =
    target === "exterior"
      ? ""
      : `מותר לשנות אך ורק:\n` +
        `- ריהוט — להחליף, להוסיף או להסיר\n` +
        `- גימור משטחים: צבע קיר, ריצוף, חיפוי ארונות ומשטחי עבודה, בלי לשנות את מידות החלל\n` +
        `- ארונות מטבח ומכשירי חשמל, במיקום הקיים של נקודות המים והחשמל\n` +
        `- תאורה מלאכותית נוספת — בלי להסתיר או להזיז חלונות\n` +
        `- אביזרי עיצוב: שטיחים, וילונות, צמחייה, תמונות\n\n`;

  const sizeLine = ctx.sizeSqm ? `שטח הנכס כ-${ctx.sizeSqm} מ"ר` : "";
  const roomsLine = ctx.rooms ? `${ctx.rooms} חדרים` : "";
  const typeLine = ctx.propertyType ? `סוג הנכס: ${ctx.propertyType}` : "";
  const context = [typeLine, roomsLine, sizeLine].filter(Boolean).join(" · ");
  const contextBlock = context ? `נתוני הנכס לצורך פרופורציות נכונות: ${context}.\n\n` : "";

  return (
    invariants +
    allowed +
    `הסגנון המבוקש — "${def.label}":\n${def.directives[target]}\n\n` +
    contextBlock +
    CLOSING_RULE
  );
}

// ---------------------------------------------------------------------------
// בניית הפרומפט — נכס מסחרי (הועתק מ-business-visualizer של אפולה)
// ---------------------------------------------------------------------------
export function buildCommercialPrompt(
  target: CommercialTarget,
  businessType: string,
  businessDescription: string,
  sizeSqm: number | null
): string {
  const sizeLine = sizeSqm ? `שטח הנכס הוא כ-${sizeSqm} מ"ר — קח את הפרופורציות האמיתיות האלה בחשבון.\n` : "";
  const desc = businessDescription || "ללא תיאור נוסף";

  if (target === "exterior") {
    return (
      INVARIANTS_EXTERIOR_COMMERCIAL +
      `מותר לשנות אך ורק, ורק מעל או סביב פתחים קיימים — בלי לחסום אותם:\n` +
      `- הוספת שילוט מתאים לעסק מסוג "${businessType}" (${desc})\n` +
      `- הוספת ויטרינה או תצוגה בכניסה, בלי לשנות את מידות הפתח עצמו\n` +
      `- אלמנטים חיצוניים קטנים: מרקיזה, תאורת שילוט\n\n` +
      sizeLine +
      CLOSING_RULE
    );
  }

  return (
    INVARIANTS_INTERIOR +
    `מותר לשנות אך ורק:\n` +
    `- ריהוט — להחליף, להוסיף או להסיר\n` +
    `- ציוד מתאים לעסק מסוג "${businessType}" (${desc})\n` +
    `- גימור משטחים: צבע קיר, חיפוי רצפה — בלי לשנות את מידותיהם\n` +
    `- תאורה מלאכותית נוספת — בלי להסתיר או להזיז חלונות\n\n` +
    sizeLine +
    CLOSING_RULE
  );
}

// ---------------------------------------------------------------------------
// קריאה ל-Gemini
// ---------------------------------------------------------------------------
type GenResult = { ok: true; mime: string; data: string } | { ok: false; reason: string };

export async function fetchAsBase64(url: string): Promise<{ mime: string; data: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    // המרה במנות — המרה תו-אחר-תו על תמונה של כמה מגה איטית מאוד,
    // ו-String.fromCharCode(...bytes) על מערך גדול מפוצץ את המחסנית.
    let bin = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return { mime: res.headers.get("content-type") || "image/jpeg", data: btoa(bin) };
  } catch {
    return null;
  }
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function generateOnce(apiKey: string, mime: string, data: string, prompt: string): Promise<GenResult> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ inline_data: { mime_type: mime, data } }, { text: prompt }] }],
        // temperature נמוכה בכוונה: אנחנו רוצים עריכה צייתנית, לא יצירתיות.
        generationConfig: { responseModalities: ["IMAGE"], temperature: 0.2 },
      }),
    }
  );

  if (!res.ok) {
    let bodyText = "";
    try {
      bodyText = (await res.text()).slice(0, 300);
    } catch {
      /* noop */
    }
    return { ok: false, reason: `HTTP ${res.status}${bodyText ? `: ${bodyText}` : ""}` };
  }

  const json = await res.json();
  for (const part of json?.candidates?.[0]?.content?.parts ?? []) {
    const inline = part.inlineData || part.inline_data;
    if (inline?.data) {
      return { ok: true, mime: inline.mimeType || inline.mime_type || "image/png", data: inline.data };
    }
  }
  const finish = json?.candidates?.[0]?.finishReason || json?.promptFeedback?.blockReason;
  return { ok: false, reason: finish ? `אין תמונה בתגובה (${finish})` : "אין תמונה בתגובה" };
}

/** שלושה ניסיונות — Gemini מחזיר מדי פעם תשובה בלי תמונה גם על קלט תקין. */
export async function generateImage(
  apiKey: string,
  mime: string,
  data: string,
  prompt: string
): Promise<GenResult> {
  const delays = [2000, 5000];
  let last = await generateOnce(apiKey, mime, data, prompt);
  if (last.ok) return last;

  const reasons = [last.reason];
  for (const delay of delays) {
    await new Promise((r) => setTimeout(r, delay));
    last = await generateOnce(apiKey, mime, data, prompt);
    if (last.ok) return last;
    reasons.push(last.reason);
  }
  return { ok: false, reason: reasons.map((r, i) => `ניסיון ${i + 1}: ${r}`).join(" | ") };
}

// ---------------------------------------------------------------------------
// סיווג תמונה — משמש את classify-property-images
// ---------------------------------------------------------------------------
export interface PhotoTags {
  photo_type: "exterior" | "interior" | "unknown";
  space_role: "main" | "auxiliary" | "unclassified";
  room_type: string | null;
}

/**
 * ‏"התמונה לא ברורה" ו"הקריאה ל-Gemini נכשלה" הן שתי תוצאות שונות לגמרי,
 * ועד עכשיו שתיהן נראו אותו דבר: unknown/unclassified/null. ההבדל אינו
 * אקדמי — תמונה לא ברורה סווגה ונגמר, ואילו קריאה שנכשלה נשמרה עם
 * ‏classified_at ולכן *לעולם* לא נוסתה שוב, גם אחרי שהתקלה תוקנה.
 *
 * לכן `error` מוחזר בנפרד, והקוראים לא כותבים classified_at כשהוא קיים.
 */
export type ClassifyOutcome = PhotoTags & { error?: string };

const ROOM_TYPES = ["facade", "yard", "living_room", "kitchen", "bedroom", "bathroom", "balcony", "other"];

export async function classifyImage(apiKey: string, mime: string, data: string): Promise<ClassifyOutcome> {
  const prompt =
    'זוהי תמונה של נכס נדל"ן. ענה בדיוק בפורמט TYPE,ROLE,ROOM באנגלית בלבד, בלי רווחים ובלי הסבר.\n' +
    "TYPE: exterior אם התמונה צולמה מבחוץ (חזית, כניסה, חצר, גינה, חניה, רחוב), interior אם מבפנים.\n" +
    "ROLE: main אם זה החלל המרכזי של הנכס (סלון, חלל מכירה או עבודה פתוח, משרד ראשי), " +
    "auxiliary אם זה חלל עזר (מסדרון, חדר מדרגות, מעלית, שירותים, מחסן, מטבחון). לתמונות exterior תמיד main.\n" +
    `ROOM: אחד מ-${ROOM_TYPES.join("/")} בלבד. facade לחזית בניין או בית, yard לחצר/גינה/חניה, ` +
    "living_room לסלון או פינת ישיבה מרכזית, kitchen למטבח, bedroom לחדר שינה, bathroom לשירותים או מקלחת, " +
    "balcony למרפסת, other לכל השאר.\n" +
    "דוגמאות תקינות: interior,main,living_room · exterior,main,facade · interior,auxiliary,bathroom\n" +
    "אם התמונה לא ברורה — ענה unknown,unclassified,other";

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ inline_data: { mime_type: mime, data } }, { text: prompt }] }],
        // ‏maxOutputTokens היה 20 — התשובה עצמה היא שלוש מילים, אז זה נראה
        // נדיב. זה היה נכון למודל שלא חושב. ‏gemini-3.1-flash-lite הוא מודל
        // חושב (thinking: true ב-ListModels), והתקציב הזה *כולל* את החשיבה:
        // המודל שרף את 20 הטוקנים לפני שכתב תו אחד, החזיר 200 עם טקסט ריק,
        // וכל תמונה סווגה unknown. התקרה כאן רחבה בכוונה — עלות אמיתית היא
        // לפי מה שנוצר בפועל, והתשובה נשארת שלוש מילים.
        generationConfig: { temperature: 0, maxOutputTokens: 2048 },
      }),
    }
  );

  // מודל שגוי (404), מכסה (429) או מפתח פסול (403) חוזרים כאן. הגוף נשמר כי
  // הוא זה שאומר *מה* קרה, וההבדל בין השלושה הוא ההבדל בין תיקון של דקה
  // לבין חיפוש עיוור.
  if (!res.ok) {
    let bodyText = "";
    try {
      bodyText = (await res.text()).slice(0, 300);
    } catch {
      /* noop */
    }
    return {
      photo_type: "unknown",
      space_role: "unclassified",
      room_type: null,
      error: `HTTP ${res.status}${bodyText ? `: ${bodyText}` : ""}`,
    };
  }

  const json = await res.json();
  // כל החלקים ולא parts[0]: מודל חושב מחזיר לפעמים חלק של מחשבה לפני
  // התשובה, ואז parts[0] אינו הסיווג אלא ההסבר לעצמו.
  const text = (json?.candidates?.[0]?.content?.parts ?? [])
    .map((part: any) => part?.text ?? "")
    .join(" ")
    .toLowerCase()
    .trim();

  // תשובה ריקה אינה "תמונה לא ברורה" אלא קריאה שלא החזירה כלום — בדרך כלל
  // תקציב טוקנים שנגמר. ‏finishReason הוא מה שאומר את זה, ובלעדיו החיפוש
  // הזה היה מתחיל מאפס.
  if (!text) {
    const finish = json?.candidates?.[0]?.finishReason || json?.promptFeedback?.blockReason;
    return {
      photo_type: "unknown",
      space_role: "unclassified",
      room_type: null,
      error: `תשובה ריקה מ-${VISION_MODEL}${finish ? ` (${finish})` : ""}`,
    };
  }

  const photo_type = text.includes("exterior") ? "exterior" : text.includes("interior") ? "interior" : "unknown";
  const space_role = text.includes("auxiliary") ? "auxiliary" : text.includes("main") ? "main" : "unclassified";
  // living_room מכיל את המחרוזת room ולכן הבדיקה חייבת להיות על ההתאמה הארוכה ביותר
  const room =
    ROOM_TYPES.slice()
      .sort((a, b) => b.length - a.length)
      .find((r) => text.includes(r)) ?? null;

  return {
    photo_type,
    // תמונת חוץ היא תמיד החלל המרכזי — אין "חצר עזר"
    space_role: photo_type === "exterior" ? "main" : space_role,
    room_type: room,
  };
}

/**
 * מוודא שכל תמונות הנכס מתויגות, ומחזיר את התיוגים.
 *
 * נקרא בתחילת כל בקשת הדמיה: בלי תיוג אין דרך לדעת איזו תמונה היא המטבח
 * ואיזו הסלון, וזה הופך את הסיווג לחלק מהזרימה במקום ל-cron נפרד שאפשר לשכוח
 * להריץ. תמונות שכבר תויגו לא נשלחות שוב — הסיווג עולה כסף.
 */
export async function ensureTagged(
  supabase: any,
  apiKey: string,
  propertyId: string,
  images: string[]
): Promise<Array<{ image_url: string } & PhotoTags>> {
  if (images.length > 0) {
    await supabase
      .from("property_image_tags")
      .upsert(
        images.map((image_url) => ({ property_id: propertyId, image_url })),
        { onConflict: "property_id,image_url", ignoreDuplicates: true }
      );
  }

  const { data: rows } = await supabase
    .from("property_image_tags")
    .select("id, image_url, photo_type, space_role, room_type, classified_at")
    .eq("property_id", propertyId)
    .in("image_url", images.length ? images : [""]);

  const pending = (rows ?? []).filter((r: any) => !r.classified_at);
  const BATCH = 5;
  for (let i = 0; i < pending.length; i += BATCH) {
    await Promise.all(
      pending.slice(i, i + BATCH).map(async (row: any) => {
        const img = await fetchAsBase64(row.image_url);
        if (!img) return;
        const { error: classifyErr, ...tags } = await classifyImage(apiKey, img.mime, img.data);
        // קריאה שנכשלה נשארת ללא classified_at ותנוסה שוב בבקשה הבאה,
        // במקום להיקבע כ-unknown לתמיד.
        if (classifyErr) {
          console.error(`סיווג נכשל ל-${row.image_url}: ${classifyErr}`);
          return;
        }
        Object.assign(row, tags);
        await supabase
          .from("property_image_tags")
          .update({ ...tags, classified_at: new Date().toISOString(), model: VISION_MODEL })
          .eq("id", row.id);
      })
    );
  }

  return (rows ?? []) as Array<{ image_url: string } & PhotoTags>;
}

/**
 * בוחר את תמונת המקור לכל מטרה.
 *
 * ‏exterior בנכס פרטי מעדיף חזית על חצר: הדמיית חזית מוכרת את הבית, הדמיית
 * חצר מוכרת גינה. כשאין תמונה מתאימה המטרה פשוט יורדת — עדיף שתי הדמיות
 * אמיתיות מאשר שלוש כשאחת מהן נגזרה מתמונה של חדר אחר.
 */
export function pickPrivateSources(
  tags: Array<{ image_url: string } & PhotoTags>,
  targets: PrivateTarget[]
): Partial<Record<PrivateTarget, string>> {
  const out: Partial<Record<PrivateTarget, string>> = {};
  for (const target of targets) {
    for (const room of PRIVATE_TARGET_ROOMS[target]) {
      const hit = tags.find((t) => t.room_type === room);
      if (hit) {
        out[target] = hit.image_url;
        break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// שמירת התוצאה
// ---------------------------------------------------------------------------
export async function uploadResult(
  supabase: any,
  path: string,
  mime: string,
  b64: string
): Promise<string | null> {
  const { error } = await supabase.storage
    .from(VISUALIZATION_BUCKET)
    .upload(path, base64ToBytes(b64), { contentType: mime, upsert: true });
  if (error) return null;
  const { data } = supabase.storage.from(VISUALIZATION_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export interface WorkItem {
  rowId: string;
  target: string;
  sourceUrl: string;
  prompt: string;
}

/**
 * מריץ בקשת הדמיה שלמה ומעדכן את השורות תוך כדי.
 *
 * משותף ל-property-visualize ול-property-visualize-base בכוונה: אלה שני
 * מסלולי כניסה שונים (גולש/ת מול סוכן/ת) לאותה עבודה בדיוק, וכל הבדל ביניהם
 * היה מתגלה כהבדל באיכות ההדמיה בין סט הבסיס לבין מה שהגולש/ת מבקש/ת.
 *
 * הפונקציה לא זורקת: כישלון של מטרה אחת נרשם בשורה שלה וממשיכים הלאה, כדי
 * שהדמיית מטבח שנכשלה לא תמחק גם את הסלון שהצליח.
 */
export async function runVisualizationJob(
  supabase: any,
  apiKey: string,
  jobId: string,
  items: WorkItem[]
): Promise<{ done: number; failed: number }> {
  let done = 0;
  let failed = 0;

  async function fail(rowId: string, detail: string) {
    failed++;
    await supabase
      .from("property_visualizations")
      .update({ status: "failed", error_detail: detail.slice(0, 500) })
      .eq("id", rowId);
  }

  // שלוש בבת אחת: מספיק מהר למי שמחכה, ולא מספיק כדי לחטוף 429 מ-Gemini.
  const BATCH = 3;
  for (let i = 0; i < items.length; i += BATCH) {
    await Promise.all(
      items.slice(i, i + BATCH).map(async (item) => {
        await supabase.from("property_visualizations").update({ status: "processing" }).eq("id", item.rowId);

        const src = await fetchAsBase64(item.sourceUrl);
        if (!src) return fail(item.rowId, "לא ניתן היה לטעון את התמונה המקורית");

        const result = await generateImage(apiKey, src.mime, src.data, item.prompt);
        if (!result.ok) return fail(item.rowId, result.reason);

        const ext = result.mime.includes("png") ? "png" : "jpg";
        const url = await uploadResult(supabase, `${jobId}/${item.rowId}.${ext}`, result.mime, result.data);
        if (!url) return fail(item.rowId, "שגיאה בשמירת התוצאה");

        await supabase
          .from("property_visualizations")
          .update({ status: "done", result_url: url, error_detail: null })
          .eq("id", item.rowId);
        done++;
      })
    );
  }

  await supabase
    .from("visualization_jobs")
    .update({
      status: done > 0 ? "done" : "failed",
      error_detail: done === 0 ? "כל ההדמיות בבקשה נכשלו" : null,
    })
    .eq("id", jobId);

  return { done, failed };
}

export function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

export function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: corsHeaders() });
}
