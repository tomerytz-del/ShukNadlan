# קונסולת השיווק — ניהול קמפיינים ממומנים (מטא, ובהמשך גוגל)

**מצב: שלבים 1 (הסכימה) ו-2 (`ads-admin`) נכתבו; שאר השלבים בתכנון — ראו "התקדמות" למטה.** המסמך
הוא מה שתומר סיכם בשיחה עם קלוד, כדי שקלוד קוד ימשיך מכאן בלי לשחזר את
הדיון.

## מה תומר ביקש

ממשק ניהול + דאשבורד למנהל הקמפיינים, **בתוך `crm.html` בתצוגת מנהל/ת
הפלטפורמה**, לשימושו של תומר בלבד:

1. **ביצועים** — הוצאה, לידים, עלות לליד (CPL), CTR ותדירות; לפי קמפיין /
   סט / מודעה; סימון מודעות שנשחקות (תדירות עולה, CTR יורד).
2. **לידים מהקמפיינים** — כל ליד מטופס מיידי של מטא במקום אחד, עם המקור,
   הקמפיין והמודעה שהביאו אותו, ושיוך לליד בפלטפורמה.
3. **פעולות** — השהיה/הפעלה ושינוי תקציב (מוגבל ל-×2 לקריאה), עם אישור על
   כל פעולה, ויומן של כל מה שנעשה.
4. **יצירת קמפיין ופוסט** — מנכס קיים: קמפיין (תמונה / קרוסלה / טופס לידים
   / וואטסאפ) או פוסט לדף. הכול נוצר **מושהה**.
5. **Google Ads באותו דאשבורד** — לשונית נפרדת. חסום עד שיש Developer
   Token ברמת Basic/Standard (ראו למטה).

המטרה הרחבה שתומר ניסח: "מכונת שיווק אוטומטית, יעילה וזולה ככל שניתן" על
התשתית הקיימת (Supabase, Netlify, Make, הבוטים בוואטסאפ), בלי שירותים
בתשלום נוספים.

## מה כבר קיים בפלטפורמה, ואסור לשכפל

| קיים | איפה | מה זה אומר לקונסולה |
| --- | --- | --- |
| פרסום אוטומטי של כל נכס לפייסבוק ולאינסטגרם | `property-marketing-publish`, תור `property_publications`, `docs/facebook-auto-publish.md`, סקיל `social-publish` | **הקונסולה לא כותבת פוסטים אורגניים.** "פוסט לדף" = שורה בתור הקיים (`force`), לא Graph API חדש |
| תיאור שיווקי ו-`post_text` מ-Claude | `property-description`, `_shared/marketing-copy.ts`, סקיל `marketing-description` | קופי למודעה ממומנת נבנה **מאותו פרומפט ואותן עובדות נכס** — לא פרומפט שני |
| טוקן דף ארוך-טווח של פייסבוק | סודות `FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_ACCESS_TOKEN`, `INSTAGRAM_ACCOUNT_ID` (`FACEBOOK_GRAPH_VERSION` = v23.0) | **טוקן דף לא מספיק לחשבון מודעות.** צריך טוקן System User עם `ads_management` — סוד חדש `META_ADS_ACCESS_TOKEN` (ראו "סודות") |
| מדידה: GTM + GA4 + פיקסל מטא | `gtm/container.json`, `docs/analytics-gtm.md` | הפיקסל כבר באתר. אם קמפיין אתר יוגדר ל-`OUTCOME_LEADS` עם אירוע `Lead`, צריך לוודא ב-GTM שהאירוע נורה. **שום תגית חדשה בלי שורה ב-`analytics-user-data.md`** |
| בקרת מנוע הלידים (מקור, ערוץ, טריות) | פאנל `#dashPanelLeads`, `docs/lead-analytics.md` | ליד ממטא נכנס עם מקור משלו (`meta_ads`) כדי שהפאנל הקיים יספור אותו בלי שינוי |
| עלויות הפלטפורמה | `platform_costs`, פאנל `#dashPanelCosts`, `docs/platform-costs.md` | הוצאת המדיה **אינה** עלות פלטפורמה. נשארת בטבלה משלה; אפשר להציג "מדיה החודש" בפאנל העלויות כשורה נפרדת |
| מנהל/ת הפלטפורמה | `agency_members.is_platform_admin` | הגייט לקונסולה: אותו דגל, ב-RLS ובפונקציה |
| cron מאומת | `_shared/cron-auth.ts` (`x-alert-cron-secret` / service_role) | סנכרון לילי של הביצועים משתמש באותו מנגנון, לא בסוד חדש |
| סוכן תפעולי | `ops_agent/`, `ops_findings` | טוקן מטא שפג, cron שלא רץ, קמפיין פעיל בלי לידים 5 ימים — ממצאים לסוכן, לא התראות חדשות |

