-- supabase/migrations/20271031300000_notif_cadence_type_wins.sql
-- לפני שמפעילים notif_cadence_button_enabled:
-- מתג סוג גובר על כיבוי קבוצה. ה-claim מדלג על skipped_template_cap
-- רק כשתקרת התבניות כבויה, כמו notification_push_has_backlog.

-- כיבוי של סוג אחד. מפתח קבוצה אינו מפתח סוג: open_demand בשדה הקצב
-- הוא הקבוצה, והסוג נכבה רק דרך whatsapp_off_types. סוג שלא מופה
-- נכבה כשהקבוצה שלו off.
create or replace function public.notif_cadence_type_off(p_agent uuid, p_type text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.agent_notification_preferences p
     where p.agent_id = p_agent
       and (
         p_type = any(coalesce(p.whatsapp_off_types, '{}'::text[]))
         -- מפתח סוג, לא מפתח קבוצה. open_demand הוא גם וגם, והמפתח
         -- whatsapp_cadence->open_demand הוא הקבוצה.
         or (
           coalesce(p.whatsapp_cadence ->> p_type, '') = 'off'
           and p_type is distinct from public.notif_cadence_group(p_type)
         )
         -- סוג שלא מופה נופל לכיבוי הקבוצה. ממופה נשען על whatsapp_off_types,
         -- כדי שמתג סוג דלוק יגבר.
         or (
           coalesce(p.whatsapp_cadence ->> public.notif_cadence_group(p_type), '') = 'off'
           and not exists (
             select 1 from public.notif_cadence_group_map g
              where g.notif_type = p_type
           )
         )
       )
  );
$$;

comment on function public.notif_cadence_type_off(uuid, text) is
  'כיבוי של סוג: whatsapp_off_types, או מפתח סוג שאינו מפתח הקבוצה. סוג לא ממופה נכבה עם הקבוצה. מתג של סוג ממופה גובר על מפתח הקבוצה.';

revoke all on function public.notif_cadence_type_off(uuid, text) from public, anon, authenticated;
grant execute on function public.notif_cadence_type_off(uuid, text) to service_role;

