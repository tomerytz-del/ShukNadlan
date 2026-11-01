#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""קבוצת יישובים: תענכים הוא 12 יישובים, עפולה נשארת עיר אחת, ולקוח/ה עם
הכינוי מתאים לנכס בכל אחד מה-12. המיגרציה רצה פעמיים."""

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/20271101100000_city_groups_taanach.sql"

MEMBERS = [
    ("2052", "אביטל", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01"),
    ("113", "אדירים", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02"),
    ("141", "ברק", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03"),
    ("145", "גדיש", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa04"),
    ("146", "דבורה", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa05"),
    ("164", "מלאה", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa06"),
    ("2054", "מיטב", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa07"),
    ("1108", "אומן", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa08"),
    ("1110", "חבר", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa09"),
    ("1117", "יעל", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa0a"),
    ("165", "ניר יפה", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa0b"),
    ("2053", "פרזון", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa0c"),
]
AFULA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1"
CLIENT = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1"
AGENT = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1"

SETUP = r"""
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end $$;

create or replace function public.city_name_key(p_name text)
returns text language sql immutable strict as $$
  select coalesce(
    nullif(
      regexp_replace(
        regexp_replace(
          btrim(regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(p_name, '[׳‘’`]', '''', 'g'),
                '[״“”]', '"', 'g'),
              '[־–—-]', ' ', 'g'),
            '\s+', ' ', 'g')),
          'י{2,}', 'י', 'g'),
        'ו{2,}', 'ו', 'g'),
      ''),
    btrim(p_name));
$$;

create table public.cities (
  id uuid primary key,
  name text not null,
  name_key text generated always as (public.city_name_key(name)) stored,
  muni_code text,
  active boolean not null default true
);

create table public.city_aliases (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references public.cities(id) on delete cascade,
  alias text not null,
  alias_key text generated always as (public.city_name_key(alias)) stored
);
create unique index city_aliases_key_uniq on public.city_aliases (alias_key);

create or replace function public.city_id_for_name(p_name text)
returns uuid language sql stable security definer set search_path = '' as $$
  select id from (
    select c.id, 1 as pri
      from public.cities c
     where c.active and c.name_key = public.city_name_key(p_name)
    union all
    select a.city_id, 2
      from public.city_aliases a
      join public.cities c on c.id = a.city_id and c.active
     where a.alias_key = public.city_name_key(p_name)
  ) m
  order by pri
  limit 1;
$$;

create table public.neighborhoods (
  id uuid primary key,
  city text,
  city_id uuid
);

create table public.agent_clients (
  id uuid primary key,
  agent_id uuid,
  full_name text,
  email text,
  phone text,
  client_kind text,
  status text,
  deal_type text,
  category text,
  cities text[] not null default '{}',
  property_types text[] not null default '{}',
  required_features text[] not null default '{}',
  preferred_features text[] not null default '{}',
  required_directions text[],
  neighborhood_id uuid,
  min_price numeric,
  max_price numeric,
  min_rooms numeric,
  max_rooms numeric,
  min_size_sqm numeric,
  max_size_sqm numeric,
  max_floor int,
  min_air_directions smallint,
  min_living_room_sqm numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.properties (
  id uuid primary key,
  agent_id uuid,
  title text,
  address text,
  street text,
  street_key text,
  city text,
  city_id uuid,
  status text,
  share_level text,
  deal_type text,
  category text,
  property_type text,
  neighborhood_id uuid,
  price numeric,
  price_total numeric,
  rooms numeric,
  size_sqm numeric,
  area_sqm numeric,
  floor int,
  features text[],
  mamad_location text,
  air_directions text[],
  living_room_sqm numeric,
  condition text,
  listing_number bigint,
  listing_expires_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.saved_searches (
  id uuid primary key,
  sold_to_agent_id uuid,
  status text,
  lead_status text,
  deal_type text,
  category text,
  cities text[] not null default '{}',
  neighborhood_ids uuid[] not null default '{}',
  property_types text[] not null default '{}',
  required_features text[] not null default '{}',
  min_price numeric,
  max_price numeric,
  min_rooms numeric,
  max_rooms numeric,
  min_size_sqm numeric,
  max_size_sqm numeric,
  min_floor int,
  max_floor int,
  condition text
);

create table public.scraped_leads (
  id uuid primary key,
  lead_type text,
  city text,
  city_id uuid,
  deal_type text,
  rooms numeric,
  budget numeric,
  neighborhood_id uuid
);

create table public.leads_masked (
  id uuid primary key,
  agent_id uuid,
  display_name text,
  display_phone text,
  lead_type text,
  deal_type text,
  city text,
  status text,
  property_details text,
  created_at timestamptz not null default now()
);

create table public.agreements (
  id uuid primary key,
  agent_id uuid,
  title text,
  kind text,
  status text,
  exclusive_until date,
  client_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function public.current_agent_id() returns uuid language sql stable as $$ select null::uuid $$;
create function public.street_name_key(p text) returns text language sql immutable as $$ select p $$;
create function public._crm_search_phone_match(p text, d text) returns boolean language sql stable as $$ select false $$;
"""


def psql(db, *files, sql_text=None):
    cmd = ["psql", "-v", "ON_ERROR_STOP=1", "-q", "-tA", db]
    if sql_text is not None:
        cmd.extend(["-c", sql_text])
    for path in files:
        cmd.extend(["-f", str(path)])
    return subprocess.check_output(
        cmd,
        env={**os.environ, "PGOPTIONS": "-c client_min_messages=warning"},
        text=True,
    ).strip()


def fail(msg):
    sys.exit(msg)


def main():
    db = os.environ.get("CITY_GROUPS_DB", "city_groups_test")
    subprocess.check_call(["dropdb", "--if-exists", "--maintenance-db=postgres", db])
    subprocess.check_call(["createdb", "--maintenance-db=postgres", db])
    psql(db, sql_text=SETUP)
    values = ",\n".join(
        "('{}', '{}', '{}')".format(mid, name.replace("'", "''"), code)
        for code, name, mid in MEMBERS
    )
    psql(db, sql_text=f"""
      insert into public.cities (id, name, muni_code) values
        {values},
        ('{AFULA}', 'עפולה', '7700');
    """)
    psql(db, MIGRATION)
    psql(db, MIGRATION)

    for phrase in ("תענכים", "התענכים", "חבל תענך"):
        n = psql(db, sql_text=f"select cardinality(public.city_ids_for_name('{phrase}'))")
        if n != "12":
            fail(f"{phrase} החזיר {n} מזהים, לא 12")
    afula_n = psql(db, sql_text="select cardinality(public.city_ids_for_name('עפולה'))")
    afula_id = psql(db, sql_text="select (public.city_ids_for_name('עפולה'))[1]")
    if afula_n != "1" or afula_id != AFULA:
        fail(f"עפולה לא נשארה עיר אחת: {afula_n} {afula_id}")
    empty = psql(db, sql_text="select cardinality(public.city_ids_for_name('אין יישוב כזה'))")
    if empty != "0":
        fail(f"שם לא מוכר לא החזיר מערך ריק: {empty}")

    aliases = psql(db, sql_text="""
      select count(*) from public.city_aliases
       where alias in ('מרכז אומן', 'מרכז חבר', 'מרכז יעל', 'גדש', 'מלא''ה')
    """)
    if aliases != "5":
        fail(f"כינויי העיר מהפרודקשן לא נכנסו: {aliases}")

    prop_values = []
    for i, (_code, name, cid) in enumerate(MEMBERS):
        prop_values.append(
            "('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee%02d', '%s', '%s', '%s', 'active', 'office', 'sale', 'residential')"
            % (i + 1, AGENT, name.replace("'", "''"), cid)
        )
    prop_values.append(
        f"('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee99', '{AGENT}', 'עפולה', '{AFULA}', 'active', 'office', 'sale', 'residential')"
    )
    psql(db, sql_text="""
      insert into public.properties (id, agent_id, city, city_id, status, share_level, deal_type, category)
      values
    """ + ",\n".join(prop_values))
    psql(db, sql_text=f"""
      insert into public.agent_clients (id, agent_id, client_kind, status, deal_type, category, cities)
      values ('{CLIENT}', '{AGENT}', 'seeker', 'active', 'sale', 'residential', array['תענכים']);
    """)
    # העטיפה בשני ארגומנטים, כמו בפרודקשן: קוראת לגוף עם הוויתור הריק.
    psql(db, sql_text="""
      create or replace function public.client_property_match(
        p_client public.agent_clients,
        p_property public.properties
      )
      returns table (score int, reasons text[], missing_features text[])
      language sql
      stable
      as $$
        select m.score, m.reasons, m.missing_features
          from public.client_property_match(p_client, p_property, '{}'::text[]) m;
      $$;
    """)
    matched = psql(db, sql_text=f"""
      select coalesce(string_agg(p.city, ',' order by p.city), '')
        from public.properties p
        join public.agent_clients c on c.id = '{CLIENT}'
       where exists (
         select 1 from public.client_property_match(c, p) m
       )
    """)
    want = ",".join(sorted(name for _code, name, _cid in MEMBERS))
    if matched != want:
        fail(f"לקוח/ה עם תענכים לא התאים לכל ה-12: {matched}")
    psql(db, sql_text=f"update public.agent_clients set cities = array['עפולה'] where id = '{CLIENT}'")
    only = psql(db, sql_text=f"""
      select coalesce(string_agg(p.city, ',' order by p.city), '')
        from public.properties p
        join public.agent_clients c on c.id = '{CLIENT}'
       where exists (
         select 1 from public.client_property_match(c, p, '{{}}'::text[]) m
       )
    """)
    if only != "עפולה":
        fail(f"לקוח/ה בעפולה התאים ליותר מעפולה: {only}")
    print("city groups: ok")


if __name__ == "__main__":
    main()
