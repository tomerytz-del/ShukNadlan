---
name: lead-card
description: כרטיס הליד ב-CRM של שוק נדל״ן - buildLeadCard / buildLeadWork / buildLeadTab ב-assets/crm.js, ה-container query, ליד נעול מול פתוח (leads_masked), ושלב והערה ב-lead_work. Use when adding a field or button to the lead card, when a locked lead shows what it should not, when changing lead stages, when the card looks wrong on phone, or when touching the lead archive (archiveLead, lead_archives) or visitor grouping (lead_visitor_groups).
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

6. **כפתור שמוציא מידע על הליד החוצה** (כמו "🧭 שאל את המנטור",
   `coachAskAboutLead`) מוציא רק את מה שמתאר את הצורך - סוג, עסקה, נכס,
   זמן ושלב. לא שם, טלפון, הודעה, עיר או כתובת, גם בליד פתוח: המודל לא צריך
   אותם, והשאלה נשמרת ביומן `coach_questions`.

## ארכיון וקיבוץ לפי פונה

- **ליד בארכיון הוא ליד שנסגר.** השלב שלו תמיד `not_relevant` או `won`
  (`LEAD_FINAL_STAGES`). ליד פתוח נשאל לפני הארכוב (`askLeadArchiveStage`);
  נעול אינו נשאל. המסד הוא הרשת: `lead_archive_finalize` (טריגר על
  `lead_archives`) מסיים את השלב, מבטל את המשימה האוטומטית `lead_followup`
  ומסמן את ההתראות של הליד כנקראו, ו-`lead_work_guard_archived` חוסם שלב פתוח
  לליד בארכיון. פתח חדש שמארכב ליד כותב ל-`lead_archives` ולא עוקף אותה - אחרת
  הליד ממשיך לתזכר. פגישה ידנית ביומן **אינה** מבוטלת, בכוונה.
- **קיבוץ לפי טלפון במסד, בלי לחשוף אותו.** ‏`lead_visitor_groups()` מחזירה
  לכל ליד את מזהה הליד הראשון של אותו/ה פונה. אל תקבצו בדפדפן לפי
  `display_phone` - בליד נעול הוא ממוסך, ושני טלפונים שונים נראים זהים.
  ‏`expandedLeadIds` מחזיק גם את מפתחות הקבוצות (`'v:' + visitor_id`), ו-
  `openLeadFromParam` פותח את הקבוצה של הליד.
- הפרטים: `docs/lead-card.md`, "לידים של אותו/ה פונה" ו"ארכיון = ליד שנסגר".

## הלידים המאוחדים: כל פנייה היא ליד, פעם אחת

מאז 20.10.2026 (`20270712090000_leads_unify.sql`, ‏`docs/leads-unified.md`) "הלידים
שלי" הוא **מסך אחד**, עם כרטיס עדיפות (`buildLeadPriorityCard` ב-`assets/crm-leads.js`)
לצד הכרטיס המפורט שלמעלה. מה שנשבר בשקט:

- **שיחה ממספר שאינו בקובץ וליד שנרכש בחנות נכנסים ל-`leads` במסד**, בטריגר
  (`agent_call_to_lead`, ‏`lead_type = 'call'`), ולא מתאחדים בדפדפן. פתח חדש שיוצר
  פנייה (סוג פנייה חדש, מקור חדש) נכנס גם הוא ל-`leads` - אחרת הוא חסר בסדר העדיפות,
  בספירות ובדאשבורד המשרד.
- **‏`origin_id` + `lead_type` ייחודיים.** הליד של שיחה נושא את מזהה השיחה. כתיבה
  חדשה היא `on conflict do nothing` / עדכון, לא `insert` עיוור: טריגר שרץ פעמיים
  או backfill שרץ שוב לא יוצרים ליד שני. שיחה מאותו מספר בתוך 30 יום מצטרפת לליד
  הפתוח.
- **המקור אחיד** (`leadSrcKey`: ‏`owner` / `store` / `call` / `prop` / `agent` / `site`),
  והסדר הוא העדיפות - בעלים ← נרכש ← שיחה ← פנייה מהאתר (`LEAD_PRIO`, ‏`leadsPrioritySort`,
  ‏`leadsPriorityGroups`, משותפים עם דף הבית). מקור חדש נכנס בארבעה מקומות: `leadSrcKey`,
  ‏`LEAD_SRC` (תווית, גוון ו"למה עכשיו"), ‏`LEAD_PRIO`, ו-`LEAD_SRC_FILTERS` אם יש לו צ'יפ.
  מקור שחסר ב-`LEAD_PRIO` נותן `NaN` בהשוואה, והמיון נופל לתאריך בלבד - בשקט.
- **ליד מפוסט בפייסבוק** (`source` = `facebook_group` / `facebook_marketplace`,
  ‏`lead_type` = `owner_inbound` או `seeker_inbound`) נולד רק אחרי הסכמה, ונספר
  תחת "רשתות חברתיות" (`LEAD_SOCIAL_SOURCES`). ליד בעלים ממנו נשאר "לידי בעלים".
  ‏`seeker_inbound` מקבל ענף משלו ב-`leadKind`, ובלעדיו הוא נופל ל"ליד קונה".
- **הלשונית "ביקוש פתוח" אינה לידים**: היא נטענת מ-`open_demand_list()` רק
  כשנפתחת (`renderOpenDemand`), בלי שלב, ארכיון, חיוג או וואטסאפ - רק
  "לפוסט המקורי" וההנחיה להגיב בפייסבוק. ‏`leadsTab = 'demand'` עוצר את
  `renderLeadsUnified` לפני הצ'יפים. אל תכניסו אותה ל-`allLeads`. הסקיל
  `scraped-leads`.
- **מה שזוהה בשיחה נקרא מהשיחה, לא מהליד** (`leadCallById` ← `agent_calls.extracted`):
  התגיות (`leadCallFacts`), השם, ו"השיחה לא הסתיימה" (`callCutOff`). הסקיל `call-tracking`.
- כפתורי "התקשרות" ו"וואטסאפ" בכרטיס העדיפות קוראים ל-`markLeadResponded` **ו**
  מקדמים ל"יצרתי קשר" - כלל 2 למעלה חל גם עליהם.

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
