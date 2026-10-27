#!/usr/bin/env python3
"""חלון השליחה וסף ההסלמה, על Postgres מקומי.

שישי 08:00-13:00 פתוח רק כשהדגל 1. משישי 13:00 עד ראשון 08:00 סגור.
דגל 0 משאיר את שישי שלם שקט. agenda_reminder נשאר החריג היחיד בגוף
של notification_push_due_agents. ההסלמה לא כותבת כשהדגל 0 או כשהחלון סגור.

    python3 scripts/send_window_test.py
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MIG = ROOT / "supabase/migrations/20271028230000_send_window_friday.sql"
QUIET = ROOT / "supabase/migrations/20270902090000_notification_push_quiet_hold.sql"
DB = os.environ.get("SEND_WINDOW_TEST_DB", "send_window_test")


def fail(msg: str) -> None:
    print(f"✗ {msg}")
    sys.exit(1)


def extract(path: Path, name: str) -> str:
    text = path.read_text(encoding="utf-8")
    needle = f"function public.{name}"
    idx = text.find(needle)
    if idx < 0:
        fail(f"לא נמצאה {name} ב-{path.name}")
    start = text.rfind("create or replace function", 0, idx + len("function"))
    dollar = text.find("$$", start)
    end = text.find("$$", dollar + 2)
    if start < 0 or dollar < 0 or end < 0:
        fail(f"לא חולצה {name}")
    return text[start:end + 2] + ";\n"


def psql(sql: str, db: str = DB) -> str:
    env = os.environ.copy()
    cmd = ["psql", "-v", "ON_ERROR_STOP=1", "-d", db, "-At", "-c", sql]
    proc = subprocess.run(cmd, env=env, text=True, capture_output=True)
    if proc.returncode != 0:
        fail(f"psql נכשל:\n{proc.stderr}\n{sql[:400]}")
    return proc.stdout.strip()


def psql_script(sql: str, db: str = DB) -> None:
    env = os.environ.copy()
    proc = subprocess.run(
        ["psql", "-v", "ON_ERROR_STOP=1", "-d", db],
        env=env, text=True, input=sql, capture_output=True,
    )
    if proc.returncode != 0:
        fail(f"psql נכשל:\n{proc.stderr[-2000:]}")


def main() -> int:
    src = MIG.read_text(encoding="utf-8")
    if "array['agenda_reminder']::text[]" not in src:
        fail("חריג agenda_reminder נעלם מ-due_agents")
    if "notification_agent_send_quiet" not in src:
        fail("due_agents אינו קורא לחלון החדש")
    if "('notif_send_window_friday_enabled', 0," not in src:
        fail("הדגל אינו נולד 0")
    if src.count("'agenda_reminder'") < 1:
        fail("אין חריג agenda_reminder")
    # ההסלמה אינה נכנסת לרשימת ה-urgent
    urgent = src.split("as urgent", 1)[0]
    if "lead_response_reminder" in urgent.split("array[")[-1]:
        fail("ההסלמה סומנה urgent ועוקפת שקט")

    subprocess.run(["dropdb", "--if-exists", DB], check=False)
    subprocess.run(["createdb", DB], check=True)
    try:
        setup = extract(QUIET, "agent_reminder_quiet_at(")
        setup += extract(MIG, "notification_send_window_open(")
        setup += extract(MIG, "notification_agent_send_quiet(")
        setup += """
