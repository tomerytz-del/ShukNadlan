#!/usr/bin/env python3
"""הסוכן התפעולי של שוק נדל"ן — סריקה אחת.

סורק את המערכת (מסד, אתר, קוד, צינור), מייצר ממצאים, שומר אותם ב-
‏`ops_findings`, ומדפיס תקציר ל-GITHUB_STEP_SUMMARY. הדשבורד של מנהל/ת
הפלטפורמה ב-CRM קורא מאותה טבלה.

    python ops_scan.py                    # סריקה מלאה + שמירה
    python ops_scan.py --dry-run          # סריקה בלי לכתוב למסד
    python ops_scan.py --only security    # probe אחת בלבד
    python ops_scan.py --only frontend --dry-run   # בלי מסד בכלל

יציאה 0 גם כשנמצאו ממצאים. הסוכן מדווח, הוא אינו שומר סף. מה שמפיל את
ההרצה הוא כישלון שלו עצמו — כדי ש"לא נמצא כלום" לעולם לא יתבלבל עם
"לא רצתי".

הפרטים והספים: `docs/ops-agent.md`.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path

from ops_agent.config import Settings
from ops_agent.models import SEVERITIES
from ops_agent.run import scan
from ops_agent.store import FindingStore

ROOT = Path(__file__).resolve().parent

SEVERITY_LABELS = {
    "critical": "חמור",
    "high": "גבוה",
    "medium": "בינוני",
    "low": "נמוך",
    "info": "מידע",
}


def main() -> int:
    parser = argparse.ArgumentParser(description="סריקה תפעולית של שוק נדל\"ן")
    parser.add_argument("--dry-run", action="store_true",
                        help="לסרוק ולהדפיס בלי לכתוב ל-ops_findings")
    parser.add_argument("--only", default="",
                        help="רשימת probes מופרדת בפסיקים")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.WARNING if args.quiet else logging.INFO,
        format="%(levelname)s %(message)s")

    settings = Settings.from_env()
    if args.dry_run:
        settings.dry_run = True
    if args.only:
        settings.only = tuple(p.strip() for p in args.only.split(",") if p.strip())

    if not settings.db_url and settings.only != ("frontend",):
        print("::error::הסוד SUPABASE_DB_URL ריק. זהו אותו סוד שמשמש את "
              "supabase_migrations.yml. פירוט: docs/supabase-migrations.md",
              file=sys.stderr)
        return 1

    results, findings = scan(settings, ROOT)

    failed = [r for r in results if not r.ok]
    counts = {s: sum(1 for f in findings if f.severity == s) for s in SEVERITIES}

    summary = {}
    if not settings.dry_run and settings.db_url:
        try:
            store = FindingStore(settings.db_url, settings.statement_timeout_ms)
            summary = store.save(results, findings)
        except Exception as err:  # noqa: BLE001
            # כישלון שמירה הוא כישלון אמיתי: הדשבורד יציג נתונים ישנים
            # ואיש לא יידע שהסריקה בכלל רצה.
            print("::error::שמירת הממצאים נכשלה: %s" % err, file=sys.stderr)
            _write_summary(results, findings, counts, {}, failed)
            return 1

    _write_summary(results, findings, counts, summary, failed)
    _write_outputs(counts, findings)

    for probe in failed:
        print("::warning::‏probe %s נכשלה: %s" % (probe.name, probe.error))

    # הסריקה עצמה נכשלה רק אם **כל** ה-probes נפלו. ‏probe אחת שנפלה
    # מדווחת כאזהרה ואינה מפילה — אחרת תקלת רשת חולפת הייתה מסתירה את
    # כל שאר הממצאים.
    return 1 if results and len(failed) == len(results) else 0


def _write_outputs(counts, findings) -> None:
    """פלטי ה-step, כדי שה-workflow יוכל להחליט אם להעיר מישהו.

    הדשבורד ב-CRM הוא הערוץ הרגיל. ‏Issue נפתח **רק** על ממצא חמור —
    כלומר אתר שלא נטען, טבלה בלי RLS או מפתח שדלף. התראה על כל ממצא
    היא התראה שמפסיקים לקרוא, וזה בדיוק המצב שבו החמור באמת נבלע.
    """
    path = os.environ.get("GITHUB_OUTPUT")
    if not path:
        return
    critical = [f for f in findings if f.severity == "critical"]
    lines = [
        "critical=%d" % counts.get("critical", 0),
        "high=%d" % counts.get("high", 0),
        "total=%d" % len(findings),
    ]
    # כותרות הממצאים החמורים, שורה לכל אחד, לגוף ה-Issue
    body = "\n".join("- %s" % f.title for f in critical[:20]) or "—"
    lines.append("critical_list<<EOF\n%s\nEOF" % body)
    try:
        with open(path, "a", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")
    except OSError:
        pass


def _write_summary(results, findings, counts, summary, failed) -> None:
    lines = ["### סריקה תפעולית", ""]

    head = " · ".join("%s: %d" % (SEVERITY_LABELS[s], counts[s])
                      for s in SEVERITIES if counts[s])
    lines.append(head or "לא נמצאו ממצאים.")
    if summary.get("resolved"):
        lines.append("")
        lines.append("נסגרו מאליהם מאז הסריקה הקודמת: **%d**." % summary["resolved"])
    lines.append("")

    lines.append("| בדיקה | מצב | בדיקות | ממצאים | זמן |")
    lines.append("|---|---|---|---|---|")
    for r in results:
        lines.append("| %s | %s | %d | %d | %dms |" % (
            r.name, "✅" if r.ok else "❌ " + (r.error or "")[:60],
            r.checks, len(r.findings), r.duration_ms))
    lines.append("")

    top = [f for f in findings if f.severity in ("critical", "high")][:15]
    if top:
        lines.append("#### מה דורש טיפול")
        lines.append("")
        lines.append("| חומרה | תחום | ממצא |")
        lines.append("|---|---|---|")
        for f in top:
            lines.append("| %s | %s | %s |" % (
                SEVERITY_LABELS[f.severity], f.area,
                f.title.replace("|", "\\|")))
        lines.append("")

    lines.append("הרשימה המלאה יושבת בדשבורד **בריאות וביצועים** "
                 "ב-CRM של מנהל/ת הפלטפורמה.")

    text = "\n".join(lines)
    print(text)
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        try:
            with open(path, "a", encoding="utf-8") as fh:
                fh.write(text + "\n")
        except OSError:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
