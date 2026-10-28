-- חלון שליחה אחד ללקוחות ולסוכנים, תקרת 3 הודעות לטלפון ביום,
-- ודחיה ליום הבא. תקציר הוואטסאפ נשאר כבוי עד שגבריאלה נותנת את הנוסח
-- ומטא מאשרת תבנית. אין כאן טקסט ללקוח/ה.

insert into public.pricing_config (key, value, description) values
  ('customer_send_window_enabled', 0,
   '1: חלון לקוחות, תקרה 3, דחיה ל-72 שעות ופיזור 08:00-09:00. 0: כמו היום, שקט 22:00-08:00.'),
  ('customer_digest_enabled', 0,
   '1: תקציר להודעות שנוצרו אחרי ההדלקה, בלי מילוי אחורה ובלי נוסח. 0: אין תקציר, והשחרור הוא הודעה בודדת.'),
  ('agent_holiday_window_enabled', 0,
   '1: חג וערב חג סוגרים סוכנים, והבוקר מתפזר על 08:00-09:00. 0: חלון שישי כמו 20271029235000, בלי חגים.')
on conflict (key) do nothing;

create table if not exists public.il_holidays (
  holiday_date date primary key,
  kind text not null,
  name text not null,
  constraint il_holidays_kind_chk check (kind in ('eve', 'holiday'))
);

comment on table public.il_holidays is
  'חגי ישראל 2026-2028. eve = ערב חג (08:00-13:00). holiday = חג או יום כיפור (סגור). רק service_role.';

alter table public.il_holidays enable row level security;
revoke all on table public.il_holidays from public, anon, authenticated;
grant select, insert, update, delete on table public.il_holidays to service_role;

insert into public.il_holidays (holiday_date, kind, name) values
  ('2026-04-01', 'eve', 'ערב פסח'),
  ('2026-04-02', 'holiday', 'פסח א'),
  ('2026-04-07', 'eve', 'ערב שביעי של פסח'),
  ('2026-04-08', 'holiday', 'שביעי של פסח'),
  ('2026-05-21', 'eve', 'ערב שבועות'),
  ('2026-05-22', 'holiday', 'שבועות'),
  ('2026-09-11', 'eve', 'ערב ראש השנה'),
  ('2026-09-12', 'holiday', 'ראש השנה א'),
  ('2026-09-13', 'holiday', 'ראש השנה ב'),
  ('2026-09-20', 'eve', 'ערב יום כיפור'),
  ('2026-09-21', 'holiday', 'יום כיפור'),
  ('2026-09-25', 'eve', 'ערב סוכות'),
  ('2026-09-26', 'holiday', 'סוכות'),
  ('2026-10-02', 'eve', 'ערב שמיני עצרת'),
  ('2026-10-03', 'holiday', 'שמיני עצרת'),
  ('2027-04-21', 'eve', 'ערב פסח'),
  ('2027-04-22', 'holiday', 'פסח א'),
  ('2027-04-27', 'eve', 'ערב שביעי של פסח'),
  ('2027-04-28', 'holiday', 'שביעי של פסח'),
  ('2027-06-10', 'eve', 'ערב שבועות'),
  ('2027-06-11', 'holiday', 'שבועות'),
  ('2027-10-01', 'eve', 'ערב ראש השנה'),
  ('2027-10-02', 'holiday', 'ראש השנה א'),
  ('2027-10-03', 'holiday', 'ראש השנה ב'),
  ('2027-10-10', 'eve', 'ערב יום כיפור'),
  ('2027-10-11', 'holiday', 'יום כיפור'),
  ('2027-10-15', 'eve', 'ערב סוכות'),
  ('2027-10-16', 'holiday', 'סוכות'),
  ('2027-10-22', 'eve', 'ערב שמיני עצרת'),
  ('2027-10-23', 'holiday', 'שמיני עצרת'),
  ('2028-04-10', 'eve', 'ערב פסח'),
  ('2028-04-11', 'holiday', 'פסח א'),
  ('2028-04-16', 'eve', 'ערב שביעי של פסח'),
  ('2028-04-17', 'holiday', 'שביעי של פסח'),
  ('2028-05-30', 'eve', 'ערב שבועות'),
  ('2028-05-31', 'holiday', 'שבועות'),
  ('2028-09-20', 'eve', 'ערב ראש השנה'),
  ('2028-09-21', 'holiday', 'ראש השנה א'),
  ('2028-09-22', 'holiday', 'ראש השנה ב'),
  ('2028-09-29', 'eve', 'ערב יום כיפור'),
  ('2028-09-30', 'holiday', 'יום כיפור'),
  ('2028-10-04', 'eve', 'ערב סוכות'),
  ('2028-10-05', 'holiday', 'סוכות'),
  ('2028-10-11', 'eve', 'ערב שמיני עצרת'),
  ('2028-10-12', 'holiday', 'שמיני עצרת')
on conflict (holiday_date) do nothing;

-- חלון אחד. קהל לא מוכר סגור. שבת, חג ויום כיפור סגורים.
-- ערב חג ושישי: 08:00-13:00. ראשון-חמישי: 08:00-21:00. שעון ישראל.
create or replace function public.send_window_open(p_audience text, p_at timestamptz)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_at timestamptz := coalesce(p_at, pg_catalog.now());
  v_local timestamp;
  v_day date;
  v_dow int;
  v_h int;
  v_kind text;
