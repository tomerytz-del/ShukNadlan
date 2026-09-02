# פריסת Edge Functions

## הבעיה שזה פותר

שלושה דברים עולים לאוויר בכל מיזוג ל-`main`, ועד עכשיו רק שניים מהם היו
אוטומטיים:

| מה | מי מפרס | מתי |
|---|---|---|
| ‏HTML/CSS/JS | Netlify | שניות מהמיזוג |
| מיגרציות | `.github/workflows/supabase_migrations.yml` | במיזוג |
| ‏**Edge Functions** | **אף אחד** | **כשמישהו זכר** |

והתוצאה הייתה בדיוק מה שאפשר לצפות: ארבע פונקציות ישבו בריפו בלי להיות
באוויר — `property-visualize`, `property-visualize-base`,
`classify-property-images` ו-`property-marketing-publish`.

הכשל הזה שקט במיוחד, כי הוא לא נראה כמו כשל. דף הנכס הציג את סקציית
ההדמיות, הגולש/ת מילא/ה שם וטלפון, הטופס נשלח — והבקשה חזרה 404 מפונקציה
שמעולם לא נפרסה. כלומר מנגנון ההדמיות "עבד" במשך חודש בלי לייצר ולו הדמיה
אחת, ובלי שאיש ידע.

מכאן `.github/workflows/supabase_functions.yml` מפרס בכל מיזוג ל-`main`
שנוגע ב-`supabase/functions/**`.

## ‏config.toml — החלק שחייבים להבין לפני שנוגעים

‏**`supabase functions deploy` מניח `verify_jwt = true` לכל פונקציה שאין לה
ערך מפורש ב-`supabase/config.toml`.**

זה לא פרט טכני. בלי הקובץ הזה, הפריסה האוטומטית הראשונה הייתה מדליקה אימות
‏JWT על כל נקודות הקצה הציבוריות — טופס יצירת הקשר בדף הנכס, הרשמת משרד,
הוובהוק של וואטסאפ, ה-cron של ההתראות — וכולן היו מתחילות להחזיר 401
לגולשים אנונימיים. פריסה אחת, חצי אתר מושבת, בלי שגיאה אחת בקוד.

לכן `supabase/config.toml` מחזיק `verify_jwt` מפורש **לכל 21 הפונקציות
שבריפו**, והערכים הועתקו אחד לאחד ממה שפרוס בפועל ולא נכתבו מחדש.
ה-workflow נכשל מראש אם נוספה פונקציה בלי סעיף משלה — כלומר אי אפשר לשכוח.

> **שינוי `verify_jwt` בקובץ הזה הוא שינוי אבטחה.** ‏`false` אומר שהפונקציה
> אחראית לאימות בעצמה (סוד cron, טוקן חד-פעמי, service role) או שהיא נקודת
> קליטה ציבורית מכוונת. לכל שורה שם יש הערה שמסבירה למה.

## מה צריך להגדיר פעם אחת

סוד אחד — **Settings → Secrets and variables → Actions → New repository secret**:

- **שם:** `SUPABASE_ACCESS_TOKEN`
- **ערך:** טוקן אישי מ-https://supabase.com/dashboard/account/tokens

> ⚠️ **Secret ולא Variable.** זו בדיוק התקלה שהשביתה את workflow המיגרציות
> ב-16 הרצות רצופות: סוד ריק לא נכשל בהודעה ברורה אלא בשגיאה שנראית כמו
> משהו אחר. ה-workflow כאן בודק את הסוד מפורשות לפני שהוא נוגע בפרויקט.

ה-`project_ref` עצמו (`obookujgolazrwycsiyn`) יושב ב-`env` של ה-workflow
ולא ב-Secrets: הוא גלוי ממילא בכל דף באתר, ב-`SUPABASE_URL` שב-HTML.

## מה נפרס בכל הרצה

| מה השתנה במיזוג | מה נפרס |
|---|---|
| תיקייה של פונקציה אחת | רק היא |
| כמה תיקיות | רק הן |
| ‏`_shared/**` | **הכול** |
| ‏`config.toml` | **הכול** |
| כלום מהנ״ל | כלום — ההרצה מסתיימת בהצלחה |

