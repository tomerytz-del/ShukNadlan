---
name: marketing-console
description: עבודה על קונסולת השיווק בריפו של שוק נדל״ן - הפאנל "קמפיינים" ב-crm.html (ביצועים, נוסחי מודעות, לידים ממטא, מודיעין שווקים, מילות מפתח), ה-Edge Functions ads-admin ו-ads-leads-webhook, הטבלאות ads_* ו-market_intel_*, ו-probes/ads.py של הסוכן התפעולי. Use when touching supabase/functions/ads-admin (index.ts, copy.ts, campaign.ts, intel.ts) / ads-leads-webhook / _shared/meta-graph.ts / _shared/meta-leads.ts / _shared/google-ads.ts, the Google tab (google_status, google_campaigns, google_directions, google_keyword_ideas, google_create_campaign, google_set_status, ads-admin/google-directions.ts, ads-admin/google-campaign.ts), creating or pausing a Google Search campaign, adding an advertising direction or Keyword Planner seeds, when Google Ads returns invalid_grant or DEVELOPER_TOKEN_NOT_APPROVED, the #dashPanelAds panel in assets/crm.js, a migration that touches ads_* or market_intel_* or lead_source_channel, when a Meta lead did not reach the platform, when a campaign created from the console does not spend, when the console shows "ממתין לחיבור", when Google office counts per city look wrong, the video library (marketing_videos, the marketing-videos bucket, save_video, archive_video, a video campaign or an A/B test between video versions), or when connecting the Meta / Google accounts (secrets, System User, webhook, Places key).
---

# קונסולת השיווק

הפאנל "קמפיינים" בתצוגת מנהל/ת הפלטפורמה. התיעוד המלא, כולל טבלת
ההתקדמות של שבעת השלבים: `docs/marketing-console.md`. כאן - מה שנשבר
בשקט, ובאיזה סדר בודקים.

## ‏1. מי מדבר עם מי

| רכיב | תפקיד |
| --- | --- |
| הדפדפן | קורא את `ads_*` ו-`market_intel_*` ישירות. ה-RLS פותח אותן ל-`current_is_platform_admin()` בלבד. **אין policy כתיבה** |
| `ads-admin` | הפונקציה היחידה שנוגעת במטא, בגוגל ובקופי. כל כתיבה עוברת דרכה עם `service_role` |
| `ads-leads-webhook` | מטא מודיעה על ליד חדש. ‏`verify_jwt = false`, והאימות הוא חתימה |
| `ops_agent/probes/ads.py` | ממצאים לפאנל "בריאות המערכת". **מהמסד בלבד, בלי קריאה למטא** |

‏`ads-admin` היא `verify_jwt = false`, כי ה-cron נכנס עם `x-alert-cron-secret`
ובלי JWT. ה-JWT של מנהל/ת נבדק בתוך הפונקציה, וה-cron מורשה ל-`sync_insights`
ול-`sync_leads` **בלבד**. פעולה חדשה שה-cron צריך נוספת לרשימה הזו במפורש:
סוד שדלף מה-Vault לא אמור להיות מסוגל להשהות קמפיין או להעלות תקציב.

## ‏2. כל כתיבה למטא: קריאה, `dry_run`, יומן

1. **קודם קוראים את האובייקט** (`loadOwned`) ומוודאים ש-`account_id` שלו
   הוא החשבון שלנו. ‏System User יכול לראות כמה חשבונות, ולכן `object_id`
   מהדפדפן לבדו אינו מספיק.
2. ‏**`dry_run`**, ואחריו `confirmPurchase` בפאנל עם מה שישתנה.
3. **רשומה ב-`ads_actions_log`**, גם כשהפעולה נכשלה, כולל מה שמטא ענתה.

תקציב: `daily_budget` בלבד, עד פי 2 בפעולה אחת. מ-20% ומעלה מסמנים
`learning_reset_risk`.

## ‏3. יצירת קמפיין (`campaign.ts`)

