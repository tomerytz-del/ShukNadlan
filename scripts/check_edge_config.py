#!/usr/bin/env python3
"""
‏בדיקה שכל Edge Function רשומה ב-supabase/config.toml עם verify_jwt מפורש.

‏`supabase functions deploy` קורא את verify_jwt של כל פונקציה מ-config.toml,
וברירת המחדל שלו כשאין ערך היא **true**. כלומר פונקציה חדשה שנוספה תחת
‎supabase/functions/‎ בלי שורה מקבילה ב-config.toml נפרסת עם אימות JWT דלוק
— וכל קריאה אליה מגולש/ת אנונימי/ת מתחילה להחזיר 401.

זה בדיוק הכשל שהקובץ config.toml עצמו מזהיר מפניו בראשו, והוא שקט משני
הצדדים: הפריסה מצליחה, ה-CI ירוק, והדף שנשבר נראה תקין עד שמישהו/י מנסה
לשלוח את הטופס. טופס יצירת קשר בדף נכס, הרשמת משרד או הוובהוק של וואטסאפ
היו נופלים בלי שאיש ידע.

‏**מה זה מוסיף על מה שכבר קיים.** ל-‎.github/workflows/supabase_functions.yml‎
יש כבר שלב שמוודא שלכל תיקייה יש ‎[functions.<שם>]‎ ב-config.toml, אבל הוא
רץ ב-push ל-main — כלומר אחרי המיזוג — ובודק רק את שורת הכותרת. הבדיקה כאן
רצה על ה-PR, ומרחיבה אותה בשלושה דברים:

  • גוש קיים אבל **בלי שורת verify_jwt** — ה-CLI חוזר ל-true, והבדיקה
    הקיימת מפספסת את זה.
  • רשומות ב-config.toml שאין להן תיקייה (שאריות משינוי שם או ממחיקה).
  • תיקייה בלי index.ts אינה נספרת, כדי שטיוטה לא תפיל את הבדיקה.

אפשר להריץ אותה ידנית:

    python scripts/check_edge_config.py

יציאה 0 = כל הפונקציות רשומות. יציאה 1 = יש פער, והפלט מראה מה להוסיף.

הבדיקה **אינה** קובעת מה הערך הנכון — זו החלטת אבטחה שנעשית בידי אדם,
ומתועדת בהערה שליד השורה. היא רק דורשת שההחלטה תתקבל במפורש.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FUNCTIONS_DIR = ROOT / "supabase" / "functions"
CONFIG = ROOT / "supabase" / "config.toml"

# ‏[functions.<שם>] — הכותרת שתחתיה יושב verify_jwt
SECTION_RE = re.compile(r"^\s*\[functions\.([A-Za-z0-9_-]+)\]\s*$", re.MULTILINE)
VERIFY_RE = re.compile(r"^\s*verify_jwt\s*=\s*(true|false)\s*(?:#.*)?$", re.MULTILINE)


def deployed_functions() -> set[str]:
    """תיקיות שנפרסות בפועל: כל תיקייה עם index.ts, למעט _shared."""
    if not FUNCTIONS_DIR.is_dir():
        return set()
    return {
        d.name
        for d in FUNCTIONS_DIR.iterdir()
        if d.is_dir() and not d.name.startswith("_") and (d / "index.ts").exists()
    }


def configured_functions() -> dict[str, bool]:
    """מיפוי שם → האם יש לו verify_jwt מפורש בגוש שלו."""
    text = CONFIG.read_text(encoding="utf-8")
    sections = list(SECTION_RE.finditer(text))
    result: dict[str, bool] = {}
    for i, match in enumerate(sections):
        end = sections[i + 1].start() if i + 1 < len(sections) else len(text)
        body = text[match.end() : end]
        result[match.group(1)] = bool(VERIFY_RE.search(body))
    return result


def main() -> int:
    if not CONFIG.exists():
        print("✗ supabase/config.toml חסר — בלעדיו כל פונקציה נפרסת עם verify_jwt=true.")
        return 1

    on_disk = deployed_functions()
    if not on_disk:
        print("לא נמצאו Edge Functions — משהו בבדיקה עצמה שבור.")
        return 1

    configured = configured_functions()

    missing = sorted(on_disk - configured.keys())
    no_value = sorted(n for n in on_disk & configured.keys() if not configured[n])
    stale = sorted(configured.keys() - on_disk)

    if not missing and not no_value and not stale:
        print("✓ כל %d ה-Edge Functions רשומות ב-config.toml עם verify_jwt מפורש." % len(on_disk))
        return 0

    print("✗ פער בין supabase/functions/ לבין supabase/config.toml:\n")

    if missing:
        print("  אין גוש ב-config.toml (ייפרסו עם verify_jwt=true, וכל קריאה")
        print("  אנונימית אליהן תחזיר 401):")
        for name in missing:
            print("      • %s" % name)
        print()

    if no_value:
        print("  יש גוש אבל בלי שורת verify_jwt (אותה תוצאה — ברירת המחדל true):")
        for name in no_value:
            print("      • %s" % name)
        print()

    if stale:
        print("  רשומות ב-config.toml אבל אין להן תיקייה — שאריות משינוי שם או")
        print("  ממחיקה; לא שוברות פריסה, אבל מטעות את מי שקורא/ת את הקובץ:")
        for name in stale:
            print("      • %s" % name)
        print()

    if missing or no_value:
        print(
            "להוספה ב-supabase/config.toml, עם הערה שמסבירה את הבחירה:\n\n"
            "    [functions.<שם>]\n"
            "    verify_jwt = false          # למה: נקודת קליטה ציבורית / סוד משלה\n\n"
            "‏false = הפונקציה מאמתת בעצמה (סוד, טוקן חד-פעמי, service role), או\n"
            "         שהיא נקודת קליטה ציבורית שנועדה לקבל פנייה מגולש/ת אנונימי/ת.\n"
            "‏true  = ה-Gateway חוסם כל בקשה בלי JWT תקין.\n\n"
            "הבחירה היא החלטת אבטחה. הבדיקה אינה מחליטה במקומך — היא רק דורשת\n"
            "שההחלטה תיכתב במפורש, כדי שפריסה לא תקבל אותה בשבילך."
        )

    return 1


if __name__ == "__main__":
    sys.exit(main())
