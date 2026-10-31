-- supabase/migrations/20271031330000_notif_cadence_log_self.sql
-- סירוב (כפתור כבוי, סוכן/ת אחר/ת, מסלול) לא נרשם ביומן תחת
-- המזהה שהקורא שלח. אחרת כל מחובר/ת יכול/ה לכתוב שורה על מישהו אחר.

create or replace function public.notif_cadence_begin(p_agent uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_err text;
  v_id uuid;
  v_cadence jsonb;
  v_since jsonb;
begin
  v_err := public.notif_cadence_actor_ok(p_agent);
  if v_err is not null then
    return jsonb_build_object('ok', false, 'error', v_err);
  end if;
  select coalesce(p.whatsapp_cadence, '{}'::jsonb),
         coalesce(p.whatsapp_cadence_since, '{}'::jsonb)
    into v_cadence, v_since
    from public.agent_notification_preferences p
   where p.agent_id = p_agent;
  v_cadence := coalesce(v_cadence, '{}'::jsonb);
  v_since := coalesce(v_since, '{}'::jsonb);
  delete from public.notif_cadence_snapshot s
   where s.agent_id = p_agent
     and s.created_at < now() - interval '30 minutes';
  insert into public.notif_cadence_snapshot (agent_id, cadence, since)
  values (p_agent, v_cadence, v_since)
  returning id into v_id;
  insert into public.notif_cadence_log (agent_id, notif_type, event, choice)
  values (p_agent, null, 'snapshot', null);
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke all on function public.notif_cadence_begin(uuid) from public, anon, authenticated;
grant execute on function public.notif_cadence_begin(uuid) to authenticated, service_role;

create or replace function public.notif_cadence_restore(p_agent uuid, p_snapshot uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_err text;
  v_cadence jsonb;
  v_since jsonb;
  v_self uuid;
begin
  v_err := public.notif_cadence_actor_ok(p_agent);
  if v_err is not null then
    return jsonb_build_object('ok', false, 'error', v_err);
  end if;
  v_self := public.current_agent_id();
  if p_snapshot is null then
    insert into public.notif_cadence_log (agent_id, notif_type, event, choice)
    select v_self, null, 'restore', null
     where v_self is not null;
    return jsonb_build_object('ok', false, 'error', 'אין צילום קצב לשחזור');
  end if;
  select s.cadence, s.since
    into v_cadence, v_since
    from public.notif_cadence_snapshot s
   where s.id = p_snapshot
     and s.agent_id = p_agent
     and s.created_at > now() - interval '30 minutes';
  if not found then
    insert into public.notif_cadence_log (agent_id, notif_type, event, choice)
    select v_self, null, 'restore', null
     where v_self is not null;
    return jsonb_build_object('ok', false, 'error', 'אין צילום קצב לשחזור, או שפג תוקפו');
  end if;
  insert into public.agent_notification_preferences (
    agent_id, whatsapp_cadence, whatsapp_cadence_since
  ) values (
    p_agent, v_cadence, v_since
  )
  on conflict (agent_id) do update
    set whatsapp_cadence = excluded.whatsapp_cadence,
        whatsapp_cadence_since = excluded.whatsapp_cadence_since,
        updated_at = now();
  insert into public.notif_cadence_log (agent_id, notif_type, event, choice)
  values (p_agent, null, 'restore', null);
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.notif_cadence_restore(uuid, uuid) from public, anon, authenticated;
grant execute on function public.notif_cadence_restore(uuid, uuid) to authenticated, service_role;
