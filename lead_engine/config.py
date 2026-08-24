"""הגדרות המנוע — הכול מגיע ממשתני סביבה, שום מפתח לא נכתב בקוד."""

from __future__ import annotations

import os
from dataclasses import dataclass, field

from dotenv import load_dotenv

load_dotenv()  # נוח לפיתוח מקומי; ב-GitHub Actions הערכים מגיעים מ-secrets


class ConfigError(RuntimeError):
    """חסר משתנה סביבה חובה."""


def _required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ConfigError(
            f"משתנה הסביבה {name} חסר. "
            "בהרצה מקומית הגדירו אותו ב-.env, וב-GitHub Actions כ-Repository Secret."
        )
    return value


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    try:
        return int(raw) if raw else default
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    anthropic_api_key: str
    supabase_url: str
    supabase_service_role_key: str

    # מודל Claude. המשתמש ביקש Claude 3.5 Sonnet, אך הדגם הזה הוצא משימוש
    # ‏(retired) ואינו זמין יותר ב-API. claude-sonnet-5 הוא היורש הישיר שלו
    # באותה שכבה — מהיר וזול יחסית, מתאים לסיווג בנפח גבוה.
    model: str = "claude-sonnet-5"
    max_tokens: int = 4000

    # שמות הטבלאות — ניתנים לשינוי אם מריצים מול פרויקט Supabase אחר
    leads_table: str = "rss_leads"
    sources_table: str = "rss_sources"

    # מגבלות הרצה
    max_entries_per_feed: int = 40
    max_new_leads_per_run: int = 60
    min_score_to_publish: int = 1
    feed_timeout_seconds: int = 25
    request_user_agent: str = (
        "ShukNadlanLeadBot/1.0 (+https://github.com/tomerytz-del/ShukNadlan)"
    )

    # פידים שמוגדרים ידנית בנוסף לטבלת rss_sources (מופרדים בפסיק)
    extra_feed_urls: tuple[str, ...] = field(default_factory=tuple)


def load_settings() -> Settings:
    extra = tuple(
        u.strip()
        for u in os.environ.get("RSS_FEED_URLS", "").split(",")
        if u.strip()
    )
    return Settings(
        anthropic_api_key=_required("ANTHROPIC_API_KEY"),
        supabase_url=_required("SUPABASE_URL"),
        supabase_service_role_key=_required("SUPABASE_SERVICE_ROLE_KEY"),
        model=os.environ.get("CLAUDE_MODEL", "").strip() or "claude-sonnet-5",
        max_tokens=_int("CLAUDE_MAX_TOKENS", 4000),
        leads_table=os.environ.get("LEADS_TABLE", "").strip() or "rss_leads",
        sources_table=os.environ.get("SOURCES_TABLE", "").strip() or "rss_sources",
        max_entries_per_feed=_int("MAX_ENTRIES_PER_FEED", 40),
        max_new_leads_per_run=_int("MAX_NEW_LEADS_PER_RUN", 60),
        min_score_to_publish=_int("MIN_SCORE_TO_PUBLISH", 1),
        feed_timeout_seconds=_int("FEED_TIMEOUT_SECONDS", 25),
        extra_feed_urls=extra,
    )
