#!/usr/bin/env python3
"""
‏בדיקה ששני מודולי ההסכם זהים בין ‎assets/‎ ל-‎supabase/functions/_shared/‎.

‏`assets/agreement-templates.js` מחזיק את **הנוסח המשפטי** של הזמנת שירותי
התיווך, ו-`assets/agreement-doc.js` מרכיב ממנו את המסמך. שלושה דפים באתר
טוענים אותם (`crm.html`, `sign.html`, `agreement.html`), ומאז שהעוזר
בוואטסאפ יודע להכין הסכם — גם Edge Function טוענת אותם.

‏Edge Function אינה יכולה לייבא מחוץ ל-`supabase/functions`: ה-CLI בונה את
הבאנדל מהתיקייה הזו בלבד. לכן יש עותק ב-`_shared`, ולכן צריכה להיות בדיקה
שהוא **זהה בייט-בייט** למקור.

הסיבה ספציפית: הפער בין שני עותקים של נוסח משפטי אינו נראה בשום מקום. הדף
ייראה תקין, המסמך ייבנה, הלקוח/ה יחתום/תחתום — ורק אחרי שתוגש תביעת דמי
תיווך יתגלה שהסעיף שהוא/היא חתם/ה עליו אינו הסעיף שבתיק. זו טעות שאי אפשר
לתקן למפרע.

הרצה ידנית:

    python scripts/check_agreement_assets.py

יציאה 0 = העותקים זהים. יציאה 1 = יש פער, והפלט מראה איזה קובץ ומה לעשות.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# ‏(המקור, העותק). המקור הוא מה שהאתר טוען, והוא זה שעורכים.
PAIRS = [
    ("assets/agreement-templates.js", "supabase/functions/_shared/agreement-templates.js"),
    ("assets/agreement-doc.js",       "supabase/functions/_shared/agreement-doc.js"),
]


def main() -> int:
    problems: list[str] = []

    for source_rel, copy_rel in PAIRS:
        source = ROOT / source_rel
        copy = ROOT / copy_rel

        if not source.exists():
            problems.append(f"חסר קובץ המקור {source_rel}")
            continue
        if not copy.exists():
            problems.append(
                f"חסר העותק {copy_rel}\n"
                f"    תיקון:  cp {source_rel} {copy_rel}"
            )
            continue

        if source.read_bytes() != copy.read_bytes():
            problems.append(
                f"{copy_rel} אינו זהה ל-{source_rel}\n"
                f"    ‏{source_rel} הוא המקור — עורכים אותו, ואז מעתיקים:\n"
                f"    תיקון:  cp {source_rel} {copy_rel}"
            )

    if problems:
        print("מודולי ההסכם אינם מסונכרנים:\n", file=sys.stderr)
        for problem in problems:
            print(f"  ✗ {problem}", file=sys.stderr)
        print(
            "\nהעותק ב-_shared נטען על ידי Edge Function שמכינה הסכמים "
            "(‏whatsapp-webhook). נוסח שונה בין שני העותקים פירושו שהמסמך "
            "שנחתם אינו המסמך שבתיק.",
            file=sys.stderr,
        )
        return 1

    print(f"שני מודולי ההסכם מסונכרנים ({len(PAIRS)} זוגות).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
