#!/usr/bin/env python3
"""
‏בדיקה שכלל "עצירת אנימציות" של תפריט הנגישות אכן חל בכל דף שמציע אותו.

הכלל ‎html.a11y-nomotion‎ יושב במקום אחד, ‎assets/design-system.css‎, ו-
‎assets/a11y-menu.js‎ (‏/swipe) רק מדליק את המחלקה. דף שטוען את התפריט בלי
גיליון העיצוב נראה תקין: המתג מסומן "פעיל" ושום דבר לא נעצר, ואין שגיאה.
הבדיקה חוסמת את זה, ובודקת גם שהכלל עצמו מכבה את שלושת הדברים (‏animation,
‏transition, ‏scroll-behavior). דף הבית נושא עותק מוטבע מוקדם בכוונה, כי
הגיליון נטען שם בסוף המסמך (‏docs/motion.md).

    python scripts/check_a11y_motion.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
errors = []

css = (ROOT / "assets" / "design-system.css").read_text(encoding="utf-8")
m = re.search(r"html\.a11y-nomotion[^{]*\{([^}]*)\}", css)
if not m:
    errors.append("assets/design-system.css: אין כלל html.a11y-nomotion")
else:
    for prop in ("animation", "transition", "scroll-behavior"):
        if not re.search(prop + r"\s*:\s*(none|auto)\s*!important", m.group(1)):
            errors.append(f"assets/design-system.css: הכלל a11y-nomotion לא מכבה {prop} (עם !important)")

for page in sorted(ROOT.glob("*.html")):
    html = page.read_text(encoding="utf-8")
    if "a11y-menu.js" in html and "assets/design-system.css" not in html:
        errors.append(f"{page.name}: טוען a11y-menu.js בלי assets/design-system.css, ולכן 'עצירת אנימציות' לא תעצור כלום")

idx = (ROOT / "index.html").read_text(encoding="utf-8")
if not re.search(r"html\.a11y-nomotion\s+\*[^{}]*\{[^}]*animation\s*:\s*none", idx):
    errors.append("index.html: חסר העותק המוטבע של a11y-nomotion (הגיליון נטען שם בסוף המסמך)")

if errors:
    print("✗ כלל 'עצירת אנימציות' שבור:")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print("✓ כלל 'עצירת אנימציות' מכסה כל דף שמציע אותו.")
