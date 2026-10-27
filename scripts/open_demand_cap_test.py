#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""תקרת ביקוש פתוח: המיגרציה פעמיים על Postgres מקומי, ואז התרחישים."""

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/20271028220000_open_demand_notify_cap.sql"
SETUP = ROOT / "scripts/open_demand_cap_setup.sql"
ASSERT = ROOT / "scripts/open_demand_cap_assert.sql"

sql = MIGRATION.read_text(encoding="utf-8")
forbidden = [
    "function public.notification_push_claim",
    "function public.notification_push_burst_prepare",
    "function public.notification_push_due_agents",
    "function public.notify_agent_on_new_lead",
    "function public.notifications_apply_preferences",
    "agent_reminder_quiet_now",
    "function public.agent_works_city",
    "function public.agent_handles_type",
]
for name in forbidden:
    if name in sql:
        sys.exit(f"המיגרציה נוגעת ב-{name}")
for required in (
    "open_demand_notify_cap_enabled",
    "open_demand_notify_cap",
    "open_demand_pull_lookback_days",
    "no_pull",
    "recent_pull",
    "released_at is null",
    "not_found",
    "notification_type_enabled",
    "notifications_suppress_on",
    "notif_burst_scraped_stale_days",
    "nulls first",
    "random()",
    "unlocked_at > l.created_at + interval '1 second'",
    "claimed_by = m.id",
):
    if required not in sql:
        sys.exit(f"חסר במיגרציה: {required}")

# הדגל נולד 0 והתקרה 8.
if "('open_demand_notify_cap_enabled', 0," not in sql:
    sys.exit("הדגל לא נולד כבוי")
if "('open_demand_notify_cap', 8," not in sql:
    sys.exit("תקרת ברירת המחדל אינה 8")


def psql(db, *files):
    cmd = ["psql", "-v", "ON_ERROR_STOP=1", "-q", db]
    for path in files:
        cmd.extend(["-f", str(path)])
    subprocess.check_call(cmd, env={**os.environ, "PGOPTIONS": "-c client_min_messages=warning"})


def main():
    db = os.environ.get("ODCAP_DB", "odcap_test")
    subprocess.check_call(["dropdb", "--if-exists", db])
    subprocess.check_call(["createdb", db])
    psql(db, SETUP)
    psql(db, MIGRATION)
    psql(db, MIGRATION)
    psql(db, ASSERT)
    print("open demand cap: ok")


if __name__ == "__main__":
    main()
