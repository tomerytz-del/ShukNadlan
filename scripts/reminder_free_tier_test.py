#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""וואטסאפ מתזכורות: מסלול חינם בלי הערוץ, מסלול בתשלום כמו קודם."""

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/20271030183000_reminder_free_no_whatsapp.sql"

sql = MIGRATION.read_text(encoding="utf-8")
for required in (
    "r.tier in ('mid', 'premium')",
    "array_remove(r.channels, 'whatsapp')",
    "revoke all on function public.agent_reminder_due_agents() from public, anon, authenticated",
    "grant execute on function public.agent_reminder_due_agents() to service_role",
):
    if required not in sql:
        sys.exit(f"חסר במיגרציה: {required}")
if "billing_status" in sql:
    sys.exit("המיגרציה מוסיפה billing_status; השער כאן הוא המסלול בלבד")

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

create table public.pricing_config (
  key text primary key,
  value int not null
);
insert into public.pricing_config (key, value) values
  ('agent_reminder_default_cap', 6),
  ('reminder_max_failures_24h', 3);

create table public.agency_members (
  id uuid primary key,
  display_name text,
  email text,
  phone_e164 text,
  tier text,
  active boolean not null default true,
  closed_at timestamptz,
  closure_requested_at timestamptz
);

create table public.agent_reminder_preferences (
  agent_id uuid primary key references public.agency_members(id),
  channels text[],
  muted_kinds text[],
  cadence text,
  max_per_30_days int,
  quiet_from_hour int,
  quiet_to_hour int,
  quiet_days smallint[]
);

create table public.agent_reminder_log (
  agent_id uuid,
  email_status text,
  whatsapp_status text,
  created_at timestamptz not null default now()
);

create function public.agent_reminder_log_holds(
  email_status text, whatsapp_status text, created_at timestamptz
) returns boolean language sql immutable as $$ select false $$;

create function public.agent_reminder_quiet_now(
  p_from int, p_to int, p_days smallint[]
) returns boolean language sql immutable as $$ select false $$;
"""

SEED = r"""
insert into public.agency_members (id, display_name, email, phone_e164, tier) values
  ('11111111-1111-1111-1111-111111111111', 'free-default', 'free-default@example.com', '972500000001', 'free'),
  ('22222222-2222-2222-2222-222222222222', 'free-both',    'free-both@example.com',    '972500000002', 'free'),
  ('33333333-3333-3333-3333-333333333333', 'free-wa',      'free-wa@example.com',      '972500000003', 'free'),
  ('44444444-4444-4444-4444-444444444444', 'free-email',   'free-email@example.com',   '972500000004', 'free'),
  ('55555555-5555-5555-5555-555555555555', 'mid-default',  'mid-default@example.com',  '972500000005', 'mid'),
  ('66666666-6666-6666-6666-666666666666', 'prem-both',    'prem-both@example.com',    '972500000006', 'premium'),
  ('77777777-7777-7777-7777-777777777777', 'mid-nophone',  'mid-nophone@example.com',  null,           'mid'),
  ('88888888-8888-8888-8888-888888888888', 'free-noemail', null,                       '972500000008', 'free'),
  ('99999999-9999-9999-9999-999999999999', 'null-default', 'null-default@example.com', '972500000009', null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'null-wa',      'null-wa@example.com',      '97250000000a', null),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'free-empty',   'free-empty@example.com',   '97250000000b', 'free'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'free-wa-nomail', null,                    '97250000000c', 'free');

insert into public.agent_reminder_preferences (agent_id, channels) values
  ('22222222-2222-2222-2222-222222222222', array['email','whatsapp']::text[]),
  ('33333333-3333-3333-3333-333333333333', array['whatsapp']::text[]),
  ('44444444-4444-4444-4444-444444444444', array['email']::text[]),
  ('66666666-6666-6666-6666-666666666666', array['email','whatsapp']::text[]),
  ('77777777-7777-7777-7777-777777777777', array['whatsapp']::text[]),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', array['whatsapp']::text[]),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '{}'::text[]),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', array['whatsapp']::text[]);
"""


def psql(db, *files, sql_text=None):
    cmd = ["psql", "-v", "ON_ERROR_STOP=1", "-q", "-tA", db]
    if sql_text is not None:
        cmd.extend(["-c", sql_text])
    for path in files:
        cmd.extend(["-f", str(path)])
    return subprocess.check_output(
        cmd, env={**os.environ, "PGOPTIONS": "-c client_min_messages=warning"}, text=True
    ).strip()


def channels(db):
    out = psql(
        db,
        sql_text="""
        select display_name || '=' || coalesce(array_to_string(channels, '+'), '')
          from public.agent_reminder_due_agents()
         order by 1
        """,
    )
    found = {}
    for line in out.splitlines():
        if not line or "=" not in line:
            continue
        name, ch = line.split("=", 1)
        found[name] = set(filter(None, ch.split("+")))
    return found


def expect(found, name, want):
    got = found.get(name)
    if got != want:
        sys.exit(f"{name}: ציפיתי {sorted(want) if want is not None else 'היעדר'} קיבלתי {got}")


def main():
    db = os.environ.get("REMINDER_TIER_DB", "reminder_free_tier_test")
    subprocess.check_call(["dropdb", "--if-exists", "--maintenance-db=postgres", db])
    subprocess.check_call(["createdb", "--maintenance-db=postgres", db])
    psql(db, sql_text=SETUP)
    psql(db, MIGRATION)
    psql(db, MIGRATION)
    psql(db, sql_text=SEED)

    found = channels(db)
    expect(found, "free-default", {"email"})
    expect(found, "free-wa", {"email"})
    expect(found, "free-both", {"email"})
    expect(found, "free-email", {"email"})
    expect(found, "free-noemail", None)
    expect(found, "free-wa-nomail", None)
    expect(found, "free-empty", None)
    expect(found, "null-default", {"email"})
    expect(found, "null-wa", {"email"})
    expect(found, "mid-default", {"whatsapp"})
    expect(found, "prem-both", {"email", "whatsapp"})
    expect(found, "mid-nophone", {"whatsapp", "email"})
    for name, ch in found.items():
        if name.startswith(("free-", "null-")) and "whatsapp" in ch:
            sys.exit(f"וואטסאפ נשאר ל-{name}")
    print("reminder free tier: ok")


if __name__ == "__main__":
    main()