- **הקמפיין נוצר `PAUSED`, והסט והמודעות `ACTIVE`.** המתג היחיד הוא
  הקמפיין. אילו כל העץ היה מושהה, "הפעלה" של הקמפיין בלשונית הביצועים
  לא הייתה מוציאה שקל, והפאנל היה מציג "פעיל". אל תשנו רק צד אחד.
- **התמונות עולות לפני הקמפיין.** תמונה שנכשלת (WebP מייבוא, קובץ שנמחק)
  נופלת לפני שיש משהו בחשבון.
- **כל אובייקט נרשם ב-`ads_campaigns.objects` מיד אחרי שנוצר**, ולא בסוף.
  זה מה שמאפשר ל-`discard_campaign` למחוק עץ חלקי.
- **החסימות יושבות בשרת**, והטופס בדפדפן רק משקף אותן: נוסח מאושר,
  `disclosure_line` לא ריקה, מתווך/ת עם רישיון `verified`/`manual` (בנכס),
  נכס `active`, `owner_consent`, טופס לידים מהסוג הנכון, תקציב עד
  `max_daily_budget`, חשבון ב-ILS, מיקום בישראל.
- **שורת הגילוי במודעת נכס** היא שם המתווך/ת ומספר הרישיון, ואחריה
  `disclosure_line`. חסימה שמורידים ממנה תנאי היא בעיה משפטית, לא רק
  באג.

## ‏4. לידים ממטא (`_shared/meta-leads.ts`)

- **ליד נכנס דרך אותן פונקציות קליטה כמו ליד מהאתר**
  (`property-inquiry-intake` / `owner-lead-intake` / `saved-search-intake`),
  עם `source=meta_ads_*`. אל תבנו נתיב משלו: הרוטציה, המחירים והטריות
  יושבים שם.
- ‏`meta_lead_id` הוא המפתח, ו-`ads_lead_claim()` הוא הנעילה. ה-webhook
  והסנכרון השעתי רצים על אותה שורה, ושני לידים לאותו אדם הם כסף שנגבה
  פעמיים מסוכן/ת.
- **טופס שלא שויך** - הלידים שלו `new` ונשלחים ברגע השיוך. זה לא באג.
- ה-webhook **נכשל סגור**: בלי `META_APP_SECRET` הוא מחזיר 503, ועל חתימה
  שגויה 401. על POST חתום הוא עונה **תמיד 200**, גם כשליד בודד נכשל: מטא
  משביתה מנוי שעונה שגיאות שוב ושוב.
- מקור חדש של `meta_ads_*` נכנס ל-`KNOWN_SOURCES` ב-`_shared/lead-routing.ts`,
  אחרת הוא מנורמל ל-`unattributed`.

## ‏5. מודיעין שווקים (`intel.ts`)

- **משרד נשמר לפי העיר שבכתובת שלו, לא לפי העיר שנסרקה**
  (`market_intel_store_places`). הסריקה מחפשת **סביב** מרכז העיר, ולכן
  משרד בעפולה חוזר גם בסריקה של אחוזת ברק. עד 10.2026 הסך בפאנל היה
  סכום הסריקות, ואותו משרד נספר פעמיים ושלוש.
- **המספר נספר מ-`market_intel_places`**, שורה אחת לכל משרד. לא מ-
  `market_intel_scans.offices`, שהוא כמה גוגל החזירה סביב העיר.
- **נשמרים רק `place_id` והעיר שלנו.** שם, כתובת, דירוג והיישוב שבכתובת
  לא נשמרים (תנאי השימוש של גוגל). "רשימה" מושכת אותם חי.
- **השיוך נכון רק אחרי סבב מלא על כל ערי השוק** ("סריקת כל הערים"), כי
  משרד נמצא לפעמים רק בסריקה של עיר שכנה. הסבב רץ בדפדפן, עיר אחרי עיר,
  ונעצר בשגיאה הראשונה: המכסה היומית (500) נאכפת בגוגל.
