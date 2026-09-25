#!/usr/bin/env python3
"""הבדיקה של הבדיקה: ‏`market_below_gate` / `market_ready` / `listings_no_market`.

אותו נימוק של `ops_stand_in_pin_test.py`: ‏probe שתפקידו לשתוק רוב הזמן
הוא ה-probe שבאג בו אינו מתגלה לעולם. אם התנאי הפוך, "חיפה עברה את הסף"
לא יגיע אף פעם, ואם הסף שגוי - שוק דל יישאר חי בלי שאיש יידע.

    python3 scripts/ops_market_gate_test.py
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ops_agent.probes.behavior import _market_gate  # noqa: E402


class _Db:
    def __init__(self, rows, loose):
        self._rows, self._loose = rows, loose

    def has_table(self, name):
        return True

    def rows(self, sql, params=None):
        return self._rows

    def one(self, sql, params=None):
        return {"n": self._loose}


class _Ctx:
    def __init__(self, rows, loose=0, root=ROOT):
        self.db = _Db(rows, loose)
        self.root = root
        self.checks = 0

    def count(self):
        self.checks += 1


failed = 0


def check(name, ok):
    global failed
    print(("✓ " if ok else "✗ ") + name)
    if not ok:
        failed += 1


import shutil, tempfile  # noqa: E402


def root_with(haifa_live: bool) -> Path:
    """‏עותק מינימלי של הריפו שבו חיפה חיה או לא - כדי שהבדיקה לא תיכשל ביום
    שחיפה באמת נדלקת (היא אינה בודקת את המצב היום, אלא את ההתנהגות)."""
    tmp = Path(tempfile.mkdtemp())
    (tmp / "assets").mkdir()
    (tmp / "scripts").mkdir()
    shutil.copy(ROOT / "scripts" / "check_markets.py", tmp / "scripts" / "check_markets.py")
    src = (ROOT / "assets" / "markets.js").read_text(encoding="utf-8")
    i = src.index("slug: 'haifa-krayot'")
    head, tail = src[:i], src[i:]
    tail = tail.replace("live: true", "live: false", 1) if not haifa_live else tail.replace("live: false", "live: true", 1)
    (tmp / "assets" / "markets.js").write_text(head + tail, encoding="utf-8")
    return tmp


CLOSED, OPEN = root_with(False), root_with(True)


def codes(rows, loose=0, root=CLOSED):
    return sorted((f.code, f.subject) for f in _market_gate(_Ctx(rows, loose, root)))


got = codes([{"market_slug": "haifa-krayot", "props": 4, "agencies": 1},
             {"market_slug": "afula-emek", "props": 85, "agencies": 10}])
check("חיפה סגורה ומתחת לסף - שקט", got == [])

got = codes([{"market_slug": "haifa-krayot", "props": 10, "agencies": 1}])
check("חיפה סגורה ובדיוק בסף - 'מוכן לפתיחה'", got == [("market_ready", "market:haifa-krayot")])

got = codes([{"market_slug": "haifa-krayot", "props": 30, "agencies": 0}])
check("30 נכסים בלי משרד - עדיין לא מוכן", got == [])

got = codes([{"market_slug": "afula-emek", "props": 0, "agencies": 0}])
check("שוק ברירת המחדל ריק - לא מדווח כ'מתחת לסף'", got == [])

got = codes([], loose=3)
check("3 נכסים בלי שוק - ממצא אחד", got == [("listings_no_market", "properties_no_market")])

got = sorted((f.code, f.severity) for f in _market_gate(_Ctx([{"market_slug": "haifa-krayot", "props": 3, "agencies": 1}], root=OPEN)))
check("חיפה חיה עם 3 נכסים - 'מתחת לסף', high", got == [("market_below_gate", "high")])

got = codes([{"market_slug": "haifa-krayot", "props": 40, "agencies": 3}], root=OPEN)
check("חיפה חיה ומעל הסף - שקט", got == [])

shutil.rmtree(CLOSED)
shutil.rmtree(OPEN)

print("\n✗ %d מקרים נכשלו" % failed if failed else "\n✓ בדיקת הסף של השווקים מתנהגת כמתוכנן.")
sys.exit(1 if failed else 0)
