#!/usr/bin/env python3
"""בדיקות לחלק הטהור של parcels_open_loader.py - בלי רשת ובלי מסד.

    python3 scripts/parcels_open_test.py

הדוגמה האמיתית היא מהבדיקה של 22.10.2026 (‏parcels_probe.py): גוש 14368
חלקה 4 בדישון. נקודת הייחוס ב-ITM היא חלקת הייחוס של עפולה (16742/96),
שמרכזה הוא 32.6182, 35.2920 (docs/govmap.md, "פין לפי חלקה").
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import parcels_open_loader as L  # noqa: E402

fails = 0


def ok(name, cond):
    global fails
    print(("✓ " if cond else "✗ ") + name)
    if not cond:
        fails += 1


REC = {"GUSH_NUM": 14368, "GUSH_SUFFI": 0, "PARCEL": 4, "LEGAL_AREA": 113717.0, "STATUS_TEX": "מוסדר",
       "LOCALITY_I": 2063, "LOCALITY_N": "דישון", "REG_MUN_NA": "מבואות החרמון"}

# ריבוע 10x10 - מרכז (5,5)
c = L.ring_centroid([(0, 0), (10, 0), (10, 10), (0, 10), (0, 0)])
ok("מרכז ריבוע", abs(c[0] - 5) < 1e-9 and abs(c[1] - 5) < 1e-9)
ok("טבעת מנוונת - מרכז התיבה", L.ring_centroid([(1, 1), (1, 1), (1, 1)]) == (1, 1))

ident = lambda x, y: (35.29, 32.61)   # noqa: E731 - נקודה בתוך ישראל
row = L.to_row(REC, (1, 1), ident)
ok("שורה תקינה", row and row["gush"] == 14368 and row["helka"] == 4 and row["gush_suffix"] == 0
   and row["legal_area"] == 113717.0 and row["locality_name"] == "דישון" and row["lat"] == 32.61)
ok("גוש לא מספרי נדחה", L.to_row(dict(REC, GUSH_NUM="abc"), None, ident) is None)
ok("חלקה 0 נדחית", L.to_row(dict(REC, PARCEL=0), None, ident) is None)
ok("שטח 0 -> null, לא נדחה", L.to_row(dict(REC, LEGAL_AREA=0), None, ident)["legal_area"] is None)
far = lambda x, y: (40.0, 10.0)  # noqa: E731
ok("נקודה מחוץ לישראל -> בלי נקודה", L.to_row(REC, (1, 1), far)["lat"] is None)

ok("כתובת aws-e -> data.gov.il",
   L.direct_url("https://aws-e.data.gov.il/dataset/x/resource/y/download/parcel_all.zip")
   == "https://data.gov.il/dataset/x/resource/y/download/parcel_all.zip")
ok("כתובת data.gov.il נשארת", L.direct_url("https://data.gov.il/a.zip") == "https://data.gov.il/a.zip")

try:
    to_wgs = L.make_transform()
    lng, lat = to_wgs(227673.75, 724876.11)
    ok("ITM -> WGS84 בחלקת הייחוס של עפולה", abs(lat - 32.6182) < 0.001 and abs(lng - 35.2920) < 0.001)
except ImportError:
    print("· pyproj לא מותקן - דילוג על בדיקת ההמרה")

if fails:
    print(f"{fails} נכשלו")
    sys.exit(1)
