-- "נכס חדש שותף איתך" הופך לסיכום אחד ביום, כשהדגל דלוק.
-- ברירת המחדל כבויה: כל שיתוף ממשיך לצאת כמו היום.
--
-- לא מחליפים את share_property_for_agent, את notify_agent_on_new_lead,
-- את notifications_apply_preferences או את social-lead-intake.
-- טריגר נפרד מדליק suppress_push על השורה הבודדת כשהדגל דלוק, והפעמון
-- נשאר. הסיכום נבנה ב-share_digest_build.
--
-- נכנס רק מה שנוצר אחרי enabled_at (חותמת ההדלקה) ואחרי הסיכום הקודם,
-- ושאין לו שורת notification_push_log. שיתוף מלפני ההדלקה לא נכנס.
-- מה שכבר יצא לא יוצא שוב.
--
-- בחלון 24 השעות: הודעת טקסט עם כפתור. מחוץ לחלון: פעמון בלבד.
-- הסיכום לעולם אינו תבנית UTILITY. התבנית שמורה ללידים ולתזכורות.
--
-- סדר מיזוג: #1025 (suppress_push ושומר ההתפרצות) ו-#1036 (action_path)
-- לפני ה-PR הזה. #1049 (notification_agent_send_quiet) רשות: אם הפונקציה
-- קיימת קוראים לה עם חלון דלוק, ואם לא - אותו כלל משוכפל כאן.
-- שישי 12:30 יוצא. שבת נשארת שקטה. שעות השקט של הסוכן/ת עדיין מצמצמות.
--
-- יצירה מפוזרת 12:30-13:00: שש משבצות של 5 דקות לפי hash(agent_id).
-- share_digest אינו ב-notification_push_priority_types ואינו ב-
-- notification_push_less_kept_types, ולכן תקרת השעה (12), תקרת היום (30),
-- תקרת היצירה (300 ב-15 דקות) והתקרה הגלובלית (130 בשעה) חלות עליו.

insert into public.pricing_config (key, value, description)
values
  ('share_digest_enabled', 0,
   '1 = שיתוף נכס נשאר בפעמון ונכנס לסיכום אחד ביום. 0 = כל שיתוף יוצא כמו היום.'),
  ('share_digest_hhmm', 1230,
   'שעת תחילת הסיכום בשעון ישראל, HHMM. 1230 = 12:30. חלון של 30 דקות, שש משבצות של 5 דקות.')
on conflict (key) do nothing;

select public.notification_types_add(array['share_digest']);

-- העמודות מגיעות מ-#1025 ומ-#1036. אם הקובץ הזה רץ קודם, הן נוצרות כאן
-- כדי שההכנסה והדחיפה לא ייפלו. אילוץ הנתיב וה-claim נשארים ב-#1036.
alter table public.notifications
  add column if not exists suppress_push boolean not null default false;
alter table public.notifications
  add column if not exists action_path text;

create table if not exists public.share_digest_state (
  id         int primary key check (id = 1),
  enabled_at timestamptz
);

comment on table public.share_digest_state is
  'חותמת ההדלקה של share_digest_enabled. שיתוף שנוצר לפניה לא נכנס לסיכום.';

revoke all on table public.share_digest_state from public, anon, authenticated;
grant select, insert, update on table public.share_digest_state to service_role;
alter table public.share_digest_state enable row level security;

create table if not exists public.share_digest_runs (
  id              uuid primary key default gen_random_uuid(),
  agent_id        uuid not null references public.agency_members(id) on delete cascade,
  ran_at          timestamptz not null default now(),
  notification_id uuid references public.notifications(id) on delete set null
);

comment on table public.share_digest_runs is
  'סיכום שיתופים אחד לסוכן/ת ליום. אין קיפול לתבנית.';

create index if not exists share_digest_runs_agent_idx
  on public.share_digest_runs (agent_id, ran_at desc);

revoke all on table public.share_digest_runs from public, anon, authenticated;
grant select on table public.share_digest_runs to service_role;
alter table public.share_digest_runs enable row level security;

create table if not exists public.share_digest_lines (
  id                     uuid primary key default gen_random_uuid(),
  notification_id        uuid not null references public.notifications(id) on delete cascade,
  source_notification_id uuid not null,
  property_id            uuid,
  sharer_first_name      text,
  property_type          text,
  price_label            text,
  created_at             timestamptz not null default now()
);

