-- שלד לבדיקת תקרת הביקוש הפתוח. לא רץ בפרודקשן.
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

create table if not exists public.pricing_config (
  key text primary key,
  value numeric,
  description text
);

create table if not exists public.agency_members (
  id uuid primary key,
  active boolean not null default true,
  released_at timestamptz,
  license_status text,
  license_number text,
  agency_id uuid
);

-- city_id הוא uuid כמו scraped_leads.city_id: הדירוג משווה a.city_id = r.city_id.
create table if not exists public.agencies (
  id uuid primary key,
  city_id uuid
);

insert into public.agencies (id, city_id)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', null)
on conflict (id) do nothing;

insert into public.agency_members (id, active, agency_id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', true, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', true, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', true, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', true, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5', true, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6', true, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa7', true, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa8', true, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa9', true, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa10', true, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa11', true, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1')
on conflict (id) do update set agency_id = excluded.agency_id;

create table if not exists public.whatsapp_conversations (
  agent_id uuid primary key,
  last_message_at timestamptz
);

create table if not exists public.neighborhoods (
  id uuid primary key,
  city_id uuid
);

create table if not exists public.agent_lead_preferences (
  agent_id uuid,
  active boolean,
  preferred_neighborhoods uuid[]
);

create table if not exists public.scraped_leads (
  id uuid primary key default gen_random_uuid(),
  status text,
  lead_type text,
  deal_type text,
  no_broker text,
  posted_at timestamptz,
  city_id uuid,
  city text,
  property_type text,
  rooms numeric,
  budget numeric,
  move_in text,
  demand_notified_at timestamptz,
  claimed_by uuid,
  claimed_at timestamptz
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null,
  type text not null,
  title text,
  body text,
  suppress_push boolean not null default false,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid,
  unlocked_by uuid,
  unlocked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.cap_stub_block (
  agent_id uuid primary key,
  kind text not null
);

create or replace function public.scraped_lead_is_demand(
  p_status text, p_lead_type text, p_no_broker text,
  p_posted_at timestamptz, p_city_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$ select p_city_id is not null $$;

create or replace function public.agent_works_city(p_agent uuid, p_city_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_city_id is not null
     and not exists (
       select 1 from public.cap_stub_block b
        where b.agent_id = p_agent and b.kind = 'city')
$$;

create or replace function public.agent_handles_type(p_agent uuid, p_property_type text, p_deal_type text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select not exists (
    select 1 from public.cap_stub_block b
     where b.agent_id = p_agent and b.kind = 'type')
$$;

create or replace function public.notification_type_enabled(p_agent_id uuid, p_type text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select not exists (
    select 1 from public.cap_stub_block b
     where b.agent_id = p_agent_id and b.kind = 'mute')
$$;

create or replace function public.notifications_apply_preferences()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.notification_type_enabled(new.agent_id, new.type) then
    return null;
  end if;
  return new;
end $$;

drop trigger if exists notifications_apply_preferences on public.notifications;
create trigger notifications_apply_preferences
  before insert on public.notifications
  for each row execute function public.notifications_apply_preferences();
