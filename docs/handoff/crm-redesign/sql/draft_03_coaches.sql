-- טיוטה - HANDOFF.md סעיף 6. לא להחיל ידנית. מבוסס על 20270407090000_office_coach.sql (לקרוא אותה קודם).

-- 1. מאמן הסוכן/ת - יומי
create table if not exists public.agent_coach_summaries (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references public.agencies(id) on delete cascade,
  agent_id      uuid not null references public.agency_members(id) on delete cascade,
  day           date not null,
  summary       jsonb not null,
  input_hash    text,                       -- טביעת אצבע של הקלט: יום בלי שינוי מעתיק את אתמול בלי קריאה למודל
  model         text,
  input_tokens  integer,
  output_tokens integer,
  actions_done  smallint[] not null default '{}',
  created_at    timestamptz not null default now(),
  unique (agent_id, day)
);
alter table public.agent_coach_summaries enable row level security;
drop policy if exists "agent reads own coach" on public.agent_coach_summaries;
create policy "agent reads own coach" on public.agent_coach_summaries
  for select to authenticated using (agent_id = (select public.current_agent_id()));
-- אין policy כתיבה: service_role בלבד (הפונקציה), ו"בוצע" דרך coach_action_done

-- 2. מאמן מנהל/ת הצוות - שבועי
create table if not exists public.team_coach_summaries (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references public.agencies(id) on delete cascade,
  team_id       uuid not null references public.agency_teams(id) on delete cascade,
  week_start    date not null,
  summary       jsonb not null,
  model         text,
  input_tokens  integer,
  output_tokens integer,
  actions_done  smallint[] not null default '{}',
  created_at    timestamptz not null default now(),
  unique (team_id, week_start)
);
alter table public.team_coach_summaries enable row level security;
drop policy if exists "team lead and managers read team coach" on public.team_coach_summaries;
create policy "team lead and managers read team coach" on public.team_coach_summaries
  for select to authenticated using (
    team_id = (select public.current_led_team_id())
    or ((select public.current_member_role()) = 'manager' and agency_id = (select public.current_agency_id()))
  );

-- 3. מאמן המשרד - קיים
alter table public.office_coach_summaries add column if not exists actions_done smallint[] not null default '{}';

-- 4. מי מחכה לסיכום יומי
create or replace function public.agent_coach_due(p_limit integer)
returns table (agent_id uuid, agency_id uuid) language sql stable set search_path = public as $$
  select m.id, m.agency_id
    from agency_members m
   where m.active and m.is_active_agent and m.agency_id is not null
     and not exists (select 1 from agent_coach_summaries s
                      where s.agent_id = m.id and s.day = (now() at time zone 'Asia/Jerusalem')::date)
     and (exists (select 1 from leads l where l.agent_id = m.id and l.created_at > now() - interval '14 days')
       or exists (select 1 from properties p where p.agent_id = m.id and p.updated_at > now() - interval '14 days')
       or exists (select 1 from agent_agenda_items a where a.agent_id = m.id and a.due_at > now() - interval '14 days'))
   order by m.id
   limit p_limit;
$$;
-- !! לאמת שמות עמודות (properties.agent_id? agent_agenda_items.agent_id?) מול המסד
revoke all on function public.agent_coach_due(integer) from public, anon, authenticated;
grant execute on function public.agent_coach_due(integer) to service_role;

-- 5. "סמן כבוצע"
create or replace function public.coach_action_done(p_kind text, p_summary_id uuid, p_index integer, p_done boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_index not between 0 and 2 then raise exception 'bad index' using errcode = '22023'; end if;
  if p_kind = 'agent' then
    update agent_coach_summaries
       set actions_done = case when p_done then array(select distinct unnest(actions_done || p_index::smallint))
                               else array_remove(actions_done, p_index::smallint) end
     where id = p_summary_id and agent_id = public.current_agent_id();
  elsif p_kind = 'team' then
    update team_coach_summaries
       set actions_done = case when p_done then array(select distinct unnest(actions_done || p_index::smallint))
                               else array_remove(actions_done, p_index::smallint) end
     where id = p_summary_id
       and (team_id = public.current_led_team_id()
            or (public.current_member_role() = 'manager' and agency_id = public.current_agency_id()));
  elsif p_kind = 'office' then
    update office_coach_summaries
       set actions_done = case when p_done then array(select distinct unnest(actions_done || p_index::smallint))
                               else array_remove(actions_done, p_index::smallint) end
     where id = p_summary_id and public.current_member_role() = 'manager' and agency_id = public.current_agency_id();
  else
    raise exception 'bad kind' using errcode = '22023';
  end if;
end $$;
revoke all on function public.coach_action_done(text, uuid, integer, boolean) from public, anon, authenticated;
grant execute on function public.coach_action_done(text, uuid, integer, boolean) to authenticated;

-- 6. pg_cron - בנוסח של office-coach (vault: alert_cron_secret; דילוג עם הודעה אם pg_cron חסר)
--   agent-coach : '10 3-5 * * *'  -> POST .../functions/v1/office-coach?kind=agent  רק כש-agent_coach_due(1) לא ריק
--   team        : יחד עם office-coach ביום ראשון, ?kind=team, עם team_coach_due(p_limit)
