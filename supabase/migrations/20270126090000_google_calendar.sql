-- ============================================================================
-- חיבור יומן Google של הסוכן/ת - תהליך נפרד, בלחיצה על "חבר/י יומן"
--
-- ## מה כאן
--
-- היומן של שוק נדל"ן (`agent_agenda_items`, מיגרציה 20270125090000) עובד
-- בלי Google. מי שמחבר/ת יומן מקבל/ת שני דברים נוספים:
--
--   1. **הפגישות מופיעות ביומן Google** - פגישה, סיור וחתימה נכתבים ליומן
--      משנה בשם "שוק נדל"ן" שנוצר בחשבון שלו/ה. שינוי ומחיקה עוברים גם הם.
--   2. **הבוט יודע מתי הסוכן/ת פנוי/ה** - `agenda_free_slots` קורא את
--      הזמינות (פנוי/תפוס בלבד) מהיומן הראשי.
--
-- ## למה ההרשאות הצרות ביותר
--
-- ‏`calendar.app.created` + ‏`calendar.freebusy` (ועוד `openid email`, כדי
-- להציג איזה חשבון חובר). אנחנו כותבים **רק** ליומן שיצרנו, ומהיומן האישי
-- רואים רק "תפוס מ-14:00 עד 15:00", בלי כותרות ובלי משתתפים. תוכן היומן
-- האישי - פגישה אצל רופא, אירוע משפחתי - לא מגיע אלינו, לא נשמר ולא עובר
-- למודל שפה. המחיר: אין דרך להזיז פגישה שנקבעה ישירות ב-Google.
--
-- ## החיבור אינו הכניסה עם Google
--
-- ‏Supabase אינו שומר בשרת את הטוקן של Google מהכניסה, חלק מהסוכנים נכנסים
-- בסיסמה, ובקשת הרשאת יומן בכל כניסה הייתה מבהילה גם את מי שלא צריך/ה.
-- לכן זה OAuth נפרד (`google-calendar-connect` → Google →
-- ‏`google-calendar-callback`), שמתחיל רק בלחיצה.
--
-- ## הסנכרון
--
-- טריגר מסמן `google_sync_state = 'pending'` על פריט שהשתנה, ה-cron של כל
-- דקה מעיר את `google-calendar-sync` רק כשיש כאלה, והפונקציה כותבת ל-Google
-- ומסמנת `synced`. מזהה האירוע ב-Google נגזר ממזהה הפריט, ולכן ניסיון חוזר
-- אינו יוצר אירוע כפול.
--
-- הקובץ אידמפוטנטי.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. החיבור - גלוי לסוכן/ת (מצב, חשבון, שגיאה), בלי הטוקן
-- ---------------------------------------------------------------------------
create table if not exists public.agent_calendar_connections (
  agent_id      uuid primary key references public.agency_members(id) on delete cascade,
  google_email  text,
  calendar_id   text,
  scopes        text[] not null default '{}',
  status        text not null default 'active' check (status in ('active','revoked','error')),
  last_error    text,
  last_sync_at  timestamptz,
  connected_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.agent_calendar_connections is
  'חיבור יומן Google של הסוכן/ת: איזה חשבון, איזה יומן משנה, ומה המצב. הטוקן עצמו ב-agent_calendar_secrets. ראו docs/google-calendar.md.';

-- ---------------------------------------------------------------------------
-- 2. הטוקן - מוצפן, ואין אליו גישה מהדפדפן בשום מפתח
--
-- ‏refresh token של Google הוא גישה ליומן לאורך זמן, בלי סיסמה. הוא נשמר
-- מוצפן ב-AES-GCM במפתח שיושב בסודות של ה-Edge Functions
-- (‏GOOGLE_CALENDAR_TOKEN_KEY) ולא במסד: דליפה של גיבוי המסד לבדו אינה
-- מדליפה את היומנים.
-- ---------------------------------------------------------------------------
create table if not exists public.agent_calendar_secrets (
  agent_id          uuid primary key references public.agency_members(id) on delete cascade,
  refresh_token_enc text not null,
  updated_at        timestamptz not null default now()
);

comment on table public.agent_calendar_secrets is
  'ה-refresh token של Google, מוצפן. service_role בלבד - אין policy ואין grant לאף תפקיד של הדפדפן.';

alter table public.agent_calendar_connections enable row level security;
alter table public.agent_calendar_secrets     enable row level security;

revoke all on public.agent_calendar_connections from anon;
revoke insert, update, delete on public.agent_calendar_connections from authenticated;
revoke all on public.agent_calendar_secrets from anon, authenticated;

-- קריאה בלבד. החיבור והניתוק עוברים דרך `google-calendar-connect`, כי הם
-- דורשים את הסוד של האפליקציה מול Google.
drop policy if exists "agent reads own calendar connection" on public.agent_calendar_connections;
create policy "agent reads own calendar connection"
  on public.agent_calendar_connections for select
  to authenticated
  using (agent_id = public.current_agent_id());

-- ---------------------------------------------------------------------------
-- 3. העמודות על הפריט
-- ---------------------------------------------------------------------------
alter table public.agent_agenda_items
  add column if not exists google_event_id   text,
  add column if not exists google_sync_state text,
  add column if not exists google_sync_error text,
  add column if not exists google_sync_at    timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'agent_agenda_items_google_sync_state') then
    alter table public.agent_agenda_items add constraint agent_agenda_items_google_sync_state
      check (google_sync_state is null or google_sync_state in ('pending','syncing','synced','error'));
  end if;
