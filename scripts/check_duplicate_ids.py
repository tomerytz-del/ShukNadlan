#!/usr/bin/env python3
"""אין שני אלמנטים עם אותו id באותו דף.

‏`getElementById` מחזיר את **הראשון** בסדר המסמך, בלי שגיאה ובלי אזהרה.
כך ב-crm.html: קונסולת השיווק (‏PR ‎#624) הוסיפה `<div id="leadsList">`
לפאנל "לידים ממטא", שיושב בדף **לפני** "הלידים שלי". מאותו רגע הלידים של
כל סוכן/ת נצבעו לתוך הפאנל המוסתר של מנהל/ת הפלטפורמה: המונה והסיכום
בכותרת ("22 לידים · 22 נפתחו") והמתג פעילים/ארכיון הופיעו, והרשימה עצמה
נשארה ריקה - שלושה ימים, בלי שורה אחת בקונסול.

הבדיקה קוראת את ה-HTML הסטטי בלבד: הערות ו-`<script>` מוטבעים יוצאים
לפני הספירה, כי id שנבנה ב-JS נוצר בזמן ריצה ואינו כפילות בקובץ.

    python scripts/check_duplicate_ids.py
"""
from __future__ import annotations

import collections
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

COMMENT = re.compile(r"<!--.*?-->", re.S)
SCRIPT = re.compile(r"<script\b[^>]*>.*?</script>", re.S | re.I)
ID_ATTR = re.compile(r"""\sid\s*=\s*(["'])([^"']+)\1""")


def duplicates(text: str) -> dict[str, list[int]]:
    """id → מספרי השורות שבהן הוא מופיע, רק למה שמופיע יותר מפעם אחת."""
    # מחליפים בתווי שורה כדי לשמור על מספרי השורות המקוריים
    def blank(m: re.Match) -> str:
        return "\n" * m.group(0).count("\n")

    text = SCRIPT.sub(blank, COMMENT.sub(blank, text))
    seen: dict[str, list[int]] = collections.defaultdict(list)
    for m in ID_ATTR.finditer(text):
        value = m.group(2)
        if "${" in value or "{{" in value:
            continue
        seen[value].append(text.count("\n", 0, m.start()) + 1)
    return {k: v for k, v in seen.items() if len(v) > 1}


def main() -> int:
    failed = False
    pages = sorted(ROOT.glob("*.html"))
    for page in pages:
        dups = duplicates(page.read_text(encoding="utf-8"))
        for value, lines in sorted(dups.items()):
            failed = True
            where = ", ".join(str(n) for n in lines)
            print(f"✗ {page.name}: id=\"{value}\" מופיע {len(lines)} פעמים (שורות {where})")
    if failed:
        print("\ngetElementById מחזיר רק את הראשון, ולכן הקוד של השני כותב לאלמנט הלא נכון")
        print("בשקט. תנו לאחד מהם שם משלו, ועדכנו את ה-JS שקורא אותו.")
        return 1
    print(f"✓ {len(pages)} דפים, ואין id כפול באף אחד מהם.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
