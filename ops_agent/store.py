"""שמירת הממצאים — ובעיקר, הסגירה האוטומטית.

## למה זה לא רק insert

ממצא שנכתב בכל סריקה מחדש הוא רשימה שמתארכת לנצח, ובתוך שבוע איש לא
קורא אותה. מה שהופך אותה לניטור הוא ההתאמה מול הסריקה הקודמת:

* ממצא שכבר קיים — מתעדכן. ‏`first_seen` **לא** משתנה, כי השאלה "מתי
  זה התחיל" היא לרוב השאלה החשובה.
* ממצא חדש — נכנס, ומסומן כחדש בדשבורד.
* ממצא שלא חזר — **נסגר** (`resolved_at`). זה מה שמאפשר לראות שמשהו
  תוקן בלי שאיש סימן דבר.

## הסייג שבלעדיו הסגירה משקרת

ממצא נסגר רק אם ה-probe שאחראי עליו **רץ בהצלחה**. ‏probe של אבטחה
שקרס מחזיר אפס ממצאים, ו"אפס ממצאים" מהמקור הזה נראה בדיוק כמו "הכול
תקין". בלי הסייג הזה, בדיקה שבורה הייתה מדווחת על תיקון של כל חורי
האבטחה בבת אחת.
"""

from __future__ import annotations

import json
import logging
from typing import Iterable, Sequence

from .db import Writer
from .models import Finding, ProbeResult

log = logging.getLogger(__name__)

# אילו קודים שייכים לאיזו probe. **קידומות קוד ולא תחומים**, כי `health`
# משותף לשלוש probes שונות — ו"נסגר כי ה-probe רצה" חייב להיות מדויק ברמת
# הקוד, אחרת בדיקת המסד הייתה סוגרת ממצא של בדיקת הצינור רק מפני שרצה.
#
# קוד חדש שאינו מופיע כאן פשוט לא ייסגר לעולם אוטומטית. זו ברירת המחדל
# הבטוחה מבין השתיים: ממצא ישן שנשאר פתוח הוא מטרד, ממצא שנסגר בטעות הוא
# בעיה שנעלמה מהמסך.
PROBE_CODES = {
    # ‏"queue_" מכסה גם queue_stuck וגם queue_blocked
    "database": ("cron_", "queue_", "engine_", "slow_query", "heavy_query",
                 "seq_scan", "table_bloat", "cache_hit_low", "unused_index",
                 "unindexed_fk", "connections_", "idle_in_transaction",
                 "stat_statements_"),
    # ‏"public_" מכסה גם public_bucket וגם public_edge_function
    "security": ("rls_", "anon_", "secdef_", "public_", "key_in_",
                 "target_blank", "mixed_content", "open_edge_function",
                 "open_write_policy", "headers_missing", "csp_report_only"),
    "behavior": ("views_without_leads", "pwa_", "alerts_failing", "leads_",
                 "listings_", "saved_search_"),
    "pipeline": ("migration_", "workflow_", "actions_"),
    # ‏"page_weight" נשאר ברשימה אף שהבדיקה כבר אינה מייצרת אותו: זה
    # בדיוק מה שסוגר את הממצאים הישנים שנמדדו ביחידה הקודמת (קובץ לא
    # דחוס) בסריקה הראשונה אחרי המעבר ל-"page_transfer".
    # ‏"page_weight" ו-"heavy_asset" נשארים ברשימה אף שהבדיקות כבר אינן
    # מייצרות אותם: זה מה שסוגר את השורות הישנות שנמדדו ביחידה הקודמת
    # (קובץ לא דחוס) בסריקה הראשונה אחרי המעבר.
    "frontend": ("page_weight", "page_transfer", "heavy_image", "heavy_asset",
                 "asset_transfer", "eager_images",
                 "assets_no_cache", "slow_ttfb", "slow_page", "no_compression",
                 "page_unreachable", "page_error"),
}


