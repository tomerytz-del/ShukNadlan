-- ===========================================================================
-- אזור ההטמעה: סנכרון היומן ליומן Google (docs/csm-adoption.md, "יומן Google")
-- ---------------------------------------------------------------------------
-- עד כאן לכל פגישה ביומן ההטמעה היה כפתור "ליומן Google" - קישור תבנית
-- שמוסיף אותה ידנית, פעם אחת, ואינו יודע על הזזה או ביטול. כאן אותו סנכרון
-- של הסוכנים (docs/google-calendar.md), לצוות ההטמעה:
--
--   - אותו לקוח OAuth, אותן הרשאות צרות (calendar.app.created +
--     calendar.freebusy), ואותה כתובת חזרה (/auth/google-calendar). ה-state
--     החתום נושא "csm:<staff_id>" במקום מזהה סוכן/ת, וה-callback מפצל לפיו.
--   - טבלאות משלו: csm_calendar_connections (גלוי לה) ו-csm_calendar_secrets
--     (הטוקן המוצפן, service_role בלבד). **לא** שורה ב-agent_calendar_* - שם
--     המפתח הוא agency_members, והיא אינה סוכנת (הסקיל csm-adoption).
--   - טריגר שמסמן pending על פגישה שהשתנה, cron שמעיר את
--     google-calendar-sync?scope=csm רק כשיש מה לסנכרן, ותפיסה עם syncing.
--   - פגישה שנמחקה מהיומן משאירה מצבה (csm_calendar_tombstones), כדי שהאירוע
--     יימחק גם ב-Google - בלי זה הוא היה נשאר שם יתום.
--   - אשת צוות שהושבתה: היומן שלנו נמחק ב-Google וההרשאה מבוטלת.
--
-- המיגרציה אידמפוטנטית.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. החיבור והטוקן
-- ---------------------------------------------------------------------------
create table if not exists public.csm_calendar_connections (
  staff_id      uuid primary key references public.csm_staff(id) on delete cascade,
  google_email  text,
  calendar_id   text,
  scopes        text[] not null default '{}',
  status        text not null default 'active' check (status in ('active','revoked','error')),
  last_error    text,
  last_sync_at  timestamptz,
  connected_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.csm_calendar_connections is
  'חיבור יומן Google של אשת צוות ההטמעה. הטוקן ב-csm_calendar_secrets. docs/csm-adoption.md';

create table if not exists public.csm_calendar_secrets (
  staff_id          uuid primary key references public.csm_staff(id) on delete cascade,
  refresh_token_enc text not null,
  updated_at        timestamptz not null default now()
);

comment on table public.csm_calendar_secrets is
  'ה-refresh token של Google לצוות ההטמעה, מוצפן (GOOGLE_CALENDAR_TOKEN_KEY). service_role בלבד.';

alter table public.csm_calendar_connections enable row level security;
alter table public.csm_calendar_secrets     enable row level security;

revoke all on table public.csm_calendar_connections from anon;
revoke insert, update, delete on table public.csm_calendar_connections from authenticated;
grant select on table public.csm_calendar_connections to authenticated;
grant select, insert, update, delete on table public.csm_calendar_connections to service_role;
revoke all on table public.csm_calendar_secrets from anon, authenticated;
grant select, insert, update, delete on table public.csm_calendar_secrets to service_role;

-- קריאה בלבד, שלה. החיבור והניתוק דרך csm-workspace (‏gcal_start / gcal_disconnect).
drop policy if exists "csm staff reads own calendar connection" on public.csm_calendar_connections;
create policy "csm staff reads own calendar connection" on public.csm_calendar_connections
  for select to authenticated
  using (staff_id = public.current_csm_id() or public.current_is_platform_admin());

-- ---------------------------------------------------------------------------
-- 2. העמודות על הפגישה, והסימון
-- ---------------------------------------------------------------------------
alter table public.csm_agenda add column if not exists google_event_id   text;
alter table public.csm_agenda add column if not exists google_sync_state text;
alter table public.csm_agenda add column if not exists google_sync_error text;
alter table public.csm_agenda add column if not exists google_sync_at    timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'csm_agenda_google_sync_state') then
    alter table public.csm_agenda add constraint csm_agenda_google_sync_state
      check (google_sync_state is null or google_sync_state in ('pending','syncing','synced','error'));
  end if;
end $$;

create index if not exists csm_agenda_google_pending on public.csm_agenda (staff_id)
  where google_sync_state in ('pending','syncing');

