#!/usr/bin/env python3
"""
מנוע מבזקי הנדל"ן — נקודת הכניסה.

מזין את רצועת "מבזק" בדף הבית: אוסף ידיעות מפרסומי עיריית עפולה ומאתרי
החדשות והנדל"ן המובילים, מסנן את מה שאינו נוגע לדיור, מנסח שורת מבזק
ב-Claude ושומר ב-Supabase. רץ בחינם ב-GitHub Actions כל שעתיים.

זרימת ההרצה:
  1. שליפת הפידים הפעילים מטבלת news_sources (‏+ NEWS_FEED_URLS אם הוגדר).
  2. קריאת כל פיד והמרתו לפריטים נקיים.
  3. **סינון גיל** — כתבה ישנה מ-NEWS_MAX_AGE_DAYS אינה מבזק.
  4. **סינון מילות מפתח** — לפני כל פנייה ל-API, כדי שידיעה שאינה נדל"ן
     לא תעלה כסף בכלל.
  5. **מניעת כפילויות** — בדיקת source_url מול Supabase, גם היא לפני Claude.
  6. ניסוח שורת המבזק ב-Claude עם פלט מובנה (JSON מאומת).
  7. שמירה בטבלת news_items. פריט שנדחה נשמר כ-rejected ולא נמחק, אחרת
     ההרצה הבאה הייתה מנתחת אותו שוב.

הרצה:
    python news_scraper.py                 # הרצה מלאה
    python news_scraper.py --dry-run       # לנתח בלי לכתוב ל-Supabase
    python news_scraper.py --limit 5       # לכל היותר 5 ידיעות חדשות
    python news_scraper.py --feed URL      # פיד יחיד, בלי טבלת המקורות
    python news_scraper.py --no-claude     # סינון וניסוח היוריסטי בלבד
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import datetime, timedelta, timezone

import requests

from lead_engine.feeds import dedupe_entries, fetch_feed, parse_entries
from lead_engine.models import FeedEntry
from news_engine.analyzer import NewsAnalyzer
from news_engine.config import ConfigError, Settings, load_settings
from news_engine.models import RunStats
from news_engine.relevance import classify, heuristic_analysis
from news_engine.store import NewsStore, build_news_row

log = logging.getLogger("news_scraper")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="איסוף וניסוח מבזקי נדל\"ן")
    parser.add_argument("--dry-run", action="store_true", help="לנתח בלי לשמור ל-Supabase")
    parser.add_argument("--limit", type=int, default=None, help="מקסימום ידיעות חדשות בהרצה")
    parser.add_argument(
        "--feed", action="append", default=[], metavar="URL",
        help="פיד בודד להרצה (אפשר לחזור על הדגל). מדלג על טבלת המקורות.",
    )
    parser.add_argument(
        "--no-claude", action="store_true",
        help="בלי ניסוח ב-Claude — כותרת הפיד כמו שהיא, מקוצרת.",
    )
    parser.add_argument("--verbose", action="store_true", help="לוג מפורט")
    return parser.parse_args(argv)


def collect_sources(store: NewsStore | None, cli_feeds: list[str]) -> list[dict]:
    """מאחד מקורות מהטבלה, ממשתנה הסביבה ומשורת הפקודה."""
    if cli_feeds:
        return [
            {"id": None, "name": url, "url": url, "source_type": "news", "scope": "national"}
            for url in cli_feeds
        ]

    sources = store.active_sources() if store else []
    known = {s["url"] for s in sources}
    for url in _env_feed_urls():
        if url not in known:
            sources.append(
                {"id": None, "name": url, "url": url, "source_type": "news", "scope": "national"}
            )
    return sources


def _env_feed_urls() -> list[str]:
    """‏NEWS_FEED_URLS — פידים נוספים בלי לגעת בטבלה. נפרד מ-RSS_FEED_URLS של הלידים."""
    return [u.strip() for u in os.environ.get("NEWS_FEED_URLS", "").split(",") if u.strip()]


def read_all_feeds(
    sources: list[dict], settings: Settings, stats: RunStats
) -> tuple[list[FeedEntry], dict[str | None, str], dict[str, dict]]:
    """
    קורא את כל הפידים.

    מחזיר גם מפה מהמקור אל ההגדרה שלו, כי ‎FeedEntry‎ נושא רק ‎source_id‎
    ו-‎source_name‎, ואילו הסיווג צריך גם את ‎scope‎ ואת ‎source_type‎.
    המפתח הוא ‎source_id‎ כשיש (מקור מהטבלה) ושם המקור כשאין (פיד שהוגדר
    ב-‎--feed‎ או ב-‎NEWS_FEED_URLS‎, ואז השם הוא הכתובת ולכן ייחודי).
    """
    entries: list[FeedEntry] = []
    statuses: dict[str | None, str] = {}
    by_key: dict[str, dict] = {}

    for source in sources:
        url = source["url"]
        name = source.get("name") or url
        by_key[source.get("id") or name] = source
        try:
            parsed = fetch_feed(
                url,
                timeout=settings.feed_timeout_seconds,
                user_agent=settings.request_user_agent,
            )
        except requests.RequestException as err:
            log.error("כשל בקריאת הפיד %s: %s", name, err)
            statuses[source.get("id")] = f"error: {err}"[:300]
            stats.errors += 1
            continue

        if getattr(parsed, "bozo", False) and not parsed.entries:
            reason = getattr(parsed, "bozo_exception", "פיד לא תקין")
            log.error("הפיד %s לא נפרס: %s", name, reason)
            statuses[source.get("id")] = f"error: {reason}"[:300]
            stats.errors += 1
            continue

        found = list(
            parse_entries(
                parsed,
                source_id=source.get("id"),
                source_name=name,
                limit=settings.max_entries_per_feed,
            )
        )
        log.info("‏%s — %d פריטים", name, len(found))
        entries.extend(found)
        statuses[source.get("id")] = "ok"
        stats.sources += 1

    stats.entries = len(entries)
    return dedupe_entries(entries), statuses, by_key


def run(args: argparse.Namespace, settings: Settings) -> RunStats:
    stats = RunStats()
    store = NewsStore(settings)
    use_claude = settings.use_claude and not args.no_claude
    analyzer = NewsAnalyzer(settings) if use_claude else None
    if not use_claude:
        log.warning(
            "רץ בלי Claude — הכותרות נלקחות מהפיד כמו שהן. "
            "הגדירו ANTHROPIC_API_KEY לניסוח מלא."
        )

    sources = collect_sources(store, args.feed)
    if not sources:
        log.warning(
            "לא הוגדר אף מקור מבזקים פעיל. הוסיפו שורות ל-news_sources "
            "או הגדירו NEWS_FEED_URLS."
        )
        return stats

    entries, source_statuses, sources_by_key = read_all_feeds(sources, settings, stats)
    if not entries:
        if not args.dry_run:
            _flush_source_statuses(store, source_statuses, {}, {})
        return stats

    # --- שלב 1: גיל. חוסך גם בדיקת כפילויות וגם ניתוח על ארכיון שלם ---
    cutoff = datetime.now(timezone.utc) - timedelta(days=settings.max_age_days)
    fresh_enough = []
    for entry in entries:
        if entry.published_at and entry.published_at < cutoff:
            stats.too_old += 1
            continue
        fresh_enough.append(entry)

    # --- שלב 2: מילות מפתח. רץ לפני כל פנייה ל-API ---
    candidates: list[tuple[FeedEntry, dict, dict]] = []
    for entry in fresh_enough:
        source = sources_by_key.get(entry.source_id or entry.source_name or "", {})
        verdict = classify(entry.title, entry.content, source.get("scope") or "national")
        if not verdict["keep"]:
            stats.filtered_out += 1
            continue
        candidates.append((entry, verdict, source))

    if not candidates:
        log.info("אין פריטים שעברו את הסינון בהרצה הזו.")
        if not args.dry_run:
            _flush_source_statuses(store, source_statuses, {}, {})
        return stats

    # --- שלב 3: כפילויות. פנייה אחת ל-Supabase לפני כל פנייה ל-Claude ---
    known = store.existing_urls([e.source_url for e, _, _ in candidates])
    new_items = [c for c in candidates if c[0].source_url not in known]
    stats.duplicates = len(candidates) - len(new_items)
    log.info("‏%d ידיעות חדשות · %d כפילויות דולגו", len(new_items), stats.duplicates)

    cap = args.limit if args.limit is not None else settings.max_new_items_per_run
    if cap and len(new_items) > cap:
        log.info("מגבלת ההרצה: מנתחים %d מתוך %d", cap, len(new_items))
        new_items = new_items[:cap]

    seen_per_source: dict[str | None, int] = {}
    saved_per_source: dict[str | None, int] = {}

    for entry, verdict, source in new_items:
        seen_per_source[entry.source_id] = seen_per_source.get(entry.source_id, 0) + 1

        if analyzer is not None:
            analysis = analyzer.analyze(
                url=entry.source_url,
                title=entry.title,
                content=entry.content,
                source_name=entry.source_name or "",
                source_scope=verdict["scope"],
            )
            stats.analyzed += 1
            if analysis is None:
                stats.errors += 1
                continue
            model = settings.model
        else:
            analysis = heuristic_analysis(
                entry.title, entry.content, verdict,
                source_type=source.get("source_type") or "news",
            )
            stats.analyzed += 1
            model = None

        publish = analysis.is_relevant and analysis.relevance_score >= settings.min_score_to_publish
        if not publish:
            stats.rejected += 1
            log.info(
                "נדחה [%s · ציון %d] %s",
                analysis.scope, analysis.relevance_score, entry.source_url,
            )
        else:
            log.info(
                "מבזק [%s · ציון %d] %s",
                analysis.scope, analysis.relevance_score, analysis.headline,
            )

        if args.dry_run:
            if publish:
                stats.inserted += 1
            continue

        row = build_news_row(
            source_url=entry.source_url,
            source_id=entry.source_id,
            source_name=entry.source_name,
            published_at=entry.published_at,
            raw_title=entry.title,
            raw_content=entry.content,
            image_url=entry.image_url or "",
            analysis=analysis,
            publish=publish,
            model=model,
        )
        if store.insert_item(row) and publish:
            stats.inserted += 1
            saved_per_source[entry.source_id] = saved_per_source.get(entry.source_id, 0) + 1

    if not args.dry_run:
        _flush_source_statuses(store, source_statuses, seen_per_source, saved_per_source)
    return stats


def _flush_source_statuses(
    store: NewsStore,
    statuses: dict[str | None, str],
    seen: dict[str | None, int],
    saved: dict[str | None, int],
) -> None:
    for source_id, status in statuses.items():
        if not source_id:
            continue
        store.record_source_run(
            source_id,
            items_seen=seen.get(source_id, 0),
            news_created=saved.get(source_id, 0),
            status="ok" if status == "ok" else "error",
            error=None if status == "ok" else status,
        )


def write_job_summary(stats: RunStats) -> None:
    """כותב את הסיכום לעמוד ההרצה ב-GitHub Actions, אם רצים שם."""
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not path:
        return
    lines = ["## סיכום הרצת מנוע המבזקים", "", "| מדד | ערך |", "| --- | --- |"]
    for line in stats.as_lines():
        label, value = line.rsplit(": ", 1)
        lines.append(f"| {label} | {value} |")
    with open(path, "a", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(message)s",
        stream=sys.stdout,
    )

    try:
        settings = load_settings()
    except ConfigError as err:
        log.error("%s", err)
        return 2

    stats = run(args, settings)
    for line in stats.as_lines():
        log.info("%s", line)
    write_job_summary(stats)

    # כשל רק אם שום מקור לא נקרא בהצלחה — פיד בודד שנשבר לא מפיל הרצה,
    # הוא מסמן את עצמו ב-last_error ורואים אותו בטבלת המקורות.
    if stats.errors and stats.sources == 0:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