class FindingStore:
    def __init__(self, dsn: str, statement_timeout_ms: int = 15_000) -> None:
        self._writer = Writer(dsn, statement_timeout_ms)

    def save(self, results: Sequence[ProbeResult],
             findings: Iterable[Finding]) -> dict:
        """כותבת סריקה שלמה ומחזירה את התקציר."""
        findings = list(findings)
        healthy = tuple(r.name for r in results if r.ok)
        # קודים שמותר לסגור: רק אלה ששייכים ל-probe שרץ בהצלחה
        closable = [code for probe in healthy for code in PROBE_CODES.get(probe, ())]

        summary = {
            "total": len(findings),
            "by_severity": {},
            "new": 0,
            "resolved": 0,
        }
        for f in findings:
            summary["by_severity"][f.severity] = \
                summary["by_severity"].get(f.severity, 0) + 1

        with self._writer.session() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    insert into public.ops_scans
                           (started_at, finished_at, ok, probes, counts)
                    values (now(), now(), %s, %s::jsonb, %s::jsonb)
                    returning id
                    """,
                    (
                        all(r.ok for r in results),
                        json.dumps([
                            {"name": r.name, "ok": r.ok, "error": r.error,
                             "findings": len(r.findings), "checks": r.checks,
                             "duration_ms": r.duration_ms}
                            for r in results], ensure_ascii=False),
                        json.dumps(summary["by_severity"], ensure_ascii=False),
                    ),
                )
                scan_id = cur.fetchone()[0]

                seen: list[str] = []
                for f in findings:
                    row = f.as_row()
                    seen.append(row["key"])
                    cur.execute(
                        """
                        insert into public.ops_findings
                               (key, area, code, severity, title, detail, subject,
                                suggestion, metric, metric_unit, evidence,
                                first_seen, last_seen, scan_id, resolved_at,
                                prev_metric)
                        values (%(key)s, %(area)s, %(code)s, %(severity)s,
                                %(title)s, %(detail)s, %(subject)s, %(suggestion)s,
                                %(metric)s, %(metric_unit)s, %(evidence)s::jsonb,
                                now(), now(), %(scan_id)s, null, null)
                        on conflict (key) do update set
                            severity    = excluded.severity,
                            title       = excluded.title,
                            detail      = excluded.detail,
                            suggestion  = excluded.suggestion,
                            -- הערך הקודם נשמר לפני הדריסה. זה כל מנגנון המגמה:
                            -- בלעדיו אפשר לדעת שיש בעיה, לא אם היא מחמירה.
                            prev_metric = public.ops_findings.metric,
                            metric      = excluded.metric,
                            metric_unit = excluded.metric_unit,
                            evidence    = excluded.evidence,
                            last_seen   = now(),
                            scan_id     = excluded.scan_id,
                            -- ממצא שחזר אחרי שנסגר נפתח מחדש, ו-first_seen
                            -- מתאפס: זו הופעה חדשה ולא המשך של הישנה.
                            first_seen  = case
                                            when public.ops_findings.resolved_at
                                                 is not null then now()
                                            else public.ops_findings.first_seen
                                          end,
                            resolved_at = null
                        """,
                        {**row, "scan_id": scan_id},
                    )

                if closable:
                    cur.execute(
                        """
                        update public.ops_findings
                           set resolved_at = now()
                         where resolved_at is null
                           and not (key = any(%s))
                           and exists (
                                 select 1 from unnest(%s::text[]) pfx
                                  where code like pfx || '%%')
                        """,
                        (seen or [""], closable),
                    )
                    summary["resolved"] = cur.rowcount

                cur.execute(
                    """
                    select count(*) from public.ops_findings
                     where resolved_at is null and first_seen >= now() - interval '1 hour'
                    """
                )
                summary["new"] = int(cur.fetchone()[0] or 0)

        summary["scan_id"] = scan_id
        return summary
