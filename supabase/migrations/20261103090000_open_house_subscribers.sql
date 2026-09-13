-- ============================================================================
-- "עדכנו אותי כשנכנס נכס ליריד" — רשימת ההמתנה של יריד הבתים הפתוחים
--
-- היריד הוא אירוע: לפעמים יש בו שבעה נכסים ולפעמים אף אחד, ומי שנכנס לדף
-- ביום שקט אין לו מה לעשות שם. ההרשמה הזו היא מה שהופכת את היום השקט
-- לנקודת פתיחה — וברגע שנכס נכנס ליריד, מי שנרשם/ה יודע/ת ראשון/ה.
--
-- ## למה טבלה משלה ולא newsletter_subscribers
--
-- שתיהן רשימות דיוור עם אימייל, אבל הן מבטיחות דברים שונים: רשימת התפוצה
-- היא סיכום תקופתי של נכסים חדשים, וזו מבטיחה **התראה על אירוע מסוים** —
-- נכס שנכנס ליריד — ושום דבר אחר. אדם שנרשם לאחת לא נתן הסכמה לשנייה,
-- וביטול של אחת אינו ביטול של השנייה. עמודת `topic` על טבלה משותפת הייתה
-- מיטשטשת בדיוק את ההבחנה הזו ברגע שמישהו יכתוב `select … from
-- newsletter_subscribers` בלי where.
--
-- וגם טכנית: לרשימה הזו יש סמן משלה (`last_notified_at`) שאין לרשימת
-- התפוצה בכלל, והוא ליבת המנגנון.
--
-- ## הסמן
--
-- לכל נרשם/ת `last_notified_at`, שמתחיל ב-now() בעת ההרשמה: **מי שנרשם
-- היום לא מקבל/ת את מי שנכנס ליריד אתמול.** בכל סבב נשלחים רק הנכסים
-- שה-`open_house_joined_at` שלהם גדול מהסמן, והסמן מתקדם רק אחרי משלוח
-- שהצליח — מייל שנכשל יישלח שוב בסבב הבא ולא ייבלע.
--
-- ‏`open_house_joined_at` (ולא `open_house_start`) הוא מה שמודד "חדש
-- ביריד": ‏start הוא תאריך מוצהר שאפשר לערוך אחורה, ואילו joined_at נכתב
-- בטריגר ברגע שהנכס נכנס. ראו המיגרציה 20261102090000_open_house_fair.sql.
--
-- ## מה אין כאן
--
-- **אין וואטסאפ.** פתיחת שיחה עם מי שלא כתב/ה אלינו דורשת תבנית מאושרת
-- מ-Meta (ראו docs/smart-search-agent.md), ותבנית חדשה היא תהליך אישור
-- שאינו חלק מהיכולת הזו. הרשימה היא מייל בלבד, וזה גם מה שהטופס מבקש.
--
-- **אין דאבל אופט-אין.** כמו ברשימת התפוצה: כתובת נכנסת ישירות, וכל מייל
-- נושא קישור הסרה בלחיצה אחת (open-house-manage).
-- ============================================================================

create table if not exists public.open_house_subscribers (
  id                uuid primary key default gen_random_uuid(),
  email             text        not null,
  -- מאיזה עמוד/רכיב הגיעה ההרשמה. אותה צורה של newsletter_subscribers.source
  source            text        not null default 'open_house_page',
  created_at        timestamptz not null default now(),
  -- הסמן: עד לאן כבר עודכן/ה. מתחיל בהרשמה ומתקדם רק אחרי משלוח שהצליח.
  last_notified_at  timestamptz not null default now(),
  notify_count      integer     not null default 0,
  last_error        text,
  unsubscribed_at   timestamptz,
  -- ההרשאה היחידה של מי שאין לו/ה חשבון: הטוקן שהגיע אליו/ה במייל
  unsubscribe_token uuid        not null default gen_random_uuid(),
  constraint open_house_subscribers_email_chk check (
    email = lower(email)
    and length(email) between 6 and 254
    and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  )
);

comment on table public.open_house_subscribers is
  'נרשמים להתראה על נכסים שנכנסים ליריד הבתים הפתוחים (ללא עמלת תיווך). מייל בלבד, סגורה ל-service_role.';
comment on column public.open_house_subscribers.last_notified_at is
  'הסמן: נשלחים רק נכסים עם open_house_joined_at גדול ממנו. מתקדם רק אחרי משלוח שהצליח.';

create unique index if not exists open_house_subscribers_email_key
  on public.open_house_subscribers(email);
create unique index if not exists open_house_subscribers_token_key
  on public.open_house_subscribers(unsubscribe_token);
-- התור של שרת ההתראות: מי פעיל/ה, ומי הכי מפגר/ת מאחור
create index if not exists open_house_subscribers_pending_idx
  on public.open_house_subscribers(last_notified_at)
  where unsubscribed_at is null;

