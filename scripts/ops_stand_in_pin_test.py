#!/usr/bin/env python3
"""הבדיקה של הבדיקה: ‏`listings_stand_in_pin` בסוכן התפעולי.

**למה דווקא ל-probe הזה יש בדיקה משלו, כשלרובן אין.** התפקיד שלו הוא
לשתוק — ייתכן מאוד שהוא ישתוק חודשים, עד שסנכרון ה-GIS ימצא את הרחוב.
‏probe שאמור לירות פעם בשנה הוא **ה-probe היחיד שבאג בו אינו מתגלה
לעולם**: אם התנאי הפוך, או אם המפתח מתנגש, או אם `_slug_ascii` מחזיר
את אותו ערך לכל רחוב — התוצאה נראית זהה לחלוטין ל"הכול בסדר".

שאר ה-probes יורים על נתונים אמיתיים בכל סריקה, ולכן שבירה בהם נראית.
זו אותה שורת נימוק של `check_gtm_container_test.py`: בדיקה שעוברת תמיד
אינה בדיקה.

    python3 scripts/ops_stand_in_pin_test.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ops_agent.config import STAND_IN_PINS          # noqa: E402
from ops_agent.probes.behavior import (             # noqa: E402
    _slug_ascii,
    _stand_in_pins,
)


class _Db:
    """מסד מדומה שמחזיר שורה אחת קבועה. ‏`_stand_in_pins` מריצה `one()`
    פעם אחת לכל שורה ב-`STAND_IN_PINS`, ולכן זה כל מה שנדרש."""

    def __init__(self, row: dict | None) -> None:
        self.row = row
        self.tables = True

    def has_table(self, name: str) -> bool:
        return self.tables

    def one(self, sql: str, params=None) -> dict | None:
        return self.row


class _Ctx:
    def __init__(self, row: dict | None, tables: bool = True) -> None:
        self.db = _Db(row)
        self.db.tables = tables
        self.checks = 0

    def count(self) -> None:
        self.checks += 1


# (תיאור, השורה שהמסד מחזיר, כמה ממצאים מצופים)
CASES = (
    ("הרחוב עדיין legacy - ההשאלה נחוצה, אין ממצא",
     {"src": "legacy", "is_active": False, "still_borrowed": 5}, 0),
    ("הרחוב נכנס כ-gis וההשאלה עדיין עומדת - ממצא",
     {"src": "gis", "is_active": True, "still_borrowed": 5}, 1),
    ("gis אבל active=false - הרחוב סונכרן וכובה, עוד אי אפשר לפתור",
     {"src": "gis", "is_active": False, "still_borrowed": 5}, 0),
    ("gis, ואף מודעה אינה נושאת עוד את הפין - ההשאלה נגמרה",
     {"src": "gis", "is_active": True, "still_borrowed": 0}, 0),
    ("הרחוב אינו במרשם כלל",
     {"src": None, "is_active": None, "still_borrowed": 5}, 0),
)


def main() -> int:
    bad = 0

    if not STAND_IN_PINS:
        # רשימה ריקה היא מצב תקין לגמרי (כל החובות נסגרו), והבדיקה
        # מדווחת עליו במפורש במקום לעבור בשקט על כלום.
        print("‏ℹ אין פינים זמניים מוצהרים. הבדיקה רצה על המקרים המסונתזים בלבד.")

    for name, row, want in CASES:
        ctx = _Ctx(row)
        got = list(_stand_in_pins(ctx))
        ok = len(got) == want and ctx.checks == len(STAND_IN_PINS)
        bad += not ok
        print("%s  %-56s ממצאים=%d צפוי=%d" %
              ("  ✓" if ok else "  ✗", name, len(got), want))
        if got and want:
            f = got[0]
            if f.severity != "medium" or not f.suggestion or "lat = null" not in f.suggestion:
                print("      ✗ הממצא אינו נושא את ההוראה להחזרה")
                bad += 1

    # ‏probe שאין לו טבלאות מדלג בשקט, ואינו קורס
    ctx = _Ctx({"src": "gis", "is_active": True, "still_borrowed": 5}, tables=False)
    if list(_stand_in_pins(ctx)):
        print("  ✗ הבדיקה דיווחה בלי שהטבלאות קיימות")
        bad += 1
    else:
        print("  ✓  אין טבלאות - דילוג שקט")

    # ‏`Finding.key` מנקה אותיות עבריות, ולכן שני רחובות היו מתכנסים
    # לאותו מפתח ודורסים זה את הממצא של זה ב-`ops_findings`.
    keys = {_slug_ascii(s) for s in ("היצירה", "המלאכה", "חרוד", "הרצל")}
    if len(keys) != 4:
        print("  ✗ ‏_slug_ascii מחזיר מפתח זהה לשני רחובות שונים")
        bad += 1
    else:
        print("  ✓  מפתח נפרד ויציב לכל רחוב")

    # כל שורה ב-`STAND_IN_PINS` חייבת להיות שלמה, אחרת ה-probe יקרוס
    # בהרצה אמיתית - ‏probe שנופלת אינה מפילה את הסריקה, אבל היא גם
    # אינה מדווחת, וזה בדיוק השקט שהבדיקה הזו קיימת בשבילו.
    for entry in STAND_IN_PINS:
        if len(entry) != 6:
            print("  ✗ שורה ב-STAND_IN_PINS אינה בת שישה שדות: %r" % (entry,))
            bad += 1
            continue
        city, street, lat, lng, src, migration = entry
        if not (city and street and src and migration):
            print("  ✗ שורה ב-STAND_IN_PINS עם שדה ריק: %r" % (entry,))
            bad += 1
        if not (isinstance(lat, float) and isinstance(lng, float)):
            print("  ✗ קואורדינטה שאינה float: %r" % (entry,))
            bad += 1
        if not (29.4 <= lat <= 33.4 and 34.2 <= lng <= 35.9):
            print("  ✗ קואורדינטה מחוץ לתיבת ישראל: %r" % (entry,))
            bad += 1
    if STAND_IN_PINS:
        print("  ✓  כל %d שורות STAND_IN_PINS שלמות ובתוך תיבת ישראל"
              % len(STAND_IN_PINS))

    if bad:
        print("\n✗ %d כשלים." % bad)
        return 1
    print("\n✓ ‏listings_stand_in_pin מדווחת בדיוק כשהרחוב נכנס למרשם, ולא לפני.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
