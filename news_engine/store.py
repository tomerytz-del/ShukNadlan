"""שכבת הגישה ל-Supabase של מנוע המבזקים.

המנוע מתחבר עם SERVICE_ROLE_KEY — מפתח שעוקף RLS — ולכן הוא רץ אך ורק בצד
השרת (GitHub Actions). אסור להטמיע את המפתח הזה בדפדפן.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, Sequence

from postgrest.exceptions import APIError
from supabase import Client, create_client

from .config import Settings
from .models import NewsAnalysis

log = logging.getLogger(__name__)

# ‏PostgREST מגביל את אורך ה-query string, ולכן בדיקת הכפילויות נעשית במנות.
_URL_CHUNK = 100


class NewsStore:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client: Client = create_client(
            settings.supabase_url, settings.supabase_service_role_key
        )

    # ---------------------------------------------------------------- מקורות

    def active_sources(self) -> list[dict]:
        """הפידים הפעילים, לפי הסדר שבו הוגדרו."""
        try:
            result = (
                self._client.table(self._settings.sources_table)
                .select("id, name, url, source_type, scope")
                .eq("active", True)
                .order("created_at")
                .execute()
            )
            return result.data or []
        except APIError as err:
            log.error("קריאת טבלת מקורות המבזקים נכשלה: %s", err)
            return []

    def record_source_run(
        self,
        source_id: str | None,
        *,
        items_seen: int,
        news_created: int,
        status: str,
        error: str | None = None,
    ) -> None:
        """מעדכן את הטלמטריה של המקור — כך רואים פיד שנשבר בלי לקרוא לוגים."""
        if not source_id:
            return
        try:
            current = (
                self._client.table(self._settings.sources_table)
                .select("items_seen, news_created")
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
                    "news_created": (current.get("news_created") or 0) + news_created,
                }
            ).eq("id", source_id).execute()
        except APIError as err:
            log.warning("עדכון סטטוס המקור %s נכשל: %s", source_id, err)

    # ------------------------------------------------------- מניעת כפילויות

    def existing_urls(self, urls: Sequence[str]) -> set[str]:
        """
        הקישורים שכבר קיימים בטבלה — כולל פריטים שנדחו.

        רץ *לפני* כל פנייה ל-Claude, כך שידיעה שכבר נותחה לא עולה כסף פעם
        שנייה. אינדקס ה-UNIQUE על source_url הוא רשת הביטחון מפני הרצות
        חופפות.
        """
        found: set[str] = set()
        for start in range(0, len(urls), _URL_CHUNK):
            chunk = list(urls[start : start + _URL_CHUNK])
            try:
                result = (
                    self._client.table(self._settings.items_table)
                    .select("source_url")
                    .in_("source_url", chunk)
                    .execute()
                )
            except APIError as err:
                # אם הבדיקה נכשלה עדיף לדלג מאשר לנתח מחדש על חשבון התקציב —
                # הפריטים ייבדקו שוב בהרצה הבאה.
                log.error("בדיקת הכפילויות נכשלה: %s", err)
                found.update(chunk)
                continue
            found.update(row["source_url"] for row in (result.data or []))
        return found

    def recent_story_keys(self, days: int) -> list[str]:
        """
        מפתחות האירועים שכבר *פורסמו* ברצועה בימים האחרונים.

        רק פריטים מפורסמים, במכוון: המטרה היא שאותו סיפור לא יופיע ברצועה
        פעמיים, ופריט שנדחה אינו ברצועה. אילו נספרו גם הנדחים, ידיעה חלשה
        שנדחתה בגלל ציון נמוך הייתה חוסמת סיקור טוב יותר של אותו אירוע
        שיגיע שעה אחר כך מאתר אחר.

        החלון קצר בכוונה: אירוע חדשותי נסקר במשך יום-יומיים ואז נגמר, ואילו
        חלון ארוך היה חוסם ידיעת המשך לגיטימית ("הריבית ירדה שוב") רק מפני
        שהיא דומה לאירוע מלפני חודש.
        """
        since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        try:
            result = (
                self._client.table(self._settings.items_table)
                .select("story_key")
                .eq("status", "published")
                .not_.is_("story_key", "null")
                .gte("published_at", since)
                .execute()
            )
        except APIError as err:
            # נכשל? עדיף לפרסם כפילות מאשר להפיל את ההרצה. הדדופ בתוך ההרצה
            # עצמה עדיין עובד, ולכן הנזק מוגבל לחפיפה בין הרצות.
            log.error("שליפת מפתחות האירועים נכשלה: %s", err)
            return []
        return [row["story_key"] for row in (result.data or []) if row.get("story_key")]

    # --------------------------------------------------------------- שמירה

    def insert_item(self, row: dict) -> bool:
        """שומר מבזק אחד. מחזיר False אם היה כפול או אם השמירה נכשלה."""
        try:
            self._client.table(self._settings.items_table).insert(row).execute()
            return True
        except APIError as err:
            if err.code == "23505":  # unique_violation — הרצה מקבילה הקדימה אותנו
                log.info("המבזק כבר קיים: %s", row.get("source_url"))
            else:
                log.error("שמירת המבזק %s נכשלה: %s", row.get("source_url"), err)
            return False


def build_news_row(
    *,
    source_url: str,
    source_id: str | None,
    source_name: str | None,
    published_at: Optional[datetime],
    raw_title: str,
    raw_content: str,
    image_url: str,
    analysis: NewsAnalysis,
    publish: bool,
    model: str | None,
) -> dict:
    """
    ממפה ידיעה מנותחת לשורה בטבלת המבזקים.

    ‏published_at נופל ל"עכשיו" כשהפיד לא מסר תאריך: העמודה היא NOT NULL,
    והיא גם הסדר של הרצועה — פריט בלי תאריך היה נעלם מהתצוגה לגמרי.
    ‏url ריק אינו חוסם פרסום, אבל אז הכרטיס במודאל אינו לחיץ.
    """
    return {
        "source_url": source_url,
        "source_id": source_id,
        "source_name": source_name,
        "headline": analysis.headline,
        "summary": analysis.summary or None,
        "url": source_url,
        "image_url": image_url or None,
        "category": analysis.category,
        "scope": analysis.scope,
        "story_key": analysis.story_key or None,
        "relevance_score": analysis.relevance_score,
        "published_at": (published_at or datetime.now(timezone.utc)).isoformat(),
        "status": "published" if publish else "rejected",
        "raw_title": raw_title or None,
        "raw_content": raw_content[:4000] if raw_content else None,
        "analysis": analysis.model_dump(mode="json"),
        "model": model,
        "analyzed_at": _now_iso(),
    }


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
