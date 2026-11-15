#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""מודעת מדלן/יד2: בלי טלפון בגוף, עם action_url, וחותמת חסרה אינה site-only.

    python3 scripts/board_lead_notify_test.py
"""

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIG = ROOT / "supabase/migrations/20271115120000_board_lead_notify_button.sql"
DB = os.environ.get("BOARD_LEAD_NOTIFY_DB", "board_lead_notify_test")
CITY = "11111111-1111-1111-1111-111111111111"
HOOD = "22222222-2222-2222-2222-222222222222"
AGENT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1"

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

create table public.cities (id uuid primary key);
insert into public.cities (id) values ('11111111-1111-1111-1111-111111111111');
create table public.neighborhoods (
  id uuid primary key,
  city_id uuid,
  name text
);
insert into public.neighborhoods (id, city_id, name)
values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'רובע יזרעאל');

create table public.agencies (id uuid primary key, city_id uuid);
create table public.agency_members (
  id uuid primary key,
  agency_id uuid,
  active boolean not null default true,
  tier text not null default 'mid',
  released_at timestamptz,
  license_status text
);
insert into public.agencies (id, city_id)
values ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111');
insert into public.agency_members (id, agency_id)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', '33333333-3333-3333-3333-333333333333');

create table public.pricing_config (key text primary key, value int not null);
insert into public.pricing_config (key, value) values
  ('scraped_lead_matching_enabled', 0),
  ('open_demand_notify_cap_enabled', 0),
  ('notif_burst_demand_fanout', 15),
  ('notif_burst_scraped_stale_days', 14),
  ('open_demand_notify_cap', 8),
  ('open_demand_pull_lookback_days', 14);

create table public.app_config (
  key text primary key,
  value text not null,
  description text not null default ''
);
insert into public.app_config (key, value) values ('madlan_notify_daily_cap', '5');

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
  match_first_at timestamptz,
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
create function public.scraped_lead_ref(p_url text)
returns text language sql immutable as $$
  select left(regexp_replace(regexp_replace(split_part(coalesce(p_url, ''), '?', 1), '^https://(www\.|m\.)?', ''), '/$', ''), 120);
$$;
create function public.scraped_lead_no_broker(p text)
returns boolean language sql immutable as $$ select false $$;
create function public.scraped_lead_is_demand(p_status text, p_lead_type text, p_no_broker text, p_posted timestamptz, p_city uuid)
returns boolean language sql stable as $$
  select p_city is not null and p_status in ('pending_consent', 'open_demand');
$$;
create function public.agent_works_city(p_agent uuid, p_city uuid)
returns boolean language sql stable as $$ select true $$;
create function public.agent_handles_type(p_agent uuid, p_type text, p_deal text)
returns boolean language sql stable as $$ select true $$;
create function public.social_buyer_is_dm(p_source text, p_lead_type text)
returns boolean language sql stable as $$ select false $$;
create function public.social_post_host_ok(p_url text)
returns boolean language sql stable as $$ select false $$;
"""


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


def fail(msg):
    sys.exit(msg)


def add(fields: str) -> str:
    return psql(DB, sql_text=f"select public.scraped_lead_add({fields}::jsonb)::text")


