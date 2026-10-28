-- פריט שנעצר בתקרת התבניות נשאר בחלון של 72 שעות, כמו ב-claim.
-- בלי תנאי "נעצר היום": עצירה ב-18:00 מעירה את הקרון לקראת תקציר 08:30.

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
            coalesce(n.push_deferred_at, n.created_at) > now() - make_interval(hours =>
                case when n.type = any(public.notification_push_priority_types())
                     then coalesce((select value::int from public.pricing_config
                                     where key = 'notif_push_priority_lookback_hours'), 72)
                     else coalesce((select value::int from public.pricing_config
                                     where key = 'notif_push_lookback_hours'), 12)
                end)
            or (
              public.whatsapp_template_cap_on()
              and n.created_at > pg_catalog.now() - interval '72 hours'
              and exists (
                select 1 from public.notification_push_log lheld
                 where lheld.agent_id = n.agent_id
                   and n.id = any(lheld.notification_ids)
                   and lheld.whatsapp_status = 'skipped_template_cap'
                   and lheld.created_at > pg_catalog.now() - interval '72 hours'
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
  'כמו 20271029140000. פריט skipped_template_cap בתוך 72 שעות מעיר את הקרון, גם אם נעצר אתמול ב-18:00.';

revoke all on function public.notification_push_has_backlog(boolean) from public, anon, authenticated;
grant execute on function public.notification_push_has_backlog(boolean) to service_role;