create table public.pricing_config (key text primary key, value int, description text);
insert into public.pricing_config (key, value) values ('notif_send_window_friday_enabled', 0);
create table public.agency_members (
  id uuid primary key, agency_id uuid, role text, active boolean default true,
  closed_at timestamptz, is_platform_admin boolean default false, display_name text
);
create table public.leads (
  id uuid primary key, agent_id uuid, agency_id uuid,
  first_response_at timestamptz, created_at timestamptz not null
);
create table public.lead_archives (lead_id uuid primary key, agent_id uuid);
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid, type text, title text, body text,
  related_lead_id uuid, suppress_push boolean not null default false,
  created_at timestamptz default now()
);
"""
        setup += extract(MIG, "lead_response_escalations(")
        psql_script(setup)

        cases = [
            ("שישי 10:00 פתוח", "2026-10-30 10:00:00+02", "t"),
            ("שישי 08:00 פתוח", "2026-10-30 08:00:00+02", "t"),
            ("שישי 07:59 סגור", "2026-10-30 07:59:00+02", "f"),
            ("שישי 13:00 סגור", "2026-10-30 13:00:00+02", "f"),
            ("שבת 12:00 סגור", "2026-10-31 12:00:00+02", "f"),
            ("ראשון 07:00 סגור", "2026-11-01 07:00:00+02", "f"),
            ("ראשון 08:00 פתוח", "2026-11-01 08:00:00+02", "t"),
            ("חמישי 20:00 פתוח", "2026-10-29 20:00:00+02", "t"),
            ("חמישי 21:00 סגור", "2026-10-29 21:00:00+02", "f"),
        ]
        for name, ts, expect in cases:
            got = psql(f"select public.notification_send_window_open(timestamptz '{ts}')")
            if got != expect:
                fail(f"{name}: ציפינו {expect}, קיבלנו {got}")
            print(f"✓ {name}")

        quiet = [
            ("דגל 0: שישי 10:00 שקט", 0, "2026-10-30 10:00:00+02", "{5,6}", "t"),
            ("דגל 1: שישי 10:00 פתוח", 1, "2026-10-30 10:00:00+02", "{5,6}", "f"),
            ("דגל 1: שישי 14:00 סגור", 1, "2026-10-30 14:00:00+02", "{5,6}", "t"),
            ("דגל 1: שבת סגורה גם בלי יום 6", 1, "2026-10-31 12:00:00+02", "{}", "t"),
            ("דגל 1: חמישי 20:00 פתוח", 1, "2026-10-29 20:00:00+02", "{5,6}", "f"),
            ("דגל 1: חמישי 21:00 שקט", 1, "2026-10-29 21:00:00+02", "{5,6}", "t"),
            ("דגל 1: ראשון 08:00 פתוח", 1, "2026-11-01 08:00:00+02", "{5,6}", "f"),
            ("דגל 1: שעות הסוכן מצמצמות", 1, "2026-10-29 10:00:00+02", "{6}", "t"),
        ]
        for name, flag, ts, days, expect in quiet:
            # השעות 8-13 רק במקרה האחרון. בשאר 21-8 כמו ברירת המחדל.
            frm, to = (8, 13) if "שעות הסוכן" in name else (21, 8)
            got = psql(
                "select public.notification_agent_send_quiet("
                f"{frm}, {to}, '{days}'::smallint[], timestamptz '{ts}', {flag})"
            )
            if got != expect:
                fail(f"{name}: ציפינו {expect}, קיבלנו {got}")
            print(f"✓ {name}")

        agent = "11111111-1111-4111-8111-111111111111"
        mgr = "22222222-2222-4222-8222-222222222222"
        admin = "33333333-3333-4333-8333-333333333333"
        agency = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        lead3 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1"
        lead5 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2"
        lead_old = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3"
        fri_10 = "2026-10-30 10:00:00+02"
        fri_14 = "2026-10-30 14:00:00+02"
        psql_script(f"""
insert into public.agency_members (id, agency_id, role, active, is_platform_admin)
values
  ('{agent}', '{agency}', 'agent', true, false),
  ('{mgr}', '{agency}', 'manager', true, false),
  ('{admin}', null, 'agent', true, true);
insert into public.leads (id, agent_id, agency_id, created_at) values
  ('{lead3}', '{agent}', '{agency}', timestamptz '{fri_10}' - interval '3 hours'),
  ('{lead5}', '{agent}', '{agency}', timestamptz '{fri_10}' - interval '5 hours');