## הארכיטקטורה שסוכמה

```
crm.html → תצוגת מנהל/ת → פאנל חדש  #dashPanelAds  (דשבורד 7, "קמפיינים")
   │  קריאה: supabase-js ישירות ל-ads_* (RLS לפי is_platform_admin)
   │  פעולות: fetch → /functions/v1/ads-admin  עם ה-JWT של תומר
   ▼
ads-admin  (Edge Function, verify_jwt = false — ה-cron אינו נושא JWT; האימות בפנים)
   - מאמת JWT → בודק is_platform_admin; או x-alert-cron-secret ל-cron (sync_insights בלבד)
   - actions (POST {action, ...}):
       status           טוקן חי? חשבון, מטבע, יתרה, סטטוס, דף
       sync_insights    insights ברמת campaign+adset+ad, time_increment=1, N ימים → upsert ads_insights_daily
       campaigns        רשימה חיה: קמפיינים + סטים (status, effective_status, תקציב)
       set_status       {object_id, status}        → ads_actions_log
       set_budget       {object_id, daily_budget}  → מסרב מעל ×2 מהנוכחי → ads_actions_log
       lead_forms       טפסים על הדף ; create_lead_form (spec כמו בסקיל)
       create_campaign  spec כמו create_campaign.py בסקיל ; תמונות כ-URL מ-property_photos ;
                        dry_run=true מחזיר תוכנית בלי כתיבה ; הכול PAUSED
       sync_leads       לכל טופס: /{form_id}/leads since → ads_leads → ליד בפלטפורמה (מקור meta_ads)
   - כל כתיבה בודקת ששורת הגילוי (שם מתווך + מספר רישיון) בטקסט

ads-leads-webhook  (Edge Function, verify_jwt = false — אימות בחתימת מטא)
   - GET: hub.challenge עם META_WEBHOOK_VERIFY_TOKEN
   - POST: X-Hub-Signature-256 עם META_APP_SECRET → לכל leadgen_id: GET עם טוקן הדף → ads_leads → ליד בפלטפורמה
   - נכנס ל-config.toml עם הערה, לפי הסקיל new-edge-function
```

### טבלאות (מיגרציה אחת, לפי הסקיל `new-migration`)

- `ads_settings` — kv: שורת גילוי, רדיוס ברירת מחדל, מרכז. לא טוקנים.
- `ads_actions_log` — מי, מה, על מה, מה מטא ענתה.
- `ads_insights_daily` — `(day, level, object_id)` ⇒ spend, impressions, reach,
  clicks, link_clicks, leads, conversations, frequency, cpm, ctr.
- `ads_leads` — `meta_lead_id` PK, form/ad/campaign, `field_data` jsonb,
  קישור לליד בפלטפורמה.
- RLS: `select` למנהל/ת פלטפורמה בלבד; כתיבה רק ב-service role מהפונקציה.
- cron `ads-insights-sync` לילי (00:10 UTC), עם תנאי כמו ב-`property_publications`
  (לא יורה אם אין טוקן מוגדר ב-`ads_settings.enabled`).

### למה snapshot ולא קריאה חיה

מטא מגבילה קריאות insights ומעדכנת נתונים באיחור של עד 48 שעות. הדאשבורד
קורא מהטבלה, "רענן" מפעיל `sync_insights` לשלושה ימים אחורה, וה-cron
משלים בלילה. שני הימים האחרונים תמיד נכתבים מחדש.