begin
  if p_audience not in ('agent', 'saved_search', 'open_house', 'customer_push') then
    return false;
  end if;
  v_local := v_at at time zone 'Asia/Jerusalem';
  v_day := v_local::date;
  v_dow := extract(dow from v_local)::int;
  v_h := extract(hour from v_local)::int;
  select h.kind into v_kind
    from public.il_holidays h
   where h.holiday_date = v_day;
  if v_kind = 'holiday' or v_dow = 6 then
    return false;
  end if;
  if v_kind = 'eve' or v_dow = 5 then
    return v_h >= 8 and v_h < 13;
  end if;
  return v_h >= 8 and v_h < 21;
end;
$$;

comment on function public.send_window_open(text, timestamptz) is
  'חלון שליחה אחיד, שעון ישראל. ראשון-חמישי 08:00-21:00, שישי וערב חג 08:00-13:00, שבת וחג ויום כיפור סגורים.';

revoke all on function public.send_window_open(text, timestamptz) from public, anon, authenticated;
grant execute on function public.send_window_open(text, timestamptz) to service_role;


-- חגים לסוכנים רק כשהדגל דלוק. כבוי: אותו חלון שישי של #1049, בלי לוח חגים.
create or replace function public.notification_send_window_open(p_at timestamptz)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_at timestamptz := coalesce(p_at, pg_catalog.now());
  v_local timestamp;
  v_dow int;
  v_h int;
begin
  if coalesce((select value::int from public.pricing_config
                where key = 'agent_holiday_window_enabled'), 0) = 1 then
    return public.send_window_open('agent', v_at);
  end if;
  v_local := v_at at time zone 'Asia/Jerusalem';
  v_dow := extract(dow from v_local)::int;
  v_h := extract(hour from v_local)::int;
  if v_dow = 6 then
    return false;
  end if;
  if v_dow = 5 then
    return v_h >= 8 and v_h < 13;
  end if;
  return v_h >= 8 and v_h < 21;
end;
$$;

comment on function public.notification_send_window_open(timestamptz) is
  'חלון הסוכנים. דגל agent_holiday_window_enabled כבוי: שישי 08:00-13:00 בלי חגים. דלוק: send_window_open לקהל agent.';

revoke all on function public.notification_send_window_open(timestamptz) from public, anon, authenticated;
grant execute on function public.notification_send_window_open(timestamptz) to service_role;

-- חג נסגר כאן לפי agent_holiday_window_enabled לבד.
-- notif_send_window_friday_enabled לא קובע אם יום כיפור שקט.
create or replace function public.notification_agent_send_quiet(
  p_from int,
  p_to int,
  p_days smallint[],
  p_at timestamptz,
  p_window_on int
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when coalesce((select value::int from public.pricing_config
                           where key = 'agent_holiday_window_enabled'), 0) = 1
            and exists (
              select 1 from public.il_holidays h
               where h.holiday_date = (p_at at time zone 'Asia/Jerusalem')::date
                 and (
                   h.kind = 'holiday'
                   or (
                     h.kind = 'eve'
                     and extract(hour from (p_at at time zone 'Asia/Jerusalem'))::int >= 13
                   )
                 )
            )
           then true
           when coalesce(p_window_on, 0) = 1 then
             not public.notification_send_window_open(p_at)
             or public.agent_reminder_quiet_at(
                  p_at, p_from, p_to,
                  case
                    when coalesce(p_days, '{5,6}'::smallint[]) = '{5,6}'::smallint[]
                      then '{6}'::smallint[]
                    else coalesce(p_days, '{5,6}'::smallint[])
                  end)
           else
             public.agent_reminder_quiet_at(
               p_at, p_from, p_to, coalesce(p_days, '{5,6}'::smallint[]))
         end;
$$;

comment on function public.notification_agent_send_quiet(int, int, smallint[], timestamptz, int) is
  'חג סגור כש-agent_holiday_window_enabled דלוק, גם אם דגל שישי כבוי. דגל שישי רק פותח את שישי 08:00-13:00.';

revoke all on function public.notification_agent_send_quiet(int, int, smallint[], timestamptz, int) from public, anon, authenticated;
grant execute on function public.notification_agent_send_quiet(int, int, smallint[], timestamptz, int) to service_role;

create or replace function public.customer_send_window_on()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select value::int from public.pricing_config
                    where key = 'customer_send_window_enabled'), 0) = 1;
$$;

revoke all on function public.customer_send_window_on() from public, anon, authenticated;
grant execute on function public.customer_send_window_on() to service_role;

create or replace function public.saved_search_quiet_now()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with cfg as (
    select
      coalesce((select value::int from public.pricing_config where key = 'saved_search_quiet_from_hour'), 22) as from_h,
      coalesce((select value::int from public.pricing_config where key = 'saved_search_quiet_to_hour'), 8) as to_h
  ),
  now_h as (
    select extract(hour from (pg_catalog.now() at time zone 'Asia/Jerusalem'))::int as h
  )
  select case
           when public.customer_send_window_on()
             then not public.send_window_open('saved_search', pg_catalog.now())
           when cfg.from_h = cfg.to_h then false
           when cfg.from_h < cfg.to_h then now_h.h >= cfg.from_h and now_h.h < cfg.to_h
           else now_h.h >= cfg.from_h or now_h.h < cfg.to_h
         end
    from cfg, now_h;
$$;

comment on function public.saved_search_quiet_now() is
  'דגל הלקוחות כבוי: שקט 22:00-08:00 כמו קודם. דלוק: החלון האחיד, כולל שבת וחג.';

revoke all on function public.saved_search_quiet_now() from public, anon, authenticated;
grant execute on function public.saved_search_quiet_now() to service_role;

