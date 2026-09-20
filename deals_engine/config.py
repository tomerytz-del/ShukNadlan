"""הגדרות מנוע העסקאות הרשמיות.

רץ ב-GitHub Actions עם SERVICE_ROLE_KEY — מפתח שעוקף RLS — ולכן אך ורק
בצד השרת. ‏market_deals_official אינה נגישה ל-anon ול-authenticated בכלל,
כך שזו הדרך היחידה לכתוב אליה.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field


class ConfigError(RuntimeError):
    """הגדרה חסרה או פסולה — ההרצה נעצרת לפני שנגעה ברשת."""


def _required(name: str) -> str:
    value = (os.environ.get(name) or "").strip()
    if not value:
        raise ConfigError(f"חסר משתנה סביבה: {name}")
    return value


def _int(name: str, default: int) -> int:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError as err:
        raise ConfigError(f"{name} חייב להיות מספר שלם, התקבל {raw!r}") from err


def _float(name: str, default: float) -> float:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError as err:
        raise ConfigError(f"{name} חייב להיות מספר, התקבל {raw!r}") from err


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    supabase_service_role_key: str

    # הערים שנמשכות. עפולה היא היחידה שיש לה שכבת כתובות לגיאוקוד
    # (‏docs/geocoding.md), ולכן עיר נוספת תיכנס למאגר אבל תישאר בלי
    # קואורדינטות — כלומר ברשימת העיר בלבד ולא בחישוב הרדיוס.
    cities: tuple[str, ...] = ("עפולה",)

    # כמה חודשים אחורה נמשכים בכל הרצה. הדוח ממילא חותך ב-
    # ‏cma_max_deal_age_months, ולכן אין טעם למשוך מעבר לזה — אבל כן יש
    # טעם במרווח: רשות המיסים מפרסמת עסקה חודשים אחרי שנסגרה.
    months_back: int = 30

    max_pages_per_city: int = 40
    request_timeout_seconds: float = 25.0
    retries: int = 3
    pause_between_requests_seconds: float = 1.2

    # אחוז הרשומות שמותר להן להיכשל בפענוח לפני שההרצה נחשבת כושלת.
    # ראו normalize.py — מיפוי שדה שהשתנה במקור מתגלה כאן ולא בשקט.
    max_unparsable_ratio: float = 0.25

    user_agent: str = "ShukNadlanBot/1.0 (+https://shuknadlan.co.il)"

    extra: dict = field(default_factory=dict)


def load_settings() -> Settings:
    cities_raw = (os.environ.get("DEALS_CITIES") or "").strip()
    cities = tuple(c.strip() for c in cities_raw.split(",") if c.strip()) or ("עפולה",)

    return Settings(
        supabase_url=_required("SUPABASE_URL"),
        supabase_service_role_key=_required("SUPABASE_SERVICE_ROLE_KEY"),
        cities=cities,
        months_back=_int("DEALS_MONTHS_BACK", 30),
        max_pages_per_city=_int("DEALS_MAX_PAGES", 40),
        request_timeout_seconds=_float("DEALS_TIMEOUT_SECONDS", 25.0),
        retries=_int("DEALS_RETRIES", 3),
        pause_between_requests_seconds=_float("DEALS_PAUSE_SECONDS", 1.2),
        max_unparsable_ratio=_float("DEALS_MAX_UNPARSABLE_RATIO", 0.25),
    )
