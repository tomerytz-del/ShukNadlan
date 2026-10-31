-- ============================================================================
-- סביבה מינימלית ל-20271031230000_street_key_search.sql (‏scripts/street_key_test.py)
--
-- רק מה שהמיגרציה ושתי פונקציות החיפוש נוגעות בו. ‏street_name_key עצמה
-- נלקחת מהמיגרציה המקורית (‏20261109090000) ולא מועתקת לכאן, כדי שבדיקת
-- ההתאמה מול JS תרוץ על הפונקציה שבאמת יושבת בפרודקשן.
-- ============================================================================

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;

-- מי מחובר/ת: GUC במקום JWT
create or replace function public.current_agent_id() returns uuid
language sql stable as $$ select nullif(current_setting('test.agent', true), '')::uuid $$;
create or replace function public.current_is_platform_admin() returns boolean
language sql stable as $$ select coalesce(current_setting('test.admin', true), '') = 'on' $$;

create table public.cities (id serial primary key, name text);
create table public.agencies (id uuid primary key default gen_random_uuid(), name text, slug text,
  city_id int references public.cities(id), created_at timestamptz default now());
create table public.agency_members (id uuid primary key default gen_random_uuid(), agency_id uuid,
  display_name text, slug text, tier text, role text, active boolean default true,
  released_at timestamptz, created_at timestamptz default now());
create table public.properties (
  id uuid primary key default gen_random_uuid(),
  listing_number bigint, title text, address text, street text, city text, status text default 'active',
  price numeric, deal_type text, agent_id uuid, agency_id uuid,
  created_at timestamptz default now(), updated_at timestamptz);
create table public.agent_clients (id uuid primary key default gen_random_uuid(), full_name text, email text,
  phone text, client_kind text, deal_type text, cities text[], max_price numeric, status text,
  created_at timestamptz default now(), updated_at timestamptz);
create table public.leads_masked (id uuid primary key default gen_random_uuid(), agent_id uuid,
  display_name text, display_phone text, lead_type text, deal_type text, city text, status text,
  property_details text, created_at timestamptz default now());
create table public.agreements (id uuid primary key default gen_random_uuid(), agent_id uuid, title text,
  kind text, status text, exclusive_until date, client_ids uuid[] default '{}',
  created_at timestamptz default now(), updated_at timestamptz);