-- דקה 0..59 בתוך 08:00-09:00. אותו מפתח תמיד באותה דקה.
create or replace function public.customer_spread_minute(p_key text)
returns int
language sql
immutable
as $$
  select abs(hashtext(coalesce(p_key, ''))) % 60;
$$;

revoke all on function public.customer_spread_minute(text) from public, anon, authenticated;
grant execute on function public.customer_spread_minute(text) to service_role;

drop function if exists public.customer_contact_key(text, text);

create or replace function public.customer_contact_key(
  p_phone text,
  p_email text,
  p_search_id uuid default null
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    nullif(btrim(coalesce(p_phone, '')), ''),
    (select s.phone_e164
       from public.saved_searches s
      where p_email is not null
        and lower(s.email) = lower(btrim(p_email))
        and s.phone_e164 is not null
      order by s.created_at, s.id
      limit 1),
    case when nullif(btrim(coalesce(p_email, '')), '') is not null
         then 'e:' || lower(btrim(p_email)) end,
    case when p_search_id is not null then 's:' || p_search_id::text end
  );
$$;

revoke all on function public.customer_contact_key(text, text, uuid) from public, anon, authenticated;
grant execute on function public.customer_contact_key(text, text, uuid) to service_role;

create or replace function public.customer_next_open_day(p_audience text, p_at timestamptz)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_at timestamptz := coalesce(p_at, pg_catalog.now());
  v_local timestamp := v_at at time zone 'Asia/Jerusalem';
  v_day date := v_local::date;
  i int;
  v_probe timestamptz;
begin
  if extract(hour from v_local) < 8 then
    v_probe := (v_day::timestamp + time '10:00') at time zone 'Asia/Jerusalem';
    if public.send_window_open(p_audience, v_probe) then
      return v_day;
    end if;
  end if;
  for i in 1..14 loop
    v_probe := ((v_day + i)::timestamp + time '10:00') at time zone 'Asia/Jerusalem';
    if public.send_window_open(p_audience, v_probe) then
      return v_day + i;
    end if;
  end loop;
  return v_day + 1;
end;
$$;

revoke all on function public.customer_next_open_day(text, timestamptz) from public, anon, authenticated;
grant execute on function public.customer_next_open_day(text, timestamptz) to service_role;

-- סוכן/ת שמחכה לתור שלה בתוך 08:00-09:00. אחרי 09:00 כולם פתוחים.
create or replace function public.agent_backlog_waiting(p_agent uuid, p_at timestamptz)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_local timestamp := coalesce(p_at, pg_catalog.now()) at time zone 'Asia/Jerusalem';
  v_min int;
begin
  v_min := (extract(hour from v_local)::int * 60 + extract(minute from v_local)::int) - 8 * 60;
  if v_min < 0 or v_min >= 60 then
    return false;
  end if;
  return v_min < public.customer_spread_minute(p_agent::text);
end;
$$;

