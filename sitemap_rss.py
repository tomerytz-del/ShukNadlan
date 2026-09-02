#!/usr/bin/env python3
"""
מפת האתר (sitemap.xml) ופיד הכתבות (rss.xml).

הבעיה שזה פותר
--------------
האתר סטטי, אבל רוב הכתובות שלו אינן: כל נכס, כתבה, משרד תיווך וסוכן/ת חיים
כשורה ב-Supabase ומוצגים דרך ‏`property.html?id=…`‏, ‏`article.html?slug=…`‏
וכדומה. גוגל לא מגלה כתובות כאלה בעצמו — אין קישור סטטי אליהן משום מקום —
ולכן עד היום נסרקו בפועל רק העמודים הקבועים.

המנגנון: הסקריפט הזה קורא את המסד, מייצר את שני הקבצים, ומחזיר קוד יציאה
שאומר אם השתנה משהו. ה-workflow שמריץ אותו
(‏`.github/workflows/sitemap_rss.yml`‏) מגיש אותם ל-main רק כשבאמת השתנו,
ומשם ‏Netlify מפרסם אותם כמו כל קובץ אחר.

מה נכנס לכל קובץ
----------------
* **sitemap.xml** — העמודים הקבועים, כל נכס פעיל, כל כתבה מפורסמת, כל משרד
  תיווך, כל סוכן/ת פעיל/ה וכל כרטיסיית בעל/ת מקצוע פעילה. עמודי אפליקציה
  (‏crm, טפסי הרשמה, מסכי ניהול, בקשת חוות דעת) **אינם** נכנסים: הם לא תוכן,
  והופעה שלהם בגוגל היא מטרד ולא רווח.
* **rss.xml** — הכתבות המפורסמות בלבד, החדשה בראש. זה הפיד שקוראים בו
  עוקבים, וגם מה ש-Google News ו-Feedly מצפים לו.

הרצה:
    python sitemap_rss.py                 # כתיבה לקבצים
    python sitemap_rss.py --dry-run       # להדפיס מה היה נכתב
    python sitemap_rss.py --check         # קוד יציאה 1 אם יש שינוי, בלי לכתוב
"""

from __future__ import annotations

import argparse
import html
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote
from xml.sax.saxutils import escape as xml_escape

from supabase import Client, create_client

LOG = logging.getLogger("sitemap")

SITE_URL = os.environ.get("SITE_URL", "https://shuknadlan.co.il").rstrip("/")
ROOT = Path(__file__).resolve().parent
SITEMAP_PATH = ROOT / "sitemap.xml"
RSS_PATH = ROOT / "rss.xml"

# תקרה: ‏sitemap אחד מוגבל ל-50,000 כתובות ול-50MB. המלאי כאן רחוק מזה, אבל
# הגבול קיים כדי שגידול פתאומי ייחתך במקום לייצר קובץ פסול.
MAX_URLS = 45_000
RSS_ITEMS = 40

# ---------------------------------------------------------------------------
# העמודים הקבועים. ‏priority ו-changefreq הם רמז ולא הוראה, אבל הם מבדילים
# בין דף הבית לבין הצהרת הנגישות, ועולים כלום.
# ---------------------------------------------------------------------------
STATIC_PAGES: list[tuple[str, str, str]] = [
    ("index.html", "hourly", "1.0"),
    ("agencies.html", "daily", "0.8"),
    ("articles.html", "daily", "0.8"),
    ("faq.html", "monthly", "0.7"),
    ("ethics-code.html", "monthly", "0.6"),
    ("agency-signup.html", "monthly", "0.5"),
    ("professional-signup.html", "monthly", "0.5"),
    ("en/index.html", "weekly", "0.6"),
    ("ru/index.html", "weekly", "0.6"),
    ("terms.html", "yearly", "0.3"),
    ("privacy.html", "yearly", "0.3"),
    ("cookies.html", "yearly", "0.3"),
    ("accessibility.html", "yearly", "0.3"),
    ("advertising-terms.html", "yearly", "0.3"),
]


