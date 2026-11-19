#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ההיצע בלוחות (listing_supply_stats): סיווג, סף, רבעונים, אחוזון וירידות מחיר.

    python3 scripts/listing_supply_test.py
"""

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIG = ROOT / "supabase/migrations/20271120110000_cma_board_supply.sql"
DB = os.environ.get("LISTING_SUPPLY_DB", "listing_supply_test")
CITY_ID = "11111111-1111-1111-1111-111111111111"

SETUP = f"""
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create table public.app_config (key text primary key, value text not null);
create table public.listing_inventory (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  external_ref text not null,
  city text not null,
  city_id uuid,
  deal_type text,
  property_type text,
  rooms numeric,
  price numeric,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  removed_at timestamptz
);
create table public.listing_inventory_price_history (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listing_inventory(id) on delete cascade,
  old_price numeric not null,
  new_price numeric not null,
  changed_at timestamptz not null default now()
);
create function public.city_id_for_name(p_name text) returns uuid language sql stable as $$
  select case when btrim(p_name) = 'עפולה' then '{CITY_ID}'::uuid end
$$;
"""


def psql(sql_text=None, db=DB):
    return subprocess.check_output(
        ["psql", "-X", "-v", "ON_ERROR_STOP=1", "-q", "-tA", "-d", db, "-c", sql_text],
        env={**os.environ, "PGOPTIONS": "-c client_min_messages=warning"},
        text=True, stderr=subprocess.STDOUT,
    ).strip()


def fail(msg):
    sys.exit(msg)


def expect(got, want, what):
    if got != want:
        fail(f"{what}: {got} (ציפינו {want})")


def add(n, ptype, rooms, price, deal="sale", source="yad2", city="עפולה", removed=False):
    ptype = ptype.replace("'", "''")
    psql(f"""
      insert into public.listing_inventory
        (source, external_ref, city, city_id, deal_type, property_type, rooms, price, removed_at)
      select '{source}', 'ref-' || gen_random_uuid(), '{city}', public.city_id_for_name('{city}'),
             '{deal}', '{ptype}', {rooms}, {price} + g * 0, {"now()" if removed else "null"}
        from generate_series(1, {n}) g
    """)


def stats(ptype, rooms, price, deal="sale", city="עפולה"):
    return f"public.listing_supply_stats('{city}', '{deal}', '{ptype}', {rooms}, {price})"


def main():
    subprocess.check_call(["dropdb", "--if-exists", "--maintenance-db=postgres", DB])
    subprocess.check_call(["createdb", "--maintenance-db=postgres", DB])
    psql(SETUP)
    # רק שתי הפונקציות של ההיצע. cma_report_finish צריכה את כל סכימת הדוח,
    # והיא נבדקת בהחלת המיגרציות על העתק הפרודקשן.
    src = MIG.read_text(encoding="utf-8")
    part = src[src.index("create or replace function public.board_listing_kind"):
               src.index("create or replace function public.cma_report_finish")]
    for _ in range(2):  # אידמפוטנטית
        psql(part)

    # הכתיב של יד2 (רווח אחרי הלוכסן) והכתיב של האתר מסווגים זהה.
    kinds = psql("""
      select string_agg(coalesce(public.board_listing_kind(t), '-'), ',' order by ord)
        from unnest(array['דירה', 'בית פרטי/ קוטג''', 'בית פרטי/קוטג''', 'גג/ פנטהאוז',
                          'גג/פנטהאוז', 'מיני פנטהאוז', 'דירת גן', 'דו משפחתי', 'מגרשים',
                          'קוטג'' טורי', 'סטודיו/ לופט', 'יחידת דיור', 'משרדים',
                          'משק חקלאי/ נחלה', 'בניין מגורים', '', null]) with ordinality as u(t, ord)
    """)
    expect(kinds, "unit,house,house,roof,roof,roof,garden,house,land,house,unit,unit,-,-,-,-,-",
           "סיווג סוגי הנכס")

    leaked = psql("""
      select has_function_privilege('anon', 'public.listing_supply_stats(text,text,text,numeric,numeric)', 'execute')::text
          || '|' || has_function_privilege('authenticated', 'public.listing_supply_stats(text,text,text,numeric,numeric)', 'execute')::text
          || '|' || has_function_privilege('service_role', 'public.listing_supply_stats(text,text,text,numeric,numeric)', 'execute')::text
    """)
    expect(leaked, "false|false|true", "הרשאת listing_supply_stats")

    # מתחת לסף: אין מספרים, רק status ו-sample.
    add(7, "דירה", 4, 1000000)
    few = psql(f"""
      select (r->>'status') || '|' || (r->>'sample') || '|' || (r ? 'median_price')::text
        from (select {stats('דירה', 4, 1200000)} as r) s
    """)
    expect(few, "too_few|7|false", "מתחת לסף")

    # 11 דירות 4 חדרים: 7 ב-1,000,000, ועוד 1.1 / 1.2 / 1.3 / 1.4 מיליון.
    for price in (1100000, 1200000, 1300000, 1400000):
        add(1, "דירה", 4, price)
    # מה שלא נספר: חדרים רחוקים, שכירות, עיר אחרת, סוג אחר, מודעה שירדה,
    # ומחירים שאינם סבירים.
    add(5, "דירה", 5, 1500000)
    add(5, "דירה", 4, 4000, deal="rent")
    add(5, "דירה", 4, 900000, city="חיפה")
    add(5, "גג/ פנטהאוז", 4, 2500000)
    add(5, "דירה", 4, 800000, removed=True)
    add(2, "דירה", 4, 5000)
    add(1, "דירה", 4, "'NaN'::numeric")
    # 4.5 חדרים בתוך הטווח.
    add(1, "דירה", 4.5, 1500000)

    ok = psql(f"""
      select concat_ws('|', r->>'status', r->>'sample', r->>'median_price', r->>'p25_price',
                       r->>'p75_price', r->>'min_price', r->>'max_price',
                       r->>'subject_percentile', r->>'cheaper_count',
                       r->'sources'->>'yad2', r->'sources'->>'madlan',
                       (r->'price_drops' is null or jsonb_typeof(r->'price_drops') = 'null')::text)
        from (select {stats('דירה', 4, 1200000)} as r) s
    """)
    # 12 מודעות: 7x1.0, 1.1, 1.2, 1.3, 1.4, 1.5. זולות מ-1.2: 8, שוויון: 1 -> (8+0.5)/12 = 71%.
    expect(ok, "ok|12|1000000|1000000|1225000|1000000|1500000|71|8|12|0|true", "מעל הסף")

    # הנכס עצמו בכתיב של האתר, המודעות בכתיב של יד2.
    add(8, "בית פרטי/ קוטג'", 5, 2000000)
    house = psql(f"""
      select (r->>'status') || '|' || (r->>'sample') || '|' || (r->>'kind')
        from (select {stats("בית פרטי/קוטג''", 5, 2100000)} as r) s
    """)
    expect(house, "ok|8|house", "בית בשני הכתיבים")

    # בלי חדרים, סוג מסחרי, או בלי עיר: אין השוואה.
    nulls = psql(f"""
      select ({stats('דירה', 'null', 1200000)} is null)::text
          || '|' || ({stats('משרדים', 4, 1200000)} is null)::text
          || '|' || (public.listing_supply_stats(null, 'sale', 'דירה', 4, 1) is null)::text
          || '|' || (public.listing_supply_stats('עפולה', 'lease', 'דירה', 4, 1) is null)::text
    """)
    expect(nulls, "true|true|true|true", "קלט שאין לו השוואה")

    # בלי מחיר לנכס: יש רבעונים, אין אחוזון.
    nopr = psql(f"""
      select (r->>'median_price') || '|' || (r->>'subject_percentile' is null)::text
        from (select {stats('דירה', 4, 'null')} as r) s
    """)
    expect(nopr, "1000000|true", "בלי מחיר לנכס")

    # ירידות מחיר: שתי מודעות ירדו (5% ו-10%), אחת עלתה, אחת "ירדה" ב-90% (טעות).
    psql("""
      with l as (
        select id, row_number() over (order by price, id) rn
          from public.listing_inventory
         where city = 'עפולה' and deal_type = 'sale' and property_type = 'דירה'
           and rooms = 4 and removed_at is null and price = 1000000
      )
      insert into public.listing_inventory_price_history (listing_id, old_price, new_price)
      select id, case rn when 1 then 1052632 when 2 then 1111111 when 3 then 900000 else 10000000 end,
             1000000
        from l where rn <= 4;
    """)
    # ירידות מוצגות רק אחרי 7 ימי מעקב: שלושה ימים - אין, עשרה - יש.
    psql("insert into public.app_config (key, value) values "
         "('listing_price_history_since', (now() - interval '3 days')::text)")
    expect(psql(f"""
      select coalesce((r->'price_drops'->>'listings'), 'none')
        from (select {stats('דירה', 4, 1200000)} as r) s
    """), "none", "ירידות לפני שבוע של מעקב")
    psql("update public.app_config set value = (now() - interval '10 days')::text "
         "where key = 'listing_price_history_since'")
    drops = psql(f"""
      select concat_ws('|', r->'price_drops'->>'listings', r->'price_drops'->>'share_pct',
                       r->'price_drops'->>'median_drop_pct', r->'price_drops'->>'window_days')
        from (select {stats('דירה', 4, 1200000)} as r) s
    """)
    # 2 מתוך 12 = 17%. הירידות 5% ו-10%, חציון 7.5.
    expect(drops, "2|17|7.5|10", "ירידות מחיר")

    # מודעה שסומנה כאותו נכס בלוח השני נספרת פעם אחת, כשהעמודה קיימת (#1330).
    psql("""
      alter table public.listing_inventory add column is_duplicate boolean not null default false;
      update public.listing_inventory set is_duplicate = true
       where id in (select id from public.listing_inventory
                     where city = 'עפולה' and deal_type = 'sale' and property_type = 'דירה'
                       and rooms = 4 and removed_at is null and price = 1000000 limit 2);
    """)
    expect(psql(f"select {stats('דירה', 4, 1200000)} ->> 'sample'"), "10", "is_duplicate לא נספר")

    subprocess.check_call(["dropdb", "--if-exists", "--maintenance-db=postgres", DB])
    print("listing supply: ok")


if __name__ == "__main__":
    main()
