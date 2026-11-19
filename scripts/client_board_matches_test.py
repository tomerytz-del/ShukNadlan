#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""התאמות ללקוח/ה מהלוחות (client_board_matches): מה שהפונקציה עצמה עושה.

    python3 scripts/client_board_matches_test.py

הציון מגיע מ-client_property_match, והבדיקה כאן אינה בודקת אותו: המנוע מוחלף
ב-stub קטן, כדי לבדוק את מה שהמיגרציה הזו מוסיפה - הכתיב של סוג הנכס, שורת
הנכס שנבנית מהמודעה, השכונה, הסדר בתוך אותו ציון, הסטטוסים, הקישור וההרשאה.
"""

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SUPPLY = ROOT / "supabase/migrations/20271120110000_cma_board_supply.sql"
MIG = ROOT / "supabase/migrations/20271120113000_client_board_matches.sql"
DB = os.environ.get("CLIENT_BOARD_DB", "client_board_matches_test")
CITY = "11111111-1111-1111-1111-111111111111"
HOOD = "22222222-2222-2222-2222-222222222222"
A1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1"
A2 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2"

SETUP = f"""
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

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
create table public.listing_inventory (
  id uuid primary key default gen_random_uuid(), source text not null, city text not null, city_id uuid,
  deal_type text, property_type text, rooms numeric, price numeric, size_sqm numeric, floor int,
  neighborhood text, url text, first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(), removed_at timestamptz
);
create table public.listing_inventory_price_history (
  id uuid primary key default gen_random_uuid(), listing_id uuid not null, old_price numeric not null,
  new_price numeric not null, changed_at timestamptz not null default now()
);
create function public.current_agent_id() returns uuid language sql stable as $$
  select nullif(current_setting('test.agent', true), '')::uuid $$;
create function public.city_ids_for_name(p_name text) returns uuid[] language sql stable as $$
  select case when btrim(p_name) = 'עפולה' then array['{CITY}'::uuid] else '{{}}'::uuid[] end $$;
create function public.neighborhood_ids_for(p_city text, p_name text) returns uuid[] language sql stable as $$
  select case when p_name = 'גבעת המורה' then array['{HOOD}'::uuid] else '{{}}'::uuid[] end $$;
-- המנוע האמיתי אינו נבדק כאן. ה-stub שומר על החוזה שלו: שורת לקוח/ה ושורת נכס,
-- ושורה אחת עם ציון רק כשהשער עובר.
create function public.client_property_match(p_client public.agent_clients, p_property public.properties,
                                             p_waive_features text[])
returns table (score int, reasons text[], missing_features text[]) language sql stable as $$
  select 100 - case when p_property.size_sqm is null then 10 else 0 end
             - case when p_client.neighborhood_id is not null
                     and p_property.neighborhood_id is distinct from p_client.neighborhood_id then 30 else 0 end,
         array['stub'], '{{}}'::text[]
   where p_property.status = 'active'
     and p_property.deal_type = p_client.deal_type
     and p_property.category = p_client.category
     and (cardinality(p_client.property_types) = 0 or p_property.property_type = any (p_client.property_types))
     and (p_client.min_rooms is null or p_property.rooms >= p_client.min_rooms)