### ליד ממטא → ליד בפלטפורמה

הליד נכנס דרך **אותו מסלול כמו ליד מהאתר** (הפונקציה הקיימת של קליטת
ליד, לפי סוג הטופס: קונה/שוכר → ליד נכס, "רוצה למכור" → ליד בעלים),
עם מקור `meta_ads`, כדי שניתוב, רוטציה, מחירים וטריות יעבדו עליו בלי
שינוי. `ads_leads` שומרת רק את ההצלבה לקמפיין.

### הדאשבורד

- פאנל מכווץ עם תקציר חי בכותרת ("₪1,240 · 31 לידים · ₪40 לליד · 7 ימים"),
  כמו שאר הפאנלים (`docs/platform-admin-dashboard.md`).
- ארבעה מספרי כותרת + שני גרפים פשוטים (הוצאה/יום, לידים/יום), SVG
  מוטבע, סדרה אחת כל אחד, **בלי ציר כפול**.
- טבלת קמפיינים עם מתג השהיה/הפעלה ושדה תקציב; כל שינוי פותח
  `confirmPurchase`-כמו חלון אישור עם ההשפעה (הוצאה 7 ימים, לידים, CPL).
- טבלת מודעות עם דגל "נשחקת" לפי `references/analysis-playbooks.md` בסקיל.
- לשונית "גוגל" — "ממתין לחיבור" עד שיש טוקן.

## שני מסלולים ורמת אגרסיביות (נוסף 7.10.2026)

תומר ביקש להפריד: **קידום נכסים** בטון לא אגרסיבי, ו**שיווק הפלטפורמה
למתווכים** שמותר לו להיות אגרסיבי יותר - עם כיוון של הרמה, ועריכה של
הנוסחים שהמודל מציע.

| מסלול (`audience`) | מה | למי | רמה (`intensity`) |
| --- | --- | --- | --- |
| `property` | נכס `active` שבאתר | קונים / שוכרים | 1-2 בלבד - `check` במסד, לא רק בקוד |
| `platform` | שוק נדל"ן עצמה | מתווכים ומשרדים | 1-5, ברירת מחדל `ads_settings.platform_default_intensity` |

הסולם: 1 מידעי, 2 חם וענייני, 3 ישיר ונחוש, 4 אגרסיבי (כאב מוכר וניגוד חד),
5 אגרסיבי מאוד (פתיחה פרובוקטיבית, מסגור הפסד, בחירה בין שתי דרכים).

**הרמה משנה טון, לעולם לא עובדות.** בכל רמה: רק עובדות מ-
`ads_settings.platform_facts` (או מנתוני הנכס), בלי מספרים מומצאים, בלי
"הכי"/"מובטח", בלי מתחרים בשם, בלי דחיפות כשאין `deadline` אמיתי בתדריך,
ובלי טענה על מצבו האישי של הקורא/ת (מדיניות personal attributes של מטא).
מודעה אגרסיבית שממציאה "חוסכים 10 שעות בשבוע" היא פרסום מטעה.

- **מודעת נכס** נכתבת לפי `PROPERTY_COPY_RULES` - אותם חוקים של התיאור
  השיווקי, שחולצו ב-`_shared/marketing-copy.ts` לקבוע משותף (ה-`SYSTEM_PROMPT`
  של התיאור נשאר זהה בייט-בייט), ועם העובדות של `property_marketing_facts`.
- **עריכה:** `ads_copy_drafts.generated` הוא מה שהמודל כתב, `variants` מה
  שנערך. "כתוב מחדש" עם הערה ("קצר יותר", "פחות אגרסיבי") שומר את הסבב
  הקודם ב-`history` (עד 10).
- **אזהרות, לא חסימה:** `checkVariant()` מסמן כותרת מעל 40 תווים, שורה
  ראשונה מעל 125, טלפון או קישור בטקסט, דחיפות בלי תאריך, "הכי"/"מובטח",
  יותר מסימן קריאה אחד, והגזמה או "ללא תיווך" במודעת נכס. החסימות
  האמיתיות - שורת הגילוי ונכס שאינו באוויר - ביצירת הקמפיין (שלב 5).
