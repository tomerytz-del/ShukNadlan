"""מנהל הסריקה — מריץ את כל ה-probes, אוסף, ושומר.

**‏probe שנופלת אינה מפילה את הסריקה.** היא נרשמת ככישלון, הסריקה
ממשיכה, וה-probes האחרות עדיין מדווחות. הסיבה פשוטה: סוכן שמפסיק
לעבוד כי שאילתה אחת נכשלה הוא סוכן שיום אחד יפסיק לדווח על הכול.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .config import Settings
from .db import Scanner
from .models import Finding, ProbeResult
from .probes import PROBES

log = logging.getLogger(__name__)


@dataclass
class Context:
    settings: Settings
    root: Path
    db: Any = None
    _checks: int = 0

    def count(self) -> None:
        """מונה בדיקות. ‏probe שרצה ולא ספרה דבר לא באמת בדקה."""
        self._checks += 1


def scan(settings: Settings, root: Path) -> tuple[list[ProbeResult], list[Finding]]:
    ctx = Context(settings=settings, root=root)
    scanner: Scanner | None = None

    needs_db = any(needs for name, _, needs in PROBES
                   if not settings.only or name in settings.only)
    if needs_db and settings.db_url:
        scanner = Scanner(settings.db_url, settings.statement_timeout_ms)
        scanner.connect()
        ctx.db = scanner

    results: list[ProbeResult] = []
    all_findings: list[Finding] = []

    try:
        for name, fn, requires_db in PROBES:
            if settings.only and name not in settings.only:
                continue
            if requires_db and ctx.db is None:
                results.append(ProbeResult(
                    name=name, ok=False,
                    error="אין חיבור למסד — SUPABASE_DB_URL ריק"))
                continue

            ctx._checks = 0
            started = time.perf_counter()
            try:
                found = list(fn(ctx))
                results.append(ProbeResult(
                    name=name, ok=True, findings=found,
                    checks=ctx._checks,
                    duration_ms=int((time.perf_counter() - started) * 1000)))
                all_findings.extend(found)
                log.info("‏%s: %d ממצאים מתוך %d בדיקות",
                         name, len(found), ctx._checks)
            except Exception as err:  # noqa: BLE001 — כישלון probe אינו קטלני
                log.exception("‏probe %s נפלה", name)
                results.append(ProbeResult(
                    name=name, ok=False, error="%s: %s" % (type(err).__name__, err),
                    checks=ctx._checks,
                    duration_ms=int((time.perf_counter() - started) * 1000)))
    finally:
        if scanner is not None:
            scanner.close()

    # מיון לפי חומרה ואז לפי תחום — זה הסדר שבו הדוח נקרא.
    all_findings.sort(key=lambda f: (f.rank, f.area, f.subject))
    return results, all_findings
