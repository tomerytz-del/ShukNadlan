#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""פיזור תזמוני ה-cron: אותה תדירות, שיא נמוך יותר, ומיגרציה שנוגעת רק במה שצריך.

    python3 scripts/cron_stagger_test.py

שני חלקים:
1. סימולציה - על תמונת התזמונים הפעילים בפרודקשן (19.11.2026) סופרים כמה
   jobs מתחילים בכל דקה של השעה, לפני המיגרציה ואחריה.
2. Postgres מקומי - סכימת cron מדומה (טבלה ו-alter_job), המיגרציה רצה
   פעמיים, ו-job שהתזמון שלו אינו הישן נשאר כמו שהוא. בלי שרת מקומי החלק
   הזה מדולג בהודעה, והסימולציה עדיין רצה.
"""

import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIG = ROOT / "supabase/migrations/20271120120000_cron_stagger_schedules.sql"
DB = os.environ.get("CRON_STAGGER_DB", "cron_stagger_test")

# שדה הדקות של כל job פעיל שרץ לפחות פעם בשעה (cron.job, 19.11.2026).
# jobs יומיים ושבועיים אינם כאן: הם רצים בלילה, בדקות שאינן עגולות.
HOURLY = {
    "agent-agenda-dispatch": "*", "google-calendar-sync": "*",
    "meeting-client-dispatch": "*", "showing-coord": "*",
    "showing-coord-briefs": "*", "client-match-digest": "*",
    "csm-notify": "*", "csm-gcal-sync": "*", "share-digest": "*",
    "property-offers": "*/10", "csm-mentor-tips": "*/10",
    "scraped-lead-matching-rest": "*/10", "building-developer-ask": "*/10",
    "expire-promotions": "*/15", "admin-inbox-overdue": "*/15",
    "lead-response-escalations": "*/15",
    "saved-search-notify": "*/2", "email-intake": "*/2",
    "visualization-backfill-drain": "*/5", "notification-push": "*/5",
    "property-marketing-publish": "*/5", "geocode-backfill": "*/5",
    "showcase-wa": "*/5", "missed-call-sla-alerts": "*/5",
    "ai-cache-warm": "*/5", "property-video-reconcile": "*/5",
    "wallet-topup-reconcile": "*/5",
    "open-house-notify": "11-59/15", "agent-reminders": "15",
    "saved-search-expire-alerts": "17", "planning-backfill": "17",
    "billing-renew": "17", "deal-sync-close-stale": "17",
    "market-snapshots-refresh": "17", "property-description": "2-59/5",
    "ads-leads-sync": "20", "neighborhood-deal-stats": "22",
    "neighborhood-pages-refresh": "23", "scraped-leads-lifecycle": "29",
    "property-publications-expire": "41", "platform-budget-notify": "41",
    "deal-city-stats-refresh": "41", "city-price-table-refresh": "44",
    "property-descriptions-expire": "47", "agent-agenda-auto": "7",
    "expire-open-house": "7-59/15",
}

PEAK_BEFORE = 27
PEAK_MAX_AFTER = 17
# נשארים על הדקה העגולה בכוונה - הנימוק בראש המיגרציה.
STAY = {"notification-push", "missed-call-sla-alerts", "expire-promotions"}

fails = []


def check(ok, msg):
    print(("  ✓ " if ok else "  ✗ ") + msg)
    if not ok:
        fails.append(msg)


def minutes(field):
    """שדה הדקות של cron -> קבוצת הדקות בשעה."""
    out = set()
    for part in field.split(","):
        step = 1
        if "/" in part:
            part, s = part.split("/")
            step = int(s)
        if part == "*":
            lo, hi = 0, 59
        elif "-" in part:
            lo, hi = (int(x) for x in part.split("-"))
        else:
            lo = hi = int(part)
        out.update(range(lo, hi + 1, step))
    return out


def peak(jobs):
    load = [0] * 60
    for field in jobs.values():
        for m in minutes(field):
            load[m] += 1
    return max(load), load


def mapping():
    rows = re.findall(
        r"\('([a-z0-9-]+)',\s*'([^']+)',\s*'([^']+)'\)", MIG.read_text(encoding="utf-8"))
    return {name: (old, new) for name, old, new in rows}


def simulate(mp):
    print("סימולציה")
    before, _ = peak(HOURLY)
    check(before == PEAK_BEFORE, "לפני: שיא של %d jobs בדקה (נמדד %d)" % (PEAK_BEFORE, before))
    after_jobs = dict(HOURLY)
    for name, (old, new) in mp.items():
        o, n = old.split()[0], new.split()[0]
        check(name in HOURLY and HOURLY[name] == o,
              "%s: התזמון הישן במיגרציה הוא מה שבפרודקשן (%s)" % (name, o))
        check(old.split()[1:] == new.split()[1:] == ["*"] * 4,
              "%s: רק שדה הדקות משתנה" % name)
        mo, mn = sorted(minutes(o)), sorted(minutes(n))
        shift = mn[0] - mo[0]
        check(len(mo) == len(mn) and [m + shift for m in mo] == mn,
              "%s: אותה תדירות, בהיסט של %d דקות" % (name, shift))
        after_jobs[name] = n
    check(not (STAY & set(mp)), "שלושת ה-jobs של הדקה העגולה אינם במיגרציה")
    after, load = peak(after_jobs)
    check(after <= PEAK_MAX_AFTER,
          "אחרי: שיא של %d jobs בדקה (תקרה %d)" % (after, PEAK_MAX_AFTER))
    print("    עומס לדקה אחרי: min=%d max=%d" % (min(load), max(load)))


def psql(sql=None, file=None, db=DB):
    cmd = ["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-d", db]
    cmd += ["-f", str(file)] if file else ["-c", sql]
    return subprocess.check_output(cmd, stderr=subprocess.STDOUT, text=True).strip()


STUB = """
create schema cron;
create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
create function cron.alter_job(job_id bigint, schedule text default null) returns void
language sql as $$ update cron.job set schedule = $2 where jobid = $1 $$;
"""


def database(mp):
    print("Postgres מקומי")
    try:
        subprocess.run(["dropdb", "--if-exists", DB], check=True, capture_output=True)
        subprocess.run(["createdb", DB], check=True, capture_output=True)
    except (OSError, subprocess.CalledProcessError) as err:
        if os.environ.get("CI"):
            check(False, "אין Postgres מקומי ב-CI: %s" % err)
        else:
            print("  - אין Postgres מקומי, החלק הזה מדולג")
        return
    try:
        # בלי סכימת cron: המיגרציה יוצאת בלי שגיאה (כך היא רצה ב-CI של המיגרציות).
        psql(file=MIG)
        check(True, "בלי cron.job המיגרציה עוברת ואינה עושה דבר")

        psql(STUB)
        for name, field in HOURLY.items():
            psql("insert into cron.job (jobname, schedule, command) values ('%s', '%s * * * *', 'select 1 -- %s')"
                 % (name, field, name))
        # job שמישהו כבר שינה ביד, ו-job שנמחק: שניהם לא אמורים להפיל או להשתנות.
        psql("update cron.job set schedule = '*/3 * * * *' where jobname = 'geocode-backfill'")
        psql("delete from cron.job where jobname = 'csm-mentor-tips'")

        for run in (1, 2):
            psql(file=MIG)
            got = dict(line.split("|") for line in
                       psql("select jobname, schedule from cron.job").splitlines())
            bad = []
            for name, field in HOURLY.items():
                if name == "csm-mentor-tips":
                    continue
                want = field + " * * * *"
                if name == "geocode-backfill":
                    want = "*/3 * * * *"
                elif name in mp:
                    want = mp[name][1]
                if got.get(name) != want:
                    bad.append("%s: %s במקום %s" % (name, got.get(name), want))
            check(not bad, "הרצה %d: כל תזמון הוא מה שציפינו%s"
                  % (run, "" if not bad else " - " + "; ".join(bad)))
        cmds = psql("select count(*) from cron.job where command <> 'select 1 -- ' || jobname")
        check(cmds == "0", "אף פקודה של job לא השתנתה")
    finally:
        subprocess.run(["dropdb", "--if-exists", DB], capture_output=True)


def main():
    mp = mapping()
    check(len(mp) == 13, "המיגרציה מפזרת 13 jobs (נמצאו %d)" % len(mp))
    simulate(mp)
    database(mp)
    if fails:
        print("\n%d בדיקות נכשלו" % len(fails))
        return 1
    print("\nהכול עבר")
    return 0


if __name__ == "__main__":
    sys.exit(main())
