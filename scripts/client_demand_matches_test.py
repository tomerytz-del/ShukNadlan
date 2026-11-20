#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""התאמות ללקוח/ה מפוסטים בפייסבוק, וקישור "אני פונה" (20271121130000).

    python3 scripts/client_demand_matches_test.py

המנוע (client_property_match) ו-open_demand_claim_core מוחלפים ב-stub: נבדק מה
שהמיגרציה הזו מוסיפה - מי נכנס להתאמה, מה חוזר (ומה לא), הקישור, והלחיצה.
"""

import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGS = ROOT / "supabase/migrations"
SUPPLY = MIGS / "20271120110000_cma_board_supply.sql"
BOARD = MIGS / "20271120130000_client_board_matches.sql"
MIG = MIGS / "20271121130000_client_demand_matches.sql"
DB = os.environ.get("CLIENT_DEMAND_DB", "client_demand_matches_test")
CITY = "11111111-1111-1111-1111-111111111111"
OTHER_CITY = "22222222-2222-2222-2222-222222222222"
A1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1"
A2 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2"
CL = "c0000000-0000-0000-0000-00000000000"

SETUP = f"""
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table public.agency_members (id uuid primary key);
insert into public.agency_members values ('{A1}'), ('{A2}');
create table public.agent_clients (
  id uuid primary key default gen_random_uuid(), agent_id uuid, client_kind text default 'seeker',
  status text default 'active', deal_type text, category text default 'residential',
  property_types text[] default '{{}}', cities text[] default '{{}}', min_price numeric, max_price numeric,
  min_rooms numeric, required_features text[] default '{{}}', neighborhood_id uuid
);
create table public.properties (
  id uuid, status text, deal_type text, category text, property_type text, price numeric,
  rooms numeric, size_sqm numeric, floor int, city text, city_id uuid, neighborhood_id uuid, features text[]
);
create table public.scraped_leads (
  id uuid primary key default gen_random_uuid(), source text, lead_type text, status text,
  city text, city_id uuid, neighborhood_id uuid, deal_type text, property_type text, rooms numeric,
  budget numeric, demand_summary text, posted_at timestamptz, post_url text, source_post_url text, no_broker text,
  claimed_by uuid, claimed_at timestamptz, created_at timestamptz not null default now()
);
create table public.pricing_config (key text primary key, value int);
insert into public.pricing_config values ('open_demand_claims_daily', 2);

create function public.current_agent_id() returns uuid language sql stable as $$
  select nullif(current_setting('test.agent', true), '')::uuid $$;
create function public.city_ids_for_name(p_name text) returns uuid[] language sql stable as $$
  select case btrim(p_name) when 'עפולה' then array['{CITY}'::uuid]
                            when 'חיפה' then array['{OTHER_CITY}'::uuid] else '{{}}'::uuid[] end $$;
-- רק סוכן/ת 1 עובד/ת בעיר A. סוכן/ת 2 לא.
create function public.agent_works_city(p_agent uuid, p_city_id uuid) returns boolean language sql stable as $$
  select p_agent = '{A1}' or (p_agent = '{A2}' and p_city_id = '{OTHER_CITY}') $$;
create function public.scraped_lead_is_demand(p_status text, p_lead_type text, p_no_broker text,
                                              p_posted_at timestamptz, p_city_id uuid)
returns boolean language sql stable as $$
  select p_status = 'open_demand' and p_city_id is not null $$;
create function public.client_property_match(p_client public.agent_clients, p_property public.properties,
                                             p_waive_features text[])
returns table (score int, reasons text[], missing_features text[]) language sql stable as $$
  select 100 - case when p_property.rooms is null then 10 else 0 end, array['stub'], '{{}}'::text[]
   where p_property.status = 'active'
     and p_property.deal_type = p_client.deal_type
     and p_property.category = p_client.category
     and (cardinality(p_client.property_types) = 0 or p_property.property_type = any (p_client.property_types))
     and (p_client.max_price is null or p_property.price <= p_client.max_price * 1.1)