revoke all on function public.agent_backlog_waiting(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.agent_backlog_waiting(uuid, timestamptz) to service_role;

create table if not exists public.customer_phone_day (
  contact_key text not null,
  day date not null,
  sent_count int not null default 0,
  last_sent_at timestamptz,
  primary key (contact_key, day)
);

comment on table public.customer_phone_day is
  'מונה הודעות לאדם ביום לוח של ישראל. תקרה 3, ומרווח של 20 דקות. רק service_role.';

alter table public.customer_phone_day enable row level security;
revoke all on table public.customer_phone_day from public, anon, authenticated;
grant select, insert, update, delete on table public.customer_phone_day to service_role;

create table if not exists public.customer_phone_sends (
  ref_id uuid not null,
  contact_key text not null,
  day date not null,
  push_sent_at timestamptz,
  primary key (ref_id, day)
);

alter table public.customer_phone_sends
  add column if not exists push_sent_at timestamptz;

comment on table public.customer_phone_sends is
  'תפיסה אחת להתראה או למשלוח, לא לערוץ. כשל משחרר את השורה. רק service_role.';

alter table public.customer_phone_sends enable row level security;
revoke all on table public.customer_phone_sends from public, anon, authenticated;
grant select, insert, update, delete on table public.customer_phone_sends to service_role;

-- ok = נתפס מקום. wait = עוד לא התור או לא עברו 20 דקות. cap = עבר ליום הבא. skip = אין מפתח.
create or replace function public.customer_phone_claim(
  p_key text,
  p_at timestamptz default pg_catalog.now(),
  p_ref uuid default null,
  p_backlog boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := nullif(btrim(coalesce(p_key, '')), '');
  v_at timestamptz := coalesce(p_at, pg_catalog.now());
  v_day date;
  v_n int;
  v_last timestamptz;
  v_local timestamp;
  v_min int;
  v_slot int;
begin
  if v_key is null then
    return 'skip';
  end if;
  v_day := (v_at at time zone 'Asia/Jerusalem')::date;
  insert into public.customer_phone_day (contact_key, day, sent_count)
  values (v_key, v_day, 0)
  on conflict (contact_key, day) do nothing;

  select sent_count, last_sent_at into v_n, v_last
    from public.customer_phone_day
   where contact_key = v_key
     and day = v_day
   for update;

  if p_ref is not null and exists (
    select 1 from public.customer_phone_sends s
     where s.ref_id = p_ref and s.day = v_day
  ) then
    return 'already';
  end if;
  if coalesce(v_n, 0) >= 3 then
    return 'cap';
  end if;
  if v_last is not null and v_at < v_last + interval '20 minutes' then
    return 'wait';
  end if;

  -- פיזור רק לשחרור של מה שכבר נדחה, ורק עד 09:00.
  -- מי שהתור שלו עבר משתחרר בריצה הבאה, כולל דקה 59 ב-09:00.
  -- הודעה חדשה בתוך החלון לא מחכה לדקה ולא לדלי של 15 דקות.
  if p_backlog and coalesce(v_n, 0) = 0 and v_last is null then
    v_local := v_at at time zone 'Asia/Jerusalem';
    v_min := (extract(hour from v_local)::int * 60 + extract(minute from v_local)::int) - 8 * 60;
    v_slot := public.customer_spread_minute(v_key);
    if v_min < 60 and v_min < v_slot then
      return 'wait';
    end if;
  end if;

  if p_ref is not null then
    insert into public.customer_phone_sends (ref_id, contact_key, day)
    values (p_ref, v_key, v_day)
    on conflict (ref_id, day) do nothing;
  end if;
  update public.customer_phone_day
     set sent_count = sent_count + 1,
         last_sent_at = v_at
   where contact_key = v_key
     and day = v_day;
  return 'ok';
end;
$$;

comment on function public.customer_phone_claim(text, timestamptz, uuid, boolean) is
  'תופסת מקום אחד לאדם ביום. אותה התראה לא נספרת פעמיים. כשל לא נספר: customer_phone_release. תקרה 3, מרווח 20 דקות, פיזור 08:00-09:00.';

revoke all on function public.customer_phone_claim(text, timestamptz, uuid, boolean) from public, anon, authenticated;
grant execute on function public.customer_phone_claim(text, timestamptz, uuid, boolean) to service_role;

create or replace function public.customer_phone_release(p_key text, p_ref uuid, p_at timestamptz default pg_catalog.now())
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := nullif(btrim(coalesce(p_key, '')), '');
  v_day date := (coalesce(p_at, pg_catalog.now()) at time zone 'Asia/Jerusalem')::date;
  v_hit int;
begin
  if v_key is null or p_ref is null then
    return;
  end if;
  delete from public.customer_phone_sends
   where ref_id = p_ref and day = v_day and contact_key = v_key
     and push_sent_at is null;
  get diagnostics v_hit = row_count;
  if v_hit = 0 then
    return;
  end if;
  update public.customer_phone_day d
     set sent_count = greatest(0, d.sent_count - 1),
         last_sent_at = case
           when d.sent_count - 1 <= 0 then null
           else d.last_sent_at
         end
   where d.contact_key = v_key
     and d.day = v_day;
end;
$$;

comment on function public.customer_phone_release(text, uuid, timestamptz) is
  'משחררת תפיסה של משלוח שנכשל, כדי שלא ייספר בתקרה.';

revoke all on function public.customer_phone_release(text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.customer_phone_release(text, uuid, timestamptz) to service_role;

create table if not exists public.customer_message_holds (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text,
  audience text not null,
  alert_id uuid,
  reason text not null,
  deliver_on date not null,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  constraint customer_message_holds_audience_chk
    check (audience in ('saved_search', 'open_house', 'customer_push')),
  constraint customer_message_holds_reason_chk
    check (reason in ('quiet', 'cap'))
);

comment on table public.customer_message_holds is
  'הודעה שנדחתה. delivered_at נרשם כשהתקציר נלקח, כדי שלא יישלח פעמיים. אין גוף הודעה. רק service_role.';

create unique index if not exists customer_message_holds_alert_uidx
  on public.customer_message_holds (alert_id, audience)
  where alert_id is not null;

create index if not exists customer_message_holds_group_idx
  on public.customer_message_holds (phone_e164, deliver_on)
  where delivered_at is null;

alter table public.customer_message_holds enable row level security;
revoke all on table public.customer_message_holds from public, anon, authenticated;
grant select, insert, update, delete on table public.customer_message_holds to service_role;

create table if not exists public.customer_digest_state (
  id int primary key,
  enabled_at timestamptz not null
);

comment on table public.customer_digest_state is
  'הרגע שבו customer_digest_enabled עבר ל-1. תקציר לא כולל מה שקדם לו.';

alter table public.customer_digest_state enable row level security;
revoke all on table public.customer_digest_state from public, anon, authenticated;
grant select, insert, update, delete on table public.customer_digest_state to service_role;

create or replace function public.customer_digest_flag_touch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.key = 'customer_digest_enabled' and new.value = 1
     and (tg_op = 'INSERT' or old.value is distinct from 1) then
    insert into public.customer_digest_state (id, enabled_at)
    values (1, pg_catalog.now())
    on conflict (id) do update set enabled_at = excluded.enabled_at;
  end if;
  return new;
end;
$$;

revoke all on function public.customer_digest_flag_touch() from public, anon, authenticated;

drop trigger if exists customer_digest_flag_touch on public.pricing_config;
create trigger customer_digest_flag_touch
  after insert or update of value on public.pricing_config
  for each row execute function public.customer_digest_flag_touch();

do $$
declare
  r record;
begin
  for r in
    select c.conname
      from pg_constraint c
      join pg_attribute a
        on a.attrelid = c.conrelid
       and a.attnum = any (c.conkey)
     where c.conrelid = 'public.saved_search_alerts'::regclass
       and c.contype = 'c'
       and a.attname = 'status'
       and cardinality(c.conkey) = 1
  loop
    execute format('alter table public.saved_search_alerts drop constraint %I', r.conname);
  end loop;
  alter table public.saved_search_alerts
    add constraint saved_search_alerts_status_check
    check (status in ('pending', 'sent', 'failed', 'skipped', 'deferred', 'expired', 'digested'));
end $$;

create or replace function public.customer_message_defer(
  p_alert_id uuid,
  p_reason text,
  p_at timestamptz default pg_catalog.now()
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text;
  v_day date;
  v_id uuid;
begin
  if p_reason not in ('quiet', 'cap') or p_alert_id is null then
    return;
  end if;
  v_day := public.customer_next_open_day('saved_search', coalesce(p_at, pg_catalog.now()));
  select s.phone_e164 into v_phone
    from public.saved_search_alerts a
    join public.saved_searches s on s.id = a.search_id
   where a.id = p_alert_id;

  update public.saved_search_alerts
     set status = 'deferred',
         last_error = p_reason
   where id = p_alert_id
     and status in ('pending', 'deferred')
  returning id into v_id;
  if v_id is null then
    return;
  end if;

  insert into public.customer_message_holds (phone_e164, audience, alert_id, reason, deliver_on)
  values (v_phone, 'saved_search', p_alert_id, p_reason, v_day)
  on conflict (alert_id, audience) where alert_id is not null do update
    set reason = excluded.reason,
        deliver_on = excluded.deliver_on,
        phone_e164 = excluded.phone_e164
  where public.customer_message_holds.delivered_at is null;
end;
$$;

comment on function public.customer_message_defer(uuid, text, timestamptz) is
  'מסמנת התראה כדחויה רק אם השורה עוד ממתינה. אין שורת המתנה בלי עדכון.';

revoke all on function public.customer_message_defer(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.customer_message_defer(uuid, text, timestamptz) to service_role;

-- תוקף, התאמה מחדש, מיזוג, ואז שחרור לפי הפיזור והתקרה.
create or replace function public.customer_prepare(p_at timestamptz default pg_catalog.now())
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz := coalesce(p_at, pg_catalog.now());
  v_open boolean;
  r record;
  v_key text;
  v_gate text;
  v_seen text[] := '{}';
  v_n int := 0;
begin
  if not public.customer_send_window_on() then
    update public.saved_search_alerts
       set status = 'expired',
           last_error = 'expired'
     where status = 'deferred'
       and created_at < v_at - interval '72 hours';
    update public.saved_search_alerts
       set status = 'pending',
           last_error = null
     where status = 'deferred'
       and created_at >= v_at - interval '72 hours';
    return 0;
  end if;

  update public.saved_search_alerts
     set status = 'expired',
         last_error = 'expired'
   where status in ('pending', 'deferred')
     and created_at < v_at - interval '72 hours';

  update public.saved_search_alerts a
     set status = 'skipped',
         last_error = case when p.status is distinct from 'active' then 'inactive' else 'no_match' end
    from public.saved_searches s, public.properties p
   where a.search_id = s.id
     and a.property_id = p.id
     and a.status in ('pending', 'deferred')
     and (
       p.status is distinct from 'active'
       or not public.saved_search_matches(s, p)
     );

  with ranked as (
    select a.id,
           row_number() over (
             partition by public.customer_contact_key(s.phone_e164, s.email, s.id), a.property_id
             order by a.created_at desc, a.id desc
           ) as rn
      from public.saved_search_alerts a
      join public.saved_searches s on s.id = a.search_id
     where a.status in ('pending', 'deferred')
  )
  update public.saved_search_alerts a
     set status = 'skipped',
         last_error = 'merged'
    from ranked
   where a.id = ranked.id
     and ranked.rn > 1;

  v_open := public.send_window_open('saved_search', v_at);
  if not v_open then
    for r in
      select a.id from public.saved_search_alerts a where a.status = 'pending'
    loop
      perform public.customer_message_defer(r.id, 'quiet', v_at);
      v_n := v_n + 1;
    end loop;
    return v_n;
  end if;

  for r in
    select a.id, a.created_at, s.phone_e164, s.email, s.id as search_id
      from public.saved_search_alerts a
      join public.saved_searches s on s.id = a.search_id
     where a.status = 'deferred'
       and a.created_at >= v_at - interval '72 hours'
     order by a.created_at desc, a.id desc
  loop
    v_key := public.customer_contact_key(r.phone_e164, r.email, r.search_id);
    if v_key is null or v_key = any(v_seen) then
      continue;
    end if;
    v_gate := public.customer_phone_claim(v_key, v_at, r.id, true);
    if v_gate = 'ok' then
      update public.saved_search_alerts
         set status = 'pending', last_error = null
       where id = r.id and status = 'deferred';
      v_seen := v_seen || v_key;
      v_n := v_n + 1;
    elsif v_gate = 'cap' then
      perform public.customer_message_defer(r.id, 'cap', v_at);
      v_seen := v_seen || v_key;
    end if;
  end loop;
  return v_n;
end;
$$;

comment on function public.customer_prepare(timestamptz) is
  'פג תוקף אחרי 72 שעות, דילוג על נכס לא פעיל או לא תואם, מיזוג אותו נכס ואותו טלפון, ושחרור מפוזר 08:00-09:00. הדגל כבוי: לא נוגעת.';

revoke all on function public.customer_prepare(timestamptz) from public, anon, authenticated;
grant execute on function public.customer_prepare(timestamptz) to service_role;

create or replace function public.customer_due_alerts(p_limit int default 50)
returns table (
  alert_id uuid,
  search_id uuid,
  full_name text,
  phone_e164 text,
  email text,
  contact_channel text,
  label text,
  unsubscribe_token text,
  click_token text,
  property_id uuid,
  title text,
  price numeric,
  rooms numeric,
  size_sqm numeric,
  floor int,
  city text,
  neighborhood text,
  street text,
  property_type text,
  deal_type text,
  image_url text,
  whatsapp_status text,
  email_status text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.customer_prepare(pg_catalog.now());
  return query
    select a.id, s.id, s.full_name, s.phone_e164, s.email, s.contact_channel,
           s.label, s.unsubscribe_token, a.click_token,
           p.id, p.title, p.price, p.rooms::numeric,
           coalesce(p.size_sqm, p.area_sqm)::numeric, p.floor::int,
           p.city, n.name, p.street, p.property_type, p.deal_type,
           (case when array_length(p.images, 1) > 0 then p.images[1] else null end),
           a.whatsapp_status, a.email_status
      from public.saved_search_alerts a
      join public.saved_searches s on s.id = a.search_id
      join public.properties p on p.id = a.property_id
      left join public.neighborhoods n on n.id = p.neighborhood_id
     where a.status = 'pending'
       and s.status = 'active'
       and p.status = 'active'
     order by a.created_at desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

comment on function public.customer_due_alerts(int) is
  'ההתראות ששוחררו עכשיו, עם נתוני הנכס כפי שהם עכשיו. החדשות קודם.';

revoke all on function public.customer_due_alerts(int) from public, anon, authenticated;
grant execute on function public.customer_due_alerts(int) to service_role;

create or replace function public.customer_window_hold(p_audience text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- אין שורת המתנה בלי התראה. החלון הסגור פשוט לא שולח.
  return;
end;
$$;

revoke all on function public.customer_window_hold(text, text) from public, anon, authenticated;
grant execute on function public.customer_window_hold(text, text) to service_role;

create or replace function public.customer_digest_groups(p_at timestamptz default pg_catalog.now())
returns table (phone_e164 text, deliver_on date, held int, alert_ids uuid[])
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_at timestamptz := coalesce(p_at, pg_catalog.now());
  v_from timestamptz;
begin
  if coalesce((select value::int from public.pricing_config
                where key = 'customer_digest_enabled'), 0) <> 1 then
    return;
  end if;
  if not public.send_window_open('saved_search', v_at) then
    return;
  end if;
  select s.enabled_at into v_from from public.customer_digest_state s where s.id = 1;
  if v_from is null then
    return;
  end if;
  return query
    select h.phone_e164,
           min(h.deliver_on) as deliver_on,
           count(*)::int as held,
           array_agg(h.alert_id) as alert_ids
      from public.customer_message_holds h
      join public.saved_search_alerts a on a.id = h.alert_id
      join public.saved_searches s on s.id = a.search_id
      join public.properties p on p.id = a.property_id
     where h.audience = 'saved_search'
       and h.delivered_at is null
       and h.phone_e164 is not null
       and h.alert_id is not null
       and a.created_at >= v_from
       and a.created_at >= v_at - interval '72 hours'
       and a.status = 'deferred'
       and p.status = 'active'
       and public.saved_search_matches(s, p)
       and public.customer_spread_minute(h.phone_e164)
           <= ((extract(hour from (v_at at time zone 'Asia/Jerusalem'))::int * 60
                + extract(minute from (v_at at time zone 'Asia/Jerusalem'))::int) - 8 * 60)
       and (extract(hour from (v_at at time zone 'Asia/Jerusalem'))::int * 60
            + extract(minute from (v_at at time zone 'Asia/Jerusalem'))::int) between 8 * 60 and 9 * 60
     group by h.phone_e164;
end;
$$;

comment on function public.customer_digest_groups(timestamptz) is
  'תצוגת תקציר בלי לסמן מסירה. רק מה שנוצר אחרי ההדלקה, עדיין בתוקף, ובפיזור 08:00-09:00. אין נוסח.';

revoke all on function public.customer_digest_groups(timestamptz) from public, anon, authenticated;
grant execute on function public.customer_digest_groups(timestamptz) to service_role;

-- סימון מסירה לפי התראה, בנעילה, כדי שקריאה שנייה לא תחזור על אותן שורות.
create or replace function public.customer_digest_take(p_at timestamptz default pg_catalog.now())
returns table (phone_e164 text, deliver_on date, held int, alert_ids uuid[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz := coalesce(p_at, pg_catalog.now());
begin
  return query
    with due as (
      select g.phone_e164, g.deliver_on, g.held, g.alert_ids
        from public.customer_digest_groups(v_at) g
    ),
    marked as (
      update public.customer_message_holds h
         set delivered_at = v_at
        from due d
       where h.alert_id = any(d.alert_ids)
         and h.delivered_at is null
      returning h.alert_id
    ),
    digested as (
      update public.saved_search_alerts a
         set status = 'digested',
             last_error = 'digest'
        from marked m
       where a.id = m.alert_id
         and a.status in ('pending', 'deferred')
      returning a.id
    )
    select d.phone_e164, d.deliver_on, d.held, d.alert_ids
      from due d
     where exists (select 1 from digested g where g.id = any(d.alert_ids));
end;
$$;

comment on function public.customer_digest_take(timestamptz) is
  'לוקחת קבוצות תקציר ומסמנת delivered_at. הנוסח לא כאן. גבריאלה שולחת אחרי אישור תומר.';

revoke all on function public.customer_digest_take(timestamptz) from public, anon, authenticated;
grant execute on function public.customer_digest_take(timestamptz) to service_role;

drop function if exists public.customer_send_saved_search_push(uuid);

create or replace function public.customer_send_saved_search_push(p_alert_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_dev uuid;
  v_search uuid;
  v_property uuid;
  v_n int := 0;
begin
  select a.search_id, a.property_id into v_search, v_property
    from public.saved_search_alerts a
   where a.id = p_alert_id;
  if v_search is null then
    return 0;
  end if;
  select coalesce(nullif(btrim(p.title), ''), 'נכס חדש') into v_title
    from public.properties p
   where p.id = v_property;
  for v_dev in
    select d.id from public.app_push_devices d
     where d.saved_search_id = v_search and d.disabled_at is null
  loop
    perform public.app_push_enqueue(
      v_dev, coalesce(v_title, 'נכס חדש'),
      'נכס חדש שמתאים לחיפוש ששמרתם',
      'https://shuknadlan.co.il/property?id=' || v_property::text,
      'saved_search', p_alert_id
    );
    v_n := v_n + 1;
  end loop;
  if v_n > 0 then
    update public.customer_phone_sends
       set push_sent_at = pg_catalog.now()
     where ref_id = p_alert_id
       and day = (pg_catalog.now() at time zone 'Asia/Jerusalem')::date
       and push_sent_at is null;
  end if;
  return v_n;
end;
$$;

revoke all on function public.customer_send_saved_search_push(uuid) from public, anon, authenticated;
grant execute on function public.customer_send_saved_search_push(uuid) to service_role;

create or replace function public.app_push_on_saved_search_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_dev uuid;
  v_key text;
  v_gate text;
begin
  if tg_op = 'UPDATE' and old.status = 'pending' then
    return new;
  end if;
  if new.status is distinct from 'pending' then
    return new;
  end if;
  if not public.customer_send_window_on() then
    select coalesce(nullif(btrim(p.title), ''), 'נכס חדש') into v_title
      from public.properties p
     where p.id = new.property_id;
    for v_dev in
      select d.id from public.app_push_devices d
       where d.saved_search_id = new.search_id and d.disabled_at is null
    loop
      perform public.app_push_enqueue(
        v_dev, coalesce(v_title, 'נכס חדש'),
        'נכס חדש שמתאים לחיפוש ששמרתם',
        'https://shuknadlan.co.il/property?id=' || new.property_id::text,
        'saved_search', new.id
      );
    end loop;
    return new;
  end if;

  if not public.send_window_open('customer_push', pg_catalog.now()) then
    perform public.customer_message_defer(new.id, 'quiet');
    return new;
  end if;

  select public.customer_contact_key(s.phone_e164, s.email, s.id) into v_key
    from public.saved_searches s
   where s.id = new.search_id;
  if v_key is not null and exists (
    select 1 from public.app_push_devices d
     where d.saved_search_id = new.search_id and d.disabled_at is null
  ) then
    v_gate := public.customer_phone_claim(v_key, pg_catalog.now(), new.id, tg_op = 'UPDATE');
    if v_gate in ('ok', 'already') then
      perform public.customer_send_saved_search_push(new.id);
    end if;
    return new;
  end if;

  perform public.customer_send_saved_search_push(new.id);
  return new;
exception when others then
  raise warning 'app_push_on_saved_search_alert: %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.app_push_on_saved_search_alert() from public, anon, authenticated;

drop trigger if exists app_push_on_saved_search_alert on public.saved_search_alerts;
create trigger app_push_on_saved_search_alert
  after insert or update of status on public.saved_search_alerts
  for each row execute function public.app_push_on_saved_search_alert();

-- הגוף האחרון של due_agents, ועוד רק פיזור הבוקר כשהדגל דלוק.
-- תקרת התבניות נשארת בתוך הגוף (המרווח, התקרה היומית). לא נבנה מגרסה ישנה.
create or replace function public.notification_push_due_agents()
returns table (agent_id uuid, display_name text, phone_e164 text,
               whatsapp_types text[], in_service_window boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with cfg0 as (
    select coalesce((select value::int from public.pricing_config
                      where key = 'notif_push_gap_minutes'), 10)      as gap_min,
           coalesce((select value::int from public.pricing_config
                      where key = 'notif_push_max_per_day'), 12)      as cap,
           coalesce((select value::int from public.pricing_config
                      where key = 'notif_push_max_failures_24h'), 3)  as max_fail,
           coalesce((select value::int from public.pricing_config
                      where key = 'notif_push_template_gap_minutes'), 240) as tpl_gap,
           coalesce((select value::int from public.pricing_config
                      where key = 'notif_digest_enabled'), 0)         as digest_on,
           coalesce((select value::int from public.pricing_config
                      where key = 'notif_digest_daily_cap'), 4)       as digest_cap,
           coalesce((select value::int from public.pricing_config
                      where key = 'notif_digest_window_minutes'), 15) as digest_win,
           coalesce((select value::int from public.pricing_config
                      where key = 'notif_stop_131049'), 0)            as stop_131049,
           coalesce((select value::int from public.pricing_config
                      where key = 'notif_send_window_friday_enabled'), 0) as window_on,
           greatest(1, least(
             coalesce((select value::int from public.pricing_config
                        where key = 'notif_131049_hold_hours'), 72),
             24 * 30))                                                as hold_hours,
           array['agenda_reminder']::text[]                            as urgent,
           public.notification_push_priority_types()                  as priority,
           public.notification_known_types()                          as known
  ),
  cfg as (
    select cfg0.*,
           public.notif_il_digest_open(cfg0.digest_win) as digest_open
      from cfg0
  ),
  agents as (
    select m.id, m.display_name,
           nullif(btrim(coalesce(m.phone_e164, '')), '') as phone_e164,
           array(
             select t from unnest((select known from cfg)) t
              where t <> all (coalesce(np.whatsapp_off_types, '{}'::text[]))
           )                                             as whatsapp_types,
           array(
             select less.notif_type
               from public.agent_notif_less less
              where less.agent_id = m.id
                and less.expires_at > now()
                and not public.notification_push_less_kept(less.notif_type)
           )                                             as less_types,
           coalesce(rp.quiet_from_hour, 21)              as quiet_from,
           coalesce(rp.quiet_to_hour,   8)               as quiet_to,
           coalesce(rp.quiet_days, '{5,6}'::smallint[])     as quiet_days,
           coalesce(
             (select c.last_message_at > now() - interval '23 hours'
                from public.whatsapp_conversations c
               where c.agent_id = m.id),
             false)                                      as in_window
      from public.agency_members m
      left join public.agent_notification_preferences np on np.agent_id = m.id
      left join public.agent_reminder_preferences     rp on rp.agent_id = m.id
     where m.active
       and m.closed_at is null
       and m.closure_requested_at is null
       and m.tier in ('mid', 'premium')
       and m.billing_status = 'active'
  ),
  recent as (
    select l.agent_id,
           max(l.created_at) as last_at,
           max(l.created_at) filter (
             where l.channel_mode = 'template'
               and public.notification_push_log_holds(l.whatsapp_status, l.created_at)
           ) as last_tpl_at,
           count(*) filter (
             where public.notification_push_log_holds(l.whatsapp_status, l.created_at)
               and l.created_at > now() - interval '24 hours'
           ) as n24,
           count(*) filter (
             where not public.notification_push_log_holds(l.whatsapp_status, l.created_at)
               and l.created_at > now() - interval '24 hours'
           ) as fails24,
           bool_or(
             position('131049' in coalesce(l.last_error, '')) > 0
             and l.created_at > now() - make_interval(hours => (select hold_hours from cfg))
           ) as hit_131049
      from public.notification_push_log l
     group by l.agent_id
  ),
  shaped as (
    select a.id, a.display_name, a.phone_e164, a.in_window,
           case
             when public.notification_agent_send_quiet(
                    a.quiet_from, a.quiet_to, a.quiet_days, now(), cfg.window_on)
             then array(select t from unnest(a.whatsapp_types) t where t = any(cfg.urgent))
             when coalesce((select value::int from public.pricing_config
                             where key = 'agent_holiday_window_enabled'), 0) = 1
              and public.agent_backlog_waiting(a.id, pg_catalog.now())
             then array(
               select t from unnest(a.whatsapp_types) t
                where t = any(cfg.priority)
             )
             when cfg.stop_131049 = 1
              and not a.in_window
              and coalesce(r.hit_131049, false)
             then array(
               select t from unnest(a.whatsapp_types) t
                where t = any(cfg.priority)
                   or public.notification_push_less_kept(t)
             )
             when cfg.digest_on = 1
              and not cfg.digest_open
             then array(
               select t from unnest(a.whatsapp_types) t
                where t = any(cfg.priority)
                   or public.notification_push_less_kept(t)
             )
             when (r.last_at is not null
                   and r.last_at >= now() - make_interval(mins => cfg.gap_min))
               or coalesce(r.n24, 0) >= case
                    when cfg.digest_on = 1 then least(cfg.digest_cap, cfg.cap)
                    else cfg.cap
                  end
               or (not a.in_window
                   and r.last_tpl_at is not null
                   and r.last_tpl_at >= now() - make_interval(mins => cfg.tpl_gap))
             then array(
               select t from unnest(a.whatsapp_types) t
                where t = any(cfg.priority)
                   or (cfg.digest_on = 1 and public.notification_push_less_kept(t))
             )
             else a.whatsapp_types
           end as raw_types,
           a.less_types,
           cfg.digest_open,
           cfg.digest_win,
           r.last_at,
           r.fails24, cfg.max_fail
      from agents a
      cross join cfg
      left join recent r on r.agent_id = a.id
  ),
  gated as (
    select s.id, s.display_name, s.phone_e164, s.in_window, s.fails24, s.max_fail,
           case
             when s.digest_open
              and (s.last_at is null
                   or s.last_at < now() - make_interval(mins => greatest(s.digest_win, 1) * 2))
             then s.raw_types
             else array(
               select t from unnest(s.raw_types) t
                where t <> all (coalesce(s.less_types, '{}'::text[]))
             )
           end as types
      from shaped s
  )
  select g.id, g.display_name, g.phone_e164, g.types, g.in_window
    from gated g
   where coalesce(array_length(g.types, 1), 0) > 0
     and g.phone_e164 is not null
     and coalesce(g.fails24, 0) < g.max_fail;
$$;


comment on function public.notification_push_due_agents() is
  'כמו 20271029235000. כש-agent_holiday_window_enabled דלוק, הסוכנים מתפזרים על 08:00-09:00 במקום כולם ב-08:00.';

revoke all on function public.notification_push_due_agents() from public, anon, authenticated;
grant execute on function public.notification_push_due_agents() to service_role;

create or replace function public.customer_note_channel(
  p_alert_id uuid,
  p_email_status text,
  p_whatsapp_status text
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.saved_search_alerts
     set email_status = coalesce(p_email_status, email_status),
         whatsapp_status = coalesce(p_whatsapp_status, whatsapp_status)
   where id = p_alert_id;
$$;

revoke all on function public.customer_note_channel(uuid, text, text) from public, anon, authenticated;
grant execute on function public.customer_note_channel(uuid, text, text) to service_role;
