# קורס ההכנה למבחן המתווכים

מוצר לצרכן/ית: קורס אינטראקטיבי להכנה לבחינת רשם המתווכים במקרקעין, נמכר
ב-₪199 כולל מע״מ לגישה של שישה חודשים. הלומד/ת נכנס/ת עם Google, לומד/ת
שיעור אחרי שיעור, עונה על חידון בסוף כל שיעור, עושה סימולציות של 25 שאלות
מתוך מבחני העבר האמיתיים, וחוזר/ת על טעויות. המנטור של שוק נדל״ן מלווה
את כל זה בבועות טקסט ובתגובה לכל תשובה.

| מה | איפה |
| --- | --- |
| דף המכירה (ציבורי, ב-sitemap) | `course.html` |
| אזור הלמידה (פרטי, `noindex`, חסום ב-`robots.txt`) | `learn.html`, `assets/learn.js` |
| הסכימה, ההרשאות והפונקציות | `supabase/migrations/20271106110000_exam_course.sql` |
| התוכן | `course/content/*.json` → `scripts/course_content_sql.py` → `supabase/migrations/<version>_course_content.sql` |
| הרכישה | `supabase/functions/course-purchase`, והסוג `course` ב-`wallet-topup-callback` |
| המחיר והפרמטרים | `pricing_config`: ‏`course_price_gross`, ‏`course_access_months`, ‏`course_exam_questions`, ‏`course_exam_pass_pct` |

## מי הלומד/ת

**משתמש/ת auth בלי שום שורה עסקית.** עד הקורס, כל מי שנכנס/ה לאתר היה/הייתה
סוכן/ת (`agency_members`), יזם/ית, בעל/ת מקצוע או צוות ההטמעה, ו-`crm.html`
מפנה חשבון Google חדש ל"פתיחת משרד". הקורס אינו עובר שם: `learn.html` עושה
‏`signInWithOAuth` משלו עם `redirectTo` ל-`/learn` (ו-`AuthReturn.remember`
לפני, למקרה שהכתובת אינה ברשימת ה-Redirect URLs של Supabase וה-OAuth נוחת
בדף הבית), ומפתח הגישה הוא `course_enrollments.user_id` → `auth.users`.
סוכן/ת שרוצה ללמוד נכנס/ת עם אותו חשבון ומקבל/ת אותו טיפול.

**הכתובת `https://shuknadlan.co.il/learn` חייבת להיות ברשימת ה-Redirect
URLs** (‏Supabase → Authentication → URL Configuration). בלעדיה הכניסה
עובדת דרך `auth-return.js` בדף הבית, עם סיבוב מיותר (`docs/google-login.md`).

## הרכישה

המכונה החמישית של `wallet-topup-callback` (‏`docs/wallet-payments.md`):

1. ‏`learn.html` שולח `POST course-purchase` עם שם וטלפון לחשבונית בלבד.
   המחיר מגיע מ-`course_price()` (‏`pricing_config.course_price_gross`), לא
   מהדפדפן.
2. ‏`start_course_order` פותחת שורת `pending` ב-`course_orders` (עד שלוש
   פתוחות לחצי שעה), ומורנינג מחזירה טופס תשלום. ה-`successUrl` הוא
   ‏`/learn?order=success&order_id=…`.
3. ה-webhook (או ה-reconcile כל 5 דקות) מאמת את התשלום מול ה-API של מורנינג
   וקורא ל-`complete_course_order`, **הפונקציה היחידה שפותחת גישה בתשלום**:
   ‏upsert ל-`course_enrollments` עם `expires_at` של שישה חודשים, מצטבר מסוף
   הגישה הקיימת אם יש.
4. ‏`learn.html` שחוזר עם `order=success` שואל את `course_me()` כל 3 שניות
   עד שהגישה נפתחת (הwebhook עלול להגיע אחרי הגולש/ת).

**המחיר כולל מע״מ**, בניגוד לכל שאר המחירון (שהוא לפני מע״מ, הסקיל
`wallet-charges`): זה מחיר לצרכן/ית, והחוק מחייב להציג אותו כולל.
‏`amount_before_vat` נגזר ממנו לרישום. אין ארנק ואין קרדיט.

**גישה בלי תשלום**: `course_grant_access(user_id, months, test_mode)` -
‏`service_role` בלבד. ‏`course-purchase` עם `test_mode: true` קורא לה
למנהל/ת פלטפורמה (כפתור בדף התשלום), ולכל אדם אחר פותחים ידנית ב-SQL
(קריאה מותרת; זו כתיבת נתונים ולא DDL).

## התוכן

**נכתב ב-JSON, נכנס במיגרציה.** `course/content/01-intro.json`,
‏`02-ethics-regulations.json`, ‏`03-past-exams.json`, ו-`exams/exam-YYYY-MM.json`
לכל מועד. ‏`scripts/course_content_sql.py` מאמת (4 חלופות, `correct` 0-3,
‏slug ייחודי) וכותב מיגרציית `upsert` לפי slug; מה שנעלם מה-JSON מסומן
‏`published = false` ואינו נמחק, כי ההתקדמות והניסיונות מצביעים עליו.

