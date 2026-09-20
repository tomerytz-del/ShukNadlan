"""רשומה גולמית מהמקור -> שורה ב-market_deals_official.

**הכלל כאן הוא לא לנחש.** רשומה שחסר בה שדה חובה, או ששדה בה אינו
ניתן לפענוח, נזרקת ונספרת — היא אינה נכנסת עם ברירת מחדל. הסיבה יושבת
בדיוק במה שהמאגר הזה בא לתקן: עסקה שנכנסת עם מספר שנקרא מהשדה הלא נכון
מסומנת `price_basis='official'`, כלומר היא המספר שהדוח סומך עליו יותר
מכל אחר. מאגר ריק עדיף על מאגר שקרי.

‏run.py מחשב מהספירה הזו את `unparsable_ratio` ומפיל את ההרצה כשהוא
חוצה סף — כך מיפוי שדה שהשתנה במקור מתגלה כשגיאה אדומה ולא כ"השוק
שקט החודש".
"""

from __future__ import annotations

import hashlib
import logging
import re
from datetime import date, datetime
from typing import Any

from .nadlan import pick

log = logging.getLogger(__name__)

# סוגי הנכס שמופיעים במקור, ממופים לאוצר המילים של האתר. סוג שאינו
# ברשימה נשמר כמו שהוא — הוא עדיין עסקה תקפה, והדוח מסמן אותו
# כ"סוג אחר" ביחס לנכס הנבדק במקום לזרוק אותו.
TYPE_MAP = {
    "דירה": "דירה",
    "דירה בבית קומות": "דירה",
    "דירת גן": "דירת גן",
    "דירת גג": "דירת גג",
    "פנטהאוז": "פנטהאוז",
    "בית בודד": "בית פרטי",
    "קוטג' דו משפחתי": "דו משפחתי",
    "קוטג' חד משפחתי": "בית פרטי",
    "מגרש": "מגרש",
    "מגרשים": "מגרש",
    "חנות": "מסחרי",
    "משרד": "מסחרי",
    "מחסן": "מסחרי",
}

# "הרצל 12 עפולה" / "שדרות ירושלים 5, עפולה" -> ("הרצל", "12")
#
# מספר הבית הוא הרצף הספרתי **האחרון** שאינו חלק ממיקוד: כתובות רבות
# פותחות במילה שיש בה ספרה ("הרב 770"), והמספר האמיתי בא אחרי שם הרחוב.
_HOUSE_RE = re.compile(r"^(?P<street>.+?)\s+(?P<house>\d+[א-ת]?)(?:\s*[,/].*)?$")


def _clean(value: Any) -> str:
    return str(value).strip() if value not in (None, "") else ""


def _number(value: Any) -> float | None:
    """מספר מתוך ערך שעשוי לבוא כמחרוזת עם פסיקים, ₪ ורווחים."""
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = re.sub(r"[^\d.\-]", "", str(value))
    if not text or text in ("-", ".", "-."):
        return None
    try:
        return float(text)
    except ValueError:
        return None


_DATE_FORMATS = (
    "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d",
    "%d/%m/%Y", "%d.%m.%Y", "%d-%m-%Y",
)


def _parse_date(value: Any) -> date | None:
    text = _clean(value)
    if not text:
        return None
    text = text.split(".")[0] if "T" in text else text
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def split_address(address: str) -> tuple[str, str]:
    """כתובת מלאה -> (רחוב, מספר בית). שניהם ריקים כשאי אפשר לפצל.

    הפיצול נחוץ לגיאוקוד: שכבת הכתובות של עיריית עפולה נשאלת ברחוב
    ובמספר בית בנפרד ובהשוואה מדויקת (`docs/geocoding.md`). בלי פיצול
    העסקה תישאר בלי קואורדינטות, כלומר מחוץ לחישוב הרדיוס.
    """
    text = _clean(address)
    if not text:
        return "", ""
    # הסרת שם היישוב מהסוף, אם צורף
    text = re.sub(r"\s*,\s*[^,]*$", "", text) if text.count(",") >= 1 else text
    match = _HOUSE_RE.match(text.strip())
    if not match:
        return "", ""
    return match.group("street").strip(), match.group("house").strip()


def build_external_key(city: str, record: dict[str, Any]) -> str:
    """מפתח יציב לעסקה, לצורך ריצה חוזרת על אותם חודשים.

    מזהה מהמקור כשיש; אחרת טביעת אצבע מהשדות שמזהים עסקה בפועל. ‏sha256
    ולא הצירוף עצמו — הכתובת היא מידע מזהה, והמפתח מופיע בלוגים.
    """
    deal_id = _clean(pick(record, "deal_id"))
    if deal_id:
        return f"nadlan:{city}:{deal_id}"

    parts = "|".join([
        city,
        _clean(pick(record, "address")),
        _clean(pick(record, "date")),
        _clean(pick(record, "price")),
        _clean(pick(record, "size_sqm")),
    ])
    return "nadlan:sha256:" + hashlib.sha256(parts.encode("utf-8")).hexdigest()[:32]


class SkipRecord(Exception):
    """הרשומה אינה ניתנת לפענוח. ההודעה נספרת ומודפסת מקובצת."""


def normalize(city: str, record: dict[str, Any], *, not_before: date) -> dict[str, Any]:
    price = _number(pick(record, "price"))
    if price is None or price <= 0:
        raise SkipRecord("מחיר חסר או לא מספרי")

    sold_at = _parse_date(pick(record, "date"))
    if sold_at is None:
        raise SkipRecord("תאריך עסקה חסר או בפורמט לא מוכר")
    if sold_at > date.today():
        raise SkipRecord("תאריך עסקה עתידי")
    if sold_at < not_before:
        raise SkipRecord("מחוץ לחלון הזמן")

    address = _clean(pick(record, "address"))
    street, house = split_address(address)

    raw_type = _clean(pick(record, "asset_type"))
    size = _number(pick(record, "size_sqm"))
    rooms = _number(pick(record, "rooms"))
    year = _number(pick(record, "year_built"))

    return {
        "external_key": build_external_key(city, record),
        "source": "tax_authority",
        "city": city,
        "neighborhood": _clean(pick(record, "neighborhood")) or None,
        "address": address or None,
        "street": street or None,
        "house_number": house or None,
        "gush": _clean(pick(record, "gush")) or None,
        "helka": _clean(pick(record, "helka")) or None,
        "property_type": TYPE_MAP.get(raw_type, raw_type) or None,
        "rooms": rooms,
        # שטח 0 הוא "לא דווח" במקור, ולא דירה בגודל אפס. הוא היה מתגלגל
        # ל-price_per_sqm של אינסוף.
        "size_sqm": size if (size and size > 0) else None,
        "floor": _clean(pick(record, "floor")) or None,
        "year_built": int(year) if year and 1800 < year <= date.today().year else None,
        "sale_price": price,
        "sold_at": sold_at.isoformat(),
        "raw": record,
    }
