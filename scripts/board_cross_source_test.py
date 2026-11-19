#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""אותו נכס ביד2 ובמדלן מסומן, נכנס, וההתראה לא נעצרת.

    python3 scripts/board_cross_source_test.py
"""
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIG = ROOT / "supabase/migrations/20271121160000_board_cross_source_duplicate.sql"
# המיגרציה שקודמת לה: העמודות size_sqm, floor, neighborhood ו-price_changes
# שגוף listing_inventory_sync כותב אליהן.
HISTORY = ROOT / "supabase/migrations/20271119140000_listing_inventory_price_history.sql"
# גוף scraped_lead_add שהמיגרציה בונה עליו: פייסבוק, גודל, קומה, אזור וחסימת תיווך.
FACEBOOK = ROOT / "supabase/migrations/20271121120000_facebook_listing_inventory.sql"
DB = os.environ.get("BOARD_CROSS_SOURCE_DB", "board_cross_source_test")
C1 = "11111111-1111-1111-1111-111111111111"
C2 = "22222222-2222-2222-2222-222222222222"

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

create table public.cities (id uuid primary key, name text);
insert into public.cities (id, name) values
  ('11111111-1111-1111-1111-111111111111', 'עפולה'),
  ('22222222-2222-2222-2222-222222222222', 'נצרת');

create table public.neighborhoods (id uuid primary key, city_id uuid, name text);

create table public.pricing_config (key text primary key, value int not null);
insert into public.pricing_config (key, value) values
  ('scraped_lead_matching_enabled', 0),
  ('notif_burst_scraped_stale_days', 14);

create table public.app_config (
  key text primary key,
  value text not null,
  description text not null default ''
);
insert into public.app_config (key, value) values
  ('madlan_notify_daily_cap', '5'),
  ('listing_inventory_min_snapshot_ratio', '0.5'),
  ('listing_inventory_seed_catchup_days', '2'),
  ('listing_inventory_seed_catchup_ratio', '2');

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  lead_type text,
  agent_id uuid,
  agency_id uuid,
  status text,
  quota_source text,
  unlocked_at timestamptz,
  unlocked_by uuid,
  raw_name text,
  raw_phone text,
  raw_message text,
  city text,
  deal_type text,
  property_type text,
  source text,
  source_detail text,
  external_ref text,
  created_at timestamptz not null default now()
);

create table public.scraped_lead_blocks (ref_hash text primary key, expires_at timestamptz);

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
  city_id uuid references public.cities(id) on delete set null,
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
  phone_hash text,
  push_site_only boolean not null default false,
  date_known boolean not null default false,
  claimed_by uuid, claimed_at timestamptz,
  size_sqm numeric, floor int, area_text text,
  broker_block boolean not null default false,
  created_at timestamptz not null default now(),
  unique (source, external_ref)
);

create table public.listing_inventory (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('yad2', 'madlan')),
  external_ref text not null,
  city text not null,
  city_id uuid references public.cities(id) on delete set null,
  deal_type text,
  property_type text,
  rooms numeric,
  price numeric,
  url text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  removed_at timestamptz,
  scraped_lead_id uuid references public.scraped_leads(id) on delete set null,
  from_seed boolean not null default false,
  lead_offered_at timestamptz,
  lead_skip_reason text,
  lead_attempted_at timestamptz,
  lead_attempt_fingerprint text,
  unique (source, external_ref)
);

create table public.listing_inventory_seeds (
  source text not null,
  city text not null,
  seeded_at timestamptz not null default now(),
  item_count int not null,
  primary key (source, city)
);

create table public.listing_inventory_sync_log (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  city text not null,
  item_count int not null,
  active_before int not null,
  added int not null,
  updated int not null,
  removed int not null,
  new_leads int not null,
  seeded boolean not null,
  removals_skipped boolean not null,
  note text,
  created_at timestamptz not null default now()
);

create table public._notify_log (id uuid, at timestamptz not null default now());

create function public.phone_tail9(p text) returns text
language sql immutable as $$
  select case
    when length(regexp_replace(coalesce(p, ''), '\D', '', 'g')) >= 9
    then right(regexp_replace(p, '\D', '', 'g'), 9)
  end
$$;

create function public.madlan_switchboard_phone(p text) returns boolean
language sql immutable as $$ select false $$;

create function public.city_id_for_name(p text) returns uuid
language sql stable as $$
  select case btrim(coalesce(p, ''))
    when 'עפולה' then '11111111-1111-1111-1111-111111111111'::uuid
    when 'נצרת' then '22222222-2222-2222-2222-222222222222'::uuid
  end
$$;

create function public.scraped_lead_ref(p text) returns text
language sql immutable as $$
  select left(regexp_replace(regexp_replace(coalesce(p, ''), '^https?://(www\.|m\.)?', ''), '[?#].*$', ''), 128)
$$;

create function public.scraped_lead_no_broker(p text) returns boolean
language sql immutable as $$ select false $$;

create function public.scraped_lead_notify_demand(p_id uuid) returns int
language plpgsql as $$
begin
  insert into public._notify_log (id) values (p_id);
  return 1;
end
$$;

create function public.log_lead_routing(p jsonb) returns jsonb
language sql as $$ select '{}'::jsonb $$;
"""