-- ‏before, כמו agent_agenda_items_google_mark: עדכון השורה מתוך after היה
-- מפעיל את הטריגרים שוב. רק כשהשתנה משהו שמופיע באירוע - הכתיבה של התוצאה
-- נוגעת רק ב-google_*, ולכן אינה מסמנת את עצמה מחדש.
create or replace function public.csm_agenda_google_mark()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.csm_calendar_connections cc
                  where cc.staff_id = new.staff_id and cc.status = 'active') then
    return new;
  end if;
  if tg_op = 'INSERT'
     or new.title            is distinct from old.title
     or new.notes            is distinct from old.notes
     or new.location         is distinct from old.location
     or new.meeting_url      is distinct from old.meeting_url
     or new.starts_at        is distinct from old.starts_at
     or new.duration_minutes is distinct from old.duration_minutes
     or new.status           is distinct from old.status
     or new.kind             is distinct from old.kind
     or new.agent_id         is distinct from old.agent_id then
    new.google_sync_state := 'pending';
    new.google_sync_error := null;
  end if;
  return new;
end;
$$;

revoke all on function public.csm_agenda_google_mark() from public, anon, authenticated;

drop trigger if exists csm_agenda_google_mark on public.csm_agenda;
create trigger csm_agenda_google_mark before insert or update on public.csm_agenda
  for each row execute function public.csm_agenda_google_mark();

-- פגישה שנמחקה: האירוע ב-Google יימחק בסבב הבא
create table if not exists public.csm_calendar_tombstones (
  id               uuid primary key default gen_random_uuid(),
  staff_id         uuid not null references public.csm_staff(id) on delete cascade,
  google_event_id  text not null,
  created_at       timestamptz not null default now()
);

alter table public.csm_calendar_tombstones enable row level security;
revoke all on table public.csm_calendar_tombstones from anon, authenticated;
grant select, insert, update, delete on table public.csm_calendar_tombstones to service_role;

create or replace function public.csm_agenda_google_tombstone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.google_event_id is not null then
    insert into public.csm_calendar_tombstones (staff_id, google_event_id)
    values (old.staff_id, old.google_event_id);
  end if;
  return old;
end;
$$;

revoke all on function public.csm_agenda_google_tombstone() from public, anon, authenticated;

drop trigger if exists csm_agenda_google_tombstone on public.csm_agenda;
create trigger csm_agenda_google_tombstone after delete on public.csm_agenda
  for each row execute function public.csm_agenda_google_tombstone();

-- ---------------------------------------------------------------------------
-- 3. אחרי חיבור ואחרי ניתוק
-- ---------------------------------------------------------------------------
-- אחרי חיבור: כל מה שעוד לפניה (ומה שהתקיים ביממה האחרונה) עובר ל-Google
create or replace function public.csm_calendar_mark_backfill(p_staff_id uuid)
returns int
language sql
security definer
set search_path = ''
as $$
  with u as (
    update public.csm_agenda g
       set google_sync_state = 'pending', google_sync_error = null
     where g.staff_id = p_staff_id
       and g.status in ('scheduled','done')
       and g.starts_at > now() - interval '1 day'
    returning 1
  )
  select count(*)::int from u;
$$;

revoke all on function public.csm_calendar_mark_backfill(uuid) from public, anon, authenticated;
grant execute on function public.csm_calendar_mark_backfill(uuid) to service_role;

-- אחרי ניתוק: היומן נמחק ב-Google, והמזהים אינם מצביעים לשום דבר
create or replace function public.csm_calendar_clear_items(p_staff_id uuid)
returns int
language sql
security definer
set search_path = ''
as $$
  with u as (
    update public.csm_agenda g
       set google_event_id = null, google_sync_state = null, google_sync_error = null, google_sync_at = null
     where g.staff_id = p_staff_id
       and (g.google_event_id is not null or g.google_sync_state is not null)
    returning 1
  ), t as (
    delete from public.csm_calendar_tombstones where staff_id = p_staff_id returning 1
  )
  select (select count(*)::int from u);
$$;

