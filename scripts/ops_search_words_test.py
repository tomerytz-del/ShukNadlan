#!/usr/bin/env python3
"""הבדיקה של הבדיקה: ‏`search_words_unrecognized`.

שותק כשאין טבלה או אין מילים, מדווח עם סוג המילה ומספר האנשים, ונסגר
מעצמו כשהדוח מתרוקן (‏PROBE_CODES, נבדק ב-ops_probe_codes_test.py). ‏docs/search-core.md, "גבריאלה לומדת
מהחיפושים".

    python3 scripts/ops_search_words_test.py
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ops_agent.probes.behavior import _search_words_unrecognized  # noqa: E402


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


check("אין טבלה - שקט", list(_search_words_unrecognized(_Ctx([], has=False))) == [])
check("אין מילים - שקט", list(_search_words_unrecognized(_Ctx([]))) == [])

ctx = _Ctx([
    {"kind": "feature", "phrase": "גינה", "searches": 4, "people": 3},
    {"kind": "type", "phrase": "יורט", "searches": 2, "people": 2},
])
found = list(_search_words_unrecognized(ctx))
check("ממצא אחד", len(found) == 1)
if found:
    f = found[0]
    check("קוד, חומרה ומטריקה", f.code == "search_words_unrecognized" and f.severity == "low" and f.metric == 2)
    check("הפירוט: סוג, מילה ואנשים", 'מאפיין "גינה" (3 אנשים)' in f.detail and 'סוג נכס "יורט" (2 אנשים)' in f.detail)
    check("ההצעה מפנה לליבה", "assets/search-core.js" in f.suggestion)
check("רק מילים של שני אנשים ומעלה", "people >= 2" in ctx.db.sql)

print("✓ הכול עבר" if not failed else "✗ %d נכשלו" % failed)
sys.exit(1 if failed else 0)