def main():
    src = MIG.read_text(encoding="utf-8")
    if "set push_site_only" in src:
        fail("המיגרציה הופכת שורות קיימות")
    if "אפשר להתקשר ל-" not in src.split("create or replace function public.scraped_lead_notify_demand", 1)[0]:
        fail("ההסבר בראש המיגרציה לא מזכיר את המשפט הישן")
    fn = src.split("create or replace function public.scraped_lead_notify_demand", 1)[1]
    if "אפשר להתקשר" in fn:
        fail("גוף ההתראה החדש עדיין מזכיר חיוג")
    if "action_url" not in fn or "מודעה חדשה ב" not in fn:
        fail("חסר כפתור או כותרת למודעת לוח")

    subprocess.run(["dropdb", "--if-exists", DB], check=False)
    subprocess.run(["createdb", DB], check=True)
    try:
        psql(DB, sql_text=SETUP)
        psql(DB, MIG)
        psql(DB, MIG)

        summary = "מכירה בעפולה, רובע יזרעאל, דירת 4 חדרים, קומה 3, 120 מ׳ר"
        madlan_url = "https://www.madlan.co.il/listings/board1"
        got = add(f"""jsonb_build_object(
          'lead_type', 'owner_inbound', 'source', 'madlan',
          'external_ref', '{madlan_url}',
          'first_seen_at', now(), 'date_known', true,
          'city', 'עפולה', 'neighborhood', 'רובע יזרעאל',
          'raw_phone', '0509876543', 'rooms', 4, 'budget', 1430000,
          'deal_type', 'sale', 'property_type', 'דירה',
          'summary', '{summary}')""")
        if "success" not in got or '"push_site_only": true' in got.replace(" ", ""):
            fail(f"מודעת מדלן טרייה לא נדחפה: {got}")
        row = psql(DB, sql_text=f"""
          select coalesce(title, '') || '|' || coalesce(body, '') || '|' || coalesce(action_url, '')
            from public.notifications
           where type = 'open_demand'
           order by created_at desc
           limit 1
        """)
        title, body, action = row.split("|", 2)
        if title != "מודעה חדשה בעפולה":
            fail(f"כותרת מדלן: {title}")
        if action != madlan_url:
            fail(f"כפתור המודעה: {action}")
        for banned in ("0509876543", "אפשר להתקשר", "בלי עלות", "פונה לבעלים", "https://", "http"):
            if banned in body:
                fail(f"הגוף מכיל {banned}: {body}")
        for needed in ("רובע יזרעאל, עפולה", "4 חדרים", "120 מ״ר", "קומה 3", "₪1,430,000"):
            if needed not in body:
                fail(f"חסר {needed} בגוף: {body}")
        lead_id = psql(DB, sql_text="""
          select id::text from public.scraped_leads
           where external_ref like '%board1%'
        """)
        again = psql(DB, sql_text=f"select public.scraped_lead_notify_demand('{lead_id}')")
        n_rows = psql(DB, sql_text="select count(*) from public.notifications")
        if again != "0" or n_rows != "1":
            fail(f"התראה כפולה: {again} rows={n_rows}")

        yad2_url = "https://www.yad2.co.il/realestate/item/board2"
        yad = add(f"""jsonb_build_object(
          'lead_type', 'owner_inbound', 'source', 'yad2',
          'external_ref', '{yad2_url}',
          'first_seen_at', now(), 'date_known', true,
          'city', 'עפולה', 'raw_phone', '0523334444',
          'rooms', 3, 'budget', 2100, 'deal_type', 'rent',
          'summary', 'השכרה, 3 חדרים, קומה 2, 70 מ״ר')""")
        if "success" not in yad:
            fail(f"יד2 נדחתה: {yad}")
        yrow = psql(DB, sql_text="""
          select coalesce(body, '') || '|' || coalesce(action_url, '')
            from public.notifications
           where action_url like '%yad2%'
        """)
        ybody, yaction = yrow.split("|", 1)
        if yaction != yad2_url:
            fail(f"כפתור יד2: {yaction}")
        for banned in ("0523334444", "052", "אפשר להתקשר", "בלי עלות", "פונה לבעלים", "https://"):
            if banned in ybody:
                fail(f"גוף יד2 מכיל {banned}: {ybody}")
        if "קומה 2" not in ybody or "70 מ״ר" not in ybody or "₪2,100" not in ybody:
            fail(f"גוף יד2 חסר פרטים: {ybody}")

        psql(DB, sql_text="update public.app_config set value = '20' where key = 'madlan_notify_daily_cap'")

        def board_body(ref: str, summary: str, phone: str) -> str:
            added = add(f"""jsonb_build_object(
              'lead_type', 'owner_inbound', 'source', 'madlan',
              'external_ref', 'https://www.madlan.co.il/listings/{ref}',
              'first_seen_at', now(), 'date_known', true,
              'city', 'עפולה', 'raw_phone', '{phone}',
              'rooms', 3, 'budget', 500000,
              'summary', '{summary}')""")
            if "success" not in added:
                fail(f"קליטת שטח {ref} נדחתה: {added}")
            return psql(DB, sql_text=f"""
              select coalesce(body, '') from public.notifications
               where action_url = 'https://www.madlan.co.il/listings/{ref}'
            """)

        traps = board_body("traps", "2 מרפסות ו-1 מרתף", "0542002001")
        if "מ״ר" in traps or "מרפסות" in traps or "מרתף" in traps:
            fail(f"מרפסת או מרתף נקראו כשטח: {traps}")
        quoted = board_body("quoted", '80 מ"ר ו-2 מרפסות', "0542002002")
        if "80 מ״ר" not in quoted or "2 מ״ר" in quoted:
            fail(f"מ\"ר לא בודד: {quoted}")
        meters = board_body("meters", "90 מטר", "0542002003")
        if "90 מ״ר" not in meters:
            fail(f"מטר לא נקרא: {meters}")
        bare = board_body("bare", "60 מר", "0542002004")
        if "60 מ״ר" not in bare:
            fail(f"מר לא נקרא: {bare}")
        gershayim = board_body("gersh", "55 מ״ר", "0542002005")
        if "55 מ״ר" not in gershayim:
            fail(f"מ״ר לא נקרא: {gershayim}")

        before_fb = psql(DB, sql_text="select count(*) from public.notifications")
        fb = add("""jsonb_build_object(
          'lead_type', 'owner_inbound', 'source', 'facebook_group',
          'external_ref', 'https://facebook.com/groups/1/posts/board3',
          'posted_at', now(), 'city', 'עפולה', 'raw_phone', '0531231234',
          'rooms', 2, 'deal_type', 'sale')""")
        if "success" not in fb:
            fail(f"פייסבוק נדחה: {fb}")
        fb_row = psql(DB, sql_text="""
          select coalesce(title, '') || '|' || coalesce(body, '') || '|' ||
                 (action_url is null)::text
            from public.notifications
           where title like 'ביקוש פתוח:%'
        """)
        fb_title, fb_body, fb_null = fb_row.split("|", 2)
        if not fb_title.startswith("ביקוש פתוח:"):
            fail(f"כותרת פייסבוק השתנתה: {fb_title}")
        if "אפשר להגיב רק בפוסט או בהודעת פייסבוק" not in fb_body:
            fail(f"נוסח פייסבוק השתנה: {fb_body}")
        if fb_null != "true":
            fail("לפוסט פייסבוק יש קישור מודעה")
        if "0531231234" in fb_body:
            fail("טלפון נכנס להתראת פייסבוק")
        if psql(DB, sql_text="select count(*) from public.notifications") == before_fb:
            fail("פייסבוק לא יצר התראה")

        missing = add("""jsonb_build_object(
          'lead_type', 'owner_inbound', 'source', 'madlan',
          'external_ref', 'https://www.madlan.co.il/listings/notime',
          'date_known', true,
          'city', 'עפולה', 'raw_phone', '0541001001',
          'rooms', 3, 'budget', 900000)""")
        if '"push_site_only": false' not in missing.replace(" ", "") and '"push_site_only":false' not in missing.replace(" ", ""):
            fail(f"חותמת חסרה עם date_known השאירה site-only: {missing}")
        if psql(DB, sql_text="""
          select push_site_only::text from public.scraped_leads
           where external_ref like '%notime%'
        """) != "false":
            fail("השורה בלי חותמת נשמרה site-only")

        unknown = add("""jsonb_build_object(
          'lead_type', 'owner_inbound', 'source', 'madlan',
          'external_ref', 'https://www.madlan.co.il/listings/unknown',
          'date_known', false,
          'city', 'עפולה', 'raw_phone', '0541001002')""")
        if '"push_site_only": true' not in unknown.replace(" ", "") and '"push_site_only":true' not in unknown.replace(" ", ""):
            fail(f"date_known false נדחף: {unknown}")
        before_unknown_n = psql(DB, sql_text="select count(*) from public.notifications")
        # הקליטה כבר קראה ל-notify. אין שורה חדשה מעבר למה שנדחף קודם.
        # notime כן נדחף, unknown לא. נבדוק שאין התראה על המזהה של unknown.
        if psql(DB, sql_text="""
          select count(*) from public.notifications n
           join public.scraped_leads s on s.demand_notified_at is not null
          where s.external_ref like '%unknown%'
        """) != "0":
            fail("מודעה בלי תאריך ידוע קיבלה התראה")
        if psql(DB, sql_text="select count(*) from public.notifications") != before_unknown_n:
            fail("ספירת התראות זזה אחרי הבדיקה")

        bad = add("""jsonb_build_object(
          'lead_type', 'owner_inbound', 'source', 'madlan',
          'external_ref', 'https://www.madlan.co.il/listings/baddate',
          'first_seen_at', 'not-a-date', 'date_known', true,
          'city', 'עפולה', 'raw_phone', '0541001003')""")
        if '"push_site_only": true' not in bad.replace(" ", "") and '"push_site_only":true' not in bad.replace(" ", ""):
            fail(f"תאריך לא קריא נדחף: {bad}")

        psql(DB, sql_text="update public.app_config set value = '0' where key = 'madlan_notify_daily_cap'")
        capped = add("""jsonb_build_object(
          'lead_type', 'owner_inbound', 'source', 'madlan',
          'external_ref', 'https://www.madlan.co.il/listings/overcap',
          'first_seen_at', now(), 'date_known', true,
          'city', 'עפולה', 'raw_phone', '0541001004')""")
        if '"push_site_only": true' not in capped.replace(" ", "") and '"push_site_only":true' not in capped.replace(" ", ""):
            fail(f"מעל התקרה נדחף: {capped}")

        psql(DB, sql_text="""
          insert into public.scraped_leads (
            lead_type, source, post_url, external_ref, city, raw_phone, push_site_only, date_known
          ) values (
            'owner_inbound', 'madlan', 'https://www.madlan.co.il/listings/keep',
            'madlan.co.il/listings/keep', 'עפולה', '0501001005', true, true
          )
        """)
        psql(DB, MIG)
        if psql(DB, sql_text="""
          select push_site_only::text from public.scraped_leads
           where external_ref = 'madlan.co.il/listings/keep'
        """) != "true":
            fail("המיגרציה הפכה שורה קיימת")

        phone_in_fn = psql(DB, sql_text="""
          select position('אפשר להתקשר' in prosrc)::text
            from pg_proc
           where proname = 'scraped_lead_notify_demand'
        """)
        if phone_in_fn != "0":
            fail("הפונקציה במסד עדיין מכילה חיוג")
    finally:
        subprocess.run(["dropdb", "--if-exists", DB], check=False)


if __name__ == "__main__":
    main()
