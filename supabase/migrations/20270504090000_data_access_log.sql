-- ===========================================================================
-- יומן גישה למידע (data_access_log) - תקנה 10 לתקנות הגנת הפרטיות
-- (אבטחת מידע), תשע"ז-2017
--
-- ‏**מה התקנה דורשת:** במאגר ברמת אבטחה בינונית ומעלה - תיעוד אוטומטי של
-- כל ניסיון גישה: זהות המשתמש/ת, תאריך ושעה, הרכיב שאליו ניסו לגשת, סוג
-- הגישה, ואם הותרה או נדחתה. ולשמור את התיעוד **24 חודשים** לפחות.
--
-- ‏**למה לא טריגר:** טריגר אינו רואה SELECT, ו-PostgREST מריץ GET בטרנזקציה
-- לקריאה בלבד - גם ה-pre-request (‏mfa_pre_request) אינו יכול לכתוב בה.
--
-- ‏**מאיפה זה מגיע במקום:** שער ה-API של Supabase כבר רושם כל בקשה - מי
-- (‏auth_user מה-JWT), מתי, איזו טבלה או פונקציה ואיזה סינון, וקוד התשובה.
-- אבל הוא שומר ימים בודדים בלבד. ‏scripts/access_log_sync.py (ה-workflow
-- ‏access_log.yml, כל שעה) מעתיק משם לטבלה הזו, וכאן היא נשמרת 3 שנים.
--
-- ‏**מה נכנס:** כל בקשה של משתמש/ת מחובר/ת או של service role ל-REST,
-- ‏Storage, ‏Functions ו-GraphQL; כל בקשה שנדחתה (401/403) גם בלי התחברות;
-- ואירועי Auth (כניסה, יציאה, שינוי סיסמה). ‏**מה לא:** בקשות אנונימיות
-- שהצליחו (גולשים באתר הציבורי) וטבלאות עזר ציבוריות - הרשימה בסקריפט.
--
-- קריאה: מנהל/ת פלטפורמה בלבד (RLS). כתיבה: החיבור של ה-workflow בלבד.
-- ‏docs/data-access-log.md
-- ===========================================================================

create table if not exists public.data_access_log (
  -- המזהה של שורת הלוג אצל Supabase. ייחודי, ולכן הרצה חוזרת על אותו חלון
  -- (החפיפה המכוונת בסקריפט) אינה מכפילה שורות.
  log_id      text primary key,
  at          timestamptz not null,
  -- 'api' = בקשה דרך שער ה-API; 'auth' = אירוע כניסה/יציאה
  kind        text not null default 'api' check (kind in ('api', 'auth')),
  user_id     uuid,
  role        text,
  session_id  uuid,
  method      text,
  path        text,
  query       text,
  status      smallint,
  ip          text,
  country     text,
  user_agent  text,
  -- ב-auth: הפעולה (login, logout, user_recovery_requested...)
  action      text
);

comment on table public.data_access_log is
  'יומן גישה למידע (תקנה 10): כל בקשה של משתמש/ת מחובר/ת וכל בקשה שנדחתה, 3 שנים. docs/data-access-log.md';

create index if not exists data_access_log_at_idx on public.data_access_log (at desc);
create index if not exists data_access_log_user_idx on public.data_access_log (user_id, at desc);

alter table public.data_access_log enable row level security;
revoke all on table public.data_access_log from public, anon, authenticated;
grant select on table public.data_access_log to authenticated;

drop policy if exists "platform admin reads access log" on public.data_access_log;
create policy "platform admin reads access log"
  on public.data_access_log for select to authenticated
  using (public.current_is_platform_admin());

-- ---------------------------------------------------------------------------
-- הסמן של הסנכרון: עד איפה הועתק, ומתי רץ לאחרונה. שורה אחת.
-- הסוכן התפעולי קורא את last_run_at ומתריע כשהסנכרון עומד
-- (‏access_log_stale), כי יומן שהפסיק להתמלא נראה בדיוק כמו יומן שקט.
-- ---------------------------------------------------------------------------
create table if not exists public.data_access_log_sync (
  id           smallint primary key default 1 check (id = 1),
  synced_until timestamptz,
  last_run_at  timestamptz,
  last_rows    integer,
  last_error   text
);

insert into public.data_access_log_sync (id) values (1) on conflict (id) do nothing;

alter table public.data_access_log_sync enable row level security;
revoke all on table public.data_access_log_sync from public, anon, authenticated;
grant select on table public.data_access_log_sync to authenticated;

drop policy if exists "platform admin reads access log sync" on public.data_access_log_sync;
create policy "platform admin reads access log sync"
  on public.data_access_log_sync for select to authenticated
  using (public.current_is_platform_admin());

-- ---------------------------------------------------------------------------
-- שמירה: 3 שנים (החלטת הבעלים, 13.10.2026), ואז מחיקה. התקנה דורשת 24
-- חודשים לפחות; השנה הנוספת היא מרווח לחקירת אירוע ישן. יומן שנשמר לנצח
-- הוא מאגר מידע אישי בפני עצמו (כתובות IP, מי עבד מתי).
-- ---------------------------------------------------------------------------
create or replace function public.data_access_log_purge()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  delete from public.data_access_log where at < now() - interval '3 years';
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.data_access_log_purge() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - data_access_log_purge לא תוזמנה';
    return;
  end if;
  perform cron.unschedule('data-access-log-purge')
    where exists (select 1 from cron.job where jobname = 'data-access-log-purge');
  perform cron.schedule('data-access-log-purge', '41 3 * * *',
                        'select public.data_access_log_purge()');
end $$;

-- ---------------------------------------------------------------------------
-- תצוגה ב-CRM: סיכום לפי משתמש/ת ויום, ופירוט של משתמש/ת אחד/ת. בפונקציה ולא
-- ב-select ישיר כדי שהסיכום ייעשה במסד (PostgREST חותך ב-1,000 שורות בשקט).
-- ---------------------------------------------------------------------------
create or replace function public.data_access_summary(p_days integer default 7)
returns table (
  user_id uuid, display_name text, day date,
  requests bigint, denied bigint, paths integer, ips integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select l.user_id,
         (select m.display_name from public.agency_members m
           where m.user_id = l.user_id order by m.created_at limit 1),
         (l.at at time zone 'Asia/Jerusalem')::date,
         count(*),
         count(*) filter (where l.status in (401, 403)),
         count(distinct l.path)::integer,
         count(distinct l.ip)::integer
    from public.data_access_log l
   where public.current_is_platform_admin()
     and l.at >= now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 90))
   group by 1, 3
   order by 3 desc, 4 desc
   limit 500;
$$;

revoke all on function public.data_access_summary(integer) from public, anon, authenticated;
grant execute on function public.data_access_summary(integer) to authenticated;
