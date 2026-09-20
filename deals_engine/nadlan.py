"""המתאם ל-nadlan.gov.il — **הקובץ היחיד שיודע משהו על המקור**.

‏nadlan.gov.il הוא האתר של מאגר עסקאות המקרקעין. הנתונים מגיעים מדיווחי
מס שבח ומס רכישה לרשות המיסים, ולכן `sale_price` שם הוא **מחיר עסקה
בפועל** ולא מחיר פרסום. זו כל הסיבה שהמנוע הזה קיים.

‏================================================================
‏⚠  מיפוי השדות כאן טרם אומת מול תשובה חיה.
‏================================================================

הסביבה שבה נכתב הקוד חסומה מ-nadlan.gov.il (מדיניות רשת יוצאת), בדיוק
כפי שקרה עם רשם התאגידים ב-`docs/new-projects.md`. המיפוי למטה הוא מה
שמתועד על ה-API, והוא מרוכז ב-`FIELDS` וב-`ENDPOINTS` בלבד — כל השאר
בקובץ הזה ובשאר המנוע אינו תלוי בשמות השדות.

**האימות הוא פקודה אחת ממכונה עם גישה:**

    python deals_scraper.py --probe עפולה

היא מדפיסה את ה-JSON הגולמי של שתי הקריאות, את המפתחות שחזרו בפועל, ואת
המפתחות מתוך `FIELDS` שלא נמצאו. אם משהו לא תואם — מתקנים את `FIELDS`
כאן, ושום קובץ אחר לא נוגע. ‏`docs/market-deals-official.md` מתעד את
הבדיקה הזו כשלב חובה לפני שה-workflow נדלק.

**למה לא ניחוש שקט.** רשומה שחסר בה שדה חובה נזרקת ונספרת, ולא מנוחשת:
עסקה עם מחיר שנקרא מהשדה הלא נכון נכנסת למאגר כ-`price_basis='official'`
— כלומר בדיוק כמספר שהדוח סומך עליו הכי הרבה. עדיף מאגר ריק על מאגר
שקרי, וזו בדיוק הנקודה שבה עמדנו לפני שהמאגר הזה נוסף.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any, Iterator

import requests

from .config import Settings

log = logging.getLogger(__name__)

BASE = "https://www.nadlan.gov.il"

# ---------------------------------------------------------------------------
# נקודות הקצה. שתי קריאות: פתרון שם יישוב למזהה, ואז דפדוף בעסקאות שלו.
# ---------------------------------------------------------------------------
ENDPOINTS = {
    "resolve": f"{BASE}/Nadlan.REST/Main/GetDataByQuery",
    "deals":   f"{BASE}/Nadlan.REST/Main/GetAssestAndDeals",
}

# ---------------------------------------------------------------------------
# מיפוי השדות. **זה מה שמתקנים אחרי `--probe`, ורק זה.**
#
# הערך הוא רשימה של שמות אפשריים לפי סדר עדיפות — המקור שינה שמות בעבר,
# ורשימה עולה פחות מהתנגשות בין שתי גרסאות.
# ---------------------------------------------------------------------------
FIELDS: dict[str, tuple[str, ...]] = {
    # זהות העסקה במקור — הבסיס ל-external_key
    "deal_id":       ("KEYVALUE", "DEALID", "ID"),
    # מחיר העסקה בשקלים
    "price":         ("DEALAMOUNT", "DEALSUM", "PRICE"),
    # תאריך העסקה
    "date":          ("DEALDATE", "DEALDATETIME", "DEALDATESTR"),
    # כתובת מלאה כפי שהמקור כותב אותה
    "address":       ("FULLADRESS", "DISPLAYADRESS", "ADDRESS"),
    # תיאור סוג הנכס ("דירה", "דירת גן", "בית פרטי"…)
    "asset_type":    ("DEALNATUREDESCRIPTION", "ASSETTYPE", "PROPERTYTYPE"),
    # שטח במ"ר
    "size_sqm":      ("DEALNATURE", "ASSETAREA", "AREA"),
    "rooms":         ("ASSETROOMNUM", "ROOMS", "ROOMNUM"),
    "floor":         ("FLOORNO", "FLOOR"),
    "year_built":    ("BUILDINGYEAR", "YEARBUILT"),
    "gush":          ("GUSH", "GUSH_ID"),
    "helka":         ("HELKA", "PARCEL"),
    "neighborhood":  ("NEIGHBORHOODNAME", "NEIGHBORHOOD"),
}

# בלי אלה אין עסקה. ראו למה בראש הקובץ.
REQUIRED = ("deal_id", "price", "date")


class NadlanError(RuntimeError):
    """המקור לא ענה, או ענה במשהו שאינו JSON."""


def pick(record: dict[str, Any], field: str) -> Any:
    """הערך הראשון שנמצא מבין השמות האפשריים של השדה."""
    for name in FIELDS.get(field, ()):
        if name in record and record[name] not in (None, ""):
            return record[name]
        # המקור אינו עקבי ברישיות בין נקודות קצה
        for key in record:
            if key.upper() == name.upper() and record[key] not in (None, ""):
                return record[key]
    return None


def missing_fields(record: dict[str, Any]) -> list[str]:
    """אילו שדות מתוך FIELDS לא נמצאו ברשומה. משמש גם את --probe."""
    return [name for name in FIELDS if pick(record, name) is None]


class NadlanClient:
    def __init__(self, settings: Settings) -> None:
        self._s = settings
        self._session = requests.Session()
        self._session.headers.update({
            "User-Agent": settings.user_agent,
            "Accept": "application/json, text/plain, */*",
            "Content-Type": "application/json;charset=UTF-8",
            "Referer": f"{BASE}/",
        })

    # ------------------------------------------------------------------ רשת

    def _post(self, url: str, payload: dict[str, Any]) -> Any:
        """קריאה אחת, עם ניסיונות חוזרים ונסיגה מעריכית.

        מחזירה את גוף ה-JSON. גוף שאינו JSON הוא כשל ולא "אין תוצאות":
        עמוד שגיאה של WAF הוא HTML, ופענוח שקט שלו כרשימה ריקה היה מסיים
        את ההרצה ב-"0 עסקאות" ירוק.
        """
        last: Exception | None = None
        for attempt in range(1, self._s.retries + 1):
            try:
                res = self._session.post(
                    url, json=payload, timeout=self._s.request_timeout_seconds,
                )
                if res.status_code >= 500:
                    raise NadlanError(f"{url} החזיר {res.status_code}")
                res.raise_for_status()
                try:
                    return res.json()
                except json.JSONDecodeError as err:
                    raise NadlanError(
                        f"{url} החזיר גוף שאינו JSON ({res.headers.get('Content-Type')}): "
                        f"{res.text[:200]!r}"
                    ) from err
            except (requests.RequestException, NadlanError) as err:
                last = err
                if attempt < self._s.retries:
                    wait = 2 ** attempt
                    log.warning("ניסיון %d/%d ל-%s נכשל (%s) — המתנה %ds",
                                attempt, self._s.retries, url, err, wait)
                    time.sleep(wait)
        raise NadlanError(f"כל {self._s.retries} הניסיונות ל-{url} נכשלו: {last}")

    # --------------------------------------------------------------- שאילתות

    def resolve_city(self, city: str) -> dict[str, Any]:
        """שם יישוב -> האובייקט שהמקור מזהה לפיו את אזור החיפוש."""
        data = self._post(ENDPOINTS["resolve"], {"query": city})
        if not isinstance(data, dict):
            raise NadlanError(f"פתרון היישוב {city!r} החזיר {type(data).__name__} ולא אובייקט")
        return data

    def iter_deals(self, city: str) -> Iterator[dict[str, Any]]:
        """כל העסקאות של יישוב, עמוד אחר עמוד.

        עוצרת כשהעמוד ריק, כשהגענו ל-max_pages_per_city, או כשהמקור
        מחזיר את אותו עמוד פעמיים (קרה, והוא לולאה אינסופית).
        """
        scope = self.resolve_city(city)
        seen_first_ids: set[str] = set()

        for page in range(1, self._s.max_pages_per_city + 1):
            payload = dict(scope)
            payload["PageNo"] = page
            data = self._post(ENDPOINTS["deals"], payload)

            records = _extract_records(data)
            if not records:
                log.info("‏%s: עמוד %d ריק — סוף", city, page)
                return

            marker = str(pick(records[0], "deal_id") or records[0])
            if marker in seen_first_ids:
                log.warning("‏%s: עמוד %d חוזר על עצמו — עוצרים", city, page)
                return
            seen_first_ids.add(marker)

            log.info("‏%s: עמוד %d — %d רשומות", city, page, len(records))
            yield from records

            time.sleep(self._s.pause_between_requests_seconds)


def _extract_records(data: Any) -> list[dict[str, Any]]:
    """הרשומות מתוך גוף התשובה, בלי להניח מפתח עוטף אחד.

    המקור החזיר בעבר גם רשימה ישירה וגם אובייקט עם מפתח עוטף. במקום
    לנחש — מחפשים את רשימת המילונים הראשונה שיש בה שדה מחיר.
    """
    if isinstance(data, list):
        return [r for r in data if isinstance(r, dict)]
    if not isinstance(data, dict):
        return []

    for value in data.values():
        if isinstance(value, list) and value and isinstance(value[0], dict):
            if pick(value[0], "price") is not None or pick(value[0], "deal_id") is not None:
                return [r for r in value if isinstance(r, dict)]
    return []
