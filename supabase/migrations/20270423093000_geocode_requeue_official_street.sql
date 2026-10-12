-- ============================================================================
-- ניסיון אחד נוסף לכתובות שנדחו, אחרי שהשאילתה למדה את השם הרשמי
--
-- ## מה נמצא (12.10.2026)
--
-- בעפולה 37 נכסים פעילים בלי פין, ולכן גם בלי שכונה (השיוך האוטומטי יוצא
-- מהפין - 20270115092000). בין הסיבות: 11 נכסים עם כתובת אמיתית שהשכבה של
-- העירייה ענתה עליה "לא נמצא" שלוש פעמים, ויצאו מהתור לתמיד - "יוספטל 1",
-- "פרץ ציוני 3" (שלוש מודעות), "אוסישקין 61", "ארלוזורוב 22". השכבה רושמת
-- את השם המלא ("גיורא יוספטל", "הרב פרץ ציוני", "מנחם אוסישקין", "שדרות
-- ארלוזורוב"), והשאילתה היא השוואה מדויקת.
--
-- ‏`_shared/geocode/street-resolve.ts` מתרגם עכשיו את השם שהוקלד לשם הרשמי
-- מ-street_registry לפני השאילתה - רק בהתאמה אחת ויחידה. אותו תיקון נוגע
-- גם בעסקאות ממאגר רשות המיסים שנדחו באותו אופן, ושבלי פין אינן נכנסות
-- לרדיוס של דוח ה-CMA ("שרת" הוא "משה שרת" - 21 עסקאות לבדו).
--
-- ## רק מי שהתרגום יכול לשנות לו משהו
--
-- הכלל של docs/geocoding.md ("נכס שמיצה את התור"): לבדוק במרשם **לפני**
-- שמאפסים. שורה שהרחוב שלה כבר כתוב אות באות כמו השם הרשמי לא תרוויח
-- כלום מהתרגום, ואיפוס שלה רק שורף ניסיון. לכן התנאי `not exists` על
-- השם המדויק: 13 נכסים ו-201 עסקאות מתוך 15 ו-233 (12.10.2026). בהרצה
-- של המתרגם על הרחובות שלהן: 20 מ-20 שמות הנכסים ו-111 מ-201 העסקאות
-- מקבלים שם רשמי; השאר הן שגיאות הקלדה אמיתיות ("יעקב קנמון", "פרדה
-- יזזאו אקלום") שבכוונה אינן מנוחשות.
--
-- ## ניסיון אחד, לא שלושה
--
-- ‏`geocode_attempts = 2` ולא 0: אם הכתובת עדיין לא נמצאת גם בשם הרשמי,
-- היא יוצאת מהתור אחרי סבב אחד ולא אחרי שלושה. כך העומס על שרת העירייה
-- חסום - כ-214 שורות, בסבבים של 25 כל חמש דקות.
--
-- רק `address_not_found`: שורה עם שגיאת רשת ממילא חוזרת לתור לבד (המונה
-- שלה לא עלה). אין כאן DDL - שלוש עמודות מטא-דאטה של התור, ולא lat/lng.
-- הרצה חוזרת נותנת לכל היותר ניסיון אחד נוסף לשורה שעדיין בלי פין.
-- ============================================================================

update public.properties
   set geocode_attempted_at = null,
       geocode_attempts     = least(geocode_attempts, 2),
       geocode_error        = null
 where status = 'active'
   and (lat is null or lng is null)
   and geocode_error = 'address_not_found'
   and not exists (select 1 from public.street_registry r
                    where r.city = properties.city and r.source = 'gis'
                      and r.active and r.name = properties.street);

update public.market_deals_official
   set geocode_attempted_at = null,
       geocode_attempts     = least(geocode_attempts, 2),
       geocode_error        = null
 where (lat is null or lng is null)
   and geocode_error = 'address_not_found'
   and not exists (select 1 from public.street_registry r
                    where r.city = market_deals_official.city and r.source = 'gis'
                      and r.active and r.name = market_deals_official.street);
