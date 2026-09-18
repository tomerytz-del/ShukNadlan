#!/usr/bin/env python3
"""
‏בדיקה שכל דף באתר ניתן להתקנה כאפליקציה, ושהמניפסטים שלמים.

לאתר אין תבנית משותפת — כל דף הוא קובץ HTML עצמאי — ולכן גם בלוק ה-PWA
משוכפל בכל דף, בדיוק כמו תגיות ה-GTM. דף שנוצר בלי הבלוק **נראה תקין
לחלוטין**: הוא נטען, הוא עובד, ואין בקונסול שום שגיאה. מה שקורה הוא
שמי שנחת/ה עליו — מקישור בוואטסאפ, מגוגל — לא מקבל/ת את ההצעה להתקין,
ואם הוא/היא כן התקין/ה מדף אחר, פתיחה של הדף הזה מתוך האפליקציה עלולה
לצאת מהאפליקציה החוצה לדפדפן.

הבדיקה רצה ב-CI על כל PR שנוגע ב-HTML או במניפסטים, ואפשר להריץ ידנית:

    python scripts/check_pwa.py

יציאה 0 = הכול מכוסה. יציאה 1 = יש חוסר, והפלט מראה מה להדביק ואיפה.

## מה נבדק

  ‏1. כל דף נושא את חמשת הרכיבים: מניפסט, ‎theme-color‎, אייקון אפל,
     כותרת האפליקציה ל-iOS, והסקריפט ‎assets/pwa-install.js‎.
  ‏2. **המניפסט הנכון לסוג הדף.** דפי האזור האישי מצביעים ל-
     ‎app-crm.webmanifest‎ (‏שנפתח על ‎/crm‎), וכל השאר ל-
     ‎manifest.webmanifest‎ (‏שנפתח על דף הבית). היפוך כאן הוא התקלה
     הכי שקטה בקבוצה: האפליקציה תותקן, ותיפתח בדף הלא נכון.
  ‏3. המניפסטים עצמם: ‎JSON‎ תקין, שדות חובה, ושכל קובץ אייקון שהם
     מצביעים אליו קיים בריפו. ‏Netlify מפרסם קבצים סטטיים בלבד — אייקון
     שלא נכנס לגיט הוא 404, וכרום פוסל את ההתקנה כולה בגללו.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

PUBLIC_MANIFEST = "/manifest.webmanifest"
PERSONAL_MANIFEST = "/app-crm.webmanifest"

# אותה רשימה בדיוק שקובעת מי טוען את events.js (ראו CLAUDE.md): דפי
# האזור האישי. הם גם אלה שמקבלים מניפסט שנפתח על ה-CRM ולא על דף הבית.
PERSONAL_PAGES = {"crm.html", "developer-crm.html", "professional-manage.html"}

REQUIRED = [
    (
        re.compile(r'<link\s+rel="manifest"\s+href="([^"]+)"', re.IGNORECASE),
        "קישור למניפסט",
        '<link rel="manifest" href="%s">' % PUBLIC_MANIFEST,
    ),
    (
        re.compile(r'<meta\s+name="theme-color"\s+content="#0e2a6b"', re.IGNORECASE),
        "‏theme-color (צבע שורת המצב באפליקציה)",
        '<meta name="theme-color" content="#0e2a6b">',
    ),
    (
        re.compile(r'<link\s+rel="apple-touch-icon"\s+href="/assets/apple-touch-icon\.png"', re.IGNORECASE),
        "אייקון מסך הבית של אייפון",
        '<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">',
    ),
    (
        re.compile(r'<meta\s+name="apple-mobile-web-app-title"', re.IGNORECASE),
        "שם האפליקציה מתחת לאייקון באייפון",
        '<meta name="apple-mobile-web-app-title" content="שוק נדל״ן">',
    ),
    (
        re.compile(r'<script[^>]+src="assets/pwa-install\.js"', re.IGNORECASE),
        "כפתור ההתקנה",
        '<script defer src="assets/pwa-install.js"></script>',
    ),
]

MANIFEST_REQUIRED_KEYS = ["id", "name", "short_name", "start_url", "scope",
                          "display", "theme_color", "background_color", "icons"]


def check_page(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    problems: list[str] = []

    head_end = re.search(r"</head\s*>", text, re.IGNORECASE)
    head = text[: head_end.start()] if head_end else text

    for pattern, label, snippet in REQUIRED:
        if not pattern.search(head):
            problems.append("חסר %s:\n            %s" % (label, snippet))

    # המניפסט הנכון לסוג הדף
    link = REQUIRED[0][0].search(head)
    if link:
        want = PERSONAL_MANIFEST if path.name in PERSONAL_PAGES else PUBLIC_MANIFEST
        if link.group(1) != want:
            problems.append(
                "מצביע ל-%s ולא ל-%s.\n"
                "            דף באזור האישי נפתח על /crm, וכל דף אחר על דף הבית."
                % (link.group(1), want)
            )

    return problems


def check_manifest(name: str) -> list[str]:
    path = ROOT / name
    if not path.exists():
        return ["הקובץ אינו קיים"]

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as err:
        return ["‏JSON שבור: %s" % err]

    problems = []
    for key in MANIFEST_REQUIRED_KEYS:
        if key not in data:
            problems.append("חסר השדה %s" % key)

    icons = data.get("icons") or []
    sizes = {icon.get("sizes") for icon in icons if icon.get("purpose", "any") != "maskable"}
    for needed in ("192x192", "512x512"):
        if needed not in sizes:
            problems.append(
                "אין אייקון %s. כרום דורש את שני הגדלים, ובלעדיהם אין התקנה." % needed
            )
    if not any(icon.get("purpose") == "maskable" for icon in icons):
        problems.append("אין אייקון maskable — אנדרואיד יציג ריבוע לבן סביב האייקון")

    for icon in icons:
        src = (icon.get("src") or "").lstrip("/")
        if src and not (ROOT / src).exists():
            problems.append("האייקון %s מופיע במניפסט ואינו קיים בריפו" % icon.get("src"))

    for shortcut in data.get("shortcuts", []):
        for icon in shortcut.get("icons", []):
            src = (icon.get("src") or "").lstrip("/")
            if src and not (ROOT / src).exists():
                problems.append("אייקון של קיצור דרך חסר: %s" % icon.get("src"))

    start = data.get("start_url", "")
    scope = data.get("scope", "/")
    if start and not start.startswith(scope):
        problems.append("‏start_url (%s) מחוץ ל-scope (%s)" % (start, scope))

    return problems


def main() -> int:
    failures = 0

    # ---- הקבצים המשותפים ----
    for name in (PUBLIC_MANIFEST.lstrip("/"), PERSONAL_MANIFEST.lstrip("/")):
        problems = check_manifest(name)
        if problems:
            failures += 1
            print("✗ %s:" % name)
            for problem in problems:
                print("      • %s" % problem)

    if not (ROOT / "sw.js").exists():
        failures += 1
        print("✗ sw.js אינו קיים — בלעדיו כרום לא יורה beforeinstallprompt,")
        print("      כלומר כפתור ההתקנה לא יופיע כלל באנדרואיד ובמחשב.")

    if not (ROOT / "assets" / "pwa-install.js").exists():
        failures += 1
        print("✗ assets/pwa-install.js אינו קיים")

    # ---- הדפים ----
    pages = sorted(ROOT.glob("*.html"))
    if not pages:
        print("לא נמצאו דפי HTML בשורש — משהו בבדיקה עצמה שבור.")
        return 1

    failed = {p: probs for p in pages if (probs := check_page(p))}
    for path, problems in failed.items():
        print("✗ %s" % path.name)
        for problem in problems:
            print("      • %s" % problem)

    if failed:
        print(
            "\nכל דף באתר הוא נקודת נחיתה אפשרית, ולכן כל דף נושא את בלוק ה-PWA.\n"
            "הבלוק המלא נמצא ב-index.html מיד אחרי ‎<link rel=\"icon\">‎, ואפשר\n"
            "להעתיק אותו משם. דף באזור האישי (crm, developer-crm,\n"
            "professional-manage) מחליף את שם המניפסט ל-%s.\n"
            "התיעוד: docs/pwa-install.md" % PERSONAL_MANIFEST
        )

    if failed or failures:
        return 1

    print("✓ כל %d הדפים ניתנים להתקנה, ושני המניפסטים שלמים." % len(pages))
    return 0


if __name__ == "__main__":
    sys.exit(main())