- **החיפוש הוא טקסט, ו-`locationBias` אינו מגביל.** "מתווך נדל"ן תל עדשים"
  מחזיר משרדים מתל אביב. לכן אפס ביישוב קטן הוא תוצאה סבירה, ומשרדים
  נשמרים גם בערים שאינן בשוק (הם פשוט לא מוצגים בו). ב-9.10.2026, לפני
  השיוך לפי כתובת, אותם משרדים מתל אביב נספרו לתל עדשים (21 מול 3 ברשם).
- **מהרשם נקראת עמודת העיר בלבד.** רשימת קשר של מתווכים אסורה (חוק
  הספאם, תיקון 13 לחוק הגנת הפרטיות).

## ‏6. ממצאים לסוכן התפעולי (`probes/ads.py`)

**כל ממצא חייב להיות מסוגל להיסגר** (הלקח של `heavy_query`, ‏CLAUDE.md):
- הטוקן נבדק על **הקריאה האחרונה** למטא, ולא על "היה כשל ב-48 שעות".
- "קמפיין בלי לידים" נמדד בחלון **נע** של חמישה ימים מלאים, בלי היום
  ואתמול, כי מטא מעדכנת לידים באיחור של עד 48 שעות.
- "קמפיין בלי לידים" חל **רק** על קמפיין שאמור להביא לידים: נוצר מהקונסולה
  עם טופס או וואטסאפ, או הביא לידים בחודש שלפני. קמפיין תנועה לאתר הוא
  יחידה אחרת.

קוד ממצא חדש מתחיל ב-`ads_`, אחרת `ops_probe_codes_test.py` חוסם אותו.

## ‏7. מיגרציות בתחום הזה

הקונסולה נבנתה בשבעה PR-ים מקבילים לעבודה אחרת, ו-version כפול קרה כאן
**ארבע פעמים** (‏20270307, ‏20270309, ‏20270311, ‏20270312). לפני push:

```sh
git fetch origin main
python scripts/check_migration_versions.py --base-ref origin/main
```

ולפני מיזוג: לבדוק את ה-PR-ים הפתוחים. ‏`check_migration_versions` רואה
רק את `main`, ולא PR פתוח שתפס את אותו מספר.

‏`lead_source_channel()` ו-`platform_market_intel()` מוגדרות מחדש במיגרציות
של הקונסולה. מי שמגדיר/ה אותן שוב מעתיק/ה את **הגרסה האחרונה** (grep על
`create or replace function public.<שם>` בכל `supabase/migrations/`), לא את
הראשונה.

## ‏8. כיווני פרסום ו-Keyword Planner בגוגל (`google-directions.ts`)

- **כיוון = קמפיין נפרד.** `agents` (גיוס מתווכים, `/pricing`), `site` (קונים
  ושוכרים, האתר וגבריאלה), `commercial` (חנויות ומשרדים, `/?deal=commercial`),
  `owners` (הערכת שווי). לא לאחד שני כיוונים
  לקמפיין אחד - יעד ההמרה שונה, וגוגל מבזבזת את התקציב על הזול מביניהם.
- **הרשימה בשרת בלבד.** הלשונית קוראת אותה ב-`google_directions`, ויצירת
  הקמפיין (7ג) תקרא את אותה רשימה. כיוון חדש = שורה ב-`DIRECTIONS`.
- **עיר במילים רק ב-`market: true`.** כיוון של מתווכים מתמקד באזור בהגדרות
  המיקום של הקמפיין; "CRM למתווכים בעפולה" הוא אפס חיפושים.
- **עד 20 מונחי זרע** (‏`seedsFor` חותך). שלוש הערים הגדולות בשוק לפי
  `cities.population`, בסדר תבנית ואז עיר: מה שנחתך הוא התבניות האחרונות
  בכל הערים, ולכן התבנית החשובה נכתבת ראשונה.
- **יעד המודעה הוא האתר, לא `wa.me`.** השיחה עם גבריאלה מתחילה בדף הנחיתה;
  הודעת פתיחה חדשה למודעות = ביטוי ב-`SITE_ENTRY_PHRASES` (הסקיל `whatsapp-bots`).
