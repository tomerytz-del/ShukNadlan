#!/usr/bin/env python3
"""הבדיקה של הבדיקה: ‏`search_rules_drift`.

‏probe שאמור לשתוק כמעט תמיד הוא בדיוק זה שבאג בו אינו מתגלה לעולם. כאן
נבדק שהוא שותק כששתי פונקציות המסד מסכימות עם הדוגמאות, ומדווח - עם שם
הדוגמה ושם המנגנון - כשאחת מהן חלוקה. כך נראה הממצא על הפרודקשן ב-
21.10.2026, לפני 20270716090000. ‏docs/search-core.md.

    python3 scripts/ops_search_rules_test.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ops_agent.probes.behavior import _search_rules_drift  # noqa: E402

CASES = json.loads((ROOT / "scripts" / "search_feature_cases.json").read_text(encoding="utf-8"))["cases"]


class _Db:
    def __init__(self, rows, has=True):
        self._rows, self._has, self.params = rows, has, None

    def has_table(self, name):
        return self._has

    def rows(self, sql, params=None):
        self.params = params
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


def agree():
    return [{"name": c["name"], "expect": c["match"], "saved": c["match"], "client": c["match"]} for c in CASES]


check("שתי הפונקציות מסכימות - שקט", list(_search_rules_drift(_Ctx(agree()))) == [])
check("אין טבלאות - שקט", list(_search_rules_drift(_Ctx(agree(), has=False))) == [])

ctx = _Ctx(agree())
list(_search_rules_drift(ctx))
sent = json.loads(ctx.db.params[0]) if ctx.db.params else []
check("כל הדוגמאות נשלחות למסד", len(sent) == len(CASES))

# המצב בפרודקשן לפני המיגרציה: ההתראות לא מכירות מרפסת שמש וממ״ד מסחרי
drift = agree()
for r in drift:
    if r["name"] in ("מרפסת שמש היא מרפסת", "ממ״ד בנכס מסחרי - בעמודת המיקום"):
        r["saved"] = False
found = list(_search_rules_drift(_Ctx(drift)))
check("התראות חלוקות - ממצא אחד", len(found) == 1)
if found:
    f = found[0]
    check("קוד וחומרה", f.code == "search_rules_drift" and f.severity == "high")
    check("המטריקה היא מספר הדוגמאות", f.metric == 2)
    check("הפירוט אומר מה ואיפה", "מרפסת שמש היא מרפסת (התראות)" in f.detail)

client = agree()
client[0]["client"] = not client[0]["client"]
found = list(_search_rules_drift(_Ctx(client)))
check("קובץ הלקוחות חלוק - גם הוא מדווח", len(found) == 1 and "קובץ הלקוחות" in found[0].detail)

print("✓ הכול עבר" if not failed else "✗ %d נכשלו" % failed)
sys.exit(1 if failed else 0)
