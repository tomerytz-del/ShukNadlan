#!/usr/bin/env python3
"""
אבחון הפיד של עיריית עפולה — למה ‎https://www.afula.muni.il/rss‎ מחזיר 403.

הרקע: המקור "עיריית עפולה — הודעות ופרסומים" נכשל בכל הרצה עם 403, ולכן
רצועת המבזקים מתמלאת בידיעות ארציות בלי תוכן מקומי. יש שתי סיבות אפשריות
ואי אפשר להכריע ביניהן בלי לגעת בשרת:

  1. השרת חוסם את ה-User-Agent שלנו. אתרי עיריות יושבים מאחורי WAF שמחזיר
     403 לכל מה שלא נראה דפדפן.
  2. הכתובת פשוט לא קיימת. מבנה האתר הוא ‎/he/...‎ (למשל ‎/he/news/‎), ואילו
     הכתובת שהוגדרה היא ‎/rss‎ בלי הקידומת — יש WAF-ים שמחזירים 403 ולא 404
     על נתיב לא מוכר.

הסקריפט בודק את שתי ההשערות יחד: כל כתובת מועמדת מול כל User-Agent, ובנוסף
מנסה *לגלות* את הפיד האמיתי מתוך תגיות ‎<link rel="alternate">‎ בדפי האתר —
כך שגם אם כל הניחושים שגויים, נקבל את הכתובת הנכונה מהאתר עצמו.

הרצה (דורש רשת שמגיעה ל-afula.muni.il — לא כל סביבה מגיעה):

    python scripts/probe_afula_feed.py

זהו כלי אבחון חד-פעמי. אחרי שהמקור תוקן אפשר למחוק אותו.
"""

from __future__ import annotations

import re
import sys
from urllib.parse import urljoin

import feedparser
import requests

TIMEOUT = 25

# ה-User-Agent שהמנוע שולח היום, מול דפדפן. אם הראשון נכשל והשני מצליח —
# החסימה היא לפי UA, וזה תיקון של שורה אחת.
AGENTS = {
    "bot": "ShukNadlanNewsBot/1.0 (+https://github.com/tomerytz-del/ShukNadlan)",
    "browser": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
}

# הכתובת שמוגדרת היום ראשונה, ואחריה הניחושים הסבירים לפי מבנה ‎/he/‎.
CANDIDATE_FEEDS = [
    "https://www.afula.muni.il/rss",
    "https://www.afula.muni.il/he/rss",
    "https://www.afula.muni.il/rss.xml",
    "https://www.afula.muni.il/he/rss.xml",
    "https://www.afula.muni.il/feed",
    "https://www.afula.muni.il/he/feed",
    "https://www.afula.muni.il/he/news/rss",
]

# דפים שמהם ננסה לגלות פיד מוכרז. ‏handasa הוא אתר הוועדה המקומית לתכנון
# ובנייה — המקור הרלוונטי ביותר לנדל"ן מכל אתרי העירייה.
DISCOVERY_PAGES = [
    "https://www.afula.muni.il/he/news/",
    "https://www.afula.muni.il/he/",
    "https://handasa.afula.muni.il/",
]

_FEED_LINK_RE = re.compile(
    r"""<link\b[^>]*?rel=["']alternate["'][^>]*?>""", re.IGNORECASE
)
_HREF_RE = re.compile(r"""href=["']([^"']+)["']""", re.IGNORECASE)
_TYPE_RE = re.compile(r"""type=["']([^"']+)["']""", re.IGNORECASE)


def fetch(url: str, agent_name: str) -> tuple[str, requests.Response | None]:
    """מוריד כתובת ומחזיר תיאור קצר לשורת הדוח."""
    try:
        response = requests.get(
            url,
            timeout=TIMEOUT,
            headers={
                "User-Agent": AGENTS[agent_name],
                "Accept": "application/rss+xml, application/xml, text/xml, text/html, */*",
                "Accept-Language": "he-IL,he;q=0.9,en;q=0.8",
            },
        )
    except requests.RequestException as err:
        return f"שגיאת רשת: {type(err).__name__}: {err}", None
    ctype = response.headers.get("content-type", "?").split(";")[0].strip()
    return f"HTTP {response.status_code} · {ctype} · {len(response.content)}B", response


def describe_feed(response: requests.Response) -> str:
    """האם מה שחזר הוא באמת פיד עם פריטים?"""
    parsed = feedparser.parse(response.content)
    count = len(parsed.entries)
    if count:
        title = (parsed.feed.get("title") or "?").strip()
        first = (parsed.entries[0].get("title") or "?").strip()
        return f"✅ פיד תקין — {count} פריטים · \"{title}\" · ראשון: {first[:70]}"
    if parsed.bozo:
        return f"❌ לא פיד ({type(parsed.bozo_exception).__name__})"
    return "❌ נפרס אך 0 פריטים"


def probe_candidates() -> None:
    print("=" * 78)
    print("‏1. כתובות מועמדות × User-Agent")
    print("=" * 78)
    for url in CANDIDATE_FEEDS:
        print(f"\n{url}")
        for agent_name in AGENTS:
            summary, response = fetch(url, agent_name)
            line = f"  [{agent_name:<7}] {summary}"
            if response is not None and response.ok:
                line += f"\n            {describe_feed(response)}"
            print(line)


def discover_feeds() -> None:
    print("\n" + "=" * 78)
    print("‏2. גילוי פיד מוכרז מתוך דפי האתר (<link rel=alternate>)")
    print("=" * 78)
    for page in DISCOVERY_PAGES:
        print(f"\n{page}")
        # לגילוי משתמשים ב-UA של דפדפן: אם ה-WAF חוסם אותנו לא נראה כלום.
        summary, response = fetch(page, "browser")
        print(f"  [browser] {summary}")
        if response is None or not response.ok:
            continue
        html = response.text
        found = False
        for tag in _FEED_LINK_RE.findall(html):
            type_match = _TYPE_RE.search(tag)
            href_match = _HREF_RE.search(tag)
            if not href_match:
                continue
            ctype = (type_match.group(1) if type_match else "").lower()
            if "rss" not in ctype and "atom" not in ctype and "xml" not in ctype:
                continue
            found = True
            absolute = urljoin(page, href_match.group(1))
            print(f"    ↳ מוכרז: {absolute}  ({ctype})")
            feed_summary, feed_response = fetch(absolute, "browser")
            print(f"      [browser] {feed_summary}")
            if feed_response is not None and feed_response.ok:
                print(f"      {describe_feed(feed_response)}")
        if not found:
            print("    ↳ לא הוכרז פיד בדף הזה")


def main() -> int:
    probe_candidates()
    discover_feeds()
    print("\n" + "=" * 78)
    print("סיום. חפשו ✅ — זו הכתובת (ואולי ה-UA) שצריך להגדיר במקור.")
    print("=" * 78)
    return 0


if __name__ == "__main__":
    sys.exit(main())
