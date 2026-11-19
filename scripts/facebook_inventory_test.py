#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""פוסט פייסבוק במלאי, ומחפש/ת מול נכסים ומודעות.

    python3 scripts/facebook_inventory_test.py
"""

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIG = ROOT / "supabase/migrations/20271121120000_facebook_listing_inventory.sql"
DB = os.environ.get("FACEBOOK_INVENTORY_DB", "facebook_inventory_test")
CITY = "11111111-1111-1111-1111-111111111111"
AGENT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1"
PROP = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1"

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

alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table public.neighborhoods (
  id uuid primary key,
  city_id uuid,
  name text
);
insert into public.neighborhoods (id, city_id, name) values
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'גבעת המורה');

create table public.scraped_leads (
  id uuid primary key default gen_random_uuid(),
  lead_type text not null,
  status text not null default 'pending_consent',
  source text not null,
  source_detail text,
  post_url text not null,
  external_ref text not null,
  posted_at timestamptz not null default now(),
  raw_name text,
  raw_phone text,
  raw_message text,
  city text not null,
  city_id uuid,
  neighborhood_id uuid,
  deal_type text,
  property_type text,
  rooms numeric,
  budget numeric,
  move_in text,
  property_details text,
  consent_requested_at timestamptz,
  no_broker text,
  demand_summary text,
  demand_notified_at timestamptz,
  claimed_by uuid,
  claimed_at timestamptz,
  phone_hash text,
  push_site_only boolean not null default false,
  date_known boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index scraped_leads_source_ref_uq on public.scraped_leads (source, external_ref);
create table public.scraped_lead_blocks (
  ref_hash text primary key,
  expires_at timestamptz not null
);
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  raw_phone text,
  source text,
  created_at timestamptz not null default now()
);

create table public.listing_inventory (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('yad2', 'madlan')),
  external_ref text not null check (external_ref ~ '^[A-Za-z0-9._:/-]{1,128}$'),
  city text not null check (char_length(city) between 1 and 80),
  city_id uuid,
  deal_type text,
  property_type text,
  rooms numeric,
  price numeric,
  size_sqm numeric,
  floor int,
  neighborhood text,
  url text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  removed_at timestamptz,
  scraped_lead_id uuid references public.scraped_leads(id) on delete set null,
  from_seed boolean not null default false,
  lead_offered_at timestamptz,
  unique (source, external_ref)
);

create table public.listing_inventory_price_history (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null,
  source text not null check (source in ('yad2', 'madlan')),
  city text not null,
  deal_type text,
  old_price numeric,
  new_price numeric,
  changed_at timestamptz not null default now()
);
create function public.listing_inventory_price_history_log()
returns trigger language plpgsql as $$
begin
  insert into public.listing_inventory_price_history
    (listing_id, source, city, deal_type, old_price, new_price)
  values (new.id, new.source, new.city, new.deal_type, old.price, new.price);
  return null;
end $$;
create trigger listing_inventory_price_history_trg
  after update of price on public.listing_inventory
  for each row
  when (old.price is not null and new.price is not null and old.price <> new.price
        and old.deal_type is not distinct from new.deal_type)
  execute function public.listing_inventory_price_history_log();

create table public.properties (
  id uuid primary key,
  agent_id uuid,
  status text,
  listing_expires_at date,
  city_id uuid,
  city text,
  deal_type text,
  rooms numeric,
  price numeric
);

create function public.city_id_for_name(p text)
returns uuid language sql stable as $$
  select '11111111-1111-1111-1111-111111111111'::uuid;
$$;
create function public.city_ids_for_name(p text)
returns uuid[] language sql stable as $$
  select array['11111111-1111-1111-1111-111111111111'::uuid];
$$;
create function public.phone_tail9(p text) returns text language sql immutable as $$
  select case when length(regexp_replace(coalesce(p, ''), '\D', '', 'g')) >= 9
              then right(regexp_replace(p, '\D', '', 'g'), 9) end;
$$;
create function public.madlan_switchboard_phone(p text) returns boolean language sql immutable as $$
  select false;
$$;
create function public.scraped_lead_ref(p_url text) returns text language sql immutable as $$
  select regexp_replace(lower(p_url), '^https?://(www\.)?', '');
$$;
create function public.scraped_lead_no_broker(p text) returns boolean language sql immutable as $$
  select false;
$$;
create function public.scraped_lead_is_demand(p_status text, p_lead_type text, p_no_broker text,
                                              p_posted_at timestamptz, p_city_id uuid)
returns boolean language sql stable as $$ select false $$;
create function public.scraped_leads_launch_active() returns boolean language sql stable as $$
  select false $$;
create function public.log_lead_routing(p jsonb) returns jsonb language sql as $$
  select '{}'::jsonb $$;

create table public.pricing_config (key text primary key, value int not null);
insert into public.pricing_config (key, value) values ('scraped_lead_matching_enabled', 1);
"""


