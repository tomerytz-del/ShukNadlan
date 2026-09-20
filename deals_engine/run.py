"""התזמורת: משיכה -> נרמול -> כתיבה, עיר אחת בכל פעם."""

from __future__ import annotations

import logging
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

from .config import Settings
from .nadlan import NadlanClient, NadlanError, missing_fields
from .normalize import SkipRecord, normalize
from .store import DealsStore

log = logging.getLogger(__name__)


@dataclass
class CityResult:
    city: str
    seen: int = 0
    written: int = 0
    skipped: int = 0
    reasons: Counter = field(default_factory=Counter)
    error: str | None = None

    @property
    def unparsable(self) -> int:
        """דילוגים שמעידים על מיפוי שבור, להבדיל מסינון תקין.

        "מחוץ לחלון הזמן" הוא החלטה שלנו ולא כשל של המקור, ולכן הוא אינו
        נספר כאן — אחרת משיכה של שנתיים אחורה מתוך עשר הייתה נראית כמו
        מיפוי מנותץ.
        """
        return sum(n for reason, n in self.reasons.items()
                   if reason != "מחוץ לחלון הזמן")


def run_city(
    client: NadlanClient,
    store: DealsStore | None,
    settings: Settings,
    city: str,
    *,
    limit: int | None = None,
) -> CityResult:
    result = CityResult(city=city)
    run_id = store.start_run(city) if store else None
    not_before = date.today() - timedelta(days=int(settings.months_back * 30.44))
    batch: list[dict] = []

    try:
        for record in client.iter_deals(city):
            result.seen += 1
            try:
                batch.append(normalize(city, record, not_before=not_before))
            except SkipRecord as skip:
                result.skipped += 1
                result.reasons[str(skip)] += 1
                # רשומה ראשונה שנפלה מודפסת במלואה: זה מה שמראה מייד
                # ששם שדה השתנה, במקום מונה שאומר רק "1,203 דילוגים".
                if result.skipped == 1:
                    log.warning("הרשומה הראשונה שנדחתה (%s). שדות חסרים: %s",
                                skip, ", ".join(missing_fields(record)) or "אין")
                continue

            if limit and len(batch) >= limit:
                break

        # סף הפענוח נבדק **לפני** הכתיבה: מאגר חלקי שנכתב תחת
        # ‏price_basis='official' גרוע ממאגר ריק, וזו כל הסיבה לסף.
        considered = result.seen - result.reasons.get("מחוץ לחלון הזמן", 0)
        if considered and result.unparsable / considered > settings.max_unparsable_ratio:
            raise NadlanError(
                f"{result.unparsable} מתוך {considered} רשומות ב{city} לא נפענחו "
                f"({result.unparsable / considered:.0%}) — סביר שמיפוי השדות "
                f"ב-deals_engine/nadlan.py אינו תואם עוד למקור. "
                f"הרצו: python deals_scraper.py --probe {city}"
            )

        if store and batch:
            result.written = store.upsert_deals(batch)
        elif batch:
            result.written = 0
            log.info("הרצה יבשה — %d עסקאות ב%s לא נכתבו", len(batch), city)

    except Exception as err:            # noqa: BLE001 — נרשם ומדווח, לא נבלע
        result.error = str(err)
        log.error("הייבוא ל%s נכשל: %s", city, err)

    finally:
        if store:
            store.finish_run(
                run_id,
                finished_at=datetime.now(timezone.utc).isoformat(),
                status="failed" if result.error else "ok",
                rows_seen=result.seen,
                rows_written=result.written,
                rows_skipped=result.skipped,
                error=(result.error or None),
            )

    return result


def summarize(results: list[CityResult]) -> str:
    lines = []
    for r in results:
        head = f"{r.city}: {r.seen} נראו · {r.written} נכתבו · {r.skipped} דולגו"
        if r.error:
            head += f" · שגיאה: {r.error}"
        lines.append(head)
        for reason, n in r.reasons.most_common(5):
            lines.append(f"    {n:>5}  {reason}")
    return "\n".join(lines) or "לא נבדקה אף עיר"
