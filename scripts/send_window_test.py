#!/usr/bin/env python3
"""חלון השליחה וסף ההסלמה, על Postgres מקומי.

שישי 08:00-13:00 פתוח רק כשהדגל 1. משישי 13:00 עד ראשון 08:00 סגור.
דגל 0 משאיר את שישי שלם שקט. agenda_reminder נשאר החריג היחיד בגוף
של notification_push_due_agents. ההסלמה לא כותבת כשהדגל 0 או כשהחלון סגור.

    python3 scripts/send_window_test.py
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MIG = ROOT / "supabase/migrations/20271028230000_send_window_friday.sql"
ESC = ROOT / "supabase/migrations/20271028250000_lead_escalations.sql"
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
    esc = ESC.read_text(encoding="utf-8")
    if re.search(r"update\s+public\.pricing_config[\s\S]{0,200}notif_send_window_friday_enabled", esc, re.I):
        fail("המיגרציה מדליקה את הדגל")
    if re.search(r"\b(raw_phone|raw_name|full_name|phone_e164)\b", esc.split("create table", 1)[-1].split(");", 1)[0]):
        fail("בטבלה יש טלפון או שם")
    if "grant select on table public.lead_escalations to service_role" not in esc:
        fail("אין קריאה ל-service_role")
    if "revoke all on table public.lead_escalations from public, anon, authenticated, service_role" not in esc:
        fail("הטבלה אינה סגורה לשאר התפקידים")
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
        setup += extract(ESC, "notification_business_elapsed(")
        table_at = esc.find("create table if not exists public.lead_escalations")
        table_to = esc.find("create or replace function public.lead_response_escalations")
        if table_at < 0 or table_to < table_at:
            fail("לא נחתכה הטבלה")
        setup += esc[table_at:table_to]
        setup += """
create function public.phone_tail9(p text) returns text language sql immutable as $$
  select case when length(regexp_replace(coalesce(p, ''), '\\D', '', 'g')) >= 9
              then right(regexp_replace(p, '\\D', '', 'g'), 9) end;
