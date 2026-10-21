#!/usr/bin/env python3
"""
מה שאינו אתר חסום ב-_redirects, ומה שהאתר מגיש אינו חסום.

‏Netlify מפרסם את שורש הריפו כולו. ‏`_redirects` חוסם ב-`404!` את מה שאינו
אתר (קוד הפונקציות, מיגרציות, תיעוד, סקריפטים), ובלי הבדיקה הזו תיקייה חדשה
או סקריפט חדש בשורש היו מתפרסמים בשקט - בדיוק כמו שהריפו כולו היה פתוח
עד 21.10.2026. ‏docs/netlify-usage.md.

שני הכיוונים:
  * כל תיקייה ב-NOT_SITE_DIRS וכל קובץ בשורש שאינו אתר (‏*.py, ‏*.md, ‏*.sql,
    קבצי נקודה) - יש לו שורת `404!` ב-_redirects.
  * אף נתיב שהאתר מגיש (‏assets/, ‏vendor/, ‏*.html, קובצי השורש של האתר) אינו
    חסום. חסימה כזו מפילה את האתר בלי שגיאה ב-CI אחרת.
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

# תיקיות שאינן אתר. אותה רשימה כמו NOT_SITE ב-scripts/netlify_ignore.sh, ועוד
# netlify/ (המקור של פונקציות ה-edge - נפרס בנפרד, ואין סיבה להגיש אותו).
NOT_SITE_DIRS = {
    "docs", "supabase", "scripts", "netlify", ".claude", ".github", ".git",
    "ops_agent", "news_engine", "lead_engine", "deals_engine", "marketing",
    "gtm",
}
SITE_DIRS = {"assets", "vendor"}
# קבצים בשורש שהאתר מגיש בכוונה.
SITE_FILES = {
    "_headers", "_redirects", "robots.txt", "sitemap.xml", "llms.txt", "sw.js",
    "manifest.webmanifest", "app-crm.webmanifest", "promoted.png",
}
NOT_SITE_FILE = re.compile(r"\.(py|md|sql|toml|txt)$|^\.")

RULE = re.compile(r"^(/\S+)\s+\S+\s+404!\s*$")


def blocked_paths() -> set[str]:
    out = set()
    for line in (ROOT / "_redirects").read_text(encoding="utf-8").splitlines():
        m = RULE.match(line.strip())
        if m:
            out.add(m.group(1))
    return out


def main() -> int:
    blocked = blocked_paths()
    problems = []

    for entry in sorted(ROOT.iterdir()):
        name = entry.name
        if entry.is_dir():
            if name in NOT_SITE_DIRS:
                if f"/{name}/*" not in blocked:
                    problems.append(f"התיקייה {name}/ אינה אתר ואינה חסומה. להוסיף ל-_redirects:\n    /{name}/*    /404.html    404!")
            elif name not in SITE_DIRS:
                problems.append(f"תיקייה חדשה בשורש: {name}/. אם היא אתר - להוסיף ל-SITE_DIRS כאן; אם לא - ל-NOT_SITE_DIRS כאן, ל-NOT_SITE ב-netlify_ignore.sh ולשורת 404! ב-_redirects")
            continue
        if name.endswith(".html") or name in SITE_FILES:
            continue
        if NOT_SITE_FILE.search(name) and f"/{name}" not in blocked:
            problems.append(f"הקובץ {name} בשורש אינו אתר ואינו חסום. להוסיף ל-_redirects:\n    /{name}    /404.html    404!")

    for path in sorted(blocked):
        first = path.strip("/").split("/")[0]
        if first in SITE_DIRS or first in SITE_FILES or first.endswith(".html"):
            problems.append(f"‏_redirects חוסם את {path} - זה נתיב שהאתר מגיש")

    if problems:
        print("✗ קבצים שאינם אתר וחשופים, או אתר שנחסם:\n")
        for p in problems:
            print("  - " + p)
        print("\nהפרטים: docs/netlify-usage.md")
        return 1
    print(f"✓ {len(blocked)} נתיבים שאינם אתר חסומים, ואף נתיב של האתר אינו חסום")
    return 0


if __name__ == "__main__":
    sys.exit(main())
