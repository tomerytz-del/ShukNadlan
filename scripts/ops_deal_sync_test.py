#!/usr/bin/env python3
"""הבדיקה של הבדיקה: מחזור העדכון של העסקאות (`_deal_sync_cycle`).

הסוכן שמושך עסקאות רץ בדפדפן ואין לו תזמון בשרת, ולכן הממצא הזה הוא
המקום היחיד שבו מחזור שנעצר נראה. ‏probe שתפקידו לשתוק רוב הזמן הוא
ה-probe שבאג בו אינו מתגלה לעולם - ולכן שלושת המצבים נבדקים כאן.

    python3 scripts/ops_deal_sync_test.py
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ops_agent.probes.behavior import _deal_sync_cycle  # noqa: E402


class _Db:
    def __init__(self, row, has=True):
        self._row, self._has = row, has
        self.sql = ""

    def has_table(self, name):
        return self._has

    def has_column(self, table, column):
        return self._has

    def rows(self, sql, params=None):
        self.sql = sql
        return [self._row] if "deal_sync:cycle" in sql else []


class _Ctx:
    def __init__(self, row, has=True):
        self.db = _Db(row, has)
        self.checks = 0

    def count(self):
        self.checks += 1


def row(overdue, last_ok_days, failing=0):
    return {"overdue": overdue, "failing": failing, "active": 243,
            "last_ok": None if last_ok_days is None else "2026-10-01",
            "last_ok_days": last_ok_days, "oldest": ["חדרה", "חריש"]}


failed = 0


def check(name, ok):
    global failed
    print(("✓ " if ok else "✗ ") + name)
    if not ok:
        failed += 1


def run(r, has=True):
    return list(_deal_sync_cycle(_Ctx(r, has)))


fs = run(row(214, None))
check("לא רץ מעולם, 214 ממתינים - deal_sync_stopped בינוני",
      len(fs) == 1 and fs[0].code == "deal_sync_stopped" and fs[0].severity == "medium"
      and fs[0].metric == 214 and "מעולם" in fs[0].title)

fs = run(row(40, 30))
check("לא רץ 30 ימים - deal_sync_stopped עם מספר הימים",
      len(fs) == 1 and fs[0].code == "deal_sync_stopped" and "30 ימים" in fs[0].title)

fs = run(row(6, 3, failing=4))
check("רץ לפני 3 ימים, 6 בפיגור (4 נכשלים) - deal_sync_overdue נמוך",
      len(fs) == 1 and fs[0].code == "deal_sync_overdue" and fs[0].severity == "low"
      and "4 מהם נכשלים" in fs[0].title)

check("אין פיגור - אין ממצא", not run(row(0, 2)))
check("אין פיגור גם כשלא רץ מעולם (הכול חדש) - אין ממצא", not run(row(0, None)))
check("לפני המיגרציה (אין last_attempt_at) - אין ממצא ואין שגיאה", not run(row(9, None), has=False))
check("נושא יציב אחד - הממצא נסגר כשהמחזור חוזר",
      {f.subject for f in run(row(214, None)) + run(row(6, 3))} == {"deals:sync"})

print("\n✓ ‏_deal_sync_cycle מדווחת בדיוק מתי שצריך" if not failed else "\n✗ %d נכשלו" % failed)
sys.exit(1 if failed else 0)
