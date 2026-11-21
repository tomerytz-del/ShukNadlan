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
PHONELESS = ROOT / "supabase/migrations/20271115130000_board_lead_without_phone.sql"
HISTORY = ROOT / "supabase/migrations/20271119140000_listing_inventory_price_history.sql"
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
  property_id uuid,
  neighborhood_id uuid,
  property_details text,
  referred_by uuid,
  referred_at timestamptz,
  origin_id uuid,
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
alter table public.scraped_leads add constraint scraped_leads_source_check
  check (source ~ '^[a-z_]{3,40}$');
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


def board_listing_url_stays_on_the_card():
    """העמודה היא כפתור ב-CRM. היא לא נכנסת לטקסט של התראה, וואטסאפ או מייל."""
    mig = PHONELESS.read_text(encoding="utf-8")
    notify = mig.split("create or replace function public.scraped_lead_notify_demand", 1)[1]
    notify = notify.split("create or replace view public.leads_masked", 1)[0]
    if "board_listing_url" in notify:
        fail("scraped_lead_notify_demand מזכיר את board_listing_url")
    add = mig.split("create or replace function public.scraped_lead_add", 1)[1]
    add = add.split("create or replace function public.scraped_lead_notify_demand", 1)[0]
    if "board_listing_url" in add:
        fail("scraped_lead_add מזכיר את board_listing_url")
    allowed = {ROOT / "assets" / "crm.js"}
    for base in (ROOT / "supabase" / "functions", ROOT / "assets"):
        for path in base.rglob("*"):
            if path.suffix not in {".ts", ".js", ".mjs"} or path in allowed:
                continue
            text = path.read_text(encoding="utf-8", errors="replace")
            if "board_listing_url" in text:
                fail(f"board_listing_url מחוץ לכרטיס הליד: {path.relative_to(ROOT)}")


def whatsapp_template_line_has_no_board_url():
    """שורת התבנית של מודעת לוח לא מקבלת action_url ולא board_listing_url."""
    push = (ROOT / "supabase/functions/notification-push/index.ts").read_text(encoding="utf-8")
    call = push.split("leadTemplateLine(", 1)[1].split(")", 1)[0]
    if "action_url" in call or "board_listing_url" in call:
        fail(f"leadTemplateLine מקבל כתובת של מודעה: {call}")
    if "const url = !board && withUrls" not in push:
        fail("תבנית הוואטסאפ עדיין מדביקה כתובת למודעת לוח")
    script = r"""
import { leadTemplateLine } from "./supabase/functions/notification-push/lead-alert.ts";
const listing = "https://www.yad2.co.il/realestate/item/abc";
const madlan = "https://www.madlan.co.il/listings/abc";
const crm = "https://shuknadlan.co.il/crm?goto=accLeads&lead=1";
const base = { masked: false, leadType: "owner_inbound", name: "מודעה", what: "דירה", excerpt: "", hasPhone: false };
for (const [source, url] of [["יד2", listing], ["מדלן", madlan]]) {
  for (const passed of [url, crm, null]) {
    const line = leadTemplateLine({ ...base, source }, passed, true);
    if (/https?:\/\//.test(line) || line.includes("yad2.co.il") || line.includes("madlan.co.il")) {
      console.error(source, line);
      process.exit(1);
    }
  }
}
const other = leadTemplateLine({ ...base, source: "קבוצת פייסבוק", hasPhone: true }, crm, true);
if (!other.endsWith(crm)) process.exit(2);
process.stdout.write("ok");
"""
    out = subprocess.check_output(
        ["node", "--experimental-strip-types", "--input-type=module", "-e", script],
        cwd=ROOT,
        text=True,
        stderr=subprocess.STDOUT,
    )
    if out.strip() != "ok":
        fail(f"שורת התבנית: {out}")


def detailed(url, price=None, **extra):
    parts = [f"'url', '{url}'", "'deal_type', 'sale'", "'property_type', 'דירה'", "'rooms', 4"]
    if price is not None:
        parts.append(f"'price', {price}")
    for key, value in extra.items():
        parts.append(f"'{key}', {value}")
    return "jsonb_build_object(" + ", ".join(parts) + ")"


def price_changes(db, city, items):
    array = "jsonb_build_array(" + ", ".join(items) + ")"
    return psql(db, sql_text=f"""
      select public.listing_inventory_sync('yad2', '{city}', {array}) ->> 'price_changes'
    """)


