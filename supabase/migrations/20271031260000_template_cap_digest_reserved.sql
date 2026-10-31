-- חריץ תבנית שמור לתקציר היומי, מעל גג 2, רק כששני הדגלים דלוקים.
-- whatsapp_template_cap_digest_reserved נולד 1. כבוי: אין שינוי.
--
-- החריץ הוא לתקציר בלבד (פריטים שכבר נעצרו ב-skipped_template_cap).
-- הוא יוצא בחלון תקציר הראשון (08:30, 13:00, 17:30) שחלפו בו 8 שעות
-- מהתבנית האחרונה. אם אין חלון כזה היום, החלון הראשון של מחר, כל עוד
-- הפריט בתוך 72 השעות. בתוך חלון 24 השעות זה טקסט חופשי, בלי תבנית
-- ובלי לספור. ליד, תזכורת וסיור לא משתמשים בחריץ.

insert into public.app_config (key, value, description) values
  ('whatsapp_template_cap_digest_reserved', '1',
   'כמה תבניות תקציר מעל הגג לסוכן ביום מקומי. 1. 0 מבטל את החריץ. לא חל על סוג אחר.')
on conflict (key) do nothing;

create or replace function public.whatsapp_template_cap_limit(p_key text, p_default numeric)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select case
              when p_key in ('whatsapp_template_cap_daily', 'whatsapp_template_cap_hard_max', 'whatsapp_template_cap_digest_reserved')
                   and c.value ~ '^[0-9]+$' then c.value::numeric
              when p_key not in ('whatsapp_template_cap_daily', 'whatsapp_template_cap_hard_max', 'whatsapp_template_cap_digest_reserved')
                   and c.value ~ '^[0-9]+(\.[0-9]+)?$' then c.value::numeric
              else null
            end
       from public.app_config c
      where c.key = p_key),
    p_default);
$$;

comment on function public.whatsapp_template_cap_limit(text, numeric) is
  'ערך מספרי מתקרת התבניות ב-app_config. חסר או לא-מספר חוזר לברירת המחדל.';

revoke all on function public.whatsapp_template_cap_limit(text, numeric) from public, anon, authenticated;
grant execute on function public.whatsapp_template_cap_limit(text, numeric) to service_role;