```sh
python3 scripts/course_content_sql.py --check   # אימות בלבד
python3 scripts/course_content_sql.py           # כתיבת המיגרציה (אותו קובץ כל עוד לא מוזג)
python3 scripts/course_content_sql.py --bump    # אחרי שהקודמת רצה בפרודקשן: קובץ חדש
```

**‏`--bump` ולא מחיקה:** version שכבר רשום ב-`schema_migrations` חייב להישאר
כקובץ, אחרת `db push` נשבר (‏CLAUDE.md, מיגרציות). הקובץ הישן הופך ל-`select 1`
עם הפניה לחדש.

### מבחני העבר

כל מועד הוא שיעור בפרק "מבחני עבר", ו-25 השאלות שלו הן `kind: "exam"` עם
‏`source` ("מבחן רשם המתווכים, יולי 2026, שאלה 14"). התשובה הנכונה תמיד
ממפתח התשובות הרשמי ("דו״ח גירסאות מיושר": העמודה של גרסה 1 היא המסטר),
וההסבר נכתב בידינו. שני מצבים מיוחדים שהרשם מייצר:

| במפתח | ב-JSON | מה קורה |
| --- | --- | --- |
| "כל התשובות מתקבלות" (שאלה שבוטלה) | `"published": false`, ‏`"voided": "…"` | נשארת בקובץ לתיעוד, לא נשאלת |
| שתי אותיות (שתי תשובות התקבלו) | `"accepted": [1, 3]` | כל אחת מהן נספרת כנכונה ב-`course_answer` |

‏`"needs_review": true` מסמן שאלה שההסבר שלה לא אומת מול הסעיף; הגנרטור
מדפיס את הרשימה בכל הרצה, ו**תומר/עו״ד עובר/ת עליהן לפני שמסירים את
הדגל**. המדפיס אינו חוסם.

**מועד חדש**: zip עם ארבע הגרסאות ומפתח התשובות → תמלול מהתמונות
(‏`pdftotext` מאבד את האות נ) לקובץ `exams/exam-YYYY-MM.json` לפי הצורה של
הקבצים הקיימים, `--check`, ואז הגנרטור. ה-`position` עולה עם המועד.

### גוף השיעור

‏`body_html` הוא HTML מוגבל (`p`, `ul`, `li`, `strong`, `h3`, `blockquote`)
שנכנס ל-`innerHTML` **כמו שהוא**. זה בטוח כי הטבלה נכתבת רק ממיגרציה
(‏`service_role`; ‏`authenticated` ו-`anon` מקבלים `select` בלבד). כל טקסט
אחר מהמסד (כותרות, שאלות, חלופות, הסברים) עובר `escapeHtml`. **אסור לפתוח
כתיבה לטבלאות התוכן לתפקיד אחר בלי להפוך את ה-innerHTML לסניטציה.**

## מה המסד שומר, ומי רואה

| טבלה | מי קורא | מי כותב |
| --- | --- | --- |
| `course_chapters` | כולם (`published`) | מיגרציה |
| `course_lessons` | חינמי לכולם; השאר למי ש-`course_has_access()` | מיגרציה |
| `course_questions` | **איש** (סגורה לדפדפן) | מיגרציה |
| `course_orders`, `course_enrollments` | בעליהן | הפונקציות |
| `course_progress`, `course_attempts` | בעליהן | הפונקציות |

**התשובות הנכונות אינן נשלחות לדפדפן לפני המענה.** `course_attempt_start`
מחזירה שאלות בלי `correct` ובלי `explanation`; `course_answer` בודקת במסד
ומחזירה את ההסבר (בסימולציה - רק אישור, וההסברים ב-`course_attempt_finish`).
לכן הציון ב-`course_attempts` הוא ציון אמיתי, וגם "חזרה על טעויות" נגזרת
ממנו (התשובה האחרונה על כל שאלה).

שיעור "הושלם" כשחידון עבר את `course_exam_pass_pct` (60), או מיד בפתיחה
כשאין בו שאלות. הסימולציה מגרילה `course_exam_questions` (25) שאלות, קודם
‏`kind = 'exam'` ואז תרגול, בסדר אקראי.

## מה עוד לא

- **וידאו**: `course_lessons.video_url` קיים, והנגן מציג YouTube או mp4
  ב-https. אין עדיין סרטונים. הקול של תומר, דרך הצינור של
  `marketing-video-production`.
- **פרקים על שאר החוקים** (מקרקעין, חוזים, מכר דירות, הגנת הדייר, מיסוי,
  תכנון ובנייה): כשליש מהשאלות בבחינה על חוק המתווכים, והשאר על אלה. היום
  הם נלמדים דרך מבחני העבר בלבד.
- **תעודה / מייל סיכום** אחרי סימולציה שעברה.
- **ביטול והחזר**: מדיניות 14 יום כתובה בדף, ההחזר ידני במורנינג
  (`course_orders` שומרת את מזהה המסמך).

## בדיקות

```sh
python3 scripts/course_content_sql.py --check
python3 scripts/check_pricing.py          # 199 ו-6 בשני הדפים מול pricing_config
python3 scripts/check_canonical.py        # /course ב-sitemap, /learn פרטי
python3 scripts/check_events.py           # learn אינו טוען events.js
python3 scripts/check_yoetz_copy.py       # "מבחן המתווכים" ו"דיני מתווכים" מותרים
python3 scripts/check_edge_types.py course-purchase
```
