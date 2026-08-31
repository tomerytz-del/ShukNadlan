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
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

import feedparser
import requests

from .models import FeedEntry

log = logging.getLogger(__name__)

# תגיות שסוגרות בלוק — הופכות לשורה חדשה. כל שאר התגיות נמחקות בלי להשאיר
# רווח, כי Google Alerts עוטפת את מילות החיפוש ב-<b> באמצע מילה
# ("ב<b>עפולה</b>"), והחלפה ברווח הייתה שוברת את זה ל"ב עפולה".
_BLOCK_RE = re.compile(r"<br\s*/?>|</p>|</div>|</li>|</h[1-6]>", re.IGNORECASE)
_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"[ \t ]+")
_BLANK_RE = re.compile(r"\n{3,}")
_MAX_CONTENT_CHARS = 4000

# פרמטרים שגוגל ורשתות חברתיות מייצרות מחדש בכל משיכה — הם שוברים את זיהוי
# הכפילויות, שמשווה מחרוזות.
_TRACKING_PARAMS = frozenset({
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "fbclid", "gclid", "mc_cid", "mc_eid", "igshid", "ref_src",
    "usg", "cd", "ct", "rct", "sa", "ved", "sqi",  # Google Alerts / חיפוש
})
_REDIRECT_HOSTS = frozenset({
    "www.google.com", "google.com", "news.google.com",
    "www.google.co.il", "google.co.il",
})


def clean_text(raw: str | None) -> str:
    """מנקה HTML, ישויות ורווחים כפולים מתוכן הפריט."""
    if not raw:
        return ""
    text = _BLOCK_RE.sub("\n", raw)
    text = _TAG_RE.sub("", text)
    text = html.unescape(text)
    text = _WS_RE.sub(" ", text)
    text = _BLANK_RE.sub("\n\n", text)
    text = "\n".join(line.strip() for line in text.splitlines())
    return text.strip()[:_MAX_CONTENT_CHARS]


def canonical_url(url: str) -> str:
    """
    מחזיר את הכתובת האמיתית והיציבה של הפוסט.

    שני תיקונים שקריטיים גם למניעת כפילויות וגם למוצר שנמכר:

    1. פתיחת עטיפת ההפניה של Google Alerts. הפיד של גוגל לא מחזיר את קישור
       המקור אלא ‎google.com/url?...&url=<היעד>&usg=<חתימה>‎. החתימה מתחדשת
       בכל משיכה, ולכן אותה מודעה נראית כקישור חדש בכל הרצה — הליד היה נכנס
       שוב ושוב, ועולה עוד קריאה ל-Claude בכל פעם. לא פחות חשוב: קישור כזה
       אינו מה שהסוכן/ת קנה/תה — הוא מסגיר שהמקור הוא התראת Google,
       והחתימה שבתוכו פגה אחרי זמן מה.

    2. הסרת פרמטרי מעקב (utm_*, fbclid וכו') שנוספים לאותו פוסט בין משיכות.

    כתובת שאינה עטופה ואין בה פרמטרי מעקב מוחזרת כפי שהיא.
    """
    if not url:
        return url
    try:
        parts = urlsplit(url)
    except ValueError:
        return url

    if parts.netloc.lower() in _REDIRECT_HOSTS:
        params = parse_qs(parts.query)
        # ‏/url?url=<יעד> בהתראות, /url?q=<יעד> בתוצאות חיפוש
        target = (params.get("url") or params.get("q") or [None])[0]
        if target and target.startswith(("http://", "https://")):
            return canonical_url(target)

    kept = [
        (key, item)
        for key, values in parse_qs(parts.query, keep_blank_values=True).items()
        if key.lower() not in _TRACKING_PARAMS
        for item in values
    ]
    query = urlencode(kept)
    if query == parts.query:
        return url
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, parts.fragment))


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


