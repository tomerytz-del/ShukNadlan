-- שלד לבדיקת יומן פניות היריד. לא רץ בפרודקשן.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

create schema if not exists public;
grant usage on schema public to anon, authenticated, service_role;

create table if not exists public.pricing_config (
  key text primary key,
  value numeric,
  description text
);

create table if not exists public.agencies (
  id uuid primary key,
  name text
);

create table if not exists public.agency_members (
  id uuid primary key,
  agency_id uuid references public.agencies(id),
  display_name text,
  role text
);

create table if not exists public.properties (
  id uuid primary key,
  agent_id uuid references public.agency_members(id),
  agency_id uuid references public.agencies(id),
  title text,
  city text,
  open_house boolean not null default false,
  open_house_start timestamptz,
  open_house_end timestamptz
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  lead_type text,
  property_id uuid references public.properties(id) on delete set null,
  agency_id uuid,
  agent_id uuid,
  source text,
  external_ref text,
  raw_name text,
  raw_phone text,
  phone_e164 text,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.leads to service_role, authenticated;

create table if not exists public.data_retention_settings (
  policy text primary key,
  keep_for interval not null,
  enabled boolean not null default false,
  description text
);

create table if not exists public.data_retention_runs (
  id bigserial primary key,
  run_at timestamptz not null default now(),
  policy text not null,
  dry_run boolean not null,
  affected integer not null,
  details jsonb
);

-- מי מחובר/ת: GUC של הבדיקה במקום ה-JWT
create or replace function public.current_agent_id() returns uuid
language sql stable set search_path = '' as $$
  select nullif(current_setting('test.agent', true), '')::uuid $$;
create or replace function public.current_agency_id() returns uuid
language sql stable set search_path = '' as $$
  select m.agency_id from public.agency_members m
   where m.id = nullif(current_setting('test.agent', true), '')::uuid $$;
create or replace function public.current_member_role() returns text
language sql stable set search_path = '' as $$
  select m.role from public.agency_members m
   where m.id = nullif(current_setting('test.agent', true), '')::uuid $$;
create or replace function public.current_is_platform_admin() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(current_setting('test.admin', true), '') = '1' $$;
grant execute on function public.current_agent_id(), public.current_agency_id(),
  public.current_member_role(), public.current_is_platform_admin() to authenticated, anon;
grant select on public.agency_members to authenticated;

insert into public.agencies (id, name) values
  ('a0000000-0000-0000-0000-000000000001', 'משרד א'),
  ('a0000000-0000-0000-0000-000000000002', 'משרד ב')
on conflict (id) do nothing;

insert into public.agency_members (id, agency_id, display_name, role) values
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'יועצת א', 'agent'),
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'מנהלת א', 'manager'),
  ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002', 'יועץ ב', 'agent')
on conflict (id) do nothing;
