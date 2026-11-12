#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""מלאי יד2/מדלן: זריעה שקטה, ליד אחד, מחיקה, תמונה ריקה, ובלי חיוב.

    python3 scripts/listing_inventory_test.py
"""

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIG = ROOT / "supabase/migrations/20271112130000_listing_inventory_yad2.sql"
REF_SQL = ROOT / "supabase/migrations/20270812090000_scraped_leads.sql"
DB = os.environ.get("LISTING_INVENTORY_DB", "listing_inventory_test")
CITY_ID = "11111111-1111-1111-1111-111111111111"
AGENT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1"
AGENCY = "33333333-3333-3333-3333-333333333333"

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
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table public.cities (id uuid primary key);
insert into public.cities (id) values ('11111111-1111-1111-1111-111111111111');

create table public.neighborhoods (
  id uuid primary key,
  city_id uuid,
  name text
);
create table public.agencies (id uuid primary key, city_id uuid);
create table public.agency_members (
  id uuid primary key,
  agency_id uuid,
  active boolean not null default true,
  tier text not null default 'mid',
  credit_balance numeric not null default 100,
  released_at timestamptz,
  license_status text
);
insert into public.agencies (id, city_id) values ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111');
insert into public.agency_members (id, agency_id, tier, credit_balance)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', '33333333-3333-3333-3333-333333333333', 'free', 100);

create table public.pricing_config (key text primary key, value int not null);
insert into public.pricing_config (key, value) values
  ('scraped_lead_matching_enabled', 0),
  ('open_demand_notify_cap_enabled', 0),
  ('notif_burst_demand_fanout', 15),
  ('notif_burst_scraped_stale_days', 14);

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
  consent_answered_at timestamptz,
  open_demand_at timestamptz,
  lead_id uuid,
  demand_notified_at timestamptz,
  claimed_by uuid,
  claimed_at timestamptz,
  no_broker text,
  demand_summary text,
  phone_hash text,
  push_site_only boolean not null default false,
  date_known boolean not null default false,
  source_post_url text,
  created_at timestamptz not null default now()
);
create unique index scraped_leads_source_ref_uq on public.scraped_leads (source, external_ref);
create table public.scraped_lead_blocks (
  ref_hash text primary key,
  expires_at timestamptz not null
);
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid,
  type text,
  title text,
  body text,
  suppress_push boolean,
  created_at timestamptz not null default now()
);
create table public.whatsapp_conversations (agent_id uuid, last_message_at timestamptz);
create table public.agent_lead_preferences (
  agent_id uuid,
  active boolean,
  preferred_neighborhoods uuid[]
);
create table public.scraped_lead_match_dispatch (
  scraped_lead_id uuid,
  agent_id uuid
);

create function public.phone_tail9(p text)
returns text language sql immutable set search_path = '' as $$
  select case when length(regexp_replace(coalesce(p, ''), '\D', '', 'g')) >= 9
              then right(regexp_replace(p, '\D', '', 'g'), 9) end;
$$;
create function public.city_id_for_name(p text)
returns uuid language sql stable as $$
  select '11111111-1111-1111-1111-111111111111'::uuid;
$$;
create function public.scraped_lead_no_broker(p text)
returns boolean language sql immutable as $$ select false $$;
create function public.scraped_leads_launch_active()
returns boolean language sql stable as $$ select false $$;
create function public.agent_works_city(p_agent uuid, p_city uuid)
returns boolean language sql stable as $$ select true $$;
create function public.agent_handles_type(p_agent uuid, p_type text, p_deal text)
returns boolean language sql stable as $$ select true $$;
create function public.social_post_host_ok(p_url text)
returns boolean language sql stable as $$ select false $$;
create function public.social_buyer_is_dm(p_source text, p_lead_type text)
returns boolean language sql stable as $$ select false $$;
"""


def psql(db, *files, sql_text=None):
    cmd = ["psql", "-v", "ON_ERROR_STOP=1", "-q", "-tA", "-d", db]
    if sql_text is not None:
        cmd.extend(["-c", sql_text])
    for path in files:
        cmd.extend(["-f", str(path)])
    return subprocess.check_output(
        cmd,
        env={**os.environ, "PGOPTIONS": "-c client_min_messages=warning"},
        text=True,
        stderr=subprocess.STDOUT,
    ).strip()


