-- טיוטה - HANDOFF.md סעיף 3. לא להחיל ידנית. שם קובץ סופי: YYYYMMDDHHMMSS_agency_teams.sql (גדול מהאחרון).
-- לאמת מול המסד החי לפני כתיבה: עמודות agency_members, גוף protect_sensitive_agency_member_fields העדכני
-- (המיגרציה האחרונה שהגדירה אותה: 20261031090000_broker_license_verification.sql), ו-check_agency_embed.py.

-- 1. צוותים
create table if not exists public.agency_teams (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references public.agencies(id) on delete cascade,
  name           text not null check (length(btrim(name)) between 1 and 60),
  lead_member_id uuid references public.agency_members(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists agency_teams_agency_idx on public.agency_teams(agency_id);
-- מנהל/ת לצוות אחד לכל היותר
create unique index if not exists agency_teams_lead_uidx on public.agency_teams(lead_member_id) where lead_member_id is not null;

-- 2. עמודות על חבר/ת המשרד
alter table public.agency_members add column if not exists team_id uuid;
alter table public.agency_members add column if not exists is_active_agent boolean not null default true;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'agency_members_team_id_fkey') then
    alter table public.agency_members
      add constraint agency_members_team_id_fkey foreign key (team_id) references public.agency_teams(id) on delete set null;
  end if;
end $$;
create index if not exists agency_members_team_idx on public.agency_members(team_id) where team_id is not null;
-- !! FK שני בין agency_members ל-agency_teams: לבדוק scripts/check_agency_embed.py (MULTI_FK_TABLES / PGRST201)

-- 3. עוזרים
create or replace function public.current_led_team_id()
returns uuid language sql stable security definer set search_path = public as $$
  select t.id from agency_teams t
   where t.lead_member_id = (select id from agency_members where user_id = (select auth.uid()) limit 1)
   limit 1;
$$;
revoke all on function public.current_led_team_id() from public, anon, authenticated;
grant execute on function public.current_led_team_id() to authenticated;

-- RPC קטן לעליית ה-CRM: מה אני
create or replace function public.my_roles()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'role', m.role,
    'is_active_agent', m.is_active_agent,
    'team_id', m.team_id,
    'led_team_id', (select t.id from agency_teams t where t.lead_member_id = m.id limit 1))
  from agency_members m where m.user_id = (select auth.uid()) limit 1;
$$;
revoke all on function public.my_roles() from public, anon, authenticated;
grant execute on function public.my_roles() to authenticated;

-- 4. RLS על agency_teams
alter table public.agency_teams enable row level security;
drop policy if exists "members read own agency teams" on public.agency_teams;
create policy "members read own agency teams" on public.agency_teams
  for select to authenticated using (agency_id = (select public.current_agency_id()));
drop policy if exists "managers write teams" on public.agency_teams;
create policy "managers write teams" on public.agency_teams
  for all to authenticated
  using ((select public.current_member_role()) = 'manager' and agency_id = (select public.current_agency_id()))
  with check (
    (select public.current_member_role()) = 'manager' and agency_id = (select public.current_agency_id())
    and (lead_member_id is null or exists (
      select 1 from public.agency_members m where m.id = lead_member_id and m.agency_id = agency_teams.agency_id))
  );

-- 5. team_id ו-is_active_agent: רק מנהל/ת משרד, ולא בעדכון עצמי.
-- להוסיף לגוף הקיים של protect_sensitive_agency_member_fields() (לא להחליף אותו!), בנוסח של role:
--   if new.team_id is distinct from old.team_id or new.is_active_agent is distinct from old.is_active_agent then
--     if <קורא/ת אינו/ה מנהל/ת משרד של אותו משרד> or new.user_id = auth.uid() then
--       new.team_id := old.team_id; new.is_active_agent := old.is_active_agent;
--     end if;
--   end if;
-- וגם: team_id חייב להצביע על צוות באותו משרד (בדיקה בטריגר או constraint trigger).

-- 6. is_active_agent = false - לאמת ולעדכן (HANDOFF 3.3):
--   order_lead_candidates(uuid[])  -> לסנן and m.is_active_agent
--   _agent_period_stats / חישוב office_avg -> "סוכנים פעילים" = active and is_active_agent
--   agent_onboarding_state()       -> רק צעדי המשרד
