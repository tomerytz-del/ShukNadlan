#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""יומן פניות היריד: המיגרציה פעמיים על Postgres מקומי, ואז התרחישים."""

import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/20271031210000_fair_inquiries.sql"
SETUP = ROOT / "scripts/fair_inquiries_setup.sql"
ASSERT = ROOT / "scripts/fair_inquiries_assert.sql"

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
    print("fair inquiries: ok")


if __name__ == "__main__":
    main()