$$;
-- "אני פונה": ה-stub שומר על החוזה של הליבה (תקרה יומית, בלעדיות, already_mine).
create function public.open_demand_claim_core(p_agent uuid, p_id uuid) returns jsonb language plpgsql as $$
declare s public.scraped_leads%rowtype; v_used int; v_cap int;
begin
  select * into s from public.scraped_leads where id = p_id for update;
  if not found or not public.agent_works_city(p_agent, s.city_id) then
    return jsonb_build_object('error', 'not_found');
  end if;
  if s.claimed_by = p_agent then
    return jsonb_build_object('success', true, 'already_mine', true, 'post_url', s.post_url);
  end if;
  if s.claimed_by is not null then return jsonb_build_object('error', 'claimed'); end if;
  select value into v_cap from public.pricing_config where key = 'open_demand_claims_daily';
  select count(*) into v_used from public.scraped_leads where claimed_by = p_agent;
  if v_used >= v_cap then return jsonb_build_object('error', 'daily_cap', 'daily_cap', v_cap); end if;
  update public.scraped_leads set claimed_by = p_agent, claimed_at = now() where id = p_id;
  return jsonb_build_object('success', true, 'post_url', s.post_url, 'my_today', v_used + 1, 'daily_cap', v_cap);
end $$;
"""


def psql(sql_text):
    return subprocess.check_output(
        ["psql", "-X", "-v", "ON_ERROR_STOP=1", "-q", "-tA", "-d", DB, "-c", sql_text],
        env={**os.environ, "PGOPTIONS": "-c client_min_messages=warning"},
        text=True, stderr=subprocess.STDOUT,
    ).strip()


def expect(got, want, what):
    if got != want:
        sys.exit(f"{what}: {got} (ציפינו {want})")


def slice_fn(text, name, end_marker=None):
    start = text.index(f"create or replace function public.{name}")
    end = text.index(end_marker, start) if end_marker else len(text)
    return text[start:end]


def post(ref, ptype="דירה", rooms="4", budget="1300000", city=CITY, days=1, status="open_demand",
         source="facebook_group", lead_type="owner_inbound", claimed=None,
         url="https://www.facebook.com/groups/1/posts/{ref}", deal="sale", summary=None, source_url=None):
    url = ("'" + url.format(ref=ref) + "'") if url else "null"
    source_url = ("'" + source_url + "'") if source_url else "null"
    claimed = f"'{claimed}'" if claimed else "null"
    summary = f"'{summary or 'דירה ' + ref}'"
    psql(f"""
      insert into public.scraped_leads
        (id, source, lead_type, status, city, city_id, deal_type, property_type, rooms, budget,
         demand_summary, posted_at, post_url, source_post_url, claimed_by)
      values ('{ref_id(ref)}', '{source}', '{lead_type}', '{status}', 'עפולה', '{city}', '{deal}', '{ptype}',
              {rooms}, {budget}, {summary}, now() - interval '{days} days', {url}, {source_url}, {claimed})
    """)


def ref_id(ref):
    return "00000000-0000-0000-0000-" + ref.rjust(12, "0")


def client(n, agent=A1, **cols):
    cid = CL + n
    names = ", ".join(["id", "agent_id", "deal_type"] + list(cols))
    vals = ", ".join([f"'{cid}'", f"'{agent}'", "'sale'"] + list(cols.values()))
    psql(f"insert into public.agent_clients ({names}) values ({vals})")
    return cid


def as_agent(agent, sql):
    return psql(f"set test.agent = '{agent}'; {sql}")


def main():
    subprocess.check_call(["dropdb", "--if-exists", "--maintenance-db=postgres", DB])
    subprocess.check_call(["createdb", "--maintenance-db=postgres", DB])
    psql(SETUP)
    supply = SUPPLY.read_text(encoding="utf-8")
    psql(slice_fn(supply, "board_listing_kind", "-- הבריכה: המודעות שנספרות").rsplit("-- ----", 1)[0])
    board = BOARD.read_text(encoding="utf-8")
    psql(slice_fn(board, "board_listing_site_type", "create or replace function public.client_board_matches")
         .rsplit("revoke all", 1)[0])
    mig = MIG.read_text(encoding="utf-8")
    for _ in range(2):  # אידמפוטנטית
        psql(mig)

    # פוסטים: 1-3 מתאימים (טרי, ישן, תפוס אצלי), והשאר לא.
    post("1", days=2)                                   # מתאים, טרי
    post("2", days=9)                                   # מתאים, ישן יותר
    post("3", days=5, claimed=A1)                       # תפסתי: קישור מיד, ראשון בציון שווה
    post("4", claimed=A2)                               # נתפס בידי אחר/ת
    post("5", city=OTHER_CITY)                          # עיר אחרת
    post("6", budget="null")                            # בלי מחיר, ובכרטיס יש תקרה
    post("7", ptype="מסחרי")                            # סוג בלי סיווג
    post("8", source="madlan")                          # לא פייסבוק
    post("9", lead_type="seeker_inbound")               # מחפש/ת, לא בעלים
    post("a", status="pending_consent")                 # עוד לא ביקוש פתוח
    post("b", rooms="null", days=1)                     # מתאים, בלי חדרים: ציון נמוך יותר
    post("c", deal="rent", budget="5000")               # שכירות
    post("d", url=None)                                 # בלי קישור לפוסט: אינו מוצע ואינו נתפס
    post("f", url="https://www.example.com/x")          # קישור שאינו פייסבוק: אותו דבר
    post("10", url="https://www.facebook.com/x?tab=demand")  # קישור פנימי ל-CRM
    post("1f", days=3, url=None, source_url="https://www.facebook.com/groups/2/posts/g")  # רק source_post_url
    post("e", days=1)                                   # ללא תיווך: נשאר בהתאמות, עם התגית
    psql(f"update public.scraped_leads set no_broker = 'post' where id = '{ref_id('e')}'")

    c1 = client("1", property_types="array['דירה']", cities="array['עפולה']", max_price="1500000")
    got = as_agent(A1, f"""
      select concat_ws('|', r->>'status', r->>'total', r->>'top_score', r->>'top_count',
               (select string_agg(right(i->>'id', 1) || ':' || (i->>'score'), ',' order by ord)
                  from jsonb_array_elements(r->'items') with ordinality t(i, ord)))
        from (select public.agent_client_demand_matches('{c1}', 10) as r) s
    """)
    # תואמים: 1,2,3,b,e,1f. d/f/10 אין להם קישור פייסבוק שאפשר לפתוח, ולכן אינם מוצעים;
    # 1f רק עם source_post_url, ו-e "ללא תיווך" נשאר. ציון 100: 3 (שלי) ראשון, ואז לפי תאריך הפוסט היורד.
    expect(got, "ok|6|100|5|3:100,e:100,1:100,f:100,2:100,b:90", "מי מתאים ובאיזה סדר")
    expect(as_agent(A1, f"""
      select string_agg(right(i->>'id', 1) || '=' || coalesce(i->>'no_broker', '-'), ',' order by i->>'id')
        from jsonb_array_elements(public.agent_client_demand_matches('{c1}', 10) -> 'items') i
       where i->>'id' ~ '[1e]$'
    """), "1=-,e=post", 'פוסט "ללא תיווך" נשאר, עם הסימון')

    # מה שחוזר אנונימי: אין קישור, טלפון, או פרטי נכס.
    keys = as_agent(A1, f"""
      select string_agg(distinct k, ',' order by k)
        from (select jsonb_object_keys(i) k
                from jsonb_array_elements(public.agent_client_demand_matches('{c1}', 10) -> 'items') i) x
    """)
    expect(keys, "city,days_ago,deal_type,id,mine,no_broker,price,property_type,rooms,score,summary", "שדות התשובה בדפדפן")
    if re.search(r"url|phone|raw_|details|link", keys):
        sys.exit(f"שדה מזהה בתשובה: {keys}")

    # גבריאלה: טוקן לכל פוסט שאפשר לתפוס, וקישור יציב לאותו זוג.
    bot = lambda lim=10: f"public.agent_client_demand_matches_for_agent('{A1}', '{c1}', {lim}, '{{}}')"
    first = psql(f"""
      select (r->>'status') || '|' || jsonb_array_length(r->'items')::text || '|' ||
             (select bool_and(i->>'link_token' ~ '^[0-9a-f]{{32}}$') from jsonb_array_elements(r->'items') i)::text
        from (select {bot()} as r) s
    """)
    expect(first, "ok|6|true", "טוקנים לגבריאלה")
    expect(psql(f"""
      select (select count(*) from public.demand_claim_links)::text || '|' ||
             ((select string_agg(i->>'link_token', ',' order by i->>'id') from jsonb_array_elements((select {bot()})->'items') i)
              = (select string_agg(i->>'link_token', ',' order by i->>'id') from jsonb_array_elements((select {bot()})->'items') i))::text
    """), "6|true", "אותו זוג, אותו קישור")
    expect(psql(f"select ((select agent_client_demand_matches('{c1}', 5)) is null)::text"), "true", "בלי קורא/ת")

    # סטטוסים.
    client("2", property_types="array['דירה']", cities="array['עפולה']", required_features="array['mamad']")
    client("3")
    client("4", cities="array['חיפה']", property_types="array['דירה']")
    client("5", cities="array['עפולה']", category="'commercial'", property_types="array['משרדים']")
    client("6", cities="array['עפולה']", property_types="array['דירה']", min_rooms="9", max_price="100")
    client("7", cities="array['עפולה']", client_kind="'owner'")
    st = as_agent(A1, "select concat_ws('|', " + ", ".join(
        f"coalesce(public.agent_client_demand_matches('{CL}{n}', 5) ->> 'status', 'null')" for n in "234567") + ")")
    # 4: חיפה - סוכן/ת 1 אינו/ה עובד/ת בה? ה-stub: כן עובד/ת (A1 עובד בכל עיר), ואין פוסט פתוח בחיפה מלבד 5.
    expect(st, "skipped_feature|no_city|ok|unsupported|none|null", "סטטוסים")

    # הרשאה: לקוח/ה של סוכן/ת אחר/ת.
    expect(as_agent(A2, f"select (public.agent_client_demand_matches('{c1}', 5) is null)::text"), "true",
           "לקוח/ה של סוכן/ת אחר/ת")

    # הלחיצה. טוקן של פוסט 1.
    tok = lambda ref: psql(f"""
      select id from public.demand_claim_links where scraped_lead_id = '{ref_id(ref)}' and agent_id = '{A1}'""")
    t1, t2 = tok("1"), tok("2")
    j = lambda q: psql(f"select {q}")
    first = psql(f"select public.demand_claim_open('{t1}')::text")
    if '"ok": true' not in first or '"url": "https://www.facebook.com/groups/1/posts/1"' not in first \
            or '"already_mine": false' not in first:
        sys.exit(f"הלחיצה הראשונה: {first}")
    expect(j(f"(public.demand_claim_open('{t1}') ->> 'ok') || '|' || (public.demand_claim_open('{t1}') ->> 'already_mine')"),
           "true|true", "לחיצה חוזרת: already_mine")
    expect(j(f"(select claimed_by::text from public.scraped_leads where id = '{ref_id('1')}')"), A1, "הפוסט נתפס")
    expect(j(f"(select claim_status || '|' || (opened_at is not null)::text from public.demand_claim_links where id = '{t1}')"),
           "already_mine|true", "סטטוס הקישור")
    # קישור קיים כשהפוסט נתפס בידי אחר/ת בינתיים.
    psql(f"update public.scraped_leads set claimed_by = '{A2}' where id = '{ref_id('2')}'")
    expect(j(f"public.demand_claim_open('{t2}') ->> 'error'"), "taken", "פוסט שנתפס בידי אחר/ת")
    # תקרה יומית: 2. תפסתי כבר את 1 ו-3, ולכן פוסט נוסף נחסם.
    psql(f"update public.scraped_leads set claimed_by = null where id = '{ref_id('2')}'")
    expect(j(f"public.demand_claim_open('{t2}') ->> 'error'"), "daily_cap", "תקרה יומית")
    expect(j(f"(select claimed_by is null from public.scraped_leads where id = '{ref_id('2')}')::text"), "true",
           "תקרה לא תופסת")
    # פוסט שאין לו קישור פייסבוק שאפשר לפתוח: לא מוצע ולא נוצר לו קישור.
    for ref in ("d", "f", "10"):
        expect(j(f"public.demand_claim_link_create('{A1}', '{ref_id(ref)}', null) is null"), "t",
               f"קישור לפוסט בלי קישור פתיח ({ref})")
    # הקישור נעלם אחרי שנוצר: לא נתפס, והסטטוס אומר למה.
    t_b = tok("b")
    psql(f"update public.scraped_leads set post_url = null where id = '{ref_id('b')}'")
    expect(j(f"public.demand_claim_open('{t_b}') ->> 'error'"), "no_link", "פוסט שהקישור שלו נעלם")
    expect(j(f"(select claimed_by is null from public.scraped_leads where id = '{ref_id('b')}')::text"), "true",
           "פוסט בלי קישור לא נתפס")
    expect(j(f"(select claim_status from public.demand_claim_links where id = '{t_b}')"), "no_link", "סטטוס הקישור")
    # רק source_post_url: הקישור נפתח ממנו, כמו בליבה. (התקרה הוגדלה כדי שלא תחסום.)
    psql("update public.pricing_config set value = 4 where key = 'open_demand_claims_daily'")
    opened_g = psql(f"select public.demand_claim_open('{tok('1f')}')::text")
    if '"url": "https://www.facebook.com/groups/2/posts/g"' not in opened_g:
        sys.exit(f"קישור מ-source_post_url: {opened_g}")
    # קישור פג תוקף, ולא תקין.
    psql(f"update public.demand_claim_links set expires_at = now() - interval '1 minute' where id = '{t2}'")
    expect(j(f"public.demand_claim_open('{t2}') ->> 'error'"), "not_found", "קישור שפג")
    expect(j("public.demand_claim_open('nope') ->> 'error'"), "not_found", "טוקן לא תקין")
    expect(j("public.demand_claim_open(null) ->> 'error'"), "not_found", "בלי טוקן")
    # קישור לפוסט שתפוס בידי אחר/ת לא נוצר.
    expect(j(f"public.demand_claim_link_create('{A1}', '{ref_id('4')}', null) is null")  + "", "t", "קישור לפוסט תפוס")
    expect(j(f"public.demand_claim_link_create('{A1}', '{ref_id('8')}', null) is null"), "t", "קישור למודעה לא של פייסבוק")

    # הרשאות.
    grants = psql("""
      select string_agg(f || '=' || has_function_privilege('authenticated', f, 'execute')::text, ',' order by f)
        from unnest(array[
          'public.client_demand_matches(public.agent_clients,uuid,int,text[])',
          'public.demand_claim_link_create(uuid,uuid,uuid)',
          'public.demand_claim_open(text)',
          'public.agent_client_demand_matches(uuid,int)',
          'public.agent_client_demand_matches_for_agent(uuid,uuid,int,text[])']) f
    """)
    expect(re.sub(r"public\.", "", grants),
           "agent_client_demand_matches(uuid,int)=true,agent_client_demand_matches_for_agent(uuid,uuid,int,text[])=false,"
           "client_demand_matches(public.agent_clients,uuid,int,text[])=false,demand_claim_link_create(uuid,uuid,uuid)=false,"
           "demand_claim_open(text)=false".replace("public.", ""),
           "הרשאות")
    expect(psql("""
      select has_table_privilege('anon', 'public.demand_claim_links', 'select')::text
          || '|' || has_table_privilege('authenticated', 'public.demand_claim_links', 'select')::text
          || '|' || (select relrowsecurity::text from pg_class where relname = 'demand_claim_links')
    """), "false|false|true", "הרשאות הטבלה")

    subprocess.check_call(["dropdb", "--if-exists", "--maintenance-db=postgres", DB])
    print("client demand matches: ok")


if __name__ == "__main__":
    main()
