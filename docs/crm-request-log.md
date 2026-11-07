# יומן בקשות ל-/crm

נולד מחקירה (7.11.2026): ב-GA4 הופיעו 11 קישורים עמוקים ל-`/crm` עם אותו
UUID אפס (`00000000-0000-4000-8000-000000000000`), באותה ספירה בדיוק, מישראל
ומארה"ב. ל-GA4 אין IP וכותרות, ואין לנו גישה ליומני Netlify, ולכן אי אפשר
לדעת מי שולח אותם. היומן הזה נותן את התשובה בפעם הבאה.

## הזרימה

1. `netlify/edge-functions/crm-request-log.ts` רצה על `/crm`, `/crm.html`
   ו-`/crm/*`. היא מחזירה את התשובה **כמות שהיא** ורושמת ב-`waitUntil`.
2. היא שולחת POST ל-`supabase/functions/crm-request-log` עם סוד משותף
   (`x-crm-log-secret`).
3. הפונקציה קוראת ל-`crm_request_log_add` (מיגרציה `20271108090000`) ששומרת
   ל-`crm_request_log`: IP, מדינה ועיר, שיטה, נתיב, query, סטטוס, user-agent,
   referer, שפה, כותרות `sec-fetch-*` ו-`sec-ch-ua-*`.

## הפעלה (חד-פעמית, ידנית)

בלי הסוד ביומן אין כתיבה. זה מכוון (fail-closed).

1. ליצור סוד של 32 תווים ומעלה (`openssl rand -hex 32`).
2. ב-Supabase: Settings, Edge Functions, `CRM_LOG_SECRET`.
3. ב-Netlify: Site settings, Environment variables, `CRM_LOG_SECRET`, אותו ערך,
   ובהיקף **Functions** (ה-Edge Functions קוראות אותו דרך `Netlify.env`).
4. לפרוס מחדש את האתר, כדי שהמשתנה ייקרא.
5. **לוודא שהוא רושם:** לפתוח `/crm` בדפדפן ולהריץ `select count(*) from crm_request_log`.
   אם נשאר 0, המשתנה לא מגיע ל-Edge (בדקו את ההיקף ב-Netlify). אין התראה על
   סוד חסר, והיומן נראה תקין גם כשהוא ריק.

## לקרוא את היומן

מנהל/ת פלטפורמה קורא/ת ב-CRM או ב-SQL. דוגמאות:

```sql
-- כל הבקשות עם ה-UUID האפס, לפי מקור
select ip, country, user_agent, count(*), min(at), max(at)
from crm_request_log
where query like '%00000000-0000-4000-8000-000000000000%'
group by 1,2,3 order by 4 desc;

-- הכתובות הפגומות
select path, query, ip, user_agent from crm_request_log
where path like '//%' or query like '%`%' order by at desc limit 50;
```

אם `user_agent` מכיל `ShukNadlan-uptime-monitor` או `ShukNadlan-baseline-audit`,
זו בקשה של הניטור של Grok (Python, בלי JavaScript), ולא של גולש.

## מה שחשוב לדעת

- **ה-query נשמר בסינון:** רק פרמטרים ידועים (`goto`, `lead`, `wc` ועוד); `code`,
  `state`, `k` וטוקנים נרשמים כשם בלבד. ה-referer בלי query.
- **IP הוא מידע אישי.** הוא נשמר 30 יום ונמחק בתוך `crm_request_log_add`
  (לא ב-`data_retention_run`, כדי לא להעתיק פונקציה גדולה). מי שמעדכן את
  מסמך הפרטיות (`privacy.html`) צריך להוסיף את היומן.
- **תקרה יומית של 30,000 שורות.** מעבר לה לא נכתב כלום.
- **הרישום אינו חלק מהתשובה.** כל כשל נבלע, והדף יוצא כרגיל.
- **הקליטה סוגרת על עצמה:** בלי `CRM_LOG_SECRET` ב-Supabase כל POST מקבל 503.
- הטבלה נקראת רק על ידי מנהל/ת פלטפורמה (RLS). `anon` ו-`authenticated` אינם
  מקבלים הרשאת כתיבה.

## חסימת סורקים ו-/crm מחו"ל (באותה פונקציה)

`netlify/edge-functions/lib/crm-guard.ts` מחליטה לפני שהדף יוצא. הבדיקה:
`node --experimental-strip-types scripts/crm_guard_test.mjs`.

| מה | ברירת מחדל | הערות |
| --- | --- | --- |
| User-Agent של כלי סריקה (`python-urllib`, `python-requests`, `python-httpx`, `curl`, `wget`, `go-http-client`, `scrapy`, `aiohttp`, `axios` ועוד) או בלי User-Agent | **חסום, 403** | מי שמזדהה כ-`ShukNadlan...` עובר (הניטור, סוכן התפעול, ה-CI) |
| headless Chrome / Playwright | **עובר, ונרשם** | בכוונה: כך מזהים מי מריץ אותו |
| מדינה שאינה ברשימה | **כבוי** | `CRM_GEO_ALLOW=IL` ב-Netlify מדליק. מדינה לא ידועה עוברת |

- הדלקת `CRM_GEO_ALLOW` תחסום גם סוכנים בחו"ל וסשנים של Claude/Grok בענן (ארה"ב),
  חוץ ממי שמזדהה כ-`ShukNadlan`. ראו `docs/crm-request-log.md` לפני שמדליקים.
- **לא נעשה:** הגבלת קצב ב-Netlify (תלויה בתוכנית, לא אומתה), ורישום קריאות `anon`
  ביומן הגישה למסד. ב-`scripts/access_log_sync.py` ה-`role` של מפתח ה-publishable ריק,
  ושינוי שאילתת ה-ClickHouse של סנכרון חובה (3 שנים לפי תקנה 10) דורש בדיקה מול
  הנקודה החיה לפני שנוגעים בו.
