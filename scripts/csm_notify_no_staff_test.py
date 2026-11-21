#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""csm_notify_run: יציאה מוקדמת בלי צוות פעיל, ואותה התנהגות עם צוות פעיל.

המיגרציה 20271123190000 מוסיפה `if not exists (... csm_staff where active)`
בראש הפונקציה. הבדיקה מריצה את הגוף הישן (מ-20270816090000) ואת החדש על
אותם נתונים ומשווה: בלי צוות פעיל שניהם מחזירים 0 ואינם כותבים דבר, ועם
צוות פעיל שניהם כותבים אותן התראות בדיוק.
"""

import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OLD = ROOT / "supabase/migrations/20270816090000_csm_profile_agenda_notifications.sql"
NEW = ROOT / "supabase/migrations/20271123190000_csm_notify_run_no_staff_exit.sql"

new_sql = NEW.read_text(encoding="utf-8")
for required in (
    "if not exists (select 1 from public.csm_staff where active) then",
    "revoke all on function public.csm_notify_run() from public, anon, authenticated",
    "grant execute on function public.csm_notify_run() to service_role",
):
    if required not in new_sql:
        sys.exit(f"חסר במיגרציה: {required}")


def function_text(sql, name):
    start = sql.index(f"create or replace function public.{name}(")
    end = sql.index("$$;", start) + 3
    return sql[start:end]


old_sql = OLD.read_text(encoding="utf-8")
old_fn = function_text(old_sql, "csm_notify_run").replace(
    "public.csm_notify_run()", "public.csm_notify_run_old()", 1)
new_fn = function_text(new_sql, "csm_notify_run")

# השינוי היחיד הוא ה-if: בלי הבלוק שנוסף, הגוף החדש זהה לישן תו בתו.
added = re.search(
    r"  -- אין צוות פעיל.*?  end if;\n\n", new_fn, flags=re.S)
if not added:
    sys.exit("לא נמצא בלוק היציאה המוקדמת")
if new_fn.replace(added.group(0), "") != function_text(old_sql, "csm_notify_run"):
    sys.exit("הגוף החדש שונה מהישן מעבר ליציאה המוקדמת")

SETUP = r"""
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;

create table public.agencies (id uuid primary key default gen_random_uuid(), name text);
create table public.agency_members (
  id uuid primary key default gen_random_uuid(), agency_id uuid, display_name text,
  phone text, phone_e164 text, role text, active boolean not null default true,
  closed_at timestamptz, is_platform_admin boolean, created_at timestamptz not null default now());
create table public.csm_staff (
  id uuid primary key default gen_random_uuid(), active boolean not null default true,
  reminder_minutes int not null default 30, notify_off text[] not null default '{}',
  notify_whatsapp boolean not null default false, phone_e164 text,
  last_digest_on date, work_days smallint[] not null default '{0,1,2,3,4,5,6}',
  digest_time time not null default '00:00');
create table public.csm_agenda (
  id uuid primary key default gen_random_uuid(), staff_id uuid, agent_id uuid, title text,
  status text not null default 'scheduled', starts_at timestamptz, reminder_minutes int,
  reminded_at timestamptz, location text, meeting_url text, notes text);
create table public.csm_agent_stage (agent_id uuid primary key, stage text, next_followup_at timestamptz);
create table public.csm_notifications (
  id uuid primary key default gen_random_uuid(), staff_id uuid, kind text, title text, body text,
  agent_id uuid, call_id uuid, event_id uuid, dedupe_key text, wa_state text,
  unique (staff_id, dedupe_key));