def fail(msg):
    sys.exit(msg)


def item(url, phone=None, price=None):
    parts = [
        f"'url', '{url}'",
        "'deal_type', 'sale'",
        "'property_type', 'דירה'",
        "'rooms', 4",
        "'summary', 'דירת 4 חדרים'",
    ]
    if phone:
        parts.append(f"'raw_phone', '{phone}'")
    if price is not None:
        parts.append(f"'price', {price}")
    return "jsonb_build_object(" + ", ".join(parts) + ")"


def sync_once(db, city, items):
    array = "jsonb_build_array(" + ", ".join(items) + ")" if items else "'[]'::jsonb"
    return psql(db, sql_text=f"""
      select (r->>'added') || '|' || (r->>'updated') || '|' || (r->>'removed')
             || '|' || (r->>'new_leads') || '|' || (r->>'seeded')
             || '|' || (r->>'removals_skipped')
        from (select public.listing_inventory_sync('yad2', '{city}', {array}) as r) s
    """)


def main():
    subprocess.check_call(["dropdb", "--if-exists", "--maintenance-db=postgres", DB])
    subprocess.check_call(["createdb", "--maintenance-db=postgres", DB])
    psql(DB, sql_text=SETUP)
    ref_sql = REF_SQL.read_text(encoding="utf-8")
    ref_start = ref_sql.index("create or replace function public.scraped_lead_ref")
    ref_end = ref_sql.index("revoke all on function public.scraped_lead_ref", ref_start)
    psql(DB, sql_text=ref_sql[ref_start:ref_end])
    psql(DB, MIG)
    psql(DB, MIG)

    leaked_fn = psql(DB, sql_text="""
      select has_function_privilege('anon', 'public.listing_inventory_sync(text,text,jsonb)', 'execute')::text
          || '|' ||
             has_function_privilege('authenticated', 'public.listing_inventory_sync(text,text,jsonb)', 'execute')::text
          || '|' ||
             has_function_privilege('service_role', 'public.listing_inventory_sync(text,text,jsonb)', 'execute')::text
    """)
    if leaked_fn != "false|false|true":
        fail(f"הרשאת listing_inventory_sync: {leaked_fn}")
    leaked_tbl = psql(DB, sql_text="""
      select has_table_privilege('anon', 'public.listing_inventory', 'select')::text
          || '|' ||
             has_table_privilege('authenticated', 'public.listing_inventory', 'select')::text
          || '|' ||
             has_table_privilege('service_role', 'public.listing_inventory', 'select')::text
          || '|' ||
             (select relrowsecurity::text from pg_class where relname = 'listing_inventory')
    """)
    if leaked_tbl != "false|false|true|true":
        fail(f"הרשאת listing_inventory: {leaked_tbl}")
    phone_cols = psql(DB, sql_text="""
      select count(*)::text from information_schema.columns
       where table_schema = 'public'
         and table_name in ('listing_inventory', 'listing_inventory_sync_log', 'listing_inventory_seeds')
         and column_name ~ '(phone|raw_name|owner)'
    """)
    if phone_cols != "0":
        fail(f"עמודת טלפון או שם במלאי: {phone_cols}")

    if "missing_posted_at" not in psql(DB, sql_text="""
      select public.scraped_lead_add(jsonb_build_object(
        'lead_type', 'owner_inbound', 'source', 'facebook_group',
        'external_ref', 'https://facebook.com/groups/1/posts/1',
        'city', 'עפולה', 'raw_phone', '0500000001'))::text
    """):
        fail("פייסבוק בלי תאריך התקבל")
    if psql(DB, sql_text="select public.lead_source_channel('yad2')") != "social":
        fail("yad2 לא בערוץ social")

    first_073 = psql(DB, sql_text="""
      select public.scraped_lead_add(jsonb_build_object(
        'lead_type', 'owner_inbound', 'source', 'yad2',
        'external_ref', 'https://www.yad2.co.il/realestate/item/virt1',
        'city', 'עפולה', 'raw_phone', '073-999-0001'))::text
    """)
    if "success" not in first_073:
        fail(f"יד2 עם 073 נדחה: {first_073}")
    second_073 = psql(DB, sql_text="""
      select public.scraped_lead_add(jsonb_build_object(
        'lead_type', 'owner_inbound', 'source', 'yad2',
        'external_ref', 'https://www.yad2.co.il/realestate/item/virt2',
        'city', 'עפולה', 'raw_phone', '0739990001')) ->> 'duplicate'
    """)
    if second_073 != "phone":
        fail(f"073 ביד2 לא אוחד: {second_073}")
    no_contact = psql(DB, sql_text="""
      select public.scraped_lead_set_consent(
        (select id from public.scraped_leads where external_ref like '%virt1'),
        'consented') ->> 'error'
    """)
    if no_contact != "no_owner_contact":
        fail(f"הסכמה על יד2 לא נחסמה: {no_contact}")

    psql(DB, sql_text=f"""
      insert into public.leads (lead_type, agent_id, status, source, raw_phone, city)
      values ('owner_inbound', '{AGENT}', 'masked', 'yad2', '0520000099', 'עפולה');
    """)
    price = psql(DB, sql_text=f"""
      select public.claim_lead(
               (select id from public.leads where source = 'yad2' and status = 'masked' limit 1),
               '{AGENT}') ->> 'price_charged'
    """)
    charged = psql(DB, sql_text=f"""
      select (select credit_balance::int::text from public.agency_members where id = '{AGENT}')
             || '|' ||
             (select quota_source from public.leads where source = 'yad2' and status = 'unlocked' limit 1)
    """)
    if price != "0" or charged != "100|yad2_free":
        fail(f"ליד יד2 חויב: {price} {charged}")

    # זריעה שקטה. בלי ליד ובלי התראה.
    seed_items = [
        item("https://www.yad2.co.il/realestate/item/seed1"),
        item("https://www.yad2.co.il/realestate/item/seed2"),
    ]
    seeded = sync_once(DB, "עפולה", seed_items)
    if seeded != "2|0|0|0|true|false":
        fail(f"זריעה: {seeded}")
    if psql(DB, sql_text="""
      select count(*)::text || '|' || bool_and(from_seed)::text || '|' || bool_and(scraped_lead_id is null)::text
        from public.listing_inventory where city = 'עפולה'
    """) != "2|true|true":
        fail("הזריעה פתחה ליד")
    if psql(DB, sql_text="select count(*) from public.notifications") != "0":
        fail("הזריעה כתבה התראה")
    if psql(DB, sql_text="select count(*) from public.scraped_leads where city = 'עפולה' and external_ref like '%seed%'") != "0":
        fail("הזריעה כתבה scraped lead")

    psql(DB, sql_text="update public.app_config set value = '1' where key = 'madlan_notify_daily_cap'")
    psql(DB, sql_text="delete from public.notifications")
    fresh = sync_once(DB, "עפולה", seed_items + [
        item("https://www.yad2.co.il/realestate/item/a-new", "0501000001", 1500000),
        item("https://www.yad2.co.il/realestate/item/b-new", "0501000002", 1600000),
    ])
    if fresh != "2|2|0|2|false|false":
        fail(f"מודעות חדשות: {fresh}")
    caps = psql(DB, sql_text="""
      select (count(*) filter (where not push_site_only))::text || '|' ||
             (count(*) filter (where push_site_only))::text || '|' ||
             bool_and(date_known)::text
        from public.scraped_leads
       where source = 'yad2'
         and external_ref in ('yad2.co.il/realestate/item/a-new', 'yad2.co.il/realestate/item/b-new')
    """)
    if caps != "1|1|true":
        fail(f"תקרה על מודעות חדשות: {caps}")
    note = psql(DB, sql_text="""
      select count(*)::text || '|' || bool_and(body like '%המערכת לא פונה לבעלים%')::text
        from public.notifications where type = 'open_demand'
    """)
    if note != "1|true":
        fail(f"התראה על יד2: {note}")
    again = sync_once(DB, "עפולה", seed_items + [
        item("https://www.yad2.co.il/realestate/item/a-new", "0501000001", 1510000),
        item("https://www.yad2.co.il/realestate/item/b-new", "0501000002", 1600000),
    ])
    if again != "0|4|0|0|false|false":
        fail(f"סנכרון חוזר פתח ליד: {again}")
    if psql(DB, sql_text="select count(*) from public.notifications where type = 'open_demand'") != "1":
        fail("סנכרון חוזר הוסיף התראה")
    if psql(DB, sql_text="""
      select price::int::text from public.listing_inventory
       where external_ref = 'yad2.co.il/realestate/item/a-new'
    """) != "1510000":
        fail("מחיר לא התעדכן")
    madlan_push = psql(DB, sql_text="""
      select (public.scraped_lead_add(jsonb_build_object(
        'lead_type', 'owner_inbound', 'source', 'madlan',
        'external_ref', 'https://www.madlan.co.il/listings/cap1',
        'first_seen_at', now(), 'date_known', true,
        'city', 'עפולה', 'raw_phone', '0501000099')) ->> 'push_site_only')
    """)
    if madlan_push != "true":
        fail(f"מדלן לא נספר בתקרה המשותפת: {madlan_push}")

    # מחיקה כשהתמונה עדיין רוב המלאי, ושמירה כשהיא ריקה.
    removed_seed = sync_once(DB, "נצרת", [
        item("https://www.yad2.co.il/realestate/item/n1"),
        item("https://www.yad2.co.il/realestate/item/n2"),
        item("https://www.yad2.co.il/realestate/item/n3"),
    ])
    if not removed_seed.endswith("|true|false"):
        fail(f"זריעת נצרת: {removed_seed}")
    gone = sync_once(DB, "נצרת", [
        item("https://www.yad2.co.il/realestate/item/n1"),
        item("https://www.yad2.co.il/realestate/item/n2"),
    ])
    if gone != "0|2|1|0|false|false":
        fail(f"סימון ירידה: {gone}")
    if psql(DB, sql_text="""
      select (removed_at is not null)::text from public.listing_inventory
       where external_ref = 'yad2.co.il/realestate/item/n3'
    """) != "true":
        fail("n3 לא סומן כיורד")
    kept = sync_once(DB, "נצרת", [])
    if kept != "0|0|0|0|false|true":
        fail(f"תמונה ריקה מחקה: {kept}")
    if psql(DB, sql_text="""
      select count(*)::text from public.listing_inventory
       where city = 'נצרת' and removed_at is null
    """) != "2":
        fail("תמונה ריקה כיבתה מודעות חיות")
    if psql(DB, sql_text="""
      select note from public.listing_inventory_sync_log
       where city = 'נצרת' order by created_at desc limit 1
    """) != "empty_snapshot":
        fail("היומן לא רשם תמונה ריקה")

    # פחות ממחצית: לא מוחקים.
    sync_once(DB, "חיפה", [
        item("https://www.yad2.co.il/realestate/item/h1"),
        item("https://www.yad2.co.il/realestate/item/h2"),
        item("https://www.yad2.co.il/realestate/item/h3"),
    ])
    partial = sync_once(DB, "חיפה", [item("https://www.yad2.co.il/realestate/item/h1")])
    if partial != "0|1|0|0|false|true":
        fail(f"תמונה חלקית מחקה: {partial}")
    if psql(DB, sql_text="""
      select count(*)::text from public.listing_inventory
       where city = 'חיפה' and removed_at is null
    """) != "3":
        fail("תמונה חלקית סימנה ירידה")

    # הצעה חוזרת אחרי 30 יום רק אם המודעה חיה.
    sync_once(DB, "עכו", [item("https://www.yad2.co.il/realestate/item/akko-seed")])
    opened = sync_once(DB, "עכו", [
        item("https://www.yad2.co.il/realestate/item/akko-seed"),
        item("https://www.yad2.co.il/realestate/item/akko-new", "0501000003", 900000),
    ])
    if not opened.endswith("|1|false|false") or not opened.startswith("1|1|0|"):
        fail(f"ליד עכו: {opened}")
    psql(DB, sql_text="delete from public.scraped_leads where city = 'עכו'")
    too_soon = sync_once(DB, "עכו", [
        item("https://www.yad2.co.il/realestate/item/akko-seed"),
        item("https://www.yad2.co.il/realestate/item/akko-new", "0501000003", 900000),
    ])
    if not too_soon.endswith("|0|false|false"):
        fail(f"הצעה לפני 30 יום: {too_soon}")
    psql(DB, sql_text="""
      update public.listing_inventory
         set lead_offered_at = now() - interval '31 days'
       where external_ref = 'yad2.co.il/realestate/item/akko-new'
    """)
    reoffer = sync_once(DB, "עכו", [
        item("https://www.yad2.co.il/realestate/item/akko-seed"),
        item("https://www.yad2.co.il/realestate/item/akko-new", "0501000003", 900000),
    ])
    if not reoffer.endswith("|1|false|false"):
        fail(f"הצעה אחרי 30 יום: {reoffer}")
    before_dead = psql(DB, sql_text="select count(*) from public.scraped_leads where city = 'עכו'")
    psql(DB, sql_text="""
      delete from public.scraped_leads where city = 'עכו';
      update public.listing_inventory
         set lead_offered_at = now() - interval '31 days'
       where external_ref = 'yad2.co.il/realestate/item/akko-new';
    """)
    dead = sync_once(DB, "עכו", [item("https://www.yad2.co.il/realestate/item/akko-seed")])
    after_dead = psql(DB, sql_text="select count(*) from public.scraped_leads where city = 'עכו'")
    removed_flag = psql(DB, sql_text="""
      select (removed_at is not null)::text from public.listing_inventory
       where external_ref = 'yad2.co.il/realestate/item/akko-new'
    """)
    if not dead.endswith("|0|false|false") or after_dead != "0" or removed_flag != "true":
        fail(f"מודעה שירדה הוצעה שוב: {dead} leads {before_dead}->{after_dead} removed={removed_flag}")

    canon = sync_once(DB, "נהריה", [
        item("https://www.yad2.co.il/realestate/item/canon?utm_source=x"),
    ])
    if not canon.startswith("1|0|0|0|true|"):
        fail(f"זריעת כתובת: {canon}")
    again_canon = sync_once(DB, "נהריה", [
        item("https://m.yad2.co.il/realestate/item/canon"),
    ])
    if again_canon != "0|1|0|0|false|false":
        fail(f"אותה מודעה נספרה פעמיים: {again_canon}")
    if psql(DB, sql_text="""
      select external_ref from public.listing_inventory where city = 'נהריה'
    """) != "yad2.co.il/realestate/item/canon":
        fail("המזהה הקנוני לא נשמר")

    sync_once(DB, "טבריה", [item("https://www.yad2.co.il/realestate/item/t-seed")])
    array = "jsonb_build_array(" + ", ".join([
        item("https://www.yad2.co.il/realestate/item/t-seed"),
        item("https://www.yad2.co.il/realestate/item/t-new", "0501000004", 700000),
    ]) + ")"
    sql = f"select public.listing_inventory_sync('yad2', 'טבריה', {array})::text"
    procs = [
        subprocess.Popen(
            ["psql", "-v", "ON_ERROR_STOP=1", "-q", "-tA", "-d", DB, "-c", sql],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        for _ in range(2)
    ]
    outs = []
    for proc in procs:
        out, err = proc.communicate(timeout=30)
        if proc.returncode != 0:
            fail(f"סנכרון מקבילי נכשל: {err or out}")
        outs.append(out.strip())
    leads = psql(DB, sql_text="""
      select count(*)::text from public.scraped_leads
       where external_ref = 'yad2.co.il/realestate/item/t-new'
    """)
    if leads != "1":
        fail(f"סנכרון מקבילי פתח {leads} לידים: {outs}")

    print("listing inventory: ok")


if __name__ == "__main__":
    main()
