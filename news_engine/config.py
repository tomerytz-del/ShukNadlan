"""הגדרות מנוע המבזקים — הכול ממשתני סביבה, שום מפתח לא נכתב בקוד.

המנוע חולק את משתני ה-Supabase ואת מפתח Anthropic עם מנוע הלידים, ולכן
ההרצה ב-GitHub Actions לא דורשת סודות חדשים. מה שכן נפרד הוא שם הטבלאות
והמגבלות — שני המנועים כותבים לטבלאות שונות ובקצב שונה.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

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
    supabase_url: str
    supabase_service_role_key: str

    # ‏Claude אופציונלי כאן, בשונה ממנוע הלידים: בלעדיו המנוע עדיין עובד
    # ונופל לניסוח היוריסטי (כותרת הפיד, מנוקה ומקוצרת). זה מכוון — מבזק
    # הוא תוכן ציבורי שכבר נוסח על ידי עיתונאי/ת, ולא ליד שצריך לסווג.
    anthropic_api_key: str = ""
    model: str = "claude-sonnet-5"
    max_tokens: int = 1500

    items_table: str = "news_items"
    sources_table: str = "news_sources"

    # מגבלות הרצה
    max_entries_per_feed: int = 30
    max_new_items_per_run: int = 25
    min_score_to_publish: int = 5
    feed_timeout_seconds: int = 25
    # כתבה ישנה מזה לא נכנסת כמבזק גם אם הפיד עדיין מחזיר אותה. "מבזק" הוא
    # הבטחה לגולש/ת, וכותרת בת חודשיים ברצועה שוברת אותה.
    max_age_days: int = 21
    # חלון הדדופליקציה ברמת האירוע. קצר בכוונה — ראו recent_story_keys.
    story_dedupe_days: int = 3
    # תקרת המבזקים הארציים בהרצה. בלעדיה החלטת ריבית אחת ממלאת את
    # הרצועה של אתר מקומי: בהרצה הראשונה 10 מתוך 11 המבזקים היו ארציים.
    max_national_per_run: int = 3
    request_user_agent: str = (
        "ShukNadlanNewsBot/1.0 (+https://github.com/tomerytz-del/ShukNadlan)"
    )

    @property
    def use_claude(self) -> bool:
        return bool(self.anthropic_api_key)


def load_settings() -> Settings:
    return Settings(
        supabase_url=_required("SUPABASE_URL"),
        supabase_service_role_key=_required("SUPABASE_SERVICE_ROLE_KEY"),
        anthropic_api_key=os.environ.get("ANTHROPIC_API_KEY", "").strip(),
        model=os.environ.get("CLAUDE_MODEL", "").strip() or "claude-sonnet-5",
        max_tokens=_int("NEWS_MAX_TOKENS", 1500),
        items_table=os.environ.get("NEWS_ITEMS_TABLE", "").strip() or "news_items",
        sources_table=os.environ.get("NEWS_SOURCES_TABLE", "").strip() or "news_sources",
        max_entries_per_feed=_int("NEWS_MAX_ENTRIES_PER_FEED", 30),
        max_new_items_per_run=_int("MAX_NEW_NEWS_PER_RUN", 25),
        min_score_to_publish=_int("MIN_NEWS_SCORE_TO_PUBLISH", 5),
        feed_timeout_seconds=_int("FEED_TIMEOUT_SECONDS", 25),
        max_age_days=_int("NEWS_MAX_AGE_DAYS", 21),
        story_dedupe_days=_int("NEWS_STORY_DEDUPE_DAYS", 3),
        max_national_per_run=_int("MAX_NATIONAL_NEWS_PER_RUN", 3),
    )
