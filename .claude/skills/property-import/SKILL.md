---
name: property-import
description: עבודה על ייבוא נכסים מקובץ בריפו של שוק נדל״ן - ליבת הייבוא המשותפת (assets/property-import-core.js ועותק זהה ב-supabase/functions/_shared, check_import_core.py), שתי הדלתות - האשף "📥 ייבוא מקובץ" ב"הנכסים שלי" (impOpen, impRevalidate, impRenderStep3/4, impLoadMatrix, openImportJobFromParam ב-assets/crm.js) וקובץ שנשלח לגבריאלה בוואטסאפ (whatsapp-webhook/property-import.ts, prepareImportJob, runImportJob, הכלי import_properties_file, property_import_jobs) - והקובץ שיורד מיד2 ("המודעות שלי"): "מסחרי" בסוג העסקה, מחיר למ"ר, "תוקף" שאינו נקלט, שכונות (neighborhood_aliases, fuzzyNeighborhood, ברירת מחדל שהכתובת גוברת עליה), properties.yad2_listing_id, yad2_listing_ids_taken, וייבוא חוזר שמעדכן בלי לדרוס (applyReimport, planUpdate). Use when adding a column or an alias the importer should recognize, when a file from another system does not import or most rows are rejected, when the same warning appears on every row, when the CRM and Gabriela import the same file differently, when re-importing creates duplicates or overwrites something an agent filled in, when an imported row fails at save with an unclear message, when changing the errors file, when Gabriela gets a spreadsheet of properties, or when touching IMPORT_FIELDS (the Excel export builds its columns from it).
---

# ייבוא נכסים מקובץ

שתי דלתות, קוד אחד: האשף ב-CRM (בדפדפן) וקובץ שנשלח לגבריאלה (בשרת)
מריצים את **ליבת הייבוא**, `assets/property-import-core.js`. התיעוד המלא,
כולל טבלת המיפוי של יד2: `docs/property-import.md`.

## שבעה כללים, וכל אחד נשבר בשקט

1. **עורכים את `assets/property-import-core.js` ומעתיקים.** העותק ב-
   `supabase/functions/_shared/` חייב להיות זהה בבית - פונקציית Edge אינה
   יכולה לייבא מחוץ ל-`supabase/functions`. ‏`python scripts/check_import_core.py
   --fix` מעתיק, ובלי `--fix` הוא חוסם ב-CI ומריץ את
   `property_import_core_test.js`. עותק שנשכח אינו שובר כלום: אותו קובץ
   פשוט נקלט אחרת ב-CRM ובוואטסאפ.

2. **אוצר המילים אינו בליבה.** ה-CRM מעביר את רשימות הטופס (`PIC.configure`
   ב-`crm.js`), והשרת את `RESIDENTIAL_PTYPES`/`COMMERCIAL_PTYPES` של הבוט
   ואת `FEATURE_LABELS` (`configureImportVocab` ב-`agent.ts`). תווית שקיימת
   רק באחד מהם - מילה נרדפת ב-`IMP_FEATURE_SYNONYMS`, אחרת הבדיקה תיכשל
   על "השרת נותן תוצאה אחרת מה-CRM". זו בדיוק המטרה שלה.

3. **כל שורה שנדחית אומרת למה וגם מה לעשות.** ‏`fail(key, message, fix)`
   ב-`impBuildRow`, ו-`impInsertErrorText` לשורה שהמסד דחה - בפורמט
   `"<סיבה>. לתיקון: <מה לעשות>"`, שקובץ השגיאות מפצל לשתי עמודות. אילוץ
   `check` חדש על `properties` - שורה ב-`IMP_CHECK_FIELDS`; ‏`hint` חדש
   מטריגר - שורה ב-`IMP_DB_HINT_FIX`.

4. **ייבוא חוזר מעדכן ולא דורס.** מודעה של יד2 שכבר אצלי (`ownByYad2`)
   הופכת ל-`mode: 'update'`/`'same'` (`applyReimport`): מחיר מתעדכן, חזרה
   לפרסום רק מארכיון/לא מפורסם, שדה ריק מתמלא (`IMP_FILL_FIELDS`), מאפיין
   רק מתווסף, נמכר/הושכר - לא נוגעים. **פעיל אינו יורד מהאתר** כי ביד2
   המודעה פגה. שדה חדש שמותר להשלים נכנס ל-`IMP_FILL_FIELDS`, ו-
   `REIMPORT_COLUMNS` נגזר ממנו - שתי הדלתות שולפות אותו דבר.

5. **מודעה של יד2 - פעם אחת למשרד.** אינדקס ייחודי על `(agency_id,
   yad2_listing_id)`; של עמית/ה נפסלת עם השם (`yad2_listing_ids_taken()`
   בדפדפן, כי RLS אינו מראה נכס בארכיון של עמית/ה; בשרת - שאילתה רגילה).

6. **בגבריאלה: סיכום בקבלה, קליטה רק אחרי "כן", והמצב נבנה מחדש.** הבלוק
   `[ייבוא נכסים]` עם `job_id` נכתב **אחרי** המסמך (אחרת `mediaForHistory`
   חותך אותו), והתור שמקבל את הקובץ רץ בלי כלי כתיבה (`MEDIA_TOOLS`).
   ‏`runImportJob` בונה את `S` מהמסד של עכשיו ונועל `pending` → `running`.
   שורות שנפסלו נפתחות באשף מאותו קובץ (`?import=<job>`).

7. **אזהרה שמופיעה בכל שורה היא מיפוי שגוי, לא נתון שגוי.** כך נמצאו כל
   הבעיות בקובץ של יד2 ("תמונות" כן/ללא מופה לקישורים, "תוספות" למאפיינים,
   0 כ"לא תקין"). ניחוש לעולם אינו שקט: `guessed` + אזהרה + פקד תיקון.

## השמות הישנים ב-CRM הם כינויים

‏`IMPORT_FIELDS`, ‏`IMP_*`, ‏`impNorm`/`impText`/`impNumber`/`impFeatureMap`
ו-`salePriceFromMillions` נשארו ב-`crm.js` ככינויים לליבה - ייבוא הלקוחות
(`crm-office.js`), הייצוא לאקסל וטופס הנכס קוראים להם. **הייצוא בונה את
עמודותיו מ-`IMPORT_FIELDS`**: שדה חדש שם הוא גם עמודה בקובץ שיורד, וחייב
להופיע ב-`PROPERTY_SELECT_COLUMNS`.

## בדיקה

```sh
python scripts/check_import_core.py          # עותקים + property_import_core_test.js
python scripts/check_edge_types.py whatsapp-webhook
```

והרצה על קובץ אמיתי לפני ששולחים: הליבה תלויה רק ב-`S` ובאוצר המילים,
ולכן רצה ב-Node (‏`require` של הקובץ ו-`PropertyImportCore.parseAll`).
ההעברה לליבה נבדקה כך מול הקוד הקודם: 120 שורות, זהות בבית, ב-Node ובתוך
ה-CRM בדפדפן (Playwright, עם supabase-js אמיתי מ-npm ובקשות REST מדומות).