-- ---------------------------------------------------------------------------
-- הטבלה סגורה לחלוטין
--
-- ‏RLS פעיל בלי אף policy: אף תפקיד מלבד service_role לא קורא ולא כותב.
-- אימייל של אדם פרטי הוא מידע אישי, ורשימת דיוור גלויה היא רשימת יעדים
-- לספאם. ההרשמה עצמה נעשית דרך Edge Function (open-house-subscribe)
-- שמחזיקה את המפתח — בדיוק כמו newsletter_subscribers.
-- ---------------------------------------------------------------------------
alter table public.open_house_subscribers enable row level security;

revoke all on table public.open_house_subscribers from anon, authenticated;

-- ---------------------------------------------------------------------------
-- התנאי של ה-cron
--
-- ‏superset ולא subset, כמו כל שאר תנאי ה-cron בפרויקט (ראו
-- 20261021090000_cron_conditional_dispatch.sql): כאן נבדק רק "יש נרשם/ת
-- שממתין/ה לנכס שכבר ביריד". המרווח המזערי בין שני מיילים לאותו אדם
-- (‏OPEN_HOUSE_MIN_GAP_MINUTES) נבדק בפונקציה בלבד — קבוע שמוגדר פעמיים
-- הוא קבוע שיתפצל, והתוצאה תהיה נרשם/ת שהתנאי חוסם ולשרת יש מה לשלוח לו/ה.
-- ---------------------------------------------------------------------------
create or replace function public.open_house_digest_pending()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.open_house_subscribers s
     where s.unsubscribed_at is null
       and exists (
         select 1
           from public.properties p
          where p.status = 'active'
            and p.open_house
            and p.open_house_start <= now()
            and p.open_house_end   >  now()
            and p.open_house_joined_at > s.last_notified_at
       )
  );
$$;

comment on function public.open_house_digest_pending() is
  'האם יש למי לשלוח עדכון יריד. תנאי הדליקה של ה-cron open-house-notify.';

revoke all on function public.open_house_digest_pending() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- קידום הסמן אחרי משלוח שהצליח
--
-- שלוש כתיבות בפקודה אחת, ולא ‎update‎ מ-PostgREST: ‏`notify_count =
-- notify_count + 1` אינו ניתן לביטוי שם בלי לקרוא קודם את הערך, וקריאה
-- ואז כתיבה היא מרוץ מול הסבב הבא. השורה ננעלת ממילא ע"י ה-update עצמו.
-- ---------------------------------------------------------------------------
create or replace function public.open_house_mark_notified(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.open_house_subscribers
     set last_notified_at = now(),
         notify_count     = notify_count + 1,
         last_error       = null
   where id = p_id;
$$;

comment on function public.open_house_mark_notified(uuid) is
  'מקדם את הסמן של נרשם/ת יריד אחרי משלוח שהצליח. ל-service_role בלבד, דרך open-house-notify.';

revoke all on function public.open_house_mark_notified(uuid) from public, anon, authenticated;
-- ‏grant מפורש: ‏revoke מ-public מסיר את ההרשאה גם מ-service_role, שקיבל
-- אותה דרכו. ‏open-house-notify קוראת לפונקציה במפתח הזה — בלי השורה הזו
-- העדכון יוצא והסמן לא זז, כלומר אותו מייל בכל רבע שעה.
grant execute on function public.open_house_mark_notified(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- התזמון
--
-- כל רבע שעה, אבל **רק כשיש עבודה**: ‏select … where <תנאי> בלי from מייצר
-- אפס שורות כשהתנאי שקרי, ואז net.http_post כלל אינו מוערך. ברוב השעות
-- ביממה אין נכס חדש ביריד, ולכן זה כמעט תמיד no-op בעלות של בדיקת אינדקס.
--
-- הדקה 11: ‏expire-promotions יושבת על הדקות העגולות ו-expire-open-house על
-- 7, ושלוש משימות שנוגעות ב-properties באותו רגע נועלות זו את זו ללא צורך.
--
-- ‏timeout_milliseconds := 30000 מההתחלה, ולא ברירת המחדל של pg_net (5
-- שניות): משלוח מייל אחד דרך SMTP לוקח כשנייה וחצי, וסבב של כמה נרשמים
-- חוצה את חמש השניות בקלות. ראו 20261030090000_cron_http_timeout.sql —
-- שם זה התגלה כ-"‏500 EDGE_FUNCTION_ERROR" שהוא בכלל ניתוק מצד הקורא.
-- ---------------------------------------------------------------------------
do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/open-house-notify';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן — אין מה לתזמן';
    return;
  end if;

  perform cron.unschedule('open-house-notify')
    where exists (select 1 from cron.job where jobname = 'open-house-notify');

  perform cron.schedule('open-house-notify', '11-59/15 * * * *', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1))),
      timeout_milliseconds := 30000
    )
    where public.open_house_digest_pending()
  $cron$, v_url));
end $$;
