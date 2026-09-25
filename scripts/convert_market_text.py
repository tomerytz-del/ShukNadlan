#!/usr/bin/env python3
"""
‏שם השוק בטקסט הקבוע של הדפים: סימון, ובדיקה שהסימון לא נשכח.

לאתר אין תבנית משותפת, ולכן "עפולה והעמק" כתוב בכל אחד מ-~20 הדפים - בשורת
הלוגו, ב-alt וב-aria-label, בפוטר, ובבלוק "חיפושים פופולריים". הטקסט עצמו
**נשאר** עפולה (כך שדף בשוק ברירת המחדל יוצא בדיוק כמו קודם); הסקריפט מוסיף
את הסימון `data-market-*` שאומר ל-`assets/market-text.js` מה מותר להחליף
בשוק אחר, ואת תגי הסקריפט שהדף צריך כדי לדעת מהו השוק.

    python scripts/convert_market_text.py          # סימון (אידמפוטנטי)
    python scripts/convert_market_text.py --check  # ‏CI: דף שחסר בו סימון

**למה בדיקה ולא רק סימון חד-פעמי:** דף חדש נולד בהעתקה של דף קיים, וזה
בדיוק המקום שבו שורה עם "עפולה והעמק" נכנסת בלי הסימון. אין לזה שום סימן
בעפולה - רק בדף חיפה, שבו פתאום כתוב "עפולה" בלוגו. ‏docs/regional-pages.md.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# ‏דפים שאינם מוצגים לגולשים בשוק כלשהו: האזור האישי, כלי פנימי, וקישורים עם
# טוקן. אין להם לוגו של שוק, והם אינם טוענים את הקבצים.
SKIP = {
    "crm.html", "developer-crm.html", "professional-manage.html",
    "neighborhood-boundary.html", "sign.html", "review-request.html",
    "agreement.html", "market-soon.html",
}

# ‏(דפוס, החלפה) - כל אחד כתוב כך שהרצה חוזרת אינה משנה דבר.
RULES = [
    # שורת הלוגו בכותרת ובפוטר
    (re.compile(r'(<span class="(?:footer-)?logo-word">שוק הנדל״ן)<span>עפולה והעמק</span>'),
     r'\1<span data-market-label>עפולה והעמק</span>'),
    # ‏alt של הלוגו
    (re.compile(r'alt="שוק הנדל״ן של עפולה והסביבה"(?! data-market-aria)'),
     'alt="שוק הנדל״ן של עפולה והסביבה" data-market-aria="alt"'),
    # ‏aria-label של קישור הלוגו
    (re.compile(r'aria-label="(שוק הנדל״ן(?: של|,) עפולה (?:והסביבה|והעמק) - לדף הבית)"(?! data-market-aria)'),
     r'aria-label="\1" data-market-aria="aria-label"'),
    # שורת התיאור בפוטר. ‏**רק בתוך <span>** - אותו משפט יושב גם ב-JSON-LD
    # של index.html, ו-HTML בתוך מחרוזת JSON שובר את הנתונים המובנים לגוגל.
    (re.compile(r'<span>כל הנכסים, כל המתווכים ובעלי המקצוע בעפולה והעמק בכתובת אחת</span>'),
     '<span>כל הנכסים, כל המתווכים ובעלי המקצוע ב<span data-market-label>עפולה והעמק</span> בכתובת אחת</span>'),
    # קישורי הפוטר "למכירה בעפולה" / "להשכרה בעפולה"
    (re.compile(r'>(למכירה|להשכרה) בעפולה<'),
     r'>\1 ב<span data-market-city>עפולה</span><'),
    # בלוק "חיפושים פופולריים": 14 עמודי התוצאות הם של עפולה
    (re.compile(r'<details class="footer-wrap footer-seo" id="footerSeo"(?! data-market-default-only)'),
     '<details class="footer-wrap footer-seo" id="footerSeo" data-market-default-only'),
    # ‏placeholder "לדוגמה: עפולה" בטופס המחפשים
    (re.compile(r'placeholder="לדוגמה: עפולה"(?! data-market-placeholder)'),
     'placeholder="לדוגמה: עפולה" data-market-placeholder'),
    (re.compile(r'placeholder="לדוגמה: הרצל 24, עפולה"(?! data-market-placeholder)'),
     'placeholder="לדוגמה: הרצל 24, עפולה" data-market-placeholder'),
]

# ‏מה שהדף צריך כדי לדעת מהו השוק. ‏defer: הדפים האלה אינם צריכים את השוק
# לפני הציור - ההחלפה קורית רק בשוק שאינו ברירת המחדל.
SCRIPTS = ("assets/markets.js", "assets/city-context.js", "assets/market-text.js")


def script_tag(src: str) -> str:
    return '<script defer src="%s"></script>' % src


def has_script(html: str, src: str) -> bool:
    return re.search(r'<script[^>]*\bsrc="%s"' % re.escape(src), html) is not None


def convert(html: str) -> str:
    out = html
    for pattern, repl in RULES:
        out = pattern.sub(repl, out)
    missing = [s for s in SCRIPTS if not has_script(out, s)]
    if missing and "</head>" in out:
        block = (
            "<!-- השוק הפעיל, ושמו בלוגו ובפוטר (scripts/convert_market_text.py,\n"
            "     docs/regional-pages.md) -->\n"
            + "\n".join(script_tag(s) for s in missing) + "\n"
        )
        out = out.replace("</head>", block + "</head>", 1)
    return out


# ‏מה שנשאר בלי סימון - "עפולה והעמק" שאינו בתוך אחד המבנים המסומנים.
UNMARKED = [
    re.compile(r'<span>עפולה והעמק</span>'),
    re.compile(r'alt="שוק הנדל״ן של עפולה והסביבה"(?! data-market-aria)'),
    re.compile(r'aria-label="שוק הנדל״ן(?: של|,) עפולה (?:והסביבה|והעמק) - לדף הבית"(?! data-market-aria)'),
    re.compile(r'<span>כל הנכסים, כל המתווכים ובעלי המקצוע בעפולה והעמק'),
    re.compile(r'<details class="footer-wrap footer-seo" id="footerSeo"(?! data-market-default-only)'),
]


def pages() -> list[Path]:
    return sorted(p for p in ROOT.glob("*.html") if p.name not in SKIP)


def main(argv: list[str]) -> int:
    check = "--check" in argv
    problems: list[str] = []
    changed: list[str] = []
    for path in pages():
        text = path.read_text(encoding="utf-8")
        if check:
            for pat in UNMARKED:
                if pat.search(text):
                    problems.append("%s: '%s' בלי סימון data-market-*" % (path.name, pat.pattern[:48]))
            if any(r.search(text) for r in UNMARKED[:4]) or "data-market-" in text:
                for s in SCRIPTS:
                    if not has_script(text, s):
                        problems.append("%s: חסר <script src=\"%s\">" % (path.name, s))
            continue
        new = convert(text)
        if new != text:
            path.write_text(new, encoding="utf-8")
            changed.append(path.name)

    if check:
        if problems:
            print("✗ טקסט של עפולה בלי סימון שוק:\n")
            for p in problems:
                print("  • " + p)
            print("\nתיקון: python scripts/convert_market_text.py")
            return 1
        print("✓ %d דפים: שם השוק בלוגו ובפוטר מסומן, והדפים טוענים את market-text.js." % len(pages()))
        return 0

    print("סומנו %d דפים%s" % (len(changed), (": " + ", ".join(changed)) if changed else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
