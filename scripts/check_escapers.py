#!/usr/bin/env python3
"""
‏בדיקה שכל בריחת HTML באתר עוברת דרך הגדרה אחת ומלאה.

עד לאיחוד היו לפונקציה הזו 22 הגדרות תחת שמונה שמות — ‎escapeHtml, esc,
‏escAttr, escapeAttr, escapeArticleText, impEscape‎ — וחלקן לא ברחו מגרש
בודד. שתי תקלות נפרדות באותו שורש:

  ‏1. **הגדרה חלקית.** ‎escAttr‎ בדף הבית טיפל/ה ב-‎& " <‎ בלבד. ערך כזה
     בתוך ‎attr='…'‎ יוצא מהמאפיין החוצה.
  ‏2. **שמונה שמות = אף שם.** כשאין שם אחד נכון, לפעמים לא נקרא אף אחד.
     כך נוצרה ההזרקה ב-‎buildSearchRow‎: ‎escAttr‎ היה באותו קובץ, שימש
     שתי שורות מעל לכתובות התמונה, ובשדות הטקסט פשוט לא נשלף.

## מה נחשב "הגדרה"

פונקציה שבגופה מופיעה ישות HTML (‏‎&amp;‎, ‎&lt;‎ וכו') — כלומר היא
**עושה** את הבריחה בעצמה. כינוי (‎const esc = escapeHtml;‎) ועטיפה דקה
(‎function escapeAttr(s){ return escapeHtml(s); }‎) אינם הגדרה: שניהם
מפנים להגדרה האחת, וזו בדיוק המטרה.

## שני הכללים

  ‏• דף HTML אינו מגדיר בעצמו — הוא טוען ‎assets/esc.js‎.
  ‏• מודול ב-‎assets/‎ שמגדיר עותק משלו (מכוון: סדר הטעינה בין קבצי
    ‏assets אינו מובטח) חייב לברוח מכל חמשת התווים.

הרצה ידנית:

    python scripts/check_escapers.py

יציאה 0 = תקין. יציאה 1 = יש הגדרה חדשה או חלקית, והפלט מראה איפה.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# שם שנראה כמו בריחה: esc בתחילת מילה, או escape. ‏"description" אינו כזה,
# ולכן ‎esc‎ חייב לפתוח את השם או לבוא אחרי גבול camelCase.
NAME = r"(?:esc[A-Z_]\w*|esc|escape\w*|\w+Escape\w*)"

DEF_RE = re.compile(
    r"(?:function\s+(?P<fn>" + NAME + r")\s*\([^)]*\)\s*\{"
    r"|(?:const|let|var)\s+(?P<cn>" + NAME + r")\s*=\s*(?:function\s*)?\([^)]*\)\s*(?:=>\s*)?\{"
    r"|(?:const|let|var)\s+(?P<an>" + NAME + r")\s*=\s*\w+\s*=>)"
)

ENTITIES = ["&amp;", "&lt;", "&gt;", "&quot;", "&#39;"]

# פונקציות שאינן בריחת HTML ולכן פטורות, עם הסיבה
EXEMPT = {
    "escapeRe":     "בריחת regex",
    "escMultiline": "עוטף את esc ומוסיף <br>",
    "sqlQuote":     "ציטוט ל-SQL",
}

# קריאה לשם בריחה שאינה ממודול עם namespace (‏ProjectCard.escapeHtml)
CALL_RE = re.compile(r"(?<![.\w])(escapeHtml|escAttr|escapeAttr|escapeArticleText|impEscape|esc)\s*\(")


def real_defs(text: str):
    """מחזיר (שם, שורה, חוסרים) לכל הגדרה שבאמת מבצעת בריחה."""
    for m in DEF_RE.finditer(text):
        name = m.group("fn") or m.group("cn") or m.group("an")
        if name in EXEMPT:
            continue
        body = text[m.end(): m.end() + 420]
        # גוף שאין בו אף ישות HTML אינו מבצע בריחה — זה כינוי או עטיפה
        if not any(e in body for e in ENTITIES):
            continue
        line = text[: m.start()].count("\n") + 1
        yield name, line, [e for e in ENTITIES if e not in body]


def check_html(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    problems: list[str] = []

    for name, line, _missing in real_defs(text):
        problems.append(
            "שורה %d: ‎%s‎ מבצעת בריחה בדף עצמו. יש לטעון ‎assets/esc.js‎ "
            "ולכתוב ‎const %s = escapeHtml;‎" % (line, name, name)
        )

    # דף שקורא לשם בריחה חשוף חייב מקור לו: או esc.js, או כינוי מפורש
    head_end = text.lower().find("</head>")
    after_head = text[head_end:] if head_end != -1 else text
    call = CALL_RE.search(after_head)
    if call and "assets/esc.js" not in text:
        n = re.escape(call.group(1))
        aliased = re.search(
            # כינוי מפורש: ‎const esc = ProjectCard.escapeHtml;‎ או עטיפה
            # ‎function esc(s){ return escapeHtml(s); }‎
            r"(?:const|let|var)\s+" + n + r"\s*=\s*[\w.]*escapeHtml\s*;"
            r"|function\s+" + n + r"\s*\([^)]*\)\s*\{\s*return\s+[\w.]*escapeHtml\(",
            text,
        )
        if not aliased:
            problems.append(
                "קורא ל-‎%s()‎ אבל אינו טוען ‎assets/esc.js‎ ואין לו כינוי מפורש"
                % call.group(1)
            )
    return problems


def check_asset(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    return [
        "שורה %d: ‎%s‎ אינה בורחת מ-%s — ערך כזה יוצא מהמאפיין או מהתגית"
        % (line, name, ", ".join(missing))
        for name, line, missing in real_defs(text)
        if missing
    ]


def main() -> int:
    failed: dict[str, list[str]] = {}

    for p in sorted(ROOT.glob("*.html")):
        if probs := check_html(p):
            failed[p.name] = probs

    for p in sorted((ROOT / "assets").glob("*.js")):
        if p.name == "esc.js":
            continue
        if probs := check_asset(p):
            failed["assets/" + p.name] = probs

    if not failed:
        print("✓ בריחת HTML עוברת דרך assets/esc.js, וכל עותק ב-assets מלא.")
        return 0

    print("✗ בעיות בבריחת HTML:\n")
    for name, probs in failed.items():
        print("  %s" % name)
        for p in probs:
            print("      • %s" % p)
    print(
        "\nההגדרה האחת נמצאת ב-‎assets/esc.js‎ ומייצאת ‎escapeHtml‎ גלובלית.\n"
        "דף חדש טוען אותה מיד אחרי קטע ה-GTM, כמו ‎assets/events.js‎.\n"
        "מודול ב-assets ששומר על עצמאות מעתיק את הגוף כלשונו — חמשת התווים."
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