revoke all on function public.csm_calendar_clear_items(uuid) from public, anon, authenticated;
grant execute on function public.csm_calendar_clear_items(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. התפיסה, והשאלה הזולה של ה-cron
-- ---------------------------------------------------------------------------
-- אשת צוות שהושבתה עם חיבור פעיל: ניתוק מלא בסבב הבא
create or replace function public.csm_calendar_inactive_staff()
returns table (staff_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select cc.staff_id
    from public.csm_calendar_connections cc
    join public.csm_staff s on s.id = cc.staff_id
   where cc.status = 'active' and not s.active;
$$;

revoke all on function public.csm_calendar_inactive_staff() from public, anon, authenticated;
grant execute on function public.csm_calendar_inactive_staff() to service_role;

create or replace function public.csm_gcal_sync_ready()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.csm_agenda g
      join public.csm_calendar_connections cc on cc.staff_id = g.staff_id and cc.status = 'active'
     where g.google_sync_state = 'pending'
        or (g.google_sync_state = 'syncing' and g.updated_at < now() - interval '5 minutes')
  )
  or exists (
    select 1 from public.csm_calendar_tombstones t
      join public.csm_calendar_connections cc on cc.staff_id = t.staff_id and cc.status = 'active'
  )
  or exists (select 1 from public.csm_calendar_inactive_staff());
$$;

revoke all on function public.csm_gcal_sync_ready() from public, anon, authenticated;
grant execute on function public.csm_gcal_sync_ready() to service_role;

-- ‏syncing נשען על updated_at, ו-csm_agenda_before_write מעדכן אותו בכל update -
-- כולל זה שמסמן syncing. כך פגישה שנתקעה (פונקציה שנחתכה) חוזרת לתור אחרי
-- חמש דקות.
create or replace function public.csm_gcal_sync_claim(p_limit int default 50)
returns table (
  event_id         uuid,
  staff_id         uuid,
  calendar_id      text,
  kind             text,
  title            text,
  notes            text,
  location         text,
  meeting_url      text,
  starts_at        timestamptz,
  duration_minutes smallint,
  status           text,
  agent_name       text,
  agent_phone      text,
  agency_name      text,
  google_event_id  text,
  include          boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  return query
  with picked as (
    select g.id
      from public.csm_agenda g
      join public.csm_calendar_connections cc on cc.staff_id = g.staff_id and cc.status = 'active'
      join public.csm_staff s on s.id = g.staff_id and s.active
     where g.google_sync_state = 'pending'
        or (g.google_sync_state = 'syncing' and g.updated_at < now() - interval '5 minutes')
     order by g.updated_at
     limit least(greatest(coalesce(p_limit, 50), 1), 200)
     for update of g skip locked
  ), marked as (
    update public.csm_agenda g set google_sync_state = 'syncing'
      from picked where g.id = picked.id
    returning g.*
  )
  select m.id, m.staff_id, cc.calendar_id, m.kind, m.title, m.notes, m.location, m.meeting_url,
         m.starts_at, m.duration_minutes, m.status,
         a.display_name, coalesce(a.phone, a.phone_e164), ag.name, m.google_event_id,
         -- האם האירוע אמור להתקיים ב-Google. ‏false = למחוק אם יש.
         m.status in ('scheduled','done')
    from marked m
    join public.csm_calendar_connections cc on cc.staff_id = m.staff_id
    left join public.agency_members a on a.id = m.agent_id
    left join public.agencies ag on ag.id = a.agency_id;
end;
$$;

comment on function public.csm_gcal_sync_claim(int) is
  'פגישות של צוות ההטמעה שממתינות לסנכרון מול Google, מסומנות syncing. google-calendar-sync (?scope=csm) כותבת את התוצאה רק אם הפגישה עדיין syncing.';

revoke all on function public.csm_gcal_sync_claim(int) from public, anon, authenticated;
grant execute on function public.csm_gcal_sync_claim(int) to service_role;

-- ---------------------------------------------------------------------------
-- 5. התזמון - כל דקה, רק כשיש מה לסנכרן. ‏cron נפרד מזה של הסוכנים, כדי
--    שלא לכתוב מחדש את google_calendar_sync_ready שלהם.
-- ---------------------------------------------------------------------------
do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/google-calendar-sync?scope=csm';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - סנכרון יומן ההטמעה לא תוזמן';
    return;
  end if;

  perform cron.unschedule('csm-gcal-sync')
    where exists (select 1 from cron.job where jobname = 'csm-gcal-sync');
  perform cron.schedule('csm-gcal-sync', '* * * * *', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1))),
      timeout_milliseconds := 30000
    )
    where public.csm_gcal_sync_ready();
  $cron$, v_url));
end;
$$;
