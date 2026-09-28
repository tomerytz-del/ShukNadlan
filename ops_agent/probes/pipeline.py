"""בריאות הצינור: ‏GitHub Actions, מיגרציות, ו-Edge Functions שנפרסו.

‏**למה זה חלק מניטור המערכת ולא עניין של מפתחים:** ה-HTML מתפרסם
ב-Netlify תוך שניות מהמיזוג, והסכימה נפרסת ב-workflow נפרד. ‏workflow
אדום אינו "רעש CI" — הוא מצב שבו הקוד באוויר והמסד מאחור. הסיפור המלא:
`docs/supabase-migrations.md`.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Iterator

from ..config import MAKE_SCENARIOS, PAUSED_WORKFLOWS
from ..models import Finding


def run(ctx) -> Iterator[Finding]:
    yield from _migrations(ctx)
    yield from _actions(ctx)
    yield from _make_scenarios(ctx)


def _make_get(ctx, path: str):
    """‏GET ל-Make API. מחזיר את גוף ה-JSON, או None על כל תקלה."""
    try:
        import requests
    except ImportError:
        return None
    try:
        resp = requests.get(
            ctx.settings.make_api_base + path,
            headers={"Authorization": "Token " + ctx.settings.make_api_token},
            timeout=ctx.settings.http_timeout_s)
    except Exception:
        return None
    if resp.status_code != 200:
        return None
    try:
        return resp.json()
    except ValueError:
        return None


def _make_scenarios(ctx, get=None) -> Iterator[Finding]:
    """תרחיש Make שמפרסם לרשתות — והוא כבוי.

    ‏**הכשל שהבדיקה הזו נולדה ממנו (27.9.2026):** תרחיש הפייסבוק נכבה.
    ‏Make ממשיך לקבל webhook כשהתרחיש כבוי ועונה 200 "Accepted" — הוא רק
    שומר את הנתונים בתור שלו. השרת שלח את אותה חנות ארבע פעמים, וכשהתרחיש
    הודלק שוב ארבעתן עלו לדף בבת אחת. שום דבר בדשבורד לא הראה את זה.

    שני מקורות, והשני עובד גם בלי הראשון:

    1. ‏**Make API** (‏`MAKE_API_TOKEN`): ‏`isActive` של כל תרחיש שהערוץ שלו
       דלוק. תרחיש כבוי הוא ‏`critical` — ופותח Issue — כי כל נכס חדש
       שיעלה בזמן הזה לא יתפרסם. ערוץ שהמתג שלו כבוי (אינסטגרם לפני
       ההשקה) אינו נבדק: תרחיש כבוי שם הוא המצב הנכון.
    2. ‏**התור עצמו**: ‏`property-marketing-publish` מסמנת ב-`last_error`
       שורה שנעצרה בגלל תרחיש כבוי (‏`[make-scenario-off]`) או ש-Make קיבל
       בלי לאשר (‏`[make-unconfirmed]`). הסימונים האלה הם ראיה לתקלה גם
       כשאין טוקן, ושורת `unconfirmed` היא גם פוסט שצריך לבדוק ביד אם עלה.
    """
    get = get or (lambda path: _make_get(ctx, path))
    db = ctx.db

    enabled = {}
    if db is not None and db.has_table("pricing_config"):
        ctx.count()
        rows = db.rows("select key, value from public.pricing_config where key = any(%s)",
                       ([s[2] for s in MAKE_SCENARIOS],))
        found = {r["key"]: r["value"] for r in rows}
        for channel, _sid, key, default, _label in MAKE_SCENARIOS:
            try:
                enabled[channel] = int(float(found.get(key, default))) == 1
            except (TypeError, ValueError):
                enabled[channel] = bool(default)

    # ---- 1. מצב התרחישים ב-Make
    live = [s for s in MAKE_SCENARIOS if enabled.get(s[0])]
    if live and not ctx.settings.make_api_token:
        yield Finding(
            area="health", code="make_unchecked", severity="low",
            subject="make_scenarios",
            title="מצב תרחישי Make לא נבדק",
            detail="אין MAKE_API_TOKEN בסודות ה-workflow, ולכן תרחיש פרסום כבוי "
                   "יתגלה רק אחרי שנכס כבר נעצר בתור.",
            suggestion="ב-Make: פרופיל ← API access ← Add token עם scenarios:read, "
                       "ואז סוד MAKE_API_TOKEN ב-GitHub (Settings ← Secrets ← Actions) "
                       "וגם ב-Supabase (Edge Functions ← Secrets). ראו "
                       "docs/facebook-auto-publish.md.",
        )
    elif live:
        for channel, sid, _key, _default, label in live:
            ctx.count()
            data = get("/scenarios/%s" % sid)
            sc = (data or {}).get("scenario") if isinstance(data, dict) else None
            if not isinstance(sc, dict) or not isinstance(sc.get("isActive"), bool):
                yield Finding(
                    area="health", code="make_api_failed", severity="medium",
                    subject="make_scenario:%s" % channel,
                    title="לא ניתן לבדוק את תרחיש %s ב-Make" % label,
                    detail="‏Make API לא החזיר את מצב התרחיש %s." % sid,
                    suggestion="טוקן שפג, טוקן בלי scenarios:read, או מזהה תרחיש שהשתנה "
                               "(‏MAKE_SCENARIOS ב-ops_agent/config.py).",
                )
                continue
            if sc["isActive"] and not sc.get("isPaused"):
                continue
            yield Finding(
                area="health", code="make_scenario_off", severity="critical",
                subject="make_scenario:%s" % channel,
                title="תרחיש הפרסום ל%s ב-Make כבוי" % label,
                detail="התרחיש %s (%s) אינו פעיל, והפרסום האוטומטי ל%s דלוק. "
                       "נכסים חדשים לא יתפרסמו עד שיודלק."
                       % (sc.get("name") or sid, sid, label),
                suggestion="ב-Make: לפתוח את התרחיש ← History לראות למה נכבה (Make "
                           "מכבה תרחיש לבד אחרי שגיאות חוזרות) ← לתקן ← **לרוקן את "
                           "התור של ה-Webhook** ← להדליק. תור שלא רוקן עולה לדף "
                           "בבת אחת, כולל כפילויות.",
                evidence={"scenario_id": sid, "isActive": sc.get("isActive"),
                          "isPaused": sc.get("isPaused")},
            )

    # ---- 2. מה שהתור מספר
    if db is None or not db.has_table("property_publications"):
        return
    ctx.count()
    rows = db.rows(
        """
        select channel,
               case when last_error like '[make-unconfirmed]%%' then 'unconfirmed'
                    else 'off' end as kind,
               count(*) as n,
               max(updated_at) as last_at
          from public.property_publications
         where (last_error like '[make-unconfirmed]%%'
                and status = 'failed' and updated_at > now() - interval '7 days')
            or (last_error like '[make-scenario-off]%%' and status = 'pending')
         group by 1, 2
        """)
    labels = {s[0]: s[4] for s in MAKE_SCENARIOS}
    for r in rows:
        label = labels.get(r["channel"], r["channel"])
        n = int(r["n"] or 0)
        if not n:
            continue
        if r["kind"] == "unconfirmed":
            yield Finding(
                area="health", code="make_unconfirmed", severity="high",
                subject="make_unconfirmed:%s" % r["channel"],
                title="%d פוסטים ל%s ש-Make קיבל ולא אישר" % (n, label),
                detail="ב-7 הימים האחרונים. השורות נעצרו כ-failed ולא נשלחו שוב, כדי "
                       "שלא ייכנסו שוב לתור של Make ויעלו כפולים.",
                suggestion="לבדוק בדף אם הפוסט עלה. אם לא - לוודא שהתרחיש פעיל ושהתור "
                           "שלו ריק, ואז להחזיר לתור: select queue_property_publication"
                           "('<id>', '%s', true);" % r["channel"],
                metric=float(n), metric_unit="פוסטים",
                evidence={"last_at": r.get("last_at")},
            )
        else:
            yield Finding(
                area="health", code="make_scenario_off_queue", severity="high",
                subject="make_scenario_off_queue:%s" % r["channel"],
                title="%d נכסים ממתינים כי תרחיש %s כבוי" % (n, label),
                detail="השרת בדק את התרחיש לפני השליחה ומצא אותו כבוי, ולכן לא שלח. "
                       "השורות ימשיכו מעצמן כשהתרחיש יודלק.",
                suggestion="להדליק את התרחיש ב-Make (אחרי שבודקים ב-History למה נכבה).",
                metric=float(n), metric_unit="נכסים",
                evidence={"last_at": r.get("last_at")},
            )


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


def _cron_cadence_days(ctx, wf_path: str) -> int:
    """כל כמה ימים ה-workflow אמור לרוץ, לפי ה-`cron` שבקובץ שלו.

    ‏`workflow_silent_days` כויל על workflows שרצים כל שעתיים; ל-workflow
    חודשי (‏`land_ownership.yml`, ‏`whatsapp_public_bot_check.yml`) הוא היה
    "שתק" שלושה ימים אחרי כל הרצה תקינה. מחזיר 1 כשאין קובץ, אין cron,
    או שהוא יומי ומעלה — כלומר ההתנהגות הקודמת.
    """
    import re
    try:
        text = (ctx.root / wf_path).read_text(encoding="utf-8")
    except Exception:
        return 1
    best = None
    for line in text.splitlines():
        m = re.match(r"""\s*-\s*cron:\s*["']([^"']+)["']""", line)
        if not m:
            continue
        fields = m.group(1).split()
        if len(fields) != 5:
            continue
        _, _, dom, mon, dow = fields
        if mon != "*":
            days = 366
        elif dom != "*":
            days = int(dom[2:]) if dom.startswith("*/") and dom[2:].isdigit() else 31
        elif dow != "*":
            days = 7
        else:
            days = 1
        best = days if best is None else min(best, days)
    return best or 1


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
        # ‏הנושא הוא שם הקובץ ולא השם שבכותרת: שם עברי היה נופל כולו מהמפתח
        # (‏`_slug`), וכל ה-workflows חלקו ממצא אחד. ‏models.py.
        wf_file = (wf.get("path") or "").rsplit("/", 1)[-1] or wf["name"]
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

        # ‏**"נכשל" פירושו שההרצה האחרונה ב-main נכשלה**, והשיעור רק מדרג.
        # שיעור לבדו אינו יכול לרדת בקצב של תיקון: ב-workflow חודשי חלון של
        # 20 הרצות הוא 20 חודשים, וכישלון אחד מחזיק אותו מעל 25% עוד שלוש
        # הרצות ירוקות. כך נפתח ב-27.9.2026 ממצא בדרגה גבוהה על "סוג בעלות
        # בקרקע" (1 מתוך 2), יום אחרי ש-#450 תיקן את ה-403 וההרצה שאחריו
        # ב-main עברה. ‏`done[0]` הוא האחרון — ה-API מחזיר מהחדש לישן.
        recovered = done[0].get("conclusion") != "failure"
        if rate >= t.workflow_fail_rate and recovered:
            # התאושש. אם זה דפוס ולא אירוע — ‏workflow שנכשל לסירוגין —
            # זה ממצא אחר ובדרגה אחרת, ורק כשיש מספיק הרצות לקרוא לזה דפוס.
            # אחרת ממשיכים לבדיקת השקט למטה, כמו כל workflow תקין.
            if len(done) >= t.workflow_flaky_min_runs:
                yield Finding(
                    area="health", code="workflow_flaky", severity="medium",
                    subject=wf_file,
                    title="‏workflow נכשל לסירוגין: %s" % wf["name"],
                    detail="ההרצה האחרונה עברה, אבל %d מתוך %d ההרצות האחרונות "
                           "נכשלו." % (len(failed), len(done)),
                    suggestion="הכישלון האחרון: %s" % failed[0].get("html_url"),
                    metric=round(rate * 100, 1), metric_unit="%",
                    evidence={"path": wf.get("path"),
                              "last_failure": failed[0].get("html_url")},
                )
                continue

        elif rate >= t.workflow_fail_rate:
            yield Finding(
                area="health", code="workflow_failing",
                severity="critical" if rate >= 0.6 else "high",
                subject=wf_file,
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
        #
        # שקט שנבחר אינו שקט שנשבר: ‏workflow שהתזמון שלו נותק בכוונה יושב
        # ב-`PAUSED_WORKFLOWS` עם הסיבה, ואינו נספר כאן. ההרצות המתוזמנות
        # הישנות נשארות בחלון עוד שבועות אחרי הניתוק, ובלי הסינון הזה כל
        # ניתוק מתועד היה הופך לממצא בדרגה גבוהה שלושה ימים אחריו.
        path = (wf.get("path") or "").rsplit("/", 1)[-1]
        if path in PAUSED_WORKFLOWS:
            continue
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
        cadence = _cron_cadence_days(ctx, wf.get("path") or "")
        limit = t.workflow_silent_days + (cadence if cadence > 1 else 0)
        if days >= limit:
            yield Finding(
                area="health", code="workflow_silent", severity="high",
                subject=wf_file,
                title="‏workflow מתוזמן ששתק: %s" % wf["name"],
                detail="ההרצה האחרונה לפני %d ימים." % days,
                suggestion="‏GitHub מכבה תזמוני cron אחרי 60 יום בלי פעילות "
                           "בריפו, בשקט מוחלט. להריץ ידנית מלשונית Actions "
                           "ולוודא שהתזמון חזר.",
                metric=float(days), metric_unit="ימים",
                evidence={"last_run": last, "path": wf.get("path")},
            )
