/* ============================================================================
   ליבת ייבוא הנכסים מקובץ - קוד אחד לדפדפן ולשרת (docs/property-import.md)

   האשף ב-CRM (‏assets/crm.js) והייבוא דרך גבריאלה בוואטסאפ
   (‏whatsapp-webhook/property-import.ts) מריצים את אותו הקוד בדיוק: מיפוי
   הכותרות, בניית שורה, הודעות הדחייה ומה לעשות, כפילויות, ועדכון בייבוא חוזר.
   שני עותקים של לוגיקה כזו נפרדים תוך שבוע - כך קרה כאן לרשימת העמודות של
   הייצוא, ולכפילות בטופס מול הבוט.

   **הקובץ קיים פעמיים, זהה בבית:** ‏assets/property-import-core.js (נטען ב-
   crm.html לפני crm.js) ו-supabase/functions/_shared/property-import-core.js
   (נטען בשרת כ-import לצד-אפקט). פונקציית Edge אינה יכולה לייבא קובץ מחוץ
   ל-supabase/functions, ו-Netlify אינו מגיש את supabase/. ‏
   scripts/check_import_core.py חוסם ב-CI שני עותקים שונים - עורכים את
   assets/ ומעתיקים.

   סקריפט רגיל ולא מודול: ב-CRM כל הקוד הוא סקריפטים רגילים, ובשרת `import`
   של קובץ שאינו מייצא דבר מריץ אותו ומשאיר את globalThis.PropertyImportCore.

   אוצר המילים (סוגי נכס ומאפיינים) אינו כאן: כל צד מעביר את הרשימות שכבר
   יש לו (‏configure), כדי שזו לא תהיה רשימה מקבילה שלוש-עשרה.

   מצב השורות (‏S) - מה שהאשף מחזיק ב-importState, ובשרת נבנה מהמסד:
     mapping, overrides, featureColumns, yad2, yad2Agent1, hoodAliases,
     yad2Taken (‏Map מספר → שם, אצל עמיתים), ownByYad2 (‏Map מספר → הנכס שלי),
     existingKeys, parsed, neighborhoods, canonicalStreet(name, city),
     agent { id, agency_id, phone }, maxImages, today ('yyyy-mm-dd').
   ============================================================================ */