create table public.whatsapp_messages (agent_id uuid, direction text, created_at timestamptz);
"""

SEED = r"""
insert into public.agencies (id, name) values ('00000000-0000-0000-0000-0000000000a1', 'משרד');
-- נרשמה היום (new_agent), וותיק שלא כתב לגבריאלה (at_risk / סיכום הבוקר)
insert into public.agency_members (id, agency_id, display_name, created_at) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'חדשה', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1', 'ותיק', now() - interval '5 days 1 hour');
insert into public.csm_staff (id, active) values ('00000000-0000-0000-0000-0000000000c1', :active);
insert into public.csm_agenda (staff_id, agent_id, title, starts_at) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 'פגישת הצלחה', now() + interval '10 minutes');
"""

SNAPSHOT = """
select coalesce(string_agg(kind || '|' || title || '|' || coalesce(body, '') || '|' || dedupe_key, E'\\n'
                           order by kind, dedupe_key), '')
       || E'\\nreminded=' || (select count(*) from public.csm_agenda where reminded_at is not null)
       || E'\\ndigest=' || (select count(*) from public.csm_staff where last_digest_on is not null)
  from public.csm_notifications
"""


def psql(db, sql_text, *variables):
    cmd = ["psql", "-v", "ON_ERROR_STOP=1", "-q", "-tA"]
    for v in variables:
        cmd += ["-v", v]
    cmd.append(db)
    return subprocess.check_output(
        cmd, input=sql_text, text=True,
        env={**os.environ, "PGOPTIONS": "-c client_min_messages=warning"},
    ).strip()


def run(db, fn):
    """מריץ פונקציה אחת בטרנזקציה שמתבטלת, ומחזיר (ערך, מה שנכתב)."""
    # now() קבוע בתוך טרנזקציה, אבל שתי ההרצות הן שתי טרנזקציות - אם דקה
    # מתחלפת ביניהן, חלק ב' (כל 5 דקות) עלול לרוץ רק באחת. לכן הדקה חוזרת
    # עם התוצאה, והמשווה מריץ שוב אם היא השתנתה.
    out = psql(db, f"""
begin;
select 'ret=' || public.{fn}() || ' min=' || extract(minute from now())::int;
{SNAPSHOT};
rollback;
""")
    head, _, snap = out.partition("\n")
    ret, minute = re.match(r"ret=(\d+) min=(\d+)", head).groups()
    return int(ret), minute, snap


def compare(db):
    for _ in range(3):
        old = run(db, "csm_notify_run_old")
        new = run(db, "csm_notify_run")
        if old[1] == new[1]:
            return old, new
    sys.exit("הדקה התחלפה שלוש פעמים בין ההרצות")


def main():
    base = os.environ.get("CSM_NOTIFY_DB", "csm_notify_no_staff_test")
    for active in ("false", "true"):
        db = f"{base}_{active}"
        subprocess.check_call(["dropdb", "--if-exists", "--maintenance-db=postgres", db])
        subprocess.check_call(["createdb", "--maintenance-db=postgres", db])
        try:
            psql(db, SETUP)
            psql(db, function_text(old_sql, "_csm_hhmm"))
            psql(db, function_text(old_sql, "_csm_notify"))
            psql(db, function_text(old_sql, "_csm_risk_agents"))
            psql(db, old_fn)
            psql(db, new_sql)
            psql(db, new_sql)  # אידמפוטנטית
            psql(db, SEED, f"active={active}")

            old, new = compare(db)
            if old != new:
                sys.exit(f"active={active}: הישנה {old} מול החדשה {new}")
            if active == "false":
                if new[0] != 0 or "reminded=0" not in new[2] or "meeting_reminder" in new[2]:
                    sys.exit(f"בלי צוות פעיל נכתב משהו: {new}")
            else:
                if new[0] < 1 or "meeting_reminder" not in new[2] or "reminded=1" not in new[2]:
                    sys.exit(f"עם צוות פעיל חסרה התראה: {new}")
            print(f"✓ active={active}: ישנה וחדשה זהות - {new[0]} התראות")
        finally:
            subprocess.call(["dropdb", "--if-exists", "--maintenance-db=postgres", db])


if __name__ == "__main__":
    main()
