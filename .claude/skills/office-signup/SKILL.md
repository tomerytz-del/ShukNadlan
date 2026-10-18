---
name: office-signup
description: עבודה על מסלול ההצטרפות של משרד חדש בריפו של שוק נדל״ן - agency-signup.html, מסך הכניסה ב-crm.html, טופס הפתיחה במסלול Google, הכניסה האוטומטית אחרי ההרשמה, חלון "ברוכים הבאים", מדריך ההתחלה (שבעה צעדים בשני שלבים: רישיון, פרופיל, נכס; גבריאלה, לקוח/ה, יומן, העדפות לידים), ומה מבקשים ומתי (טלפון בהרשמה, ת.ז. בהסכם הראשון, יומן Google בפגישה הראשונה); וגם ערכות העיצוב ותמונת הנושא של המשרד שחלות על כל הסוכנים (assets/agency-theme.js). Use when adding or removing a field in office signup, changing the signup or login copy, touching signInAfterSignup / maybeShowWelcome / ONB_STEP_DEFS / assets/crm-onboarding.js / agent_onboarding_state / agent_license_ok, when a new office "has to log in again" after signup, when asking the agent for a new permission or personal detail, or when touching office colors, page background or cover photos (BRAND_PALETTES, BRAND_DEFAULT, agency.html applyBranding, agent.html). Also when a new office sees nothing under "נכסים ששותפו איתי" (agencies_share_backfill).
---

# הצטרפות משרד, מדריך ההתחלה, ועיצוב המשרד

המסמכים: `docs/agent-onboarding.md`, `docs/agency-page.md` (סעיף 10),
`docs/google-calendar.md`, `docs/client-agreements.md`. כאן מה ששובר בשקט.

## מה מבקשים ומתי - וזה הכלל, לא הנוסח

| שלב | מה מבקשים | למה הסוכן/ת מאשר/ת |
| --- | --- | --- |
| הרשמה | שם משרד, **כתובת המשרד המלאה** (שדה אחד), **האזורים להצגת המשרד**, שם, **טלפון נייד**, רישיון, אימייל, סיסמה | "אני רוצה לראות את המערכת עובדת מיד" |
| ההסכם הראשון | ת.ז. / ח.פ (`askAgentIdNumber`) - נשמרת **מוצפנת**, והדפדפן רואה רק 4 ספרות (`docs/id-numbers.md`) | "ההסכם חייב להיות תקף לפי חוק" |
| הפגישה הראשונה | הרשאת יומן Google (`offerGcalAfterMeeting`, `agendaGcalOffer`) | "אני רוצה שהפגישה תופיע ביומן" |

**שדה חדש בהרשמה הוא החלטה ולא תוספת.** כל שדה שאינו נחוץ כדי לראות את
המערכת עובדת עובר לרגע שבו יש לו סיבה. הת.ז. וההרשאה ליומן הוצאו מהרשמה
בדיוק מהסיבה הזו - מי שמחזיר/ה אותן מחזיר/ה את הנשירה.

**כתובת ואזורים - שתי שאלות, ואין בחירת עיר.** הכתובת המלאה נשמרת ב-
`agencies.address`, והטריגר `agencies_set_city_id` גוזר ממנה את העיר (שוק
הבית). "באילו אזורים להציג את המשרד?" הם צ'יפים מרשימת השווקים
(`assets/agency-markets.js`, לפחות אחד), שהשרת שומר ב-`service_markets` של
המנהל/ת (`cleanServiceMarkets`) - אותו שדה של אזורי הפעילות בפרופיל. לא
להחזיר בורר עיר: עיר שנשאלה עם "איפה המשרד פעיל?" היא מה שבלבל, ואזור
ההצגה הוא השאלה שהעיר ניסתה לענות עליה (`docs/regional-pages.md`). האזורים
נשמרים בעדכון נפרד, כמו הנייד, ולא בתוך ה-INSERT.

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

## מדריך ההתחלה - שבעה צעדים בשני שלבים, והמצב במסד

להופיע באתר: רישיון, תמונה + משפט עליך (20 תווים) + אזורי שירות, נכס ראשון.
להתחיל לעבוד: גבריאלה, לקוח/ה ראשון/ה, יומן Google, העדפות לידים. ועוד צעדי
רשות (תמונת נושא, חוות דעת, ולמנהל/ת המשרד והזמנת סוכנים). התנאים ב-
`agent_onboarding_state()` (`20270601170000_onboarding_seven_steps.sql`),
והכרטיס ב-`assets/crm-onboarding.js` (`ONB_STEP_DEFS`) קורא את הדגלים - **לא
מחשב שוב**. צעד שמשתנה משתנה בשניהם באותו PR; אחרת הכרטיס אומר "נשאר צעד"
והמדריך כבר נסגר, או להפך. פירוט: `docs/agent-onboarding.md`.

* **רישיון מאושר = `agent_license_ok()`**, אותה פונקציה ששחרור המודעות קורא
  לה. אל תכתבו תנאי שני.
* **יומן Google הוא צעד** (החלטה של תומר, שלב 7), וההצעה אחרי הפגישה הראשונה
  נשארת למי שדילג/ה. גבריאלה והיומן מגודרים ל-mid/premium ולא נספרים בלעדיהם.
* מנהל/ת שאינו/ה סוכן/ת פעיל/ה רואה רק את צעדי המשרד (`agent_steps`).
* "חיבור גבריאלה בלחיצה" פותח את הצ'אט כשיש `currentAgent.phone`, וזה נכון
  רק כי הטלפון נשאל בהרשמה.
* **באנדרואיד הצ'אט נפתח בוואטסאפ ביזנס** (`assistantWaUrl` ב-`crm.js`:
  ‏`intent://` עם `com.whatsapp.w4b`, וגיבוי ל-wa.me למי שאין ביזנס). גבריאלה
  מזהה לפי **המספר ששולח**, ולכן בכרטיס "חיבור גבריאלה" יש גם "המספר הרשום שלי
  בוואטסאפ הרגיל" (`waStartAlt`). מי שמוסיף/ה פתח חדש להודעה הראשונה לגבריאלה -
  דרך `assistantWaUrl`, לא `wa.me` ישיר.

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

## משרד חדש מקבל את נכסי השת"פ ברגע שנוצר

הטריגר `agencies_share_backfill` (‏`after insert on agencies`) מוסיף את המשרד
להפצה של כל נכס פעיל שפתוח לשת"פ, בלי התראות. לכן "נכסים ששותפו איתי"
והתאמות ממשרדים אחרים קיימים מהיום הראשון, ואין מה להוסיף בזרימת ההרשמה.
**מסלול חדש שיוצר משרד** (פונקציה, ייבוא, מיגרציה) מקבל את זה מעצמו - גם
משרד בדיקה. כשל בהשלמה נבלע ב-`warning` ואינו מפיל הרשמה. הסקיל
`client-matching`, סעיף 4ד.

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
