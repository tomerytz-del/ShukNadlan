#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""תקרת דחיפה נפרדת למדלן וליד2.

חמש מודעות יד2 היום לא הופכות מודעת מדלן ל-push_site_only.
השורה השישית של אותו מקור כן נשארת באתר.

    python3 scripts/board_notify_cap_test.py
"""
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIG = ROOT / "supabase/migrations/20271130150000_board_source_notify_caps.sql"
PREV = ROOT / "supabase/migrations/20271121160000_board_cross_source_duplicate.sql"
INTAKE = ROOT / "supabase/functions/listing-inventory-intake/index.ts"
DB = os.environ.get("BOARD_NOTIFY_CAP_DB", "board_notify_cap_test")

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

create table public.pricing_config (key text primary key, value int not null);
insert into public.pricing_config (key, value) values
  ('scraped_lead_matching_enabled', 0),
  ('notif_burst_scraped_stale_days', 14);

create table public.app_config (
  key text primary key,
  value text not null,
  description text not null default ''
);
insert into public.app_config (key, value, description) values
  ('madlan_notify_daily_cap', '5',
   'כמה מודעות מדלן ויד2 יחד מותר לדחוף ביום. מעבר לזה, וכל מלאי בלי date_known, נשארים באתר.');

create table public.neighborhoods (id uuid primary key, city_id uuid, name text);
create table public.scraped_lead_blocks (ref_hash text primary key, expires_at timestamptz);
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  raw_phone text,
  source text,
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
  lead_id uuid,
  no_broker text,
  demand_summary text,
  phone_hash text,
  push_site_only boolean not null default false,
  date_known boolean not null default false,
  size_sqm numeric,
  floor int,
  area_text text,
  broker_block boolean not null default false,
  is_duplicate boolean not null default false,
  duplicate_of uuid,
  duplicate_match jsonb,
  created_at timestamptz not null default now(),
  unique (source, external_ref)
);

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
language sql stable as $$ select '11111111-1111-1111-1111-111111111111'::uuid $$;
create function public.scraped_lead_ref(p text) returns text
language sql immutable as $$
  select left(regexp_replace(regexp_replace(coalesce(p, ''), '^https?://(www\.|m\.)?', ''), '[?#].*$', ''), 128)
$$;
create function public.scraped_lead_no_broker(p text) returns boolean
language sql immutable as $$ select false $$;
create function public.scraped_lead_broker_block(p text) returns boolean
language sql immutable as $$ select false $$;
create function public.listing_area_text(p text) returns text
language sql immutable as $$ select nullif(btrim(p), '') $$;
create function public.board_cross_source_match(
  p_source text, p_city text, p_city_id uuid, p_deal text,
  p_rooms numeric, p_price numeric, p_exclude_lead uuid, p_exclude_inventory uuid
) returns jsonb
language sql stable as $$ select null::jsonb $$;
create function public.scraped_lead_notify_demand(p_id uuid) returns int
language sql as $$ select 0 $$;
create function public.log_lead_routing(p jsonb) returns jsonb
language sql as $$ select '{}'::jsonb $$;
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


def function_body(path: Path, name: str) -> str:
    text = path.read_text(encoding="utf-8")
    start = text.index(f"create or replace function public.{name}")
    i = text.index("as $$\n", start)
    j = text.index("\nend $$;", i)
    return text[i + 5:j + 5]


def body_only_changes_the_cap():
    """החלפת scraped_lead_add חייבת להעתיק את הגוף החי. רק בלוק התקרה זז."""
    import difflib
    old = function_body(PREV, "scraped_lead_add").splitlines()
    new = function_body(MIG, "scraped_lead_add").splitlines()
    allowed = (
        "v_cap", "madlan_notify", "yad2_notify", "881151", "v_source",
        "push_site_only", "pg_advisory_xact_lock", "מקור", "תקרה", "נעילה", "שורה",
    )
    bad = []
    for line in difflib.unified_diff(old, new, lineterm=""):
        if not line.startswith(("+", "-")) or line.startswith(("+++", "---")):
            continue
        if any(token in line for token in allowed):
            continue
        bad.append(line)
    if bad:
        fail("הגוף השתנה מחוץ לתקרה:\n" + "\n".join(bad))
    body = "\n".join(new)
    if "source in ('madlan', 'yad2') and push_site_only = false" in body:
        fail("הספירה עדיין משותפת")
    if "where source = v_source and push_site_only = false" not in body:
        fail("הספירה אינה לפי המקור")
    if "v_notified := public.scraped_lead_notify_demand(v_id);" not in body:
        fail("ההתראה לא נשארה בהשמה")
    if "perform public.scraped_lead_notify_demand" in body or "select public.scraped_lead_notify_demand" in body:
        fail("ההתראה נקראת ב-perform או ב-select")
    for needle in ("board_cross_source_match", "yad2_free", "facebook_group", "broker_block", "881151301", "881151302"):
        if needle not in body:
            fail(f"חסר בגוף: {needle}")
    if "create or replace function public.listing_inventory_sync" in MIG.read_text(encoding="utf-8"):
        fail("המיגרציה מחליפה את listing_inventory_sync")


def other_paths_do_not_count():
    """הקליטה והסנכרון קוראים ל-scraped_lead_add. אין להם תקרה משלהם."""
    intake = INTAKE.read_text(encoding="utf-8")
    if "listing_inventory_sync" not in intake:
        fail("listing-inventory-intake לא קורא לסנכרון")
    if "notify_daily_cap" in intake or "push_site_only" in intake:
        fail("listing-inventory-intake סופר תקרה בעצמו")
    marker = "create or replace function public.listing_inventory_sync"
    defining = sorted(
        path for path in (ROOT / "supabase/migrations").glob("*.sql")
        if marker in path.read_text(encoding="utf-8").lower()
    )
    sync = function_body(defining[-1], "listing_inventory_sync")
    if "scraped_lead_add" not in sync:
        fail("listing_inventory_sync לא קורא ל-scraped_lead_add")
    if "notify_daily_cap" in sync or "push_site_only" in sync:
        fail(f"{defining[-1].name} סופר תקרה בתוך הסנכרון")


def add(source: str, n: int, **extra) -> str:
    host = "www.yad2.co.il/realestate/item" if source == "yad2" else "www.madlan.co.il/listings"
    fields = [
        "'lead_type', 'owner_inbound'",
        f"'source', '{source}'",
        f"'external_ref', 'https://{host}/cap-{source}-{n}'",
        "'city', 'עפולה'",
    ]
    if "date_known" not in extra:
        fields.append("'first_seen_at', now()")
        fields.append("'date_known', true")
    for key, value in extra.items():
        if isinstance(value, bool):
            fields.append(f"'{key}', {str(value).lower()}")
        else:
            fields.append(f"'{key}', '{value}'")
    got = psql(DB, sql_text=f"""
      select public.scraped_lead_add(jsonb_build_object({", ".join(fields)})) ->> 'push_site_only'
    """)
    return got


def expect_push(source: str, n: int, want: str):
    got = add(source, n)
    if got != want:
        fail(f"{source} #{n}: push_site_only={got}, ציפינו ל-{want}")


def main():
    body_only_changes_the_cap()
    other_paths_do_not_count()
    subprocess.run(["dropdb", "--if-exists", DB], check=False)
    subprocess.run(["createdb", DB], check=True)
    try:
        psql(DB, sql_text=SETUP)
        psql(DB, MIG)
        psql(DB, sql_text="""
          update public.app_config set value = '9' where key = 'madlan_notify_daily_cap';
          update public.app_config set value = '7' where key = 'yad2_notify_daily_cap';
        """)
        psql(DB, MIG)
        caps = psql(DB, sql_text="""
          select coalesce(string_agg(key || '=' || value, ',' order by key), '')
            from public.app_config
           where key in ('madlan_notify_daily_cap', 'yad2_notify_daily_cap')
        """)
        if caps != "madlan_notify_daily_cap=9,yad2_notify_daily_cap=7":
            fail(f"הרצה שנייה דרסה את הערכים: {caps}")
        desc = psql(DB, sql_text="""
          select (position('יחד' in description) = 0
                  and position('yad2_notify_daily_cap' in description) > 0)::text
            from public.app_config where key = 'madlan_notify_daily_cap'
        """)
        if desc != "true":
            fail("תיאור תקרת מדלן עדיין משותף")
        psql(DB, sql_text="""
          update public.app_config set value = '5'
           where key in ('madlan_notify_daily_cap', 'yad2_notify_daily_cap');
          insert into public.scraped_leads
            (lead_type, source, post_url, external_ref, city, push_site_only, date_known, created_at)
          values
            ('owner_inbound', 'yad2',
             'https://www.yad2.co.il/realestate/item/yesterday',
             'yad2.co.il/realestate/item/yesterday', 'עפולה', false, true,
             now() - interval '2 days'),
            ('owner_inbound', 'yad2',
             'https://www.yad2.co.il/realestate/item/siteonly',
             'yad2.co.il/realestate/item/siteonly', 'עפולה', true, true, now());
        """)
        for n in range(1, 6):
            expect_push("yad2", n, "false")
        expect_push("yad2", 6, "true")
        expect_push("madlan", 1, "false")
        for n in range(2, 6):
            expect_push("madlan", n, "false")
        expect_push("madlan", 6, "true")
        expect_push("yad2", 7, "true")
        counted = psql(DB, sql_text="""
          select source || ':' || count(*)::text
            from public.scraped_leads
           where push_site_only = false
             and created_at >= date_trunc('day', now() at time zone 'Asia/Jerusalem')
                                at time zone 'Asia/Jerusalem'
             and source in ('yad2', 'madlan')
           group by source
           order by source
        """)
        if counted != "madlan:5\nyad2:5":
            fail(f"הספירה אחרי המילוי: {counted}")
        unknown = add("madlan", 90, date_known=False)
        if unknown != "true":
            fail(f"date_known false נדחף: {unknown}")
        fb = psql(DB, sql_text="""
          select (public.scraped_lead_add(jsonb_build_object(
            'lead_type', 'owner_inbound', 'source', 'facebook_group',
            'external_ref', 'https://www.facebook.com/groups/1/posts/capfb',
            'posted_at', now(), 'city', 'עפולה', 'raw_phone', '0501000099'
          )) ->> 'push_site_only')
        """)
        if fb != "false":
            fail(f"פוסט פייסבוק נכנס לתקרת הלוח: {fb}")
        grants = psql(DB, sql_text="""
          select has_function_privilege('anon', 'public.scraped_lead_add(jsonb)', 'execute')::text
              || '|' ||
                 has_function_privilege('authenticated', 'public.scraped_lead_add(jsonb)', 'execute')::text
              || '|' ||
                 has_function_privilege('service_role', 'public.scraped_lead_add(jsonb)', 'execute')::text
        """)
        if grants != "false|false|true":
            fail(f"הרשאות: {grants}")
    finally:
        subprocess.run(["dropdb", "--if-exists", DB], check=False)


if __name__ == "__main__":
    main()
