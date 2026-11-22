#!/usr/bin/env python3
"""
בדיקת scripts/hood_polygons.py על נתונים מלאכותיים (בלי מסד, בלי רשת).

מה נבדק, והוא בדיוק מה שנכשל בשקט:
  - שם ש-95% מהפינים שלו בתוך מצולע קיים הוא כינוי, ולא מקבל מצולע
  - שכונה עם מעט פינים נדלגת, ולא מקבלת מצולע מנחש
  - שם שרוב הפינים שלו בתוך מצולעים קיימים נדלג (mostly_covered)
  - מצולע משוער אינו חופף מצולע קיים ואינו חופף משוער אחר (אומת על הטבעות
    שנכתבות), כי neighborhood_for_city_point מחזירה null לנקודה בשניים
  - verify() תופס חפיפה כשהיא קיימת (הבדיקה אינה מצליחה תמיד)
  - גרש בשם נכתב כגרשיים ב-SQL
  - הקלט מקובל גם כעטיפה של execute_sql

    python3 scripts/hood_polygons_test.py        # דורש shapely
"""
import json
import os
import random
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hood_polygons as hp  # noqa: E402

fail = 0


def ok(name, cond):
    global fail
    print(("✓ " if cond else "✗ ") + name)
    if not cond:
        fail += 1


rng = random.Random(7)
CITY = "עיר"


def square(lat0, lat1, lng0, lng1):
    return [[lat0, lng0], [lat0, lng1], [lat1, lng1], [lat1, lng0], [lat0, lng0]]


def pins(hood, n, lat0, lat1, lng0, lng1):
    return [dict(city=CITY, hood=hood, lat=rng.uniform(lat0, lat1), lng=rng.uniform(lng0, lng1)) for _ in range(n)]


A = square(32.430, 32.434, 34.920, 34.924)
B = square(32.430, 32.434, 34.9245, 34.9285)
polygons = [dict(city=CITY, name="א", boundary=A), dict(city=CITY, name="ב", boundary=B)]
all_pins = (
    pins("X", 30, 32.436, 32.440, 34.920, 34.924)
    + pins("Y", 30, 32.436, 32.440, 34.9245, 34.9285)       # צמודה ל-X
    + pins("ג'ונגל", 25, 32.425, 32.4285, 34.920, 34.924)   # גרש בשם, מתחת ל-א
    + pins("Alias", 20, 32.4305, 32.4335, 34.9205, 34.9235)  # כולה בתוך א
    + pins("Few", 3, 32.440, 32.441, 34.930, 34.931)
    + pins("Covered", 30, 32.4305, 32.4335, 34.9205, 34.9235)   # 75% בתוך א...
    + pins("Covered", 10, 32.425, 32.4285, 34.9205, 34.9235)    # ...ו-25% מחוץ לכל מצולע
)

res = hp.compute(all_pins, polygons)
names = {p["hood"] for p in res["polygons"]}
ok("שלוש שכונות קיבלו מצולע: X, Y, ג'ונגל", names == {"X", "Y", "ג'ונגל"})
ok("אין הפרות (חפיפה או נגיעה)", res["violations"] == [])
ok("Alias זוהתה ככינוי של א, ולא קיבלה מצולע",
   [(a["hood"], a["existing"]) for a in res["aliases"]] == [("Alias", "א")] and "Alias" not in names)
ok("Few נדלגה (3 פינים)", any(s["hood"] == "Few" and s["reason"] == "too_few" for s in res["skipped"]))
ok("Covered (75% בתוך מצולע קיים) נדלגה כ-mostly_covered ולא קיבלה מצולע",
   any(x["hood"] == "Covered" and x["reason"] == "mostly_covered" for x in res["skipped"]) and "Covered" not in names)
ok("כל מצולע תופס לפחות 80% מהפינים שלו",
   all(p["inside"] >= 0.8 * p["pins"] for p in res["polygons"]))
ok("יש מרחק חיובי מכל מצולע אחר", res["min_gap_m"] is not None and res["min_gap_m"] > 0)

# verify תופס חפיפה אמיתית
prj = hp.Proj(32.432, 34.922)
overlap = [dict(city=CITY, hood="חופף", ring=square(32.431, 32.433, 34.921, 34.923))]
ex = {CITY: [("א", hp.Polygon([prj.xy(a, b) for a, b in A]))]}
bad, _ = hp.verify(overlap, ex, prj)
ok("verify() תופס מצולע שחופף מצולע קיים", len(bad) == 1)

# SQL
sql = hp.migration_sql(res, include_aliases=True)
ok("הגרש בשם נכתב כגרשיים", "ג''ונגל" in sql and "'ג'ונגל'" not in sql)
ok("insert לשכונות, ו-where not exists", "insert into public.neighborhoods" in sql and "where not exists" in sql)
ok("כינויים נכנסים רק עם --include-aliases",
   "neighborhood_aliases" in sql and "neighborhood_aliases" not in hp.migration_sql(res, include_aliases=False))
ok("אזור תעשייה מסומן לפי השם", hp.INDUSTRIAL.search("אזור תעשייה צפוני") and not hp.INDUSTRIAL.search("מרכז העיר"))

# קלט: עטיפה של execute_sql
wrapped = {"result": "Below...\n<untrusted-data-abc>\n" + json.dumps(all_pins[:2]) + "\n</untrusted-data-abc>\nUse..."}
with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
    json.dump(wrapped, f)
rows = hp.load_rows(f.name)
os.unlink(f.name)
ok("load_rows קורא גם עטיפה של execute_sql", len(rows) == 2 and rows[0]["city"] == CITY)

print("\n✗ %d נכשלו" % fail if fail else "\n✓ המצולעים המשוערים מתנהגים כמתוכנן")
sys.exit(1 if fail else 0)
