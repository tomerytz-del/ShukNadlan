-- "נכס חדש שותף איתך" הופך לסיכום אחד ביום, כשהדגל דלוק.
-- ברירת המחדל כבויה: כל שיתוף ממשיך לצאת כמו היום.
--
-- לא מחליפים את share_property_for_agent, את notify_agent_on_new_lead,
-- את notifications_apply_preferences או את social-lead-intake.
-- טריגר נפרד מדליק suppress_push על השורה הבודדת כשהדגל דלוק, והפעמון
-- נשאר. הסיכום נבנה ב-share_digest_build.
--
-- נכנס רק מה שנוצר אחרי הסיכום הקודם (או אחרי enabled_at) ושאין לו
-- שום שורה ב-notification_push_log. מה שכבר יצא לא יוצא שוב.
-- מחוץ לחלון 24 השעות הסיכום הוא התבנית היחידה של היום, או נשאר
-- בפעמון אם כבר יצאה תבנית. לא תבנית שנייה (131049).

insert into public.pricing_config (key, value, description)
values
  ('share_digest_enabled', 0,
   '1 = שיתוף נכס נשאר בפעמון ונכנס לסיכום אחד ביום. 0 = כל שיתוף יוצא כמו היום.'),
  ('share_digest_hhmm', 1230,
   'שעת הסיכום בשעון ישראל, HHMM. 1230 = 12:30. חלון של 10 דקות.')
on conflict (key) do nothing;

select public.notification_types_add(array['share_digest']);

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
  notification_id uuid references public.notifications(id) on delete set null,
  folded_log_id   uuid
);

comment on table public.share_digest_runs is
  'סיכום שיתופים אחד לסוכן/ת ליום. folded_log_id מתמלא אם השורות נכנסו לתבנית שכבר יצאה.';

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
    select coalesce(
      (select s.enabled_at from public.share_digest_state s where s.id = 1),
      (date_trunc('day', pg_catalog.now() at time zone 'Asia/Jerusalem')
        at time zone 'Asia/Jerusalem')
    ) as since
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
     and n.created_at > greatest(
           cut.since,
           coalesce((select max(r.ran_at) from public.share_digest_runs r
                      where r.agent_id = n.agent_id), cut.since))
     and not exists (
       select 1 from public.notification_push_log l
        where n.id = any (l.notification_ids))
     and not exists (
       select 1 from public.share_digest_lines sl
        where sl.source_notification_id = n.id);
$$;

comment on function public.share_digest_preview() is
  'תצוגה יבשה של הסיכום הבא. שמות פרטיים, סוג ומחיר. לא כותבת.';

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
  v_on      int;
  v_since   timestamptz;
  v_local   timestamp;
  v_today   date;
  v_now_min int;
  v_hhmm    int;
  v_tgt     int;
  v_delta   int;
  v_sent    int := 0;
  v_nid     uuid;
  v_n       int;
  v_suppress boolean;
  v_tpl     boolean;
  ag        record;
