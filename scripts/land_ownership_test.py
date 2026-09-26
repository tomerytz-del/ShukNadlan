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

# datastore_search: דפדוף, ערך null, והצינור המלא עד reduce_rows
class FakeRes:
    def __init__(self, body): self._b = body
    def raise_for_status(self): pass
    def json(self): return self._b


class FakeSession:
    def __init__(self, pages): self.pages = pages; self.calls = []
    def get(self, url, timeout=None):
        self.calls.append(url)
        return FakeRes(self.pages[len(self.calls) - 1])


FIELDS = [{"id": h} for h in L.HEADER]
page1 = {"success": True, "result": {"total": 3, "fields": FIELDS, "_links": {"next": "/api/3/action/datastore_search?offset=2"},
         "records": [{"גוש": "16742", "חלקה": "96", "תת חלקה": "1", "תיאור שיטה": None, "סוג בעלות": "פרטית"},
                     {"גוש": "16742", "חלקה": "96", "תת חלקה": "2", "תיאור שיטה": "", "סוג בעלות": "מדינה"}]}}
page2 = {"success": True, "result": {"total": 3, "fields": FIELDS, "_links": {"next": "/api/3/action/datastore_search?offset=3"},
         "records": [{"גוש": "16697", "חלקה": "64", "תת חלקה": "0", "תיאור שיטה": "", "סוג בעלות": "מדינה"}]}}
sess = FakeSession([page1, page2])
p, s = L.reduce_rows(L.datastore_lines(sess))
check("datastore: שני עמודים, שלוש רשומות", s["read"] == 3 and len(sess.calls) == 2)
check("datastore: null בתיאור שיטה נחשב מוסדר", p[(16742, 96)] == ("S", True))
check("datastore: הדפדוף נעצר ב-total", p[(16697, 64)] == ("S", False))

bad = {"success": True, "result": {"total": 1, "fields": [{"id": "גוש"}], "records": [{}]}}
try:
    list(L.datastore_lines(FakeSession([bad])))
    check("datastore: עמודה חסרה זורקת", False)
except ValueError:
    check("datastore: עמודה חסרה זורקת", True)

check("User-Agent הוא זה של data.gov.il", L.USER_AGENT == "datagov-external-client")

sys.exit(1 if failures else 0)