FIXTURES = rf"""
insert into public.scraped_leads
  (id, lead_type, source, post_url, external_ref, city, city_id, deal_type, rooms, budget, created_at)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'owner_inbound', 'yad2',
   'https://www.yad2.co.il/realestate/item/bf-1430', 'yad2.co.il/realestate/item/bf-1430',
   'עפולה', '{C1}', 'sale', 4, 1430000, '2026-11-01'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'owner_inbound', 'madlan',
   'https://www.madlan.co.il/listings/bf-1430', 'madlan.co.il/listings/bf-1430',
   'עפולה', '{C1}', 'sale', 4, 1430000, '2026-11-10'),
  ('aaaaaaaa-0000-0000-0000-000000000009', 'owner_inbound', 'madlan',
   'https://www.madlan.co.il/listings/bf-1430b', 'madlan.co.il/listings/bf-1430b',
   'עפולה', '{C1}', 'sale', 4, 1430000, '2026-11-12'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'owner_inbound', 'yad2',
   'https://www.yad2.co.il/realestate/item/bf-2180', 'yad2.co.il/realestate/item/bf-2180',
   'עפולה', '{C1}', 'sale', 5, 2180000, '2026-11-02'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'owner_inbound', 'madlan',
   'https://www.madlan.co.il/listings/bf-2180', 'madlan.co.il/listings/bf-2180',
   'עפולה', '{C1}', 'sale', 5, 2180000, '2026-11-03'),
  ('aaaaaaaa-0000-0000-0000-000000000005', 'owner_inbound', 'yad2',
   'https://www.yad2.co.il/realestate/item/bf-4400', 'yad2.co.il/realestate/item/bf-4400',
   'עפולה', '{C1}', 'rent', 4, 4400, '2026-11-04'),
  ('aaaaaaaa-0000-0000-0000-000000000006', 'owner_inbound', 'madlan',
   'https://www.madlan.co.il/listings/bf-4400', 'madlan.co.il/listings/bf-4400',
   'עפולה', '{C1}', 'rent', 4, 4400, '2026-11-05'),
  ('aaaaaaaa-0000-0000-0000-000000000007', 'owner_inbound', 'madlan',
   'https://www.madlan.co.il/listings/bf-1250', 'madlan.co.il/listings/bf-1250',
   'עפולה', '{C1}', 'sale', 4, 1250000, '2026-11-06'),
  ('aaaaaaaa-0000-0000-0000-000000000008', 'owner_inbound', 'facebook_group',
   'https://www.facebook.com/groups/1/posts/bf', 'facebook.com/groups/1/posts/bf',
   'עפולה', '{C1}', 'sale', 4, 1430000, '2026-11-07'),
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'owner_inbound', 'madlan',
   'https://www.madlan.co.il/listings/bf-1290', 'madlan.co.il/listings/bf-1290',
   'עפולה', '{C1}', 'sale', 4, 1290000, '2026-11-08'),
  ('aaaaaaaa-0000-0000-0000-00000000000b', 'owner_inbound', 'madlan',
   'https://www.madlan.co.il/listings/bf-rooms', 'madlan.co.il/listings/bf-rooms',
   'עפולה', '{C1}', 'sale', 3, 1430000, '2026-11-08'),
  ('aaaaaaaa-0000-0000-0000-00000000000c', 'owner_inbound', 'yad2',
   'https://www.yad2.co.il/realestate/item/bf-other-city', 'yad2.co.il/realestate/item/bf-other-city',
   'עפולה', '{C2}', 'sale', 4, 1430000, '2026-11-01'),
  ('aaaaaaaa-0000-0000-0000-00000000000d', 'owner_inbound', 'yad2',
   'https://www.yad2.co.il/realestate/item/bf-name', 'yad2.co.il/realestate/item/bf-name',
   'עפולה', null, 'sale', 6, 900000, '2026-11-01'),
  ('aaaaaaaa-0000-0000-0000-00000000000e', 'owner_inbound', 'madlan',
   'https://www.madlan.co.il/listings/bf-name', 'madlan.co.il/listings/bf-name',
   'עפולה', null, 'sale', 6, 900000, '2026-11-02'),
  ('aaaaaaaa-0000-0000-0000-00000000000f', 'owner_inbound', 'yad2',
   'https://www.yad2.co.il/realestate/item/bf-one-id', 'yad2.co.il/realestate/item/bf-one-id',
   'עפולה', '{C1}', 'sale', 7, 800000, '2026-11-01'),
  ('aaaaaaaa-0000-0000-0000-000000000010', 'owner_inbound', 'madlan',
   'https://www.madlan.co.il/listings/bf-one-id', 'madlan.co.il/listings/bf-one-id',
   'עפולה', null, 'sale', 7, 800000, '2026-11-02');

-- מצב שאינו ברשימה החיה אינו מועמד. בטבלת הבדיקה אין אילוץ הסטטוס,
-- כדי שאפשר לשים rejected. בפרודקשן הסירוב נמחק והאילוץ מתיר רק שלושה.
insert into public.scraped_leads
  (id, lead_type, source, post_url, external_ref, city, city_id, deal_type, rooms, budget, created_at, status)
values
  ('aaaaaaaa-0000-0000-0000-000000000020', 'owner_inbound', 'yad2',
   'https://www.yad2.co.il/realestate/item/bf-rej', 'yad2.co.il/realestate/item/bf-rej',
   'עפולה', '{C1}', 'sale', 8, 770000, '2026-10-01', 'rejected'),
  ('aaaaaaaa-0000-0000-0000-000000000021', 'owner_inbound', 'yad2',
   'https://www.yad2.co.il/realestate/item/bf-rej-old', 'yad2.co.il/realestate/item/bf-rej-old',
   'עפולה', '{C1}', 'sale', 8, 880000, '2026-10-01', 'rejected'),
  ('aaaaaaaa-0000-0000-0000-000000000022', 'owner_inbound', 'yad2',
   'https://www.yad2.co.il/realestate/item/bf-rej-live', 'yad2.co.il/realestate/item/bf-rej-live',
   'עפולה', '{C1}', 'sale', 8, 880000, '2026-11-15', 'pending_consent');

insert into public.listing_inventory
  (id, source, external_ref, city, city_id, deal_type, rooms, price, url, first_seen_at)
values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'yad2', 'yad2.co.il/realestate/item/inv1',
   'עפולה', '{C1}', 'sale', 4, 1250000, 'https://www.yad2.co.il/realestate/item/inv1', '2026-10-01'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'yad2', 'yad2.co.il/realestate/item/inv2',
   'עפולה', '{C1}', 'sale', 4, 1250000, 'https://www.yad2.co.il/realestate/item/inv2', '2026-10-02'),
  ('bbbbbbbb-0000-0000-0000-000000000003', 'yad2', 'yad2.co.il/realestate/item/inv3',
   'עפולה', '{C1}', 'sale', 4, 1250000, 'https://www.yad2.co.il/realestate/item/inv3', '2026-10-03'),
  ('bbbbbbbb-0000-0000-0000-000000000004', 'yad2', 'yad2.co.il/realestate/item/inv4',
   'עפולה', '{C1}', 'sale', 4, 1250000, 'https://www.yad2.co.il/realestate/item/inv4', '2026-10-04'),
  ('bbbbbbbb-0000-0000-0000-000000000005', 'yad2', 'yad2.co.il/realestate/item/inv5',
   'עפולה', '{C1}', 'sale', 4, 1250000, 'https://www.yad2.co.il/realestate/item/inv5', '2026-10-05'),
  ('bbbbbbbb-0000-0000-0000-000000000006', 'yad2', 'yad2.co.il/realestate/item/inv6',
   'עפולה', '{C1}', 'sale', 4, 1250000, 'https://www.yad2.co.il/realestate/item/inv6', '2026-10-06'),
  ('bbbbbbbb-0000-0000-0000-000000000007', 'yad2', 'yad2.co.il/realestate/item/inv7',
   'עפולה', '{C1}', 'sale', 4, 1250000, 'https://www.yad2.co.il/realestate/item/inv7', '2026-10-07'),
  ('bbbbbbbb-0000-0000-0000-000000000008', 'yad2', 'yad2.co.il/realestate/item/inv8',
   'עפולה', '{C1}', 'sale', 4, 1250000, 'https://www.yad2.co.il/realestate/item/inv8', '2026-10-08'),
  ('bbbbbbbb-0000-0000-0000-000000000009', 'yad2', 'yad2.co.il/realestate/item/inv-gone',
   'עפולה', '{C1}', 'sale', 4, 1250000, 'https://www.yad2.co.il/realestate/item/inv-gone', '2026-09-01'),
  ('bbbbbbbb-0000-0000-0000-00000000000a', 'madlan', 'madlan.co.il/listings/inv-1250',
   'עפולה', '{C1}', 'sale', 4, 1250000, 'https://www.madlan.co.il/listings/inv-1250', '2026-11-01');

update public.listing_inventory
   set removed_at = now()
 where id = 'bbbbbbbb-0000-0000-0000-000000000009';
"""


