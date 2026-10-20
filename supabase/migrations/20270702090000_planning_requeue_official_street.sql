-- ============================================================================
-- ניסיון אחד נוסף למידע התכנוני, אחרי שהשאילתה למדה את השם הרשמי
--
-- ## מה נמצא (20.10.2026)
--
-- סוכן שאל את גבריאלה "מה הגוש והחלקה של קינמון 9 בעפולה" - נכס פעיל
-- משלו - וקיבל "הכתובת לא מופיעה במפות של עיריית עפולה". הכתובת קיימת:
-- בשכבה הרחוב רשום "יעקב קינמון", והשאילתה היא השוואה מדויקת. אותו נכס
-- מיצה גם את planning-backfill (שלושה address_not_found) ויצא מהתור לתמיד.
--
-- זה בדיוק הכשל שתוקן בגאוקוד ב-12.10.2026
-- (‏20270423093000_geocode_requeue_official_street.sql): ‏street-resolve.ts
-- מתרגם "יוספטל" ל-"גיורא יוספטל". התיקון נכנס לגאוקוד בלבד, ולא לשלושת
-- מי שקוראים ל-lookupPlanning - הבוט, afula-planning-lookup ו-planning-backfill.
-- התור (‏20261111090000) מתרגם לפי name_key, וזה מגשר על כתיב ולא על מילה
-- שחסרה.
--
-- 29 נכסים פעילים בעפולה עמדו בלי מידע תכנוני עם address_not_found. בהרצת
-- המתרגם על הרחובות שלהם מול הרשימה: 9 מ-11 שמות מקבלים שם רשמי (קינמון,
-- אוסישקין, ברזילאי, הרב לוין, יהודה שטרית, יוספטל, פרץ ציוני, קירשטיין,
-- שדרות רובע). ‏"היצירה" ו-"יהושוע חנקין" אינם מתורגמים, בכוונה. התנאי
-- למטה תופס 22 מה-29 - השבעה האחרים כבר כתובים בשם הרשמי אות באות.
--
-- ## ניסיון אחד, לא שלושה
--
-- ‏`planning_attempts = 2`: אם הכתובת עדיין לא נמצאת גם בשם הרשמי, היא
-- יוצאת מהתור אחרי סבב אחד. רק `address_not_found` - שגיאת רשת ממילא חוזרת
-- לבד. רק מי שהרחוב שלו אינו כבר שם רשמי אות באות, כי לו התרגום לא ישנה
-- דבר. אין כאן DDL - שלוש עמודות מטא-דאטה של התור.
-- ============================================================================

update public.properties
   set planning_attempted_at = null,
       planning_attempts     = least(planning_attempts, 2),
       planning_error        = null
 where city = 'עפולה'
   and status = 'active'
   and planning_error = 'address_not_found'
   and not exists (select 1 from public.property_planning_info ppi
                    where ppi.property_id = properties.id and ppi.gush is not null)
   and not exists (select 1 from public.street_registry r
                    where r.city = properties.city and r.source = 'gis'
                      and r.active and r.name = properties.street);
