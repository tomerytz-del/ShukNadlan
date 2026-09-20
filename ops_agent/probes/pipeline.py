"""בריאות הצינור: ‏GitHub Actions, מיגרציות, ו-Edge Functions שנפרסו.

‏**למה זה חלק מניטור המערכת ולא עניין של מפתחים:** ה-HTML מתפרסם
ב-Netlify תוך שניות מהמיזוג, והסכימה נפרסת ב-workflow נפרד. ‏workflow
אדום אינו "רעש CI" — הוא מצב שבו הקוד באוויר והמסד מאחור. הסיפור המלא:
`docs/supabase-migrations.md`.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Iterator

from ..models import Finding


def run(ctx) -> Iterator[Finding]:
    yield from _migrations(ctx)
    yield from _actions(ctx)


def _migrations(ctx) -> Iterator[Finding]:
    """רשומת מיגרציה במסד שאין לה קובץ מקומי — הכשל שכבר שבר פרודקשן.

    כל כלי שמחיל DDL מחוץ לצינור (‏MCP, דשבורד, ‏psql ידני) רושם את
    ההחלה תחת version של **רגע ההרצה**. נוצרת רשומה בלי קובץ, ו-`db push`
    מסרב לרוץ בגללה — לכל המיגרציות שאחריה. הסכימה נכונה, האתר עובד,
    ורק הצינור מת. זה קרה, וזו הבדיקה שתתפוס את זה בפעם הבאה.
    """
    ctx.count()
    try:
        rows = ctx.db.rows(
            "select version from supabase_migrations.schema_migrations "
            "order by version")
    except Exception:
        return

    remote = {str(r["version"]) for r in rows}
    local = set()
    mig_dir = ctx.root / "supabase" / "migrations"
    if mig_dir.is_dir():
        for path in mig_dir.glob("*.sql"):
            local.add(path.name.split("_", 1)[0])
    if not local:
        return

    orphans = sorted(v for v in remote - local)
    if orphans:
        yield Finding(
            area="health", code="migration_orphan", severity="critical",
            subject="schema_migrations",
            title="%d רשומות מיגרציה בלי קובץ מקומי" % len(orphans),
            detail="הגרסאות: %s" % ", ".join(orphans[:10]),
            suggestion="‏db push יסרב לרוץ בגלל אלה — לכל המיגרציות, גם החדשות. "
                       "זה אומר שמישהו החיל DDL מחוץ לצינור. הטיפול המלא: "
                       "docs/supabase-migrations.md.",
            metric=float(len(orphans)), metric_unit="רשומות",
            evidence={"versions": orphans},
        )

    pending = sorted(v for v in local - remote)
    if pending:
        yield Finding(
            area="health", code="migration_pending", severity="high",
            subject="migrations_pending",
            title="%d מיגרציות שטרם הוחלו על הפרודקשן" % len(pending),
            detail="הגרסאות: %s" % ", ".join(pending[:10]),
            suggestion="הקוד עשוי כבר להיות באוויר בעוד הסכימה מאחור. לבדוק את "
                       "‏supabase_migrations.yml בלשונית Actions.",
            metric=float(len(pending)), metric_unit="מיגרציות",
            evidence={"versions": pending},
        )


def _actions(ctx) -> Iterator[Finding]:
    """שיעור הכישלון של כל workflow, ו-workflow מתוזמן ששתק."""
    settings = ctx.settings
    if not (settings.github_token and settings.github_repo):
        yield Finding(
            area="health", code="actions_unchecked", severity="info",
            subject="github_actions",
            title="בריאות ה-workflows לא נבדקה",
            detail="חסרים GITHUB_TOKEN או GITHUB_REPOSITORY.",
            suggestion="בהרצה מ-GitHub Actions שניהם קיימים אוטומטית. מקומית — "
                       "אפשר להתעלם.",
        )
        return

    try:
        import requests
    except ImportError:
        return

    t = settings.thresholds
    api = "https://api.github.com/repos/%s" % settings.github_repo
    headers = {"Authorization": "Bearer " + settings.github_token,
               "Accept": "application/vnd.github+json"}

    ctx.count()
    try:
        resp = requests.get(api + "/actions/workflows", headers=headers,
                            timeout=settings.http_timeout_s)
        resp.raise_for_status()
        workflows = resp.json().get("workflows", [])
    except Exception as err:
        yield Finding(
            area="health", code="actions_api_error", severity="low",
            subject="github_actions",
            title="לא ניתן לקרוא את מצב ה-workflows",
            detail=str(err),
            suggestion="לבדוק את הרשאות הטוקן (actions: read).",
        )
        return

    now = datetime.now(timezone.utc)
    for wf in workflows:
        if wf.get("state") != "active":
            continue
        ctx.count()
        try:
            # ‏**רק ענף ברירת המחדל.** בלי הסינון הזה כישלון בבדיקת CI על
            # ענף PR נספר כ"האוטומציה שבורה" — בזמן שהוא ההפך הגמור:
            # הבדיקה תפסה באג וחסמה אותו לפני המיזוג. כך נפתח ב-20.9.2026
            # ממצא בדרגה גבוהה על "נרמול עסקאות רשמיות" (28.6%), כששתי
            # ההרצות שנכשלו היו על ענף PR, תוקנו באותו PR 14 דקות אחר כך,
            # ו-main מעולם לא היה אדום. בדיקת PR אדומה מכוסה בתהליך ה-PR
            # עצמו — היא חוסמת מיזוג ומי שפתח/ה אותו רואה אותה.
            runs_resp = requests.get(
                "%s/actions/workflows/%s/runs" % (api, wf["id"]),
                headers=headers, timeout=settings.http_timeout_s,
                params={"per_page": t.workflow_window_runs,
                        "branch": settings.default_branch})
            runs_resp.raise_for_status()
            runs = runs_resp.json().get("workflow_runs", [])
        except Exception:
            continue
        if not runs:
            continue

        done = [r for r in runs if r.get("status") == "completed"]
        if not done:
            continue
        failed = [r for r in done if r.get("conclusion") == "failure"]
        rate = len(failed) / len(done)

        if rate >= t.workflow_fail_rate:
            yield Finding(
                area="health", code="workflow_failing",
                severity="critical" if rate >= 0.6 else "high",
                subject=wf["name"],
                title="‏workflow נכשל: %s" % wf["name"],
                detail="%d מתוך %d ההרצות האחרונות נכשלו."
                       % (len(failed), len(done)),
                suggestion=("זו תקלת פרודקשן ולא רעש CI: ה-HTML כבר באוויר "
                            "והסכימה לא."
                            if "migration" in (wf.get("path") or "").lower()
                            else "הכשלון האחרון: %s"
                                 % (failed[0].get("html_url") if failed else "—")),
                metric=round(rate * 100, 1), metric_unit="%",
                evidence={"path": wf.get("path"),
                          "last_failure": failed[0].get("html_url") if failed else None},
            )
            continue

        # ‏workflow מתוזמן ששתק. ‏GitHub מכבה cron אחרי 60 יום בלי פעילות
        # בריפו — וזה קורה בשקט מוחלט.
        scheduled = any(r.get("event") == "schedule" for r in runs)
        if not scheduled:
            continue
        last = runs[0].get("run_started_at") or runs[0].get("created_at")
        if not last:
            continue
        try:
            when = datetime.fromisoformat(last.replace("Z", "+00:00"))
        except ValueError:
            continue
        days = (now - when).days
        if days >= t.workflow_silent_days:
            yield Finding(
                area="health", code="workflow_silent", severity="high",
                subject=wf["name"],
                title="‏workflow מתוזמן ששתק: %s" % wf["name"],
                detail="ההרצה האחרונה לפני %d ימים." % days,
                suggestion="‏GitHub מכבה תזמוני cron אחרי 60 יום בלי פעילות "
                           "בריפו, בשקט מוחלט. להריץ ידנית מלשונית Actions "
                           "ולוודא שהתזמון חזר.",
                metric=float(days), metric_unit="ימים",
                evidence={"last_run": last, "path": wf.get("path")},
            )