def _entry_image(entry) -> str:
    """
    תמונת הפריט, מהמקום הראשון שיש בו אחת.

    לכל משפחת פידים מוסכמה משלה: ‎media:content‎/‎media:thumbnail‎ (Media RSS,
    מה שגוגל ורוב אתרי החדשות מייצרים), ‎<enclosure>‎ (RSS 2.0 קלאסי) ו-
    ‎image‎ ב-JSON Feed. מי שאין לו תמונה מקבל כרטיס עם גרדיאנט, ולכן אין
    כאן נפילה לתמונה גנרית.
    """
    for key in ("media_content", "media_thumbnail"):
        for item in getattr(entry, key, None) or []:
            url = (item.get("url") or "").strip() if isinstance(item, dict) else ""
            if url.startswith(("http://", "https://")):
                return url
    for item in getattr(entry, "enclosures", None) or []:
        if not isinstance(item, dict):
            continue
        if not (item.get("type") or "").startswith("image"):
            continue
        url = (item.get("href") or item.get("url") or "").strip()
        if url.startswith(("http://", "https://")):
            return url
    image = getattr(entry, "image", None)
    if isinstance(image, dict):
        url = (image.get("href") or image.get("url") or "").strip()
        if url.startswith(("http://", "https://")):
            return url
    return ""


def _json_feed_to_parsed(payload: dict) -> feedparser.FeedParserDict:
    """
    ממיר JSON Feed למבנה שנראה ל-parse_entries בדיוק כמו פיד XML מפורסר.

    ‏rss.app מציעה כל פיד בשתי גרסאות — ‎/feeds/XXXX.xml‎ ו-‎/feeds/v1.1/XXXX.json‎ —
    ו-feedparser יודע לקרוא רק את הראשונה (על JSON היא מחזירה SAXParseException
    ואפס פריטים). במקום לדרוש שתמיד תועתק דווקא כתובת ה-XML, ההמרה כאן מיישרת
    את שתי הגרסאות לאותו מבנה, וכל שאר השרשרת נשארת ללא שינוי.

    מיפוי לפי jsonfeed.org/version/1.1.
    """
    entries = []
    for item in payload.get("items") or []:
        if not isinstance(item, dict):
            continue
        entry = feedparser.FeedParserDict(
            link=(item.get("url") or item.get("external_url") or "").strip(),
            title=item.get("title") or "",
        )
        body = item.get("content_html") or item.get("content_text") or item.get("summary")
        if body:
            entry["content"] = [{"value": body}]
        if item.get("image"):
            entry["image"] = {"href": item["image"]}
        stamp = item.get("date_published") or item.get("date_modified")
        if stamp:
            parsed_stamp = _iso_to_struct(stamp)
            if parsed_stamp:
                entry["published_parsed"] = parsed_stamp
        entries.append(entry)

    return feedparser.FeedParserDict(
        bozo=False,
        version="json1",
        feed=feedparser.FeedParserDict(
            title=payload.get("title") or "",
            link=payload.get("home_page_url") or "",
        ),
        entries=entries,
    )


def _iso_to_struct(stamp: str):
    """‏RFC3339 (הפורמט של JSON Feed) לטאפל תאריך ב-UTC, כמו שfeedparser מייצר."""
    try:
        moment = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    except (AttributeError, ValueError):
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc).timetuple()


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
        headers={
            "User-Agent": user_agent,
            "Accept": "application/rss+xml, application/xml, text/xml, application/json, */*",
        },
    )
    response.raise_for_status()

    # זיהוי לפי התוכן עצמו ולא לפי סיומת הכתובת — יש שרתים שמגישים JSON Feed
    # מכתובת בלי סיומת, או מכריזים content-type כללי.
    body = response.content.lstrip()
    if body.startswith(b"{"):
        try:
            return _json_feed_to_parsed(response.json())
        except ValueError as err:
            log.error("הפיד %s נראה כמו JSON אך אינו תקין: %s", url, err)
            return feedparser.FeedParserDict(
                bozo=True, bozo_exception=err, feed=feedparser.FeedParserDict(), entries=[]
            )

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
        link = canonical_url((getattr(entry, "link", "") or "").strip())
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
            image_url=_entry_image(entry) or None,
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
