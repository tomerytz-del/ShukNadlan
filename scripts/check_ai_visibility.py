#!/usr/bin/env python3
"""
בדיקה שהאתר נשאר פתוח לסורקי AI, ושהמפה שלהם (llms.txt) לא מתיישנת.

## הכשל

מנוע AI שנחסם אינו מדווח על כך. הדף נטען, נראה תקין, ופשוט נעדר מתשובות
ChatGPT, Perplexity ו-Claude. חסימה כזו נכנסת בקלות: שורת `Disallow`
רחבה ב-robots.txt, או קבוצה שנכתבה בשם סורק מסוים "כדי להוריד עומס".

## מה נבדק (קבצים בלבד, בלי רשת)

1. **אין קבוצה ב-robots.txt שחוסמת דף ציבורי** - לא `*` ולא סורק AI בשמו.
   דף ציבורי הוא כל כתובת ב-sitemap.xml הסטטי וכל קישור ב-llms.txt.
2. **llms.txt, robots.txt ו-sitemap.xml לא נושאים X-Robots-Tag** ב-`_headers`.
3. **כל קישור ב-llms.txt מגיע מדף ציבורי שקיים:** כתובת סטטית ב-sitemap.xml,
   או אחת מהכתובות הדינמיות שפונקציות ה-edge מגישות (`/n/`, `/deals/`,
   `/property`, דפי הנחיתה של השווקים והחיפושים).
4. **כל דף סטטי ב-sitemap.xml מופיע ב-llms.txt**, חוץ מהרשימה הסגורה
   `NOT_IN_LLMS` למטה. דף ציבורי חדש מכריח החלטה, כמו ב-check_canonical.py.

## מה שהבדיקה אינה עושה

אינה בודקת את החסימה ברמת Netlify, ה-CDN או ה-WAF: היא אינה בריפו. חסימת בוטים
שם חייבת להתיר את `/robots.txt`, `/sitemap.xml`, `/llms.txt` ואת כל הנתיבים
הציבוריים (docs/ai-visibility.md).

    python scripts/check_ai_visibility.py
"""
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://shuknadlan.co.il"

# דף ב-sitemap שאין סיבה לרשום ב-llms.txt: חשבון פרטי, תוכן שאינו מיועד לתשובות.
NOT_IN_LLMS = {
    "/delete-account",  # מחיקת חשבון - טופס
    "/instagram",       # דף נחיתה לקמפיין
    "/markets",         # רשימת שווקים - דף ניווט
    "/course",          # דף מכירה של קורס
    "/call-tracking",   # דף מכירה למתווכים
}

# כתובות שפונקציות ה-edge מגישות מהמסד, ולכן אינן ב-sitemap הסטטי.
DYNAMIC_PREFIXES = ("/n/", "/deals/", "/property", "/afula/", "/emek-yizrael/")

errors: list[str] = []


def fail(msg: str) -> None:
    errors.append(msg)


def robots_groups(text: str) -> list[tuple[list[str], list[str]]]:
    """[(user-agents, disallows)] לפי קבוצות. שורת User-agent אחרי Disallow פותחת קבוצה."""
    groups: list[tuple[list[str], list[str]]] = []
    agents: list[str] = []
    rules: list[str] = []
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if ":" not in line:
            continue
        key, _, val = line.partition(":")
        key, val = key.strip().lower(), val.strip()
        if key == "user-agent":
            if rules:
                groups.append((agents, rules))
                agents, rules = [], []
            agents.append(val)
        elif key == "disallow" and val:
            rules.append(val)
    if agents:
        groups.append((agents, rules))
    return groups


def blocked(path: str, rule: str) -> bool:
    pattern = re.escape(rule).replace(r"\*", ".*")
    if pattern.endswith(r"\$"):
        pattern = pattern[:-2] + "$"
    return re.match(pattern, path) is not None


def site_path(url: str) -> str | None:
    parsed = urlparse(url)
    if parsed.netloc != "shuknadlan.co.il":
        return None
    return parsed.path or "/"


sitemap = (ROOT / "sitemap.xml").read_text(encoding="utf-8")
llms = (ROOT / "llms.txt").read_text(encoding="utf-8")
robots = (ROOT / "robots.txt").read_text(encoding="utf-8")
headers = (ROOT / "_headers").read_text(encoding="utf-8")

sitemap_paths = {p for u in re.findall(r"<loc>([^<]+)</loc>", sitemap) if (p := site_path(u))}
llms_links = re.findall(r"\]\((https://shuknadlan\.co\.il[^)]*)\)", llms)
llms_paths = {p for u in llms_links if (p := site_path(u))}

# 1. robots.txt לא חוסם דף ציבורי
public = {"/", "/robots.txt", "/sitemap.xml", "/llms.txt", "/llms-full.txt"} | sitemap_paths | llms_paths
for agents, rules in robots_groups(robots):
    for rule in rules:
        hit = sorted(p for p in public if blocked(p, rule))
        if hit:
            fail(f"robots.txt: Disallow: {rule} (User-agent: {', '.join(agents)}) חוסם דף ציבורי: {', '.join(hit[:3])}")

# 2. אין X-Robots-Tag על קבצי הגילוי
current = ""
for raw in headers.splitlines():
    if raw.strip().startswith("#") or not raw.strip():
        continue
    if not raw.startswith((" ", "\t")):
        current = raw.strip()
    elif "x-robots-tag" in raw.lower() and current in ("/*", "/llms.txt", "/llms-full.txt", "/robots.txt", "/sitemap.xml"):
        fail(f"_headers: X-Robots-Tag על {current} - מסתיר את קובצי הגילוי או את כל האתר")

# 3. קישורי llms.txt מגיעים לדף שקיים
for u in llms_links:
    p = site_path(u)
    if p is None or p == "/" or p in sitemap_paths or p.startswith(DYNAMIC_PREFIXES):
        continue
    if (ROOT / (p.lstrip("/") + ".html")).exists():
        fail(f"llms.txt: {p} קיים כדף אבל אינו ב-sitemap.xml - סורק שיגיע מכאן ימצא דף שהאתר לא הצהיר עליו")
    else:
        fail(f"llms.txt: {p} אינו דף סטטי ואינו נתיב דינמי ידוע (DYNAMIC_PREFIXES)")

# 4. כל דף סטטי ב-sitemap מופיע ב-llms.txt
for p in sorted(sitemap_paths):
    if p == "/" or p.startswith(DYNAMIC_PREFIXES) or p in NOT_IN_LLMS or p in llms_paths:
        continue
    fail(f"sitemap.xml: {p} אינו ב-llms.txt. הוסיפו שורה, או את הנתיב ל-NOT_IN_LLMS בבדיקה הזו עם נימוק")

if errors:
    print("check_ai_visibility: נמצאו בעיות\n")
    for e in errors:
        print(f"  - {e}")
    sys.exit(1)
print(f"check_ai_visibility: תקין ({len(sitemap_paths)} דפים ב-sitemap, {len(llms_paths)} ב-llms.txt)")