end $$;

create index if not exists agent_agenda_items_google_pending
  on public.agent_agenda_items (agent_id)
  where google_sync_state in ('pending','syncing');

-- ---------------------------------------------------------------------------
-- 4. מה עובר ל-Google
--
-- פגישה, סיור וחתימה עם מועד - האירועים שתופסים זמן ביומן. שיחה ומשימה
-- נשארות אצלנו: יומן Google אינו בנוי לסימון "בוצע" או לתזכורת איחור, ומשימה
-- של 09:00 שנראית כמו פגישה חוסמת את הבוקר בעיני מי שמתאם/ת מולו/ה.
-- ---------------------------------------------------------------------------
create or replace function public.agent_agenda_google_kind(p_kind text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_kind in ('meeting','showing','signing');
$$;

revoke all on function public.agent_agenda_google_kind(text) from public, anon, authenticated;
grant execute on function public.agent_agenda_google_kind(text) to service_role;

-- הסימון. ‏before ולא after: עדכון של אותה שורה מתוך טריגר after היה מפעיל
-- את כל הטריגרים שוב. ורק כשהשתנה משהו שמופיע באירוע - הפונקציה שכותבת את
-- התוצאה נוגעת רק בעמודות google_*, ולכן אינה מסמנת את עצמה מחדש.
create or replace function public.agent_agenda_items_google_mark()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.agent_calendar_connections cc
                  where cc.agent_id = new.agent_id and cc.status = 'active') then
    return new;
  end if;

  if not (public.agent_agenda_google_kind(new.kind) and new.due_at is not null)
     and new.google_event_id is null then
    return new;
  end if;

  if tg_op = 'INSERT'
     or new.title    is distinct from old.title
     or new.notes    is distinct from old.notes
     or new.location is distinct from old.location
     or new.due_at   is distinct from old.due_at
     or new.ends_at  is distinct from old.ends_at
     or new.status   is distinct from old.status
     or new.kind     is distinct from old.kind
     or new.client_id is distinct from old.client_id then
    new.google_sync_state := 'pending';
    new.google_sync_error := null;
  end if;

  return new;
end;
$$;

revoke all on function public.agent_agenda_items_google_mark() from public, anon, authenticated;

drop trigger if exists agent_agenda_items_google_mark on public.agent_agenda_items;
create trigger agent_agenda_items_google_mark
  before insert or update on public.agent_agenda_items
  for each row execute function public.agent_agenda_items_google_mark();

-- ---------------------------------------------------------------------------
-- 5. אחרי חיבור: כל הפגישות הפתוחות מהיום והלאה עוברות ל-Google
-- ---------------------------------------------------------------------------
create or replace function public.agent_calendar_mark_backfill(p_agent_id uuid)
returns int
language sql
security definer
set search_path = ''
as $$
  with u as (
    update public.agent_agenda_items i
       set google_sync_state = 'pending', google_sync_error = null
     where i.agent_id = p_agent_id
       and i.status = 'open'
       and public.agent_agenda_google_kind(i.kind)
       and i.due_at > now() - interval '1 day'
    returning 1
  )
  select count(*)::int from u;
$$;

revoke all on function public.agent_calendar_mark_backfill(uuid) from public, anon, authenticated;
grant execute on function public.agent_calendar_mark_backfill(uuid) to service_role;

-- אחרי ניתוק: היומן נמחק ב-Google, ולכן המזהים כאן אינם מצביעים לשום דבר.
create or replace function public.agent_calendar_clear_items(p_agent_id uuid)
returns int
language sql
security definer
set search_path = ''
as $$
  with u as (
    update public.agent_agenda_items i
       set google_event_id = null, google_sync_state = null,
           google_sync_error = null, google_sync_at = null
     where i.agent_id = p_agent_id
       and (i.google_event_id is not null or i.google_sync_state is not null)
    returning 1
  )
  select count(*)::int from u;
