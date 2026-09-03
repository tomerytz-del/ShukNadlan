#!/usr/bin/env python3
"""
למה סינון מילות המפתח פוסל את כל מה שמגיע ממקור מסוים.

הרקע: הטלמטריה ב-news_sources גילתה ששני מקורות עפולה הפעילים תרמו **אפס**
ידיעות אי פעם — ‏items_seen = 0, news_created = 0 — בזמן שהפיד "נדל"ן בעפולה"
מחזיר 17 פריטים בכל הרצה. כלומר הפריטים מגיעים, וכולם נופלים בשלב הסינון
לפני שהם מגיעים בכלל לניתוח.

הסקריפט מריץ את *אותו* מסלול כמו הייצור — fetch_feed → parse_entries →
dedupe_entries → classify — ומדפיס לכל פריט את הפירוק המלא של ההחלטה: אילו
קבוצות מילים נפגעו, מה ההיקף שנקבע, והאם יש בכלל גוף לידיעה. כך רואים אם
הבעיה היא בשאילתת הפיד (מחזירה תוכן שאינו נדל"ן) או בסינון (מחמיר מדי).

הרצה — דורש רשת שמגיעה ל-news.google.com ואת סודות Supabase:

    python scripts/probe_filter.py            # מקורות בהיקף afula
    python scripts/probe_filter.py --scope region
    python scripts/probe_filter.py --scope all

זהו כלי אבחון. אחרי שהסינון כוונן אפשר למחוק אותו.
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lead_engine.feeds import dedupe_entries, parse_entries, fetch_feed  # noqa: E402
from news_engine.config import load_settings  # noqa: E402
from news_engine.relevance import classify  # noqa: E402
from news_engine.store import NewsStore  # noqa: E402


def why_rejected(verdict: dict) -> str:
    """
    מתרגם את הווטו לשפה שאפשר לפעול לפיה.

    שלושת התנאים ב-classify() נבדקים באותו סדר שבו הם מופיעים שם, כדי
    שהתשובה תהיה הסיבה *הראשונה* שפסלה — זו שצריך לתקן.
    """
    if not verdict["realty_hits"]:
        return "אין אף מילת נדל\"ן"
    if not verdict["is_local"] and not verdict["national_hits"]:
        return "ארצית בלי מילת שוק"
    if verdict["noise_hits"] and not verdict["is_local"]:
        return f"רעש בורסאי ארצי: {verdict['noise_hits']}"
    return "עברה"


def main() -> int:
    parser = argparse.ArgumentParser(description="אבחון סינון מילות המפתח")
    parser.add_argument("--scope", default="afula", help="afula / region / national / all")
    args = parser.parse_args()

    settings = load_settings()
    sources = NewsStore(settings).active_sources()
    if args.scope != "all":
        sources = [s for s in sources if (s.get("scope") or "national") == args.scope]

    if not sources:
        print(f"אין מקורות פעילים בהיקף {args.scope}")
        return 1

    reasons: Counter[str] = Counter()
    total_kept = 0
    total_items = 0

    for source in sources:
        name = source.get("name") or source["url"]
        print("\n" + "=" * 78)
        print(f"{name}   [scope={source.get('scope')}]")
        print("=" * 78)
        try:
            parsed = fetch_feed(
                source["url"],
                timeout=settings.feed_timeout_seconds,
                user_agent=settings.request_user_agent,
            )
        except requests.RequestException as err:
            print(f"  כשל בקריאת הפיד: {err}")
            continue

        entries = dedupe_entries(list(parse_entries(
            parsed,
            source_id=source.get("id"),
            source_name=name,
            limit=settings.max_entries_per_feed,
        )))
        print(f"  {len(entries)} פריטים אחרי פירסור ודדופ\n")

        for entry in entries:
            total_items += 1
            verdict = classify(entry.title, entry.content, source.get("scope") or "national")
            reason = why_rejected(verdict)
            reasons[reason] += 1
            if verdict["keep"]:
                total_kept += 1

            mark = "✅" if verdict["keep"] else "❌"
            body = entry.content or ""
            print(f"  {mark} {entry.title[:88]}")
            print(
                f"      scope={verdict['scope']:<8} "
                f"נדל\"ן={verdict['realty_hits']} שוק={verdict['national_hits']} "
                f"עפולה={verdict['afula_hits']} עמק={verdict['region_hits']} "
                f"רעש={verdict['noise_hits']}"
            )
            print(f"      גוף: {len(body)} תווים{' (ריק!)' if not body else ''} · {reason}")

    print("\n" + "=" * 78)
    print(f"סה\"כ {total_items} פריטים · {total_kept} עברו · {total_items - total_kept} נפסלו")
    for reason, count in reasons.most_common():
        print(f"  {count:>3} × {reason}")
    print("=" * 78)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