- **`platform_facts`** נזרעה מהיכולות שקיימות היום. כל יכולת חדשה שרוצים
  לפרסם - שורה שם קודם.

## סודות (Supabase → Edge Functions → Secrets)

```
META_ADS_ACCESS_TOKEN      System User token עם ads_read, ads_management, business_management
                           + pages_show_list, pages_manage_ads, leads_retrieval  (setup.md בסקיל)
META_AD_ACCOUNT_ID         act_...
META_APP_SECRET            ל-webhook
META_WEBHOOK_VERIFY_TOKEN  מחרוזת אקראית
```
`FACEBOOK_PAGE_ID` ו-`FACEBOOK_PAGE_ACCESS_TOKEN` כבר קיימים ומשמשים לטפסים
וללידים. ‏`META_API_VERSION` — הסקיל מניח v26.0; הפרסום הקיים על v23.0. לא
לשנות את הקיים; הקונסולה עובדת עם הגרסה שלה.

## סדר עבודה מומלץ

1. המיגרציה (סקיל `new-migration`): טבלאות, RLS, cron. ‏`check_migration_versions.py`.
2. `ads-admin` (סקיל `new-edge-function`; להעתיק את דפוס האימות מ-
   `professional-manage` ואת ה-cron מ-`promo-lifecycle`): `status`,
   `sync_insights`, `campaigns`, `set_status`, `set_budget`. לבדוק מקומית
   עם `supabase functions serve` לפני PR.
3. הפאנל ב-`crm.html` + `assets/crm.js` (דשבורד 7): לפי `docs/platform-admin-dashboard.md`.
4. לידים: `sync_leads` + `ads-leads-webhook` + החיבור למסלול הליד הקיים.
5. יצירת קמפיין מנכס (האחרון, הכי מורכב). הקופי — מ-`marketing-copy.ts`.
6. ממצאים לסוכן התפעולי (טוקן פג, cron שקט, קמפיין בלי לידים).
7. Google Ads.

כל שלב — PR משלו ל-`main`, עם שורה במסמך הזה. **אין להחיל DDL ואין
לפרוס פונקציה ידנית**: הצינור ב-GitHub Actions עושה את שניהם במיזוג.

### התקדמות

| שלב | מה נכנס | הערות |
| --- | --- | --- |
| 1 | `20270305090000_ads_console.sql`: ‏`ads_settings`, ‏`ads_actions_log`, ‏`ads_insights_daily`, ‏`ads_leads`; RLS קריאה ל-`current_is_platform_admin()` בלבד, בלי policy כתיבה; ה-cron `ads-insights-sync` (00:10 UTC) | ה-cron יורה רק כש-`ads_settings.enabled = true`, וברירת המחדל `false` - להדליק אחרי ש-`ads-admin` באוויר והסודות מוגדרים. ‏`disclosure_line` ריקה עד שתומר ימלא אותה, ו-`ads-admin` תסרב ליצור מודעה בלעדיה. ‏`lead_source_channel()` ממפה היום `meta_ads` ל-`other` - שלב 4 מוסיף לו ערוץ משלו |
| 2 | `supabase/functions/ads-admin/` (`index.ts`, ולקוח Graph ב-`meta.ts`): ‏`status`, ‏`sync_insights`, ‏`campaigns`, ‏`set_status`, ‏`set_budget` | **‏`verify_jwt = false` ולא `true` כפי שתוכנן:** ה-cron נכנס ב-`x-alert-cron-secret` בלי JWT, וה-Gateway היה חוסם אותו. ‏JWT של מנהל/ת נבדק בפנים, ו-`cron_secret` מורשה ל-`sync_insights` בלבד. כל כתיבה קוראת את האובייקט קודם ומוודאת `account_id` של החשבון שלנו, תומכת ב-`dry_run`, ונרשמת ב-`ads_actions_log` גם כשנכשלה. תקציב: `daily_budget` בלבד, עד פי 2, ו-`learning_reset_risk` מ-20%. הסנכרון מוחק שורות בחלון שמטא כבר לא מחזירה (‏`synced_at` ישן), ורק ברמה ששליפתה הצליחה. לידים: `lead`, ו-`onsite_conversion.lead_grouped` רק כשהוא לבדו, כדי לא לספור פעמיים. ה-Graph בגרסה v26.0 (‏`META_API_VERSION`); לא נבדק מול מטא אמיתית - בלי הסודות `status` מחזיר `configured:false` |
| 2ב | מנוע הקופי: `ads-admin/copy.ts`, הפעולות `generate_copy` ו-`save_copy`, הטבלה `ads_copy_drafts` (`20270306090000_ads_copy.sql`), וזריעת `platform_facts` ו-`platform_default_intensity` | ראו "שני מסלולים ורמת אגרסיביות". הקופי אינו נוגע במטא ועובד גם לפני שהחשבון מחובר - צריך רק `ANTHROPIC_API_KEY`. ממשק העריכה בא עם הפאנל (שלב 3) |