comment on table public.share_digest_lines is
  'שורה לכל נכס בסיכום: שם פרטי של מי שיתף, סוג, מחיר. בלי טלפון ובלי כתובת.';

create index if not exists share_digest_lines_notification_idx
  on public.share_digest_lines (notification_id);
create unique index if not exists share_digest_lines_source_key
  on public.share_digest_lines (source_notification_id);

revoke all on table public.share_digest_lines from public, anon, authenticated;
grant select on table public.share_digest_lines to service_role;
alter table public.share_digest_lines enable row level security;

create or replace function public.share_digest_flag_touch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.key is distinct from 'share_digest_enabled' then
    return new;
  end if;
  if coalesce(new.value, 0) = 1
     and (tg_op = 'INSERT' or coalesce(old.value, 0) is distinct from 1) then
    insert into public.share_digest_state (id, enabled_at)
    values (1, pg_catalog.now())
    on conflict (id) do update
      set enabled_at = excluded.enabled_at;
  end if;
  return new;
end;
$$;

comment on function public.share_digest_flag_touch() is
  'במעבר share_digest_enabled מ-0 ל-1 רושם enabled_at. עדכון בלי שינוי הערך לא מזיז את החותמת.';

revoke all on function public.share_digest_flag_touch() from public, anon, authenticated;
grant execute on function public.share_digest_flag_touch() to service_role;

drop trigger if exists share_digest_flag_touch on public.pricing_config;
create trigger share_digest_flag_touch
  after insert or update on public.pricing_config
  for each row execute function public.share_digest_flag_touch();

-- השיתוף הבודד נשאר בפעמון. לא מוחקים את השורה ולא נוגעים בפונקציית השיתוף.
create or replace function public.share_digest_suppress_one()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select value from public.pricing_config
                where key = 'share_digest_enabled'), 0) = 1
     and new.type = 'system'
     and new.title = 'נכס חדש שותף איתך'
     and new.related_property_id is not null then
    new.suppress_push := true;
  end if;
  return new;
end;
$$;

comment on function public.share_digest_suppress_one() is
  'כש-share_digest_enabled = 1, שיתוף בודד נשאר בפעמון. הדגל כבוי: אין שינוי.';

revoke all on function public.share_digest_suppress_one() from public, anon, authenticated;
grant execute on function public.share_digest_suppress_one() to service_role;

drop trigger if exists share_digest_suppress_one on public.notifications;
create trigger share_digest_suppress_one
  before insert on public.notifications
  for each row execute function public.share_digest_suppress_one();

