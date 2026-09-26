#!/usr/bin/env python3
"""בדיקות לחלק הטהור של land_ownership_loader.py - בלי רשת ובלי מסד.

רץ ב-land_ownership.yml לפני ההורדה: אם הצמצום שבור, כל מה שייטען ייטען שגוי.

    python3 scripts/land_ownership_test.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import land_ownership_loader as L  # noqa: E402

HEAD = '"גוש","חלקה","תת חלקה","תיאור שיטה","סוג בעלות",\n'


def run(body: str):
    return L.reduce_rows(iter((HEAD + body).splitlines(keepends=True)))


failures = []


def check(name, cond):
    print(("✓ " if cond else "✗ ") + name)
    if not cond:
        failures.append(name)


# תת-חלקות מתאחדות לחלקה, והסוג הנפוץ נבחר
p, s = run('"16742","96","1","","פרטית",\n"16742","96","2","","פרטית",\n"16742","96","3","","מדינה",\n')
check("שלוש תת-חלקות → חלקה אחת", len(p) == 1 and s["read"] == 3)
check("הסוג הנפוץ נבחר, ומסומן מעורב", p[(16742, 96)] == ("P", True))

# חלקה בסוג אחד אינה מעורבת
p, _ = run('"16697","64","0","","מדינה",\n')
check("סוג אחד → לא מעורב", p[(16697, 64)] == ("S", False))

# שוויון: הסוג שמחייב בדיקה, לא "פרטית"
p, _ = run('"1","2","1","","פרטית",\n"1","2","2","","מדינה",\n')
check("שוויון בין פרטית למדינה → מדינה", p[(1, 2)] == ("S", True))

# לא מוסדר: נספר ומדולג, ולא מתערבב בחלקה המוסדרת באותו מספר
p, s = run('"39578","44","0","","מדינה",\n"39578","44","0","גוש שומה","רשות מקומית",\n')
check("שורה לא מוסדרת מדולגת", p[(39578, 44)] == ("S", False) and s["skipped"] == 1)

# פגום: נדחה ונספר, לא מנוחש
_, s = run('"abc","1","0","","פרטית",\n"5","6","0","","משהו אחר",\n"7","8"\n')
check("שלוש שורות פגומות נדחו", s.get("rejected") == 3 and s.get("parcels") == 0)

# אפסים מובילים הם אותו מספר
p, _ = run('"016742","096","0","","פרטית",\n')
check("אפסים מובילים מנורמלים", (16742, 96) in p)

# כותרת שזזה היא כשל, לא ניחוש
try:
    L.reduce_rows(iter(['"חלקה","גוש","תת חלקה","תיאור שיטה","סוג בעלות",\n']))
    check("כותרת לא צפויה זורקת", False)
except ValueError:
    check("כותרת לא צפויה זורקת", True)

# סף איכות
check("קובץ ריק נדחה", L.check_quality({"read": 0}) is not None)
check("מעל 1% פגומות נדחה", L.check_quality({"read": 1000, "rejected": 11, "parcels": 10**6}) is not None)
check("קובץ חלקי נדחה", L.check_quality({"read": 10**6, "rejected": 0, "parcels": 500_000}) is not None)
check("קובץ תקין עובר", L.check_quality({"read": 2_870_000, "rejected": 0, "parcels": 1_130_000}) is None)

# השוואת תאריכי עדכון
check("אותו רגע, בפורמטים שונים", L.same_instant("2026-09-01T10:00:00", "2026-09-01T10:00:00+00:00"))
check("רגעים שונים", not L.same_instant("2026-09-01T10:00:00", "2026-10-01T10:00:00"))
check("חסר = לא אותו", not L.same_instant(None, "2026-09-01T10:00:00"))

sys.exit(1 if failures else 0)
