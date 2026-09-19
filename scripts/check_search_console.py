#!/usr/bin/env python3
"""
‏בדיקה שכל דף באתר נושא את תגית האימות של Google Search Console.

התגית מוכיחה לגוגל שהאתר שלנו — ובלעדיה אין גישה לדוחות, אין הגשת
‎sitemap‎ ואין בקשת אינדוקס. גוגל בודקת אותה שוב ושוב גם אחרי שהאימות עבר,
ואם היא נעלמת האימות מתבטל.

לאתר אין תבנית משותפת (ראו ‎CLAUDE.md‎), ולכן התגית משוכפלת בכל דף בדיוק
כמו תגיות ה-GTM ובלוק ה-PWA. השכפול הזה אינו נדרש לאימות עצמו — גוגל
מושכת את כתובת השורש בלבד — אלא לשתי סיבות אחרות:

  ‏1. **נכס כתובת לתת-נתיב.** ‏Search Console מאפשר לאמת גם
     ‎https://shuknadlan.co.il/property‎ בנפרד, למשל כדי לראות דוחות
     נפרדים לדפי הנכסים. אימות כזה קורא את הדף עצמו, לא את דף הבית.
  ‏2. **דף הבית אינו מובטח.** מי שיחליף אותו, יפצל אותו, או יגיש
     ‎/index.html‎ מכתובת אחרת — לא ישבור את האימות אם התגית בכל דף.

שלושת דפי הפירוט חשובים כאן במיוחד: ‎property.html‎, ‎agency.html‎ ו-
‎agent.html‎ הם קובץ אחד שמגיש **כל** הנכסים, המשרדים והמתווכים באתר
(‏`?id=`‏, `?slug=`‏), ולכן תגית אחת בכל אחד מהם מכסה את כולם.

הבדיקה רצה ב-CI על כל PR שנוגע ב-HTML, ואפשר להריץ ידנית:

    python scripts/check_search_console.py

יציאה 0 = הכול מכוסה. יציאה 1 = יש חוסר, והפלט מראה מה להדביק ואיפה.

## מה נבדק

  ‏1. כל דף HTML בשורש נושא ‎<meta name="google-site-verification">‎.
  ‏2. התגית יושבת בתוך ה-‎<head>‎. גוגל מתעלמת מתגית שמחוץ לו.
  ‏3. הטוקן זהה בכל הדפים ושווה ל-‎TOKEN‎ שלמטה. טוקן שנשתל חלקית — דף
     אחד עם ערך ישן — הוא בדיוק סוג התקלה שאי אפשר לראות בדפדפן.

## החלפת הטוקן

אם ‎Search Console‎ מנפיק טוקן חדש (למשל אחרי הסרת אימות והוספתו מחדש),
מחליפים את ‎TOKEN‎ כאן ומריצים:

    python scripts/check_search_console.py --fix
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# ‏הטוקן שגוגל הנפיקה לדומיין shuknadlan.co.il. הוא ציבורי מעצם טבעו —
# הוא נשלח בכל טעינת דף — ואינו סוד.
TOKEN = "_ALC1h51UGYFz3-d53Q9wYeB88QS5ow5DbJ-ZgV1PDA"

TAG = '<meta name="google-site-verification" content="%s">' % TOKEN

BLOCK = (
    "<!-- אימות הבעלות מול Google Search Console. הבלוק חוזר בכל דף מאותה\n"
    "     סיבה שתגיות ה-GTM חוזרות: לאתר אין תבנית משותפת. הפרטים:\n"
    "     docs/security-headers.md -->\n" + TAG
)

META = re.compile(
    r'<meta\s+name="google-site-verification"\s+content="([^"]*)"\s*/?>',
    re.IGNORECASE,
)

# ‏אותו עוגן שבכל הדפים: הבלוק נכנס מיד אחרי סקריפט ההתקנה כאפליקציה.
ANCHOR = re.compile(r'<script[^>]+src="assets/pwa-install\.js"[^>]*></script>')


def head_of(text: str) -> str:
    end = re.search(r"</head\s*>", text, re.IGNORECASE)
    return text[: end.start()] if end else text


def check_page(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    problems: list[str] = []

    found = META.findall(text)
    if not found:
        problems.append("אין תגית אימות כלל")
        return problems

    if len(found) > 1:
        problems.append("יש %d תגיות אימות בדף. אחת מספיקה." % len(found))

    for value in found:
        if value != TOKEN:
            problems.append(
                "הטוקן אינו זהה לשאר האתר:\n"
                "            בדף:  %s\n"
                "            צריך: %s" % (value, TOKEN)
            )

    if not META.search(head_of(text)):
        problems.append("התגית נמצאת מחוץ ל-<head>. גוגל מתעלמת ממנה שם.")

    return problems


def fix_page(path: Path) -> bool:
    """שתילת הבלוק בדף שאין בו תגית, או יישור טוקן ישן לטוקן הנוכחי."""
    text = path.read_text(encoding="utf-8")

    if META.search(text):
        fixed = META.sub(TAG, text)
    else:
        match = ANCHOR.search(text)
        if not match:
            return False
        fixed = text[: match.end()] + "\n" + BLOCK + text[match.end():]

    if fixed == text:
        return False
    path.write_text(fixed, encoding="utf-8")
    return True


def main(argv: list[str]) -> int:
    pages = sorted(ROOT.glob("*.html"))
    if not pages:
        print("לא נמצאו דפי HTML בשורש — משהו בבדיקה עצמה שבור.")
        return 1

    if "--fix" in argv:
        fixed = [p.name for p in pages if fix_page(p)]
        print("תוקנו %d דפים%s" % (len(fixed), (": " + ", ".join(fixed)) if fixed else ""))
        print("הריצו את הבדיקה שוב כדי לוודא.")
        return 0

    failed = {p: probs for p in pages if (probs := check_page(p))}
    for path, problems in failed.items():
        print("✗ %s" % path.name)
        for problem in problems:
            print("      • %s" % problem)

    if failed:
        print(
            "\nהתגית מוכיחה לגוגל שהאתר שלנו, וגוגל בודקת אותה שוב גם אחרי\n"
            "שהאימות עבר — דף שנשאר בלעדיה אינו שובר כלום היום, ובדיוק לכן\n"
            "הוא נשאר כך. הבלוק המלא יושב ב-index.html מיד אחרי\n"
            "‎<script defer src=\"assets/pwa-install.js\">‎, ואפשר להעתיק אותו\n"
            "משם או להריץ:\n\n"
            "    python scripts/check_search_console.py --fix\n\n"
            "התיעוד: docs/security-headers.md"
        )
        return 1

    print("✓ כל %d דפי ה-HTML נושאים את תגית האימות של Search Console." % len(pages))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
