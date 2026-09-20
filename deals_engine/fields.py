"""אוצר המילים של המקור: שמות השדות, ואיך שולפים אותם מרשומה.

**הקובץ הזה אינו נוגע ברשת ואינו מייבא ספריית HTTP.** זו לא הקפדה
אסתטית: ‏`normalize.py` ו-`scripts/check_deals_normalize.py` נשענים עליו,
ובדיקת ה-CI שמריצה אותם היא בדיקה של פונקציות טהורות — בלי רשת, בלי
סודות ובלי התקנת תלויות. כשהשליפה והתעבורה ישבו באותו קובץ, ‏`import
requests` גרר את הבדיקה הטהורה לתוך תלות ב-HTTP והפיל אותה ב-CI.

התעבורה — ‏`NadlanClient` ונקודות הקצה — יושבת ב-`nadlan.py`.

**זה גם הקובץ שמתקנים כשהמקור משנה שמות שדות.** ראו `--probe` ואת
‏`docs/market-deals-official.md`.
"""

from __future__ import annotations

from typing import Any

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


def extract_records(data: Any) -> list[dict[str, Any]]:
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
