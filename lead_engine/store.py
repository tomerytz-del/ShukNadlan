"""שכבת הגישה ל-Supabase: מקורות, מניעת כפילויות ושמירת לידים.

הסקרייפר מתחבר עם SERVICE_ROLE_KEY — מפתח שעוקף RLS — ולכן הוא רץ אך ורק
בצד השרת (GitHub Actions). אסור להטמיע את המפתח הזה בדפדפן.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Sequence

from postgrest.exceptions import APIError
from supabase import Client, create_client

from .config import Settings
from .models import FeedEntry, LeadAnalysis

log = logging.getLogger(__name__)

# ‏PostgREST מגביל את אורך ה-query string, ולכן בדיקת הכפילויות נעשית במנות.
_URL_CHUNK = 100


class LeadStore:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client: Client = create_client(
            settings.supabase_url, settings.supabase_service_role_key
        )

    # ---------------------------------------------------------------- מקורות

    def active_sources(self) -> list[dict]:
        """מחזיר את הפידים הפעילים כפי שהוגדרו בדף הניהול."""
        try:
            result = (
                self._client.table(self._settings.sources_table)
                .select("id, name, url, source_type")
                .eq("active", True)
                .order("created_at")
                .execute()
            )
            return result.data or []
        except APIError as err:
            log.error("קריאת טבלת המקורות נכשלה: %s", err)
            return []

    def record_source_run(
        self,
        source_id: str | None,
        *,
        items_seen: int,
        leads_created: int,
        status: str,
        error: str | None = None,
    ) -> None:
        """מעדכן את הטלמטריה שמוצגת ליד כל מקור בדף הניהול."""
        if not source_id:
            return
        try:
            current = (
                self._client.table(self._settings.sources_table)
                .select("items_seen, leads_created")
                .eq("id", source_id)
                .single()
                .execute()
            ).data or {}
            self._client.table(self._settings.sources_table).update(
                {
                    "last_fetched_at": _now_iso(),
                    "last_status": status,
                    "last_error": error,
                    "items_seen": (current.get("items_seen") or 0) + items_seen,
                    "leads_created": (current.get("leads_created") or 0) + leads_created,
                }
            ).eq("id", source_id).execute()
        except APIError as err:
            log.warning("עדכון סטטוס המקור %s נכשל: %s", source_id, err)

    # ------------------------------------------------------- מניעת כפילויות

    def existing_urls(self, urls: Sequence[str]) -> set[str]:
        """
        מחזיר את הקישורים שכבר קיימים בטבלת הלידים.

        זהו שלב מניעת הכפילויות: הוא רץ *לפני* כל פנייה ל-Claude, כך שפוסט
        שכבר נותח בהרצה קודמת לא עולה שוב כסף. אינדקס ה-UNIQUE על source_url
        הוא רשת הביטחון מפני הרצות חופפות.
        """
        found: set[str] = set()
        for start in range(0, len(urls), _URL_CHUNK):
            chunk = list(urls[start : start + _URL_CHUNK])
            try:
                result = (
                    self._client.table(self._settings.leads_table)
                    .select("source_url")
                    .in_("source_url", chunk)
                    .execute()
                )
            except APIError as err:
                # אם הבדיקה נכשלה עדיף לעצור מאשר להכניס כפילויות בטעות —
                # מחזירים את כל המנה כ"קיימת" והפריטים ייבדקו בהרצה הבאה.
                log.error("בדיקת הכפילויות נכשלה: %s", err)
                found.update(chunk)
                continue
            found.update(row["source_url"] for row in (result.data or []))
        return found

    # --------------------------------------------------------------- שמירה

    def insert_lead(self, entry: FeedEntry, analysis: LeadAnalysis) -> bool:
        """שומר ליד אחד. מחזיר False אם היה כפול או אם השמירה נכשלה."""
        payload = build_lead_row(entry, analysis, model=self._settings.model)
        try:
            self._client.table(self._settings.leads_table).insert(payload).execute()
            return True
        except APIError as err:
            if err.code == "23505":  # unique_violation — הרצה מקבילה הקדימה אותנו
                log.info("הליד כבר קיים: %s", entry.source_url)
            else:
                log.error("שמירת הליד %s נכשלה: %s", entry.source_url, err)
            return False


def build_lead_row(
    entry: FeedEntry, analysis: LeadAnalysis, *, model: str
) -> dict:
    """ממפה FeedEntry + LeadAnalysis לשורה בטבלת הלידים."""
    return {
        "source_url": entry.source_url,
        "source_id": entry.source_id,
        "source_name": entry.source_name,
        "published_at": entry.published_at.isoformat() if entry.published_at else None,
        "raw_title": entry.title or None,
        "raw_content": entry.content or None,
        "is_lead": analysis.is_lead,
        "lead_side": analysis.lead_side,
        "city": analysis.city,
        "neighborhood": analysis.neighborhood,
        "property_type": analysis.property_type,
        "rooms": analysis.rooms,
        "floor": analysis.floor,
        "price_budget": analysis.price_budget,
        "urgency_level": analysis.urgency_level,
        "lead_quality_score": analysis.lead_quality_score,
        "teaser_title": analysis.teaser_title,
        "teaser_description": analysis.teaser_description,
        "status": "new",
        "analysis": analysis.model_dump(mode="json"),
        "model": model,
        "analyzed_at": _now_iso(),
    }


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
