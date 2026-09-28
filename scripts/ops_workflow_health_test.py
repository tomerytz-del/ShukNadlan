#!/usr/bin/env python3
"""הבדיקה של הבדיקה: ‏`workflow_failing`, ‏`workflow_flaky` ו-`workflow_silent`.

על המקרה של 27.9.2026: ‏`land_ownership.yml` (חודשי) נכשל בהרצה הראשונה,
‏#450 תיקן, וההרצה שאחריו עברה - והממצא בדרגה גבוהה נשאר, כי 1 מתוך 2
הוא 50%. ה-API של GitHub מדומה; הקבצים ב-`.github/workflows` אמיתיים,
כי מהם נקרא מחזור ה-cron.

    python3 scripts/ops_workflow_health_test.py
"""

from __future__ import annotations

import sys
import types
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ops_agent.config import Settings  # noqa: E402
from ops_agent.probes import pipeline  # noqa: E402

LAND = ".github/workflows/land_ownership.yml"
NEWS = ".github/workflows/news_ticker.yml"

_CASE: dict = {}


class _Resp:
    def __init__(self, body):
        self._body = body

    def raise_for_status(self):
        pass

    def json(self):
        return self._body


def _get(url, **kwargs):
    if url.endswith("/actions/workflows"):
        return _Resp({"workflows": [{"id": 1, "name": "wf", "path": _CASE["path"],
                                     "state": "active"}]})
    return _Resp({"workflow_runs": _CASE["runs"]})


sys.modules["requests"] = types.SimpleNamespace(get=_get)


class _Ctx:
    def __init__(self):
        self.settings = Settings(github_token="t", github_repo="o/r")
        self.root = ROOT

    def count(self):
        pass


def run(conclusion, days_ago, event="workflow_dispatch"):
    when = datetime.now(timezone.utc) - timedelta(days=days_ago, minutes=1)
    return {"status": "completed", "conclusion": conclusion, "event": event,
            "run_started_at": when.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "html_url": "https://example/%s/%d" % (conclusion, days_ago)}


def codes(path, runs):
    _CASE.update(path=path, runs=runs)
    return [(f.code, f.severity) for f in pipeline._actions(_Ctx())]


failed = 0


def check(name, ok):
    global failed
    print(("✓ " if ok else "✗ ") + name)
    failed += 0 if ok else 1


# ‏27.9.2026 כלשונו: הכישלון, ואחריו התיקון שעבר.
check("כישלון שתוקן - שקט",
      codes(LAND, [run("success", 1), run("failure", 1)]) == [])
check("ההרצה האחרונה נכשלה - גבוה",
      codes(LAND, [run("failure", 1), run("success", 30)]) == [("workflow_failing", "high")])
check("כל ההרצות נכשלו - קריטי",
      codes(LAND, [run("failure", 1)]) == [("workflow_failing", "critical")])

flaky = [run("success", 0, "schedule")] + [
    run("failure" if i % 3 == 0 else "success", 0, "schedule") for i in range(19)]
check("נכשל לסירוגין, האחרונה עברה - בינוני",
      codes(NEWS, flaky) == [("workflow_flaky", "medium")])

# ‏workflow חודשי: שישה ימים אחרי הרצה מתוזמנת אינם שקט, ארבעים הם.
check("חודשי, 6 ימים אחרי ההרצה - שקט",
      codes(LAND, [run("success", 6, "schedule")]) == [])
check("חודשי, 40 יום - שתק",
      codes(LAND, [run("success", 40, "schedule")]) == [("workflow_silent", "high")])
# ‏workflow שרץ כל שעתיים שומר על הסף הקודם.
check("כל שעתיים, 4 ימים - שתק",
      codes(NEWS, [run("success", 4, "schedule")]) == [("workflow_silent", "high")])
check("כל שעתיים, יומיים - שקט",
      codes(NEWS, [run("success", 2, "schedule")]) == [])

_CASE.update(path=LAND, runs=[run("failure", 1)])
found = list(pipeline._actions(_Ctx()))
check("הנושא הוא שם הקובץ, לא השם העברי",
      [f.subject for f in found] == ["land_ownership.yml"]
      and found[0].key == "health:workflow_failing:land_ownership.yml")

ctx = _Ctx()
check("מחזור ה-cron נקרא מהקובץ",
      (pipeline._cron_cadence_days(ctx, LAND),
       pipeline._cron_cadence_days(ctx, NEWS),
       pipeline._cron_cadence_days(ctx, "no/such.yml")) == (31, 1, 1))
# ‏cron שבהערה (‏rss_scraper.yml המושבת) אינו תזמון.
check("cron בהערה אינו נספר",
      pipeline._cron_cadence_days(ctx, ".github/workflows/rss_scraper.yml") == 1)

print("\n" + ("✗ %d נכשלו" % failed if failed else "✓ בריאות ה-workflows מדווחת בדיוק מתי שצריך"))
sys.exit(1 if failed else 0)