create or replace function public.share_digest_preview()
returns table (
  agent_first_name text,
  sharer_first_name text,
  property_type text,
  price text,
  property_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  with cut as (
    select s.enabled_at as since
      from public.share_digest_state s
     where s.id = 1
       and s.enabled_at is not null
  )
  select split_part(btrim(coalesce(m.display_name, '')), ' ', 1),
         coalesce(nullif(split_part(btrim(coalesce(sh.display_name, '')), ' ', 1), ''), 'משרד'),
         coalesce(nullif(btrim(p.property_type), ''), 'נכס'),
         case
           when p.price is null or p.price <= 0 then 'מחיר לא צוין'
           else trim(to_char(p.price, 'FM999,999,999')) || ' ₪'
         end,
         p.id
    from public.notifications n
    join public.agency_members m on m.id = n.agent_id
    join public.properties p on p.id = n.related_property_id
    left join public.agency_members sh on sh.id = p.agent_id
    cross join cut
   where n.type = 'system'
     and n.title = 'נכס חדש שותף איתך'
     and n.related_property_id is not null
     and n.created_at > cut.since
     and n.created_at > coalesce((select max(r.ran_at) from public.share_digest_runs r
                                   where r.agent_id = n.agent_id), cut.since)
     and not exists (
       select 1 from public.notification_push_log l
        where n.id = any (l.notification_ids))
     and not exists (
       select 1 from public.share_digest_lines sl
        where sl.source_notification_id = n.id);
$$;

comment on function public.share_digest_preview() is
  'תצוגה יבשה של הסיכום הבא. רק אחרי enabled_at. שמות פרטיים, סוג ומחיר. לא כותבת.';

revoke all on function public.share_digest_preview() from public, anon, authenticated;
grant execute on function public.share_digest_preview() to service_role;

create or replace function public.share_digest_lines_for_log(p_log_id uuid)
returns table (
  sharer_first_name text,
  property_type text,
  price_label text,
  property_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select l.sharer_first_name, l.property_type, l.price_label, l.property_id
    from public.notification_push_log g
    join public.share_digest_lines l on l.notification_id = any (g.notification_ids)
   where g.id = p_log_id
   order by l.sharer_first_name, l.property_type, l.property_id;
$$;

comment on function public.share_digest_lines_for_log(uuid) is
  'שורות הסיכום שנכללו ביומן השליחה, כדי לפתוח כל נכס בנפרד.';

revoke all on function public.share_digest_lines_for_log(uuid) from public, anon, authenticated;
grant execute on function public.share_digest_lines_for_log(uuid) to service_role;

create or replace function public.share_digest_build()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_on       int;
  v_since    timestamptz;
  v_local    timestamp;
  v_today    date;
  v_now_min  int;
  v_hhmm     int;
  v_tgt      int;
  v_delta    int;
  v_sent     int := 0;
  v_nid      uuid;
  v_n        int;
  v_lines    int;
  v_slot     int;
  v_quiet    boolean;
  v_dow      int;
  v_hour     int;
  v_suppress boolean;
  v_rows     jsonb;
  v_body     text;
  v_path     text;
  v_prop     uuid;
  ag         record;
begin
  v_on := coalesce((select value from public.pricing_config
                     where key = 'share_digest_enabled'), 0);
  if v_on <> 1 then
    return 0;
  end if;

  select s.enabled_at into v_since
    from public.share_digest_state s
   where s.id = 1
     and s.enabled_at is not null;
  if v_since is null then
    return 0;
  end if;

  v_local := pg_catalog.now() at time zone 'Asia/Jerusalem';
  v_today := v_local::date;
  v_now_min := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;
  v_hhmm := coalesce((select value from public.pricing_config
                       where key = 'share_digest_hhmm'), 1230);
  if v_hhmm < 0 or v_hhmm > 2359 or (v_hhmm % 100) > 59 then
    v_hhmm := 1230;
  end if;
  v_tgt := (v_hhmm / 100) * 60 + (v_hhmm % 100);
  v_delta := (v_now_min - v_tgt + 1440) % 1440;
  -- 12:30 עד 13:00. דקה שפוספסת נתפסת בהמשך החלון, לא הולכת לאיבוד.
  if v_delta >= 30 then
    return 0;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('share_digest_build')::bigint);

  for ag in
    select m.id,
           m.tier,
           nullif(btrim(coalesce(m.phone_e164, '')), '') as phone,
           coalesce(
             (select c.last_message_at > pg_catalog.now() - interval '23 hours'
                from public.whatsapp_conversations c
               where c.agent_id = m.id),
             false) as in_window,
           coalesce(rp.quiet_from_hour, 21) as quiet_from,
           coalesce(rp.quiet_to_hour, 8) as quiet_to,
           coalesce(rp.quiet_days, '{5,6}'::smallint[]) as quiet_days
      from public.agency_members m
      left join public.agent_reminder_preferences rp on rp.agent_id = m.id
     where m.active
       and m.closed_at is null
       and exists (
         select 1
           from public.notifications n
          where n.agent_id = m.id
            and n.type = 'system'
            and n.title = 'נכס חדש שותף איתך'
            and n.related_property_id is not null
            and n.created_at > v_since
            and n.created_at > coalesce((select max(r.ran_at) from public.share_digest_runs r
                                          where r.agent_id = m.id), v_since)
            and not exists (
              select 1 from public.notification_push_log l
               where n.id = any (l.notification_ids))
            and not exists (
              select 1 from public.share_digest_lines sl
               where sl.source_notification_id = n.id)
       )
  loop
    -- שש משבצות של 5 דקות. אחרי שהמשבצת נפתחה, כל דקה בחלון עדיין תופסת.
    v_slot := mod(pg_catalog.hashtext(ag.id::text)::bigint, 6);
    if v_slot < 0 then
      v_slot := v_slot + 6;
    end if;
    if v_delta < v_slot * 5 then
      continue;
    end if;

    -- שישי עד 13:00 פתוח גם כש-quiet_days כולל 5. שבת סגורה.
    -- חלון 1 קבוע: הדגל הגלובלי של #1049 לא חוסם את הסיכום של 12:30.
    v_quiet := false;
    if to_regprocedure('public.notification_agent_send_quiet(integer,integer,smallint[],timestamp with time zone,integer)') is not null then
      execute 'select public.notification_agent_send_quiet($1, $2, $3, $4, 1)'
        into v_quiet
        using ag.quiet_from, ag.quiet_to, ag.quiet_days, pg_catalog.now();
    else
      v_dow := extract(dow from v_local)::int;
      v_hour := extract(hour from v_local)::int;
      if v_dow = 6 or (v_dow = 5 and v_hour >= 13) or v_hour < 8 or v_hour >= 21 then
        v_quiet := true;
      else
        v_quiet := public.agent_reminder_quiet_now(
          ag.quiet_from,
          ag.quiet_to,
          array_remove(coalesce(ag.quiet_days, '{5,6}'::smallint[]), 5::smallint));
      end if;
    end if;
    if v_quiet then
      continue;
    end if;

    if exists (
      select 1 from public.share_digest_runs r
       where r.agent_id = ag.id
         and (r.ran_at at time zone 'Asia/Jerusalem')::date = v_today
    ) then
      continue;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
             'source_id', n.id,
             'property_id', p.id,
             'sharer', coalesce(nullif(split_part(btrim(coalesce(sh.display_name, '')), ' ', 1), ''), 'משרד'),
             'ptype', coalesce(nullif(btrim(p.property_type), ''), 'נכס'),
             'price', case
               when p.price is null or p.price <= 0 then 'מחיר לא צוין'
               else trim(to_char(p.price, 'FM999,999,999')) || ' ₪'
             end
           )), '[]'::jsonb)
      into v_rows
      from public.notifications n
      join public.properties p on p.id = n.related_property_id
      left join public.agency_members sh on sh.id = p.agent_id
     where n.agent_id = ag.id
       and n.type = 'system'
       and n.title = 'נכס חדש שותף איתך'
       and n.related_property_id is not null
       and n.created_at > v_since
       and n.created_at > coalesce((select max(r.ran_at) from public.share_digest_runs r
                                     where r.agent_id = ag.id), v_since)
       and not exists (
         select 1 from public.notification_push_log l
          where n.id = any (l.notification_ids))
       and not exists (
         select 1 from public.share_digest_lines sl
          where sl.source_notification_id = n.id);

    v_n := coalesce(jsonb_array_length(v_rows), 0);
    if v_n = 0 then
      continue;
    end if;

    select case when count(*) = 1 then (array_agg(x.property_id))[1] else null end
      into v_prop
      from jsonb_to_recordset(v_rows) as x(
        source_id uuid, property_id uuid, sharer text, ptype text, price text
      );
    v_path := case
      when v_n = 1 then '/crm?goto=accSharedWithMe&property=' || v_prop::text
      else '/crm?goto=accSharedWithMe'
    end;
    select left(coalesce(string_agg(g.block, E'\n\n' order by g.sharer),
                         'סיכום נכסים ששותפו איתך'), 2000)
      into v_body
      from (
        select x.sharer,
               x.sharer || E'\n' || string_agg(
                 x.ptype || ' · ' || x.price,
                 E'\n' order by x.ptype, x.property_id::text
               ) as block
          from jsonb_to_recordset(v_rows) as x(
            source_id uuid, property_id uuid, sharer text, ptype text, price text
          )
         group by x.sharer
      ) g;

    -- מסלול free ומי שמחוץ לחלון 24 השעות: פעמון בלבד. בלי תבנית.
    v_suppress := ag.tier is distinct from 'mid' and ag.tier is distinct from 'premium'
      or ag.phone is null
      or not ag.in_window;

    insert into public.notifications (
      agent_id, type, title, body, suppress_push, action_path, related_property_id
    )
    values (
      ag.id,
      'share_digest',
      'סיכום נכסים ששותפו איתך',
      v_body,
      v_suppress,
      v_path,
      v_prop
    )
    returning id into v_nid;

    insert into public.share_digest_lines (
      notification_id, source_notification_id, property_id,
      sharer_first_name, property_type, price_label
    )
    select v_nid, x.source_id, x.property_id, x.sharer, x.ptype, x.price
      from jsonb_to_recordset(v_rows) as x(
        source_id uuid, property_id uuid, sharer text, ptype text, price text
      );
    get diagnostics v_lines = row_count;
    if coalesce(v_lines, 0) <> v_n then
      raise exception 'share_digest lines missing for %', ag.id;
    end if;

    insert into public.share_digest_runs (agent_id, ran_at, notification_id)
    values (ag.id, pg_catalog.now(), v_nid);
    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end;
