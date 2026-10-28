# קליקים וייחוס ביקור ראשון

קישור שסוכן יצירת לידים מדביק בתגובה בקבוצת פייסבוק, ספירת הקליקים,
וכמה מהם הפכו לליד או להרשמה. GA4 (מכולה `GTM-NZHD7ZHT`) ממשיך לראות
את הביקור, כי ההפניה נושאת UTM. המסד סופר את אותו קליק בלי כתובת IP.

זה אינו פרסום ממומן ואינו נוגע בפרסום האורגני לוואטסאפ.

## הקישור

```
https://shuknadlan.co.il/go/seeker-e
https://shuknadlan.co.il/go/seeker-e?v=a1&sl=<uuid>
```

`v` הוא וריאנט אופציונלי. `sl` הוא מזהה אופציונלי של `scraped_leads`,
בלי מפתח זר: מזהה לא תקין או חסר לא מפיל את הרישום ולא עובר לכתובת
היעד.

כל GET מחזיר **302** אל:

```
https://shuknadlan.co.il/?utm_source=facebook&utm_medium=group_comment&utm_campaign=seeker_link&utm_content=seeker-e
```

היעד תמיד `https://shuknadlan.co.il/`. פרמטר בקישור אינו יכול להפנות
החוצה. קוד בפורמט slug (אותיות לטיניות קטנות, ספרות ומקף, עד 32 תווים)
שאינו במפה עדיין מפנה הביתה ונרשם. קוד שאינו slug מפנה הביתה בלי רישום.

| קוד | utm_campaign |
| --- | --- |
| `seeker-e` (במפה) וכל קוד שמתחיל ב-`seeker` | `seeker_link` |
| קוד שמתחיל ב-`office` או `broker` | `office_signup` |
| כל slug אחר | `group_comment` |

`utm_content` הוא תמיד הקוד. המפה יושבת ב-`CODE_UTM` ב-
`netlify/edge-functions/go-link.ts`.

ההפניה אינה מחכה למסד. כשל או timeout של 800ms לא משנים את ה-302.
התשובה היא `no-store` בשתי כותרות המטמון, כדי שקליק לא ייבלע ב-CDN.

תצוגה מקדימה וסורק (למשל `facebookexternalhit`) נרשמים עם `is_bot =
true`. מחרוזת ה-UA אינה נשמרת. בדוח הם יוצאים מ-`clicks` ונספרים ב-
`bot_clicks`.

`/go` חסום ב-`robots.txt`. זו הפניה, לא עמוד.

## מה נשמר

`link_clicks`: `code`, `created_at`, `variant`, `scraped_lead_id`,
`is_bot`. אין IP ואין מזהה דפדפן.

הכתיבה היא `record_link_click`. היא בודקת את השדות ומכניסה רק אותם.
הטבלה סגורה ב-RLS בלי policy. `anon` ו-`authenticated` לא קוראים ולא
כותבים אליה. `anon` רשאי **להריץ** את הפונקציה, כי ל-edge של Netlify
אין מפתח service role (אותו מפתח anon שכבר יושב ב-`short-link.ts`).
ניפוח ספירה אפשרי. אין דרך לקרוא ממנה שורות או לכתוב ליד.

## ייחוס על ליד והרשמה

`assets/visit-attr.js` נטען מדפי האתר (דרך `events.js`, ומדפי ההרשמה
ומה-CRM בנפרד). הוא שומר ב-`localStorage` ל-90 יום את
`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, ואת הקוד
(`utm_content`). **ביקור ראשון מנצח.** אין שליחה ל-`dataLayer`.

בשליחת טופס השדות נכנסים לגוף כ-`visit_attr`. השרת מעתיק רק slug תקין
(עד 40 תווים) אל העמודות. שדה אחר באובייקט נזרק.

| טבלה | kind בדוח |
| --- | --- |
| `leads` | `lead` |
| `mortgage_leads` | `mortgage_lead` |
| `saved_searches` | `saved_search` |
| `project_leads` | `project_lead` |
| `agencies` | `office_signup` |
| `developers` | `developer_signup` |
| `newsletter_subscribers` | `newsletter` |

העמודות nullable. אין מילוי לאחור. שורה ישנה נשארת בלי ייחוס.

`anon` אינו יכול לכתוב לטבלאות האלה (`revoke insert, update`).
`authenticated` (ה-CRM) נשאר כותב את השדות שהיו לו, וטריגר
`visit_attr_lock` מונע ממנו ומ-`anon` לשנות את חמש העמודות.
`service_role` בפונקציות הקליטה הקיימות הוא מי שכותב אותן. ניתוב,
התראות ווואטסאפ לא השתנו.

אם המיגרציה עוד לא רצה, ה-insert חוזר על אותה שורה בלי העמודות. ליד
והרשמה לא נופלים על עמודה חסרה.

לא מיוחס כאן: הצטרפות לכרטיס בעל מקצוע (`ad_placements`) והצטרפות
סוכן/ת למשרד קיים (`join-agency`).

`assets/bot-link.js` ממשיך לשמור `utm_source:utm_campaign` ל-session
של הודעת הפתיחה לגבריאלה. זה מסלול נפרד.

## דוחות

רק `service_role`. ב-SQL editor או ב-`execute_sql`:

```sql
select day, code, variant, clicks, bot_clicks
  from public.link_click_daily
 order by day desc, code;

select day, kind, attr_source, attr_medium, attr_campaign, attr_content, attr_code, conversions
  from public.visit_attribution_daily
 order by day desc, kind, attr_code;
```

שורה בלי אף שדה `attr_` אינה בדוח השני.

## שמירה

אין בטבלה מידע אישי, ולכן היא לא נכנסה ל-`data_retention_run`.
ההצעה היא 400 יום, והפונקציה אינה ב-cron:

```sql
select public.link_clicks_purge(400);
```

פחות מ-30 יום נדחה, כדי שקריאה עם 0 לא תרוקן את הטבלה.

## עליה לאוויר

לא להחיל את המיגרציה מהדשבורד ומ-`apply_migration`. המיזוג ל-`main`
מריץ אותה ב-Actions.

1. אישור נפרד לעליה לאוויר.
2. מיזוג. Netlify מפרסם את `/go` ואת `visit-attr.js` תוך שניות.
   המיגרציה ופונקציות הקליטה עולות דקות אחריו. בחלון הזה ההפניה עובדת
   גם אם הרישום נכשל, וטופס ליד נשמר גם אם העמודות עוד לא קיימות.
3. מבט ב-Actions: מיגרציות ירוקות, ופונקציות Supabase ירוקות.

אין סוד חדש.
