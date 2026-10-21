---
name: property-import
description: ייבוא נכסים מקובץ בריפו של שוק נדל״ן - הליבה המשותפת (assets/property-import-core.js ועותק ב-_shared, check_import_core.py), האשף ב-CRM (impOpen), קובץ לגבריאלה (property-import.ts, property_import_jobs), וקובץ של יד2. Use when adding a column or alias the importer should recognize, when most rows are rejected, when the CRM and Gabriela import a file differently, when re-import duplicates or overwrites (applyReimport), or when touching IMPORT_FIELDS.
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
   שורות שנפסלו נפתחות באשף מאותו קובץ (`?import=<job>`). **קובץ שצורף
   למייל** עובר באותו `prepareImportJob` (‏`readAttachments` ב-
   ‏`email-intake.ts`), והבלוק נכנס לראש ההיסטוריה; ה"כן" בוואטסאפ.
   **ניחוש מחכה לאישור לפי סוג** (`GUESS_KINDS`, ‏`accept_guesses`): בלי
   הפרמטר חוזר `needs_confirmation` ולא נקלט כלום; ניחוש שלא אושר נשאר
   לתיקון באשף. סוג ניחוש חדש בליבה (`guessed.<field>`) - שורה ב-
   ‏`GUESS_KINDS` וב-`enum` של הכלי ב-`agent.ts`, אחרת הוא נשאר בחוץ תמיד
   ואין דרך לאשר אותו. טקסט מהקובץ בתוך הבלוק - רק דרך `clip`.

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
