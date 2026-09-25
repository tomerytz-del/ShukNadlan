#!/usr/bin/env python3
"""
‏בדיקה שלכל דף באתר יש כתובת קנונית אחת, ושהוא נגיש לגוגל.

## הבעיה שהבדיקה הזו נולדה ממנה

‏Search Console שלח הודעה: "יש סיבה חדשה לכך שאי אפשר להוסיף לאינדקס את
הדפים באתר שלך — ‎robots.txt‎ נחסם על ידי". זו משפחה שלמה של כשלים שיש
להם תכונה אחת משותפת: **הדף נטען, נראה תקין, ופשוט אינו מופיע בגוגל.**
אין שגיאה בקונסול, אין דבר שנשבר, ואין מי שיספר.

שלושה מהם נמצאו בפועל באתר הזה:

  ‏1. ‎developer.html‎ — דף ציבורי שלם (חברה יזמית, ‎?slug=‎) שלא היה
     ב-‎sitemap.xml‎, לא ב-‎sitemap.ts‎ ולא ב-‎og-tags.ts‎. הקישורים אליו
     נבנים ב-JS ב-‎projects.html‎ וב-‎project.html‎, כלומר סורק אינו יכול
     לעקוב אחריהם — **גוגל לא ידעה שהדף קיים.**
  ‏2. ‏אף אחד מ-18 הדפים הסטטיים לא נשא ‎canonical‎, בעוד Netlify מגיש כל
     אחד מהם בשתי כתובות (‏‎/about‎ ו-‎/about.html‎). זה תוכן משוכפל, וגוגל
     בוחרת לבד איזו כתובת לאנדקס.
  ‏3. פרמטרי הסינון נחסמו ב-‎robots.txt‎ במקום להצהיר על ‎canonical‎ — וכך
     הכתובות האלה נדחקו לדוח "נחסם על ידי robots.txt" במקום להתאחד לדף.

## מה נבדק

  ‏1. **כל דף בשורש שייך למחלקה אחת** — דף פירוט, דף סטטי ציבורי, או דף
     פרטי. דף חדש שאינו מופיע ב-‎DETAIL‎ או ב-‎PRIVATE‎ נחשב סטטי ציבורי,
     ואז כל שאר הבדיקות חלות עליו. כלומר דף חדש **מכריח החלטה**.
  ‏2. **דף סטטי ציבורי נושא ‎canonical‎ אחת בלבד**, בתוך ה-‎<head>‎,
     ומצביעה על הכתובת שלו עצמו בצורה בלי הסיומת.
  ‏3. **דף פירוט אינו נושא ‎canonical‎ סטטית כלל.** ראו הנימוק למטה.
  ‏4. **דף סטטי ציבורי מופיע ב-‎sitemap.xml‎**, ודף פרטי **אינו** מופיע בו.
  ‏5. **‏robots.txt אינו חוסם** דף סטטי ציבורי ואף לא דף פירוט.
  ‏6. **דף פרטי מוגן** — חסום ב-‎robots.txt‎ או נושא ‎noindex‎.
  ‏7. **דף פירוט רשום בשתי פונקציות ה-edge** — ב-‎SOURCES‎ של ‎sitemap.ts‎
     (אחרת גוגל לא תדע שהרשומות קיימות) וב-‎config.path‎ של ‎og-tags.ts‎
     (אחרת אין לו ‎canonical‎ בכלל).
  ‏8. **קישור פנימי מצביע על הצורה בלי הסיומת** — ‎/about‎ ולא
     ‎about.html‎. ראו הנימוק למטה.

## למה קישור פנימי חייב להיות בלי הסיומת

‏Netlify מגיש כל דף בשתי צורות **ומפנה את בעלת הסיומת לחסרה** (‏301).
קישור ל-‎about.html‎ עובד, נראה תקין, ומשלם סיבוב רשת נוסף בכל לחיצה —
ובשביל גוגל הוא כתובת שכל מה שיש בה הוא הפניה. כך כל האתר נסרק פעמיים:
פעם בצורה שמפנה ופעם ביעד.

זה מה שהחזיר את ההודעה **"הדף מפנה לכתובת אתר אחרת"** מ-Search Console:
‏1,187 הקישורים הפנימיים באתר הצביעו על הצורה עם הסיומת, בעוד ה-
‎canonical‎ וה-‎sitemap‎ הצביעו על הצורה שבלעדיה. הם הומרו, והבדיקה הזו
היא מה ששומר על זה - דף חדש שייכתב בהרגל הישן ייתפס כאן.

## למה דף פירוט אינו נושא תגית סטטית

זו הנקודה הלא אינטואיטיבית כאן, והיא הסיבה שהבדיקה אוסרת מה שנראה כמו
שיפור. ‎property.html‎ הוא קובץ אחד שמגיש את כל הנכסים לפי ‎?id=‎, ולכן
תגית סטטית בו יכולה להצהיר רק על ‎/property‎ — בלי הפרמטר.

‏`netlify/edge-functions/og-tags.ts` מזריקה ‎canonical‎ נכונה מהמסד בכל
בקשה, ובכל מסלול כשל שלה (‏Supabase איטי, נכס שאינו ‎active‎, כל ‎catch‎
בקובץ) הדף יוצא **כמו שהוא**. עם תגית סטטית בתוכו, תקלה של דקה בשרת
הייתה מצהירה על ‎/property‎ כמקור של כל הנכסים — כלומר מוחקת אותם
מהאינדקס. בלעדיה, אותו כשל פשוט משאיר דף בלי ‎canonical‎.

## הרצה

    python scripts/check_canonical.py        # בדיקה
    python scripts/check_canonical.py --fix  # שתילת התגית בדף סטטי שחסר

יציאה 0 = הכול תקין. יציאה 1 = יש ממצא, והפלט מראה מה להוסיף ואיפה.

התיעוד: ‎docs/security-headers.md‎ ו-‎docs/sitemap.md‎.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://shuknadlan.co.il"

# ‏דפי הפירוט: קובץ אחד שמגיש רשומות מהמסד לפי ?id= או ?slug=. ה-canonical
# שלהם מוזרק בשרת, ולכן אין להם תגית סטטית — ראו הנימוק בראש הקובץ.
DETAIL = {
    "property",
    "agency",
    "agent",
    "project",
    "developer",
    "professional",
    "article",
}

# ‏דפים שאינם אמורים להיות בגוגל: האזור האישי, החתימה, וכתובות עם טוקן.
# כל אחד מהם חסום ב-robots.txt או נושא noindex, והם אינם ב-sitemap.
PRIVATE = {
    "crm",
    "developer-crm",
    "professional-manage",
    "sign",
    "review-request",
    "neighborhood-boundary",
    "agreement",
    # ‏"נפתחים בקרוב" של שוק שעוד לא חי. מוגש תחת ‎/haifa-krayot‎ וחבריו,
    # ונושא noindex כי דף עם אפס נכסים מזיק לאתר (docs/regional-pages.md).
    "market-soon",
}

TAG = '<link rel="canonical" href="%s">'

BLOCK = (
    "<!-- ‏הכתובת הקנונית של הדף. ‏Netlify מגיש כל דף בשתי צורות\n"
    "     (‏/about ו-/about.html), ופרמטרי סינון מייצרים עוד — והתגית הזו\n"
    "     אומרת לגוגל איזו מהן לאנדקס. הפרטים: docs/security-headers.md -->\n"
    + TAG
)

CANONICAL = re.compile(r'<link\s[^>]*\brel="canonical"[^>]*>', re.IGNORECASE)
HREF = re.compile(r'\bhref="([^"]*)"', re.IGNORECASE)
NOINDEX = re.compile(r'<meta\s+name="robots"\s+content="[^"]*noindex', re.IGNORECASE)

# ‏אותו עוגן של check_search_console: התגית נכנסת מיד אחרי אימות הבעלות,
# שמובטח להיות בכל דף על ידי אותה בדיקה.
ANCHOR = re.compile(r'<meta\s+name="google-site-verification"\s+content="[^"]*"\s*/?>')


def page_url(name: str) -> str:
    """‏הכתובת הקנונית של דף לפי שם הקובץ, בצורה שבה Netlify מגיש אותו."""
    return SITE + "/" if name == "index" else SITE + "/" + name


# ---------- ‏קישורים פנימיים: הצורה בלי הסיומת ----------

# ‏שלוש הצורות שבהן כתובת פנימית נכתבת בפועל: מאפיין ב-HTML (גם כשהוא
# בתוך מחרוזת ב-JS ולכן עם לוכסן הפוך), ליטרל שמתחיל בכתובת, וכתובת
# שנבנית מבסיס (‏`${SITE}/property.html`).
def link_patterns(names: list[str]) -> list[re.Pattern[str]]:
    n = "|".join(re.escape(x) for x in names)
    return [
        re.compile(r'(?:href|action)=\\?["\'](?:\./|/)?(?:' + n + r")\.html"),
        re.compile(r'["\'`](?:\./|/)?(?:' + n + r")\.html"),
        re.compile(r"\}/(?:" + n + r")\.html"),
    ]


def code_lines(text: str):
    """‏(מספר שורה, שורה) לכל שורה שאינה הערה.

    ההערות בריפו הזה מזכירות שמות קבצים כתיעוד (‏"משוכפל מ-crm.html"),
    והן אינן קישורים. המעקב פשוט בכוונה — בדיקה שמדלגת על יותר מדי
    מפספסת ממצא, בדיקה שמדלגת על פחות מדי צועקת על תיעוד.
    """
    block = False          # ‏/* … */ או <!-- … -->
    for i, raw in enumerate(text.splitlines(), 1):
        line, stripped = raw, raw.strip()
        if block:
            if "*/" in line or "-->" in line:
                block = False
                line = line.split("*/")[-1].split("-->")[-1]
            else:
                continue
        if stripped.startswith("//"):
            continue
        for opener, closer in (("/*", "*/"), ("<!--", "-->")):
            if opener in line and closer not in line.split(opener, 1)[1]:
                block = True
                line = line.split(opener, 1)[0]
        yield i, line


def check_links(pages: list[Path]) -> list[str]:
    """קישור פנימי שעדיין מצביע על הצורה עם הסיומת."""
    names = sorted(p.stem for p in pages)
    pats = link_patterns(names)
    targets = (
        pages
        + sorted((ROOT / "assets").glob("*.js"))
        + sorted((ROOT / "supabase" / "functions").rglob("*.ts"))
    )
    found: list[str] = []
    for path in targets:
        text = path.read_text(encoding="utf-8")
        for num, line in code_lines(text):
            if any(p.search(line) for p in pats):
                rel = path.relative_to(ROOT)
                found.append("%s:%d — %s" % (rel, num, line.strip()[:70]))
    return found


def head_of(text: str) -> str:
    end = re.search(r"</head\s*>", text, re.IGNORECASE)
    return text[: end.start()] if end else text


# ---------- ‏robots.txt ----------


def robots_rules() -> list[str]:
    """‏שורות ה-Disallow של הקבוצה ‎User-agent: *‎."""
    text = (ROOT / "robots.txt").read_text(encoding="utf-8")
    rules: list[str] = []
    in_star = False
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        key, _, value = line.partition(":")
        key = key.strip().lower()
        value = value.strip()
        if key == "user-agent":
            in_star = value == "*"
        elif key == "disallow" and in_star and value:
            rules.append(value)
    return rules


def robots_blocks(rules: list[str], path: str) -> str | None:
    """‏האם ‎path‎ חסום, ואם כן — על ידי איזו שורה.

    ‏תחביר גוגל: התאמת **תחילית** לנתיב (כולל ה-query), ‎*‎ הוא כל רצף,
    ו-‎$‎ בסוף התבנית מעגן את הסוף. ‏re.escape על כל השאר, כדי שנקודה
    ב-‎/about.html‎ לא תתאים לכל תו.
    """
    for rule in rules:
        body, anchored = (rule[:-1], True) if rule.endswith("$") else (rule, False)
        pattern = "".join(".*" if c == "*" else re.escape(c) for c in body)
        if re.match(pattern + ("$" if anchored else ""), path):
            return rule
    return None


# ---------- ‏sitemap.xml ו-edge ----------


def sitemap_locs() -> list[str]:
    text = (ROOT / "sitemap.xml").read_text(encoding="utf-8")
    return [m.strip() for m in re.findall(r"<loc>([^<]*)</loc>", text)]


def edge_registered(page: str) -> list[str]:
    """‏מה חסר לדף פירוט בשתי פונקציות ה-edge."""
    missing: list[str] = []

    sitemap_ts = (ROOT / "netlify/edge-functions/sitemap.ts").read_text(encoding="utf-8")
    if not re.search(r'page:\s*"%s"' % re.escape(page), sitemap_ts):
        missing.append(
            "אינו ב-SOURCES של netlify/edge-functions/sitemap.ts — הרשומות\n"
            "            שלו לא ייכנסו ל-sitemap, וגוגל לא תדע שהן קיימות"
        )

    og_ts = (ROOT / "netlify/edge-functions/og-tags.ts").read_text(encoding="utf-8")
    config = og_ts.split("export const config")[-1]
    if '"/%s"' % page not in config:
        missing.append(
            "אינו ב-config.path של netlify/edge-functions/og-tags.ts — ולכן\n"
            "            אין לו canonical ואין לו תגיות שיתוף בכלל"
        )

    return missing


# ---------- הבדיקה ----------


def check_page(path: Path, rules: list[str], locs: list[str]) -> list[str]:
    name = path.stem
    text = path.read_text(encoding="utf-8")
    found = CANONICAL.findall(head_of(text))
    problems: list[str] = []

    if name in PRIVATE:
        blocked = robots_blocks(rules, "/" + name)
        if not blocked and not NOINDEX.search(head_of(text)):
            problems.append(
                "דף פרטי שאינו חסום ב-robots.txt ואינו נושא noindex.\n"
                "            אחד מהשניים חייב להיות שם."
            )
        if page_url(name) in locs:
            problems.append("דף פרטי שמופיע ב-sitemap.xml. יש למחוק אותו משם.")
        return problems

    if name in DETAIL:
        if found:
            problems.append(
                "נושא canonical סטטית, ודף פירוט אינו יכול לשאת אחת:\n"
                "            %s\n"
                "            היא מצהירה על /%s בלי הפרמטר, וכשל זמני של\n"
                "            og-tags.ts היה מאחד אליה את כל הרשומות.\n"
                "            הנימוק המלא: בראש scripts/check_canonical.py"
                % (found[0], name)
            )
        problems.extend(edge_registered(name))
    else:
        want = page_url(name)
        if not found:
            problems.append("אין canonical. צריך: %s" % (TAG % want))
        elif len(found) > 1:
            problems.append(
                "יש %d תגיות canonical. גוגל מתעלמת משתיהן, וזה גרוע\n"
                "            מאפס תגיות." % len(found)
            )
        else:
            href = HREF.search(found[0])
            got = href.group(1) if href else ""
            if got != want:
                problems.append(
                    "ה-canonical מצביעה על כתובת אחרת:\n"
                    "            בדף:  %s\n"
                    "            צריך: %s" % (got or "(אין href)", want)
                )

        if CANONICAL.search(text) and not CANONICAL.search(head_of(text)):
            problems.append("התגית נמצאת מחוץ ל-<head>. גוגל מתעלמת ממנה שם.")

        if want not in locs:
            problems.append(
                "אינו ב-sitemap.xml. דף ציבורי נוסף לקובץ ידנית:\n"
                "            <loc>%s</loc>" % want
            )

    blocked = robots_blocks(rules, "/" + name)
    if blocked:
        problems.append(
            "חסום ב-robots.txt בשורה `Disallow: %s`, וזו בדיוק הסיבה\n"
            "            שגוגל מדווחת עליו כ\"נחסם על ידי robots.txt\"." % blocked
        )

    return problems


def check_sitemap(pages: set[str], locs: list[str]) -> list[str]:
    """‏כתובת ב-sitemap שאין לה דף סטטי — שארית מדף שנמחק או שגיאת הקלדה."""
    known = {page_url(n) for n in pages - DETAIL - PRIVATE}
    return [
        "<loc>%s</loc> — אין דף סטטי כזה בשורש" % loc
        for loc in locs
        if loc not in known and "?" not in loc  # עמודי התוצאות נבדקים בנפרד
    ]


# ---------- ‏14 עמודי התוצאות ----------
#
# ‏HTML אחד (‏index.html) מגיש אותם לפי הפרמטרים, ולכן אין להם קובץ משלהם
# ואי אפשר לבדוק אותם כמו דף. מה שכן אפשר לבדוק הוא שהשלושה מסכימים:
#
#   ‏1. SEARCH_PAGES ב-netlify/edge-functions/search-pages.ts — מי שמזריק
#      את הכותרת, התיאור וה-canonical.
#   ‏2. ‏sitemap.xml — איך גוגל יודעת שהם קיימים.
#   ‏3. בלוק "חיפושים פופולריים" בפוטר — הקישור שסורק עוקב אחריו.
#
# ‏**צירוף שחסר באחד מהם נכשל בשקט**, וכל צורה של הכשל שונה: בלי (1) הוא
# מצהיר על / ולא יתאנדקס לעולם; בלי (2) גוגל תגיע אליו רק דרך קישור; בלי
# (3) הוא יתום שאין אליו קישור מהאתר. לכן שלושתם נבדקים יחד.

SEARCH_TS = ROOT / "netlify" / "edge-functions" / "search-pages.ts"
SEARCH_QUERY = re.compile(r'^\s*query:\s*"([^"]+)"', re.MULTILINE)
FOOTER_LINK = re.compile(r'href="/\?([^"]+)"')


def query_key(query: str) -> str:
    """‏אותו נרמול שבפונקציה: זוגות מפוענחים וממוינים, בלי פרמטרי מעקב."""
    from urllib.parse import parse_qsl

    pairs = [
        "%s=%s" % (k, v.strip())
        for k, v in parse_qsl(query.replace("&amp;", "&"), keep_blank_values=False)
        if v.strip() and k != "src" and not k.startswith("utm_")
    ]
    return "&".join(sorted(pairs))


def search_pages() -> list[str]:
    """‏מפתחות הצירופים שברשימה שבפונקציה, לפי סדר הופעתם."""
    if not SEARCH_TS.exists():
        return []
    return [query_key(q) for q in SEARCH_QUERY.findall(SEARCH_TS.read_text(encoding="utf-8"))]


def check_search_pages(pages: list[Path], locs: list[str]) -> list[str]:
    listed = search_pages()
    problems: list[str] = []
    if not listed:
        return ["‏search-pages.ts לא נמצא או שאין בו SEARCH_PAGES — עמודי התוצאות אינם מוזרקים."]

    known = set(listed)
    if len(known) != len(listed):
        problems.append("‏אותו צירוף מופיע פעמיים ב-SEARCH_PAGES.")

    in_sitemap = {query_key(loc.split("?", 1)[1]) for loc in locs if "?" in loc}
    for key in sorted(known - in_sitemap):
        problems.append("‏/?%s ברשימה שבפונקציה ואינו ב-sitemap.xml — גוגל לא תדע שהוא קיים." % key)
    for key in sorted(in_sitemap - known):
        problems.append("‏/?%s ב-sitemap.xml ואינו ברשימה שבפונקציה — הוא יצהיר על / ולא יתאנדקס." % key)

    linked: set[str] = set()
    for path in pages:
        for query in FOOTER_LINK.findall(path.read_text(encoding="utf-8")):
            linked.add(query_key(query))
    for key in sorted(known - linked):
        problems.append("‏/?%s ברשימה שבפונקציה ואין אליו קישור באף דף — עמוד יתום." % key)
    for key in sorted(linked - known):
        problems.append(
            "‏/?%s מקושר מהפוטר ואינו ברשימה שבפונקציה — הוא מתאחד ל-/ ולא יתאנדקס." % key
        )
    return problems


def fix_page(path: Path) -> bool:
    """שתילת התגית בדף סטטי ציבורי שחסר, או יישור כתובת שגויה."""
    name = path.stem
    if name in DETAIL or name in PRIVATE:
        return False

    text = path.read_text(encoding="utf-8")
    tag = TAG % page_url(name)

    if CANONICAL.search(text):
        fixed = CANONICAL.sub(tag, text, count=1)
    else:
        match = ANCHOR.search(text)
        if not match:
            return False
        fixed = text[: match.end()] + "\n" + (BLOCK % page_url(name)) + text[match.end():]

    if fixed == text:
        return False
    path.write_text(fixed, encoding="utf-8")
    return True


def main(argv: list[str]) -> int:
    pages = sorted(ROOT.glob("*.html"))
    if not pages:
        print("לא נמצאו דפי HTML בשורש — משהו בבדיקה עצמה שבור.")
        return 1

    if "--fix" in argv:
        fixed = [p.name for p in pages if fix_page(p)]
        print("תוקנו %d דפים%s" % (len(fixed), (": " + ", ".join(fixed)) if fixed else ""))
        print("הריצו את הבדיקה שוב כדי לוודא.")
        return 0

    rules = robots_rules()
    locs = sitemap_locs()

    failed = {p: probs for p in pages if (probs := check_page(p, rules, locs))}
    for path, problems in failed.items():
        print("✗ %s" % path.name)
        for problem in problems:
            print("      • %s" % problem)

    stale = check_sitemap({p.stem for p in pages}, locs)
    if stale:
        print("✗ sitemap.xml")
        for item in stale:
            print("      • %s" % item)

    searches = check_search_pages(pages, locs)
    if searches:
        print("✗ עמודי התוצאות (‏חיפושים פופולריים)")
        for item in searches:
            print("      • %s" % item)

    links = check_links(pages)
    if links:
        print("✗ קישורים פנימיים לצורה עם הסיומת (‏Netlify מפנה אותה ל-301)")
        for item in links[:20]:
            print("      • %s" % item)
        if len(links) > 20:
            print("      • ... ועוד %d" % (len(links) - 20))

    if failed or stale or links or searches:
        print(
            "\nכל אחד מהממצאים האלה נראה בדפדפן כמו דף תקין לגמרי — הוא פשוט\n"
            "אינו מופיע בגוגל, ואת זה מגלים מהודעה של Search Console חודש\n"
            "אחרי. תגית חסרה בדף סטטי נשתלת אוטומטית (קישור פנימי מתוקן ביד,\n"
            "והצורה הנכונה היא /about ולא about.html):\n\n"
            "    python scripts/check_canonical.py --fix\n\n"
            "התיעוד: docs/security-headers.md, docs/sitemap.md"
        )
        return 1

    static = len(pages) - len(DETAIL) - len(PRIVATE)
    print(
        "✓ %d דפים סטטיים נושאים canonical ונמצאים ב-sitemap, %d דפי פירוט\n"
        "  רשומים בשתי פונקציות ה-edge, %d דפים פרטיים מוגנים, %d עמודי תוצאות\n"
        "  מוזרקים ומקושרים, וכל הקישורים הפנימיים בלי הסיומת."
        % (static, len(DETAIL), len(PRIVATE), len(search_pages()))
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
