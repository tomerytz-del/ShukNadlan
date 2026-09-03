-- ============================================================================
-- מנגנון הדמיות הנכסים — בדיקת מצב והפעלה
-- תיעוד מלא: docs/property-visualizations.md
--
-- הקובץ בנוי משלושה חלקים, ואפשר להריץ כל אחד בנפרד ב-SQL Editor:
--
--   ‏1. בדיקת מצב  — קריאה בלבד. מה מוגדר, מה חסר, ולמה עדיין אין הדמיות.
--   ‏2. הפעלה      — יוצר את שני סודות ה-Vault שמעירים את הטריגר האוטומטי.
--   ‏3. מילוי לאחור — מייצר סט בסיס לנכסים שכבר מפורסמים.
--
-- למה קובץ ולא רשימת פקודות במסמך: הכשל של המנגנון הזה שקט. פונקציה בלי
-- ‏GEMINI_API_KEY נפרסת בהצלחה ומחזירה 500 רק בזמן ריצה, וטריגר בלי סודות
-- ‏Vault הוא no-op מכוון — כלומר "הכל ירוק" ואף הדמיה לא נוצרת. חלק 1 הוא
-- מה שהופך את השקט הזה לשורה בטבלה.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- חלק 1 — בדיקת מצב (קריאה בלבד, בטוח להריץ תמיד)
-- ---------------------------------------------------------------------------
with checks as (
  select 1 as ord, 'סכמה: טבלאות ההדמיות' as בדיקה,
         (select count(*) = 3 from pg_class
           where relname in ('property_image_tags','visualization_jobs','property_visualizations')
             and relnamespace = 'public'::regnamespace) as תקין,
         'המיגרציה 20260827180000 לא הורצה' as אם_לא

  union all select 2, 'סכמה: bucket ציבורי לתמונות',
         (select count(*) = 1 from storage.buckets where id = 'property-visualizations' and public),
         'ה-bucket חסר או אינו ציבורי לקריאה'

  union all select 3, 'סכמה: התוסף pg_net',
         (select exists (select 1 from pg_extension where extname = 'pg_net')),
         'בלעדיו הטריגר לא יכול לקרוא ל-Edge Function'

  union all select 4, 'טריגר: קיים ומופעל',
         (select tgenabled = 'O' from pg_trigger
           where tgrelid = 'public.properties'::regclass
             and tgname = 'properties_enqueue_base_visualization'),
         'הטריגר חסר או כובה ב-disable trigger'

  union all select 5, 'טריגר: חוסם קרקע (מגרש/נחלה/משק)',
         (select pg_get_functiondef(oid) like '%is_land_property_type%'
            from pg_proc where proname = 'enqueue_base_visualization'),
         'המיגרציה 20260910090000 לא הורצה — נכס קרקע ישלח בקשה שתידחה'

  -- שני הסודות האלה הם מתג ההפעלה של האוטומציה. בלעדיהם הטריגר יוצא מיד
  -- ובשקט, בלי שגיאה ובלי שורה בלוג — ראו חלק 2.
  union all select 6, 'הפעלה: הסוד visualization_service_key',
         (select exists (select 1 from vault.secrets where name = 'visualization_service_key')),
         'הטריגר האוטומטי רדום — הריצו את חלק 2'

  union all select 7, 'הפעלה: הסוד edge_functions_base_url',
         (select exists (select 1 from vault.secrets where name = 'edge_functions_base_url')),
         'הטריגר האוטומטי רדום — הריצו את חלק 2'

  union all select 8, 'שדרוג: טריגר על agency_members',
         (select tgenabled = 'O' from pg_trigger
           where tgrelid = 'public.agency_members'::regclass
             and tgname = 'agency_members_enqueue_visualization_backfill'),
         'המיגרציה 20260918090000 לא הורצה — שדרוג ל-Premium לא ימלא נכסים קיימים'

  -- בלי ה-cron התור מתמלא ולא מתרוקן, וזה הכשל השקט הקלאסי של המנגנון הזה:
  -- הכל "עובד", השורות ממתינות, ואף הדמיה לא נוצרת.
  union all select 9, 'שדרוג: cron שמרוקן את התור',
         (select active from cron.job where jobname = 'visualization-backfill-drain'),
         'ה-cron חסר או כובה — התור יתמלא ולא יתרוקן'

  union all select 10, 'תוכן: יש נכס זכאי עם תמונות',
         (select exists (
            select 1 from public.properties p
            join public.agency_members m on m.id = p.agent_id
            where p.category = 'residential' and p.status = 'active'
              and m.tier = 'premium' and m.active and m.billing_status = 'active'
              and coalesce(array_length(p.images, 1), 0) > 0
              and not public.is_land_property_type(p.property_type))),
         'אין למי לייצר: אין נכס פרטי פעיל של סוכן/ת Premium עם תמונות'
)
select ord as "#",
       case when תקין then '✅' else '❌' end as מצב,
       בדיקה,
       case when תקין then '' else אם_לא end as "מה חסר"
from checks order by ord;

