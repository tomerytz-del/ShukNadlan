#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""יומן פניות היריד: המיגרציה פעמיים על Postgres מקומי, ואז התרחישים."""

import os
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/20271031220000_fair_inquiries.sql"
ALWAYS = ROOT / "supabase/migrations/20271031350000_fair_contact_always_on.sql"
CLICK = ROOT / "supabase/migrations/20271031360000_fair_contact_click.sql"
SETUP = ROOT / "scripts/fair_inquiries_setup.sql"
ASSERT = ROOT / "scripts/fair_inquiries_assert.sql"
ALWAYS_ASSERT = ROOT / "scripts/fair_contact_always_assert.sql"
CLICK_ASSERT = ROOT / "scripts/fair_contact_click_assert.sql"

sql = MIGRATION.read_text(encoding="utf-8")
collapsed = re.sub(r"\s+", " ", sql.lower())
# רק תוספות: אלה נשארים כמו שהם בפרודקשן
for name in (
    "function public.notify_agent_on_new_lead",
    "view public.leads_masked",
    "function public.data_retention_run(",
    "alter table public.leads",
    "drop table",
    "drop column",
):
    if name in collapsed:
        sys.exit(f"המיגרציה נוגעת ב-{name}")
if "('fair_contact_logging_enabled', 0," not in sql:
    sys.exit("הדגל לא נולד כבוי")
always = ALWAYS.read_text(encoding="utf-8")
if "delete from public.pricing_config" not in always or "fair_contact_logging_enabled" not in always:
    sys.exit("המיגרציה החדשה אינה מוחקת את הדגל")
if re.search(r"insert\s+into\s+public\.pricing_config[\s\S]*fair_contact_logging_enabled", always, re.I):
    sys.exit("המיגרציה החדשה מחזירה את הדגל")
click = CLICK.read_text(encoding="utf-8")
click_flat = re.sub(r"\s+", " ", click.lower())
if "fair_contact_logging_enabled" in click_flat:
    sys.exit("רישום הלחיצות מחזיר דגל")
if "cron.schedule" in click_flat or "insert into public.leads" in click_flat or "notifications" in click_flat:
    sys.exit("רישום הלחיצות נוגע ב-cron, בלידים או בהתראות")
if "revoke all on function public.fair_contact_click(uuid, text, text, text, text) from public, anon, authenticated" not in click_flat:
    sys.exit("הפונקציה אינה נסגרת ל-anon ול-authenticated")
if "grant execute on function public.fair_contact_click(uuid, text, text, text, text) to service_role" not in click_flat:
    sys.exit("הפונקציה אינה מוענקת ל-service_role")
if "pg_advisory_xact_lock(" in click_flat:
    sys.exit("מנעול חוסם: לחיצה לא ממתינה על מנעול")
if "pg_try_advisory_xact_lock" not in click_flat:
    sys.exit("אין מנעול בלי המתנה")


def psql(db, *files, sql=None):
    cmd = ["psql", "-v", "ON_ERROR_STOP=1", "-q", "-tA", db]
    if sql is not None:
        cmd.extend(["-c", sql])
    for path in files:
        cmd.extend(["-f", str(path)])
    out = subprocess.check_output(
        cmd, env={**os.environ, "PGOPTIONS": "-c client_min_messages=error"}, text=True
    )
    return out.strip()


