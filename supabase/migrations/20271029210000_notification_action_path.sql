-- נתיב יחסי על ההתראה, וסיכום לידים לרשימה ולא לליד אחד.
-- action_path מתחיל ב-/ ואינו כתובת מלאה. חסר עד שהפונקציה הזו רצה:
-- ה-claim הישן פשוט לא מחזיר את השדה.

alter table public.notifications
  add column if not exists action_path text;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'notifications_action_path_chk'
  ) then
    alter table public.notifications
      add constraint notifications_action_path_chk
      check (
        action_path is null
        or (
          char_length(action_path) between 2 and 180
          and action_path ~ '^/[^/[:space:]]'
          and action_path !~ '://'
          and action_path !~ '[[:space:]]'
        )
      );
  end if;
end $$;

comment on column public.notifications.action_path is
  'נתיב יחסי שגובר על המיפוי לפי סוג. מתחיל ב-/ . בלי סכמה ובלי //. ריק = המיפוי הקיים.';

select public.notification_types_add(array['leads_digest']);

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
begin
  perform public.notification_push_burst_prepare();

  select coalesce((select value::int from public.pricing_config where key = 'notification_burst_guard_enabled'), 1),
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
                or (v_digest_on = 0 and public.notification_push_quiet_hold(n.type, n.agent_id, n.created_at)))
           and not exists (
             select 1 from public.notification_push_log l
              where l.agent_id = n.agent_id
                and n.id = any(l.notification_ids)
                and public.notification_push_log_holds(l.whatsapp_status, l.created_at))
           and not public.notification_push_stale_in_quiet(n.type, n.agent_id, n.created_at)
      ) s;

    continue when v_items is null or not v_wake;

    -- מתג כבוי: אותה הודעה כמו בלי תקרת ההתפרצות. ישן ומילוי כבר סוננו בהכנה.
    if v_guard = 1 then
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

      -- מפסק: ליד אמיתי ומוגן יוצאים בפרטים. בלי מוגן אין שליחה, ואין skipped.
      if v_pause then
        if coalesce(array_length(v_ex_ids, 1), 0) = 0 then
          continue;
        end if;
        v_items := v_ex_items;
        v_ids := v_ex_ids;
        v_types := v_ex_types;
      elsif v_lane_over then
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

    v_mode := case when a.in_service_window then 'text' else 'template' end;

    insert into public.notification_push_log
      (agent_id, notification_ids, types, channel_mode, whatsapp_status)
    values (a.agent_id, v_ids, v_types, v_mode, 'pending')
    returning id into v_log;

    v_taken := v_taken + 1;

    return query select v_log, a.agent_id, a.display_name, a.phone_e164,
                        v_mode, v_items, jsonb_array_length(v_items);
  end loop;
end;
$$;

comment on function public.notification_push_claim(int) is
  'כמו 20271029140000, ומוסיף action_path ו-showcase_id לכל פריט. השדות ריקים עד שמי שכותב התראה ממלא אותם.';

revoke all on function public.notification_push_claim(int) from public, anon, authenticated;
grant execute on function public.notification_push_claim(int) to service_role;

