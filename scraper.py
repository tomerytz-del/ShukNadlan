#!/usr/bin/env python3
"""
מנוע לידים מפידי RSS של נדל"ן — נקודת הכניסה.

זרימת ההרצה:
  1. שליפת הפידים הפעילים מטבלת rss_sources (‏+ פידים מ-RSS_FEED_URLS אם הוגדרו).
  2. קריאת כל פיד והמרתו לפריטים נקיים.
  3. **מניעת כפילויות** — בדיקת ה-source_url מול Supabase לפני כל פנייה ל-API,
     כך שפוסט שכבר נותח לא עולה כסף פעם שנייה.
  4. ניתוח כל פריט חדש ב-Claude עם פלט מובנה (JSON מאומת).
  5. שמירת התוצאה בטבלת rss_leads.

הרצה:
    python scraper.py                 # הרצה מלאה
    python scraper.py --dry-run       # קריאה וניתוח בלי לכתוב ל-Supabase
    python scraper.py --limit 5       # לכל היותר 5 פוסטים חדשים (בדיקה זולה)
    python scraper.py --feed URL      # פיד יחיד, בלי לגעת בטבלת המקורות
"""

from __future__ import annotations

import argparse
import logging
import os
import sys

import requests

from lead_engine.analyzer import LeadAnalyzer
from lead_engine.config import ConfigError, Settings, load_settings
from lead_engine.feeds import dedupe_entries, fetch_feed, parse_entries
from lead_engine.models import FeedEntry, RunStats
from lead_engine.store import LeadStore

log = logging.getLogger("scraper")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="איסוף וסיווג לידי נדל\"ן מפידי RSS")
    parser.add_argument(
        "--dry-run", action="store_true", help="לנתח בלי לשמור ל-Supabase"
    )
    parser.add_argument(
        "--limit", type=int, default=None, help="מקסימום פוסטים חדשים בהרצה"
    )
    parser.add_argument(
        "--feed", action="append", default=[], metavar="URL",
        help="פיד בודד להרצה (אפשר לחזור על הדגל). מדלג על טבלת המקורות.",
    )
    parser.add_argument(
        "--verbose", action="store_true", help="לוג מפורט"
    )
    return parser.parse_args(argv)


def collect_sources(store: LeadStore | None, settings: Settings, cli_feeds: list[str]) -> list[dict]:
    """מאחד מקורות מהטבלה, ממשתנה הסביבה ומשורת הפקודה."""
    if cli_feeds:
        return [{"id": None, "name": url, "url": url} for url in cli_feeds]

    sources = store.active_sources() if store else []
    known = {s["url"] for s in sources}
    for url in settings.extra_feed_urls:
        if url not in known:
            sources.append({"id": None, "name": url, "url": url})
    return sources


def read_all_feeds(
    sources: list[dict], settings: Settings, stats: RunStats
) -> tuple[list[FeedEntry], dict[str | None, str]]:
    """קורא את כל הפידים ומחזיר את הפריטים ואת סטטוס הקריאה לכל מקור."""
    entries: list[FeedEntry] = []
    statuses: dict[str | None, str] = {}

    for source in sources:
        url = source["url"]
        name = source.get("name") or url
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
    return dedupe_entries(entries), statuses


def run(args: argparse.Namespace, settings: Settings) -> RunStats:
    stats = RunStats()
    store = LeadStore(settings)
    analyzer = LeadAnalyzer(settings)

    sources = collect_sources(store, settings, args.feed)
    if not sources:
        log.warning(
            "לא הוגדר אף מקור RSS פעיל. הוסיפו מקורות בדף הניהול "
            "(אזור אישי → ניהול מקורות RSS) או דרך RSS_FEED_URLS."
        )
        return stats

    entries, source_statuses = read_all_feeds(sources, settings, stats)
    if not entries:
        if not args.dry_run:
            _flush_source_statuses(store, source_statuses, {}, {})
        return stats

    # --- מניעת כפילויות: פנייה אחת ל-Supabase לפני כל פנייה ל-Claude ---
    known = store.existing_urls([e.source_url for e in entries])
    fresh = [e for e in entries if e.source_url not in known]
    stats.duplicates = len(entries) - len(fresh)
    log.info("‏%d פריטים חדשים · %d כפילויות דולגו", len(fresh), stats.duplicates)

    cap = args.limit if args.limit is not None else settings.max_new_leads_per_run
    if cap and len(fresh) > cap:
        log.info("מגבלת ההרצה: מנתחים %d מתוך %d", cap, len(fresh))
        fresh = fresh[:cap]

    seen_per_source: dict[str | None, int] = {}
    saved_per_source: dict[str | None, int] = {}

    for entry in fresh:
        seen_per_source[entry.source_id] = seen_per_source.get(entry.source_id, 0) + 1
        analysis = analyzer.analyze(entry)
        stats.analyzed += 1
        if analysis is None:
            stats.errors += 1
            continue

        if not analysis.is_lead or analysis.lead_quality_score < settings.min_score_to_publish:
            stats.rejected += 1
            log.info(
                "נדחה [%s · ציון %d] %s",
                analysis.lead_side, analysis.lead_quality_score, entry.source_url,
            )
            # גם פוסט שנדחה נשמר, כדי שלא ננתח אותו שוב בהרצה הבאה
            if not args.dry_run:
                store.insert_lead(entry, analysis)
            continue

        log.info(
            "ליד [%s · ציון %d] %s",
            analysis.lead_side, analysis.lead_quality_score, analysis.teaser_title,
        )
        if args.dry_run:
            stats.inserted += 1
            continue
        if store.insert_lead(entry, analysis):
            stats.inserted += 1
            saved_per_source[entry.source_id] = saved_per_source.get(entry.source_id, 0) + 1

    if not args.dry_run:
        _flush_source_statuses(store, source_statuses, seen_per_source, saved_per_source)
    return stats


def _flush_source_statuses(
    store: LeadStore,
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
            leads_created=saved.get(source_id, 0),
            status="ok" if status == "ok" else "error",
            error=None if status == "ok" else status,
        )


def write_job_summary(stats: RunStats) -> None:
    """כותב את הסיכום לעמוד ההרצה ב-GitHub Actions, אם רצים שם."""
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not path:
        return
    lines = ["## סיכום הרצת מנוע הלידים", "", "| מדד | ערך |", "| --- | --- |"]
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

    # כשל רק אם שום דבר לא הצליח אך היו שגיאות — שגיאה בפיד בודד לא מפילה הרצה
    if stats.errors and stats.analyzed == 0 and stats.sources == 0:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
