#!/usr/bin/env python3
"""חריץ תבנית שמור לתקציר היומי, מעל הגג, רק כשהתקרה דלוקה.

    python3 scripts/whatsapp_template_cap_digest_test.py
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MIG = ROOT / "supabase/migrations/20271030000500_template_cap_digest_reserved.sql"
DB = os.environ.get("TEMPLATE_CAP_DIGEST_TEST_DB", "template_cap_digest_test")


def fail(msg: str) -> None:
    print(f"✗ {msg}")
    sys.exit(1)


def psql(sql: str) -> str:
    proc = subprocess.run(
        ["psql", "-v", "ON_ERROR_STOP=1", "-d", DB, "-At", "-c", sql],
        text=True, capture_output=True,
    )
    if proc.returncode != 0:
        fail(f"psql נכשל:\n{proc.stderr}\n{sql[:500]}")
    return proc.stdout.strip()


def at(local: str) -> str:
    return f"(timestamp '{local}' at time zone 'Asia/Jerusalem')"


def kind(now: str, last: str, count: int, used: int) -> str:
    return psql(
        "select public.whatsapp_template_cap_digest_kind("
        f"{at(now)}, {at(last)}, {count}, {used})"
    )


def main() -> int:
    src = MIG.read_text(encoding="utf-8")
    if "('whatsapp_template_cap_digest_reserved', '1'," not in src:
        fail("החריץ אינו נולד 1")
    if "whatsapp_template_cap_enabled" in src.split("insert into public.app_config", 1)[-1].split(";", 1)[0]:
        fail("המיגרציה מדליקה את תקרת התבניות")
    claim = src.split("function public.notification_push_claim", 1)[1]
    if "if v_cap_held and public.whatsapp_template_cap_on()" not in claim:
        fail("החריץ רץ גם כשהתקרה כבויה")
    if "array['template_cap_digest_reserved']" not in claim:
        fail("החריץ אינו מסומן על שורת התקציר")
    if "whatsapp_template_cap_exempt" not in src.split("function public.whatsapp_template_cap_allow", 1)[1].split("digest_allow_reserved", 1)[0]:
        fail("ליד ותזכורת וסיור אינם יוצאים לפני החריץ")

    subprocess.run(["dropdb", "--if-exists", DB], check=False)
    subprocess.run(["createdb", DB], check=True)
    setup = """
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
create table public.app_config (key text primary key, value text not null, description text not null default '');
create table public.pricing_config (key text primary key, value int, description text);
create table public.notification_push_log (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid, notification_ids uuid[], types text[], channel_mode text,
  whatsapp_status text, last_error text, created_at timestamptz default now()
);
create table public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(), agent_id uuid, direction text,
  msg_type text, error text, created_at timestamptz default now()
);
create function public.notification_push_log_holds(p_status text, p_created timestamptz)
returns boolean language sql as $$
  select p_status in ('sent', 'skipped')
      or (p_status = 'pending' and p_created > now() - interval '30 minutes');
$$;
create function public.whatsapp_template_local_day(p_at timestamptz)
returns date language sql immutable as $$
  select (p_at at time zone 'Asia/Jerusalem')::date;
$$;
create function public.whatsapp_template_cap_decide(
  p_count int, p_hours numeric, p_exempt boolean,
  p_daily numeric, p_hard numeric, p_gap_hours numeric)
returns boolean language sql immutable as $$
  select case
    when coalesce(p_exempt, false) then true
    when coalesce(p_count, 0) < greatest(coalesce(p_daily, 1), 0) then true
    when coalesce(p_count, 0) >= greatest(coalesce(p_hard, 2), greatest(coalesce(p_daily, 1), 0)) then false
    when p_hours is not null and p_hours >= coalesce(p_gap_hours, 8) then true
    else false
  end;
$$;
create function public.whatsapp_template_cap_usage(p_agent uuid, p_except uuid)
returns table (n int, last_at timestamptz) language sql as $$
  select count(*)::int, max(l.created_at)
    from public.notification_push_log l
   where l.agent_id = p_agent
     and l.id is distinct from p_except
     and l.channel_mode = 'template'
     and l.whatsapp_status in ('sent', 'pending')
     and public.notification_push_log_holds(l.whatsapp_status, l.created_at)
     and public.whatsapp_template_local_day(l.created_at)
         = public.whatsapp_template_local_day(now());
$$;
create table public.notifications (
  id uuid primary key, agent_id uuid, type text, read boolean, suppress_push boolean,
  created_at timestamptz, push_deferred_at timestamptz, related_property_id uuid,
  related_lead_id uuid
);
create table public.leads (id uuid primary key, source text);
create function public.notification_push_due_agents()
returns table (agent_id uuid, display_name text, phone_e164 text, whatsapp_types text[], in_service_window boolean)
language sql as $$
  select null::uuid, null::text, null::text, null::text[], false where false
$$;
create function public.whatsapp_template_cap_on() returns boolean language sql as $$ select false $$;
create function public.notification_push_priority_types() returns text[] language sql as $$
  select array['new_lead']::text[] $$;
