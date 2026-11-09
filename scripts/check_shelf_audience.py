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

# מדף → ביטוי שמזהה את שומר הקהל שלו. השומר חייב להיות מחובר ב-AND לתנאי ה-where
# ולא ב-OR, וחייב להופיע בהגדרה **האחרונה** של ה-view.
PROFESSIONAL_SHELVES = {
    # יועצי משכנתאות (agency_members.is_mortgage_advisor)
    "mortgage_leads_public": r"\bcurrent_is_mortgage_advisor\s*\(",
    # עורכי דין (agency_members.is_lawyer), ובנוסף רק בעיר שהם עובדים בה
    "lawyer_leads_public": r"\bcurrent_is_lawyer\s*\(",
    # יזמים רשומים ופעילים (developers)
    "project_leads_shelf": r"\bfrom\s+public\.developers\b",
}
# מדפים שמיועדים לכל סוכן/ת תיווך מחובר/ת (ולכן אין להם סינון קהל)
BROKER_SHELVES = {"rss_leads_public", "saved_search_leads_public"}

# שם של view שנראה כמו מדף לידים: *_leads_public, *_leads_shelf, *_shelf
SHELF_NAME = r"[a-z_]*(?:leads?_public|leads?_shelf|_shelf)[a-z_]*"
CREATE_VIEW = re.compile(
    rf'create\s+(?:or\s+replace\s+)?view\s+(?:public\.)?"?({SHELF_NAME})"?\b', re.IGNORECASE
)


def strip_sql(text: str) -> str:
    """בלי הערות (‎-- ו-/* */) ובלי תוכן של מחרוזות, כדי ש-; ושמות בתוכם לא ישפיעו."""
    out: list[str] = []
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if text.startswith("--", i):
            j = text.find("\n", i)
            i = n if j < 0 else j
        elif text.startswith("/*", i):
            j = text.find("*/", i + 2)
            i = n if j < 0 else j + 2
        elif c == "'":
            j = i + 1
            while j < n:
                if text[j] == "'":
                    if j + 1 < n and text[j + 1] == "'":
                        j += 2
                        continue
                    break
                j += 1
            out.append("''")
            i = j + 1
        else:
            out.append(c)
            i += 1
    return "".join(out)


def definitions() -> dict[str, tuple[str, str]]:
    """שם view -> (קובץ, גוף ההגדרה, עד ה-; שבסופה) של ההגדרה האחרונה."""
    last: dict[str, tuple[str, str]] = {}
    for path in sorted(MIGRATIONS.glob("*.sql")):
        text = strip_sql(path.read_text(encoding="utf-8"))
        for m in CREATE_VIEW.finditer(text):
            end = text.find(";", m.end())
            last[m.group(1).lower()] = (path.name, text[m.end(): end if end > 0 else len(text)])
    return last


def gated(body: str, gate: str) -> bool:
    """השומר מחובר ב-AND לתנאי ה-where: בשום רמת סוגריים אין OR בקבוצה שמכילה אותו."""
    low = body.lower()
    # ה-where של הרמה העליונה (עומק 0). ‏where בתוך exists/תת-שאילתה אינו התנאי של ה-view
    w, depth = -1, 0
    for m in re.finditer(r"[()]|\bwhere\b", low):
        tok = m.group()
        if tok == "(":
            depth += 1
        elif tok == ")":
            depth -= 1
        elif depth == 0:
            w = m.start() - 1
    if w < -1:
        w = -1
    if w < 0 and not re.search(r"\bwhere\b", low):
        return False
    w = w if w >= 0 else 0
    clause = low[w + 6:]
    m = re.search(gate, clause)
    if not m:
        return False
    # הקבוצות שמקיפות את המופע, מהפנימית לחיצונית, ואז רמת ה-where עצמה
    pos = m.start()
    depth_open: list[int] = []
    for i, ch in enumerate(clause[:pos]):
        if ch == "(":
            depth_open.append(i)
        elif ch == ")" and depth_open:
            depth_open.pop()

    def level_text(start: int, stop: int) -> str:
        """הטקסט של קבוצה בלי הקבוצות המקוננות בתוכה."""
        res, depth = [], 0
        for ch in clause[start:stop]:
            if ch == "(":
                depth += 1
                continue
            if ch == ")":
                depth -= 1
                continue
            if depth == 0:
                res.append(ch)
        return "".join(res)

    spans = []
    for o in depth_open:
        d = 0
        for j in range(o, len(clause)):
            if clause[j] == "(":
                d += 1
            elif clause[j] == ")":
                d -= 1
                if d == 0:
                    spans.append((o + 1, j))
                    break
        else:
            spans.append((o + 1, len(clause)))
    spans.append((0, len(clause)))
    return not any(re.search(r"\bor\b", level_text(a, b)) for a, b in spans)


def main() -> int:
    problems: list[str] = []
    defs = definitions()

    for view, gate in PROFESSIONAL_SHELVES.items():
        if view not in defs:
            problems.append(f"{view}: אין הגדרה במיגרציות")
            continue
        name, body = defs[view]
        if not gated(body, gate):
            problems.append(
                f"{view}: ההגדרה האחרונה ({name}) אינה מחברת את שומר הקהל ב-AND לתנאי ה-where "
                "(חסר, בהערה, או מחובר ב-OR) - כל סוכן/ת מחובר/ת יראה/תראה את המדף"
            )

    for view, (name, _) in defs.items():
        if view not in PROFESSIONAL_SHELVES and view not in BROKER_SHELVES:
            problems.append(
                f"{view} ({name}): מדף לידים חדש בלי החלטת קהל - להוסיף ל-"
                "PROFESSIONAL_SHELVES (עם שומר קהל) או ל-BROKER_SHELVES"
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