- **הנפח ארצי** (‏`GEO_ISRAEL`), ממוצע 12 חודשים. אל תציג/י אותו כחיפושים באזור.
- **כל שליפה היא פעולה מהמכסה של Explorer** - בלחיצה, לא בטעינת הלשונית.
- מילות השלילה הן חלק מהכיוון, ומוצגות בלי מינוס (מתהפך ב-RTL).

### קמפיין חיפוש מכיוון (`google-campaign.ts`, שלב 7ג)

- **בקשת mutate אחת לכל הקמפיין**, עם שמות זמניים (`-1`, `-2`, `-3`). אל
  תפצל/י ליצירה בשלבים - אז כישלון באמצע משאיר קמפיין חלקי בחשבון.
- **‏dry_run = `validateOnly` של גוגל**, לא בדיקה שלנו. ‏`buildGooglePlan` טהורה,
  ושני המסלולים בונים בדיוק אותן פעולות.
- **הקמפיין `PAUSED`, המודעה והקבוצה `ENABLED`.** ‏`containsEuPoliticalAdvertising`
  חובה בקמפיין חדש מגרסאות ה-API של 2025 - בלעדיו היצירה נדחית.
- **מיקום `PRESENCE`**, רדיוס סביב העיר הגדולה בשוק. כל כיוון ממוקד לשוק, גם
  `agents`.
- **שגיאות:** ‏`GoogleAdsError.details` מחזיק את כל השגיאות עם `trigger` (הטקסט
  שנדחה). הפאנל מציג אותן - לא להסתפק ב-`code` הראשון.
- **‏`google_campaigns` בלי `segments.date` לרשימה.** עם התאריך, קמפיין בלי
  חשיפות לא חוזר, ושורה חוזרת לכל יום.

## ‏9. חיבור החשבונות - מה נתקע בפועל

| מה | איפה זה נתקע |
| --- | --- |
| ‏System User למטא | חייב לשבת **בתיק העסקי שבו נמצא חשבון המודעות**. ה-`business_id` בכתובת של Ads Manager הוא התיק הנכון. ב-10.2026 נפתח קודם תיק אחר (Nadlan.Afula), ושם כפתור ההוספה היה אפור |
| "הוספה" אפור במשתמשי מערכת | לתיק אין אפליקציה. **אפליקציות ← הוספה ← חיבור מזהה אפליקציה** |
| קוד SMS לא מגיע | "לנסות בדרך אחרת" ← אישור מאפליקציית פייסבוק בטלפון. בקשות חוזרות נועלות ל-24 שעות |
| ‏Places API | צריך את **(New)**, ולא את הישן (`REQUEST_DENIED`). מגבלה קשיחה: `SearchTextRequest per day` = 500. תקרת הוצאה ב-Billing **אינה זמינה** ל-Places |
| מפתח Places | הגבלה מסוג **API restriction** בלבד. לא Websites ולא IP, כי הקריאות יוצאות מ-Supabase |
| ‏Google Ads API | צריך **חשבון מנהל** (MCC) - מרכז ה-API קיים רק בו. חשבון הפרסום מקושר אליו (בקשה מהמנהל, אישור מחשבון הפרסום) |
| ‏"Cloud project is only approved for use with test accounts" | רמת הגישה יושבת **גם על פרויקט ה-Cloud**, לא רק על ה-Developer token. ‏Google Cloud ← Google Ads API ← Access levels ← Manage ← בקשת Explorer/Basic לפרויקט. טוקן Explorer במרכז ה-API אינו מספיק לבד |
| ‏refresh token של Google Ads | מסך ההסכמה **In production**, אחרת הוא פג אחרי 7 ימים (`invalid_grant`). מופק מההתחברות שבה יושב חשבון המנהל - לאותו מייל יכולות להיות שתי התחברויות עם רשימות חשבונות שונות |

