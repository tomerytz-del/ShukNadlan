#!/usr/bin/env python3
"""
‏בדיקה שכלל "עצירת אנימציות" של תפריט הנגישות אכן חל בכל דף שמציע אותו.

הכלל ‎html.a11y-nomotion‎ יושב במקום אחד, ‎assets/design-system.css‎, ו-
‎assets/a11y-menu.js‎ (‏/swipe) רק מדליק את המחלקה. דף שטוען את התפריט בלי
גיליון העיצוב נראה תקין: המתג מסומן "פעיל" ושום דבר לא נעצר, ואין שגיאה.
הבדיקה חוסמת את זה, ובודקת גם שהכלל עצמו מכבה את שלושת הדברים (‏animation,
‏transition, ‏scroll-behavior). הקישור חייב להיות תג ‎<link>‎ אמיתי, לא
אזכור בהערה, ובדף הבית הוא חייב לבוא לפני ‎home.js‎ שמדליק את המחלקה
(‏docs/motion.md).

    python scripts/check_a11y_motion.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
errors = []

css = (ROOT / "assets" / "design-system.css").read_text(encoding="utf-8")
m = re.search(r"html\.a11y-nomotion\s+\*[^{}]*\{([^}]*)\}", css)
if not m:
    errors.append("assets/design-system.css: אין כלל html.a11y-nomotion")
else:
    for prop in ("animation", "transition", "scroll-behavior"):
        if not re.search(r"(?<![\w-])" + prop + r"\s*:\s*(none|auto)\s*!important", m.group(1)):
            errors.append(f"assets/design-system.css: הכלל a11y-nomotion לא מכבה {prop} (עם !important)")

for page in sorted(ROOT.glob("*.html")):
    html = page.read_text(encoding="utf-8")
    if "a11y-menu.js" in html and not re.search(r"<link\b[^>]*assets/design-system\.css", html):
        errors.append(f"{page.name}: טוען a11y-menu.js בלי assets/design-system.css, ולכן 'עצירת אנימציות' לא תעצור כלום")

# דף הבית: המחלקה נכנסת מ-home.js, והקישור לגיליון חייב לבוא לפניו (סקריפט רגיל מחכה לגיליונות שלפניו)
home = (ROOT / "index.html").read_text(encoding="utf-8")
link = re.search(r"<link\b[^>]*assets/design-system\.css", home)
script = re.search(r"<script\b[^>]*assets/home\.js", home)
if not link or not script or link.start() > script.start():
    errors.append("index.html: הקישור ל-assets/design-system.css חייב להופיע לפני assets/home.js, אחרת 'עצירת אנימציות' עלולה לא לחול")

if errors:
    print("✗ כלל 'עצירת אנימציות' שבור:")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print("✓ כלל 'עצירת אנימציות' מכסה כל דף שמציע אותו.")
