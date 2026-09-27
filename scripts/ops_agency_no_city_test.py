#!/usr/bin/env python3
"""הבדיקה של הבדיקה: ‏`agency_no_city`.

אותו נימוק של `ops_market_gate_test.py`: ‏probe שאמור לשתוק כמעט תמיד הוא
בדיוק זה שבאג בו אינו מתגלה לעולם. חמישה משרדים מעפולה ישבו בלי עיר
שבועות, ואף מספר בדשבורד לא הראה את זה (20270115101000).

    python3 scripts/ops_agency_no_city_test.py
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ops_agent.probes.behavior import _agencies_no_city  # noqa: E402


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
    return list(_agencies_no_city(_Ctx(rows, has)))


check("כל המשרדים עם עיר - שקט", run([]) == [])
check("אין טבלת משרדים - שקט", run([{"name": "x"}], has=False) == [])

five = [{"name": n, "joined": "2026-09-17", "props": 0}
        for n in ["טריו נכסים", "פא\"י נכסים", "אביב נכסים", "קבוצת מצליח", "DESE GROUP"]]
got = run(five)
check("חמשת המשרדים של 27.9.2026 - ממצא אחד", len(got) == 1)
f = got[0]
check("הקוד והדרגה", f.code == "agency_no_city" and f.severity == "medium")
check("המספר בכותרת ובמדד", "5" in f.title and f.metric == 5)
check("השמות בפירוט", all(r["name"] in f.detail for r in five))
check("subject קבוע - הממצא נסגר כשהמשרדים מקבלים עיר",
      f.subject == "agencies_no_city" and run([]) == [])

many = [{"name": "משרד %d" % i, "joined": "2026-09-30", "props": i} for i in range(14)]
f = run(many)[0]
check("מעל עשרה - הפירוט נחתך, והמדד מלא", f.detail.endswith("…") and f.metric == 14)

print("\n" + ("✗ %d נכשלו" % failed if failed else "✓ agency_no_city מדווחת בדיוק מתי שצריך"))
sys.exit(1 if failed else 0)