$$;
create table public.pricing_config (key text primary key, value int, description text);
insert into public.pricing_config (key, value) values ('notif_send_window_friday_enabled', 0);
create table public.agency_members (
  id uuid primary key, agency_id uuid, role text, active boolean default true,
  closed_at timestamptz, is_platform_admin boolean default false, display_name text
);
create table public.leads (
  id uuid primary key, agent_id uuid, agency_id uuid,
  first_response_at timestamptz, created_at timestamptz not null,
  source text, external_ref text, unlocked_by uuid, unlocked_at timestamptz
);
create table public.lead_archives (
  lead_id uuid primary key, agent_id uuid, archived_at timestamptz default now()
);
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid, type text, title text, body text,
  related_lead_id uuid, suppress_push boolean not null default false,
  created_at timestamptz default now()
);
create table public.saved_searches (
  id uuid primary key, source text, phone text, phone_e164 text, email text,
  created_at timestamptz not null, agency_id uuid, sold_to_agent_id uuid
);
create table public.social_leads (
  zernio_id text primary key, channel text, kind text, status text,
  payload jsonb, received_at timestamptz
);
create table public.scraped_leads (
  id uuid primary key default gen_random_uuid(),
  source text, external_ref text, status text, lead_type text,
  claimed_by uuid, claimed_at timestamptz
);
"""
        setup += extract(ESC, "lead_response_escalations(")
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

        hours = [
            ("חמישי 19:00 עד שישי 10:00 = 4", "2026-10-29 19:00:00+02", "2026-10-30 10:00:00+02", "4.00"),
            ("חמישי 19:00 עד שישי 09:00 = 3", "2026-10-29 19:00:00+02", "2026-10-30 09:00:00+02", "3.00"),
            ("שישי 12:00 עד ראשון 11:00 = 4", "2026-10-30 12:00:00+02", "2026-11-01 11:00:00+02", "4.00"),
            ("שבת אינה נספרת", "2026-10-31 08:00:00+02", "2026-10-31 20:00:00+02", "0.00"),
            ("שישי 12:00 עד שישי 13:00 = 1", "2026-10-30 12:00:00+02", "2026-10-30 13:00:00+02", "1.00"),
        ]
        for name, a, b, expect in hours:
            got = psql(
                "select to_char(public.notification_business_elapsed("
                f"timestamptz '{a}', timestamptz '{b}'), 'FM999990.00')"
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
        if psql("select count(*) from public.lead_escalations") != "0":
            fail("דגל 0 כתב lead_escalations")
        print("✓ דגל 0 אינו כותב")

        psql("update public.pricing_config set value = 1 where key = 'notif_send_window_friday_enabled'")
        n = psql(f"select public.lead_response_escalations(timestamptz '{fri_14}')")
        if n != "0" or psql("select count(*) from public.notifications") != "0":
            fail("שישי 14:00 כתב שורות")
        if psql("select count(*) from public.lead_escalations") != "0":
            fail("חלון סגור כתב lead_escalations")
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
        got_esc = psql(
            "select lead_id::text || ' ' || stage || ' ' || escalated_to_role "
            "|| ' ' || coalesce(resolution, '-') "
            "from public.lead_escalations order by 1"
        )
        wanted_esc = "\n".join([
            f"{lead3} reminder_2h agent -",
            f"{lead5} escalated_4h manager -",
            f"{lead5} reminder_2h agent -",
        ])
        if got_esc != wanted_esc:
            fail(f"lead_escalations:\n{got_esc}\n---\n{wanted_esc}")
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
        opened = psql(
            "select string_agg(stage || '=' || resolution, ',' order by stage) "
            f"from public.lead_escalations where lead_id = '{lead5}'"
        )
        if opened != "escalated_4h=opened,reminder_2h=opened":
            fail(f"resolution אחרי מענה: {opened}")
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

        cols = psql(
            "select string_agg(column_name, ',' order by ordinal_position) "
            "from information_schema.columns "
            "where table_schema = 'public' and table_name = 'lead_escalations'"
        )
        if cols != "lead_id,stage,escalated_at,escalated_to_role,resolved_at,resolution":
            fail(f"עמודות: {cols}")
        if psql(
            "select count(*) from information_schema.columns "
            "where table_schema = 'public' and table_name = 'lead_escalations' "
            "and column_name ~ '(phone|name|email)'"
        ) != "0":
            fail("יש עמודה מזהה")

        search_early = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2"
        search_claimed = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3"
        search_pulled = "cccccccc-cccc-4ccc-8ccc-ccccccccccc4"
        search_born = "cccccccc-cccc-4ccc-8ccc-ccccccccccc5"
        search_mail = "cccccccc-cccc-4ccc-8ccc-ccccccccccc6"
        search_weekend = "cccccccc-cccc-4ccc-8ccc-ccccccccccc7"
        pull_lead = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1"
        born_lead = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2"
        fri_09 = "2026-10-30 09:00:00+02"
        fri_12 = "2026-10-30 12:00:00+02"
        sat_12 = "2026-10-31 12:00:00+02"
        sun_08 = "2026-11-01 08:00:00+02"
        thu_19 = "2026-10-29 19:00:00+02"
        thu_10 = "2026-10-29 10:00:00+02"

        def buyer(sid, ref, at, phone="0501234567", email="", claimed="null",
                  kind="buyer", status="open_demand"):
            claimed_sql = "null" if claimed == "null" else f"'{claimed}'"
            claimed_at = "null" if claimed == "null" else f"timestamptz '{at}'"
            psql_script(f"""
insert into public.social_leads (zernio_id, channel, kind, status, payload, received_at)
values ('{ref}', 'facebook_dm', '{kind}', 'routed',
        jsonb_build_object('phone', '{phone}', 'email', '{email}'), timestamptz '{at}');
insert into public.saved_searches (id, source, phone, phone_e164, email, created_at)
values ('{sid}', 'facebook_dm', '{phone}', '{phone}', '{email}', timestamptz '{at}');
insert into public.scraped_leads (source, external_ref, status, lead_type, claimed_by, claimed_at)
values ('facebook_dm', '{ref}', '{status}', 'seeker_inbound', {claimed_sql}, {claimed_at});
""")

        buyer(search_early, "z-early", thu_19)
        n = psql(f"select public.lead_response_escalations(timestamptz '{fri_09}')")
        if psql(f"select count(*) from public.lead_escalations where lead_id = '{search_early}'") != "0":
            fail("3 שעות פתוחות כבר נכתבו")
        print("✓ ביקוש פתוח: 3 שעות פתוחות אינן מספיקות")

        n = psql(f"select public.lead_response_escalations(timestamptz '{fri_10}')")
        row = psql(
            "select stage || ' ' || escalated_to_role || ' ' || coalesce(resolution, '-') "
            f"from public.lead_escalations where lead_id = '{search_early}'"
        )
        if row != "escalated_4h unclaimed -":
            fail(f"4 שעות פתוחות: {row}")
        print("✓ ביקוש פתוח: 4 שעות פתוחות, unclaimed")

        buyer(search_claimed, "z-claimed", thu_19, phone="0502222222", claimed=agent)
        psql(f"select public.lead_response_escalations(timestamptz '{fri_10}')")
        if psql(f"select count(*) from public.lead_escalations where lead_id = '{search_claimed}'") != "0":
            fail("תפיסה לפני 4 שעות נכתבה כהסלמה")
        print("✓ תפיסה בתוך 4 השעות אינה הסלמה")

        buyer(search_pulled, "z-pulled", thu_19, phone="0503333333")
        psql_script(f"""
