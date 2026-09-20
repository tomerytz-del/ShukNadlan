#!/usr/bin/env python3
"""בדיקת הנרמול של מנוע העסקאות הרשמיות.

‏deals_engine/nadlan.py מדבר עם רשת ואי אפשר לבדוק אותו כאן. ‏normalize.py
דווקא כן: הוא פונקציות טהורות, והוא המקום שבו מוכרעת השאלה היחידה
שחשובה במנוע הזה — **האם רשומה פגומה נדחית או מנוחשת.**

עסקה שנכנסת למאגר נושאת `price_basis='official'`, כלומר היא המספר שדוח
ה-CMA סומך עליו יותר מכל אחר. מחיר שנקרא מהשדה הלא נכון, או תאריך
שנוחש, מזהמים בדיוק את המספר הזה. לכן הבדיקה כאן מתעקשת על הדחייה ולא
רק על המסלול התקין.

רצה ב-CI על כל שינוי ב-deals_engine/, וגם ידנית:

    python3 scripts/check_deals_normalize.py
"""

from __future__ import annotations

import datetime
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from deals_engine.nadlan import missing_fields                      # noqa: E402
from deals_engine.normalize import (                                # noqa: E402
    SkipRecord, build_external_key, normalize, split_address,
)

TODAY = datetime.date.today()
NOT_BEFORE = TODAY - datetime.timedelta(days=900)

# רשומה שלמה בשמות השדות הראשיים של המקור.
GOOD = {
    "KEYVALUE": "abc-123", "DEALAMOUNT": "1,350,000", "DEALDATE": "14/08/2026",
    "FULLADRESS": "הרצל 12, עפולה", "DEALNATUREDESCRIPTION": "דירה בבית קומות",
    "DEALNATURE": "92", "ASSETROOMNUM": "4", "FLOORNO": "קומה 3",
    "BUILDINGYEAR": "1998", "GUSH": "16720", "HELKA": "41",
}

failures: list[str] = []
passed = 0


def check(name: str, condition: bool, detail: object = "") -> None:
    global passed
    if condition:
        passed += 1
    else:
        failures.append(f"{name}   {detail}")


def must_skip(name: str, record: dict) -> None:
    try:
        normalize("עפולה", record, not_before=NOT_BEFORE)
        check(name, False, "התקבל במקום להידחות")
    except SkipRecord:
        check(name, True)


# --------------------------------------------------------------- פיצול כתובת
# בלי פיצול נכון אין גיאוקוד, ובלי קואורדינטות העסקה נעדרת מחישוב הרדיוס.
for raw, want in {
    "הרצל 12, עפולה":         ("הרצל", "12"),
    "שדרות ירושלים 5, עפולה":  ("שדרות ירושלים", "5"),
    "הרב קוק 770, עפולה":      ("הרב קוק", "770"),   # ספרה בשם הרחוב
    "ויצמן 3א, עפולה":         ("ויצמן", "3א"),
    "עפולה":                   ("", ""),
    "":                        ("", ""),
}.items():
    got = split_address(raw)
    check(f"פיצול {raw!r}", got == want, f"התקבל {got}, ציפינו {want}")

# ------------------------------------------------------------- המסלול התקין
row = normalize("עפולה", GOOD, not_before=NOT_BEFORE)
check("מחיר מנוקה מפסיקים", row["sale_price"] == 1350000.0, row["sale_price"])
check("תאריך ל-ISO", row["sold_at"] == "2026-08-14", row["sold_at"])
check("סוג נכס ממופה", row["property_type"] == "דירה", row["property_type"])
check("שטח", row["size_sqm"] == 92.0, row["size_sqm"])
check("רחוב ומספר לגיאוקוד",
      (row["street"], row["house_number"]) == ("הרצל", "12"),
      (row["street"], row["house_number"]))
check("שנת בנייה", row["year_built"] == 1998, row["year_built"])
check("מפתח מהמקור", row["external_key"] == "nadlan:עפולה:abc-123", row["external_key"])
check("price_basis נגזר במסד ולא כאן", "price_basis" not in row, row.keys())
check("raw נשמר לתיקון מיפוי בדיעבד", row["raw"] is GOOD)

# ------------------------------------------------- מה שחייב להידחות ולא לנחש
must_skip("בלי מחיר",      {**GOOD, "DEALAMOUNT": ""})
must_skip("מחיר לא מספרי", {**GOOD, "DEALAMOUNT": "לא ידוע"})
must_skip("מחיר אפס",      {**GOOD, "DEALAMOUNT": "0"})
must_skip("בלי תאריך",     {**GOOD, "DEALDATE": ""})
must_skip("תאריך לא מוכר", {**GOOD, "DEALDATE": "בקרוב"})
must_skip("תאריך עתידי",   {**GOOD, "DEALDATE": f"01/01/{TODAY.year + 2}"})
must_skip("מחוץ לחלון",    {**GOOD, "DEALDATE": "01/01/2015"})

# שטח 0 במקור פירושו "לא דווח". כמספר הוא היה מחיר-למ״ר של אינסוף.
zero = normalize("עפולה", {**GOOD, "DEALNATURE": "0"}, not_before=NOT_BEFORE)
check("שטח 0 -> None", zero["size_sqm"] is None, zero["size_sqm"])

# ------------------------------------------------------- שמות שדה חלופיים
alt = normalize("עפולה", {
    "DEALID": "x9", "PRICE": 990000, "DEALDATESTR": "2026-07-01",
    "ADDRESS": "ויצמן 3, עפולה", "ASSETTYPE": "מגרש",
}, not_before=NOT_BEFORE)
check("נקרא דרך שם שדה חלופי",
      alt["sale_price"] == 990000.0 and alt["property_type"] == "מגרש",
      (alt["sale_price"], alt["property_type"]))

# ------------------------------------------------------------ מפתח נגזר
no_key = {k: v for k, v in GOOD.items() if k != "KEYVALUE"}
k1 = build_external_key("עפולה", no_key)
k2 = build_external_key("עפולה", dict(no_key))
check("מפתח נגזר דטרמיניסטי", k1 == k2, (k1, k2))
check("מפתח אינו חושף כתובת", "הרצל" not in k1, k1)

# ------------------------------------------------------------ דיווח חוסרים
check("missing_fields מזהה חוסר",
      set(missing_fields({"PRICE": 1})) >= {"deal_id", "date", "address"},
      missing_fields({"PRICE": 1}))

# ------------------------------------------------------------------- סיכום
if failures:
    print(f"✗ {len(failures)} בדיקות נכשלו ב-deals_engine/normalize.py:\n")
    for line in failures:
        print(f"   {line}")
    print("\nרשומה שנכנסת למאגר מסומנת price_basis='official' — כלומר היא")
    print("המספר שדוח ה-CMA סומך עליו יותר מכל אחר. אין לרכך את הבדיקות")
    print("האלה; אם המקור השתנה, מתקנים את FIELDS ב-deals_engine/nadlan.py.")
    sys.exit(1)

print(f"✓ כל {passed} הבדיקות של נרמול העסקאות הרשמיות עוברות.")