$$;

revoke all on function public.agent_calendar_clear_items(uuid) from public, anon, authenticated;
grant execute on function public.agent_calendar_clear_items(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. התפיסה והשאלה הזולה של ה-cron
--
-- ‏`syncing` שנתקע יותר מחמש דקות (פונקציה שנחתכה) חוזר לתור. ההחלטה מי
-- מסונכרן במסד, כמו בשאר ה-cron-ים: חיבור פעיל ומסלול בתוקף.
-- ---------------------------------------------------------------------------
-- חשבון שנסגר עם חיבור פעיל: היומן שלנו נמחק ב-Google וההרשאה מבוטלת.
-- זה קורה כאן ולא ב-`close-account`, כי סגירה מתוזמנת (מנוי חודשי) נכנסת
-- לתוקף בריצה של המסד, שאינה יכולה לדבר עם Google.
create or replace function public.google_calendar_closed_agents()
returns table (agent_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select cc.agent_id
    from public.agent_calendar_connections cc
    join public.agency_members m on m.id = cc.agent_id
   where cc.status = 'active'
     and m.closed_at is not null;
$$;

revoke all on function public.google_calendar_closed_agents() from public, anon, authenticated;
grant execute on function public.google_calendar_closed_agents() to service_role;

create or replace function public.google_calendar_sync_ready()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.agent_agenda_items i
      join public.agent_calendar_connections cc
        on cc.agent_id = i.agent_id and cc.status = 'active'
     where i.google_sync_state = 'pending'
        or (i.google_sync_state = 'syncing' and i.updated_at < now() - interval '5 minutes')
  )
  or exists (select 1 from public.google_calendar_closed_agents());
$$;

revoke all on function public.google_calendar_sync_ready() from public, anon, authenticated;
grant execute on function public.google_calendar_sync_ready() to service_role;

create or replace function public.google_calendar_sync_claim(p_limit int default 50)
returns table (
  item_id         uuid,
  agent_id        uuid,
  calendar_id     text,
  kind            text,
  title           text,
  notes           text,
  location        text,
  due_at          timestamptz,
  ends_at         timestamptz,
  status          text,
  client_name     text,
  client_phone    text,
  google_event_id text,
  include         boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with picked as (
    select i.id
      from public.agent_agenda_items i
      join public.agent_calendar_connections cc
        on cc.agent_id = i.agent_id and cc.status = 'active'
     where (i.google_sync_state = 'pending'
            or (i.google_sync_state = 'syncing' and i.updated_at < now() - interval '5 minutes'))
       and public.agent_agenda_enabled(i.agent_id)
     order by i.updated_at
     limit least(greatest(coalesce(p_limit, 50), 1), 200)
     for update of i skip locked
  ),
  marked as (
    update public.agent_agenda_items i
       set google_sync_state = 'syncing'
      from picked
     where i.id = picked.id
    returning i.*
  )
  select m.id, m.agent_id, cc.calendar_id, m.kind, m.title, m.notes, m.location,
         m.due_at, m.ends_at, m.status, c.full_name, c.phone, m.google_event_id,
         -- האם האירוע אמור להתקיים ב-Google. ‏false = למחוק אם יש.
         (m.status <> 'canceled' and m.due_at is not null
          and public.agent_agenda_google_kind(m.kind))
    from marked m
    join public.agent_calendar_connections cc on cc.agent_id = m.agent_id
    left join public.agent_clients c on c.id = m.client_id;
end;
$$;

comment on function public.google_calendar_sync_claim(int) is
  'לוקחת פריטים שממתינים לסנכרון מול Google ומסמנת אותם syncing. הפונקציה google-calendar-sync כותבת את התוצאה רק אם הפריט עדיין syncing - שינוי באמצע מחזיר אותו ל-pending ולא נדרס.';

revoke all on function public.google_calendar_sync_claim(int) from public, anon, authenticated;
grant execute on function public.google_calendar_sync_claim(int) to service_role;

-- ---------------------------------------------------------------------------
-- 7. התזמון - כל דקה, רק כשיש מה לסנכרן
-- ---------------------------------------------------------------------------
do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/google-calendar-sync';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - סנכרון היומן לא תוזמן';
    return;
  end if;

  perform cron.unschedule('google-calendar-sync')
    where exists (select 1 from cron.job where jobname = 'google-calendar-sync');
  perform cron.schedule('google-calendar-sync', '* * * * *', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1))),
      timeout_milliseconds := 30000
    )
    where public.google_calendar_sync_ready();
  $cron$, v_url));
end;
$$;