$$;

comment on function public.share_digest_build() is
  'סיכום שיתופים אחד לסוכן/ת, בחלון של 30 דקות אחרי share_digest_hhmm (ברירת מחדל 12:30 ישראל), מפוזר לשש משבצות. דגל כבוי: 0. בחלון 24 השעות טקסט עם כפתור. מחוץ לו פעמון, בלי תבנית. שישי עד 13:00 יוצא, שבת שקטה. מסלול שאינו mid או premium נשאר בפעמון.';

revoke all on function public.share_digest_build() from public, anon, authenticated;
grant execute on function public.share_digest_build() to service_role;

-- דחיפת האפליקציה מ-20270822090000, עם שני שינויים: suppress_push עוצר
-- אותה (שיתוף בודד בזמן הדגל, וסיכום שנשאר בפעמון), ו-action_path גובר
-- כדי שהדחיפה תיפתח על הגוף הסופי ולא על /crm.
create or replace function public.app_push_on_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_path text;
  v_dev uuid;
begin
  if coalesce(new.suppress_push, false) then
    return new;
  end if;

  select am.user_id into v_user
  from public.agency_members am
  where am.id = new.agent_id;
  if v_user is null then
    return new;
  end if;

  v_path := case
    when coalesce(btrim(new.action_path), '') <> '' then new.action_path
    when new.type = 'lead_prefs_default' then '/crm?goto=accPrefs&focus=lead_prefs'
    when new.type = 'open_demand' then '/crm?goto=accLeads&tab=demand'
    when new.related_agreement_id is not null
      then '/crm?goto=accAgreements&agreement=' || new.related_agreement_id::text
    when new.type in ('review_new', 'review_alert') and new.related_review_id is not null
      then '/crm?goto=accReviews&review=' || new.related_review_id::text
    when new.type = 'agenda_reminder' and new.related_lead_id is not null
      then '/crm?goto=accLeads&lead=' || new.related_lead_id::text
    when new.type = 'agenda_reminder' and new.related_agenda_item_id is not null
      then '/crm?goto=accAgenda&agenda=' || new.related_agenda_item_id::text
    when new.type = 'client_match' and new.related_client_id is not null
      then '/crm?goto=accClients&client=' || new.related_client_id::text || '&focus=matches'
    when new.related_property_id is not null
      and new.type is distinct from 'deal_closed'
      and new.type is distinct from 'client_match'
      then '/crm?goto=accProperties&property=' || new.related_property_id::text
    when new.related_client_id is not null
      then '/crm?goto=accClients&client=' || new.related_client_id::text
    when new.related_lead_id is not null and new.type in ('new_lead', 'review_request', 'system')
      then '/crm?goto=accLeads&lead=' || new.related_lead_id::text
    else '/crm'
  end;

  for v_dev in
    select d.id from public.app_push_devices d
    where d.user_id = v_user and d.disabled_at is null
  loop
    perform public.app_push_enqueue(
      v_dev,
      new.title,
      new.body,
      'https://shuknadlan.co.il' || v_path,
      'notification',
      new.id
    );
  end loop;
  return new;
exception when others then
  raise warning 'app_push_on_notification: %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.app_push_on_notification() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - share_digest_build לא תוזמנה';
    return;
  end if;
  perform cron.unschedule('share-digest')
    where exists (select 1 from cron.job where jobname = 'share-digest');
  perform cron.schedule('share-digest', '* * * * *',
                        'select public.share_digest_build()');
end $$;
