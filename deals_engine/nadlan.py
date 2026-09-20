"""המתאם ל-nadlan.gov.il — **הקובץ היחיד שיודע משהו על המקור**.

‏nadlan.gov.il הוא האתר של מאגר עסקאות המקרקעין. הנתונים מגיעים מדיווחי
מס שבח ומס רכישה לרשות המיסים, ולכן `sale_price` שם הוא **מחיר עסקה
בפועל** ולא מחיר פרסום. זו כל הסיבה שהמנוע הזה קיים.

‏================================================================
‏⚠  נקודות הקצה כאן טרם אומתו מול תשובה חיה.
‏================================================================

הסביבה שבה נכתב הקוד חסומה מ-nadlan.gov.il (מדיניות רשת יוצאת), בדיוק
כפי שקרה עם רשם התאגידים ב-`docs/new-projects.md`.

הקובץ הזה נושא את ה**תעבורה** בלבד — ‏`ENDPOINTS` ו-`NadlanClient`.
אוצר המילים של המקור (שמות השדות והשליפה מהם) יושב ב-`fields.py`,
שאינו מייבא ספריית HTTP: ‏`normalize.py` ובדיקת ה-CI נשענים עליו, והם
פונקציות טהורות שאסור להן לגרור תלות ברשת.

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
from .fields import FIELDS, REQUIRED, extract_records, missing_fields, pick

log = logging.getLogger(__name__)

BASE = "https://www.nadlan.gov.il"

# ---------------------------------------------------------------------------
# נקודות הקצה. שתי קריאות: פתרון שם יישוב למזהה, ואז דפדוף בעסקאות שלו.
# ---------------------------------------------------------------------------
ENDPOINTS = {
    "resolve": f"{BASE}/Nadlan.REST/Main/GetDataByQuery",
    "deals":   f"{BASE}/Nadlan.REST/Main/GetAssestAndDeals",
}

class NadlanError(RuntimeError):
    """המקור לא ענה, או ענה במשהו שאינו JSON."""






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

    def post(self, url: str, payload: dict[str, Any]) -> Any:
        """קריאה אחת, עם ניסיונות חוזרים ונסיגה מעריכית.

        ציבורית ולא `_post`: ‏`--probe` קורא לה ישירות כדי להדפיס את הגוף
        הגולמי לפני כל ניסיון לפרש אותו.

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
        data = self.post(ENDPOINTS["resolve"], {"query": city})
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
            data = self.post(ENDPOINTS["deals"], payload)

            records = extract_records(data)
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


# ‏FIELDS, REQUIRED, pick, missing_fields ו-extract_records מיוצאים מחדש
# כאן כי הם היו בקובץ הזה, ומי שמייבא אותם ממנו אינו טועה — אוצר המילים
# והתעבורה הם שני צדדים של אותו מתאם. ההגדרה עצמה ב-fields.py.
__all__ = [
    "BASE", "ENDPOINTS", "FIELDS", "REQUIRED", "NadlanClient", "NadlanError",
    "extract_records", "missing_fields", "pick",
]