(function(root){
'use strict';

/* אוצר המילים, מ-configure(). ‏features: [[קוד, תווית], ...] */
const V = { residentialTypes: [], commercialTypes: [], features: [] };
function configure(vocab){
  V.residentialTypes = vocab.residentialTypes || [];
  V.commercialTypes = vocab.commercialTypes || [];
  V.features = vocab.features || [];
  impFeatureMapCache = null;
}

function plural(n, one, many){ return n === 1 ? one : n + ' ' + many; }
/* כמו hoodCityKey ב-crm.js: רווחים, יו"ד כפולה ווי"ו כפולה */
function hoodCityKey(s){
  return String(s || '').trim().replace(/\s+/g, ' ').replace(/יי/g, 'י').replace(/וו/g, 'ו');
}

/* השדות שניתן לייבא. aliases = כותרות שהמיפוי האוטומטי מזהה בקובץ. */
const IMPORT_FIELDS = [
  // כותרת אינה חובה בקובץ: קבצי ייצוא רבים מזהים מודעה לפי כתובת ולא לפי
  // כותרת, ולכן כשהעמודה חסרה נבנית כותרת מסוג הנכס, החדרים והכתובת.
  { key:'title', label:'כותרת', hint:'אם ריק - תיווצר כותרת אוטומטית מסוג הנכס והכתובת', aliases:['כותרת','שם','שם הנכס','כותרת המודעה','title','name'] },
  { key:'status', label:'סטטוס', hint:'פעיל / נמכר / הושכר / לא פעיל - ברירת מחדל: פעיל', aliases:['סטטוס','מצב מודעה','status'] },
  { key:'category', label:'קטגוריה', hint:'מגורים / מסחרי - ברירת מחדל: מגורים', aliases:['קטגוריה','category'] },
  // בלי הכינוי "מספר מודעה" לבדו: בייצוא שלנו זה listing_number. בקובץ של
  // יד2 העמודה ממופה לכאן מפורשות (impReadFile).
  { key:'yad2_listing_id', label:'מספר מודעה ביד2', hint:'מודעה של יד2 נקלטת פעם אחת למשרד', aliases:['מספר מודעה ביד2','מספר מודעה ביד 2','מספר מודעה יד2','yad2_listing_id'] },
  { key:'property_type', label:'סוג נכס', required:true, aliases:['סוג נכס','סוג הנכס','סוג','property_type','type'] },
  { key:'deal_type', label:'סוג עסקה', required:true, hint:'מכירה / השכרה', aliases:['סוג עסקה','עסקה','deal_type','deal','מכירה השכרה'] },
  { key:'price', label:'מחיר', required:true, aliases:['מחיר','מחיר מבוקש','price','מחיר בשח'] },
  { key:'city', label:'עיר', required:true, aliases:['עיר','ישוב','יישוב','city'] },
  { key:'rooms', label:'חדרים', aliases:['חדרים','מספר חדרים','חד','rooms'] },
  { key:'neighborhood', label:'שכונה', hint:'חייבת להיות שכונה שקיימת ברשימת הפלטפורמה', aliases:['שכונה','neighborhood'] },
  { key:'sales_area', label:'איזור מכירה', aliases:['איזור מכירה','אזור מכירה','איזור','אזור','sales_area','area'] },
  { key:'street', label:'רחוב', aliases:['רחוב','כתובת','street','address'] },
  // בלי הכינוי "מספר" לבדו: בקבצי ייצוא הוא כמעט תמיד "מספר מודעה"/"מספר נכס",
  // וההתאמה הרכה הייתה מכניסה מזהה מודעה לתוך הכתובת.
  { key:'house_number', label:'מספר בית', aliases:['מספר בית','מס בית','house number','house_number'] },
  { key:'floor', label:'קומה', aliases:['קומה','floor'] },
  { key:'total_floors', label:'מספר קומות', aliases:['מספר קומות','קומות','סה"כ קומות','total_floors','floors'] },
  { key:'size_sqm', label:'גודל במ"ר', aliases:['גודל','שטח','מ"ר','גודל במ"ר','שטח במ"ר','size','size_sqm'] },
  { key:'built_size_sqm', label:'מ"ר בנוי', aliases:['מ"ר בנוי','שטח בנוי','בנוי','built_size_sqm'] },
  { key:'garden_sqm', label:'מ"ר גינה', aliases:['מ"ר גינה','שטח גינה','גינה','garden_sqm','garden'] },
  // עלויות שוטפות: הייצוא בונה את עמודותיו מהרשימה הזו, ולכן קובץ שירד
  // עולה בחזרה עם שתיהן. הארנונה בסכום שבשובר - תקופת החיוב נגזרת
  // מהקטגוריה (docs/property-form.md).
  { key:'maintenance_fee', label:'ועד בית (₪ לחודש)', aliases:['ועד בית (₪ לחודש)','ועד בית','ועד','דמי ניהול','maintenance_fee'] },
  { key:'arnona', label:'ארנונה (₪)', hint:'לחודשיים במגורים, לחודש במסחרי', aliases:['ארנונה (₪)','ארנונה','arnona'] },
  { key:'description', label:'תיאור המודעה', aliases:['תיאור','תיאור המודעה','פירוט','הערות','description','notes'] },
  { key:'condition', label:'מצב הנכס', hint:'מגורים בלבד', aliases:['מצב','מצב הנכס','condition'] },
  { key:'project_status', label:'סטטוס הפרויקט', aliases:['סטטוס פרויקט','סטטוס הפרויקט','project_status'] },
  { key:'move_in_date', label:'תאריך כניסה', aliases:['תאריך כניסה','כניסה','תאריך פינוי','move_in_date'] },
  { key:'move_in_soon', label:'כניסה קרובה', hint:'כן / לא', aliases:['כניסה קרובה','כניסה מיידית','move_in_soon'] },
  { key:'listing_expires_at', label:'תוקף המודעה', aliases:['תוקף','תוקף המודעה','תפוגה','listing_expires_at','expires'] },
  { key:'features', label:'מאפיינים', hint:'מופרדים בפסיק', aliases:['מאפיינים','תוספות','מאפייני הנכס','features'] },
  // בלי הכינוי "ריהוט" לבדו: בקבצים רבים זו עמודת כן/לא שנקראת כמאפיין
  { key:'furniture_details', label:'פירוט ריהוט', aliases:['פירוט ריהוט','furniture_details'] },
  { key:'restrooms_location', label:'שירותים', hint:'מסחרי בלבד · בבניין / בנכס', aliases:['שירותים','restrooms_location'] },
  { key:'storage_location', label:'מחסן', hint:'מסחרי בלבד · בבניין / בנכס', aliases:['מחסן','storage_location'] },
  { key:'mamad_location', label:'ממ"ד', hint:'מסחרי בלבד · בבניין / בנכס', aliases:['ממ"ד','ממד','mamad_location'] },
  { key:'lat', label:'קו רוחב (lat)', aliases:['lat','קו רוחב','latitude'] },
  { key:'lng', label:'קו אורך (lng)', aliases:['lng','קו אורך','longitude'] },
  // ‏marketing_image לפני images בכוונה: המיפוי האוטומטי תופס כל כותרת פעם
  // אחת בלבד, והתאמה רכה של "תמונה" הייתה חוטפת את "תמונה שיווקית" לגלריה.
  { key:'marketing_image', label:'תמונה שיווקית', hint:'כתובת מלאה אחת', aliases:['תמונה שיווקית','marketing_image'] },
  // סדר הכינויים הוא סדר עדיפות: עמודת הגלריה חייבת להופיע לפני "תמונה
  // ראשית", אחרת בקובץ שיש בו את שתיהן הגלריה נשארת בלי מיפוי והתמונות אובדות.
  { key:'images', label:'קישורי תמונות', hint:'כתובות מלאות, מופרדות בפסיק', aliases:['כל התמונות (קישורים)','תמונות (כל הקישורים)','כל התמונות','קישורי תמונות','תמונות','תמונה ראשית','תמונה','images','image'] },
  { key:'tour_3d_url', label:'קישור לסיור וירטואלי', hint:'כתובת מלאה אחת', aliases:['קישור לסיור וירטואלי','סיור וירטואלי','סיור 3d','tour_3d_url','tour_url'] },
  { key:'video_url', label:'קישור לסרטון', hint:'כתובת מלאה אחת', aliases:['קישור לסרטון','סרטון','וידאו','video','video_url'] },
  { key:'marketing_description', label:'תיאור שיווקי', aliases:['תיאור שיווקי','marketing_description'] },
  { key:'post_text', label:'טקסט פוסט', aliases:['טקסט פוסט','פוסט','post','post_text'] },
  { key:'agent2_name', label:'סוכן 2', aliases:['סוכן 2','סוכן שני','agent2','agent2_name'] },
  { key:'agent2_phone', label:'טלפון 2', aliases:['טלפון 2','נייד 2','agent2_phone'] },
  { key:'owner_name', label:'בעלים - שם', hint:'פנימי · לא מוצג באתר', aliases:['בעלים','שם בעלים','owner','owner_name'] },
  { key:'owner_phone', label:'בעלים - טלפון', hint:'פנימי · לא מוצג באתר', aliases:['טלפון בעלים','נייד בעלים','owner_phone'] },
];

/* נרמול לצורך השוואה: גרשיים בכל הווריאציות, סימני כיווניות, מפרידים
   וכוכביות (בתבנית שדה חובה מסומן ב-*) — כדי ש-"מ״ר", "מ\"ר" ו-"מר"
   ייחשבו לאותו דבר. */
function impNorm(v){
  return String(v == null ? '' : v)
    .replace(/["'`״׳“”‘’*]/g, '')
    .replace(/[\u200e\u200f\u202a-\u202e]/g, '')
    .replace(/[_\-\/\\.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim().toLowerCase();
}

function impText(v){
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toLocaleDateString('he-IL');
  return String(v).replace(/[\u200e\u200f]/g, '').trim();
}

/* מספרים מגיעים מהגיליון גם כ-"₪ 1,250,000" או "‎3.5 חד'". */
function impNumber(v){
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = impText(v);
  if (!s) return null;
  const cleaned = s.replace(/[^\d.,\-]/g, '').replace(/,/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  return isFinite(n) ? n : null;
}

/* מחיר מכירה נכתב בפי סוכנים במיליונים — "1.48" הוא ‏1,480,000 ₪. בלי
   ההמרה הנכס נשמר ב-₪1.48, מוצג כך, ונופל מכל חיפוש עם טווח מחירים (כך
   עלו 14 נכסים מקובץ אחד, מיגרציה 20270315090000). מתחת ל-100 אין מחיר
   מכירה אמיתי, ולכן אין כאן ניחוש: השכרה אינה מומרת לעולם. */
const SALE_PRICE_MILLIONS_BELOW = 100;
function salePriceFromMillions(price, deal){
  if (deal !== 'sale' || !(price > 0) || price >= SALE_PRICE_MILLIONS_BELOW) return price;
  return Math.round(price * 1000000);
}

const IMP_TRUE_WORDS = ['כן','true','yes','1','v','✓','y','נכון','כן!'];
// ‏"ללא" הוא הערך השלילי בייצוא של יד2 בכל עמודות המאפיינים
const IMP_FALSE_WORDS = ['לא','ללא','אין','false','no','0','n','שגוי'];
function impBool(v){
  if (typeof v === 'boolean') return v;
  const s = impNorm(v);
  if (!s) return null;
  if (IMP_TRUE_WORDS.includes(s)) return true;
  if (IMP_FALSE_WORDS.includes(s)) return false;
  return undefined;   // לא ניתן לפענוח — מבדיל מ-null ("ריק")
}

function impPad(n){ return String(n).padStart(2, '0'); }
/* מחזירה 'yyyy-mm-dd', או null אם ריק, או undefined אם לא ניתן לפענוח. */
function impDate(v){
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !isNaN(v)){
    // ‏getters מקומיים ולא toISOString — SheetJS בונה את התאריך בשעון המקומי,
    // ו-toISOString היה מזיז יום אחורה בישראל.
    return `${v.getFullYear()}-${impPad(v.getMonth() + 1)}-${impPad(v.getDate())}`;
  }
  const s = impText(v);
  if (!s) return null;
  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);          // dd/mm/yyyy
  if (m){
    const year = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${year}-${impPad(m[2])}-${impPad(m[1])}`;
  }
  m = s.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);                  // yyyy-mm-dd
  if (m) return `${m[1]}-${impPad(m[2])}-${impPad(m[3])}`;
  return undefined;
}

const IMP_CATEGORY = {
  'מגורים':'residential','residential':'residential','פרטי':'residential','private':'residential',
  'מסחרי':'commercial','מסחר':'commercial','עסקי':'commercial','commercial':'commercial',
};
const IMP_DEAL = {
  'מכירה':'sale','למכירה':'sale','מכר':'sale','sale':'sale','sell':'sale',
  'השכרה':'rent','להשכרה':'rent','שכירות':'rent','rent':'rent','rental':'rent',
};
const IMP_CONDITION = {
  'חדש מקבלן':'new_from_contractor','מקבלן':'new_from_contractor','new_from_contractor':'new_from_contractor',
  'חדש':'new','new':'new',
  'משופץ':'renovated','משופצת':'renovated','renovated':'renovated',
  'שמור':'maintained','במצב שמור':'maintained','maintained':'maintained',
  'דרוש שיפוץ':'needs_renovation','זקוק לשיפוץ':'needs_renovation','needs_renovation':'needs_renovation',
};
/* סדר המילים הנרדפות אינו משנה לייבוא (זו שליפה לפי מפתח), אבל כן לייצוא:
   ‏expReverse() לוקחת את המילה העברית הראשונה לכל קוד, ולכן הראשונה חייבת
   להיות זו שמופיעה בטופס — "תכנון ראשוני" ולא "תכנון". */
const IMP_PROJECT_STATUS = {
  'תכנון ראשוני':'planning','תכנון':'planning','planning':'planning',
  'הוגשה בקשה להיתר':'permit_requested','בקשה להיתר':'permit_requested','permit_requested':'permit_requested',
  'ניתן היתר בנייה':'permit_issued','יש היתר':'permit_issued','היתר':'permit_issued','permit_issued':'permit_issued',
  'הבנייה הסתיימה':'construction_complete','הסתיימה':'construction_complete','construction_complete':'construction_complete',
};
/* ‏"חדש (נכס בן עד 10 שנים)" - יד2 מוסיפה הסבר בסוגריים לכל מצב, ו"בחר מצב
   הנכס" הוא הערך של מודעה שבה לא נבחר מצב. */
function impConditionKey(v){
  const s = impNorm(String(v == null ? '' : v).replace(/\([^)]*\)/g, ' '));
  return s.startsWith('בחר') ? '' : s;
}

const IMP_LOCATION = { 'בבניין':'building','בניין':'building','building':'building','בנכס':'unit','בדירה':'unit','unit':'unit' };

/* סטטוס המודעה בקובץ. "נמכר"/"הושכר" נכנסים כמו שהם — הטריגר שמייצר
   "עסקאות אחרונות" רץ על UPDATE בלבד, ולכן ייבוא היסטורי לא מזייף עסקאות. */
const IMP_PROPERTY_STATUS = {
  'פעיל':'active','פעילה':'active','active':'active','מפורסם':'active',
  'נמכר':'sold','נמכרה':'sold','sold':'sold',
  'הושכר':'rented','הושכרה':'rented','rented':'rented',
  'ירד מפרסום':'unpublished','לא מפורסם':'unpublished','unpublished':'unpublished',
  'לא פעיל':'archived','לא פעילה':'archived','ארכיון':'archived','בארכיון':'archived','הוסר':'archived','archived':'archived',
};

/* שמות מקובלים שאינם מופיעים מילה במילה ברשימות הסגורות של הטופס. */
const IMP_PTYPE_SYNONYMS = {
  // צורות רבים: בכותרות של קבצי ייצוא נפוץ "דירות, רחוב X" ולא "דירה"
  'דירות':'דירה','דירות גן':'דירת גן','קוטגים':"בית פרטי/קוטג'",'וילות':"בית פרטי/קוטג'",
  'פנטהאוז':'גג/פנטהאוז','דירת גג':'גג/פנטהאוז','גג':'גג/פנטהאוז',
  'בית פרטי':"בית פרטי/קוטג'",'קוטג':"בית פרטי/קוטג'",'וילה':"בית פרטי/קוטג'",
  'לופט':'סטודיו/לופט','סטודיו':'סטודיו/לופט',
  'פרטר':'מרתף/פרטר','מרתף':'מרתף/פרטר',
  'יחידה':'יחידת דיור','יחידת דיור':'יחידת דיור',
  'חנייה':'חניה','חניון':'חניה',
  'נחלה':'משק חקלאי/נחלה','משק חקלאי':'משק חקלאי/נחלה',
  'בניין':'בניין מגורים',
  'קבוצת רכישה':"קב' רכישה/זכות לנכס",
};
const IMP_PTYPE_SYNONYMS_COMMERCIAL = {
  'משרד':'משרדים','חנות':'חנויות/שטח מסחרי','שטח מסחרי':'חנויות/שטח מסחרי','מסחרי':'חנויות/שטח מסחרי',
  'מחסן':'מחסנים','מגרש':'מגרשים','אולם':'אולמות','קליניקה':'קליניקות',
  'תעשייה':'מבני תעשייה','מבנה תעשייה':'מבני תעשייה','מלון':'בית מלון','חלל עבודה':'חלל עבודה משותף',
};

function impMatchPropertyType(value, category){
  const v = impNorm(value);
  if (!v) return null;
  const options = category === 'commercial' ? V.commercialTypes : V.residentialTypes;
  const exact = options.find(o => impNorm(o) === v);
  if (exact) return exact;
  const synonyms = category === 'commercial' ? IMP_PTYPE_SYNONYMS_COMMERCIAL : IMP_PTYPE_SYNONYMS;
  for (const key of Object.keys(synonyms)){
    if (impNorm(key) === v) return synonyms[key];
  }
  // התאמה חלקית מתקבלת רק אם היא חד-משמעית ("דירת גן" מול "דירה" תיפסל)
  const partial = options.filter(o => { const n = impNorm(o); return n.includes(v) || v.includes(n); });
  return partial.length === 1 ? partial[0] : null;
}

/* ניחוש סוג הנכס מתוך הכותרת, כשאין עמודה לסוג או שהערך שבה לא זוהה —
   בקבצי ייצוא רבים הסוג יושב רק בכותרת ("משרד, יהושע חנקין 2 — 160 מ״ר").

   ההתאמה היא על רצף מילים שלם ולא על תת-מחרוזת, כדי ש"דירות" לא ייקרא
   כ"דירה"; ומכיוון שכותרת יכולה להזכיר כמה סוגים ("משרד/חנות", "דירה עם
   מרתף"), מנצח המוקדם ביותר בכותרת — הסוג הראשי נכתב ראשון — ובאותו
   מיקום, השם הארוך ביותר ("בית פרטי" לפני "בית").

   הניחוש לעולם אינו שקט: הוא מוסיף אזהרה, צובע את השורה בצהוב ומשאיר את
   פקד התיקון פתוח עם הערך המוצע.                                          */
/* פיצול למילים על כל תו שאינו אות או ספרה — לא רק על רווח. כותרת אמיתית
   נראית "משרד, יהושע חנקין 2 — 160 מ״ר", ופסיק דבוק היה מונע כל התאמה.
   ‏impNorm עצמה נשארת כמות שהיא: היא משמשת גם להשוואות מדויקות. */
function impWords(text){
  return impNorm(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function impWordSpanIndex(words, target){
  for (let i = 0; i + target.length <= words.length; i++){
    if (target.every((w, k) => words[i + k] === w)) return i;
  }
  return -1;
}

function impGuessPropertyType(text, category){
  const words = impWords(text);
  if (!words.length) return null;
  const options = category === 'commercial' ? V.commercialTypes : V.residentialTypes;
  const synonyms = category === 'commercial' ? IMP_PTYPE_SYNONYMS_COMMERCIAL : IMP_PTYPE_SYNONYMS;

  // כל אגף של אופציה מורכבת הוא מועמד בפני עצמו: "גג/פנטהאוז" נמצא גם
  // כשבכותרת כתוב רק "פנטהאוז".
  const candidates = [];
  options.forEach(o => String(o).split('/').forEach(part => candidates.push([part, o])));
  Object.entries(synonyms).forEach(([key, value]) => candidates.push([key, value]));

  let best = null;
  candidates.forEach(([name, value])=>{
    const target = impWords(name);
    if (!target.length) return;
    // שמות בני שתי אותיות ("גג") שכיחים מדי בטקסט חופשי מכדי לנחש לפיהם
    const length = target.join(' ').length;
    if (length < 3) return;
    const at = impWordSpanIndex(words, target);
    if (at < 0) return;
    if (!best || at < best.at || (at === best.at && length > best.length)) best = { at, length, value };
  });
  return best ? best.value : null;
}

/* מפת מאפיינים: גם התווית בעברית וגם הקוד עצמו מובילים לאותו ערך. */
let impFeatureMapCache = null;
/* כתיבים נפוצים שאינם התווית המדויקת שבטופס ("חנייה" מול "חניה",
   "ריהוט" מול "מרוהטת") — גם בעמודת "תוספות" וגם ככותרת עמודה. */
const IMP_FEATURE_SYNONYMS = {
  'חנייה':'parking','חניית נכים':'parking','מיזוג אוויר':'ac','מזגנים':'ac',
  'ריהוט':'furnished','מרוהט':'furnished','סורג':'bars','נגישות':'accessible',
  'נגיש לנכים':'accessible','משופץ':'renovated_feature','שופץ':'renovated_feature',
  'בלעדיות':'exclusive','ממד':'mamad','ממק':'mamak','מקלט':'building_shelter',
  'מרפסת שמש':'sun_balcony','מרפסות שמש':'sun_balcony','מעליות':'elevator',
  'עמדת טעינה':'ev_charger','עמדת טעינה לרכב':'ev_charger','עמדת טעינה חשמלית':'ev_charger',
  'טעינה לרכב חשמלי':'ev_charger','עמדת טעינה לרכבים חשמליים':'ev_charger','עמדות טעינה':'ev_charger',
  // תוויות של הטופס שאין בשרת (‏FEATURE_LABELS ב-marketing-copy.ts) - בלעדיהן
  // עמודת "מזגן" של יד2 הייתה נקלטת ב-CRM ונופלת בייבוא דרך גבריאלה
  'מזגן':'ac','נכס עם חניה':'parking','בבלעדיות':'exclusive','המחיר ירד לאחרונה':'price_dropped',
};

function impFeatureMap(){
  if (impFeatureMapCache) return impFeatureMapCache;
  const map = Object.create(null);
  V.features
    .forEach(([code, label])=>{ map[impNorm(label)] = code; map[impNorm(code)] = code; });
  Object.entries(IMP_FEATURE_SYNONYMS).forEach(([label, code])=>{ map[impNorm(label)] = code; });
  impFeatureMapCache = map;
  return map;
}

function impAutoMap(headers){
  const normalized = headers.map(impNorm);
  const mapping = Object.create(null);
  const taken = new Set();
  // כל השמות המוכרים של כל השדות. כותרת שהיא שם מדויק של שדה אחר לא תיתפס
  // בהתאמה הרכה: "סוג עסקה" נחטפה קודם לשדה "סוג נכס" דרך הכינוי "סוג",
  // ואז נפלו כל השורות גם על סוג הנכס וגם על סוג העסקה שנשאר בלי עמודה.
  const allNames = new Set();
  IMPORT_FIELDS.forEach(f=>{
    [f.label, f.key, ...(f.aliases || [])].forEach(n=>{ const v = impNorm(n); if (v) allNames.add(v); });
  });
  IMPORT_FIELDS.forEach(field=>{
    const wanted = [field.label, field.key, ...(field.aliases || [])].map(impNorm);
    const wantedSet = new Set(wanted.filter(Boolean));
    // התאמה מדויקת לפי סדר הכינויים ולא לפי סדר העמודות בקובץ: כשיש גם
    // "ריהוט" וגם "פירוט ריהוט", הכינוי הספציפי (הראשון ברשימה) מנצח.
    let idx = -1;
    for (const w of wanted){
      if (!w) continue;
      const found = normalized.findIndex((h, i) => !taken.has(i) && h === w);
      if (found > -1){ idx = found; break; }
    }
    if (idx === -1){
      // התאמה רכה: כותרת שמכילה את שם השדה ("מחיר מבוקש בש\"ח")
      idx = normalized.findIndex((h, i) => !taken.has(i) && h
        && !(allNames.has(h) && !wantedSet.has(h))
        && wanted.some(w => w.length > 2 && h.includes(w)));
    }
    mapping[field.key] = idx;
    if (idx > -1) taken.add(idx);
  });
  return mapping;
}

/* עמודות מאפיין בוליאניות: הרבה מערכות מייצאות עמודה נפרדת לכל מאפיין
   ("מזגן", "מעלית", "מרפסת שמש") עם כן/לא, במקום עמודת "תוספות" אחת.
   כל כותרת שנשארה בלי שדה ומזוהה כשם מאפיין נקראת ככה — כדי שלא צריך יהיה
   למפות עשרים עמודות ביד. חישוב מחדש בכל כניסה לשלב 3, כי המיפוי הידני
   בשלב 2 יכול לתפוס או לשחרר כותרות.                                       */
function impDetectFeatureColumns(headers, mapping){
  const taken = new Set(Object.values(mapping).filter(i => i > -1));
  const featureMap = impFeatureMap();
  const columns = [];
  headers.forEach((header, index)=>{
    if (taken.has(index)) return;
    const code = featureMap[impNorm(header)];
    if (code) columns.push({ index, code, label: header });
  });
  return columns;
}

/* קובץ "המודעות שלי" שיורד מיד2 (docs/property-import.md). שלוש הכותרות
   האלה אינן בייצוא שלנו ולא בתבנית, ולכן הן מזהות אותו בלי לנחש.
   מה שהזיהוי משנה - ורק בקובץ כזה:
   - "תוקף" הוא תוקף המודעה ביד2, לא תום הבלעדיות שלנו, ולכן אינו ממופה
     (אחרת כל המלאי היה מקבל תזכורת "פג תוקף" באותו יום);
   - "סוג עסקה" = "מסחרי" אינו אומר מכירה או השכרה (ראו impBuildRow);
   - תאריך כניסה שעבר הוא "כניסה מיידית";
   - "סוכן 1" נקרא כדי שהשותף/ה יירשם/תירשם נכון כשהמייבא/ת הוא/היא סוכן 2. */
const YAD2_SIGNATURE = ['מספר מודעה', 'תאריך הקפצה', 'סוג מודעה'];
function impDetectYad2(headers){
  const normalized = new Set(headers.map(impNorm));
  return YAD2_SIGNATURE.every(h => normalized.has(impNorm(h)));
}

/* מחיר מסחרי בלי מכירה/השכרה: שכירות חודשית של נכס מסחרי אינה מגיעה
   ל-100 אלף, ומכירה אינה יורדת אליו. בקובץ הראשון (114 מודעות) הפער היה
   בין 38,400 ל-120,000. */
const YAD2_COMMERCIAL_SALE_FROM = 100000;
/* ומתחת לזה זה מחיר למ"ר לחודש ולא שכירות - "75" לחנות של 500 מ"ר. */
const YAD2_PRICE_PER_SQM_BELOW = 200;

function impPhoneKey(v){
  const d = String(v == null ? '' : v).replace(/\D/g, '');
  return d.startsWith('972') ? '0' + d.slice(3) : d;
}

/* שם שכונה מקובץ חיצוני מול הרשימה שלנו, כשאין התאמה מדויקת. יד2 כותבת
   "דרום עפולה", "רובע יזרעאל סביוני העמק", "אזור תעשיה א" - ואצלנו "דרום
   העיר", "רובע יזרעאל", "אזור התעשייה". משווים מילים אחרי שמורידים את שם
   העיר, ה' הידיעה ויו"ד כפולה, ומקבלים רק כשמילות האחד כלולות כולן בשני
   ויש מועמד/ת אחד/ת בלבד. השורה מקבלת אזהרה עם השם שנבחר.
   "העיר" עצמה נשארת מילה: בלעדיה "מרכז עפולה עלית" התאים גם ל"מרכז העיר". */
function impHoodWords(name, city){
  const cityWords = new Set(impWords(city));
  return impWords(name)
    .filter(w => !cityWords.has(w))
    .map(w => w.replace(/יי/g, 'י').replace(/וו/g, 'ו'))
    .map(w => w.length > 2 && w.startsWith('ה') ? w.slice(1) : w);
}
function impFuzzyNeighborhood(raw, city, hoods){
  const words = impHoodWords(raw, city);
  if (!words.length) return null;
  const has = (set, list) => list.every(w => set.has(w));
  const rawSet = new Set(words);
  const hits = hoods.filter(n=>{
    const own = impHoodWords(n.name, n.city || city);
    if (!own.length) return false;
    return has(rawSet, own) || has(new Set(own), words);
  });
  return hits.length === 1 ? hits[0] : null;
}

function impBuildRow(S, rawRow, rowNumber){
  const errors = [], warnings = [];
  // ‏errorFields: השדות שהפילו את השורה, לפי מפתח. שלב הבדיקה מציג לפיהם
  // פקד תיקון ידני, ולכן כל errors.push על שדה שניתן לתקן עובר דרך fail().
  const errorFields = [];
  // שדות שהושלמו בניחוש (ולא מהקובץ ולא מתיקון ידני) — שלב הבדיקה מציג
  // אותם בפקד התיקון עם הערך המוצע, כדי שאפשר יהיה לאשר או להחליף.
  const guessed = Object.create(null);
  // ‏fix: מה לעשות, בלשון פנייה. כל שורה שנדחית אומרת גם למה וגם איך לתקן -
  // "סוג נכס לא תקין" לבד השאיר סוכנים לנחש מה המערכת רוצה.
  const fail = (key, message, fix)=>{
    errors.push(fix ? `${message}. לתיקון: ${fix}` : message);
    if (!errorFields.includes(key)) errorFields.push(key);
  };
  const overrides = S.overrides[rowNumber] || null;
  const cell = (key)=>{
    if (overrides && key in overrides) return overrides[key];
    const idx = S.mapping[key] ?? -1;
    return idx < 0 ? '' : rawRow[idx];
  };
  const payload = {};
  // המאפיינים מתנקזים מכמה מקורות (עמודת "תוספות", עמודות כן/לא, ועמודות
  // מחסן/ממ״ד בנוסח בוליאני), ולכן נאספים לסט אחד ונכתבים ל-payload בסוף.
  const featureCodes = new Set();

  // הכותרת נבנית בסוף הפונקציה כשהעמודה ריקה — היא מסתמכת על סוג הנכס,
  // החדרים והכתובת, שכולם מנורמלים בהמשך.
  const title = impText(cell('title'));
  if (title) payload.title = title.slice(0, 200);

  let category = 'residential';
  const rawCategory = impNorm(cell('category'));
  if (rawCategory){
    if (IMP_CATEGORY[rawCategory]) category = IMP_CATEGORY[rawCategory];
    else warnings.push(`קטגוריה "${impText(cell('category'))}" לא זוהתה - נקלט כמגורים`);
  }
  // ביד2 "מסחרי" יושב בעמודת סוג העסקה ולא בקטגוריה. נקרא מהתא שבקובץ ולא
  // דרך cell(): אחרי שבוחרים מכירה/השכרה בתיקון הידני הנכס עדיין מסחרי.
  const dealIdx = S.mapping.deal_type ?? -1;
  const fileDealCommercial = dealIdx > -1 && impNorm(rawRow[dealIdx]) === 'מסחרי';
  if (!rawCategory && fileDealCommercial) category = 'commercial';
  payload.category = category;

  let ptype = impMatchPropertyType(cell('property_type'), category);
  if (!ptype && title){
    // ניחוש מהכותרת, קודם ברשימת הקטגוריה שבקובץ ואז בשנייה. סוג מהקטגוריה
    // השנייה גורר גם את הקטגוריה — כמו בבחירה ידנית — אחרת הוא היה נפסל שוב
    // מיד. הבדיקה חייבת לקרות כאן, לפני ש-category משמש להמשך השורה.
    let guess = impGuessPropertyType(title, category);
    let flipped = false;
    if (!guess){
      const other = category === 'commercial' ? 'residential' : 'commercial';
      const crossGuess = impGuessPropertyType(title, other);
      if (crossGuess){ guess = crossGuess; category = other; payload.category = other; flipped = true; }
    }
    if (guess){
      ptype = guess;
      guessed.property_type = guess;
      const had = impText(cell('property_type'));
      warnings.push(`${had ? `סוג נכס "${had}" לא זוהה` : 'אין ערך לסוג נכס'} - הושלם מהכותרת: "${guess}"`
        + (flipped ? ` (והקטגוריה שונתה ל${category === 'commercial' ? 'מסחרי' : 'מגורים'})` : '')
        + '. בדקו ותקנו במידת הצורך.');
    }
  }
  if (!ptype) fail('property_type', `סוג נכס "${impText(cell('property_type')) || '(ריק)'}" אינו ברשימת הסוגים ל${category === 'commercial' ? 'נכס מסחרי' : 'מגורים'}`,
    'בחרו סוג מהרשימה בשורה שמתחת (אפשר להחיל על כל השורות עם אותה בעיה), או כתבו בקובץ סוג מהגיליון "ערכים חוקיים" שבקובץ התבנית');
  else payload.property_type = ptype;

  let deal = IMP_DEAL[impNorm(cell('deal_type'))];
  let rawPrice = impNumber(cell('price'));
  if (!deal && fileDealCommercial && rawPrice > 0){
    // הצעה ולא החלטה: הפקד נשאר פתוח עם הערך, כמו סוג נכס שנוחש מהכותרת
    deal = rawPrice < YAD2_COMMERCIAL_SALE_FROM ? 'rent' : 'sale';
    guessed.deal_type = deal === 'rent' ? 'השכרה' : 'מכירה';
    warnings.push(`בקובץ כתוב "מסחרי" בלי מכירה/השכרה - לפי המחיר סווג כ${guessed.deal_type}. בדקו ותקנו במידת הצורך.`);
  }
  if (!deal) fail('deal_type', `סוג עסקה "${impText(cell('deal_type')) || '(ריק)'}" אינו מכירה או השכרה`,
    'בחרו מכירה או השכרה בשורה שמתחת, או כתבו "מכירה"/"השכרה" בעמודת סוג העסקה בקובץ');
  else payload.deal_type = deal;

  if (category === 'commercial' && deal === 'rent' && rawPrice > 0 && rawPrice < YAD2_PRICE_PER_SQM_BELOW
      && !(overrides && 'price' in overrides)){
    const area = impNumber(cell('built_size_sqm')) || impNumber(cell('size_sqm'));
    if (area > 0){
      const monthly = Math.round(rawPrice * area);
      warnings.push(`המחיר ${rawPrice} ₪ נראה כמחיר למ"ר - חושב שכר דירה חודשי: ${monthly.toLocaleString('he-IL')} ₪ (${area} מ"ר). בדקו ותקנו במידת הצורך.`);
      guessed.price = monthly;
      rawPrice = monthly;
    }
  }

  const price = rawPrice === null ? null : salePriceFromMillions(rawPrice, deal);
  if (price === null) fail('price', `חסר מחיר${impText(cell('price')) ? ` ("${impText(cell('price'))}" אינו מספר)` : ''}`,
    'הקלידו מחיר בשקלים בשורה שמתחת - ספרות בלבד, למשל 1500000 (או 1.5 למיליון)');
  else if (price <= 0) fail('price', 'המחיר הוא 0 או שלילי',
    'הקלידו את המחיר המבוקש בשורה שמתחת. אם המחיר "לפי פנייה", רשמו מחיר משוער ותקנו אחר כך בכרטיס הנכס');
  else {
    payload.price = price;
    if (price !== rawPrice) warnings.push(`המחיר ${rawPrice} פורש כמיליונים: ${price.toLocaleString('he-IL')} ₪`);
    if (deal === 'sale' && price < 10000) warnings.push('מחיר נמוך במיוחד למכירה - ודאו שהמחיר בשקלים ולא באלפים');
  }

  let city = impText(cell('city'));
  // ‏"אזור תעשייה אלון התבור" ביד2 הוא יישוב, ואצלנו שכונה בעפולה. שם יישוב
  // שאינו עיר של אף שכונה ושווה לשם של שכונה אחת בדיוק - עובר לעיר שלה.
  let hoodFromCity = null;
  if (city && !S.neighborhoods.some(n => hoodCityKey(n.city) === hoodCityKey(city))){
    const named = S.neighborhoods.filter(n => impNorm(n.name) === impNorm(city));
    if (named.length === 1){
      hoodFromCity = named[0];
      warnings.push(`"${city}" הוא שכונה ב${hoodFromCity.city} - נקלט כ${hoodFromCity.city}, שכונת ${hoodFromCity.name}`);
      city = hoodFromCity.city;
    }
  }
  if (!city) fail('city', 'חסרה עיר', 'הקלידו את שם היישוב בשורה שמתחת (מוצעים שמות מהרשימה)');
  else payload.city = city;

  // ‏0 בחדרים, בקומות ובשטחים הוא "לא מולא" (כך בכל מודעה מסחרית ביד2) ולא
  // ערך שגוי, ולכן נשאר ריק בלי אזהרה. קומה 0 היא קרקע ונקלטת.
  const rooms = impNumber(cell('rooms'));
  if (rooms !== null && rooms !== 0){
    if (rooms < 0) warnings.push('מספר חדרים לא תקין - לא נקלט');
    else payload.rooms = rooms;
  }

  // השכונות מנוהלות על ידי הפלטפורמה, ולכן שם שלא ברשימה לא נקלט אלא מתריע.
  // ‏hoodFallback: שכונה שנקבעה מכינוי או מהתאמה רכה ולא מהשם עצמו. בשלב
  // הקליטה, כשיש כתובת מלאה, הפין מכריע קודם והיא נכנסת רק אם הוא לא הכריע
  // (impApplyHoodFallbacks).
  let hoodFallback = null;
  const rawNeighborhood = impNorm(cell('neighborhood'));
  if (hoodFromCity){
    payload.neighborhood_id = hoodFromCity.id;
  } else if (rawNeighborhood){
    // בתוך העיר של השורה: "מרכז העיר" קיים בעפולה ובקריית אתא, והתאמה לפי
    // שם בלבד הייתה משייכת נכס בעפולה לשכונה בקריית אתא.
    const cityKey = hoodCityKey(city);
    const inCity = S.neighborhoods.filter(n => !cityKey || hoodCityKey(n.city) === cityKey);
    const match = inCity.find(n => impNorm(n.name) === rawNeighborhood);
    // כינוי שנקבע בהכרעה (‏neighborhood_aliases) - לפני ההתאמה הרכה, כי הוא
    // החלטה ולא ניחוש: "שכון עובדים" = מרכז העיר
    const aliased = match ? null : (()=>{
      const ids = new Set((S.hoodAliases || [])
        .filter(a => impNorm(a.alias) === rawNeighborhood).map(a => a.neighborhood_id));
      const hits = inCity.filter(n => ids.has(n.id));
      return hits.length === 1 ? hits[0] : null;
    })();
    const fuzzy = (match || aliased) ? null : impFuzzyNeighborhood(cell('neighborhood'), city, inCity);
    if (match) payload.neighborhood_id = match.id;
    else if (aliased || fuzzy){
      hoodFallback = aliased || fuzzy;
      payload.neighborhood_id = hoodFallback.id;
      warnings.push(`השכונה "${impText(cell('neighborhood'))}" שויכה ל"${hoodFallback.name}"`
        + (cell('street') && cell('house_number') ? ' - אלא אם הכתובת תמוקם בשכונה אחרת' : ''));
    }
    // ביישוב קטן יד2 כותבת את שם היישוב גם כשכונה - אין כאן מה לשייך
    else if (rawNeighborhood !== impNorm(city)){
      warnings.push(`השכונה "${impText(cell('neighborhood'))}" אינה ברשימת השכונות - לא נקלטה`);
    }
  }

  const salesArea = impText(cell('sales_area'));
  if (salesArea) payload.sales_area = salesArea.slice(0, 100);

  /* ייבוא מקובץ אינו חוסם על רחוב שאינו ברשימה, בשונה מהטופס: קובץ של 200
     שורות שנתקע על שורה אחת הוא קובץ שלא נקלט, וכתובת שתרד לגמרי היא נכס
     בלי פין במפה. לכן — תיקון כתיב בשקט כשיש התאמה, ואזהרה על השורה כשאין.
     האזהרה מגיעה למסך התיקון הידני, שם אפשר לתקן לפני הקליטה. */
  let street = impText(cell('street'));
  if (street){
    const match = S.canonicalStreet(street, city);
    street = match.name;
    if (!match.ok){
      warnings.push(`הרחוב "${street}" אינו ברשימת הרחובות של ${city} - נשמר כפי שהוקלד, `
        + 'וייתכן שהנכס לא יקבל מיקום על המפה');
    }
  }
  const houseNumber = impText(cell('house_number'));
  payload.street = street || null;
  payload.house_number = houseNumber || null;
  payload.address = (street || houseNumber) ? (street + (houseNumber ? ' ' + houseNumber : '')) : null;

  const rawFloor = impNorm(cell('floor'));
  if (rawFloor){
    if (rawFloor.includes('קרקע')) payload.floor = 0;
    else if (rawFloor.includes('מרתף')) payload.floor = -1;
    else {
      const floor = impNumber(cell('floor'));
      if (floor === null) warnings.push('קומה לא זוהתה - לא נקלטה');
      else payload.floor = Math.round(floor);
    }
  }

  const totalFloors = impNumber(cell('total_floors'));
  if (totalFloors !== null && totalFloors !== 0){
    if (totalFloors < 0 || totalFloors > 200) warnings.push('מספר קומות לא תקין - לא נקלט');
    else payload.total_floors = Math.round(totalFloors);
  }

  // עלויות שוטפות: 0 הוא ערך אמיתי ("אין ועד בית"), ולכן רק שלילי נפסל
  [['maintenance_fee','ועד בית'], ['arnona','ארנונה']].forEach(([key, label])=>{
    const n = impNumber(cell(key));
    if (n !== null){
      if (n < 0) warnings.push(`${label} לא תקין - לא נקלט`);
      else payload[key] = n;
    }
  });

  [['size_sqm','גודל במ"ר'], ['built_size_sqm','מ"ר בנוי'], ['garden_sqm','מ"ר גינה']].forEach(([key, label])=>{
    const n = impNumber(cell(key));
    if (n !== null && n !== 0){
      if (n < 0) warnings.push(`${label} לא תקין - לא נקלט`);
      else payload[key] = n;
    }
  });

  [['description', 5000], ['marketing_description', 5000], ['post_text', 5000],
   ['furniture_details', 300], ['agent2_name', 100], ['agent2_phone', 40]].forEach(([key, max])=>{
    const value = impText(cell(key));
    if (value) payload[key] = value.slice(0, max);
  });

  // ביד2 שני הסוכנים מתחלפים בין המודעות. כשסוכן 2 הוא המייבא/ת עצמו/ה, השותף/ה
  // הוא/היא סוכן 1 - אחרת המודעה הייתה מציגה את המייבא/ת פעמיים.
  const a1 = S.yad2Agent1;
  const myPhone = impPhoneKey(S.agent.phone);
  if (a1 && myPhone && payload.agent2_phone && impPhoneKey(payload.agent2_phone) === myPhone){
    const name1 = a1.name > -1 ? impText(rawRow[a1.name]) : '';
    const phone1 = a1.phone > -1 ? impText(rawRow[a1.phone]) : '';
    delete payload.agent2_name; delete payload.agent2_phone;
    if (phone1 && impPhoneKey(phone1) !== myPhone){
      if (name1) payload.agent2_name = name1.slice(0, 100);
      payload.agent2_phone = phone1.slice(0, 40);
    }
  }

  const expires = impDate(cell('listing_expires_at'));
  if (expires === undefined) warnings.push('תוקף המודעה לא זוהה - לא נקלט');
  else if (expires) payload.listing_expires_at = expires;

  // ‏condition שייך למגורים בלבד, וה-*_location למסחרי בלבד — בדיוק כמו
  // שהטופס הידני שולח null בצד השני.
  //
  // עמודות "מחסן"/"ממ״ד" מגיעות בשני נוסחים: מיקום (בבניין/בנכס) בקבצים
  // מסחריים, וכן/לא בקבצים של דירות. ערך בוליאני נקלט כמאפיין ולא כמיקום,
  // כדי שקובץ מגורים לא יאבד את המחסן והממ״ד ולא יקבל אזהרה מיותרת.
  const LOCATION_FEATURE_CODES = { storage_location:'storage', mamad_location:'mamad' };
  ['restrooms_location','storage_location','mamad_location'].forEach(key=>{
    const raw = impNorm(cell(key));
    if (!raw) return;
    const value = IMP_LOCATION[raw];
    if (value && category === 'commercial'){ payload[key] = value; return; }
    const bool = impBool(cell(key));
    if (bool === true && LOCATION_FEATURE_CODES[key]){ featureCodes.add(LOCATION_FEATURE_CODES[key]); return; }
    if (bool === false || (value && category !== 'commercial')) return;
    warnings.push(`הערך "${impText(cell(key))}" אינו בבניין/בנכס ואינו כן/לא - לא נקלט`);
  });

  if (category === 'commercial'){
    payload.condition = null;
  } else {
    const raw = impConditionKey(cell('condition'));
    if (raw){
      const value = IMP_CONDITION[raw];
      if (value) payload.condition = value;
      else warnings.push(`מצב הנכס "${impText(cell('condition'))}" לא זוהה - לא נקלט`);
    }
  }

  const rawStatus = impNorm(cell('project_status'));
  if (rawStatus){
    const value = IMP_PROJECT_STATUS[rawStatus];
    if (value) payload.project_status = value;
    else warnings.push(`סטטוס פרויקט "${impText(cell('project_status'))}" לא זוהה - לא נקלט`);
  }

  const moveIn = impDate(cell('move_in_date'));
  if (moveIn === undefined) warnings.push('תאריך כניסה לא זוהה - לא נקלט');
  // ביד2 תאריך שעבר הוא "כניסה מיידית" - בקובץ הראשון היו כאלה משנת 2024
  else if (moveIn && S.yad2 && moveIn <= impDate(new Date())) payload.move_in_soon = true;
  else if (moveIn) payload.move_in_date = moveIn;

  const soon = impBool(cell('move_in_soon'));
  if (soon === undefined) warnings.push('"כניסה קרובה" לא זוהה - יש לרשום כן/לא');
  else if (soon !== null) payload.move_in_soon = soon;

  // ‏"תוספות" ביד2 היא עמודת כן/ללא ולא רשימה - אין בה מאפיין לקלוט
  const rawFeatures = impText(cell('features'));
  if (rawFeatures && typeof impBool(rawFeatures) !== 'boolean'){
    const map = impFeatureMap();
    const unknown = [];
    rawFeatures.split(/[,;|]/).forEach(part=>{
      const key = impNorm(part);
      if (!key) return;
      if (map[key]) featureCodes.add(map[key]);
      else unknown.push(part.trim());
    });
    if (unknown.length) warnings.push('מאפיינים שלא זוהו ולא נקלטו: ' + unknown.join(', '));
  }

  // עמודה נפרדת לכל מאפיין (כן/לא) — ראו impDetectFeatureColumns
  (S.featureColumns || []).forEach(col=>{
    if (impBool(rawRow[col.index]) === true) featureCodes.add(col.code);
  });

  if (featureCodes.size) payload.features = [...featureCodes];

  const lat = impNumber(cell('lat')), lng = impNumber(cell('lng'));
  if (lat !== null && lng !== null){
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180){ payload.lat = lat; payload.lng = lng; }
    else warnings.push('קואורדינטות לא תקינות - לא נקלטו');
  } else if (lat !== null || lng !== null){
    warnings.push('נדרשים גם קו רוחב וגם קו אורך - לא נקלטו');
  }

  // ביד2 "תמונות" ו"ווידאו" הן כן/ללא - הקבצים עצמם אינם בייצוא, ושלב 2
  // אומר זאת פעם אחת לכל הקובץ במקום אזהרה על כל שורה
  const rawImages = impText(cell('images'));
  if (rawImages && typeof impBool(rawImages) !== 'boolean'){
    const urls = [], bad = [];
    rawImages.split(/[,;|\s]+/).forEach(part=>{
      const url = part.trim();
      if (!url) return;
      if (/^https?:\/\/\S+$/i.test(url)) urls.push(url);
      else bad.push(url);
    });
    if (urls.length > S.maxImages) warnings.push(`${plural(urls.length, 'נמצאה תמונה אחת', 'תמונות נמצאו')} - ייקלטו ${S.maxImages} הראשונות`);
    if (bad.length) warnings.push('קישורי תמונה לא תקינים (נדרשת כתובת מלאה עם http): ' + bad.slice(0, 3).join(', '));
    if (urls.length) payload.images = urls.slice(0, S.maxImages);
  }

  const marketingImage = impText(cell('marketing_image'));
  if (marketingImage){
    if (/^https?:\/\/\S+$/i.test(marketingImage)) payload.marketing_image = marketingImage;
    else warnings.push('קישור התמונה השיווקית אינו כתובת מלאה - לא נקלט');
  }

  // קישורי מדיה: ‏check במסד דוחה כל דבר שאינו http(s), ולכן קישור פגום
  // נופל כאן עם אזהרה במקום להפיל את כל שורת הייבוא
  [['tour_3d_url','הקישור לסיור הווירטואלי'], ['video_url','הקישור לסרטון']].forEach(([key, label])=>{
    const url = impText(cell(key));
    if (!url || typeof impBool(url) === 'boolean') return;
    if (/^https?:\/\/\S+$/i.test(url)) payload[key] = url.slice(0, 1000);
    else warnings.push(`${label} אינו כתובת מלאה - לא נקלט`);
  });

  if (!payload.title){
    const parts = [
      payload.property_type || '',
      payload.rooms ? plural(payload.rooms, 'חדר אחד', 'חדרים') : '',
      payload.address || '',
      payload.city || '',
    ].filter(Boolean);
    if (parts.length){
      payload.title = parts.join(', ').slice(0, 200);
      warnings.push('אין עמודת כותרת - נוצרה כותרת אוטומטית: ' + payload.title);
    } else {
      fail('title', 'חסרה כותרת ואי אפשר לבנות אותה (אין סוג נכס, כתובת או עיר)',
        'הקלידו כותרת בשורה שמתחת, או מלאו בקובץ את סוג הנכס ואת העיר');
    }
  }

  payload.agency_id = S.agent.agency_id;
  payload.agent_id = S.agent.id;

  const rawPropertyStatus = impNorm(cell('status'));
  if (!rawPropertyStatus) payload.status = 'active';
  else if (IMP_PROPERTY_STATUS[rawPropertyStatus]) payload.status = IMP_PROPERTY_STATUS[rawPropertyStatus];
  else {
    payload.status = 'active';
    warnings.push(`סטטוס "${impText(cell('status'))}" לא זוהה - הנכס נקלט כפעיל`);
  }

  // מספר המודעה ביד2. מודעה שכבר קיימת במשרד נדחית כאן ולא באינדקס הייחודי
  // באמצע הקליטה - כך היא מקבלת הסבר, ולא נופלת עם הודעה של מסד הנתונים.
  const rawYad2 = impText(cell('yad2_listing_id'));
  if (rawYad2){
    const id = /^\d{4,12}$/.test(rawYad2.replace(/\.0+$/, '')) ? Number(rawYad2.replace(/\.0+$/, '')) : null;
    if (!id) warnings.push(`מספר המודעה ביד2 "${rawYad2}" אינו מספר - לא נקלט`);
    else if (S.yad2Taken && S.yad2Taken.has(id)){
      const who = S.yad2Taken.get(id);
      fail('yad2_listing_id', `מודעה ${id} ביד2 כבר קיימת במשרד${who ? ' (אצל ' + who + ')' : ''}`,
        'אין צורך לייבא אותה שוב - לעדכון פתחו את הנכס הקיים ב"הנכסים שלי". אם זה נכס אחר, תקנו את מספר המודעה בקובץ');
    } else payload.yad2_listing_id = id;
  }

  // פרטי הבעלים לא יושבים ב-properties אלא ב-property_owners, ולכן הם נשמרים
  // בצד ה-row ולא ב-payload, ונכנסים בשלב נפרד אחרי שנוצר ה-property_id.
  const owner = {
    owner_name: impText(cell('owner_name')).slice(0, 100) || null,
    owner_phone: impText(cell('owner_phone')).slice(0, 40) || null,
  };

  return {
    rowNumber, raw: rawRow, payload, errors, warnings, errorFields, guessed,
    fixedFields: overrides ? Object.keys(overrides) : [],
    owner: (owner.owner_name || owner.owner_phone) ? owner : null,
    hoodFallback: hoodFallback ? hoodFallback.id : null,
  };
}

/* השדות שאפשר לתקן ידנית בשלב הבדיקה — בדיוק אלה שיכולים להפיל שורה
   (ראו fail() ב-impBuildRow). התיקון נכתב ל-S.overrides, השורה
   נבנית מחדש דרך אותה ולידציה, ואם היא נקייה היא נכנסת לספירת "מוכנים
   לייבוא" — בלי לצאת מהאשף ובלי קובץ תיקונים נפרד.                        */

/* אזהרות הכפילות נמחקות עם כל בנייה מחדש של השורה, ולכן הן מסומנות תמיד
   על כל הקובץ ביחד ואחרי impRevalidate — ולא שורה-שורה. */
function impMarkDuplicates(S){
  const seen = new Map();
  // אותה מודעה של יד2 פעמיים בקובץ: השנייה הייתה נופלת על האינדקס הייחודי
  const seenYad2 = new Map();
  S.parsed.forEach(row=>{
    const id = row.payload.yad2_listing_id;
    if (!id || row.errors.length) return;
    if (seenYad2.has(id)){
      row.errors.push(`מודעה ${id} ביד2 מופיעה כבר בשורה ${seenYad2.get(id)}. לתיקון: מחקו מהקובץ את אחת משתי השורות`);
      row.errorFields.push('yad2_listing_id');
    } else seenYad2.set(id, row.rowNumber);
  });
  S.parsed.forEach(row=>{
    if (row.errors.length) return;
    const key = `${impNorm(row.payload.title)}|${row.payload.price}|${impNorm(row.payload.address || '')}`;
    if (seen.has(key)) row.warnings.push(`שורה זהה לשורה ${seen.get(key)} בקובץ`);
    else seen.set(key, row.rowNumber);
  });
  const existingKeys = S.existingKeys;
  if (!existingKeys || !existingKeys.size) return;
  S.parsed.forEach(row=>{
    // שורה שמעדכנת נכס קיים (ייבוא חוזר) - ברור שהוא קיים
    if (row.errors.length || (row.mode && row.mode !== 'insert')) return;
    if (existingKeys.has(`${impNorm(row.payload.title)}|${Number(row.payload.price)}`)){
      row.warnings.push('נכס עם אותה כותרת ומחיר כבר קיים אצלך (פעיל או בארכיון) - ייתכן שזו כפילות');
    }
  });
}

/* בנייה מחדש של *כל* השורות אחרי תיקון ידני. יקר פחות מלנהל עדכון נקודתי:
   תיקון בשורה אחת יכול לשנות גם אזהרות כפילות בשורות אחרות. */

/* שורה שהמסד דחה בשמירה: למה, ומה לעשות - באותו פורמט של שורה שנדחתה
   בבדיקה ("... לתיקון: ..."), כדי שקובץ השגיאות יפצל את שתיהן לעמודות.
   לפני זה הגיעה הודעת המסד כמו שהיא, ולפעמים באנגלית ("violates check
   constraint"), בלי שום דרך לדעת איזה תא בקובץ לתקן. */
const IMP_CHECK_FIELDS = {
  properties_total_floors_check:     ['מספר הקומות בבניין', 'רשמו מספר בין 1 ל-200, או השאירו ריק'],
  properties_arnona_chk:             ['הארנונה', 'רשמו סכום חיובי או השאירו ריק'],
  properties_maintenance_fee_chk:    ['ועד הבית', 'רשמו סכום חיובי או השאירו ריק'],
  properties_garden_sqm_check:       ['שטח הגינה', 'רשמו מספר חיובי או השאירו ריק'],
  properties_tour_3d_url_check:      ['הקישור לסיור הווירטואלי', 'הדביקו כתובת מלאה שמתחילה ב-https://, או השאירו ריק'],
  properties_video_url_check:        ['הקישור לסרטון', 'הדביקו כתובת מלאה שמתחילה ב-https://, או השאירו ריק'],
  properties_condition_check:        ['מצב הנכס', 'רשמו אחד מ: חדש מקבלן, חדש, משופץ, במצב שמור, דרוש שיפוץ'],
  properties_restrooms_location_check: ['מיקום השירותים', 'רשמו "בבניין" או "בנכס"'],
  properties_storage_location_check: ['מיקום המחסן', 'רשמו "בבניין" או "בנכס"'],
  properties_mamad_location_check:   ['מיקום הממ"ד', 'רשמו "בבניין" או "בנכס"'],
  properties_project_status_check:   ['סטטוס הפרויקט', 'רשמו אחד מהערכים בגיליון "ערכים חוקיים" שבקובץ התבנית'],
};
const IMP_DB_HINT_FIX = {
  duplicate_same_agency: 'אם זו אותה דירה - אין צורך בשורה הזו. אם זו דירה אחרת באותה כתובת, הוסיפו בקובץ את הקומה ומספר החדרים שמבדילים ביניהן',
  duplicate_elsewhere: 'אם יש לכם בלעדיות על הנכס - החתימו את הבעלים על הסכם בלעדיות ב-CRM ותבעו את הנכס מכרטיס הבלעדיות. אחרת ייבאו את השורה בסטטוס "לא פעיל"',
  exclusive_elsewhere: 'הנכס בבלעדיות של משרד אחר ולא ניתן לפרסם אותו עד שהיא תסתיים. אפשר לייבא את השורה בסטטוס "לא פעיל" כדי לשמור אותה אצלך',
};
// הודעת המסד מסתיימת לפעמים בנקודה - בלי זה יוצא "שנייה.. לתיקון"
function impReason(text){ return String(text || '').trim().replace(/[.\s]+$/, ''); }
function impInsertErrorText(error, friendly){
  friendly = friendly || (e => String((e && e.message) || e || ''));
  const code = error && error.code;
  const text = String((error && (error.message || error.details)) || '');
  if (error && IMP_DB_HINT_FIX[error.hint]) return `${impReason(friendly(error))}. לתיקון: ${IMP_DB_HINT_FIX[error.hint]}`;
  if (code === '23505' && /yad2/.test(text + String(error.details || ''))){
    return 'מספר המודעה ביד2 כבר רשום על נכס אחר במשרד. לתיקון: אם זה אותו נכס - אין צורך לייבא שוב; אחרת תקנו את מספר המודעה בקובץ';
  }
  if (code === '23514'){
    const name = Object.keys(IMP_CHECK_FIELDS).find(k => text.includes(k));
    if (name){
      const [label, fix] = IMP_CHECK_FIELDS[name];
      return `הערך של ${label} אינו תקין. לתיקון: ${fix}`;
    }
    return 'אחד הערכים בשורה מחוץ לטווח המותר. לתיקון: בדקו מספרים שליליים או ריקים בעמודות המספריות ונסו שוב';
  }
  if (code === '22001') return 'אחד הטקסטים בשורה ארוך מדי. לתיקון: קצרו את הכותרת או את התיאור ונסו שוב';
  if (code === '22P02' || code === '22003') return 'אחד המספרים בשורה אינו מספר תקין. לתיקון: בדקו שבעמודות המחיר, השטח והקומות יש ספרות בלבד';
  if (code === '42501' || /row-level security/i.test(text)){
    return 'אין הרשאה לשמור את הנכס בחשבון הזה. לתיקון: רעננו את הדף, ודאו שאתם מחוברים לחשבון שלכם ונסו שוב';
  }
  if (!code && /fetch|network|timeout/i.test(text)){
    return 'החיבור נקטע והשורה לא נשמרה. לתיקון: הורידו את קובץ השגיאות והעלו אותו שוב - ייקלטו רק השורות שנכשלו';
  }
  return `${impReason((error && error.code === '23503') ? 'הנכס מקושר לחוזה או לעסקה שמורים' : (friendly(error) || 'שגיאה לא ידועה'))}. לתיקון: נסו שוב, ואם זה חוזר - שלחו את קובץ השגיאות לתמיכה בוואטסאפ`;
}

/* שכונה מכינוי ("שכון עובדים" = מרכז העיר) או מהתאמה רכה היא ברירת מחדל,
   לא החלטה: כשיש רחוב ומספר בית, הכתובת מכריעה. השורה מקבלת כאן פין
   (אותו גאוקוד של טופס הנכס ושל חיפוש העסקאות), והשכונה יורדת מה-payload -
   ‏properties_set_neighborhood_trg ממלא אותה מהמצולע בשמירה. מה שהפין לא
   הכריע (מחוץ לכל מצולע, או בשניים) מקבל את ברירת המחדל אחר כך
   (impApplyHoodFallbacks). שורה בלי מספר בית שומרת את ברירת המחדל כמו שהיא.

   ארבע בקשות במקביל: מעבר לזה שכבת העירייה מתחילה לדחות. */

/* ---------- ייבוא חוזר: מודעה של יד2 שכבר אצלי ----------
   מודעה שכבר קיימת אצל המייבא/ת (לפי yad2_listing_id) אינה נדחית ואינה
   נכנסת שוב: הנכס הקיים **מתעדכן, בלי לדרוס דבר שמילאו בו**.

     • מחיר - מתעדכן כשהשתנה. זו הסיבה העיקרית להעלות קובץ שוב.
     • סטטוס - נכס בארכיון/לא מפורסם חוזר לפרסום כשביד2 המודעה פעילה.
       ההפך אינו קורה: מודעה שפגה ביד2 (לא שולמה, לא הוקפצה) אינה סיבה
       להוריד נכס מהאתר, ולכן היא רק מקבלת הערה. נמכר/הושכר - לעולם לא.
     • שדה שריק אצלי ומלא בקובץ - מתמלא. שדה מלא - נשאר כמו שהוא, גם אם
       בקובץ כתוב אחרת: ייתכן מאוד שתוקן ב-CRM, וזו החלטה של הסוכן/ת.
     • מאפיינים - מתווספים בלבד, אף אחד אינו יורד.
   מודעה של עמית/ה במשרד נשארת דחייה (‏yad2Taken): את הנכס של מישהו אחר
   לא מעדכנים מקובץ.                                                       */
const IMP_FILL_FIELDS = [
  ['description','תיאור'], ['rooms','חדרים'], ['floor','קומה'], ['total_floors','מספר קומות'],
  ['size_sqm','מ"ר'], ['built_size_sqm','מ"ר בנוי'], ['garden_sqm','מ"ר גינה'],
  ['neighborhood_id','שכונה'], ['condition','מצב הנכס'], ['move_in_date','תאריך כניסה'],
  ['furniture_details','פירוט ריהוט'], ['sales_area','איזור מכירה'],
  ['agent2_name','סוכן 2'], ['agent2_phone','טלפון 2'],
];
/* מה ששולפים על הנכס הקיים כדי לתכנן עדכון - אותה רשימה ב-CRM ובשרת */
const IMP_REIMPORT_COLUMNS = ['id', 'title', 'price', 'status', 'street', 'house_number', 'address',
  'features', 'yad2_listing_id', ...IMP_FILL_FIELDS.map(([key]) => key)].join(', ');
function impEmpty(v){ return v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length); }

function impPlanUpdate(payload, existing){
  const patch = {}, changes = [], notes = [];
  const fmt = (n)=> Number(n).toLocaleString('he-IL');
  if (payload.price > 0 && Number(existing.price) !== Number(payload.price)){
    patch.price = payload.price;
    changes.push(`מחיר: ${fmt(existing.price)} ← ${fmt(payload.price)} ₪`);
  }
  const was = existing.status;
  if (payload.status === 'active' && (was === 'archived' || was === 'unpublished')){
    patch.status = 'active';
    changes.push('חוזר לפרסום (ביד2 המודעה פעילה)');
  } else if (was === 'active' && payload.status && payload.status !== 'active'){
    notes.push('ביד2 המודעה לא פעילה - הנכס נשאר מפורסם אצלך. להורדה: "הנכסים שלי"');
  }
  IMP_FILL_FIELDS.forEach(([key, label])=>{
    if (impEmpty(existing[key]) && !impEmpty(payload[key])){
      patch[key] = payload[key];
      changes.push(`${label}: הושלם מהקובץ`);
    }
  });
  // כתובת - רק כשאין אצלי רחוב בכלל, ואז שלושת השדות יחד
  if (impEmpty(existing.street) && !impEmpty(payload.street)){
    patch.street = payload.street; patch.house_number = payload.house_number; patch.address = payload.address;
    changes.push('כתובת: הושלמה מהקובץ');
  }
  const have = new Set(existing.features || []);
  const added = (payload.features || []).filter(f => !have.has(f));
  if (added.length){
    patch.features = [...have, ...added];
    changes.push(plural(added.length, 'מאפיין אחד נוסף', 'מאפיינים נוספו'));
  }
  return { patch, changes, notes };
}

/* אחרי buildRow: שורה עם מודעה של יד2 שכבר אצלי הופכת לעדכון (או ל"ללא
   שינוי"). השורה נשארת בלי errors - היא לא נדחית - ו-mode אומר לשלב הקליטה
   מה לעשות בה: 'insert' (ברירת מחדל), 'update', 'same'.                   */
function impApplyReimport(S, row){
  row.mode = 'insert';
  const id = row.payload.yad2_listing_id;
  const existing = id && S.ownByYad2 ? S.ownByYad2.get(id) : null;
  if (!existing || row.errors.length) return row;
  row.targetId = existing.id;
  row.hoodFallback = null;
  // עסקה שנסגרה היא רשומה היסטורית: לא משלימים בה שדות ולא מחזירים לפרסום
  if (existing.status === 'sold' || existing.status === 'rented'){
    row.mode = 'same';
    row.patch = {};
    row.warnings = [`מודעה ${id} כבר אצלך (${existing.title || 'נכס קיים'}) ומסומנת ${existing.status === 'sold' ? 'נמכר' : 'הושכר'} - לא עודכנה`];
    return row;
  }
  const plan = impPlanUpdate(row.payload, existing);
  row.patch = plan.patch;
  row.mode = Object.keys(plan.patch).length ? 'update' : 'same';
  // אזהרות הבנייה (שכונה שויכה, כותרת אוטומטית) מתארות נכס חדש ואינן נכונות כאן
  row.warnings = [
    row.mode === 'update'
      ? `מודעה ${id} כבר אצלך (${existing.title || 'נכס קיים'}) - יעודכן: ${plan.changes.join(' · ')}`
      : `מודעה ${id} כבר אצלך (${existing.title || 'נכס קיים'}) וזהה למה שבקובץ - ללא שינוי`,
    ...plan.notes,
  ];
  return row;
}

/* מספרי המודעה של יד2 שבקובץ - לשליפה מראש של מה שכבר במשרד ואצלי */
function impYad2Ids(S){
  const idx = (S.mapping && S.mapping.yad2_listing_id) ?? -1;
  if (idx < 0) return [];
  return [...new Set(S.rows.map(r => Number(impText(r[idx]).replace(/\.0+$/, '')))
    .filter(n => Number.isInteger(n) && n > 0))];
}

/* כל הקובץ: בנייה, ייבוא חוזר וכפילויות - הסדר שבו גם האשף וגם השרת רצים */
function impParseAll(S){
  S.parsed = S.rows.map((r, i) => impApplyReimport(S, impBuildRow(S, r, i + 2)));
  impMarkDuplicates(S);
  return S.parsed;
}

/* סיכום לשורת מצב או להודעה בוואטסאפ */
function impSummarize(parsed){
  const out = { total: parsed.length, insert: 0, update: 0, same: 0, rejected: 0, guessed: 0, reasons: [] };
  const reasons = new Map();
  parsed.forEach(r=>{
    if (r.errors.length){
      out.rejected++;
      r.errors.forEach(e=>{ const k = e.split('. לתיקון: ')[0].replace(/"[^"]*"/g, '"…"'); reasons.set(k, (reasons.get(k) || 0) + 1); });
      return;
    }
    out[r.mode || 'insert']++;
    if (Object.keys(r.guessed || {}).length) out.guessed++;
  });
  out.reasons = [...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count }));
  return out;
}

root.PropertyImportCore = {
  configure, IMPORT_FIELDS,
  norm: impNorm, text: impText, number: impNumber, bool: impBool, date: impDate, pad: impPad,
  salePriceFromMillions, featureMap: impFeatureMap, matchPropertyType: impMatchPropertyType,
  guessPropertyType: impGuessPropertyType, conditionKey: impConditionKey,
  CATEGORY: IMP_CATEGORY, DEAL: IMP_DEAL, CONDITION: IMP_CONDITION, PROJECT_STATUS: IMP_PROJECT_STATUS,
  LOCATION: IMP_LOCATION, PROPERTY_STATUS: IMP_PROPERTY_STATUS,
  autoMap: impAutoMap, detectFeatureColumns: impDetectFeatureColumns, detectYad2: impDetectYad2,
  phoneKey: impPhoneKey, fuzzyNeighborhood: impFuzzyNeighborhood,
  buildRow: impBuildRow, markDuplicates: impMarkDuplicates, applyReimport: impApplyReimport,
  planUpdate: impPlanUpdate, parseAll: impParseAll, summarize: impSummarize,
  REIMPORT_COLUMNS: IMP_REIMPORT_COLUMNS, yad2Ids: impYad2Ids,
  insertErrorText: impInsertErrorText,
};
})(typeof globalThis !== 'undefined' ? globalThis : this);
