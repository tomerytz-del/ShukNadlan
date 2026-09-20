"""שכבת הגישה ל-Supabase של מנוע העסקאות הרשמיות.

המנוע מתחבר עם SERVICE_ROLE_KEY — מפתח שעוקף RLS — ולכן הוא רץ אך ורק
בצד השרת (GitHub Actions). אסור להטמיע את המפתח הזה בדפדפן.

‏market_deals_official היא טבלה ללא policy כלל: ‏anon ו-authenticated
אינם רואים אותה, והקריאה היחידה אליה היא מ-agent_cma_report שהיא
‏security definer. המפתח הזה הוא הדרך היחידה לכתוב אליה.
"""

from __future__ import annotations

import logging
from typing import Any, Sequence

from postgrest.exceptions import APIError
from supabase import Client, create_client

from .config import Settings

log = logging.getLogger(__name__)

# ‏PostgREST מגביל את גודל הגוף, ו-`raw` מגדיל כל שורה. מנות קטנות.
_UPSERT_CHUNK = 100


class DealsStore:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client: Client = create_client(
            settings.supabase_url, settings.supabase_service_role_key
        )

    # ------------------------------------------------------------- יומן הרצה

    def start_run(self, city: str) -> str | None:
        """פותח שורת יומן ומחזיר את המזהה שלה.

        כישלון כאן אינו עוצר את ההרצה: היומן הוא תיעוד, ולא התנאי לעבוד.
        """
        try:
            result = (
                self._client.table("market_deal_import_runs")
                .insert({"source": "tax_authority", "city": city, "status": "running"})
                .execute()
            )
            return (result.data or [{}])[0].get("id")
        except APIError as err:
            log.warning("פתיחת שורת יומן נכשלה: %s", err)
            return None

    def finish_run(self, run_id: str | None, **fields: Any) -> None:
        if not run_id:
            return
        try:
            self._client.table("market_deal_import_runs") \
                .update(fields).eq("id", run_id).execute()
        except APIError as err:
            log.warning("סגירת שורת יומן נכשלה: %s", err)

    # ------------------------------------------------------------------ כתיבה

    def upsert_deals(self, rows: Sequence[dict[str, Any]]) -> int:
        """כותב עסקאות לפי external_key. מחזיר כמה שורות נכתבו.

        ‏upsert ולא insert: ההרצה חוזרת על אותם חודשים בכוונה — רשות
        המיסים מפרסמת עסקה חודשים אחרי שנסגרה, ומשיכה של חלון צר הייתה
        מפספסת בדיוק את מה שהתווסף בדיעבד.

        ‏lat/lng ו-geocode_* אינם ברשימת השדות שנכתבים בעדכון: הם הושלמו
        על ידי geocode-backfill אחרי הייבוא הראשון, וכתיבה חוזרת הייתה
        מוחקת אותם ומחזירה את העסקה לתור בכל הרצה.
        """
        written = 0
        for start in range(0, len(rows), _UPSERT_CHUNK):
            chunk = rows[start:start + _UPSERT_CHUNK]
            try:
                result = (
                    self._client.table("market_deals_official")
                    .upsert(list(chunk), on_conflict="external_key")
                    .execute()
                )
                written += len(result.data or chunk)
            except APIError as err:
                # מנה שנפלה אינה מפילה את השאר — אבל היא כן נספרת ומדווחת,
                # ו-run.py מחזיר קוד יציאה שאינו אפס כשהיו כשלים.
                log.error("כתיבת מנה של %d עסקאות נכשלה: %s", len(chunk), err)
                raise
        return written

    def count_official(self, city: str) -> int:
        try:
            result = (
                self._client.table("market_deals_official")
                .select("id", count="exact", head=True)
                .eq("city", city)
                .execute()
            )
            return result.count or 0
        except APIError as err:
            log.warning("ספירת העסקאות ב%s נכשלה: %s", city, err)
            return 0
