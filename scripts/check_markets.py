#!/usr/bin/env python3
"""
‏השווקים המקומיים: חמשת המקומות שחייבים להסכים על אותה רשימה.

שוק (‏"עפולה והעמק", "חיפה והקריות") הוא יחידת התצוגה של האתר - כתובת משלו,
שם משלו, ושיוך ערים במסד. הרשימה עצמה ב-`assets/markets.js`, ומה שתלוי בה
פזור בחמישה מקומות שאף אחד מהם אינו מתלונן כשהוא לא מעודכן:

  1. ‏`assets/markets.js`              - הרשימה: slug, ‏path, ‏live, ברירת מחדל
  2. ‏`netlify/edge-functions/market-pages.ts` ‏config.path - בלעדיו הכתובת
     מגישה את הקובץ בלי שם השוק, בלי תגיות שיתוף ובלי noindex
  3. ‏`_redirects`                     - בלעדיו הכתובת היא 404
  4. ‏`sitemap.xml`                    - שוק חי חייב להיות שם, ושוק שאינו חי אסור
  5. ‏`supabase/migrations/`           - שוק בלי ערים משויכות אינו מסנן כלום

**וכלל אחד שאינו התאמה אלא שער:** שוק שאינו ברירת המחדל אינו יכול להיות
`live` כל עוד דף הבית אינו מסנן נכסים לפי שוק (שלב 2 ב-docs/regional-pages.md).
בלי זה ‎/haifa-krayot‎ היה מציג את נכסי עפולה תחת הכותרת "חיפה והקריות" -
דף שנראה תקין לגמרי ומשקר.

    python scripts/check_markets.py

יציאה 0 = הכול מסכים. יציאה 1 = פער, והפלט אומר מה להוסיף ואיפה.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MARKETS_JS = ROOT / "assets" / "markets.js"
MARKET_PAGES = ROOT / "netlify" / "edge-functions" / "market-pages.ts"
REDIRECTS = ROOT / "_redirects"
SITEMAP = ROOT / "sitemap.xml"
MIGRATIONS = ROOT / "supabase" / "migrations"
HOME_JS = ROOT / "assets" / "home.js"
SITE = "https://shuknadlan.co.il"

SLUG_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")

# ‏הסימן ש-home.js מסנן לפי שוק. שלב 2 מוסיף אותו יחד עם הסינון עצמו.
HOME_FILTER_MARK = "MARKET_FILTER"


def parse_markets() -> list[dict]:
    """‏האובייקטים שב-MARKETS, לפי השדות שהבדיקה צריכה."""
    text = MARKETS_JS.read_text(encoding="utf-8")
    body = text.split("var MARKETS = [", 1)[1].split("];", 1)[0]
    out = []
    for chunk in body.split("slug:")[1:]:
        def field(name: str) -> str | None:
            m = re.search(r"\b%s:\s*('([^']*)'|true|false)" % name, "slug:" + chunk)
            if not m:
                return None
            return m.group(2) if m.group(2) is not None else m.group(1)
        slug = re.match(r"\s*'([^']+)'", chunk)
        out.append({
            "slug": slug.group(1) if slug else "",
            "label": field("label"),
            "path": field("path"),
            "live": field("live") == "true",
            "default": field("isDefault") == "true",
        })
    return out


def edge_paths() -> list[str]:
    text = MARKET_PAGES.read_text(encoding="utf-8")
    m = re.search(r"path:\s*\[([^\]]*)\]", text.split("export const config", 1)[-1])
    return re.findall(r'"([^"]+)"', m.group(1)) if m else []


def redirect_targets() -> dict[str, str]:
    rules = {}
    for line in REDIRECTS.read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if len(parts) >= 3 and not line.lstrip().startswith("#") and parts[2] == "200":
            rules[parts[0]] = parts[1]
    return rules


def main() -> int:
    problems: list[str] = []
    markets = parse_markets()
    if not markets:
        print("✗ לא נמצאו שווקים ב-assets/markets.js - משהו בבדיקה עצמה שבור.")
        return 1

    slugs = [m["slug"] for m in markets]
    if len(set(slugs)) != len(slugs):
        problems.append("‏אותו slug מופיע פעמיים ב-assets/markets.js.")
    for m in markets:
        if not SLUG_RE.match(m["slug"]):
            problems.append("‏%r אינו slug תקין (אותיות לטיניות קטנות, ספרות ומקף)." % m["slug"])

    defaults = [m for m in markets if m["default"]]
    if len(defaults) != 1:
        problems.append("‏צריך בדיוק שוק אחד עם isDefault: true (יש %d)." % len(defaults))
    for m in defaults:
        if m["path"] != "/" or not m["live"]:
            problems.append("‏שוק ברירת המחדל (%s) חייב path: '/' ו-live: true." % m["slug"])

    paths = set(edge_paths())
    rules = redirect_targets()
    sitemap = SITEMAP.read_text(encoding="utf-8")
    migrations = "\n".join(p.read_text(encoding="utf-8") for p in sorted(MIGRATIONS.glob("*.sql")))
    home_filters = HOME_FILTER_MARK in HOME_JS.read_text(encoding="utf-8")

    for m in markets:
        slug = m["slug"]
        if "'%s'" % slug not in migrations:
            problems.append(
                "‏%s: אין מיגרציה שמשייכת לו ערים (cities.market_slug). שוק בלי ערים אינו מסנן כלום." % slug
            )
        if m["default"]:
            continue

        path = m["path"] or ""
        if path != "/" + slug:
            problems.append("‏%s: הכתובת צריכה להיות /%s (יש %r)." % (slug, slug, path))
        if path not in paths:
            problems.append(
                "‏%s: ‏%s חסר ב-config.path של market-pages.ts - הדף יוצא בלי שם השוק ובלי noindex." % (slug, path)
            )

        want = "/index" if m["live"] else "/market-soon"
        got = rules.get(path)
        if got is None:
            problems.append("‏%s: אין שורה ב-_redirects - הוסיפו: %s    %s    200" % (slug, path, want))
        elif got.replace(".html", "") not in ({"/index", "/"} if m["live"] else {"/market-soon"}):
            problems.append(
                "‏%s: ‏_redirects מגיש את %s מ-%s, וה-live שלו %s - היעד צריך להיות %s."
                % (slug, path, got, "true" if m["live"] else "false", want)
            )

        loc = "<loc>%s%s</loc>" % (SITE, path)
        if m["live"] and loc not in sitemap:
            problems.append("‏%s: שוק חי שאינו ב-sitemap.xml - גוגל לא תדע שהוא קיים." % slug)
        if not m["live"] and loc in sitemap:
            problems.append("‏%s: שוק שעוד לא נפתח נמצא ב-sitemap.xml - הוא מוגש ב-noindex." % slug)

        if m["live"] and not home_filters:
            problems.append(
                "‏%s: live: true, אבל דף הבית עוד אינו מסנן נכסים לפי שוק (אין %s ב-assets/home.js).\n"
                "    ‏%s היה מציג את נכסי עפולה תחת השם של השוק. זה שלב 2 ב-docs/regional-pages.md."
                % (slug, HOME_FILTER_MARK, path)
            )

    known = {m["path"] for m in markets if not m["default"]}
    for extra in sorted(paths - known):
        problems.append("‏%s ב-config.path של market-pages.ts ואין שוק כזה ב-assets/markets.js." % extra)

    if problems:
        print("✗ השווקים אינם מסכימים:\n")
        for p in problems:
            print("  • " + p)
        print("\nהפרטים: docs/regional-pages.md")
        return 1

    live = sum(1 for m in markets if m["live"])
    print("✓ %d שווקים (%d חיים): הרשימה, market-pages.ts, ‏_redirects, ‏sitemap.xml והמיגרציות מסכימים." % (len(markets), live))
    return 0


if __name__ == "__main__":
    sys.exit(main())