begin
  v_on := coalesce((select value from public.pricing_config
                     where key = 'share_digest_enabled'), 0);
  if v_on <> 1 then
    return 0;
  end if;

  select s.enabled_at into v_since
    from public.share_digest_state s
   where s.id = 1;
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
  if v_delta >= 10 then
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
            and n.created_at > greatest(
                  v_since,
                  coalesce((select max(r.ran_at) from public.share_digest_runs r
                             where r.agent_id = m.id), v_since))
            and not exists (
              select 1 from public.notification_push_log l
               where n.id = any (l.notification_ids))
            and not exists (
              select 1 from public.share_digest_lines sl
               where sl.source_notification_id = n.id)
       )
  loop
    if public.agent_reminder_quiet_now(ag.quiet_from, ag.quiet_to, ag.quiet_days) then
      continue;
    end if;
    if exists (
      select 1 from public.share_digest_runs r
       where r.agent_id = ag.id
         and (r.ran_at at time zone 'Asia/Jerusalem')::date = v_today
    ) then
      continue;
    end if;

    v_tpl := exists (
      select 1
        from public.notification_push_log l
       where l.agent_id = ag.id
         and l.channel_mode = 'template'
         and l.created_at > pg_catalog.now() - interval '24 hours'
         and public.notification_push_log_holds(l.whatsapp_status, l.created_at)
    );
    -- מסלול free לא מחובר לגבריאלה, ולכן אין לו וואטסאפ. הסיכום נשאר בפעמון.
    -- בחלון: הודעה אחת עם רשימה. מחוץ לחלון: רק אם עוד אין תבנית היום.
    v_suppress := ag.tier is distinct from 'mid' and ag.tier is distinct from 'premium'
      or ag.phone is null
      or (not ag.in_window and v_tpl);

    insert into public.notifications (agent_id, type, title, body, suppress_push)
    values (
      ag.id,
      'share_digest',
      'סיכום נכסים ששותפו איתך',
      'סיכום נכסים ששותפו איתך',
      v_suppress
    )
    returning id into v_nid;

    insert into public.share_digest_lines (
      notification_id, source_notification_id, property_id,
      sharer_first_name, property_type, price_label
    )
    select v_nid,
           n.id,
           p.id,
           coalesce(nullif(split_part(btrim(coalesce(sh.display_name, '')), ' ', 1), ''), 'משרד'),
           coalesce(nullif(btrim(p.property_type), ''), 'נכס'),
           case
             when p.price is null or p.price <= 0 then 'מחיר לא צוין'
             else trim(to_char(p.price, 'FM999,999,999')) || ' ₪'
           end
      from public.notifications n
      join public.properties p on p.id = n.related_property_id
      left join public.agency_members sh on sh.id = p.agent_id
     where n.agent_id = ag.id
       and n.type = 'system'
       and n.title = 'נכס חדש שותף איתך'
       and n.related_property_id is not null
       and n.created_at > greatest(
             v_since,
             coalesce((select max(r.ran_at) from public.share_digest_runs r
                        where r.agent_id = ag.id), v_since))
       and not exists (
         select 1 from public.notification_push_log l
          where n.id = any (l.notification_ids))
       and not exists (
         select 1 from public.share_digest_lines sl
          where sl.source_notification_id = n.id);
    get diagnostics v_n = row_count;

    if coalesce(v_n, 0) = 0 then
      delete from public.notifications where id = v_nid;
      continue;
    end if;

    update public.notifications n
       set body = left(coalesce((
             select string_agg(g.block, E'\n\n' order by g.sharer)
               from (
                 select l.sharer_first_name as sharer,
                        l.sharer_first_name || E'\n' || string_agg(
                          l.property_type || ' · ' || l.price_label,
                          E'\n' order by l.property_type, l.property_id::text
                        ) as block
                   from public.share_digest_lines l
                  where l.notification_id = v_nid
                  group by l.sharer_first_name
               ) g
           ), 'סיכום נכסים ששותפו איתך'), 2000),
           related_property_id = (
             select case when count(*) = 1 then (array_agg(l.property_id))[1] else null end
               from public.share_digest_lines l
              where l.notification_id = v_nid
           ),
           action_path = (
             select case
               when count(*) = 1
                 then '/crm?goto=accSharedWithMe&property=' || (array_agg(l.property_id))[1]::text
               else '/crm?goto=accSharedWithMe'
             end
               from public.share_digest_lines l
              where l.notification_id = v_nid
           )
     where n.id = v_nid;

    insert into public.share_digest_runs (agent_id, ran_at, notification_id)
    values (ag.id, pg_catalog.now(), v_nid);
    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end;
$$;

comment on function public.share_digest_build() is
  'סיכום שיתופים אחד לסוכן/ת, בחלון של 10 דקות אחרי share_digest_hhmm (ברירת מחדל 12:30 ישראל). דגל כבוי: 0. לא שולח תבנית שנייה באותו יום. מסלול שאינו mid או premium נשאר בפעמון.';

revoke all on function public.share_digest_build() from public, anon, authenticated;
grant execute on function public.share_digest_build() to service_role;

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
