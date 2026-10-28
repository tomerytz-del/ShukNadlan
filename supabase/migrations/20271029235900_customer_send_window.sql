-- חלון שליחה אחד ללקוחות ולסוכנים, תקרת 3 הודעות לטלפון ביום,
-- ודחיה ליום הבא. תקציר הוואטסאפ נשאר כבוי עד שגבריאלה נותנת את הנוסח
-- ומטא מאשרת תבנית. אין כאן טקסט ללקוח/ה.

insert into public.pricing_config (key, value, description) values
  ('customer_digest_enabled', 0,
   '1: הודעות שנדחו יוצאות כתקציר אחד לטלפון כשהחלון נפתח. 0: הן נשארות דחויות, בלי נוסח.')
on conflict (key) do nothing;

create table if not exists public.il_holidays (
  holiday_date date primary key,
  kind text not null,
  name text not null,
  constraint il_holidays_kind_chk check (kind in ('eve', 'holiday'))
);

comment on table public.il_holidays is
  'חגי ישראל 2026-2027. eve = ערב חג (08:00-13:00). holiday = חג או יום כיפור (סגור). רק service_role.';

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
  ('2027-10-23', 'holiday', 'שמיני עצרת')
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

-- הגוף של #1049 נשאר קריאה. החגים נכנסים מכאן, בלי לבנות את due_agents מחדש.
create or replace function public.notification_send_window_open(p_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.send_window_open('agent', p_at);
$$;

comment on function public.notification_send_window_open(timestamptz) is
  'חלון הסוכנים. אותו send_window_open, קהל agent. שבת וחג סגורים גם כשהדגל של שישי דלוק.';

revoke all on function public.notification_send_window_open(timestamptz) from public, anon, authenticated;
grant execute on function public.notification_send_window_open(timestamptz) to service_role;

create or replace function public.saved_search_quiet_now()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not public.send_window_open('saved_search', pg_catalog.now());
$$;

comment on function public.saved_search_quiet_now() is
  'שקט כשהחלון האחיד סגור, כולל שבת, חג ויום כיפור. לא נשענת עוד על 22:00-08:00 בלבד.';

revoke all on function public.saved_search_quiet_now() from public, anon, authenticated;
grant execute on function public.saved_search_quiet_now() to service_role;

create table if not exists public.customer_phone_day (
  phone_e164 text not null,
  day date not null,
  sent_count int not null default 0,
  primary key (phone_e164, day)
);

comment on table public.customer_phone_day is
  'מונה הודעות לטלפון ביום לוח עברי-אזרחי של ישראל. תקרה 3. רק service_role.';

alter table public.customer_phone_day enable row level security;
revoke all on table public.customer_phone_day from public, anon, authenticated;
grant select, insert, update, delete on table public.customer_phone_day to service_role;

-- נעילת שורה. שתי שליחות באותו סבב לא עוברות יחד מעל 3.
create or replace function public.customer_phone_claim(p_phone text, p_at timestamptz default pg_catalog.now())
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_day date;
  v_n int;
begin
  if v_phone is null then
    return false;
  end if;
  v_day := (coalesce(p_at, pg_catalog.now()) at time zone 'Asia/Jerusalem')::date;
  insert into public.customer_phone_day (phone_e164, day, sent_count)
  values (v_phone, v_day, 0)
  on conflict (phone_e164, day) do nothing;

  select sent_count into v_n
    from public.customer_phone_day
   where phone_e164 = v_phone
     and day = v_day
   for update;

  if coalesce(v_n, 0) >= 3 then
    return false;
  end if;
  update public.customer_phone_day
     set sent_count = sent_count + 1
   where phone_e164 = v_phone
     and day = v_day;
  return true;
end;
$$;

comment on function public.customer_phone_claim(text, timestamptz) is
  'תופסת מקום אחד לטלפון ביום ישראל. false מההודעה הרביעית. הנעילה היא על השורה, לא לפני הסבב.';

revoke all on function public.customer_phone_claim(text, timestamptz) from public, anon, authenticated;
grant execute on function public.customer_phone_claim(text, timestamptz) to service_role;

create table if not exists public.customer_message_holds (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text,
  audience text not null,
  alert_id uuid,
  reason text not null,
  deliver_on date not null,
  created_at timestamptz not null default now(),
  constraint customer_message_holds_audience_chk
    check (audience in ('saved_search', 'open_house', 'customer_push')),
  constraint customer_message_holds_reason_chk
    check (reason in ('quiet', 'cap'))
);

comment on table public.customer_message_holds is
  'הודעה שנדחתה ליום הבא. אין גוף. התקציר כבוי ב-customer_digest_enabled. רק service_role.';

create index if not exists customer_message_holds_group_idx
  on public.customer_message_holds (phone_e164, deliver_on);

alter table public.customer_message_holds enable row level security;
revoke all on table public.customer_message_holds from public, anon, authenticated;
grant select, insert, update, delete on table public.customer_message_holds to service_role;

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
    check (status in ('pending', 'sent', 'failed', 'skipped', 'deferred'));
end $$;

create or replace function public.customer_message_defer(p_alert_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text;
  v_day date;
begin
  if p_reason not in ('quiet', 'cap') or p_alert_id is null then
    return;
  end if;
  v_day := (pg_catalog.now() at time zone 'Asia/Jerusalem')::date + 1;
  select s.phone_e164 into v_phone
    from public.saved_search_alerts a
    join public.saved_searches s on s.id = a.search_id
   where a.id = p_alert_id;

  update public.saved_search_alerts
     set status = 'deferred',
         last_error = p_reason
   where id = p_alert_id
     and status = 'pending';

  insert into public.customer_message_holds (phone_e164, audience, alert_id, reason, deliver_on)
  values (v_phone, 'saved_search', p_alert_id, p_reason, v_day);
end;
$$;

comment on function public.customer_message_defer(uuid, text) is
  'מסמנת התראת חיפוש כדחויה ליום הבא. לא שולחת ולא מוחקת.';

revoke all on function public.customer_message_defer(uuid, text) from public, anon, authenticated;
grant execute on function public.customer_message_defer(uuid, text) to service_role;

create or replace function public.customer_defer_outside_window()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int := 0;
  r record;
begin
  if public.send_window_open('saved_search', pg_catalog.now()) then
    return 0;
  end if;
  for r in
    select a.id
      from public.saved_search_alerts a
     where a.status = 'pending'
  loop
    perform public.customer_message_defer(r.id, 'quiet');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

comment on function public.customer_defer_outside_window() is
  'כשהחלון סגור, כל התראה ממתינה נדחית ליום הבא. לא נשלחת בבוקר כהודעה נפרדת.';

revoke all on function public.customer_defer_outside_window() from public, anon, authenticated;
grant execute on function public.customer_defer_outside_window() to service_role;

create or replace function public.customer_window_hold(p_audience text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := (pg_catalog.now() at time zone 'Asia/Jerusalem')::date + 1;
begin
  if p_audience not in ('open_house', 'customer_push', 'saved_search') then
    return;
  end if;
  if p_reason not in ('quiet', 'cap') then
    return;
  end if;
  if exists (
    select 1 from public.customer_message_holds h
     where h.audience = p_audience
       and h.reason = p_reason
       and h.alert_id is null
       and h.deliver_on = v_day
  ) then
    return;
  end if;
  insert into public.customer_message_holds (phone_e164, audience, alert_id, reason, deliver_on)
  values (null, p_audience, null, p_reason, v_day);
end;
$$;

comment on function public.customer_window_hold(text, text) is
  'סימון שהיריד או הדחיפה לא יצאו כי החלון סגור. שורה אחת ליום, בלי כתובת ובלי גוף.';

revoke all on function public.customer_window_hold(text, text) from public, anon, authenticated;
grant execute on function public.customer_window_hold(text, text) to service_role;

-- התקציר. הדגל 0 מחזיר אפס שורות. אין כאן נוסח.
create or replace function public.customer_digest_groups(p_at timestamptz default pg_catalog.now())
returns table (phone_e164 text, deliver_on date, held int)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce((select value::int from public.pricing_config
                where key = 'customer_digest_enabled'), 0) <> 1 then
    return;
  end if;
  if not public.send_window_open('saved_search', coalesce(p_at, pg_catalog.now())) then
    return;
  end if;
  return query
    select h.phone_e164,
           min(h.deliver_on) as deliver_on,
           count(*)::int as held
      from public.customer_message_holds h
     where h.audience = 'saved_search'
       and h.phone_e164 is not null
       and h.deliver_on <= (coalesce(p_at, pg_catalog.now()) at time zone 'Asia/Jerusalem')::date
     group by h.phone_e164;
end;
$$;

comment on function public.customer_digest_groups(timestamptz) is
  'קבוצות תקציר לפי טלפון. דגל 0: כלום. אין נוסח עד שגבריאלה תאשר.';

revoke all on function public.customer_digest_groups(timestamptz) from public, anon, authenticated;
grant execute on function public.customer_digest_groups(timestamptz) to service_role;

-- הטריגר הקיים, ונוסף עליו רק החלון והתקרה. מחוץ לחלון או מעל 3 אין דחיפה.
create or replace function public.app_push_on_saved_search_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_dev uuid;
  v_phone text;
  v_has_device boolean;
begin
  if new.status is distinct from 'pending' then
    return new;
  end if;
  if not public.send_window_open('customer_push', pg_catalog.now()) then
    perform public.customer_message_defer(new.id, 'quiet');
    return new;
  end if;
  select exists (
    select 1 from public.app_push_devices d
     where d.saved_search_id = new.search_id and d.disabled_at is null
  ) into v_has_device;
  if v_has_device then
    select s.phone_e164 into v_phone
      from public.saved_searches s
     where s.id = new.search_id;
    if v_phone is not null and not public.customer_phone_claim(v_phone, pg_catalog.now()) then
      perform public.customer_message_defer(new.id, 'cap');
      return new;
    end if;
  end if;

  select coalesce(nullif(btrim(p.title), ''), 'נכס חדש') into v_title
    from public.properties p
   where p.id = new.property_id;

  for v_dev in
    select d.id from public.app_push_devices d
     where d.saved_search_id = new.search_id and d.disabled_at is null
  loop
    perform public.app_push_enqueue(
      v_dev,
      coalesce(v_title, 'נכס חדש'),
      'נכס חדש שמתאים לחיפוש ששמרתם',
      'https://shuknadlan.co.il/property?id=' || new.property_id::text,
      'saved_search',
      new.id
    );
  end loop;
  return new;
exception when others then
  raise warning 'app_push_on_saved_search_alert: %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.app_push_on_saved_search_alert() from public, anon, authenticated;
