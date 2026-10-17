-- טיוטה - HANDOFF.md סעיף 4. תלויה ב-draft_01. לא להחיל ידנית.

-- 1. הליבה מקבלת סינון לסוכנים.
-- היום: _office_dashboard_core(p_agency uuid, p_from date, p_to date), security invoker, service_role בלבד.
-- אפשרות א (מומלצת): overload בן 4 פרמטרים שמכיל את החישוב, והגרסה בת ה-3 קוראת לו עם null.
--   create or replace function public._office_dashboard_core(p_agency uuid, p_from date, p_to date, p_agent_ids uuid[])
--   returns jsonb ... -- הגוף הקיים, עם  and (p_agent_ids is null or <agent_id> = any(p_agent_ids))  בכל מקור
--   create or replace function public._office_dashboard_core(p_agency uuid, p_from date, p_to date)
--   returns jsonb language sql as $$ select public._office_dashboard_core(p_agency, p_from, p_to, null) $$;
-- הרשאות לשתיהן כמו היום (revoke from public, anon, authenticated; grant to service_role).
-- להוסיף לפלט (בסוף): "teams": [{team_id, name, lead_member_id, agents, commission, deals, avg_response_min, exclusive_rate, target_pct}]

-- 2. דאשבורד הצוות
create or replace function public.team_dashboard(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_team uuid := public.current_led_team_id();
  v_agency uuid;
  v_agents uuid[];
  v_out jsonb;
begin
  if v_team is null then
    raise exception 'team lead only' using errcode = '42501';
  end if;
  if p_to < p_from or p_to - p_from > 400 then
    raise exception 'bad period' using errcode = '22023';
  end if;
  select agency_id into v_agency from agency_teams where id = v_team;
  select array_agg(id) into v_agents from agency_members where team_id = v_team and active;
  v_out := public._office_dashboard_core(v_agency, p_from, p_to, coalesce(v_agents, '{}'));
  -- teams_progress: שם הצוות ואחוז עמידה ביעד בלבד, לכל צוותי המשרד
  return v_out || jsonb_build_object('team', (select jsonb_build_object('id', id, 'name', name) from agency_teams where id = v_team));
end $$;
revoke all on function public.team_dashboard(date, date) from public, anon, authenticated;
grant execute on function public.team_dashboard(date, date) to authenticated;

-- 3. לידים בצוות - בלי טלפון ובלי טקסט חופשי
create or replace function public.team_leads(p_from date, p_to date)
returns table (
  lead_id uuid, created_at timestamptz, lead_type text, deal_type text, city text,
  property_type text, property_details text, property_id uuid,
  client_name text, agent_id uuid, agent_name text, stage text,
  first_response_at timestamptz, minutes_waiting integer
) language sql stable security definer set search_path = public as $$
  select l.id, l.created_at, l.lead_type, l.deal_type, l.city,
         l.property_type, l.property_details, l.property_id,
         -- אותו כלל של leads_masked.display_name (לאמת מול pg_get_viewdef('leads_masked'))
         case when l.status = 'unlocked' then l.raw_name
              when l.raw_name is null then null
              else left(split_part(l.raw_name,' ',1),1) || repeat('*', greatest(length(split_part(l.raw_name,' ',1))-1,0))
         end,
         l.agent_id, m.display_name, w.stage,
         l.first_response_at,
         case when l.first_response_at is null then (extract(epoch from now() - l.created_at)/60)::int end
    from leads l
    join agency_members m on m.id = l.agent_id
    left join lead_work w on w.lead_id = l.id and w.agent_id = l.agent_id
   where public.current_led_team_id() is not null
     and m.team_id = public.current_led_team_id()
     and l.created_at >= p_from and l.created_at < p_to + 1
   order by l.created_at desc
   limit 500;
  -- !! לא להוסיף raw_phone / display_phone / raw_message / phone_tail9 - בדיקה ב-CI על הפלט
$$;
revoke all on function public.team_leads(date, date) from public, anon, authenticated;
grant execute on function public.team_leads(date, date) to authenticated;
