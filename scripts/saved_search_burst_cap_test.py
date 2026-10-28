#!/usr/bin/env python3
"""גל פרסום לא עוקף את תקרת 5 ליום של saved-search-notify, ולא את שעות השקט.

הפונקציה saved_search_pending_alerts היא מה שהשרת שולח. הבדיקה מריצה אותה
על עשרה נכסים לאותו מחפש, ועוד שניים למחפש שני.

    python3 scripts/saved_search_burst_cap_test.py
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MIG = ROOT / "supabase/migrations/20271029186000_gabriela_publish_ask_nudge.sql"
DB = os.environ.get("SAVED_SEARCH_CAP_TEST_DB", "saved_search_burst_cap_test")


def psql(sql: str, db: str = DB) -> str:
    r = subprocess.run(
        ["sudo", "-u", "postgres", "psql", "-d", db, "-v", "ON_ERROR_STOP=1", "-tA", "-c", sql],
        check=False, capture_output=True, text=True,
    )
    if r.returncode != 0:
        sys.stderr.write(r.stderr)
        sys.stderr.write(r.stdout)
        raise SystemExit(r.returncode)
    return r.stdout.strip()


def main() -> None:
    subprocess.run(
        ["sudo", "-u", "postgres", "psql", "-d", "postgres", "-c", f"drop database if exists {DB};"],
        check=True,
    )
    subprocess.run(
        ["sudo", "-u", "postgres", "psql", "-d", "postgres", "-c", f"create database {DB};"],
        check=True,
    )
    setup = r"""
create table public.pricing_config (key text primary key, value int, description text);
insert into public.pricing_config (key, value) values
  ('saved_search_daily_cap', 5),
  ('saved_search_quiet_from_hour', 22),
  ('saved_search_quiet_to_hour', 8);

create table public.neighborhoods (id uuid primary key, name text);
create table public.saved_searches (
  id uuid primary key,
  full_name text,
  phone_e164 text,
  email text,
  contact_channel text,
  label text,
  unsubscribe_token text,
  status text
);
create table public.properties (
  id uuid primary key,
  title text,
  price numeric,
  rooms numeric,
  size_sqm numeric,
  area_sqm numeric,
  floor int,
  city text,
  neighborhood_id uuid,
  street text,
  property_type text,
  deal_type text,
  images text[],
  status text
);
create table public.saved_search_alerts (
  id uuid primary key,
  search_id uuid,
  property_id uuid,
  click_token text,
  status text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create or replace function public.saved_search_quiet_now()
returns boolean
language sql stable
set search_path = ''
as $$
  with cfg as (
    select
      coalesce((select value::int from public.pricing_config where key = 'saved_search_quiet_from_hour'), 22) as from_h,
      coalesce((select value::int from public.pricing_config where key = 'saved_search_quiet_to_hour'), 8) as to_h
  ),
  now_h as (
    select extract(hour from (now() at time zone 'Asia/Jerusalem'))::int as h
  )
  select case
           when cfg.from_h = cfg.to_h then false
           when cfg.from_h < cfg.to_h then now_h.h >= cfg.from_h and now_h.h < cfg.to_h
           else now_h.h >= cfg.from_h or now_h.h < cfg.to_h
         end
    from cfg, now_h;
$$;
"""
    psql(setup)

    fn = MIG.read_text()
    start = fn.index("create or replace function public.saved_search_pending_alerts")
    body = fn[start:]
    r = subprocess.run(
        ["sudo", "-u", "postgres", "psql", "-d", DB, "-v", "ON_ERROR_STOP=1"],
        input=body, text=True, capture_output=True, check=False,
    )
    if r.returncode != 0:
        sys.stderr.write(r.stderr)
        raise SystemExit(r.returncode)

    seed = r"""
insert into public.saved_searches (id, full_name, contact_channel, label, unsubscribe_token, status) values
  ('11111111-1111-4111-8111-111111111111', 'מחפש אחד', 'email', 'דירה', 'u1', 'active'),
  ('22222222-2222-4222-8222-222222222222', 'מחפשת שנייה', 'email', 'דירה', 'u2', 'active');
insert into public.properties (id, title, status, city)
select gen_random_uuid(), 'נכס ' || g, 'active', 'עפולה'
  from generate_series(1, 12) g;
insert into public.saved_search_alerts (id, search_id, property_id, click_token, status, created_at)
select gen_random_uuid(), '11111111-1111-4111-8111-111111111111', p.id, 'c' || row_number() over (order by p.title), 'pending', now() - (g || ' minutes')::interval
  from (select id, title, row_number() over (order by title) as g from public.properties order by title limit 10) p;
insert into public.saved_search_alerts (id, search_id, property_id, click_token, status, created_at)
select gen_random_uuid(), '22222222-2222-4222-8222-222222222222', p.id, 'd' || row_number() over (order by p.title), 'pending', now()
  from (select id, title from public.properties order by title offset 10 limit 2) p;
"""
    psql(seed)

    # שעות שקט: החלון כולל את השעה הנוכחית בישראל.
    psql("""
update public.pricing_config
   set value = extract(hour from (now() at time zone 'Asia/Jerusalem'))::int
 where key = 'saved_search_quiet_from_hour';
update public.pricing_config
   set value = (extract(hour from (now() at time zone 'Asia/Jerusalem'))::int + 1) % 24
 where key = 'saved_search_quiet_to_hour';
""")
    quiet = psql("select count(*) from public.saved_search_pending_alerts(50)")
    if quiet != "0":
        raise SystemExit(f"quiet hours returned {quiet}")

    # שקט מבוטל: שעת התחלה = שעת סיום.
    psql("update public.pricing_config set value = 0 where key in ('saved_search_quiet_from_hour', 'saved_search_quiet_to_hour')")
    by_search = psql("""
select search_id || ':' || count(*)
  from public.saved_search_pending_alerts(50)
 group by search_id
 order by search_id
""")
    lines = [ln for ln in by_search.splitlines() if ln.strip()]
    got = dict(ln.split(":") for ln in lines)
    if got.get("11111111-1111-4111-8111-111111111111") != "5":
        raise SystemExit(f"first seeker expected 5, got {got}")
    if got.get("22222222-2222-4222-8222-222222222222") != "2":
        raise SystemExit(f"second seeker expected 2, got {got}")

    # ארבע כבר יצאו היום: נשארת אחת.
    psql("""
update public.saved_search_alerts
   set status = 'sent', sent_at = now()
 where id in (
   select id from public.saved_search_alerts
    where search_id = '11111111-1111-4111-8111-111111111111'
      and status = 'pending'
    order by created_at
    limit 4
 );
""")
    left = psql("""
select count(*) from public.saved_search_pending_alerts(50)
 where search_id = '11111111-1111-4111-8111-111111111111'
""")
    if left != "1":
        raise SystemExit(f"after 4 sent expected 1 more, got {left}")

    print("saved search burst cap: ok")


if __name__ == "__main__":
    main()
