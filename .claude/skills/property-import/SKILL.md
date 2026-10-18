---
name: property-import
description: עבודה על אשף ייבוא הנכסים מקובץ בריפו של שוק נדל״ן ("📥 ייבוא מקובץ" ב"הנכסים שלי") - IMPORT_FIELDS, impAutoMap, impBuildRow, impMarkDuplicates, impRenderStep3/4 ו-impDownloadErrors ב-assets/crm.js, והקובץ שיורד מיד2 ("המודעות שלי") - impDetectYad2, "מסחרי" בסוג העסקה, מחיר למ"ר, "תוקף" שאינו נקלט, השכונות (neighborhood_aliases, impFuzzyNeighborhood, ברירת מחדל שהכתובת גוברת עליה), properties.yad2_listing_id ו-yad2_listing_ids_taken. Use when adding a column or an alias the importer should recognize, when a file from another system (Yad2, Madlan, an office CRM) does not import or most rows are rejected, when the same warning appears on every row, when a neighborhood from a file is not assigned, when re-importing creates duplicates, when an imported row fails at save with an unclear message, when changing the errors file, or when Gabriela gets a spreadsheet of properties.
---

# ייבוא נכסים מקובץ

האשף רץ כולו בדפדפן (`assets/crm.js`, מ-`IMPORT_FIELDS` עד
`impDownloadErrors`) ומכניס בסשן של הסוכן/ת. גבריאלה **אינה** מייבאת:
היא קוראת את הקובץ (`sheetToText` ב-`media-intake.ts`) ומעל עשרה נכסים
מפנה לאשף (`DOCUMENT_GUIDE`). התיעוד המלא, כולל טבלת המיפוי של יד2:
`docs/property-import.md`.

## שישה כללים, וכל אחד נשבר בשקט

1. **כל שורה שנדחית אומרת למה וגם מה לעשות.** ‏`fail(key, message, fix)`
   ב-`impBuildRow`, ו-`impInsertErrorText` לשורה שהמסד דחה בשמירה -
   שתיהן בפורמט `"<סיבה>. לתיקון: <מה לעשות>"`, ו-`impDownloadErrors`
   מפצל לפי `". לתיקון: "` לשתי עמודות. סיבת דחייה חדשה בלי `fix`, או
   הודעת מסד שעוברת כמו שהיא (‏`violates check constraint`), מחזירה את
   המצב שבו סוכן/ת יודע/ת שנכשל ולא יודע/ת איזה תא לתקן. אילוץ `check`
   חדש על `properties` מקבל שורה ב-`IMP_CHECK_FIELDS`, ו-`hint` חדש
   מטריגר על `properties` - שורה ב-`IMP_DB_HINT_FIX`.

2. **אזהרה שמופיעה בכל שורה היא מיפוי שגוי, לא נתון שגוי.** כך נמצאו
   כל הבעיות בקובץ של יד2: "תמונות" עם "כן/ללא" מופה לקישורי תמונות,
   "תוספות" עם "כן" למאפיינים, ו-0 נקרא כ"לא תקין". לפני שמוסיפים אזהרה,
   מריצים את `impBuildRow` על קובץ אמיתי (ראו "בדיקה" למטה) וסופרים.

3. **כינוי בלי מילה כללית לבדה.** "מספר מודעה" הוא `listing_number`
   בייצוא שלנו, ובקובץ של יד2 הוא `yad2_listing_id`; "ריהוט" ו"מספר"
   חוטפים עמודות אחרות בהתאמה הרכה. מה ששייך למקור אחד ממופה מפורשות
   אחרי שהמקור זוהה (`impDetectYad2` → `impReadFile`), לא דרך `aliases`.
   ו-**הייצוא בונה את עמודותיו מ-`IMPORT_FIELDS`** - שדה חדש שם הוא גם
   עמודה חדשה בקובץ שיורד, וחייב להופיע ב-`PROPERTY_SELECT_COLUMNS`.

4. **שכונה מכינוי או מהתאמה רכה היא ברירת מחדל, והכתובת מכריעה.**
   ‏`hoodFallback` בשורה; ב-`impLocateFallbackRows` שורה עם רחוב ומספר
   בית מקבלת פין והשכונה יורדת מה-payload, ‏`properties_set_neighborhood_trg`
   ממלא מהמצולע, ו-`impApplyHoodFallbacks` כותב את ברירת המחדל רק כשהפין
   לא הכריע. כינוי חדש נכנס ל-`neighborhood_aliases` **במיגרציה** (הוא
   משרת גם את הבוט ואת עסקאות רשות המסים), לא כרשימה בקוד.

5. **ניחוש לעולם אינו שקט.** סוג נכס מהכותרת, מכירה/השכרה לפי מחיר
   (‏`YAD2_COMMERCIAL_SALE_FROM`), מחיר למ"ר (‏`YAD2_PRICE_PER_SQM_BELOW`) -
   כולם נכתבים ל-`guessed`, מוסיפים אזהרה, ומופיעים בפקד התיקון של השורה
   כהצעה לאישור. ניחוש שנכנס בלי אזהרה הוא נתון שגוי שאיש לא יבדוק.

6. **מודעה של יד2 - פעם אחת למשרד.** אינדקס ייחודי על
   `(agency_id, yad2_listing_id)`, ו-`yad2_listing_ids_taken()` בשלב 3, כי
   ‏RLS אינו מראה לסוכן/ת נכס בארכיון של עמית/ה. בלי השאילתה הכפילות
   נופלת על האינדקס באמצע הקליטה במקום לקבל הסבר בשלב הבדיקה.

## בדיקה

אין לאשף בדיקה אוטומטית. `impBuildRow` תלוי רק ב-`IMPORT_FIELDS`, ברשימות
הסוגים והמאפיינים, ב-`allNeighborhoods` וב-`importState`, ולכן אפשר לחלץ
אותו ולהריץ ב-Node על קובץ אמיתי (‏openpyxl → JSON, תאריכים כ-`Date`),
עם `canonicalStreet` ו-`currentAgent` מדומים ושכונות מ-`execute_sql`.
מה שבודקים: כמה שורות נדחות, אילו אזהרות חוזרות על כל הקובץ, ומדגם של
payload-ים (סוג, עסקה, שכונה, מחיר).

הקובץ שעליו נבנה המיפוי של יד2: 114 מודעות, 18.10.2026 - לפני השינוי 78
נדחו, אחריו 0.