create or replace function public.agent_type_cadence(p_agent uuid, p_type text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    -- מזהה קבוצה שאינו גם סוג התראה. open_demand הוא סוג במפה, ולכן
    -- נופל למסלול הסוג ולא נקרא ככיבוי הקבוצה רק בגלל השם.
    when p_type in ('new_leads', 'meetings', 'open_demand', 'matches', 'system_mentor')
      and not exists (
        select 1 from public.notif_cadence_group_map g where g.notif_type = p_type
      )
    then case
      when p_type = 'meetings' then 'each'
      when p_type = 'system_mentor' then case
        when public.notif_cadence_type_off(p_agent, p_type) then 'off'
        else coalesce((
          select case when mode in ('digest', 'off') then mode else 'digest' end
            from (
              select nullif(p.whatsapp_cadence ->> 'system_mentor', '') as mode
                from public.agent_notification_preferences p
               where p.agent_id = p_agent
            ) s
        ), 'digest')
      end
      else coalesce((
        select case when mode in ('each', 'daily', 'thrice', 'off') then mode else 'each' end
          from (
            select nullif(p.whatsapp_cadence ->> p_type, '') as mode
              from public.agent_notification_preferences p
             where p.agent_id = p_agent
          ) s
      ), 'each')
    end
    when public.notif_cadence_group(p_type) is null then 'each'
    when public.notif_cadence_group(p_type) = 'meetings' then 'each'
    when public.notif_cadence_group(p_type) = 'system_mentor' then case
      when public.notif_cadence_type_off(p_agent, p_type) then 'off'
      else coalesce((
        select case
          when mode in ('digest', 'off') then mode
          else 'digest'
        end
        from (
          select nullif(p.whatsapp_cadence ->> 'system_mentor', '') as mode
            from public.agent_notification_preferences p
           where p.agent_id = p_agent
        ) s
      ), 'digest')
    end
    else coalesce((
      select case
        when p_type = any(coalesce(p.whatsapp_off_types, '{}'::text[])) then 'off'
        when p_type is distinct from public.notif_cadence_group(p_type)
          and coalesce(p.whatsapp_cadence ->> p_type, '') = 'off' then 'off'
        when p_type is distinct from public.notif_cadence_group(p_type)
          and coalesce(p.whatsapp_cadence ->> p_type, '') in ('each', 'daily', 'thrice')
          then p.whatsapp_cadence ->> p_type
        when coalesce(p.whatsapp_cadence ->> public.notif_cadence_group(p_type), '')
             in ('each', 'daily', 'thrice')
          then p.whatsapp_cadence ->> public.notif_cadence_group(p_type)
        else 'each'
      end
      from public.agent_notification_preferences p
      where p.agent_id = p_agent
    ), 'each')
  end;
$$;

comment on function public.agent_type_cadence(uuid, text) is
  'קצב אפקטיבי. מתג סוג כבוי גובר. קבוצה כבויה לא מכבה סוג שאינו ב-whatsapp_off_types: הוא each, או digest במערכת ומנטור.';

revoke all on function public.agent_type_cadence(uuid, text) from public, anon, authenticated;
grant execute on function public.agent_type_cadence(uuid, text) to service_role;


create or replace function public.lead_wa_digest_claim()
returns table (
  agent_id uuid,
  phone_e164 text,
  display_name text,
  in_window boolean,
  slot_dow int,
  slot_hour int,
  slot_key text,
  notif_type text,
  outside_mode text,
  cap_allows boolean,
  digest_ordinal int,
  allow_template boolean,
  leads jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_daily int := public.notif_lead_digest_daily_hour();
  v_hours int[] := public.notif_lead_digest_hours();
  v_window int := coalesce(
    (select case when c.value ~ '^[0-9]+$' then c.value::int end
       from public.app_config c where c.key = 'notif_lead_digest_window_minutes'),
    15);
  r record;
  v_slot text;
  v_mode text;
  v_leads jsonb;
  v_in boolean;
begin
  if not public.notif_cadence_button_on() then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtext('lead_wa_digest'));
  delete from public.notif_cadence_digest d
   where d.outcome = 'pending'
     and d.created_at < now() - interval '10 minutes';

  for r in
    select m.id, m.display_name,
           nullif(btrim(coalesce(m.phone_e164, '')), '') as phone,
           e.notif_type,
           e.cadence,
           e.since
      from public.agency_members m
      left join public.agent_notification_preferences p on p.agent_id = m.id
      -- ברירת המחדל חלה גם בלי מפתח ב-whatsapp_cadence. system_mentor הוא digest
      -- גם למי שלא בחר/ה. new_leads / open_demand / matches הם each, ולכן לא נכנסים
      -- לסיכום עד בחירה של daily או thrice.
      cross join lateral (
        select g.grp as notif_type,
               coalesce(nullif(p.whatsapp_cadence ->> g.grp, ''), g.fallback) as cadence,
               public.notif_cadence_ts(p.whatsapp_cadence_since ->> g.grp) as since
          from (values
            ('new_leads'::text, 'each'::text),
            ('open_demand', 'each'),
            ('matches', 'each'),
            ('system_mentor', 'digest')
          ) as g(grp, fallback)
      ) e
     where m.active
       and m.closed_at is null
       and m.tier in ('mid', 'premium')
       and m.billing_status = 'active'
       and m.closure_requested_at is null
       and (
         (e.notif_type in ('new_leads', 'open_demand', 'matches') and e.cadence in ('daily', 'thrice'))
         or (e.notif_type = 'system_mentor' and e.cadence in ('digest', 'off'))
       )
  loop
    if r.phone is null then
      continue;
    end if;
    v_slot := public.lead_wa_digest_slot(
      now(), case when r.cadence in ('digest', 'off') then 'daily' else r.cadence end,
      v_daily, v_hours, v_window);
    if v_slot is null then
      continue;
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', n.id,
             'lead_id', n.related_lead_id,
             'title', left(coalesce(n.title, 'ליד חדש'), 80)
           ) order by n.created_at desc), '[]'::jsonb)
      into v_leads
      from (
        select n.id, n.related_lead_id, n.title, n.created_at
          from public.notifications n
         where n.agent_id = r.id
           and public.notif_cadence_group(n.type) = r.notif_type
           and not n.read
           and not n.suppress_push
           and n.created_at > pg_catalog.now() - interval '7 days'
           and not public.notif_cadence_type_off(r.id, n.type)
           and (r.since is null or n.created_at >= r.since)
           and not exists (
             select 1 from public.notification_push_log l
              where l.agent_id = n.agent_id
                and n.id = any(l.notification_ids)
                and l.whatsapp_status in ('sent', 'pending')
           )
         order by n.created_at desc
         limit 10
      ) n;
    if coalesce(jsonb_array_length(v_leads), 0) = 0 then
      continue;
    end if;
    begin
      insert into public.notif_cadence_digest (agent_id, slot_key, outcome)
      values (r.id, split_part(v_slot, '|', 3) || ':' || r.notif_type, 'pending');
    exception when unique_violation then
      continue;
    end;
    v_in := coalesce(
      (select c.last_message_at > now() - interval '23 hours'
         from public.whatsapp_conversations c
        where c.agent_id = r.id),
      false);
    agent_id := r.id;
    phone_e164 := r.phone;
    display_name := r.display_name;
    in_window := v_in;
    slot_dow := split_part(v_slot, '|', 1)::int;
    slot_hour := split_part(v_slot, '|', 2)::int;
    slot_key := split_part(v_slot, '|', 3) || ':' || r.notif_type;
    notif_type := r.notif_type;
    outside_mode := public.notif_lead_digest_outside();
    cap_allows := public.lead_wa_digest_cap_allows(r.id);
    allow_template := r.notif_type is distinct from 'system_mentor';
    select count(*)::int into digest_ordinal
      from public.notif_cadence_digest d
     where d.agent_id = r.id
       and d.slot_key like to_char(now() at time zone 'Asia/Jerusalem', 'YYYY-MM-DD') || '%'
       and split_part(d.slot_key, ':', 2) = r.notif_type
       and d.outcome in ('pending', 'sent', 'bell');
    leads := v_leads;
    return next;
  end loop;