-- ‏GEMINI_API_KEY אינו נראה מה-DB — הוא סוד של Edge Functions, לא של Vault.
-- הדרך היחידה לדעת אם הוגדר היא לשאול את הפונקציה עצמה. הקריאה הזו אינה
-- עולה כלום: מזהה נכס שאינו קיים מסיים את הפונקציה לפני קריאת Gemini, אבל
-- *אחרי* בדיקת המפתח — כלומר היא בודקת בדיוק את מה שצריך ולא מייצרת דבר.
-- הכותרת x-alert-cron-secret נשלפת מ-Vault באותה דרך שבה ה-cron שולח אותה.
-- בלעדיה הפונקציה עונה 401, ובלי שהסוד מוגדר ב-Edge Functions Secrets היא
-- עונה 503 — שתי תשובות שהשאילתה הבאה מפרשת במפורש.
select net.http_post(
  url     := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/classify-property-images',
  headers := jsonb_strip_nulls(jsonb_build_object(
    'Content-Type', 'application/json',
    'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                             where name = 'alert_cron_secret' limit 1))),
  body    := '{"property_id":"00000000-0000-0000-0000-000000000000"}'::jsonb
) as "מזהה בקשה — הריצו את השאילתה הבאה בעוד כמה שניות";

-- ‏{"ok":true,...}                       → המפתח מוגדר
-- ‏{"error":"gemini_not_configured"}      → הגדירו GEMINI_API_KEY ב-Edge Functions → Secrets
-- ‏{"error":"cron_secret_not_configured"} → הגדירו ALERT_CRON_SECRET ב-Edge Functions → Secrets
-- ‏{"error":"unauthorized"}               → הסוד ב-Vault שונה מזה שב-Secrets
select status_code,
       content as תשובה,
       case
         when content::text like '%cron_secret_not_configured%'
           then '❌ הגדירו ALERT_CRON_SECRET ב-Supabase → Edge Functions → Secrets'
         when content::text like '%unauthorized%'
           then '❌ ALERT_CRON_SECRET שונה מסוד ה-Vault alert_cron_secret'
         when content::text like '%gemini_not_configured%'
           then '❌ הגדירו GEMINI_API_KEY ב-Supabase → Edge Functions → Secrets'
         when status_code = 200 then '✅ המפתח מוגדר'
         else '⚠️ תשובה לא צפויה — ראו את התוכן'
       end as מסקנה
from net._http_response
order by id desc limit 1;


-- ---------------------------------------------------------------------------
-- חלק 2 — הפעלת הטריגר האוטומטי
--
-- להחליף את <SERVICE_ROLE_KEY> במפתח מ-Settings → API → service_role ולהריץ.
-- אידמפוטנטי: הרצה חוזרת מעדכנת את הסוד הקיים במקום להיכשל על שם תפוס.
--
-- ⚠️ ה-service_role key עוקף RLS. הוא נכנס ל-Vault ולא לקוד, ואין להדביק
--    אותו בקובץ שנשמר בגרסאות.
-- ---------------------------------------------------------------------------
/*
do $$
declare
  v_key text := '<SERVICE_ROLE_KEY>';
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1';
  v_id  uuid;
begin
  if v_key like '<%' then
    raise exception 'החליפו את <SERVICE_ROLE_KEY> במפתח האמיתי לפני ההרצה';
  end if;

  select id into v_id from vault.secrets where name = 'visualization_service_key';
  if v_id is null then
    perform vault.create_secret(v_key, 'visualization_service_key',
      'מפתח service_role לקריאות פנימיות ממנגנון ההדמיות');
  else
    perform vault.update_secret(v_id, v_key);
  end if;

  select id into v_id from vault.secrets where name = 'edge_functions_base_url';
  if v_id is null then
    perform vault.create_secret(v_url, 'edge_functions_base_url',
      'כתובת הבסיס של ה-Edge Functions');
  else
    perform vault.update_secret(v_id, v_url);
  end if;

  raise notice 'הטריגר פעיל. כל נכס פרטי חדש של סוכן/ת Premium יקבל סט בסיס.';
end $$;
*/

-- לכיבוי זמני של האוטומציה בלי לגעת בקוד ובלי למחוק סודות:
--   alter table public.properties disable trigger properties_enqueue_base_visualization;


-- ---------------------------------------------------------------------------
-- חלק 3 — מילוי לאחור
--
-- הטריגר מטפל רק באירוע פרסום עתידי, ולכן נכס שכבר מפורסם לא יקבל הדמיות
-- לעולם בלי דחיפה אחת. השאילתה מחזירה בדיוק את הרשימה הזו.
--
-- להרצה בפועל: scripts/visualizations_backfill.sh
--
-- שדרוג סוכן/ת כבר לא דורש את זה — הוא נרשם לתור אוטומטית. מצב התור:
--
--   select status, count(*) from public.visualization_backfill_queue group by status;
--
-- ‏pending שנתקע פירושו שסודות ה-Vault חסרים (חלק 2) או שה-cron כבוי.
-- לרישום ידני של סוכן/ת לתור, אחרי תיקון נתונים:
--
--   select public.queue_agent_visualization_backfill('<AGENT_ID>');
-- ---------------------------------------------------------------------------
select p.id,
       p.title,
       p.property_type,
       coalesce(array_length(p.images, 1), 0) as תמונות,
       (select count(*) from public.property_visualizations v
         where v.property_id = p.id and v.is_base) as הדמיות_בסיס_קיימות
from public.properties p
join public.agency_members m on m.id = p.agent_id
where p.category = 'residential'
  and p.status = 'active'
  and m.tier = 'premium' and m.active and m.billing_status = 'active'
  and coalesce(array_length(p.images, 1), 0) > 0
  and not public.is_land_property_type(p.property_type)
order by p.created_at desc;