## הסקיל `meta-ads`

`.claude/skills/meta-ads/` — סקיל מלא ל-Marketing API של מטא, מותאם
לתיווך בישראל: טופס לידים, קרוסלה, וואטסאפ, קידום פוסט, הורדת לידים,
ומדריך קריאייטיב בעברית (`references/real-estate-creative.md`: חובת
שורת הגילוי לפי תקנות האתיקה למתווכים ממרץ 2025, איסור נכסים ללא הסכמת
בעלים, מדיניות הדיור וההפליה של מטא). הסקריפטים ב-Python נבדקו מול API
מדומה בלבד — **הרצה ראשונה מול מטא תמיד עם `--dry-run`**. בקונסולה הם
משמשים כמפרט (ה-spec, הולידציה, כללי הבטיחות) ולא רצים בפרודקשן; הלוגיקה
עוברת ל-Deno בפונקציה.

> שוק נדל״ן היא **פלטפורמה רב-סוכנית**: מודעה ממומנת לנכס של משרד אחר
> היא מודעה של שוק נדל״ן בשם הפלטפורמה. שורת הגילוי היא של הפלטפורמה
> (מי שמפרסם), והנכס בקמפיין חייב להיות `active` עם הסכמת בעלים — כלומר
> כבר באתר. אין לפרסם נכס שאינו באתר.

## Google Ads — מה צריך לפני שמתחילים

- Developer Token מחשבון מנהל (MCC): Tools & Settings → Setup → API
  Center. רמה `Test account` לא מספיקה; צריך `Basic` לפחות (בקשה בטופס
  של גוגל, ימים ספורים). תומר חושב שיש לו טוקן — **טרם אומת באיזו רמה**.
- OAuth: Google Cloud project קיים (לוח השנה כבר מחובר — `google-calendar-*`),
  צריך scope `adwords` ו-refresh token לחשבון של תומר.
- סודות: `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID`,
  `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`,
  `GOOGLE_ADS_CUSTOMER_ID`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID`.
- Edge Function `google-ads-admin` באותו דפוס, דרך REST
  (`googleads.googleapis.com/v*/customers/{id}/googleAds:searchStream` ל-GAQL).

## הרחבות שסוכמו, לפי סדר ערך

1. **המרות אמיתיות** — אירוע `Lead` בפיקסל ו-Conversions API (שרת-לשרת מהקליטה), כדי
   שמטא וגוגל יבצעו אופטימיזציה ללידים ולא לקליקים.
2. **מענה אוטומטי לליד תוך דקה** — גבריאלה כבר בוואטסאפ; ליד ממטא עם מספר
   טלפון מקבל הודעת פתיחה ממנה.
3. **Google Business Profile** — פוסטים ותגובות לביקורות דרך ה-API.
4. **רימרקטינג** לצופי נכסים (דורש 1).
5. **דיוור** — הניוזלטר קיים (`newsletter-subscribe`); לחבר נכסים חדשים לפי שוק.
6. **סרטוני נכס** — `docs/property-marketing-video.md` קיים; להפוך ל-Reels.
7. **דוח שבועי** לתומר בוואטסאפ: הוצאה, לידים, CPL, המלצה אחת.