""")
        n = psql(f"select public.lead_response_escalations(timestamptz '{fri_10}')")
        if n != "0" or psql("select count(*) from public.notifications") != "0":
            fail(f"דגל 0 כתב שורות ({n})")
        print("✓ דגל 0 אינו כותב")

        psql("update public.pricing_config set value = 1 where key = 'notif_send_window_friday_enabled'")
        n = psql(f"select public.lead_response_escalations(timestamptz '{fri_14}')")
        if n != "0" or psql("select count(*) from public.notifications") != "0":
            fail("שישי 14:00 כתב שורות")
        print("✓ חלון סגור אינו כותב")

        n = psql(f"select public.lead_response_escalations(timestamptz '{fri_10}')")
        if n != "3":
            fail(f"ציפינו 3 שורות (תזכורת+הסלמה לשני לידים חלקי), קיבלנו {n}")
        # lead3 is 3h: reminder only. lead5 is 5h: reminder + manager.
        got_types = psql(
            "select related_lead_id::text || ' ' || type || ' ' || agent_id::text "
            "from public.notifications order by 1"
        )
        wanted = "\n".join([
            f"{lead3} lead_response_reminder {agent}",
            f"{lead5} lead_response_escalation {mgr}",
            f"{lead5} lead_response_reminder {agent}",
        ])
        if got_types != wanted:
            fail(f"נמענים לא נכונים:\n{got_types}\n---\n{wanted}")
        if psql("select count(*) from public.notifications where type = 'agenda_reminder'") != "0":
            fail("נכתב agenda_reminder")
        print("✓ שעתיים לסוכן/ת, ארבע למנהל/ת, בלי agenda_reminder")

        again = psql(f"select public.lead_response_escalations(timestamptz '{fri_10}')")
        if again != "0" or psql("select count(*) from public.notifications") != "3":
            fail("הסבב השני כתב כפילות")
        print("✓ אין כפילות")

        psql("delete from public.notifications")
        psql(f"update public.agency_members set active = false where id = '{mgr}'")
        psql(f"delete from public.leads where id = '{lead3}'")
        n = psql(f"select public.lead_response_escalations(timestamptz '{fri_10}')")
        dest = psql(
            f"select agent_id::text from public.notifications "
            f"where type = 'lead_response_escalation' and related_lead_id = '{lead5}'"
        )
        if dest != admin:
            fail(f"בלי מנהל/ת הציפייה למנהל/ת פלטפורמה, קיבלנו {dest}")
        print("✓ בלי מנהל/ת ההסלמה למנהל/ת הפלטפורמה")

        psql("delete from public.notifications")
        psql(f"update public.leads set first_response_at = created_at where id = '{lead5}'")
        n = psql(f"select public.lead_response_escalations(timestamptz '{fri_10}')")
        if n != "0":
            fail("ליד שנענה הוסלם")
        print("✓ ליד שנענה אינו מוסלם")

        psql(f"update public.leads set first_response_at = null where id = '{lead5}'")
        psql(f"insert into public.lead_archives (lead_id, agent_id) values ('{lead5}', '{agent}')")
        n = psql(f"select public.lead_response_escalations(timestamptz '{fri_10}')")
        if n != "0":
            fail("ליד בארכיון הוסלם")
        print("✓ ליד בארכיון אינו מוסלם")

        psql(f"insert into public.leads (id, agent_id, agency_id, created_at) values "
             f"('{lead_old}', '{agent}', '{agency}', timestamptz '{fri_10}' - interval '8 days')")
        n = psql(f"select public.lead_response_escalations(timestamptz '{fri_10}')")
        if n != "0":
            fail("ליד ישן משבוע הוסלם")
        print("✓ ליד ישן משבוע אינו מוסלם")
        print("עבר")
        return 0
    finally:
        subprocess.run(["dropdb", "--if-exists", DB], check=False)


if __name__ == "__main__":
    sys.exit(main())
