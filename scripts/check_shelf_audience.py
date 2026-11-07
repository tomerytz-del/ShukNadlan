#!/usr/bin/env python3
"""
מדפי הלידים ממוקדים למי שביקש - נבדק במיגרציות.

## הפער

מדף מקצועי (ייעוץ משכנתאות, ובהמשך עורכי דין) הוא view שנקרא מה-CRM. עד
7.11.2026 `mortgage_leads_public` נפתח ל-authenticated כולו וה-CRM הסתיר את
המגירה ב-JS: כל סוכן/ת תיווך מחובר/ת שקרא/ה ל-REST ישירות קיבל/ה את הלידים
של יועצי המשכנתאות. מסך שמסתיר מגירה אינו הרשאה, ושום בדיקה לא תפסה את זה.

## מה נבדק

1. לכל מדף מקצועי ברשימה `PROFESSIONAL_SHELVES` - **ההגדרה האחרונה** שלו
   במיגרציות (`create or replace view`) קוראת לפונקציית הקהל שלו. ההגדרה
   האחרונה ולא כל הגדרה, כי החלפה מאוחרת בלי הסינון מבטלת אותו בשקט.
2. view חדש ששמו `*_leads_public` ושאינו ב-`PROFESSIONAL_SHELVES` או
   ב-`BROKER_SHELVES` נחסם: מי שמוסיף מדף מחליט במפורש למי הוא מיועד.

`BROKER_SHELVES` הם המדפים של סוכני התיווך (`lead_audience_size` ב-
`docs/lead-routing.md`): פתוחים לכל סוכן/ת מחובר/ת בכוונה.

הרצה: python scripts/check_shelf_audience.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS = ROOT / "supabase" / "migrations"

# מדף → הפונקציה שהוא חייב לקרוא לה (הגדרת הקהל היחידה)
PROFESSIONAL_SHELVES = {
    "mortgage_leads_public": "current_is_mortgage_advisor",
}
# מדפים שמיועדים לכל סוכן/ת תיווך מחובר/ת (ולכן אין להם סינון קהל)
BROKER_SHELVES = {"rss_leads_public", "saved_search_leads_public"}

CREATE_VIEW = re.compile(
    r"create\s+(?:or\s+replace\s+)?view\s+public\.(\w+_leads_public)\s+as\b(.*?);",
    re.IGNORECASE | re.DOTALL,
)


def definitions() -> dict[str, tuple[str, str]]:
    """שם view → (קובץ, גוף) של ההגדרה האחרונה."""
    last: dict[str, tuple[str, str]] = {}
    for path in sorted(MIGRATIONS.glob("*.sql")):
        text = path.read_text(encoding="utf-8")
        for m in CREATE_VIEW.finditer(text):
            last[m.group(1)] = (path.name, m.group(2))
    return last


def main() -> int:
    problems: list[str] = []
    defs = definitions()

    for view, gate in PROFESSIONAL_SHELVES.items():
        if view not in defs:
            problems.append(f"{view}: אין הגדרה במיגרציות")
            continue
        name, body = defs[view]
        if gate not in body:
            problems.append(
                f"{view}: ההגדרה האחרונה ({name}) אינה קוראת ל-{gate}() - "
                "כל סוכן/ת מחובר/ת יראה/תראה את המדף"
            )

    for view, (name, _) in defs.items():
        if view not in PROFESSIONAL_SHELVES and view not in BROKER_SHELVES:
            problems.append(
                f"{view} ({name}): מדף לידים חדש בלי החלטת קהל - להוסיף ל-"
                "PROFESSIONAL_SHELVES (עם פונקציית קהל) או ל-BROKER_SHELVES"
            )

    if problems:
        print("✗ מדפי הלידים אינם ממוקדים:")
        for p in problems:
            print("  - " + p)
        print("\nהעיקרון: מדף לידים ממוקד למי שביקש. מסך שמסתיר מגירה אינו הרשאה.")
        return 1
    print(f"✓ {len(PROFESSIONAL_SHELVES)} מדפים מקצועיים סגורים לקהל שלהם, "
          f"{len(BROKER_SHELVES)} מדפי סוכנים מוצהרים.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
