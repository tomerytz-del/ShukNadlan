"""קריאת פידי RSS/Atom והמרתם לפריטים נקיים.

תומך בכל פיד תקני, ובכלל זה הפידים ש-rss.app מייצרת מקבוצות פייסבוק ומלוחות
(‏https://rss.app/feeds/xxxx.xml). הבאת הפיד נעשית ב-requests ולא ישירות
ב-feedparser כדי לשלוט ב-User-Agent וב-timeout — rss.app חוסמת לקוחות
אנונימיים, ובלי timeout הרצת ה-Workflow עלולה להיתקע.
"""

from __future__ import annotations

import html
import logging
import re
from datetime import datetime, timezone
from typing import Iterable, Iterator, Optional

import feedparser
import requests

from .models import FeedEntry

log = logging.getLogger(__name__)

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"[ \t ]+")
_BLANK_RE = re.compile(r"\n{3,}")
_MAX_CONTENT_CHARS = 4000


def clean_text(raw: str | None) -> str:
    """מנקה HTML, ישויות ורווחים כפולים מתוכן הפריט."""
    if not raw:
        return ""
    text = re.sub(r"<br\s*/?>|</p>|</div>", "\n", raw, flags=re.IGNORECASE)
    text = _TAG_RE.sub(" ", text)
    text = html.unescape(text)
    text = _WS_RE.sub(" ", text)
    text = _BLANK_RE.sub("\n\n", text)
    text = "\n".join(line.strip() for line in text.splitlines())
    return text.strip()[:_MAX_CONTENT_CHARS]


def _published_at(entry) -> Optional[datetime]:
    for key in ("published_parsed", "updated_parsed", "created_parsed"):
        parsed = getattr(entry, key, None)
        if parsed:
            try:
                return datetime(*parsed[:6], tzinfo=timezone.utc)
            except (TypeError, ValueError):
                continue
    return None


def _entry_content(entry) -> str:
    """הגוף המלא ביותר שהפיד מציע — content קודם ל-summary."""
    blocks = []
    for item in getattr(entry, "content", None) or []:
        value = item.get("value") if isinstance(item, dict) else None
        if value:
            blocks.append(value)
    if not blocks:
        for key in ("summary", "description", "subtitle"):
            value = getattr(entry, key, None)
            if value:
                blocks.append(value)
                break
    return clean_text("\n".join(blocks))


def fetch_feed(
    url: str,
    *,
    timeout: int = 25,
    user_agent: str = "ShukNadlanLeadBot/1.0",
) -> feedparser.FeedParserDict:
    """מוריד פיד ומפרסר אותו. זורק requests.RequestException בכישלון רשת."""
    response = requests.get(
        url,
        timeout=timeout,
        headers={"User-Agent": user_agent, "Accept": "application/rss+xml, application/xml, text/xml, */*"},
    )
    response.raise_for_status()
    return feedparser.parse(response.content)


def parse_entries(
    parsed: feedparser.FeedParserDict,
    *,
    source_id: str | None = None,
    source_name: str | None = None,
    limit: int = 40,
) -> Iterator[FeedEntry]:
    """הופך פיד מפורסר לרצף FeedEntry, מדלג על פריטים בלי קישור או בלי טקסט."""
    for entry in (parsed.entries or [])[:limit]:
        link = (getattr(entry, "link", "") or "").strip()
        if not link:
            continue
        title = clean_text(getattr(entry, "title", ""))
        content = _entry_content(entry)
        if not title and not content:
            continue
        yield FeedEntry(
            source_url=link,
            title=title,
            content=content,
            published_at=_published_at(entry),
            source_id=source_id,
            source_name=source_name,
        )


def dedupe_entries(entries: Iterable[FeedEntry]) -> list[FeedEntry]:
    """מסיר כפילויות בתוך ההרצה עצמה (אותו פוסט משותף בכמה קבוצות)."""
    seen: set[str] = set()
    unique: list[FeedEntry] = []
    for entry in entries:
        if entry.source_url in seen:
            continue
        seen.add(entry.source_url)
        unique.append(entry)
    return unique