הסודות (רק ב-Supabase ← Edge Functions ← Secrets, **לעולם לא בצ'אט**):
`META_ADS_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, `META_APP_SECRET`,
`META_WEBHOOK_VERIFY_TOKEN`, `GOOGLE_PLACES_API_KEY`, ושישה של Google Ads
(`GOOGLE_ADS_*`, הרשימה ב-`_shared/google-ads.ts`). גרסת ה-API ב-
`GOOGLE_ADS_API_VERSION` גוברת על ברירת המחדל - גוגל סוגרת גרסה כשנה אחרי
שיצאה, וגרסה סגורה מחזירה 404. ההגדרה `ads_settings.enabled`
נדלקת **אחרי** שהפאנל מציג את שם החשבון, ולא לפני.

## ‏9ב. ספריית הסרטונים (שלב 8, `docs/marketing-videos.md`)

- **הקבצים בדלי `marketing-videos`, הקטלוג ב-`marketing_videos`.** הדפדפן
  מעלה ישירות לדלי (‏policy למנהל/ת בלבד), ו-`save_video` כותב את השורה רק
  אחרי שבדק (‏HEAD) ששני הקבצים שם. אין מחיקה - ארכיון: מודעה שרצה מפנה לקובץ.
- **אין סרטון בלי תמונת שער.** מטא דורשת אותה במודעת וידאו, והדפדפן חותך
  אותה מהשנייה הראשונה. סרטון שהועלה בדרך אחרת בלי `poster_path` נחסם ביצירה.
- **מודעה לכל זוג נוסח × סרטון, עד `MAX_ADS` (שש).** ‏`video_id` נרשם על כל
  מודעה ב-`ads_campaigns.objects`, ו-`marketing_video_stats()` נשענת עליו.
  מי שמשנה את מבנה `objects` שובר את הביצועים לכל סרטון, בשקט.
- **‏`advideos` עם `file_url`, ואז המתנה ל-`ready`** (עד 90 שניות), הכול לפני
  הקמפיין. ‏`meta_video_id` נשמר כדי לא להעלות שוב; הוא נבדק לפני שימוש.
- **ניסוי A/B = אותו `concept`, `variant` שונה.** הלשונית מסמנת מוביל/ה לפי
  עלות לליד (לידים + שיחות), לא לפי קליק.
- **הפקת הסרטון עצמו** (‏Reelkit, קול אמיתי, 9:16 ו-1:1) - הסקיל
  `marketing-video-production`.

## ‏10. אלמנט חדש בפאנל: id עם הקידומת `ads`

הפאנל יושב בתוך `crm.html`, אותו דף של הדשבורד של כל סוכן/ת, ו**לפניו**
בסדר המסמך. id שכבר קיים בדשבורד גונב אותו: `getElementById` מחזיר את
הראשון, בלי שגיאה. כך `<div id="leadsList">` של "לידים ממטא" (‏#624) שלח
שלושה ימים את הלידים של כל הסוכנים לפאנל המוסתר הזה - הכותרת והמונים של
"הלידים שלי" הופיעו, והרשימה ריקה. מכאן `adsLeadsList`, וכל id חדש כאן
מתחיל ב-`ads` (או `adm`). ‏`scripts/check_duplicate_ids.py` חוסם ב-CI.

## ‏11. בדיקה לפני push

```sh
cd supabase/functions/ads-admin && deno check index.ts
node --check assets/crm.js
python scripts/ops_ads_test.py
python scripts/ops_probe_codes_test.py
python scripts/check_long_dash.py        # הודעות לפאנל ושגיאות בעברית
python scripts/check_duplicate_ids.py    # id חדש בפאנל שכבר קיים בדשבורד
```

שינוי ב-SQL של `probes/ads.py` נבדק גם מול Postgres מקומי עם המיגרציות
האמיתיות של `ads_*`. הבדיקה ב-`ops_ads_test.py` מחזירה שורות קבועות, ולכן
שם עמודה שגוי עובר בה.