def psql(db, sql_file=None, sql_text=None):
    cmd = ["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", db, "-tA"]
    if sql_file is not None:
        cmd.extend(["-f", str(sql_file)])
    else:
        cmd.extend(["-c", sql_text])
    out = subprocess.check_output(cmd, text=True)
    return out.strip()


def fail(msg):
    print("FAIL:", msg, file=sys.stderr)
    sys.exit(1)


def main():
    subprocess.check_call(["dropdb", "--if-exists", "--maintenance-db=postgres", DB])
    subprocess.check_call(["createdb", "--maintenance-db=postgres", DB])
    psql(DB, sql_text=SETUP)
    psql(DB, MIG)
    psql(DB, MIG)

    anon = psql(DB, sql_text="""
      select has_function_privilege('anon', 'public.listing_inventory_facebook_sync()', 'execute')::text
          || '|' ||
             has_function_privilege('authenticated', 'public.scraped_seeker_supply(uuid)', 'execute')::text
          || '|' ||
             has_function_privilege('service_role', 'public.scraped_seeker_supply(uuid)', 'execute')::text
    """)
    if anon != "false|false|true":
        fail(f"הרשאות: {anon}")

    owner = psql(DB, sql_text=f"""
      select public.scraped_lead_add(jsonb_build_object(
        'lead_type', 'owner_inbound', 'source', 'facebook_group',
        'external_ref', 'https://www.facebook.com/groups/555/posts/123456789012345/',
        'posted_at', now(), 'city', 'עפולה', 'raw_phone', '0501234567',
        'raw_name', 'ישראל', 'deal_type', 'sale', 'property_type', 'דירה',
        'rooms', 4, 'price', 1000000, 'neighborhood', 'גבעת המורה',
        'size_sqm', 90, 'floor', 2,
        'property_details', 'הרצל 12')) ->> 'id'
    """)
    if not owner:
        fail("בעלים לא נקלט")
    inv = psql(DB, sql_text="""
      select external_ref || '|' || coalesce(neighborhood, '-')
             || '|' || price::int::text || '|' || size_sqm::int::text
             || '|' || floor::text || '|' || (removed_at is null)::text
        from public.listing_inventory where source = 'facebook'
    """)
    if inv != "555:123456789012345|גבעת המורה|1000000|90|2|true":
        fail(f"מלאי: {inv}")
    leaked = psql(DB, sql_text="""
      select count(*)::text from public.listing_inventory
       where source = 'facebook'
         and (coalesce(neighborhood, '') || coalesce(url, '') || city || external_ref)
             ~ '(0501234567|ישראל|הרצל)'
    """)
    if leaked != "0":
        fail("פרטים מזהים או רחוב במלאי")

    street = psql(DB, sql_text="""
      select public.listing_area_text('הרצל 12') is null
          and public.listing_area_text('רחוב הנשיא') is null
          and public.listing_area_text('052-1111111') is null
          and public.listing_area_text('גבעת המורה') = 'גבעת המורה'
          and public.listing_area_text('רובע 3') = 'רובע 3'
    """)
    if street != "t":
        fail(f"ניקוי שכונה: {street}")

    psql(DB, sql_text=f"""
      insert into public.properties
        (id, agent_id, status, city_id, city, deal_type, rooms, price)
      values ('{PROP}', '{AGENT}', 'active', '{CITY}', 'עפולה', 'sale', 4, 900000);
      insert into public.listing_inventory
        (source, external_ref, city, city_id, deal_type, property_type, rooms, price, neighborhood)
      values
        ('yad2', 'yad2.co.il/item/open', 'עפולה', '{CITY}', 'sale', 'דירה', 4, 950000, null),
        ('yad2', 'yad2.co.il/item/other', 'עפולה', '{CITY}', 'sale', 'דירה', 4, 950000, 'עפולה עלית'),
        ('madlan', 'madlan.co.il/listings/x', 'עפולה', '{CITY}', 'rent', 'דירה', 4, 4000, null);
    """)
    seeker = psql(DB, sql_text="""
      select public.scraped_lead_add(jsonb_build_object(
        'lead_type', 'seeker_inbound', 'source', 'facebook_group',
        'external_ref', 'https://www.facebook.com/groups/555/posts/223456789012345/',
        'posted_at', now(), 'city', 'עפולה', 'raw_phone', '0501234568',
        'deal_type', 'sale', 'rooms', 4, 'budget', 1000000,
        'neighborhood', 'גבעת המורה',
        'property_details', '{"neighborhood":"גבעת המורה","rooms":4}')) ->> 'id'
    """)
    supply = psql(DB, sql_text=f"""
      select (public.scraped_seeker_supply('{seeker}'::uuid) ->> 'properties')
          || '|' ||
             (public.scraped_seeker_supply('{seeker}'::uuid) ->> 'listings')
    """)
    if supply != "1|2":
        fail(f"התאמת מחפש/ת: {supply}")
    if psql(DB, sql_text="""
      select count(*)::text from public.listing_inventory where source = 'facebook'
    """) != "1":
        fail("מחפש/ת נכתב/ה למלאי")

    nobroker = psql(DB, sql_text="""
      select public.scraped_lead_add(jsonb_build_object(
        'lead_type', 'seeker_inbound', 'source', 'facebook_group',
        'external_ref', 'https://www.facebook.com/groups/555/posts/323456789012345/',
        'posted_at', now(), 'city', 'עפולה', 'raw_phone', '0501234569',
        'deal_type', 'sale', 'no_broker', true)) ->> 'id'
    """)
    if psql(DB, sql_text=f"""
      select (public.scraped_seeker_supply('{nobroker}'::uuid) ->> 'properties')
          || '|' ||
             (public.scraped_seeker_supply('{nobroker}'::uuid) ->> 'listings')
    """) != "0|0":
        fail("ללא תיווך נספר כהתאמה")

    psql(DB, sql_text=f"delete from public.scraped_leads where id = '{owner}'")
    if psql(DB, sql_text="""
      select count(*)::text from public.listing_inventory where source = 'facebook'
    """) != "0":
        fail("מחיקת הליד השאירה שורת מלאי")
    if psql(DB, sql_text="""
      select count(*)::text from public.listing_inventory where source = 'yad2'
    """) != "2":
        fail("מחיקת פייסבוק נגעה ביד2")

    psql(DB, sql_text=f"""
      insert into public.listing_inventory
        (source, external_ref, city, deal_type, price)
      values ('facebook', '555:99999', 'עפולה', 'sale', 1000000);
      update public.listing_inventory set price = 900000 where external_ref = '555:99999';
      update public.listing_inventory set price = 800000 where external_ref = 'yad2.co.il/item/open';
    """)
    hist = psql(DB, sql_text="""
      select coalesce(string_agg(source, ',' order by source), '')
        from public.listing_inventory_price_history
    """)
    if hist != "yad2":
        fail(f"היסטוריית מחיר: {hist}")

    print("facebook inventory: ok")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as err:
        print(err.output if isinstance(err.output, str) else err, file=sys.stderr)
        sys.exit(1)