def price_history_and_details():
    """שינוי מחיר נרשם פעם אחת, ושטח, קומה ושכונה נשמרים בלי לדרוס בריק."""
    base = "https://www.yad2.co.il/realestate/item/"
    city = "חדרה"
    hist = """
      select coalesce(string_agg(old_price::int::text || '>' || new_price::int::text, ','
                                 order by changed_at, old_price), '')
        from public.listing_inventory_price_history where city = 'חדרה'
    """
    leaked = psql(DB, sql_text="""
      select has_table_privilege('anon', 'public.listing_inventory_price_history', 'select')::text
          || '|' ||
             has_table_privilege('authenticated', 'public.listing_inventory_price_history', 'select')::text
          || '|' ||
             has_table_privilege('service_role', 'public.listing_inventory_price_history', 'insert')::text
          || '|' ||
             (select relrowsecurity::text from pg_class where relname = 'listing_inventory_price_history')
    """)
    if leaked != "false|false|true|true":
        fail(f"הרשאת listing_inventory_price_history: {leaked}")
    if psql(DB, sql_text="""
      select count(*)::text from information_schema.columns
       where table_schema = 'public' and table_name = 'listing_inventory_price_history'
         and column_name ~ '(phone|raw_name|owner)'
    """) != "0":
        fail("עמודת טלפון או שם בהיסטוריית המחירים")

    # מחיר ראשון אינו שינוי.
    first = price_changes(DB, city, [
        detailed(base + "h1", 1500000, size_sqm=100, floor=3, neighborhood="'גבעת אולגה'"),
        detailed(base + "h2", 2000000),
        detailed(base + "h3"),
    ])
    if first != "0" or psql(DB, sql_text=hist) != "":
        fail(f"מחיר ראשון נרשם כשינוי: {first}")
    row = psql(DB, sql_text="""
      select size_sqm::int::text || '|' || floor::text || '|' || neighborhood
        from public.listing_inventory where external_ref like '%/h1'
    """)
    if row != "100|3|גבעת אולגה":
        fail(f"שטח, קומה ושכונה לא נשמרו: {row}")

    # ירידה ב-h1. h2 בלי מחיר בתמונה: לא שינוי, והמחיר הקיים נשאר.
    # h3 מקבל מחיר ראשון: לא שינוי. h1 בלי הפרטים: הם לא נדרסים.
    second = price_changes(DB, city, [
        detailed(base + "h1", 1450000),
        detailed(base + "h2"),
        detailed(base + "h3", 900000),
    ])
    if second != "1" or psql(DB, sql_text=hist) != "1500000>1450000":
        fail(f"ירידת מחיר: {second} {psql(DB, sql_text=hist)}")
    kept = psql(DB, sql_text="""
      select (select price::int::text from public.listing_inventory where external_ref like '%/h2')
             || '|' ||
             (select size_sqm::int::text || '|' || floor::text || '|' || neighborhood
                from public.listing_inventory where external_ref like '%/h1')
    """)
    if kept != "2000000|100|3|גבעת אולגה":
        fail(f"ערך חסר דרס ערך קיים: {kept}")

    # אותה תמונה שוב: אין שורה שנייה.
    again = price_changes(DB, city, [
        detailed(base + "h1", 1450000),
        detailed(base + "h2", 2000000),
        detailed(base + "h3", 900000),
    ])
    if again != "0" or psql(DB, sql_text=hist) != "1500000>1450000":
        fail(f"סנכרון חוזר רשם שינוי: {again}")

    # עלייה נרשמת גם היא, והיומן סופר.
    third = price_changes(DB, city, [
        detailed(base + "h1", 1450000),
        detailed(base + "h2", 2100000),
        detailed(base + "h3", 900000),
    ])
    if third != "1" or psql(DB, sql_text=hist) != "1500000>1450000,2000000>2100000":
        fail(f"עליית מחיר: {third} {psql(DB, sql_text=hist)}")
    logged = psql(DB, sql_text="""
      select string_agg(price_changes::text, ',' order by created_at)
        from public.listing_inventory_sync_log where city = 'חדרה'
    """)
    if logged != "0,1,0,1":
        fail(f"price_changes ביומן: {logged}")

    # ערכים לא סבירים נזרקים, והמודעה עצמה נשמרת. קומת קרקע היא 0.
    price_changes(DB, city, [
        detailed(base + "h1", 1450000),
        detailed(base + "h2", 2100000),
        detailed(base + "h3", 900000),
        detailed(base + "h4", 800000, size_sqm=2, floor=3.5, neighborhood="'   '"),
        detailed(base + "h5", 800000, size_sqm="'abc'", floor=0),
    ])
    odd = psql(DB, sql_text="""
      select string_agg(coalesce(size_sqm::text, '-') || '/' || coalesce(floor::text, '-')
                        || '/' || coalesce(neighborhood, '-'), ',' order by external_ref)
        from public.listing_inventory where external_ref ~ '/h[45]$'
    """)
    if odd != "-/-/-,-/0/-":
        fail(f"ערך לא סביר לא נזרק: {odd}")

    # מודעה שירדה וחזרה במחיר אחר: שינוי אחד.
    price_changes(DB, city, [
        detailed(base + "h2", 2100000),
        detailed(base + "h3", 900000),
        detailed(base + "h4", 800000),
        detailed(base + "h5", 800000),
    ])
    back = price_changes(DB, city, [
        detailed(base + "h1", 1400000),
        detailed(base + "h2", 2100000),
        detailed(base + "h3", 900000),
        detailed(base + "h4", 800000),
        detailed(base + "h5", 800000),
    ])
    if back != "1":
        fail(f"מודעה שחזרה במחיר אחר: {back}")

    # הרישום הוא בטריגר: גם עדכון שאינו עובר בסנכרון נרשם, ועדכון בלי שינוי לא.
    psql(DB, sql_text="""
      update public.listing_inventory set price = price where external_ref like '%/h3';
      update public.listing_inventory set price = 910000 where external_ref like '%/h3';
    """)
    if psql(DB, sql_text="""
      select string_agg(old_price::int::text || '>' || new_price::int::text, ',')
        from public.listing_inventory_price_history h
        join public.listing_inventory i on i.id = h.listing_id
       where i.external_ref like '%/h3'
    """) != "900000>910000":
        fail("הטריגר לא רשם עדכון ישיר, או רשם עדכון בלי שינוי")

    # מודעה שעברה ממכירה להשכרה אינה שינוי מחיר, ומחיר שאינו מספר נזרק.
    before = psql(DB, sql_text="select count(*)::text from public.listing_inventory_price_history")
    flipped = psql(DB, sql_text="""
      select public.listing_inventory_sync('yad2', 'חדרה', jsonb_build_array(
        jsonb_build_object('url', 'https://www.yad2.co.il/realestate/item/h1',
                           'deal_type', 'rent', 'price', 5000),
        jsonb_build_object('url', 'https://www.yad2.co.il/realestate/item/h2',
                           'deal_type', 'sale', 'price', 'NaN'),
        jsonb_build_object('url', 'https://www.yad2.co.il/realestate/item/h3',
                           'deal_type', 'sale', 'price', 'Infinity'),
        jsonb_build_object('url', 'https://www.yad2.co.il/realestate/item/h4',
                           'deal_type', 'sale', 'price', 800000,
                           'neighborhood', 'הרצל 12, 052-1111111'),
        jsonb_build_object('url', 'https://www.yad2.co.il/realestate/item/h5',
                           'deal_type', 'sale', 'price', 800000,
                           'neighborhood', 'רחוב הנשיא')
      )) ->> 'price_changes'
    """)
    after = psql(DB, sql_text="select count(*)::text from public.listing_inventory_price_history")
    if flipped != "0" or before != after:
        fail(f"החלפת סוג עסקה או מחיר שאינו מספר נרשמו כשינוי: {flipped} {before} {after}")
    safe = psql(DB, sql_text="""
      select string_agg(price::text || '/' || coalesce(neighborhood, '-'), ',' order by external_ref)
        from public.listing_inventory where external_ref ~ '/h[2345]$'
    """)
    if safe != "2100000/-,910000/-,800000/-,800000/-":
        fail(f"NaN, טלפון או רחוב נשמרו במלאי: {safe}")