‏`_shared` גורר פריסה מלאה כי הבאנדל נבנה **בזמן הפריסה**: שינוי בקוד
המשותף לא מגיע לאף פונקציה עד שהיא עצמה נפרסת מחדש. פריסה חלקית הייתה
משאירה חלק מהפונקציות עם הגרסה הישנה של אותו קובץ.

**הרצה ידנית** (לשונית Actions → Run workflow) מאפשרת שני מצבים: `function`
לפריסת פונקציה יחידה, או `deploy_all` לפריסת הכול.

הפריסה היא פונקציה-אחר-פונקציה ולא `deploy` גורף, כדי שכישלון יזוהה בשם.
הלולאה לא נעצרת באמצע — פונקציה שנכשלה לא מונעת מהשאר לעלות — וקוד היציאה
נקבע בסוף לפי מה שנכשל.

## הריפו והפרודקשן מסונכרנים

**29 פונקציות פרוסות, 29 בריפו, אותן 29.** זה לא היה המצב: תשע פונקציות היו
פרוסות בלי שום קוד בגרסאות —

```
lead-claim · property-inquiry-intake · agent-direct-inquiry-intake
promote-property · wallet-topup · news-ticker-crawler
afula-planning-lookup · dev-switch-mode · geocode-address
```

— ובהן `property-inquiry-intake` (טופס יצירת הקשר בדף הנכס) ו-
`afula-planning-lookup`, שתיים מהנתיבים החמים באתר. הן הורדו מהפרויקט
כפי שהן ונכנסו לריפו, כל אחת עם סעיף `verify_jwt` משלה.

המשמעות המעשית: מהיום אין קוד רץ שאין לו מקור אמת בגרסאות. עריכה של פונקציה
דרך הדשבורד תידרס בפריסה הבאה — וזה בדיוק הרצוי, כי הריפו הוא המקור.

> **בפריסה הראשונה אחרי המיזוג**, כל תשע יזוהו כשינוי וייפרסו. הקוד שלהן
> הוא העתק מדויק של מה שרץ בפרודקשן, ולכן זו אמורה להיות פעולה ללא שינוי
> התנהגות — אבל זו ההרצה שכדאי להסתכל בה, ולא לסמוך עליה בעיוורון.

### הנקודה שנחשפה בהורדה — ומה נמצא כשבדקנו אותה

ההערה שנכתבה כאן קודם אמרה ש-`news-ticker-crawler` היא **היחידה** מבין
הפונקציות עם `verify_jwt = false` שאין לה אימות עצמי. הבדיקה בפועל מצאה
תמונה רחבה יותר, ושלושת הממצאים טופלו:

**‏1. `news-ticker-crawler` — נפרשה.** לא היה לה שום אימות: לא סוד cron, לא
‏service role, ואפילו לא בדיקת method — קריאת `GET` מהדפדפן הריצה את הזחילה
המלאה על חשבון `ANTHROPIC_API_KEY`. במקביל התברר שמנוע ה-Python
(‏`news_scraper.py`, כל שעתיים ב-GitHub Actions) כבר החליף אותה לגמרי, והיא
המשיכה לכתוב ל-`news_items` בעקיפת הדדופ והסינון שלו. לכן היא הוסרה ולא
הודקה — ראו `supabase/migrations/20260920090000_retire_news_ticker_crawler.sql`.

**‏2. `classify-property-images` — קיבלה אימות.** גם לה לא הייתה שום בדיקה.
ההצדקה שנרשמה ("לא מקבלת קלט שמשפיע על מה שנכתב") נכונה לגבי *שלמות
הנתונים*, אבל לא לגבי *עלות*: כל `POST` אנונימי הריץ עד 300 סיווגי
‏`GEMINI_API_KEY`, כשה-`limit` מגיע מגוף הבקשה.

**‏3. הסוד עצמו לא היה מוגדר — ולכן גם ה"מוגנות" לא היו מוגנות.** הבדיקה
ב-`saved-search-notify` וב-`property-marketing-publish` נכתבה כ-
`if (CRON_SECRET && ...)`, כלומר היא מדלגת על עצמה כשהסוד ריק. ‏`ALERT_CRON_SECRET`
לא הוגדר מעולם ב-Edge Functions Secrets, וגם סוד ה-Vault ‏`alert_cron_secret`
לא היה קיים — כך שה-cron ממילא לא שלח כותרת. התוצאה: שתי הפונקציות ענו
‏200 לכל קורא. זה נראה תקין בדיוק כמו שכשל שקט אמור להיראות.

