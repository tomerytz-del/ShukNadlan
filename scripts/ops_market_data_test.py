#!/usr/bin/env python3
"""הבדיקה של הבדיקה: הנתונים של כל שוק מקומי (`_market_data`).

אותו נימוק של `ops_market_gate_test.py`: ‏probe שתפקידו לשתוק רוב הזמן הוא
ה-probe שבאג בו אינו מתגלה לעולם. המספרים כאן הם המספרים האמיתיים של
26.9.2026 - קריית ביאליק עם 42 עסקאות מול כ-1,500 בשאר הקריות, חיפה עם
‏31% בלי פין, ו"משכנות אמנים" שלא הותאם - כדי שהבדיקה תוכיח שה-probe היה
תופס בדיוק את מה שנמצא ביד.

    python3 scripts/ops_market_data_test.py
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ops_agent.probes.behavior import _market_data  # noqa: E402


def city(market, name, deals, unpinned=0, hoods=0, no_boundary=0, days=45):
    return {"market_slug": market, "name": name, "hoods": hoods,
            "hoods_no_boundary": no_boundary, "deals": deals, "unpinned": unpinned,
            "last_sold": "2026-08-12", "last_sold_days": days if deals else None}


KRAYOT = [
    city("haifa-krayot", "חיפה", 1510, 468, hoods=77),
    city("haifa-krayot", "קריית אתא", 1512, 524, hoods=16),
    city("haifa-krayot", "קריית ים", 1512, 124, hoods=7),
    city("haifa-krayot", "קריית מוצקין", 1508, 0, hoods=4),
    city("haifa-krayot", "נשר", 1501, 195, hoods=9),
    city("haifa-krayot", "טירת כרמל", 1253, 8, hoods=19),
    city("haifa-krayot", "קריית ביאליק", 42, 0, hoods=12),
]
EMEK = [
    city("afula-emek", "עפולה", 1512, 224, hoods=14),
    city("afula-emek", "גדיש", 17, 0),          # יישוב בלי שכונות: לא "הדבקה חלקית"
    city("afula-emek", "היוגב", 0),
]
UNMATCHED = [
    {"market_slug": "haifa-krayot", "city": "נשר", "neighborhood": "אזור תעשיה", "n": 368},
    {"market_slug": "haifa-krayot", "city": "חיפה", "neighborhood": "גבעת דאונס", "n": 27},
]


class _Db:
    def __init__(self, cities, unmatched, has_col=True):
        self._c, self._u, self._has_col = cities, unmatched, has_col

    def has_table(self, name):
        return True

    def has_column(self, table, column):
        return self._has_col

    def rows(self, sql, params=None):
        if "market_data:cities" in sql:
            return self._c
        if "market_data:unmatched" in sql:
            return self._u
        return []


class _Ctx:
    def __init__(self, cities, unmatched=(), has_col=True):
        self.db = _Db(cities, list(unmatched), has_col)
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


def run(cities, unmatched=(), has_col=True):
    return list(_market_data(_Ctx(cities, unmatched, has_col)))


def of(fs, code):
    return [f for f in fs if f.code == code]


fs = run(KRAYOT + EMEK, UNMATCHED)

thin = of(fs, "market_city_deals_thin")
check("קריית ביאליק (42 מול ~1,500) - ממצא, ורק היא",
      len(thin) == 1 and thin[0].evidence["city"] == "קריית ביאליק")
check("גדיש (17 עסקאות, בלי שכונות) אינה 'הדבקה חלקית'",
      not any(f.evidence.get("city") == "גדיש" for f in thin))

unp = sorted(f.evidence["city"] for f in of(fs, "market_deals_unpinned"))
check("בלי פין: חיפה (31%) וקריית אתא (35%), לא נשר (13%) ולא קריית ים (8%)",
      unp == ["חיפה", "קריית אתא"])

check("עסקאות של 45 ימים - טריות, אין ממצא", not of(fs, "market_city_deals_stale"))
stale = of(run([city("afula-emek", "עפולה", 1512, hoods=14, days=200)]), "market_city_deals_stale")
check("עסקה אחרונה לפני 200 ימים - ממצא", len(stale) == 1 and stale[0].metric == 200)

check("כל השכונות עם גבול - אין ממצא", not of(fs, "market_hoods_no_boundary"))
nb = of(run([city("haifa-krayot", "חיפה", 1510, hoods=77, no_boundary=6),
             city("haifa-krayot", "טירת כרמל", 1253, hoods=19, no_boundary=2)]),
        "market_hoods_no_boundary")
check("שכונות בלי גבול - ממצא אחד לשוק, עם הפירוט לפי עיר",
      len(nb) == 1 and nb[0].metric == 8 and nb[0].evidence["by_city"] == {"חיפה": 6, "טירת כרמל": 2})

um = of(fs, "market_deal_hoods_unmatched")
check("שמות שכונה שלא הותאמו - ממצא לשוק, עם השמות",
      len(um) == 1 and um[0].metric == 395 and len(um[0].evidence["names"]) == 2)
check("לפני המיגרציה (אין neighborhood_ids) - אין ממצא ואין שגיאה",
      not of(run(KRAYOT, UNMATCHED, has_col=False), "market_deal_hoods_unmatched"))

check("כל ממצא נושא את השוק ב-subject וב-evidence",
      all(f.subject.startswith("market:") and f.evidence.get("market") for f in fs))
check("מפתחות יציבים ושונים (שם עברי אינו מתכנס למפתח אחד)",
      len({f.key for f in fs}) == len(fs))

print("\n✓ ‏_market_data מדווחת בדיוק מתי שצריך" if not failed else "\n✗ %d נכשלו" % failed)
sys.exit(1 if failed else 0)
