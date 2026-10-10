---
name: lead-card
description: עבודה על כרטיס הליד בקטגוריית "לידים" ב-CRM של שוק נדל״ן - buildLeadCard / buildLeadWork / buildLeadTab ב-assets/crm.js, שלושת האזורים (מי ומתי, מה מחפש/ת, פעולות) וה-container query ב-crm.html, ליד נעול מול פתוח (המיסוך ב-leads_masked), טריות ("חדש", "התקבל לפני"), הקשר הנכס מ-myPropertyRows, הודעת הוואטסאפ המוכנה, ושלב הטיפול וההערה בטבלה lead_work. Use when adding a field or a button to the lead card, when a locked lead shows something it should not (or hides what should sell it), when changing the lead stages, when the stage or note does not save, when the card looks wrong on desktop or phone, or when adding a new way to contact a lead from the card.
---

# כרטיס הליד

הכרטיס שנפתח מתחת לשורת הליד. התיעוד המלא: `docs/lead-card.md`.

## חמישה כללים, וכל אחד נשבר בשקט

1. **המיסוך במסד, לא בכרטיס.** ‏`leads_masked` מחזיר שם וטלפון ממוסכים
   וההודעה `null` כל עוד `status <> 'unlocked'`. אל תוסיפו לכרטיס שדה
   שמגיע מ-`leads` ישירות או מטבלה אחרת שחושפת את הפונה (טלפון, מייל,
   שם מלא, הודעה) - זה חשיפה של מה שהסוכן/ת עוד לא שילם/ה עליו, והכרטיס
   ייראה תקין לגמרי. מה ש**מתאר את הצורך** (עסקה, עיר, שכונה, סוג, הנכס
   ומחירו) גלוי בכוונה: זה מה שמוכר את הליד.

2. **כל פתח חדש לפנייה לליד קורא ל-`markLeadResponded(lead)`.** חיוג
   ווואטסאפ עושים את זה; כפתור שלישי (מייל, SMS, שיחה דרך מספר וירטואלי)
   שלא יקרא - הליד יוצג בדאשבורד המשרד "ללא מענה מתועד". ראו הסקיל
   `office-dashboard`. **שלב הטיפול אינו זמן התגובה**: בחירה ב"נוצר קשר"
   לא כותבת `first_response_at`, ואל תחברו ביניהם - הבחירה היא דיווח
   עצמי, הלחיצה היא מדידה.

3. **‏`lead_work` היא לפי `(lead_id, agent_id)`.** ליד שנמסר בהפנייה גלוי
   למנהל/ת ולסוכן/ת, ולכל אחד/ת שלב והערה פרטיים. `upsert` עם
   `onConflict:'lead_id,agent_id'` ו-`agent_id = currentAgent.id` - לעולם
   לא `lead.agent_id`, אחרת המנהל/ת כותב/ת לשורה של הסוכן/ת וה-RLS דוחה.
   שלב חדש נכנס בשלושה מקומות באותו PR: ה-`check` במיגרציה, ‏`LEAD_STAGES`
   ב-`assets/crm.js`, והטבלה ב-`docs/lead-card.md`. ערך שחסר ב-`check`
   נכשל רק בשמירה; ערך שחסר ב-`LEAD_STAGES` מציג גלולה ריקה.

4. **הפריסה לפי רוחב הכרטיס (`@container`), לא המסך.** הכרטיס יושב
   באקורדיון שרוחבו תלוי בתפריט הצד. `@media` היה נותן שלוש עמודות
   דחוסות במסך רחב עם תפריט פתוח. הסגנון כולו תחת `.lead-card.lc` /
   `.lc-*`, כי `.lead-card` ו-`.lead-actions` משותפים לכרטיסי נכס,
   התאמות ומיניסייט - שינוי בהם זולג לשם.

5. **טקסט שמוצג - בלי מקף ארוך**, כולל `title`, `placeholder` והודעת
   הוואטסאפ ב-`leadWhatsAppText()`. ‏`python scripts/check_long_dash.py`.

## הוספת שדה לכרטיס

- שדה של הליד: קודם `leads_masked` (מיגרציה, עמודה **בסוף** ה-view), והחלטה
  מפורשת אם הוא גלוי בליד נעול. אם לא - `case when l.status = 'unlocked'`.
- שדה של הנכס: מ-`myPropertyRows` דרך `leadPropertyContext()` - בלי
  שאילתה. עמודה שאינה ב-`PROPERTY_SELECT_COLUMNS` תצא `undefined` בשקט.
- ערך מהמסד ב-`innerHTML` עובר ב-`esc()`.

## בדיקה

אין לדשבורד שרת מקומי עם התחברות. הדרך שעבדה: לחלץ את הפונקציות מ-
`assets/crm.js` ואת ה-`<style>` מ-`crm.html` לדף בדיקה, עם stubs ל-
`currentAgent`, ‏`myPropertyRows`, ‏`allNeighborhoods` ו-`leadWork`, ולצלם
ב-Playwright ברוחב 1250 ו-390. שימו לב: ‏`#dashboard{display:none}` עד
ההתחברות, וצריך לבטל אותו בדף הבדיקה - אחרת הצילום ריק.