insert into public.leads (id, agent_id, agency_id, created_at, source, external_ref, unlocked_by, unlocked_at)
values ('{pull_lead}', '{agent}', '{agency}', timestamptz '{thu_19}',
        'facebook_dm', 'z-pulled', '{agent}', timestamptz '{thu_19}' + interval '1 hour');
""")
        psql(f"select public.lead_response_escalations(timestamptz '{fri_10}')")
        if psql(f"select count(*) from public.lead_escalations where lead_id = '{search_pulled}'") != "0":
            fail("משיכה בתוך 4 השעות נכתבה כהסלמה")
        print("✓ משיכה (claim_lead) בתוך 4 השעות אינה הסלמה")

        buyer(search_born, "z-born", thu_19, phone="0504444444")
        psql_script(f"""
insert into public.leads (id, agent_id, agency_id, created_at, source, external_ref, unlocked_by, unlocked_at)
values ('{born_lead}', '{agent}', '{agency}', timestamptz '{thu_19}',
        'facebook_dm', 'z-born', '{agent}', timestamptz '{thu_19}');
""")
        psql(f"select public.lead_response_escalations(timestamptz '{fri_10}')")
        born = psql(
            f"select escalated_to_role from public.lead_escalations where lead_id = '{search_born}'"
        )
        if born != "unclaimed":
            fail(f"ליד שנולד פתוח נחשב משיכה: {born}")
        print("✓ ליד שנולד פתוח אינו משיכה")

        buyer(search_mail, "z-mail", thu_19, phone="", email="dana@example.com")
        psql(f"select public.lead_response_escalations(timestamptz '{fri_10}')")
        if psql(f"select count(*) from public.lead_escalations where lead_id = '{search_mail}'") != "1":
            fail("התאמת מייל לא נכתבה")
        print("✓ התאמת מייל, בלי שם בטבלה")

        psql(f"update public.scraped_leads set claimed_by = '{agent}', claimed_at = timestamptz '{fri_12}' "
             "where external_ref = 'z-early'")
        psql(f"select public.lead_response_escalations(timestamptz '{fri_12}')")
        resolved = psql(
            "select resolution || ' ' || to_char(resolved_at at time zone 'Asia/Jerusalem', 'HH24:MI') "
            f"from public.lead_escalations where lead_id = '{search_early}'"
        )
        if resolved != "claimed 12:00":
            fail(f"אחרי תפיסה: {resolved}")
        print("✓ תפיסה אחרי ההסלמה נרשמת claimed")

        buyer(search_weekend, "z-weekend", thu_10, phone="0505555555")
        psql(f"select public.lead_response_escalations(timestamptz '{sat_12}')")
        if psql(f"select count(*) from public.lead_escalations where lead_id = '{search_weekend}'") != "0":
            fail("שבת כתבה הסלמה")
        print("✓ שבת אינה כותבת גם אחרי 4 שעות פתוחות")

        psql(f"select public.lead_response_escalations(timestamptz '{sun_08}')")
        if psql(
            f"select escalated_to_role from public.lead_escalations where lead_id = '{search_weekend}'"
        ) != "unclaimed":
            fail("ראשון 08:00 לא כתב את ההסלמה שחיכתה")
        print("✓ ראשון 08:00 כותב הסלמה שהבשילה בסוף השבוע")
        print("עבר")
        return 0
    finally:
        subprocess.run(["dropdb", "--if-exists", DB], check=False)


if __name__ == "__main__":
    sys.exit(main())
