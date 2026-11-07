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