$$;
"""


def psql(sql_text, db=DB):
    return subprocess.check_output(
        ["psql", "-X", "-v", "ON_ERROR_STOP=1", "-q", "-tA", "-d", db, "-c", sql_text],
        env={**os.environ, "PGOPTIONS": "-c client_min_messages=warning"},
        text=True, stderr=subprocess.STDOUT,
    ).strip()


def expect(got, want, what):
    if got != want:
        sys.exit(f"{what}: {got} (ציפינו {want})")


def listing(ref, ptype, rooms, price, size="null", floor="null", hood="null", source="yad2",
            city="עפולה", url=None, removed=False):
    ptype = ptype.replace("'", "''")
    url = url or f"https://www.{source}.co.il/item/{ref}"
    psql(f"""
      insert into public.listing_inventory
        (source, city, city_id, deal_type, property_type, rooms, price, size_sqm, floor, neighborhood, url, removed_at)
      values ('{source}', '{city}', (public.city_ids_for_name('{city}'))[1], 'sale', '{ptype}', {rooms}, {price},
              {size}, {floor}, {hood}, '{url}', {"now()" if removed else "null"})
    """)


def client(cid, agent=A1, **cols):
    names = ", ".join(["id", "agent_id", "deal_type"] + list(cols))
    vals = ", ".join([f"'{cid}'", f"'{agent}'", "'sale'"] + list(cols.values()))
    psql(f"insert into public.agent_clients ({names}) values ({vals})")


def board(cid, limit=5, agent=A1):
    return f"(select public.agent_client_board_matches('{cid}', {limit}))"


def as_agent(agent, sql):
    return psql(f"set test.agent = '{agent}'; {sql}")


def main():
    subprocess.check_call(["dropdb", "--if-exists", "--maintenance-db=postgres", DB])
    subprocess.check_call(["createdb", "--maintenance-db=postgres", DB])
    psql(SETUP)
    supply = SUPPLY.read_text(encoding="utf-8")
    kind = supply[supply.index("create or replace function public.board_listing_kind"):
                  supply.index("-- הבריכה: המודעות שנספרות")]
    psql(kind[:kind.rindex("-- ----")])
    for _ in range(2):  # אידמפוטנטית
        psql(MIG.read_text(encoding="utf-8"))

    expect(psql("""
      select string_agg(coalesce(public.board_listing_site_type(t), '-'), '|' order by ord)
        from unnest(array['בית פרטי/ קוטג''', 'בית פרטי', 'קוטג'' טורי', 'גג/ פנטהאוז', 'פנטהאוז',
                          'מיני פנטהאוז', 'דירת גג', 'סטודיו/ לופט', 'דירה', 'דו משפחתי', '', null])
             with ordinality as u(t, ord)
    """), "בית פרטי/קוטג'|בית פרטי/קוטג'|בית פרטי/קוטג'|גג/פנטהאוז|גג/פנטהאוז|גג/פנטהאוז|גג/פנטהאוז|סטודיו|דירה|דו משפחתי|-|-",
           "סוג הנכס בכתיב של האתר")

    # מלאי: ארבע דירות 4 חדרים (אחת בלי שטח), בית בכתיב של יד2, פנטהאוז של
    # מדלן, מגרש, מודעה שירדה מהאוויר, ועיר אחרת.
    listing("a", "דירה", 4, 1400000, 100, 3, "'גבעת המורה'")          # 14,000 למ"ר
    listing("b", "דירה", 4, 1200000, 100, 1, "'מרכז העיר'")           # 12,000 למ"ר
    listing("c", "דירה", 4, 1300000, 100, 2, "'מרכז העיר'")           # 13,000, ירדה במחיר
    listing("d", "דירה", 4, 1100000)                                   # בלי שטח: ציון 90
    listing("h", "בית פרטי/ קוטג'", 5, 2500000, 180)
    listing("p", "פנטהאוז", 5, 2400000, 150, source="madlan")
    listing("l", "מגרשים", "null", 900000, 500)
    listing("x", "דירה", 4, 1000000, 100, removed=True)
    listing("y", "דירה", 4, 1000000, 100, city="חיפה")
    listing("bad", "דירה", 4, 1250000, 100, url="http://evil.example/x")  # 12,500 למ"ר
    psql("""
      insert into public.listing_inventory_price_history (listing_id, old_price, new_price)
      select id, 1380000, 1300000 from public.listing_inventory where url like '%/item/c'
    """)

    client("c0000000-0000-0000-0000-000000000001", property_types="array['דירה']", cities="array['עפולה']",
           max_price="1500000")
    r1 = board("c0000000-0000-0000-0000-000000000001", 3)
    got = as_agent(A1, f"""
      select concat_ws('|', r->>'status', r->>'total', r->>'top_score', r->>'top_count',
               (select string_agg(coalesce(right(split_part(i->>'url', '/item/', 2), 3), 'nourl') || ':' || (i->>'score'), ',' order by ord)
                  from jsonb_array_elements(r->'items') with ordinality as t(i, ord)),
               r->'items'->0->>'price_was')
        from (select {r1} as r) s
    """)
    # 5 דירות חיות בעפולה. ארבע ב-100: קודם זו שירדה (c), אז מחיר למ"ר (b 12,000,
    # bad 12,500). הקישור של bad אינו https של לוח ולכן חוזר ריק.
    expect(got, "ok|5|100|4|c:100,b:100,nourl:100|1380000", "דירוג, סדר בתוך אותו ציון ומחיר קודם")
    expect(as_agent(A1, f"select jsonb_array_length({r1} -> 'items')::text"), "3", "החיתוך ל-limit")

    # בית: הכרטיס בכתיב של האתר, המודעה בכתיב של יד2.
    client("c0000000-0000-0000-0000-000000000002", property_types="array['בית פרטי/קוטג''']",
           cities="array['עפולה']")
    expect(as_agent(A1, f"select ({board('c0000000-0000-0000-0000-000000000002')} ->> 'total')"), "1",
           "בית בכתיב של יד2")
    # פנטהאוז של מדלן מול "גג/פנטהאוז" בכרטיס.
    client("c0000000-0000-0000-0000-000000000003", property_types="array['גג/פנטהאוז']", cities="array['עפולה']")
    expect(as_agent(A1, f"select {board('c0000000-0000-0000-0000-000000000003')} -> 'items' -> 0 ->> 'source'"),
           "madlan", "פנטהאוז של מדלן")
    # מגרש: כרטיס מסחרי שמבקש "מגרשים" מקבל את מודעת המגרש.
    client("c0000000-0000-0000-0000-000000000004", property_types="array['מגרשים']", cities="array['עפולה']",
           category="'commercial'")
    expect(as_agent(A1, f"select ({board('c0000000-0000-0000-0000-000000000004')} ->> 'total')"), "1",
           "מגרש בכרטיס מסחרי")
    # שכונה: המודעה בגבעת המורה ראשונה, כי המנוע מוריד ציון לשאר.
    client("c0000000-0000-0000-0000-000000000005", property_types="array['דירה']", cities="array['עפולה']",
           neighborhood_id=f"'{HOOD}'")
    expect(as_agent(A1, f"""
      select (r->'items'->0->>'neighborhood') || '|' || (r->'items'->0->>'score') || '|' || (r->>'top_count')
        from (select {board('c0000000-0000-0000-0000-000000000005')} as r) s
    """), "גבעת המורה|100|1", "שכונה מהמודעה")

    # סטטוסים שאינם "אין התאמות".
    client("c0000000-0000-0000-0000-000000000006", cities="array['עפולה']", required_features="array['mamad']")
    client("c0000000-0000-0000-0000-000000000007")
    client("c0000000-0000-0000-0000-000000000008", cities="array['נתניה']")
    client("c0000000-0000-0000-0000-000000000009", cities="array['עפולה']", property_types="array['דירה']",
           min_rooms="9")
    client("c0000000-0000-0000-0000-00000000000a", cities="array['עפולה']", client_kind="'owner'")
    statuses = as_agent(A1, "select concat_ws('|', " + ", ".join(
        f"coalesce({board('c0000000-0000-0000-0000-00000000000' + n)} ->> 'status', 'null')"
        for n in "6789a") + ")")
    expect(statuses, "skipped_feature|no_city|unavailable|none|null", "סטטוסים")

    # העטיפה של גבריאלה: אותה תשובה כמו של הדפדפן, והוויתור של הסוכן/ת פותח
    # כרטיס עם מאפיין חובה. ויתור על מאפיין אחר אינו פותח.
    bot = "public.agent_client_board_matches_for_agent"
    expect(psql(f"""
      select (r->>'status') || '|' || (r->>'total') || '|' || jsonb_array_length(r->'items')::text
        from (select {bot}('{A1}', 'c0000000-0000-0000-0000-000000000001', 3, '{{}}') as r) s
    """), "ok|5|3", "העטיפה של גבריאלה מחזירה את אותו מדגם")
    expect(psql(f"""
      select concat_ws('|',
        {bot}('{A1}', 'c0000000-0000-0000-0000-000000000006', 5, '{{}}') ->> 'status',
        {bot}('{A1}', 'c0000000-0000-0000-0000-000000000006', 5, array['elevator']) ->> 'status',
        {bot}('{A1}', 'c0000000-0000-0000-0000-000000000006', 5, array['mamad']) ->> 'status',
        coalesce({bot}('{A2}', 'c0000000-0000-0000-0000-000000000006', 5, array['mamad']) ->> 'status', 'null'))
    """), "skipped_feature|skipped_feature|ok|null", "ויתור על מאפיין חובה")
    expect(psql(f"""
      select has_function_privilege('authenticated', '{bot}(uuid,uuid,int,text[])', 'execute')::text
          || '|' || has_function_privilege('anon', '{bot}(uuid,uuid,int,text[])', 'execute')::text
    """), "false|false", "העטיפה של גבריאלה סגורה לדפדפן")

    # הרשאה: רק הלקוח/ה של הסוכן/ת המחובר/ת.
    expect(as_agent(A2, f"select ({r1} is null)::text"), "true", "לקוח/ה של סוכן/ת אחר/ת")
    expect(psql(f"select ({r1} is null)::text"), "true", "בלי קורא/ת")
    expect(psql("""
      select has_function_privilege('anon', 'public.agent_client_board_matches(uuid,int)', 'execute')::text
          || '|' || has_function_privilege('authenticated', 'public.agent_client_board_matches(uuid,int)', 'execute')::text
          || '|' || has_function_privilege('authenticated', 'public.client_board_matches(public.agent_clients,int,text[])', 'execute')::text
    """), "false|true|false", "הרשאות")

    # מודעה שסומנה כאותו נכס בלוח השני אינה חוזרת (העמודה מגיעה עם #1330).
    psql("""
      alter table public.listing_inventory add column is_duplicate boolean not null default false;
      update public.listing_inventory set is_duplicate = true where url like '%/item/b';
    """)
    expect(as_agent(A1, f"select ({r1} ->> 'total')"), "4", "is_duplicate לא חוזר")

    subprocess.check_call(["dropdb", "--if-exists", "--maintenance-db=postgres", DB])
    print("client board matches: ok")


if __name__ == "__main__":
    main()
