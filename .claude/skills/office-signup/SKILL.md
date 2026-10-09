---
name: office-signup
description: עבודה על מסלול ההצטרפות של משרד חדש בריפו של שוק נדל״ן - agency-signup.html, מסך הכניסה ב-crm.html, טופס הפתיחה במסלול Google, הכניסה האוטומטית אחרי ההרשמה, חלון "ברוכים הבאים", מדריך ההתחלה (שלושה צעדים, ולמנהל/ת גם "על המשרד"), ומה מבקשים ומתי (טלפון בהרשמה, ת.ז. בהסכם הראשון, יומן Google בפגישה הראשונה); וגם ערכות העיצוב ותמונת הנושא של המשרד שחלות על כל הסוכנים (assets/agency-theme.js). Use when adding or removing a field in office signup, changing the signup or login copy, touching signInAfterSignup / maybeShowWelcome / ONBOARD_STEPS / agent_onboarding_state, when a new office "has to log in again" after signup, when asking the agent for a new permission or personal detail, or when touching office colors, page background or cover photos (BRAND_PALETTES, BRAND_DEFAULT, agency.html applyBranding, agent.html).
---

# הצטרפות משרד, מדריך ההתחלה, ועיצוב המשרד

המסמכים: `docs/agent-onboarding.md`, `docs/agency-page.md` (סעיף 10),
`docs/google-calendar.md`, `docs/client-agreements.md`. כאן מה ששובר בשקט.

## מה מבקשים ומתי - וזה הכלל, לא הנוסח

| שלב | מה מבקשים | למה הסוכן/ת מאשר/ת |
| --- | --- | --- |
| הרשמה | שם משרד, **כתובת המשרד** (רחוב + עיר מהרשימה), שם, **טלפון נייד**, רישיון, אימייל, סיסמה | "אני רוצה לראות את המערכת עובדת מיד" |
| ההסכם הראשון | ת.ז. / ח.פ (`askAgentIdNumber`) | "ההסכם חייב להיות תקף לפי חוק" |
| הפגישה הראשונה | הרשאת יומן Google (`offerGcalAfterMeeting`, `agendaGcalOffer`) | "אני רוצה שהפגישה תופיע ביומן" |

**שדה חדש בהרשמה הוא החלטה ולא תוספת.** כל שדה שאינו נחוץ כדי לראות את
המערכת עובדת עובר לרגע שבו יש לו סיבה. הת.ז. וההרשאה ליומן הוצאו מהרשמה
בדיוק מהסיבה הזו - מי שמחזיר/ה אותן מחזיר/ה את הנשירה.

**כתובת המשרד אינה אזור הפעילות.** העיר בכתובת קובעת את שוק הבית; אזורי
הפעילות נבחרים בפרופיל מרשימת השווקים (`service_markets`). לא להחזיר להרשמה
הנחיה כמו "איפה המשרד פעיל?" - היא מה שבלבל (`docs/regional-pages.md`).

ושני הטפסים זהים בתוכן: `agency-signup.html` ו-`#createAgencyScreen` ב-
`crm.html` (מסלול Google). שדה שנוסף לאחד ולא לשני נעלם בשקט אצל חצי
מהנרשמים.

## הכניסה האוטומטית - אין להחזיר את "אפשר להתחבר עכשיו"

`agency-signup` יוצר/ת את המשתמש/ת עם `email_confirm`, ולכן הדף נכנס מיד:
`signInAfterSignup()` שולח/ת ל-GoTrue (`/auth/v1/token?grant_type=password`)
ושומר/ת את התשובה ב-`sb-<ref>-auth-token` - המפתח שבו supabase-js ב-CRM
מחפש session. אחר כך `WELCOME_KEY` ב-`sessionStorage` ו-`location.replace('/crm')`.

* **המבנה הוא מה שהספרייה כותבת בעצמה** (כולל `expires_at` ו-`user`). שינוי
  של `createClient` ב-CRM (`storageKey`, `storage`) שובר את זה בלי שגיאה -
  הנרשם/ת פשוט נוחת/ת במסך הכניסה.
* **הכניסה נעשית גם כשהרישיון לא אומת.** כרטיס הרישיון בדשבורד מטפל בזה.
  `stateBlocked` / `stateDone` בדף ההרשמה הם רק גיבוי לכשל בכניסה.
