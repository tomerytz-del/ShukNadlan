#!/usr/bin/env python3
"""הבדיקה של הבדיקה: ‏`area_names_unrecognized`.

שותק כשאין טבלה או אין שמות, מדווח עם השם, העיר וההצעה, ונסגר מעצמו
כשהדוח מתרוקן (‏PROBE_CODES). ‏docs/search-core.md, "הלולאה".

    python3 scripts/ops_area_names_test.py
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ops_agent.probes.behavior import _area_names_unrecognized  # noqa: E402


class _Db:
    def __init__(self, rows, has=True):
        self._rows, self._has, self.sql = rows, has, ""

    def has_table(self, name):
        return self._has

    def rows(self, sql, params=None):
        self.sql = sql
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


check("אין טבלה - שקט", list(_area_names_unrecognized(_Ctx([], has=False))) == [])
check("אין שמות - שקט", list(_area_names_unrecognized(_Ctx([]))) == [])

ctx = _Ctx([
    {"phrase": "יוקה פארק", "city": "עפולה", "searches": 3, "sessions": 2, "suggestion_name": "אזור התעשייה"},
    {"phrase": "נווה עמק", "city": None, "searches": 2, "sessions": 2, "suggestion_name": None},
])
found = list(_area_names_unrecognized(ctx))
check("ממצא אחד", len(found) == 1)
if found:
    f = found[0]
    check("קוד, חומרה ומטריקה", f.code == "area_names_unrecognized" and f.severity == "low" and f.metric == 2)
    check("הפירוט: שם, עיר והצעה", "יוקה פארק בעפולה (2 מבקרים - אולי אזור התעשייה)" in f.detail)
    check("בלי עיר ובלי הצעה", "נווה עמק (2 מבקרים)" in f.detail)
check("רק שמות של שני מבקרים ומעלה", "sessions >= 2" in ctx.db.sql)

print("✓ הכול עבר" if not failed else "✗ %d נכשלו" % failed)
sys.exit(1 if failed else 0)