def latest_sync_keeps_the_new_fields():
    """הפונקציה מוחלפת כולה בכל מיגרציה. העתק מגרסה ישנה מוחק את השדות בשקט."""
    marker = "create or replace function public.listing_inventory_sync"
    defining = sorted(
        path for path in (ROOT / "supabase/migrations").glob("*.sql")
        if marker in path.read_text(encoding="utf-8").lower()
    )
    text = defining[-1].read_text(encoding="utf-8")
    start = text.lower().rindex(marker)
    # רק גוף הפונקציה: הערה או פונקציה אחרת בהמשך הקובץ אינן הוכחה.
    body = text[start:text.index("end $$;", start)]
    missing = [word for word in ("size_sqm", "neighborhood", "v_floor", "price_changes")
               if word not in body]
    if missing:
        fail(f"{defining[-1].name} מחליף את listing_inventory_sync בלי {', '.join(missing)}. "
             f"להעתיק את הגוף מהגרסה האחרונה ({HISTORY.name} או מאוחרת ממנה), לא מגרסה קודמת.")


def facebook_owner_is_inventory_not_a_second_lead(db):
    """פוסט בעלים מפייסבוק נכנס למלאי בלי ליד שני, וצילום יד2 לא מוחק אותו."""
    mig = ROOT / "supabase/migrations/20271121120000_facebook_listing_inventory.sql"
    notes = psql(db, sql_text="select count(*)::text from public.notifications")
    psql(db, sql_text="""
      create table if not exists public.agent_clients (id uuid primary key);
    """)
    psql(db, mig)
    added = psql(db, sql_text="""
      select public.scraped_lead_add(jsonb_build_object(
        'lead_type', 'owner_inbound', 'source', 'facebook_group',
        'external_ref', 'https://www.facebook.com/groups/555/posts/123456789012345/',
        'posted_at', now(), 'city', 'עפולה', 'raw_phone', '0501234999',
        'raw_name', 'לא במלאי', 'deal_type', 'sale', 'property_type', 'דירה',
        'rooms', 4, 'budget', 1000000, 'neighborhood', 'גבעת המורה',
        'size_sqm', 90, 'floor', 2,
        'property_details', 'הרצל 12')) ->> 'success'
    """)
    if added != "true":
        fail(f"פוסט פייסבוק לא נקלט: {added}")
    if psql(db, sql_text="""
      select count(*)::text from public.listing_inventory where source = 'facebook'
    """) != "0":
        fail("pending_consent נכנס למלאי")
    psql(db, sql_text="""
      update public.scraped_leads set status = 'open_demand'
       where source = 'facebook_group'
         and external_ref like '%123456789012345%';
    """)
    row = psql(db, sql_text="""
      select i.external_ref || '|' || coalesce(i.neighborhood, '-')
             || '|' || coalesce(i.size_sqm::int::text, '-')
             || '|' || coalesce(i.floor::text, '-')
             || '|' || coalesce(i.price::int::text, '-')
             || '|' || i.from_seed::text
             || '|' || (i.removed_at is null)::text
             || '|' || (i.scraped_lead_id is not null)::text
        from public.listing_inventory i
       where i.source = 'facebook'
    """)
    if row != "555:123456789012345|גבעת המורה|90|2|1000000|true|true|true":
        fail(f"שורת מלאי פייסבוק: {row}")
    leaked = psql(db, sql_text="""
      select count(*)::text from public.listing_inventory
       where source = 'facebook'
         and (coalesce(url, '') || ' ' || coalesce(neighborhood, '') || ' ' || coalesce(city, '')
              || ' ' || coalesce(external_ref, '')) ~ '(0501234999|לא במלאי|הרצל)'
    """)
    if leaked != "0":
        fail("טלפון, שם או רחוב נכנסו למלאי")
    if psql(db, sql_text="select count(*)::text from public.notifications") != notes:
        fail("קליטת פייסבוק שלחה התראה מעבר למה שכבר היה")
    again = psql(db, sql_text="""
      select public.scraped_lead_add(jsonb_build_object(
        'lead_type', 'owner_inbound', 'source', 'facebook_group',
        'external_ref', 'https://www.facebook.com/groups/555/posts/123456789012345/',
        'posted_at', now(), 'city', 'עפולה', 'raw_phone', '0501234999',
        'deal_type', 'sale', 'budget', 1100000)) ->> 'duplicate'
    """)
    if again != "post":
        fail(f"פוסט חוזר לא סומן ככפילות: {again}")
    if psql(db, sql_text="""
      select count(*)::text || '|' || price::int::text
        from public.listing_inventory where source = 'facebook'
       group by price
    """) != "1|1100000":
        fail("פוסט חוזר פתח שורה שנייה או לא עדכן מחיר")
    if psql(db, sql_text="select count(*)::text from public.notifications") != notes:
        fail("פוסט חוזר שלח התראה")
    sync_once(db, "עפולה", [])
    if psql(db, sql_text="""
      select (removed_at is null)::text from public.listing_inventory
       where source = 'facebook'
    """) != "true":
        fail("צילום יד2 ריק סימן פוסט פייסבוק כמוסר")
    if psql(db, sql_text="""
      select public.listing_inventory_sync('facebook', 'עפולה', '[]'::jsonb) ->> 'error'
    """) != "invalid_source":
        fail("סנכרון קיבל מקור facebook")