הסגירה: `supabase/functions/_shared/cron-auth.ts`, שאותו מייבאות שלוש
הפונקציות. הבדיקה שם היא **fail-closed** — סוד חסר מחזיר `503`
`cron_secret_not_configured` במקום להיפתח — ומקבלת גם `Authorization: Bearer
<service_role>` למסלול הפנימי והידני. ההשוואה היא בזמן קבוע.

> **סדר הפעולות חשוב.** מיזוג ל-`main` פורס אוטומטית. אם `ALERT_CRON_SECRET`
> לא מוגדר ב-Edge Functions Secrets ברגע המיזוג, `saved-search-notify`
> יתחיל להחזיר `503` כל שתי דקות. **הגדירו את הסוד לפני המיזוג.**
> סוד ה-Vault כבר קיים, ולכן ה-cron כבר שולח את הכותרת; שני הערכים
> חייבים להיות זהים.

```sql
-- הערך שה-cron שולח (להשוואה מול מה שהוגדר ב-Secrets):
select decrypted_secret from vault.decrypted_secrets where name = 'alert_cron_secret';
```

**נשאר ידני:** הפונקציה `news-ticker-crawler` הוסרה מהריפו ומ-`config.toml`
וה-cron שלה בוטל, אבל `supabase functions deploy` אינו מוחק פונקציות פרוסות.
כל עוד היא לא נמחקה היא עדיין נענית לכל קורא שיודע את הכתובת:

```bash
supabase functions delete news-ticker-crawler --project-ref obookujgolazrwycsiyn
```

## סודות שהפונקציות צריכות

הפריסה מעלה קוד, לא סודות. אלה מוגדרים ב-**Supabase → Edge Functions →
Secrets**, ופונקציה שחסר לה סוד נפרסת בהצלחה ונכשלת בזמן ריצה:

| סוד | מי צריך אותו | מה קורה בלעדיו |
|---|---|---|
| `GEMINI_API_KEY` | `property-visualize`, `property-visualize-base`, `classify-property-images` | `gemini_not_configured` (500) |
| `ANTHROPIC_API_KEY` | `property-marketing-publish` | הפוסט נכשל על היעדר תיאור שיווקי |
| `MAKE_FACEBOOK_WEBHOOK_URL` *או* `FACEBOOK_PAGE_ID`+`FACEBOOK_PAGE_ACCESS_TOKEN` | `property-marketing-publish` | `publish_not_configured` — התור לא נשרף, השורות ממתינות |
| `ALERT_CRON_SECRET` | `saved-search-notify`, `property-marketing-publish`, `classify-property-images` | **חובה** — בלעדיו שלושתן מחזירות `503 cron_secret_not_configured`. חייב להיות זהה לסוד ה-Vault ‏`alert_cron_secret` שה-cron שולח |

## אם ההרצה נכשלה

- **`Access token not provided`** — הסוד `SUPABASE_ACCESS_TOKEN` ריק או
  הוגדר כ-Variable. ה-workflow אמור לתפוס את זה בשלב הראשון.
- **שגיאת הרשאה עם טוקן שנראה תקין** — אותה תקלה שהפילה את workflow
  המיגרציות בהרצה #24: מחרוזת שהועתקה דרך מסמך בעברית נושאת סימן כיווניות
  בלתי־נראה (`U+200F`/`U+200E`) בתחילתה. שלב הבדיקה כאן מנקה אותו, מדפיס
  אזהרה עם מספר התווים שהוסרו, ומוודא שהטוקן מתחיל ב-`sbp_` — כך שגם החלפה
  בטעות ב-anon key או ב-service role key נתפסת מיד. פירוט מלא:
  `docs/supabase-migrations.md`.
- **שגיאת bundling** — שגיאת TypeScript/ייבוא בפונקציה עצמה. הלוג מציין את
  שם הפונקציה, כי כל אחת נפרסת בנפרד.
- **ייבוא מ-`_shared` לא נמצא** — הנתיב היחסי חייב להישאר
  `../_shared/<file>.ts`; ה-CLI בונה את הבאנדל מתיקיית `supabase/functions`
  כשורש.