create function public.notification_push_burst_exempt(p_type text, p_source text) returns boolean language sql as $$
  select false $$;
create function public.notification_push_stale_in_quiet(p_type text, p_agent uuid, p_created timestamptz)
returns boolean language sql as $$ select false $$;
create function public.notification_push_is_ambient(p_type text, p_agent uuid, p_property uuid)
returns boolean language sql as $$ select false $$;
create function public.notif_il_digest_open(p_window int) returns boolean language sql as $$ select false $$;
"""
    proc = subprocess.run(
        ["psql", "-v", "ON_ERROR_STOP=1", "-d", DB],
        text=True, input=setup, capture_output=True,
    )
    if proc.returncode != 0:
        fail(f"הקמה נכשלה:\n{proc.stderr[-2000:]}")
    proc = subprocess.run(
        ["psql", "-v", "ON_ERROR_STOP=1", "-d", DB, "-f", str(MIG)],
        text=True, capture_output=True,
    )
    if proc.returncode != 0:
        fail(f"המיגרציה נכשלה:\n{proc.stderr[-2000:]}")

    if psql("select public.whatsapp_template_cap_limit('whatsapp_template_cap_digest_reserved', 1)") != "1":
        fail("ברירת המחדל של החריץ אינה 1")
    psql("update public.app_config set value = '1.5' where key = 'whatsapp_template_cap_digest_reserved'")
    if psql("select public.whatsapp_template_cap_limit('whatsapp_template_cap_digest_reserved', 1)") != "1":
        fail("1.5 מתעגל במקום ליפול לברירת המחדל")
    psql("update public.app_config set value = '1' where key = 'whatsapp_template_cap_digest_reserved'")

    # שני לידים מילאו את הגג ב-08:30. 13:00 מוקדם מדי. 17:30 הוא 9 שעות.
    if kind("2026-10-28 13:00:00", "2026-10-28 08:30:00", 2, 0) != "wait":
        fail("התקציר יוצא לפני 8 שעות")
    if kind("2026-10-28 17:30:00", "2026-10-28 08:30:00", 2, 0) != "reserved":
        fail("התקציר אינו יוצא בחלון שאחרי 8 שעות")
    if psql("select public.whatsapp_template_cap_decide(2, 9, false, 1, 2, 8)") != "f":
        fail("החריץ השמור נחשב חריץ רגיל")

    # 12:00: 17:30 הוא 5.5 שעות, אז רק 08:30 למחרת.
    if kind("2026-10-28 17:30:00", "2026-10-28 12:00:00", 2, 0) != "wait":
        fail("התקציר יוצא היום בלי מרווח של 8 שעות")
    if kind("2026-10-29 08:30:00", "2026-10-28 12:00:00", 2, 0) != "reserved":
        fail("התקציר אינו עובר לבוקר של מחר")

    if psql("select public.whatsapp_template_cap_digest_channel(true, 'reserved')") != "text":
        fail("תקציר בחלון 24 השעות יוצא כתבנית")
    if psql("select public.whatsapp_template_cap_digest_channel(true, 'wait')") != "text":
        fail("תקציר בחלון 24 השעות מחכה למרווח")
    if psql("select public.whatsapp_template_cap_digest_channel(false, 'wait')") != "none":
        fail("בלי מרווח ובלי חלון 24 השעות התקציר יוצא")

    if kind("2026-10-28 17:30:00", "2026-10-28 08:30:00", 2, 1) != "wait":
        fail("חריץ שמור שני באותו יום")

    if psql("select public.whatsapp_template_cap_decide(2, 1, true, 1, 2, 8)") != "t":
        fail("ליד מעל הגג נעצר")

    agent = "11111111-1111-4111-8111-111111111111"
    psql(f"""
insert into public.notification_push_log
  (agent_id, channel_mode, whatsapp_status, created_at, types) values
  ('{agent}', 'template', 'sent', now() - interval '9 hours', array['new_lead']),
  ('{agent}', 'template', 'sent', now() - interval '9 hours', array['new_lead']),
  ('{agent}', 'text', 'sent', now(), array['template_cap_digest_reserved','open_demand']);
""")
    if psql(f"select n from public.whatsapp_template_cap_usage('{agent}', null)") != "2":
        fail("טקסט חופשי נספר כתבנית")
    if psql(f"select public.whatsapp_template_cap_digest_reserved_used('{agent}', null)") != "0":
        fail("טקסט חופשי נספר כחריץ שמור")
    psql(f"""
insert into public.notification_push_log
  (agent_id, channel_mode, whatsapp_status, created_at, types) values
  ('{agent}', 'template', 'sent', now(), array['template_cap_digest_reserved','open_demand']);
""")
    if psql(f"select public.whatsapp_template_cap_digest_reserved_used('{agent}', null)") != "1":
        fail("חריץ שמור שיצא אינו נספר")

    print("✓ חריץ תקציר שמור: כל הבדיקות עברו")
    return 0


if __name__ == "__main__":
    sys.exit(main())