def main():
    latest_sync_keeps_the_new_fields()
    board_listing_url_stays_on_the_card()
    whatsapp_template_line_has_no_board_url()
    subprocess.check_call(["dropdb", "--if-exists", "--maintenance-db=postgres", DB])
    subprocess.check_call(["createdb", "--maintenance-db=postgres", DB])
    psql(DB, sql_text=SETUP)
    ref_sql = REF_SQL.read_text(encoding="utf-8")
    ref_start = ref_sql.index("create or replace function public.scraped_lead_ref")
    ref_end = ref_sql.index("revoke all on function public.scraped_lead_ref", ref_start)
    psql(DB, sql_text=ref_sql[ref_start:ref_end])
    psql(DB, MIG)
    psql(DB, sql_text="""
      insert into public.listing_inventory
        (source, external_ref, city, url, from_seed, lead_skip_reason, lead_attempted_at, lead_attempt_fingerprint)
      values ('yad2', 'yad2.co.il/realestate/item/skipped-phone', 'בדיקה',
              'https://www.yad2.co.il/realestate/item/skipped-phone', false,
              'missing_phone', now(), repeat('ab', 32));
      insert into public.scraped_leads
        (lead_type, source, post_url, external_ref, city, raw_phone, phone_hash,
         push_site_only, created_at)
      values ('owner_inbound', 'madlan', 'https://www.madlan.co.il/listings/virt083',
              'madlan.co.il/listings/virt083', 'עפולה', '083-111-0001', 'deadbeef',
              true, now() - interval '2 days');
    """)
    psql(DB, PHONELESS)
    backfill = psql(DB, sql_text="""
      select (i.lead_skip_reason is null)::text
             || '|' || s.push_site_only::text
             || '|' || (select count(*)::text from public.notifications)
             || '|' || (select count(*)::text from public.scraped_leads
                         where external_ref = 'yad2.co.il/realestate/item/skipped-phone')
        from public.listing_inventory i
        join public.scraped_leads s on s.id = i.scraped_lead_id
       where i.external_ref = 'yad2.co.il/realestate/item/skipped-phone'
    """)
    if backfill != "true|true|0|1":
        fail(f"הדחייה הישנה לא נשארה רק באתר: {backfill}")
    if psql(DB, sql_text="""
      select (phone_hash is null)::text from public.scraped_leads
       where external_ref = 'madlan.co.il/listings/virt083'
    """) != "true":
        fail("hash של מרכזיה 083 לא אופס")
    psql(DB, PHONELESS)
    # פעמיים: המיגרציה חייבת להיות אידמפוטנטית.
    psql(DB, HISTORY)
    psql(DB, HISTORY)

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
    # 2 ל-3 הוא מתחת לפי 2, אז זו מודעה חדשה ולא השלמת זריעה.
    fresh = sync_once(DB, "עפולה", seed_items + [
        item("https://www.yad2.co.il/realestate/item/a-new", "0501000001", 1500000),
    ])
    if fresh != "1|2|0|1|false|false":
        fail(f"מודעות חדשות: {fresh}")
    caps = psql(DB, sql_text="""
      select (count(*) filter (where not push_site_only))::text || '|' ||
             (count(*) filter (where push_site_only))::text || '|' ||
             bool_and(date_known)::text
        from public.scraped_leads
       where source = 'yad2'
         and external_ref = 'yad2.co.il/realestate/item/a-new'
    """)
    if caps != "1|0|true":
        fail(f"תקרה על מודעות חדשות: {caps}")
    note = psql(DB, sql_text="""
      select count(*)::text || '|' ||
             bool_and(
               position('0501000001' in coalesce(title, '') || ' ' || coalesce(body, '')) = 0
               and position('http' in coalesce(title, '') || ' ' || coalesce(body, '')) = 0
               and coalesce(action_url, '') = 'https://www.yad2.co.il/realestate/item/a-new'
             )::text
        from public.notifications where type = 'open_demand'
    """)
    if note != "1|true":
        fail(f"התראה על יד2: {note}")
    again = sync_once(DB, "עפולה", seed_items + [
        item("https://www.yad2.co.il/realestate/item/a-new", "0501000001", 1510000),
    ])
    if again != "0|3|0|0|false|false":
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
    # שתי שורות זריעה ואז אחת חדשה: 3/2 מתחת לפי 2, לא השלמת זריעה.
    akko_base = [
        item("https://www.yad2.co.il/realestate/item/akko-seed"),
        item("https://www.yad2.co.il/realestate/item/akko-keep"),
    ]
    sync_once(DB, "עכו", akko_base)
    opened = sync_once(DB, "עכו", akko_base + [
        item("https://www.yad2.co.il/realestate/item/akko-new", "0501000003", 900000),
    ])
    if opened != "1|2|0|1|false|false":
        fail(f"ליד עכו: {opened}")
    psql(DB, sql_text="delete from public.scraped_leads where city = 'עכו'")
    too_soon = sync_once(DB, "עכו", akko_base + [
        item("https://www.yad2.co.il/realestate/item/akko-new", "0501000003", 900000),
    ])
    if not too_soon.endswith("|0|false|false"):
        fail(f"הצעה לפני 30 יום: {too_soon}")
    psql(DB, sql_text="""
      update public.listing_inventory
         set lead_offered_at = now() - interval '31 days'
       where external_ref = 'yad2.co.il/realestate/item/akko-new'
    """)
    reoffer = sync_once(DB, "עכו", akko_base + [
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
    dead = sync_once(DB, "עכו", akko_base)
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

    sync_once(DB, "טבריה", [
        item("https://www.yad2.co.il/realestate/item/t-seed"),
        item("https://www.yad2.co.il/realestate/item/t-keep"),
    ])
    array = "jsonb_build_array(" + ", ".join([
        item("https://www.yad2.co.il/realestate/item/t-seed"),
        item("https://www.yad2.co.il/realestate/item/t-keep"),
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

    # זריעה חלקית: התמונה הבאה גדולה פי 2 בתוך יומיים, וזורעת שוב בלי לידים.
    zfat = [
        item("https://www.yad2.co.il/realestate/item/z1"),
        item("https://www.yad2.co.il/realestate/item/z2"),
    ]
    if not sync_once(DB, "צפת", zfat).endswith("|true|false"):
        fail("זריעת צפת נכשלה")
    caught = sync_once(DB, "צפת", zfat + [
        item("https://www.yad2.co.il/realestate/item/z3", "0504100001", 500000),
        item("https://www.yad2.co.il/realestate/item/z4", "0504100002", 500000),
        item("https://www.yad2.co.il/realestate/item/z5", "0504100003", 500000),
        item("https://www.yad2.co.il/realestate/item/z6", "0504100004", 500000),
    ])
    if caught != "4|2|0|0|true|false":
        fail(f"השלמת זריעה פתחה לידים: {caught}")
    if psql(DB, sql_text="""
      select count(*)::text || '|' || bool_and(from_seed)::text
             || '|' || (select item_count::text from public.listing_inventory_seeds
                         where city = 'צפת')
             || '|' || (select note from public.listing_inventory_sync_log
                         where city = 'צפת' order by created_at desc limit 1)
        from public.listing_inventory where city = 'צפת'
    """) != "6|true|6|seed_catchup":
        fail("השלמת הזריעה לא סומנה")
    if psql(DB, sql_text="select count(*) from public.scraped_leads where city = 'צפת'") != "0":
        fail("השלמת זריעה כתבה ליד")
    after = sync_once(DB, "צפת", zfat + [
        item("https://www.yad2.co.il/realestate/item/z3", "0504100001", 500000),
        item("https://www.yad2.co.il/realestate/item/z4", "0504100002", 500000),
        item("https://www.yad2.co.il/realestate/item/z5", "0504100003", 500000),
        item("https://www.yad2.co.il/realestate/item/z6", "0504100004", 500000),
        item("https://www.yad2.co.il/realestate/item/z7", "0504100005", 500000),
    ])
    if not after.endswith("|1|false|false"):
        fail(f"מודעה אחרי השלמת הזריעה: {after}")

    # מחוץ לחלון היומיים, אותה קפיצה כן פותחת לידים.
    lod = [
        item("https://www.yad2.co.il/realestate/item/l1"),
        item("https://www.yad2.co.il/realestate/item/l2"),
    ]
    sync_once(DB, "לוד", lod)
    psql(DB, sql_text="""
      update public.listing_inventory_seeds
         set seeded_at = now() - interval '3 days'
       where city = 'לוד'
    """)
    late = sync_once(DB, "לוד", lod + [
        item("https://www.yad2.co.il/realestate/item/l3", "0504200001", 400000),
        item("https://www.yad2.co.il/realestate/item/l4", "0504200002", 400000),
        item("https://www.yad2.co.il/realestate/item/l5", "0504200003", 400000),
        item("https://www.yad2.co.il/realestate/item/l6", "0504200004", 400000),
    ])
    if late != "4|2|0|4|false|false":
        fail(f"אחרי חלון הזריעה היה צריך לידים: {late}")

    # מודעת יד2 בלי טלפון נפתחת פעם אחת. סנכרון שני לא פותח עוד ליד.
    ramla = [
        item("https://www.yad2.co.il/realestate/item/r1"),
        item("https://www.yad2.co.il/realestate/item/r2"),
        item("https://www.yad2.co.il/realestate/item/r3"),
    ]
    sync_once(DB, "רמלה", ramla)
    opened = sync_once(DB, "רמלה", ramla + [
        item("https://www.yad2.co.il/realestate/item/r-new", price=800000),
    ])
    if not opened.endswith("|1|false|false"):
        fail(f"בלי טלפון לא נפתח ליד: {opened}")
    if psql(DB, sql_text="""
      select (s.raw_phone is null)::text || '|' || (s.phone_hash is null)::text
             || '|' || (i.lead_skip_reason is null)::text
             || '|' || (i.scraped_lead_id is not null)::text
        from public.listing_inventory i
        join public.scraped_leads s on s.id = i.scraped_lead_id
       where i.external_ref = 'yad2.co.il/realestate/item/r-new'
    """) != "true|true|true|true":
        fail("ליד בלי טלפון נשמר עם טלפון או בלי קשר למלאי")
    again = sync_once(DB, "רמלה", ramla + [
        item("https://www.yad2.co.il/realestate/item/r-new", price=800000),
    ])
    if not again.endswith("|0|false|false"):
        fail(f"מודעה בלי טלפון נפתחה שוב: {again}")
    psql(DB, sql_text="""
      update public.scraped_leads
         set push_site_only = false, date_known = true, demand_notified_at = null,
             city_id = '11111111-1111-1111-1111-111111111111'
       where external_ref = 'yad2.co.il/realestate/item/r-new';
      delete from public.notifications where type = 'open_demand';
    """)
    n_plain = psql(DB, sql_text="""
      select public.scraped_lead_notify_demand(
        (select id from public.scraped_leads
          where external_ref = 'yad2.co.il/realestate/item/r-new'))
    """)
    note = psql(DB, sql_text="""
      select count(*)::text || '|' ||
             bool_and(
               position('http' in coalesce(title, '') || ' ' || coalesce(body, '')) = 0
               and position('board_listing_url' in coalesce(title, '') || ' ' || coalesce(body, '')) = 0
               and coalesce(action_url, '') = 'https://www.yad2.co.il/realestate/item/r-new'
             )::text
        from public.notifications where type = 'open_demand'
    """)
    if n_plain == "0" or note != f"{n_plain}|true":
        fail(f"התראה בלי טלפון: {n_plain} {note}")
    fb_none = psql(DB, sql_text="""
      select public.scraped_lead_add(jsonb_build_object(
        'lead_type', 'owner_inbound', 'source', 'facebook_group',
        'external_ref', 'https://facebook.com/groups/1/posts/1',
        'posted_at', now(), 'city', 'עפולה')) ->> 'error'
    """)
    if fb_none != "missing_phone":
        fail(f"פייסבוק בלי טלפון התקבל: {fb_none}")
    for prefix in ("083", "093", "033"):
        first = psql(DB, sql_text=f"""
          select public.scraped_lead_add(jsonb_build_object(
            'lead_type', 'owner_inbound', 'source', 'madlan',
            'external_ref', 'https://www.madlan.co.il/listings/{prefix}a',
            'city', 'עפולה', 'raw_phone', '{prefix}-111-0002',
            'date_known', false)) ->> 'success'
        """)
        second = psql(DB, sql_text=f"""
          select public.scraped_lead_add(jsonb_build_object(
            'lead_type', 'owner_inbound', 'source', 'madlan',
            'external_ref', 'https://www.madlan.co.il/listings/{prefix}b',
            'city', 'עפולה', 'raw_phone', '{prefix}1110002',
            'date_known', false)) ->> 'duplicate'
        """)
        if first != "true" or second:
            fail(f"מרכזיה {prefix} לא נקלטה פעמיים: {first} {second}")
    yad_switch = psql(DB, sql_text="""
      select public.scraped_lead_add(jsonb_build_object(
        'lead_type', 'owner_inbound', 'source', 'yad2',
        'external_ref', 'https://www.yad2.co.il/realestate/item/sw1',
        'city', 'עפולה', 'raw_phone', '083-111-0003', 'date_known', false)) ->> 'success'
    """)
    yad_switch2 = psql(DB, sql_text="""
      select public.scraped_lead_add(jsonb_build_object(
        'lead_type', 'owner_inbound', 'source', 'yad2',
        'external_ref', 'https://www.yad2.co.il/realestate/item/sw2',
        'city', 'עפולה', 'raw_phone', '0831110003', 'date_known', false)) ->> 'duplicate'
    """)
    if yad_switch != "true" or yad_switch2 != "phone":
        fail(f"083 ביד2 לא אוחד: {yad_switch} {yad_switch2}")
    board = psql(DB, sql_text="""
      insert into public.leads (lead_type, source, external_ref, status)
      values
        ('owner_inbound', 'yad2', 'yad2.co.il/realestate/item/r-new', 'unlocked'),
        ('owner_inbound', 'facebook_group', 'facebook.com/groups/1/posts/1', 'unlocked');
      select coalesce(string_agg(source || '=' || coalesce(board_listing_url, 'null'), ','
                                 order by source, board_listing_url nulls first), '')
        from public.leads_masked
       where source = 'facebook_group'
          or board_listing_url = 'https://yad2.co.il/realestate/item/r-new'
    """)
    if board != "facebook_group=null,yad2=https://yad2.co.il/realestate/item/r-new":
        fail(f"כפתור המודעה: {board}")

    psql(DB, sql_text="""
      select public.scraped_lead_add(jsonb_build_object(
        'lead_type', 'owner_inbound', 'source', 'yad2',
        'external_ref', 'https://www.yad2.co.il/realestate/item/held',
        'city', 'אשדוד', 'raw_phone', '0504300002', 'date_known', false))
    """)
    ashdod = [
        item("https://www.yad2.co.il/realestate/item/a1"),
        item("https://www.yad2.co.il/realestate/item/a2"),
        item("https://www.yad2.co.il/realestate/item/a3"),
    ]
    sync_once(DB, "אשדוד", ashdod)
    dup = sync_once(DB, "אשדוד", ashdod + [
        item("https://www.yad2.co.il/realestate/item/a-dup", "0504300002", 1000000),
    ])
    if not dup.endswith("|0|false|false"):
        fail(f"כפילות טלפון פתחה ליד: {dup}")
    if psql(DB, sql_text="""
      select lead_skip_reason from public.listing_inventory
       where external_ref = 'yad2.co.il/realestate/item/a-dup'
    """) != "phone":
        fail("כפילות לא נרשמה")
    held_at = psql(DB, sql_text="""
      select lead_attempted_at::text from public.listing_inventory
       where external_ref = 'yad2.co.il/realestate/item/a-dup'
    """)
    sync_once(DB, "אשדוד", ashdod + [
        item("https://www.yad2.co.il/realestate/item/a-dup", "0504300002", 1000000),
    ])
    if psql(DB, sql_text="""
      select lead_attempted_at::text from public.listing_inventory
       where external_ref = 'yad2.co.il/realestate/item/a-dup'
    """) != held_at:
        fail("אותו מחיר וטלפון נוסו שוב")
    sync_once(DB, "אשדוד", ashdod + [
        item("https://www.yad2.co.il/realestate/item/a-dup", "0504300002", 1100000),
    ])
    if psql(DB, sql_text="""
      select lead_attempted_at::text from public.listing_inventory
       where external_ref = 'yad2.co.il/realestate/item/a-dup'
    """) == held_at:
        fail("שינוי מחיר לא ניסה שוב")
    psql(DB, sql_text="""
      update public.listing_inventory
         set lead_attempted_at = now() - interval '31 days'
       where external_ref = 'yad2.co.il/realestate/item/a-dup'
    """)
    sync_once(DB, "אשדוד", ashdod + [
        item("https://www.yad2.co.il/realestate/item/a-dup", "0504300002", 1100000),
    ])
    if psql(DB, sql_text="""
      select lead_attempted_at > now() - interval '1 hour'
        from public.listing_inventory
       where external_ref = 'yad2.co.il/realestate/item/a-dup'
    """) != "t":
        fail("אחרי 30 יום לא ניסינו שוב")

    price_history_and_details()
    facebook_owner_is_inventory_not_a_second_lead(DB)

    print("listing inventory: ok")


if __name__ == "__main__":
    main()
