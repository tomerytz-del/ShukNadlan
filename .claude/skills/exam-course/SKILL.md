---
name: exam-course
description: קורס ההכנה למבחן המתווכים בריפו של שוק נדל״ן - course.html (מכירה), learn.html + assets/learn.js (למידה), course_* במסד, course-purchase והסוג course ב-wallet-topup-callback, והתוכן ב-course-content/*.json שהופך למיגרציה ב-scripts/course_content_sql.py. Use when adding a past exam (a zip of four versions and an answer key), a lesson or a chapter, when changing the course price or access period, when a learner cannot log in, pay or see a lesson, when a question's answer looks wrong, when touching course_attempt_start / course_answer / course_me, or when anyone proposes writing course content directly in SQL or opening the content tables to the browser.
---

# קורס ההכנה למבחן המתווכים

המסמך: `docs/exam-course.md`. כאן רק מה שנשבר בשקט.

## 1. תוכן נכנס דרך JSON, לא דרך SQL ולא דרך הדשבורד

`course-content/*.json` ו-`course-content/exams/*.json` הם מקור האמת.
`scripts/course_content_sql.py` כותב את המיגרציה (upsert לפי slug), ומטפל
בגרשיים (מוכפלים) ובמקפים ארוכים (הופכים לרגילים). שאלה שנכתבה ישירות ב-SQL
תידרס בהרצה הבאה של הגנרטור, או תיעלם (`published = false`) כי אינה ב-JSON.

```sh
python3 scripts/course_content_sql.py --check    # לפני כל commit
python3 scripts/course_content_sql.py            # כותב/מעדכן את הקובץ של ה-version הנוכחי
python3 scripts/course_content_sql.py --bump     # רק אחרי שהקודם רץ בפרודקשן
```

**מתי `--bump`:** המיגרציה של התוכן נושאת version קבוע (`course-content/.version`).
כל עוד לא מוזגה, הרצה חוזרת מעדכנת את אותו קובץ. אחרי שרצה בפרודקשן הצינור
לא יריץ אותה שוב, ולכן תוכן חדש צריך קובץ חדש, והישן נשאר כ-`select 1` (מחיקה
שלו שוברת את `db push`).

## 2. מועד חדש של הרשם

1. ‏zip עם `version1..4` ו-`correctanswers` → לתיקייה נפרדת מחוץ לריפו.
2. **לקרוא מתמונות** (`pdftoppm -r 100 -png`), לא מ-`pdftotext`: הגופן של
   הרשם מאבד את האות נ ("בחי‪‬ה").
3. מפתח התשובות ("דו״ח גירסאות מיושר"): העמודה של גרסה 1 - אם המספרים
   1..25 בסדר, היא המסטר. לאמת 3 שאלות לוגית לפני שסומכים על המפה.
4. קובץ `exams/exam-YYYY-MM.json` בצורת הקיימים: `chapter: {slug: "past-exams"}`,
   שיעור אחד, 25 שאלות `kind: "exam"` עם `source`, ‏`position` לפי המועד.
5. "כל התשובות מתקבלות" → `"published": false`. שתי אותיות → `"accepted": [i, j]`.
   הסבר שלא אומת מול סעיף → `"needs_review": true`, ולהגיד לתומר.
6. `--check`, הגנרטור, ו-`check_long_dash.py` (התוכן מוצג לגולשים).

## 2א. שיעור חדש נכתב כצעדים

`steps` ב-JSON: `concept` / `example` / `check` (ראו `docs/exam-course.md`,
"צעדים"). כל שאלה בשיעור חייבת צעד `check`, אחרת היא נספרת כשגויה בסיום;
הגנרטור חוסם. `body_html` נשאר כטקסט המלא, ושיעור בלי `steps` מוצג כמו
קודם.

שאלת `check` שכותבים: מקרה ולא הגדרה, חלופות באורך דומה (הנכונה לא ארוכה
ביותר מ-30% מהמסיחה הארוכה; הגנרטור חוסם), והסבר בלי "חלופה ג", כי השרת
מערבב את סדר החלופות של `practice` בכל ניסיון (`option_orders`). שאלה
שנכתבה מחדש מקבלת slug חדש, אחרת ניסיון פתוח נבדק מול חלופה אחרת
(`docs/exam-course.md`, "שאלת בדיקה מהירה שכותבים בעצמנו", "סדר החלופות").

## 3. התשובות אינן בדפדפן

`course_questions` סגורה לדפדפן. השאלות מגיעות מ-`course_attempt_start` בלי
`correct`, והבדיקה ב-`course_answer`. מי שמוסיף/ה `select` ל-`authenticated`
על הטבלה, או מחזיר/ה `correct` מ-`attempt_start` "כדי לחסוך קריאה", הופך/ת
כל ציון לציון שאפשר לזייף ומשחרר/ת את מאגר השאלות המשולם.

ובאותו כיוון: `body_html` נכנס ל-`innerHTML` כמו שהוא, כי רק `service_role`
כותב לטבלאות התוכן. פתיחת כתיבה לתפקיד אחר דורשת סניטציה קודם.

## 4. הקונה/ה אינו/ה סוכן/ת

`course_enrollments.user_id` → `auth.users`. אין `agency_members`, אין ארנק,
אין `resolveAgent`. המחיר **כולל מע״מ** (מחיר לצרכן/ית) ולכן `course_price()`
מחשב `amount_before_vat` מהברוטו, הפוך מ-`vat_gross` של הארנק. פונקציה
שמוסיפה מע״מ כאן גובה אותו פעמיים.

שינוי מחיר: מיגרציה ל-`pricing_config.course_price_gross`, ‏`PRICES` ו-`DISPLAY`
ב-`check_pricing.py`, ‏`course.html` ו-`assets/learn.js` (מסך התשלום נבנה
ב-JS, ולכן התבניות מצביעות לשם ולא ל-`learn.html`; הסקיל `pricing-change`).

## 4א. הנגן מצייר הכל ב-JS, ונבדק בלי מסד

`learn.html` הוא CSS ו-`#app` ריק; כל מסך נבנה ב-`assets/learn.js`
(`docs/exam-course.md`, "המסכים"). שינוי במסך נבדק ב-Playwright מול לקוח
supabase מדומה (‏`addInitScript` שמגדיר `window.supabase.createClient`,
וחסימת ה-CDN), ב-390 וב-1280, כי מה שמוצג רק ברוחב אחד מוסתר ב-CSS ואי
אפשר לראות בשני הרוחבים ממסך אחד.

## 5. כניסה: `/learn` ברשימת ה-Redirect URLs

`learn.html` עושה `signInWithOAuth` עם `redirectTo: /learn`. אם הכתובת אינה
ברשימה של Supabase, ה-OAuth נוחת בדף הבית ו-`auth-return.js` מחזיר אותו -
עובד, אבל עם סיבוב. "הלומד/ת נכנס/ת ורואה את דף הבית" = הכתובת חסרה ברשימה.

## 6. רשימות שקורס נוגע בהן

| מה | איפה |
| --- | --- |
| הטבלה החמישית של ה-reconcile | `KINDS` ב-`wallet-topup-callback`, ותנאי ה-cron במיגרציה |
| `/learn` פרטי | `robots.txt`, ‏`PRIVATE` ב-`check_canonical.py`, ‏`PRIVATE_PAGES` ב-`check_events.py` |
| `/course` ציבורי | `sitemap.xml`, ‏canonical בדף |
| `course_catalog` פתוח ל-anon | `PUBLIC_RPC` ב-`ops_agent/config.py` |
| קודי שגיאה חדשים | `RULES` ב-`assets/friendly-error.js` |
| "מבחן המתווכים", "דיני מתווכים" | `ALLOWED` ב-`check_yoetz_copy.py` |
