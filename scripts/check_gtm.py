#!/usr/bin/env python3
"""
‏בדיקה שכל דף HTML באתר נושא את תגיות Google Tag Manager.

לאתר אין תבנית משותפת — כל דף הוא קובץ HTML עצמאי ש-Netlify מפרסם כמו
שהוא — ולכן שני קטעי ה-GTM משוכפלים בכל דף. דף חדש שנוצר בלי הקטעים האלה
פשוט לא נמדד, ואין שום סימן לכך: הדף נטען, נראה תקין, ומתנהג כרגיל. מי
שיגלה את זה יגלה חודש אחרי, כשיחפש את הדף בדוחות ולא ימצא.

הבדיקה הזאת היא הסימן. היא רצה ב-CI על כל PR שנוגע ב-HTML, ואפשר להריץ
אותה ידנית:

    python scripts/check_gtm.py

יציאה 0 = כל הדפים מכוסים. יציאה 1 = יש דף חסר, והפלט מראה בדיוק מה
להדביק ואיפה.

שינוי מזהה המכולה נעשה כאן ב-CONTAINER_ID, ואז בכל הדפים יחד.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

CONTAINER_ID = "GTM-NZHD7ZHT"

ROOT = Path(__file__).resolve().parent.parent

HEAD_SNIPPET = """<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','%s');</script>
<!-- End Google Tag Manager -->""" % CONTAINER_ID

BODY_SNIPPET = """<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=%s"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<!-- End Google Tag Manager (noscript) -->""" % CONTAINER_ID

BODY_RE = re.compile(r"<body\b[^>]*>", re.IGNORECASE)
HEAD_END_RE = re.compile(r"</head\s*>", re.IGNORECASE)


def check(path: Path) -> list[str]:
    """מחזירה רשימת תקלות בדף אחד. רשימה ריקה = הדף תקין."""
    text = path.read_text(encoding="utf-8")
    problems: list[str] = []

    head_end = HEAD_END_RE.search(text)
    body_open = BODY_RE.search(text)
    if not head_end or not body_open:
        return ["אין ‎</head>‎ או ‎<body>‎ — לא נראה כמו דף שלם"]

    head, body = text[: head_end.start()], text[body_open.end() :]

    # מזהה זר הוא תקלה חמורה יותר מהיעדר תגית: הדף כן נמדד, רק לא אלינו.
    for stray in set(re.findall(r"GTM-[A-Z0-9]+", text)) - {CONTAINER_ID}:
        problems.append("מזהה מכולה זר: %s (הנכון הוא %s)" % (stray, CONTAINER_ID))

    if HEAD_SNIPPET not in head:
        where = "מחוץ ל-‎<head>‎" if HEAD_SNIPPET in text else "חסר"
        problems.append("קטע ה-script %s" % where)

    if BODY_SNIPPET not in body:
        where = "לפני ‎<body>‎" if BODY_SNIPPET in text else "חסר"
        problems.append("קטע ה-noscript %s" % where)
    elif body[: body.index(BODY_SNIPPET)].strip():
        # ‏גוגל מבקשת מיד אחרי <body>, וזה לא קפריזה: iframe שנדחק אחרי
        # תוכן הדף נטען מאוחר יותר, ובדפים ארוכים עלול לא להיטען כלל.
        problems.append("קטע ה-noscript אינו מיד אחרי ‎<body>‎")

    return problems


def main() -> int:
    pages = sorted(ROOT.glob("*.html"))
    if not pages:
        print("לא נמצאו דפי HTML בשורש הריפו — משהו בבדיקה עצמה שבור.")
        return 1

    failed = {p: probs for p in pages if (probs := check(p))}

    if not failed:
        print("✓ כל %d דפי ה-HTML נושאים את תגיות %s." % (len(pages), CONTAINER_ID))
        return 0

    print("✗ %d מתוך %d דפים ללא תגיות GTM תקינות:\n" % (len(failed), len(pages)))
    for path, problems in failed.items():
        print("  %s" % path.name)
        for problem in problems:
            print("      • %s" % problem)
    print(
        "\nכל דף באתר נמדד, ולכן גם דף חדש. להדבקה:\n"
        "\n‏1. ב-‎<head>‎, מיד אחרי ‎<meta charset>‎ (הצהרת הקידוד נשארת ראשונה,\n"
        "   אחרת דפדפן ינחש קידוד ויציג ג'יבריש בעברית):\n\n"
        "%s\n"
        "\n‏2. מיד אחרי ‎<body>‎:\n\n"
        "%s\n"
        "\nהקטעים חייבים להיות מועתקים כלשונם — הבדיקה משווה טקסט מלא, כדי\n"
        "שגרסה משוכתבת של המכולה לא תיכנס בלי שאיש ישים לב.\n"
        "התיעוד: docs/analytics-gtm.md" % (HEAD_SNIPPET, BODY_SNIPPET)
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