def fail(msg):
    sys.exit(msg)


def psql(db, *files, sql_text=None):
    cmd = ["psql", "-v", "ON_ERROR_STOP=1", "-q", "-tA", "-d", db]
    if sql_text is not None:
        cmd.extend(["-c", sql_text])
    for path in files:
        cmd.extend(["-f", str(path)])
    try:
        return subprocess.check_output(
            cmd,
            env={**os.environ, "PGOPTIONS": "-c client_min_messages=warning"},
            text=True,
            stderr=subprocess.STDOUT,
        ).strip()
    except subprocess.CalledProcessError as err:
        fail(err.output.strip() or str(err))


def eq(sql, expected, label):
    got = psql(DB, sql_text=sql)
    if got != expected:
        fail(f"{label}: {got!r} != {expected!r}")


def flag(table, row_id):
    return psql(DB, sql_text=f"""
      select (case when is_duplicate then 't' else 'f' end)
             || '|' || coalesce(duplicate_of::text, '')
             || '|' || coalesce(duplicate_match->>'lead_count', '')
             || '|' || coalesce(duplicate_match->>'inventory_count', '')
             || '|' || coalesce(duplicate_match->>'candidate_count', '')
             || '|' || coalesce(duplicate_match->>'inventory_id', '')
        from public.{table}
       where id = '{row_id}'
    """)