create or replace function public.whatsapp_template_cap_digest_open_at(p_now timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with clock as (
    select
      extract(hour from (p_now at time zone 'Asia/Jerusalem'))::int * 60
      + extract(minute from (p_now at time zone 'Asia/Jerusalem'))::int as minute
  ),
  wins as (
    select coalesce((select value::int from public.pricing_config where key = 'notif_digest_window_1'), 510) as w
    union all
    select coalesce((select value::int from public.pricing_config where key = 'notif_digest_window_2'), 780)
    union all
    select coalesce((select value::int from public.pricing_config where key = 'notif_digest_window_3'), 1050)
  )
  select exists (
    select 1
      from clock, wins
     where abs(clock.minute - wins.w) <= greatest(0, least(coalesce(
             (select value::int from public.pricing_config where key = 'notif_digest_window_minutes'), 15), 120))
  );
$$;

comment on function public.whatsapp_template_cap_digest_open_at(timestamptz) is
  'האם חותמת נתונה היא בתוך חלון תקציר (08:30, 13:00, 17:30, שעון ישראל).';

revoke all on function public.whatsapp_template_cap_digest_open_at(timestamptz) from public, anon, authenticated;
grant execute on function public.whatsapp_template_cap_digest_open_at(timestamptz) to service_role;

-- normal: חריץ רגיל (מתחת לגג, ואחרי 8 שעות אם זו השניה).
-- reserved: מעל הגג, תקציר בלבד, אחרי 8 שעות, ועדיין לא נוצל היום.
-- wait: לא עכשיו.
create or replace function public.whatsapp_template_cap_digest_kind(
  p_now timestamptz,
  p_last timestamptz,
  p_count int,
  p_reserved_used int
) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hours numeric;
  v_daily numeric;
  v_hard numeric;
  v_gap numeric;
  v_limit numeric;
begin
  if p_now is null or not public.whatsapp_template_cap_digest_open_at(p_now) then
    return 'wait';
  end if;
  v_daily := public.whatsapp_template_cap_limit('whatsapp_template_cap_daily', 1);
  v_hard := public.whatsapp_template_cap_limit('whatsapp_template_cap_hard_max', 2);
  v_gap := public.whatsapp_template_cap_limit('whatsapp_template_cap_gap_hours', 8);
  v_limit := public.whatsapp_template_cap_limit('whatsapp_template_cap_digest_reserved', 1);
  if p_last is not null then
    v_hours := extract(epoch from (p_now - p_last)) / 3600.0;
  end if;
  if public.whatsapp_template_cap_decide(
       coalesce(p_count, 0), v_hours, false, v_daily, v_hard, v_gap) then
    return 'normal';
  end if;
  if v_hours is not null
     and v_hours >= coalesce(v_gap, 8)
     and coalesce(p_reserved_used, 0) < greatest(coalesce(v_limit, 1), 0) then
    return 'reserved';
  end if;
  return 'wait';
end;
$$;

comment on function public.whatsapp_template_cap_digest_kind(timestamptz, timestamptz, int, int) is
  'איך תקציר יוצא עכשיו: normal בתוך הגג, reserved מעל הגג אחרי 8 שעות, או wait. לא חל על ליד, תזכורת או סיור.';

revoke all on function public.whatsapp_template_cap_digest_kind(timestamptz, timestamptz, int, int) from public, anon, authenticated;
grant execute on function public.whatsapp_template_cap_digest_kind(timestamptz, timestamptz, int, int) to service_role;

-- בחלון 24 השעות תמיד טקסט, בלי תבנית ובלי חריץ. none = לא שולחים עכשיו.
create or replace function public.whatsapp_template_cap_digest_channel(
  p_in_service_window boolean,
  p_kind text
) returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(p_in_service_window, false) then 'text'
    when p_kind in ('normal', 'reserved') then 'template'
    else 'none'
  end;
$$;

comment on function public.whatsapp_template_cap_digest_channel(boolean, text) is
  'ערוץ התקציר. חלון 24 שעות הוא טקסט חופשי ואינו נספר כתבנית. אחרת תבנית רק ל-normal או reserved.';

revoke all on function public.whatsapp_template_cap_digest_channel(boolean, text) from public, anon, authenticated;
grant execute on function public.whatsapp_template_cap_digest_channel(boolean, text) to service_role;

create or replace function public.whatsapp_template_cap_digest_reserved_used(
  p_agent uuid,
  p_except uuid
) returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
    from public.notification_push_log l
   where l.agent_id = p_agent
     and l.id is distinct from p_except
     and l.channel_mode = 'template'
     and l.whatsapp_status in ('sent', 'pending')
     and public.notification_push_log_holds(l.whatsapp_status, l.created_at)
     and 'template_cap_digest_reserved' = any(coalesce(l.types, '{}'::text[]))
     and l.created_at > now() - interval '2 days'
     and public.whatsapp_template_local_day(l.created_at)
         = public.whatsapp_template_local_day(now());
$$;

comment on function public.whatsapp_template_cap_digest_reserved_used(uuid, uuid) is
  'כמה חריצי תקציר שמורים כבר יצאו לסוכן/ת היום המקומי. טקסט חופשי אינו נספר.';

revoke all on function public.whatsapp_template_cap_digest_reserved_used(uuid, uuid) from public, anon, authenticated;
grant execute on function public.whatsapp_template_cap_digest_reserved_used(uuid, uuid) to service_role;

-- true רק אם זו שורת תקציר שנעצרה, המרווח 8 שעות מתקיים, והחריץ היומי פנוי.
create or replace function public.whatsapp_template_cap_digest_allow_reserved(
  p_agent uuid,
  p_log uuid
) returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_n int;
  v_last timestamptz;
  v_used int;
  v_ids uuid[];
  v_held boolean;
begin
  select l.notification_ids into v_ids
    from public.notification_push_log l
   where l.id = p_log
     and l.agent_id = p_agent;
  if v_ids is null or coalesce(array_length(v_ids, 1), 0) = 0 then
    return false;
  end if;
  select coalesce(bool_and(exists (
           select 1
             from public.notification_push_log h
            where h.agent_id = p_agent
              and h.id is distinct from p_log
              and nid = any(h.notification_ids)
              and h.whatsapp_status = 'skipped_template_cap'
              and h.created_at > now() - interval '72 hours'
         )), false)
    into v_held
    from unnest(v_ids) as nid;
  if not v_held then
    return false;
  end if;
  select u.n, u.last_at into v_n, v_last
    from public.whatsapp_template_cap_usage(p_agent, p_log) u;
  v_used := public.whatsapp_template_cap_digest_reserved_used(p_agent, p_log);
  return public.whatsapp_template_cap_digest_kind(now(), v_last, v_n, v_used) = 'reserved';
end;
$$;

comment on function public.whatsapp_template_cap_digest_allow_reserved(uuid, uuid) is
  'האם שורת היומן הזו היא התקציר השמור: כל פריט בה נעצר בתקרה, המרווח 8 שעות, והחריץ היומי עוד לא נוצל.';

revoke all on function public.whatsapp_template_cap_digest_allow_reserved(uuid, uuid) from public, anon, authenticated;
grant execute on function public.whatsapp_template_cap_digest_allow_reserved(uuid, uuid) to service_role;

create or replace function public.whatsapp_template_cap_allow(p_log_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent  uuid;
  v_mode   text;
  v_status text;
  v_error  text;
  v_types  text[];
  v_daily  numeric;
  v_hard   numeric;
  v_gap    numeric;
  v_count  int;
  v_last   timestamptz;
  v_hours  numeric;
  v_exempt boolean;
begin
  select l.agent_id, l.channel_mode, l.whatsapp_status, l.last_error, l.types
    into v_agent, v_mode, v_status, v_error, v_types
    from public.notification_push_log l
   where l.id = p_log_id;

  if not found then
    return false;
  end if;

  if v_status = 'skipped_template_cap'
     or v_error = 'skipped_template_cap' then
    return false;
  end if;

  -- טקסט בתוך החלון, או שורה שכבר נסגרה, לא נכנסים לתקרה.
  if v_status is distinct from 'pending' or v_mode is distinct from 'template' then
    return true;
  end if;

  if not public.whatsapp_template_cap_on() then
    return true;
  end if;

  v_exempt := coalesce(v_types, '{}'::text[])
              && public.whatsapp_template_cap_exempt_types();
  if v_exempt then
    return true;
  end if;

  -- חריץ שמור לתקציר בלבד. ליד, תזכורת וסיור כבר חזרו למעלה.
  if 'template_cap_digest_reserved' = any(coalesce(v_types, '{}'::text[]))
     and public.whatsapp_template_cap_digest_allow_reserved(v_agent, p_log_id) then
    return true;
  end if;

  select u.n, u.last_at
    into v_count, v_last
    from public.whatsapp_template_cap_usage(v_agent, p_log_id) u;

  if v_last is not null then
    v_hours := extract(epoch from (now() - v_last)) / 3600.0;
  end if;

  v_daily := public.whatsapp_template_cap_limit('whatsapp_template_cap_daily', 1);
  v_hard := public.whatsapp_template_cap_limit('whatsapp_template_cap_hard_max', 2);
  v_gap := public.whatsapp_template_cap_limit('whatsapp_template_cap_gap_hours', 8);

  if public.whatsapp_template_cap_decide(v_count, v_hours, false, v_daily, v_hard, v_gap) then
    return true;
  end if;

  -- הזמן נשאר created_at האמיתי. קוד הסיבה בסטטוס וב-last_error.
  -- delivery_at נשאר ריק: הוא הדיווח של Meta, וההודעה לא יצאה.
  -- הספירה מסננת לפי סטטוס, לא לפי הזזת השעון.
  update public.notification_push_log l
     set whatsapp_status = 'skipped_template_cap',
         last_error = 'skipped_template_cap'
   where l.id = p_log_id
     and l.whatsapp_status = 'pending';

  return false;
end;
$$;

comment on function public.whatsapp_template_cap_allow(uuid) is
  'האם שורת יומן תבנית מותרת לשליחה. כבוי: תמיד כן, חוץ משורה שכבר דולגה. דלוק: מעל התקרה מסמן skipped_template_cap בזמן האמיתי ולא שולח שוב. הפטור מ-app_config יוצא גם מעל הגג.';

revoke all on function public.whatsapp_template_cap_allow(uuid) from public, anon, authenticated;
grant execute on function public.whatsapp_template_cap_allow(uuid) to service_role;

create or replace function public.notification_push_claim(p_limit int default 20)
returns table (log_id uuid, agent_id uuid, display_name text, phone_e164 text,
               channel_mode text, items jsonb, item_count int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  a         record;
  v_items   jsonb;
  v_ids     uuid[];
  v_types   text[];
  v_log     uuid;
  v_mode    text;
  v_taken   int := 0;
  v_cap     int := least(greatest(coalesce(p_limit, 20), 1), 200);
  v_look    int := coalesce((select value::int from public.pricing_config
                              where key = 'notif_push_lookback_hours'), 12);
  v_look_p  int := coalesce((select value::int from public.pricing_config
                              where key = 'notif_push_priority_lookback_hours'), 72);
  v_prio    text[] := public.notification_push_priority_types();
  v_digest_on int := coalesce((select value::int from public.pricing_config
                                where key = 'notif_digest_enabled'), 0);
  v_digest  int := coalesce((select value::int from public.pricing_config
                              where key = 'notif_push_ambient_digest_minutes'), 180);
  v_wake    boolean;
  v_stale   int := greatest(1, coalesce((select value::int from public.pricing_config where key = 'notif_burst_stale_hours'), 12));
  v_urgent  int := greatest(v_stale, coalesce((select value::int from public.pricing_config where key = 'notif_burst_urgent_hours'), 72));
  v_max_items int := greatest(1, coalesce((select value::int from public.pricing_config where key = 'notif_burst_max_items'), 24));
  v_hour_cap int;
  v_day_cap int;
  v_sent_hour int;
  v_sent_day int;
  v_all_lead boolean;
  v_all_showing boolean;
  v_over boolean;
  v_digest_sent boolean;
  v_guard int;
  v_manual int;
  v_breaker int;
  v_pending_max int;
  v_pause boolean;
  v_ex_items jsonb;
  v_ex_ids uuid[];
  v_ex_types text[];
  v_gen_ids uuid[];
  v_gen_types text[];
  v_gen_n int;
  v_agent_hot boolean;
  v_too_many boolean;
  v_hold_general boolean;
  v_lane_over boolean;
  v_cap_ok boolean;
  v_cap_held boolean;
  v_digest_kind text;
begin
  perform public.notification_push_burst_prepare();

  select coalesce((select value::int from public.pricing_config where key = 'notification_burst_guard_enabled'), 0),
         coalesce((select value::int from public.pricing_config where key = 'notif_burst_manual_pause'), 0),
         coalesce((select value::int from public.pricing_config where key = 'notif_burst_breaker'), 0),
         greatest(1, coalesce((select value::int from public.pricing_config where key = 'notif_burst_agent_pending'), 30))
    into v_guard, v_manual, v_breaker, v_pending_max;
  v_pause := v_guard = 1 and (v_manual = 1 or v_breaker = 1);

  for a in select * from public.notification_push_due_agents() loop
    exit when v_taken >= v_cap;

    select jsonb_agg(s.item order by s.created_at desc),
           array_agg(s.id order by s.created_at desc),
           array_agg(distinct s.type),
           bool_or(s.wake_part),
           jsonb_agg(s.item order by s.created_at desc) filter (where s.exempt),
           array_agg(s.id order by s.created_at desc) filter (where s.exempt),
           array_agg(distinct s.type) filter (where s.exempt),
           array_agg(s.id order by s.created_at desc) filter (where not s.exempt),
           array_agg(distinct s.type) filter (where not s.exempt),
           (count(*) filter (where not s.exempt))::int
      into v_items, v_ids, v_types, v_wake,
           v_ex_items, v_ex_ids, v_ex_types,
           v_gen_ids, v_gen_types, v_gen_n
      from (
        select n.id, n.type, n.created_at,
               public.notification_push_burst_exempt(n.type, ld.source) as exempt,
               (not public.notification_push_is_ambient(n.type, n.agent_id, n.related_property_id)
                 or n.created_at <= now() - make_interval(mins => v_digest)) as wake_part,
               jsonb_build_object(
                 'type',        n.type,
                 'title',       n.title,
                 'body',        n.body,
                 'source',      ld.source,
                 'property_id', n.related_property_id,
                 'client_id',   coalesce(n.related_client_id,
                                         (select sc.client_id from public.client_showcases sc
                                           where sc.id = n.related_showcase_id)),
                 'lead_id',     n.related_lead_id,
                 'action_path', n.action_path,
                 'property_mine', (select p.agent_id = n.agent_id or p.referred_by is not distinct from n.agent_id
                                     from public.properties p where p.id = n.related_property_id),
                 'agenda_item_id', n.related_agenda_item_id,
                 'agreement_id',  n.related_agreement_id,
                 'meeting_id',    n.related_meeting_id,
                 'showcase_id',   n.related_showcase_id,
                 'review_id', (select rv.id from public.reviews rv
                                where rv.id = n.related_review_id and rv.status = 'pending'
                                  and rv.agent_id is distinct from n.agent_id),
                 'review_agent_slug', (select m.slug from public.reviews rv
                                         join public.agency_members m on m.id = rv.agent_id
                                        where rv.id = n.related_review_id and rv.status = 'published')
               ) as item
          from public.notifications n
          left join public.leads ld on ld.id = n.related_lead_id
         where n.agent_id = a.agent_id
           and not n.read
           and not n.suppress_push
           and n.type = any(a.whatsapp_types)
           and (n.created_at > now() - make_interval(hours =>
                  case
                    when n.type = any(v_prio) then least(v_look_p, v_urgent)
                    when v_digest_on = 1 and public.notification_push_less_kept(n.type) then least(v_look_p, v_urgent)
                    else least(v_look, v_stale)
                  end)
                or (v_digest_on = 0 and public.notification_push_quiet_hold(n.type, n.agent_id, n.created_at))
                or (
                  public.whatsapp_template_cap_on()
                  and v_digest_on = 1
                  and n.created_at > pg_catalog.now() - interval '72 hours'
                  and exists (
                    select 1 from public.notification_push_log lheld
                     where lheld.agent_id = n.agent_id
                       and n.id = any(lheld.notification_ids)
                       and lheld.whatsapp_status = 'skipped_template_cap'
                       and lheld.created_at > pg_catalog.now() - interval '72 hours'
                  )
                ))
           and not exists (
             select 1 from public.notification_push_log l
              where l.agent_id = n.agent_id
                and n.id = any(l.notification_ids)
                and public.notification_push_log_holds(l.whatsapp_status, l.created_at))
           and (
             not public.whatsapp_template_cap_on()
             or not exists (
               select 1 from public.notification_push_log lcap
                where lcap.agent_id = n.agent_id
                  and n.id = any(lcap.notification_ids)
                  and lcap.whatsapp_status = 'skipped_template_cap'
             )
             or (
               v_digest_on = 1
               and public.notif_il_digest_open(coalesce(
                     (select value::int from public.pricing_config
                       where key = 'notif_digest_window_minutes'), 15))
               and (
                 a.in_service_window
                 or public.whatsapp_template_cap_digest_kind(
                      pg_catalog.now(),
                      (select u.last_at from public.whatsapp_template_cap_usage(a.agent_id, null) u),
                      coalesce((select u.n from public.whatsapp_template_cap_usage(a.agent_id, null) u), 0),
                      public.whatsapp_template_cap_digest_reserved_used(a.agent_id, null)
                    ) in ('normal', 'reserved')
               )
             )
           )
           and not public.notification_push_stale_in_quiet(n.type, n.agent_id, n.created_at)
      ) s;

    continue when v_items is null or not v_wake;

    -- פריט שנעצר בתקרה יוצא רק בחלון תקציר (08:30, 13:00, 17:30).
    -- תבנית רק אם decide מרשה (גג 2, מרווח 8 שעות, הפטור יוצא תמיד ונחשב).
    -- תקרה מלאה ובחלון 24 השעות: טקסט חופשי. בלי חלון: נשאר בפעמון
    -- עד התקציר הראשון של היום הבא. לא פרץ וואטסאפ ולא תבנית שלישית.
    v_cap_held := public.whatsapp_template_cap_on()
      and v_digest_on = 1
      and coalesce(array_length(v_ids, 1), 0) > 0
      and not exists (
        select 1 from unnest(v_ids) as held(id)
         where not exists (
           select 1 from public.notification_push_log lheld
            where lheld.agent_id = a.agent_id
              and held.id = any(lheld.notification_ids)
              and lheld.whatsapp_status = 'skipped_template_cap'
              and lheld.created_at > pg_catalog.now() - interval '72 hours'
         )
      );

    -- המפסק והמפסק הידני נבדקים תמיד. פריט תקרה מדלג רק על תקרת השעה, היום ומספר הפריטים.
    if v_guard = 1 then
      if v_pause then
        if coalesce(array_length(v_ex_ids, 1), 0) = 0 then
          continue;
        end if;
        v_items := v_ex_items;
        v_ids := v_ex_ids;
        v_types := v_ex_types;
      elsif not v_cap_held then
      v_hour_cap := greatest(1, coalesce((select value::int from public.pricing_config where key = 'notif_burst_hour_cap'), 12));
      v_day_cap := greatest(1, coalesce((select value::int from public.pricing_config where key = 'notif_burst_day_cap'), 30));

      select count(*) filter (where l.created_at > now() - interval '1 hour'),
             count(*) filter (where l.created_at > now() - interval '1 day')
        into v_sent_hour, v_sent_day
        from public.notification_push_log l
       where l.agent_id = a.agent_id
         and l.whatsapp_status = 'sent';

      v_over := v_sent_hour >= v_hour_cap or v_sent_day >= v_day_cap;
      v_digest_sent := exists (
        select 1 from public.notification_push_log l
         where l.agent_id = a.agent_id
           and l.created_at > now() - interval '1 hour'
           and l.whatsapp_status in ('sent', 'pending')
           and 'burst_digest' = any(l.types));
      v_agent_hot := coalesce(v_gen_n, 0) > v_pending_max;
      v_too_many := coalesce(v_gen_n, 0) > v_max_items;
      v_hold_general := v_agent_hot or v_over or v_too_many;

      v_all_lead := coalesce(array_length(v_ex_ids, 1), 0) > 0
        and coalesce(v_gen_n, 0) = 0
        and not exists (select 1 from unnest(v_ex_types) t where t is distinct from 'new_lead');
      v_all_showing := coalesce(array_length(v_ex_ids, 1), 0) > 0
        and coalesce(v_gen_n, 0) = 0
        and not exists (select 1 from unnest(v_ex_types) t where t is distinct from 'showcase_meeting');
      v_lane_over := false;
      if v_all_lead then
        v_lane_over := v_sent_hour >= greatest(1, coalesce((select value::int from public.pricing_config where key = 'notif_burst_lead_hour_cap'), 20))
          or v_sent_day >= greatest(1, coalesce((select value::int from public.pricing_config where key = 'notif_burst_lead_day_cap'), 40));
      elsif v_all_showing then
        v_lane_over := v_sent_hour >= greatest(1, coalesce((select value::int from public.pricing_config where key = 'notif_burst_showing_hour_cap'), 20))
          or v_sent_day >= greatest(1, coalesce((select value::int from public.pricing_config where key = 'notif_burst_showing_day_cap'), 40));
      end if;

      if v_lane_over then
        -- תקרת המסלול של ליד או סיור: נדחה, לא תקציר ולא skipped.
        continue;
      elsif v_hold_general and coalesce(array_length(v_ex_ids, 1), 0) > 0 then
        -- ערבוב: המוגן יוצא עכשיו בפרטים. השאר מחכה לתקציר, בלי להירשם.
        v_items := v_ex_items;
        v_ids := v_ex_ids;
        v_types := v_ex_types;
      elsif v_hold_general and v_digest_sent then
        -- overflow_defer: מחכה לתקציר הבא. לא skipped.
        continue;
      elsif v_hold_general then
        v_items := jsonb_build_array(jsonb_build_object(
          'type', 'burst_digest',
          'title', 'יש לך ' || coalesce(v_gen_n, 0) || ' התראות חדשות באתר',
          'body', null,
          'count', coalesce(v_gen_n, 0)));
        v_ids := v_gen_ids;
        v_types := coalesce(v_gen_types, '{}') || array['burst_digest'];
      end if;
      end if;
    end if;

    v_digest_kind := 'wait';
    if v_cap_held and public.whatsapp_template_cap_on() then
      select public.whatsapp_template_cap_digest_kind(
               pg_catalog.now(), u.last_at, u.n,
               public.whatsapp_template_cap_digest_reserved_used(a.agent_id, null))
        into v_digest_kind
        from public.whatsapp_template_cap_usage(a.agent_id, null) u;
      v_mode := public.whatsapp_template_cap_digest_channel(a.in_service_window, v_digest_kind);
      if v_mode = 'none' then
        continue;
      end if;
      if v_digest_kind = 'reserved' and v_mode = 'template' then
        v_types := coalesce(v_types, '{}'::text[]) || array['template_cap_digest_reserved']::text[];
      end if;
    else
      v_mode := case when a.in_service_window then 'text' else 'template' end;
    end if;

    insert into public.notification_push_log
      (agent_id, notification_ids, types, channel_mode, whatsapp_status)
    values (a.agent_id, v_ids, v_types, v_mode, 'pending')
    returning id into v_log;

    -- תקרת התבניות, פעם אחת לסוכן/ת בסבב. כבויה: כל שורה עוברת.
    v_cap_ok := true;
    if v_mode = 'template' then
      begin
        v_cap_ok := public.whatsapp_template_cap_allow(v_log);
      exception when others then
        v_cap_ok := true;
        raise warning 'whatsapp template cap: %', sqlerrm;
      end;
    end if;
    if not v_cap_ok then
      continue;
    end if;

    v_taken := v_taken + 1;

    return query select v_log, a.agent_id, a.display_name, a.phone_e164,
                        v_mode, v_items, jsonb_array_length(v_items);
  end loop;
end;
$$;

comment on function public.notification_push_claim(int) is
  'גוף 20271030000200. תקציר יומי אחד מעל הגג, רק כשהתקרה דלוקה, עם מרווח 8 שעות. כבויה: אין דילוג.';

revoke all on function public.notification_push_claim(int) from public, anon, authenticated;
grant execute on function public.notification_push_claim(int) to service_role;

create or replace function public.notification_push_has_backlog(p_exempt_only boolean default false)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.notification_push_due_agents() a
     where exists (
       select 1
         from public.notifications n
         left join public.leads ld on ld.id = n.related_lead_id
        where n.agent_id = a.agent_id
          and not n.read
          and not n.suppress_push
          and n.type = any(a.whatsapp_types)
          and (not coalesce(p_exempt_only, false)
               or public.notification_push_burst_exempt(n.type, ld.source))
          and (
            (
              coalesce(n.push_deferred_at, n.created_at) > now() - make_interval(hours =>
                  case when n.type = any(public.notification_push_priority_types())
                       then coalesce((select value::int from public.pricing_config
                                       where key = 'notif_push_priority_lookback_hours'), 72)
                       else coalesce((select value::int from public.pricing_config
                                       where key = 'notif_push_lookback_hours'), 12)
                  end)
              and not (
                public.whatsapp_template_cap_on()
                and exists (
                  select 1 from public.notification_push_log lheld
                   where lheld.agent_id = n.agent_id
                     and n.id = any(lheld.notification_ids)
                     and lheld.whatsapp_status = 'skipped_template_cap'
                     and lheld.created_at > pg_catalog.now() - interval '72 hours'
                )
              )
            )
            or (
              public.whatsapp_template_cap_on()
              and public.notif_il_digest_open(coalesce(
                    (select value::int from public.pricing_config
                      where key = 'notif_digest_window_minutes'), 15))
              and n.created_at > pg_catalog.now() - interval '72 hours'
              and exists (
                select 1 from public.notification_push_log lheld
                 where lheld.agent_id = n.agent_id
                   and n.id = any(lheld.notification_ids)
                   and lheld.whatsapp_status = 'skipped_template_cap'
                   and lheld.created_at > pg_catalog.now() - interval '72 hours'
              )
              and (
                a.in_service_window
                or public.whatsapp_template_cap_digest_kind(
                     pg_catalog.now(),
                     (select u.last_at from public.whatsapp_template_cap_usage(a.agent_id, null) u),
                     coalesce((select u.n from public.whatsapp_template_cap_usage(a.agent_id, null) u), 0),
                     public.whatsapp_template_cap_digest_reserved_used(a.agent_id, null)
                   ) in ('normal', 'reserved')
              )
            )
          )
          and not exists (
            select 1 from public.notification_push_log l
             where l.agent_id = n.agent_id
               and n.id = any(l.notification_ids)
               and public.notification_push_log_holds(l.whatsapp_status, l.created_at))
          and not public.notification_push_stale_in_quiet(n.type, n.agent_id, n.created_at)
          and (not public.notification_push_is_ambient(n.type, n.agent_id, n.related_property_id)
               or n.created_at <= now() - make_interval(mins =>
                    coalesce((select value::int from public.pricing_config
                               where key = 'notif_push_ambient_digest_minutes'), 180)))
     )
  );
$$;


comment on function public.notification_push_has_backlog(boolean) is
  'פריט תקרה מעיר את הקרון בחלון תקציר רק אם מותרת תבנית: חריץ רגיל, או החריץ השמור אחרי 8 שעות, או טקסט בחלון 24 השעות.';

revoke all on function public.notification_push_has_backlog(boolean) from public, anon, authenticated;
grant execute on function public.notification_push_has_backlog(boolean) to service_role;