end;
$$;

comment on function public.lead_wa_digest_claim() is
  'סוכנים שמשבצת הסיכום שלהם פתוחה עכשיו. מערכת ומנטור כבויה עדיין מוציאה סוג שהמתג שלו דלוק, במשבצת היומית. דגל כבוי: אפס שורות.';

revoke all on function public.lead_wa_digest_claim() from public, anon, authenticated;
grant execute on function public.lead_wa_digest_claim() to service_role;


create or replace function public.notif_cadence_apply(
  p_agent uuid,
  p_type text,
  p_event text,
  p_choice text
) returns table (
  enabled boolean,
  changed boolean,
  needs_confirm boolean,
  expired boolean,
  choice text,
  notif_type text,
  cadences jsonb,
  off_types text[],
  daily_hour int,
  hours int[]
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_on boolean := public.notif_cadence_button_on();
  v_old text;
  v_choice text;
  v_type text;
  v_exp timestamptz;
  v_event text;
  v_map jsonb;
  v_off text[];
  v_role text;
  v_raw text;
begin
  -- PostgREST כותב את התפקיד בתוך request.jwt.claims.
  -- תפקיד חסר אינו service_role.
  v_role := '';
  begin
    v_raw := nullif(current_setting('request.jwt.claims', true), '');
    if v_raw is not null then
      v_role := coalesce(v_raw::jsonb ->> 'role', '');
    end if;
  exception when others then
    v_role := '';
  end;
  if v_role = '' then
    begin
      v_role := coalesce(auth.role(), '');
    exception when others then
      v_role := '';
    end;
  end if;
  if v_role is distinct from 'service_role'
     and p_agent is distinct from public.current_agent_id() then
    enabled := false;
    changed := false;
    needs_confirm := false;
    expired := false;
    return next;
    return;
  end if;
  if not exists (
    select 1 from public.agency_members m
     where m.id = p_agent
       and m.active
       and m.closed_at is null
       and m.closure_requested_at is null
       and m.tier in ('mid', 'premium')
       and m.billing_status = 'active'
  ) then
    enabled := false;
    changed := false;
    needs_confirm := false;
    expired := false;
    return next;
    return;
  end if;
  v_type := nullif(btrim(coalesce(p_type, '')), '');
  if v_type is not null and v_type not in (
    'new_leads', 'meetings', 'open_demand', 'matches', 'system_mentor'
  ) then
    v_type := public.notif_cadence_group(v_type);
  end if;
  v_choice := case
    when p_choice in ('each', 'daily', 'thrice', 'off', 'digest') then p_choice
    else null
  end;
  if v_type = 'system_mentor' and v_choice in ('each', 'daily', 'thrice') then
    v_choice := 'digest';
  end if;
  if v_type = 'meetings' then
    v_choice := null;
  end if;
  if v_type in ('new_leads', 'open_demand', 'matches') and v_choice = 'digest' then
    v_choice := 'each';
  end if;
  v_event := case p_event
    when 'choose' then 'choose'
    when 'ask' then 'ask'
    when 'back' then 'back'
    else 'open'
  end;
  insert into public.notif_cadence_log (agent_id, notif_type, event, choice)
  values (p_agent, v_type, v_event, v_choice);

  select coalesce(p.whatsapp_cadence, '{}'::jsonb),
         coalesce(p.whatsapp_off_types, '{}'::text[])
    into v_map, v_off
    from public.agent_notification_preferences p
   where p.agent_id = p_agent;
  v_map := coalesce(v_map, '{}'::jsonb);
  v_off := coalesce(v_off, '{}'::text[]);

  enabled := v_on;
  daily_hour := public.notif_lead_digest_daily_hour();
  hours := public.notif_lead_digest_hours();
  notif_type := v_type;
  cadences := v_map;
  off_types := v_off;
  choice := case when v_type is null then null else public.agent_type_cadence(p_agent, v_type) end;
  changed := false;
  needs_confirm := false;
  expired := false;

  if not v_on or v_type is null then
    return next;
    return;
  end if;

  if p_event = 'back' then
    delete from public.notif_cadence_pending d
     where d.agent_id = p_agent and d.notif_type = v_type;
    return next;
    return;
  end if;

  if v_type = 'meetings' then
    choice := 'each';
    return next;
    return;
  end if;

  if p_event = 'ask' and v_choice = 'off' and v_type in ('new_leads', 'open_demand', 'matches', 'system_mentor') then
    insert into public.notif_cadence_pending (agent_id, notif_type, expires_at)
    values (p_agent, v_type, now() + interval '30 minutes')
    on conflict (agent_id, notif_type) do update
      set expires_at = excluded.expires_at;
    needs_confirm := true;
    choice := 'off';
    return next;
    return;
  end if;

  if p_event = 'choose' and v_choice = 'off' and v_type in ('new_leads', 'open_demand', 'matches', 'system_mentor') then
    select d.expires_at into v_exp
      from public.notif_cadence_pending d
     where d.agent_id = p_agent and d.notif_type = v_type;
    if v_exp is null or v_exp < now() then
      delete from public.notif_cadence_pending d
       where d.agent_id = p_agent and d.notif_type = v_type;
      expired := true;
      choice := public.agent_type_cadence(p_agent, v_type);
      return next;
      return;
    end if;
    delete from public.notif_cadence_pending d
     where d.agent_id = p_agent and d.notif_type = v_type;
  elsif p_event is distinct from 'choose' or v_choice is null then
    return next;
    return;
  end if;

  v_old := public.agent_type_cadence(p_agent, v_type);
  if v_old is not distinct from v_choice then
    choice := v_choice;
    return next;
    return;
  end if;

  insert into public.agent_notification_preferences (agent_id, whatsapp_cadence, whatsapp_cadence_since, whatsapp_off_types)
  values (
    p_agent,
    jsonb_build_object(v_type, v_choice),
    jsonb_build_object(v_type, now()),
    case
      when v_choice = 'off' and v_type in ('new_leads', 'open_demand', 'matches', 'system_mentor') then coalesce((
        select array_agg(g.notif_type)
          from public.notif_cadence_group_map g
         where g.cadence_group = v_type
      ), '{}'::text[])
      when v_choice = 'off' then array[v_type]
      else '{}'::text[]
    end
  )
  on conflict (agent_id) do update
    set whatsapp_cadence = public.agent_notification_preferences.whatsapp_cadence || jsonb_build_object(v_type, v_choice),
        whatsapp_cadence_since = public.agent_notification_preferences.whatsapp_cadence_since || jsonb_build_object(v_type, now()),
        whatsapp_off_types = case
          when v_choice = 'off' and v_type in ('new_leads', 'open_demand', 'matches', 'system_mentor') then (
            select coalesce(array_agg(distinct t), '{}'::text[])
              from unnest(
                coalesce(public.agent_notification_preferences.whatsapp_off_types, '{}'::text[])
                || coalesce((
                  select array_agg(g.notif_type)
                    from public.notif_cadence_group_map g
                   where g.cadence_group = v_type
                ), '{}'::text[])
              ) t
          )
          when v_type in ('new_leads', 'open_demand', 'matches', 'system_mentor') then (
            select coalesce(array_agg(t), '{}'::text[])
              from unnest(coalesce(public.agent_notification_preferences.whatsapp_off_types, '{}'::text[])) t
             where t not in (
               select g.notif_type from public.notif_cadence_group_map g where g.cadence_group = v_type
             )
          )
          else public.agent_notification_preferences.whatsapp_off_types
        end,
        updated_at = now();
  changed := true;
  choice := v_choice;
  select q.whatsapp_cadence, coalesce(q.whatsapp_off_types, '{}'::text[])
    into cadences, off_types
    from public.agent_notification_preferences q
   where q.agent_id = p_agent;
  return next;
end;
$$;

comment on function public.notif_cadence_apply(uuid, text, text, text) is
  'קצב לפי סוג. ללא נשמר רק אחרי אישור בתוך 30 דקות. בחירה זהה לא מזיזה את since ולא כותבת התראה. off נכנס גם ל-whatsapp_off_types.';

revoke all on function public.notif_cadence_apply(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.notif_cadence_apply(uuid, text, text, text) to authenticated, service_role;


-- הפונקציות המשותפות: הגוף של 20271031260000 (#1058), וה-claim עם סינון הקצב.
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
                 'id',          n.id,
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
           and public.notification_push_lead_wa_sendable(n.agent_id, n.type, n.created_at)
           and not (
             public.notif_cadence_button_on()
             and not public.whatsapp_template_cap_on()
             and exists (
               select 1 from public.notification_push_log lcap
                where lcap.agent_id = n.agent_id
                  and n.id = any(lcap.notification_ids)
                  and lcap.whatsapp_status = 'skipped_template_cap'
                  and public.whatsapp_template_local_day(lcap.created_at)
                      = public.whatsapp_template_local_day(pg_catalog.now())
             )
             and not public.lead_wa_digest_cap_allows(n.agent_id, null)
           )
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
  'גוף 20271031290000. דילוג הקצב על skipped_template_cap תלוי גם ב-whatsapp_template_cap_on, כמו has_backlog. החריץ השמור נשמר.';

revoke all on function public.notification_push_claim(int) from public, anon, authenticated;
grant execute on function public.notification_push_claim(int) to service_role;