def snapshot():
    return psql(DB, sql_text="""
      select string_agg(line, E'\\n' order by line) from (
        select id::text || '|' || is_duplicate::text || '|' || coalesce(duplicate_of::text, '')
               || '|' || coalesce(duplicate_match::text, '') as line
          from public.scraped_leads
        union all
        select id::text || '|' || is_duplicate::text || '|' || coalesce(duplicate_of::text, '')
               || '|' || coalesce(duplicate_match::text, '')
          from public.listing_inventory
      ) s
    """)


def static_checks():
    src = MIG.read_text(encoding="utf-8")
    if "v_notified := public.scraped_lead_notify_demand(v_id);" not in src:
        fail("ההתראה לא נקראת")
    if "perform public.scraped_lead_notify_demand" in src or "select public.scraped_lead_notify_demand" in src:
        fail("ההתראה נקראת ב-perform או ב-select")
    ret = src.split("return jsonb_build_object('success'", 1)[1].split(");", 1)[0]
    if "is_duplicate" in ret or "duplicate_of" in ret:
        fail("תשובת scraped_lead_add כוללת את הסימון")
    ret_sync = src.split("return jsonb_build_object(", 1)[-1]
    # the sync return is the last jsonb_build_object of added/updated
    if "'is_duplicate'" in src.split("return jsonb_build_object(\n    'added'", 1)[1].split(");", 1)[0]:
        fail("תשובת listing_inventory_sync כוללת את הסימון")
    if "tolerance_floor_nis" not in src:
        fail("הרצועה לא מתועדת בתוצאה")
    if ret_sync and "added" not in src:
        fail("תשובת הסנכרון נעלמה")


def facebook_helpers():
    # שתי הפונקציות ש-scraped_lead_add של #1338 קוראת להן. המיגרציה המלאה
    # תלויה בעשרות טבלאות שאין כאן, ולכן שולפים רק אותן.
    src = FACEBOOK.read_text(encoding="utf-8")
    out = []
    for name in ("listing_area_text", "scraped_lead_broker_block"):
        m = re.search(r"create or replace function public\." + name + r"\(.*?\n(\$\w*\$);", src, re.S)
        if not m:
            fail("לא נמצאה " + name + " במיגרציית הפייסבוק")
        out.append(m.group(0))
    return "\n".join(out)