* `WELCOME_KEY` מוגדר בשני הקבצים (`agency-signup.html`, `assets/crm.js`),
  אותו ערך. `markWelcome()` מדליק אותו גם במסלול Google.

## הטלפון - נשמר, לא חוסם

`manager_phone` עובר `normalizeMobile` (אותו כלל של `add-team-member`: נייד
ישראלי בצורה מקומית) ונשמר **בעדכון נפרד** אחרי יצירת הכרטיס. מספר שכבר
רשום אצל אחר/ת נופל על האינדקס הייחודי של `phone_e164` (‏23505) - והמשרד
עדיין נפתח. אל תעבירו אותו לתוך ה-INSERT: אז 23505 מפיל משרד שלם.

## מדריך ההתחלה - שלושה צעדים (ולמנהל/ת ארבעה), והמצב במסד

גבריאלה, נכס ראשון, תמונת פרופיל (ולמנהל/ת לוגו), ולמנהל/ת "על המשרד"
(‏`agencies.description`, ‏`about_done`, ‏`20270328090000`). התנאים ב-
`agent_onboarding_state()` / `agent_onboarding_photos_done()`
(`20270318090000_onboarding_three_steps.sql`), והכרטיס ב-`ONBOARD_STEPS`
קורא את הדגלים - **לא מחשב שוב**. צעד שמשתנה משתנה בשניהם באותו PR; אחרת
הכרטיס אומר "נשאר צעד" והמדריך כבר נסגר, או להפך.

* יומן Google **אינו** צעד. ראו הטבלה למעלה.
* "חיבור גבריאלה בלחיצה" פותח את הצ'אט כשיש `currentAgent.phone`, וזה נכון
  רק כי הטלפון נשאל בהרשמה.

## עיצוב המשרד - של המשרד, לכל הסוכנים

* **מנהל/ת בלבד.** ה-RLS `manager update own agency` על `agencies`. לסוכן/ת
  אין צבעים, רקע או תמונת נושא אישיים: `agency_members.page_bg` ו-
  `agency_members.cover_url` נשארו במסד ואינם נקראים. מי שמחזיר/ה קריאה שלהם
  ב-`agent.html` או ב-`home.js` מחזיר/ה עיצוב אישי שהוסר.
* **חמש ערכות וברירת מחדל, בלי בוררים חופשיים** (`BRAND_PALETTES`,
  `BRAND_DEFAULT`). ערכה חדשה עוברת קודם בדיקת ניגודיות: ראשי כהה על הנייר
  ומשני כהה על הכרטיסים, 4.5:1. `BRAND_PALETTES[0]` הוא גם הבסיס של דוח
  ה-CMA - לא מחליפים סדר.
* **ברירת המחדל נשמרת בלי מפתחות צבע** (`palette:'default'`). כל דף שקורא
  `agencies.colors` נופל לטוקנים של עצמו. שמירה של צבעי האתר כערכים הייתה
  מקפיאה עותק שלא מתעדכן.
* **`assets/agency-theme.js` הוא העתק של `applyBranding` ב-`agency.html`**
  (בלי תמונת הנושא). שינוי בחישוב צבע הטקסט על גוון המשרד נעשה בשניהם, אחרת
  דף הסוכן/ת ודף המשרד מאותה ערכה נראים שונה.

## לבדוק לפני הדחיפה

אין מכאן רשת ל-Supabase, ולכן בודקים מסכים מול שרת מדומה: השרת של
`perf-measure` מגיש את הדפים, ו-Playwright (`/opt/node22/lib/node_modules/playwright`,
`executablePath: '/opt/pw-browsers/chromium'`) מיירט את `*.supabase.co`
ואת ה-CDN (`npm pack @supabase/supabase-js@2.116.0` נותן את ה-UMD). לעבור על:
הטופס, הלחיצה (נוחתים בדשבורד עם החלון), כרטיס הרישיון כשהוא לא מאושר,
ושני מסכי הגיבוי כשהכניסה נכשלת.

```sh
python scripts/check_long_dash.py
python scripts/check_migration_versions.py --base-ref origin/main
python scripts/check_function_grants.py
python scripts/check_edge_types.py   # אם נגעת ב-agency-signup / create-own-agency / הבוט
```
