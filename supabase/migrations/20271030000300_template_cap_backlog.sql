-- הקרון של 5 הדקות לא מתעורר על פריט שכבר נעצר בתקרת התבניות היום,
-- אלא אם התקציר היומי באמת יכול לצאת (טקסט בחלון 24 השעות, או תבנית שעוד מותרת).

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
          and coalesce(n.push_deferred_at, n.created_at) > now() - make_interval(hours =>
                case when n.type = any(public.notification_push_priority_types())
                     then coalesce((select value::int from public.pricing_config
                                     where key = 'notif_push_priority_lookback_hours'), 72)
                     else coalesce((select value::int from public.pricing_config
                                     where key = 'notif_push_lookback_hours'), 12)
                end)
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
                 and public.whatsapp_template_local_day(lcap.created_at)
                     = public.whatsapp_template_local_day(pg_catalog.now())
            )
            or (
              coalesce((select value::int from public.pricing_config
                         where key = 'notif_digest_enabled'), 0) = 1
              and public.notif_il_digest_open(coalesce(
                    (select value::int from public.pricing_config
                      where key = 'notif_digest_window_minutes'), 15))
              and (
                a.in_service_window
                or coalesce((
                  select public.whatsapp_template_cap_decide(
                           u.n,
                           case when u.last_at is null then null
                                else extract(epoch from (pg_catalog.now() - u.last_at)) / 3600.0 end,
                           false,
                           public.whatsapp_template_cap_limit('whatsapp_template_cap_daily', 1)::int,
                           public.whatsapp_template_cap_limit('whatsapp_template_cap_hard_max', 2)::int,
                           public.whatsapp_template_cap_limit('whatsapp_template_cap_gap_hours', 8))
                    from public.whatsapp_template_cap_usage(a.agent_id, null) u
                ), false)
              )
            )
          )
          and not public.notification_push_stale_in_quiet(n.type, n.agent_id, n.created_at)
          and (not public.notification_push_is_ambient(n.type, n.agent_id, n.related_property_id)
               or n.created_at <= now() - make_interval(mins =>
                    coalesce((select value::int from public.pricing_config
                               where key = 'notif_push_ambient_digest_minutes'), 180)))
     )
  );
$$;


comment on function public.notification_push_has_backlog(boolean) is
  'כמו 20271029140000. פריט שנעצר היום ב-skipped_template_cap לא מעיר את הקרון, אלא אם התקציר יכול לצאת בלי לעקוף את תקרת התבניות.';

revoke all on function public.notification_push_has_backlog(boolean) from public, anon, authenticated;
grant execute on function public.notification_push_has_backlog(boolean) to service_role;
