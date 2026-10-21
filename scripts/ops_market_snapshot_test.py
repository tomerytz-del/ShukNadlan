#!/usr/bin/env python3
"""הבדיקה של הבדיקה: ‏`market_snapshot_error` ו-`market_snapshot_stale`.

אותו נימוק של `ops_market_gate_test.py`: ‏probe שאמור לשתוק כמעט תמיד הוא
בדיוק זה שבאג בו אינו מתגלה לעולם. פאנל השווקים מציג תמונה שמורה עם השעה
שלה (20270629090000), ולכן תמונה שנעצרה נראית בו תקינה.

    python3 scripts/ops_market_snapshot_test.py
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ops_agent.probes.behavior import _market_snapshots  # noqa: E402


class _Db:
    def __init__(self, rows, has=True):
        self._rows, self._has = rows, has

    def has_table(self, name):
        return self._has

    def rows(self, sql, params=None):
        return self._rows


class _Ctx:
    def __init__(self, rows, has=True):
        self.db = _Db(rows, has)
        self.root = ROOT
        self.checks = 0

    def count(self):
        self.checks += 1


failed = 0


def check(name, ok):
    global failed
    print(("✓ " if ok else "✗ ") + name)
    if not ok:
        failed += 1


def run(rows, has=True):
    return list(_market_snapshots(_Ctx(rows, has)))


def row(slug, age, failing=False, err=None):
    return {"market_slug": slug, "age_hours": age, "failing": failing, "last_error": err}


check("אין טבלה (המיגרציה טרם רצה) - שקט", run([row("haifa", 99)], has=False) == [])
check("אין שורות - שקט", run([]) == [])
check("כל השווקים טריים - שקט", run([row("afula-emek", 0.4), row("haifa", 1.2)]) == [])
check("סבב אחד באיחור (שעתיים) - שקט", run([row("haifa", 2.0)]) == [])

got = run([row("afula-emek", 0.3), row("haifa", 0.3, True, "canceling statement due to statement timeout")])
check("שוק שנכשל - ממצא שגיאה אחד", [f.code for f in got] == ["market_snapshot_error"])
check("השוק והשגיאה בפירוט", "haifa" in got[0].detail and "timeout" in got[0].detail)

got = run([row("afula-emek", 7.5), row("haifa", 0.5)])
check("הרענון נעצר - ממצא התיישנות לפי הוותיק", [f.code for f in got] == ["market_snapshot_stale"]
      and got[0].metric == 7.5)

got = run([row("haifa", None, True, "x")])
check("שוק שלא חושב מעולם ונכשל - שגיאה, בלי לקרוס על גיל ריק",
      [f.code for f in got] == ["market_snapshot_error"])

check("subject קבוע - הממצא נסגר כשהרענון חוזר",
      all(f.subject == "market_snapshots" for f in run([row("a", 9, True, "x")])))

print("\n" + ("✗ %d נכשלו" % failed if failed else "✓ market_snapshot מדווחת בדיוק מתי שצריך"))
sys.exit(1 if failed else 0)