def lock_held(db):
    """מנעול תפוס על הנכס: הלחיצה לא ממתינה ולא נרשמת."""
    prop = "c0000000-0000-0000-0000-000000000001"
    holder = subprocess.Popen(
        ["psql", "-v", "ON_ERROR_STOP=1", "-q", db, "-c",
         "select pg_catalog.pg_advisory_lock("
         "pg_catalog.hashtext('fair-contact-click'), "
         f"pg_catalog.hashtext('{prop}')); select pg_sleep(20);"],
        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    try:
        seen = "0"
        for _ in range(50):
            if holder.poll() is not None:
                err = holder.stderr.read() if holder.stderr else ""
                sys.exit(f"מחזיק המנעול נפל: {err}")
            seen = psql(db, sql=(
                "select count(*) from pg_catalog.pg_locks "
                "where locktype = 'advisory' and granted "
                "and classid = pg_catalog.hashtext('fair-contact-click')::oid "
                f"and objid = pg_catalog.hashtext('{prop}')::oid"))
            if seen != "0":
                break
            time.sleep(0.05)
        else:
            sys.exit("המנעול לא נתפס")
        skipped = psql(db, sql=f"""select public.fair_contact_click(
            '{prop}', 'whatsapp', 'property',
            repeat('4', 64), repeat('4', 32))->>'skipped'""")
        if skipped != "busy":
            sys.exit(f"לחיצה המתינה על המנעול או נרשמה: {skipped}")
    finally:
        holder.kill()
        try:
            holder.wait(timeout=2)
        except subprocess.TimeoutExpired:
            pass
        psql(db, sql=(
            "select pg_terminate_backend(pid) from pg_catalog.pg_stat_activity "
            "where datname = current_database() and pid <> pg_catalog.pg_backend_pid() "
            "and query like '%fair-contact-click%'"))
        for _ in range(50):
            left = psql(db, sql=(
                "select count(*) from pg_catalog.pg_locks "
                "where locktype = 'advisory' and granted "
                "and classid = pg_catalog.hashtext('fair-contact-click')::oid "
                f"and objid = pg_catalog.hashtext('{prop}')::oid"))
            if left == "0":
                break
            time.sleep(0.05)
        else:
            sys.exit("המנעול לא שוחרר")


def main():
    db = os.environ.get("FAIR_DB", "fair_inquiries_test")
    subprocess.check_call(["dropdb", "--if-exists", "--maintenance-db=postgres", db])
    subprocess.check_call(["createdb", "--maintenance-db=postgres", db])
    psql(db, SETUP)
    psql(db, MIGRATION)
    psql(db, ASSERT)
    # הרצה חוזרת: אין כפילות, ומה שכבר נרשם לא זז. הליד של תרחיש 6 (הרישום
    # נכשל בכוונה) נכנס עכשיו - זה בדיוק תפקיד המילוי לאחור.
    q = """select count(*), coalesce(sum(ref), 0) from public.fair_inquiries f
            where not exists (select 1 from public.leads le where le.id = f.lead_id and le.raw_name = 'שבור')"""
    before = psql(db, sql=q)
    psql(db, MIGRATION)
    after = psql(db, sql=q)
    if before != after:
        sys.exit(f"הרצה שנייה שינתה את היומן: {before} → {after}")
    healed = psql(db, sql="""select count(*) from public.fair_inquiries f join public.leads le on le.id = f.lead_id
                              where le.raw_name = 'שבור'""")
    if healed != "1":
        sys.exit(f"המילוי לאחור לא השלים את הליד שנכשל: {healed}")
    flags = psql(db, sql="select count(*) from public.pricing_config where key = 'fair_contact_logging_enabled'")
    if flags != "1":
        sys.exit("הדגל הוכפל")
    # הדגל יורד, השורה הישנה נמחקת, ויועץ/ת לא רואה פרטים. פעמיים.
    psql(db, ALWAYS)
    psql(db, ALWAYS_ASSERT)
    psql(db, ALWAYS)
    psql(db, ALWAYS_ASSERT)
    psql(db, CLICK)
    lock_held(db)
    psql(db, CLICK_ASSERT)
    clicks = psql(db, sql="select count(*) from public.fair_inquiries where channel in ('whatsapp_click', 'call_click')")
    psql(db, CLICK)
    again = psql(db, sql="select count(*) from public.fair_inquiries where channel in ('whatsapp_click', 'call_click')")
    if clicks != again:
        sys.exit(f"הרצה שנייה של רישום הלחיצות שינתה שורות: {clicks} → {again}")
    leads = psql(db, sql="""select count(*) from public.leads le
        where not exists (select 1 from public.fair_inquiries f where f.lead_id = le.id)
          and le.raw_name is null""")
    if leads != "0":
        sys.exit(f"לחיצה יצרה ליד בלי שם: {leads}")
    print("fair inquiries: ok")


if __name__ == "__main__":
    main()