def client() -> Client:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY")
    if not url or not key:
        raise SystemExit("חסרים SUPABASE_URL ו-SUPABASE_SERVICE_ROLE_KEY")
    return create_client(url, key)


def iso_day(value: str | None) -> str | None:
    """‏YYYY-MM-DD מתוך חותמת זמן של Postgres. ‏None כשאין תאריך שפוי."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).strftime("%Y-%m-%d")
    except ValueError:
        return None


def rfc822(value: str | None) -> str:
    """‏RSS דורש תאריך RFC-822; ‏feedparser וגוגל שניהם קפדניים בזה."""
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        dt = datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S +0000")


def loc(path: str, **params: str) -> str:
    """כתובת מלאה. הפרמטרים מקודדים — ‏slug בעברית הוא המקרה הרגיל כאן."""
    url = f"{SITE_URL}/{path.lstrip('/')}"
    if params:
        query = "&".join(f"{k}={quote(str(v), safe='')}" for k, v in params.items())
        url = f"{url}?{query}"
    # ‏& בתוך XML חייב להיות ישות, אחרת הקובץ פסול והסורק זורק אותו כולו
    return xml_escape(url)


# ---------------------------------------------------------------------------
# שליפות. כל אחת מחזירה רשימת (path, params, lastmod) ומבודדת כישלון לעצמה:
# טבלה אחת שנופלת לא אמורה למחוק את כל שאר הכתובות מהמפה.
# ---------------------------------------------------------------------------
def rows(sb: Client, table: str, select: str, limit: int = 5000, **filters) -> list[dict]:
    try:
        query = sb.table(table).select(select)
        for column, value in filters.items():
            query = query.eq(column, value)
        return query.limit(limit).execute().data or []
    except Exception as exc:  # noqa: BLE001 — כל כישלון כאן הוא "בלי הטבלה הזו"
        LOG.warning("שליפת %s נכשלה, ממשיכים בלעדיה: %s", table, exc)
        return []


def collect_urls(sb: Client) -> list[tuple[str, str | None, str, str]]:
    """(url, lastmod, changefreq, priority)"""
    out: list[tuple[str, str | None, str, str]] = []
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    for path, freq, priority in STATIC_PAGES:
        out.append((loc(path), today, freq, priority))

    for a in rows(sb, "articles", "slug, id, updated_at, published_at", status="published"):
        key = a.get("slug") or a.get("id")
        if key:
            out.append((loc("article.html", slug=key),
                        iso_day(a.get("updated_at") or a.get("published_at")), "monthly", "0.7"))

    for p in rows(sb, "properties", "id, updated_at, created_at", status="active"):
        if p.get("id"):
            out.append((loc("property.html", id=p["id"]),
                        iso_day(p.get("updated_at") or p.get("created_at")), "weekly", "0.9"))

    for a in rows(sb, "agencies", "slug, updated_at, created_at"):
        if a.get("slug"):
            out.append((loc("agency.html", slug=a["slug"]),
                        iso_day(a.get("updated_at") or a.get("created_at")), "weekly", "0.7"))

    for m in rows(sb, "agency_members", "slug, updated_at, created_at", active=True):
        if m.get("slug"):
            out.append((loc("agent.html", slug=m["slug"]),
                        iso_day(m.get("updated_at") or m.get("created_at")), "weekly", "0.6"))

    for ad in rows(sb, "ad_placements", "slug, created_at", status="active"):
        if ad.get("slug"):
            out.append((loc("professional.html", slug=ad["slug"]),
                        iso_day(ad.get("created_at")), "monthly", "0.5"))

    if len(out) > MAX_URLS:
        LOG.warning("‏%d כתובות — נחתך ל-%d", len(out), MAX_URLS)
        out = out[:MAX_URLS]
    return out


def build_sitemap(entries: list[tuple[str, str | None, str, str]]) -> str:
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for url, lastmod, freq, priority in entries:
        lines.append("  <url>")
        lines.append(f"    <loc>{url}</loc>")
        if lastmod:
            lines.append(f"    <lastmod>{lastmod}</lastmod>")
        lines.append(f"    <changefreq>{freq}</changefreq>")
        lines.append(f"    <priority>{priority}</priority>")
        lines.append("  </url>")
    lines.append("</urlset>")
    return "\n".join(lines) + "\n"


def build_rss(sb: Client) -> str:
    articles = rows(sb, "articles",
                    "slug, id, title, subtitle, category, cover_url, author_name, published_at",
                    limit=RSS_ITEMS, status="published")
    articles.sort(key=lambda a: str(a.get("published_at") or ""), reverse=True)
    articles = articles[:RSS_ITEMS]

    built = rfc822(datetime.now(timezone.utc).isoformat())
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
             "  <channel>",
             "    <title>שוק הנדל״ן של עפולה והסביבה — כתבות ובלוגים</title>",
             f"    <link>{SITE_URL}/articles.html</link>",
             "    <description>ניתוחי שוק, מדריכים וחדשות נדל״ן מעפולה ומעמק יזרעאל.</description>",
             "    <language>he-IL</language>",
             f"    <lastBuildDate>{built}</lastBuildDate>",
             f'    <atom:link href="{SITE_URL}/rss.xml" rel="self" type="application/rss+xml"/>']

    for a in articles:
        key = a.get("slug") or a.get("id")
        if not key:
            continue
        url = loc("article.html", slug=key)
        title = xml_escape(str(a.get("title") or "")).strip() or "ללא כותרת"
        # ‏CDATA היה נוח יותר, אבל תיאור עם ‎]]>‎ בתוכו היה שובר את הפיד;
        # בריחה רגילה עובדת בכל קורא ואין לה מקרה קצה.
        summary = xml_escape(html.unescape(str(a.get("subtitle") or "")).strip())
        lines += ["    <item>",
                  f"      <title>{title}</title>",
                  f"      <link>{url}</link>",
                  f"      <guid isPermaLink=\"true\">{url}</guid>",
                  f"      <pubDate>{rfc822(a.get('published_at'))}</pubDate>"]
        if summary:
            lines.append(f"      <description>{summary}</description>")
        if a.get("category"):
            lines.append(f"      <category>{xml_escape(str(a['category']))}</category>")
        if a.get("author_name"):
            lines.append(f"      <author>{xml_escape(str(a['author_name']))}</author>")
        lines.append("    </item>")

    lines += ["  </channel>", "</rss>"]
    return "\n".join(lines) + "\n"


def write_if_changed(path: Path, content: str, *, dry_run: bool) -> bool:
    """מחזיר True אם התוכן שונה ממה שכבר בקובץ."""
    current = path.read_text(encoding="utf-8") if path.exists() else ""
    if current == content:
        LOG.info("‏%s — ללא שינוי", path.name)
        return False
    if dry_run:
        LOG.info("‏%s — היה משתנה (%d תווים)", path.name, len(content))
        return True
    path.write_text(content, encoding="utf-8")
    LOG.info("‏%s — נכתב (%d תווים)", path.name, len(content))
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="מפת אתר ופיד כתבות")
    parser.add_argument("--dry-run", action="store_true", help="להדפיס בלי לכתוב")
    parser.add_argument("--check", action="store_true",
                        help="קוד יציאה 1 אם יש שינוי, בלי לכתוב")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    sb = client()
    entries = collect_urls(sb)
    LOG.info("‏%d כתובות במפה", len(entries))

    dry = args.dry_run or args.check
    changed = write_if_changed(SITEMAP_PATH, build_sitemap(entries), dry_run=dry)
    changed |= write_if_changed(RSS_PATH, build_rss(sb), dry_run=dry)

    if args.check:
        return 1 if changed else 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