def main():
    static_checks()
    subprocess.check_call(["dropdb", "--if-exists", "--maintenance-db=postgres", DB])
    subprocess.check_call(["createdb", "--maintenance-db=postgres", DB])
    psql(DB, sql_text=SETUP)
    psql(DB, sql_text=FIXTURES)
    psql(DB, HISTORY)
    psql(DB, sql_text=facebook_helpers())
    psql(DB, MIG)

    # 4 חדרים 1,430,000: שני לידי מדלן מצביעים על ליד היד2 הוותיק.
    eq_flag = flag
    if eq_flag("scraped_leads", "aaaaaaaa-0000-0000-0000-000000000002") != (
        "t|aaaaaaaa-0000-0000-0000-000000000001|1|0|1|"
    ):
        fail("מדלן 1430000: " + eq_flag("scraped_leads", "aaaaaaaa-0000-0000-0000-000000000002"))
    if eq_flag("scraped_leads", "aaaaaaaa-0000-0000-0000-000000000009") != (
        "t|aaaaaaaa-0000-0000-0000-000000000001|1|0|1|"
    ):
        fail("מדלן 1430000 השני לא הצביע על הוותיק")
    # ליד היד2 הוותיק מצביע על מדלן הוותיק מבין השניים, וסופר את שניהם.
    if eq_flag("scraped_leads", "aaaaaaaa-0000-0000-0000-000000000001") != (
        "t|aaaaaaaa-0000-0000-0000-000000000002|2|0|2|"
    ):
        fail("יד2 1430000: " + eq_flag("scraped_leads", "aaaaaaaa-0000-0000-0000-000000000001"))
    if eq_flag("scraped_leads", "aaaaaaaa-0000-0000-0000-000000000004") != (
        "t|aaaaaaaa-0000-0000-0000-000000000003|1|0|1|"
    ):
        fail("5 חדרים 2180000 לא סומן")
    if eq_flag("scraped_leads", "aaaaaaaa-0000-0000-0000-000000000006") != (
        "t|aaaaaaaa-0000-0000-0000-000000000005|1|0|1|"
    ):
        fail("השכרה 4400 לא סומנה")
    # 1,250,000: ליד מדלן מול 8 מודעות יד2 חיות. הירודה לא נספרת.
    if eq_flag("scraped_leads", "aaaaaaaa-0000-0000-0000-000000000007") != (
        "t||0|8|8|bbbbbbbb-0000-0000-0000-000000000001"
    ):
        fail("1250000 מול 8: " + eq_flag("scraped_leads", "aaaaaaaa-0000-0000-0000-000000000007"))
    if eq_flag("listing_inventory", "bbbbbbbb-0000-0000-0000-000000000001") != (
        "t|bbbbbbbb-0000-0000-0000-00000000000a|1|1|2|bbbbbbbb-0000-0000-0000-00000000000a"
    ):
        fail("מלאי יד2 הוותיק: " + eq_flag("listing_inventory", "bbbbbbbb-0000-0000-0000-000000000001"))
    if eq_flag("listing_inventory", "bbbbbbbb-0000-0000-0000-000000000009") != "f|||||":
        fail("מלאי שירד סומן")
    if eq_flag("scraped_leads", "aaaaaaaa-0000-0000-0000-000000000008") != "f|||||":
        fail("פייסבוק סומן")
    if eq_flag("scraped_leads", "aaaaaaaa-0000-0000-0000-00000000000a") != "f|||||":
        fail("1290000 סומן בטעות")
    if eq_flag("scraped_leads", "aaaaaaaa-0000-0000-0000-00000000000b") != "f|||||":
        fail("3 חדרים סומן בטעות")
    if eq_flag("scraped_leads", "aaaaaaaa-0000-0000-0000-00000000000c") != "f|||||":
        fail("עיר עם city_id אחר סומנה בגלל אותו שם")
    if eq_flag("scraped_leads", "aaaaaaaa-0000-0000-0000-00000000000e") != (
        "t|aaaaaaaa-0000-0000-0000-00000000000d|1|0|1|"
    ):
        fail("התאמת שם בלי city_id נכשלה")
    if eq_flag("scraped_leads", "aaaaaaaa-0000-0000-0000-000000000010") != (
        "t|aaaaaaaa-0000-0000-0000-00000000000f|1|0|1|"
    ):
        fail("שם כשחסר city_id לאחד הצדדים נכשל")

    # גבולות הרצועה, סימטריים.
    eq(
        f"""select coalesce((public.board_cross_source_match(
              'madlan', 'עפולה', '{C1}', 'sale', 4, 1401400, null, null)->>'lead_count'), '0')""",
        "1",
        "מכירה על גבול 2%",
    )
    eq(
        f"""select (public.board_cross_source_match(
              'madlan', 'עפולה', '{C1}', 'sale', 4, 1401399, null, null) is null)::text""",
        "true",
        "מכירה מעבר ל-2%",
    )
    eq(
        f"""select coalesce(public.board_cross_source_match(
              'madlan', 'עפולה', '{C1}', 'rent', 4, 4500, null, null)->>'lead_id', '')""",
        "aaaaaaaa-0000-0000-0000-000000000005",
        "השכרה 4400 מול 4500",
    )
    eq(
        f"""select (public.board_cross_source_match(
              'madlan', 'עפולה', '{C1}', 'rent', 4, 4501, null, null) is null)::text""",
        "true",
        "השכרה 4400 מול 4501",
    )

    before = snapshot()
    psql(DB, MIG)
    if snapshot() != before:
        fail("הרצה שניה שינתה סימון בלי שמידע חדש נכנס")

    # קליטה חדשה. תשובה בלי הסימון, וההתראה יוצאת גם על שורה מסומנת.
    notify_before = psql(DB, sql_text="select count(*)::text from public._notify_log")
    added = psql(DB, sql_text=f"""
      select public.scraped_lead_add(jsonb_build_object(
        'lead_type', 'owner_inbound',
        'source', 'madlan',
        'external_ref', 'https://www.madlan.co.il/listings/new-4500',
        'city', 'עפולה',
        'deal_type', 'rent',
        'rooms', 4,
        'budget', 4500,
        'date_known', true,
        'first_seen_at', now()
      ))
    """)
    if '"is_duplicate"' in added or '"duplicate_of"' in added:
        fail(f"התשובה כוללת סימון: {added}")
    keys = psql(DB, sql_text=f"""
      select string_agg(k, ',' order by k)
        from jsonb_object_keys(public.scraped_lead_add(jsonb_build_object(
          'lead_type', 'owner_inbound', 'source', 'madlan',
          'external_ref', 'https://www.madlan.co.il/listings/new-keys',
          'city', 'עפולה', 'deal_type', 'rent', 'rooms', 2, 'budget', 3000,
          'date_known', false
        ))::jsonb) k
    """)
    # the second call above already happened inside keys. Check the first row's flag via ref.
    if keys != "agent_id,city_known,date_known,id,lead_id,no_broker,push_site_only,status,success":
        fail(f"מפתחות התשובה: {keys}")
    marked = psql(DB, sql_text="""
      select is_duplicate::text || '|' || coalesce(duplicate_of::text, '')
        from public.scraped_leads
       where external_ref = 'madlan.co.il/listings/new-4500'
    """)
    if marked != "true|aaaaaaaa-0000-0000-0000-000000000005":
        fail(f"קליטה 4500: {marked}")
    plain = psql(DB, sql_text="""
      select is_duplicate::text from public.scraped_leads
       where external_ref = 'madlan.co.il/listings/new-4600'
    """)
    # not inserted yet
    psql(DB, sql_text="""
      select public.scraped_lead_add(jsonb_build_object(
        'lead_type', 'owner_inbound', 'source', 'madlan',
        'external_ref', 'https://www.madlan.co.il/listings/new-4600',
        'city', 'עפולה', 'deal_type', 'rent', 'rooms', 4, 'budget', 4600,
        'date_known', false
      ))
    """)
    plain = psql(DB, sql_text="""
      select is_duplicate::text from public.scraped_leads
       where external_ref = 'madlan.co.il/listings/new-4600'
    """)
    if plain != "false":
        fail(f"4600 סומן: {plain}")
    same = psql(DB, sql_text="""
      select (public.scraped_lead_add(jsonb_build_object(
        'lead_type', 'owner_inbound', 'source', 'madlan',
        'external_ref', 'https://www.madlan.co.il/listings/same-a',
        'city', 'עכו', 'deal_type', 'sale', 'rooms', 3, 'budget', 900000,
        'date_known', false
      ))->>'id')
    """)
    psql(DB, sql_text="""
      select public.scraped_lead_add(jsonb_build_object(
        'lead_type', 'owner_inbound', 'source', 'madlan',
        'external_ref', 'https://www.madlan.co.il/listings/same-b',
        'city', 'עכו', 'deal_type', 'sale', 'rooms', 3, 'budget', 900000,
        'date_known', false
      ))
    """)
    same_flags = psql(DB, sql_text="""
      select string_agg(is_duplicate::text, ',' order by external_ref)
        from public.scraped_leads
       where external_ref in ('madlan.co.il/listings/same-a', 'madlan.co.il/listings/same-b')
    """)
    if same_flags != "false,false":
        fail(f"שתי מודעות מדלן סומנו: {same_flags}")
    if not same:
        fail("קליטת מדלן בלי יד2 נכשלה")
    fb = psql(DB, sql_text="""
      select (public.scraped_lead_add(jsonb_build_object(
        'lead_type', 'owner_inbound', 'source', 'facebook_group',
        'external_ref', 'https://www.facebook.com/groups/9/posts/1',
        'posted_at', now(), 'raw_phone', '0501111111',
        'city', 'עפולה', 'deal_type', 'sale', 'rooms', 4, 'budget', 1430000
      ))->>'success')
    """)
    if fb != "true":
        fail(f"פייסבוק לא נקלט: {fb}")
    if psql(DB, sql_text="""
      select is_duplicate::text from public.scraped_leads
       where source = 'facebook_group' and city = 'עפולה' and budget = 1430000
         and external_ref like 'facebook.com/groups/9%'
    """) != "false":
        fail("פייסבוק חדש סומן")
    # ליד rejected ישן אינו מועמד: מדלן חדש לא מסומן בגללו,
    # וכשיש גם ליד חי, duplicate_of מצביע על החי ולא על הישן.
    psql(DB, sql_text="""
      select public.scraped_lead_add(jsonb_build_object(
        'lead_type', 'owner_inbound', 'source', 'madlan',
        'external_ref', 'https://www.madlan.co.il/listings/only-rejected',
        'city', 'עפולה', 'deal_type', 'sale', 'rooms', 8, 'budget', 770000,
        'date_known', false
      ))
    """)
    if psql(DB, sql_text="""
      select is_duplicate::text || '|' || coalesce(duplicate_of::text, '')
        from public.scraped_leads
       where external_ref = 'madlan.co.il/listings/only-rejected'
    """) != "false|":
        fail("מדלן חדש סומן בגלל ליד rejected")
    psql(DB, sql_text="""
      select public.scraped_lead_add(jsonb_build_object(
        'lead_type', 'owner_inbound', 'source', 'madlan',
        'external_ref', 'https://www.madlan.co.il/listings/rej-and-live',
        'city', 'עפולה', 'deal_type', 'sale', 'rooms', 8, 'budget', 880000,
        'date_known', false
      ))
    """)
    picked = psql(DB, sql_text="""
      select is_duplicate::text || '|' || coalesce(duplicate_of::text, '')
             || '|' || coalesce(duplicate_match->>'lead_count', '')
        from public.scraped_leads
       where external_ref = 'madlan.co.il/listings/rej-and-live'
    """)
    if picked != "true|aaaaaaaa-0000-0000-0000-000000000022|1":
        fail(f"duplicate_of לא דילג על rejected: {picked}")
    notify_after = psql(DB, sql_text="select count(*)::text from public._notify_log")
    if int(notify_after) <= int(notify_before):
        fail("ההתראה לא נקראה על שורה שנקלטה, כולל מסומנת")

    # סנכרון: שורה חדשה מסומנת, שורה ישנה לא, והתשובה באותה צורה.
    def sync(source, city, items):
        array = "jsonb_build_array(" + ", ".join(items) + ")"
        return psql(DB, sql_text=f"""
          select (r->>'added') || '|' || (r->>'updated') || '|' || (r->>'removed')
                 || '|' || (r->>'new_leads') || '|' || (r->>'seeded')
                 || '|' || (r->>'removals_skipped')
                 || '|' || (select string_agg(k, ',' order by k) from jsonb_object_keys(r) k)
            from (select public.listing_inventory_sync('{source}', '{city}', {array}) as r) s
        """)

    def item(url, price, rooms=4, deal="sale"):
        return (
            "jsonb_build_object('url', '%s', 'deal_type', '%s', 'rooms', %s, 'price', %s, "
            "'property_type', 'דירה')" % (url, deal, rooms, price)
        )

    first = sync("yad2", "נצרת", [item("https://www.yad2.co.il/realestate/item/nz1", 2000000)])
    if first != "1|0|0|0|true|false|added,new_leads,price_changes,removals_skipped,removed,seeded,updated":
        fail(f"זריעת נצרת: {first}")
    if psql(DB, sql_text="""
      select is_duplicate::text from public.listing_inventory
       where external_ref = 'yad2.co.il/realestate/item/nz1'
    """) != "false":
        fail("זריעה בלי לוח שני סומנה")
    second = sync("madlan", "נצרת", [item("https://www.madlan.co.il/listings/nz1", 2000000)])
    if not second.startswith("1|0|0|0|true|false|"):
        fail(f"זריעת מדלן: {second}")
    mad = psql(DB, sql_text="""
      select is_duplicate::text || '|' || coalesce(duplicate_of::text, '')
        from public.listing_inventory
       where external_ref = 'madlan.co.il/listings/nz1'
    """)
    yad_id = psql(DB, sql_text="""
      select id::text from public.listing_inventory
       where external_ref = 'yad2.co.il/realestate/item/nz1'
    """)
    if mad != "true|" + yad_id:
        fail(f"מדלן חדש לא הצביע על יד2: {mad}")
    if psql(DB, sql_text="""
      select is_duplicate::text from public.listing_inventory
       where external_ref = 'yad2.co.il/realestate/item/nz1'
    """) != "false":
        fail("סנכרון סימן שורה שכבר הייתה")
    # בלי זה תמונה של 2 מול זריעה של 1 נחשבת השלמת זריעה, בלי ליד.
    psql(DB, sql_text="""
      update public.listing_inventory_seeds
         set item_count = 100, seeded_at = now() - interval '10 days'
       where source = 'yad2' and city = 'נצרת'
    """)
    notes = psql(DB, sql_text="select count(*)::text from public._notify_log")
    third = sync("yad2", "נצרת", [
        item("https://www.yad2.co.il/realestate/item/nz1", 2000000),
        item("https://www.yad2.co.il/realestate/item/nz2", 2000000),
    ])
    if not third.startswith("1|1|0|1|false|false|"):
        fail(f"מודעה חדשה אחרי זריעה: {third}")
    if psql(DB, sql_text="""
      select is_duplicate::text from public.listing_inventory
       where external_ref = 'yad2.co.il/realestate/item/nz1'
    """) != "false":
        fail("סנכרון סימן שורה ישנה שוב")
    if psql(DB, sql_text="""
      select is_duplicate::text || '|' || coalesce(duplicate_of::text, '')
        from public.listing_inventory
       where external_ref = 'yad2.co.il/realestate/item/nz2'
    """) != "true|" + psql(DB, sql_text="""
      select id::text from public.listing_inventory
       where external_ref = 'madlan.co.il/listings/nz1'
    """):
        fail("מודעת יד2 חדשה לא סומנה")
    lead_flag = psql(DB, sql_text="""
      select s.is_duplicate::text
        from public.listing_inventory i
        join public.scraped_leads s on s.id = i.scraped_lead_id
       where i.external_ref = 'yad2.co.il/realestate/item/nz2'
    """)
    if lead_flag != "true":
        fail(f"הליד של המודעה החדשה לא סומן: {lead_flag}")
    if psql(DB, sql_text="select count(*)::text from public._notify_log") == notes:
        fail("ליד מסומן לא קרא להתראה")

    # הרצה נוספת מסמנת גם את הצד הוותיק, בלי לגעת בשאר העמודות.
    price_before = psql(DB, sql_text="""
      select price::text || '|' || coalesce(lead_skip_reason, '')
        from public.listing_inventory
       where external_ref = 'yad2.co.il/realestate/item/nz1'
    """)
    psql(DB, MIG)
    if psql(DB, sql_text="""
      select is_duplicate::text from public.listing_inventory
       where external_ref = 'yad2.co.il/realestate/item/nz1'
    """) != "true":
        fail("מילוי חוזר לא סימן את הצד הוותיק")
    if psql(DB, sql_text="""
      select price::text || '|' || coalesce(lead_skip_reason, '')
        from public.listing_inventory
       where external_ref = 'yad2.co.il/realestate/item/nz1'
    """) != price_before:
        fail("המילוי שינה עמודה שאינה הסימון")
    sync("yad2", "נצרת", [
        item("https://www.yad2.co.il/realestate/item/nz1", 2100000),
        item("https://www.yad2.co.il/realestate/item/nz2", 2000000),
    ])
    if psql(DB, sql_text="""
      select is_duplicate::text || '|' || price::text
        from public.listing_inventory
       where external_ref = 'yad2.co.il/realestate/item/nz1'
    """) != "true|2100000":
        fail("עדכון מחיר מחק את הסימון או לא שמר את המחיר")
    eq(
        "select has_function_privilege('anon', 'public.board_cross_source_match(text,text,uuid,text,numeric,numeric,uuid,uuid)', 'execute')::text",
        "false",
        "anon על פונקציית ההתאמה",
    )
    eq(
        "select has_function_privilege('service_role', 'public.board_cross_source_match(text,text,uuid,text,numeric,numeric,uuid,uuid)', 'execute')::text",
        "true",
        "service_role על פונקציית ההתאמה",
    )
    print("board cross source: ok")


if __name__ == "__main__":
    try:
        main()
    finally:
        subprocess.run(["dropdb", "--if-exists", "--maintenance-db=postgres", DB], check=False)
