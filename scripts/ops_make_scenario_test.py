#!/usr/bin/env python3
"""הבדיקה של הבדיקה: ‏`_make_scenarios`.

אותו נימוק של `ops_agency_no_city_test.py`: ‏probe שאמור לשתוק כמעט תמיד
הוא בדיוק זה שבאג בו אינו מתגלה לעולם. תרחיש הפייסבוק ב-Make נכבה ב-
‏27.9.2026, ואותה חנות עלתה לדף ארבע פעמים לפני שמישהו שם לב.

    python3 scripts/ops_make_scenario_test.py
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ops_agent.config import Settings  # noqa: E402
from ops_agent.probes.pipeline import _make_scenarios  # noqa: E402


class _Db:
    def __init__(self, config, queue):
        self._config, self._queue = config, queue

    def has_table(self, name):
        return True

    def rows(self, sql, params=None):
        if "pricing_config" in sql:
            return [{"key": k, "value": v} for k, v in self._config.items()]
        return self._queue


class _Ctx:
    def __init__(self, config, queue, token="t"):
        self.db = _Db(config, queue)
        self.settings = Settings(make_api_token=token)
        self.root = ROOT
        self.checks = 0

    def count(self):
        self.checks += 1


failed = 0


def check(name, ok):
    global failed
    print(("✓ " if ok else "✗ ") + name)
    if not ok:
        failed += 1


def api(active):
    """מצב לכל מזהה תרחיש. None = ה-API לא ענה."""
    def get(path):
        sid = path.rsplit("/", 1)[-1]
        state = active.get(sid)
        return None if state is None else {"scenario": {"id": sid, "isActive": state}}
    return get


FB, IG = "7218015", "7641885"
PROD = {"facebook_autopost_enabled": "1", "instagram_autopost_enabled": "0"}


def run(config=PROD, queue=(), active=None, token="t"):
    ctx = _Ctx(config, list(queue), token)
    return list(_make_scenarios(ctx, get=api({FB: True, IG: False} if active is None else active)))


def codes(found):
    return sorted(f.code for f in found)


check("פייסבוק פעיל, אינסטגרם כבוי ולא מודלק - שקט", run() == [])

got = run(active={FB: False, IG: False})
check("תרחיש הפייסבוק כבוי והערוץ דלוק - ממצא חמור", codes(got) == ["make_scenario_off"])
check("חמור - פותח Issue", got[0].severity == "critical")
check("subject לפי ערוץ - נסגר כשהתרחיש חוזר", got[0].subject == "make_scenario:facebook_page")
check("ההצעה מזכירה לרוקן את התור", "התור" in got[0].suggestion)

both = {"facebook_autopost_enabled": "1", "instagram_autopost_enabled": "1"}
got = run(config=both, active={FB: True, IG: False})
check("אינסטגרם דלוק והתרחיש שלו כבוי - ממצא על אינסטגרם בלבד",
      [f.subject for f in got] == ["make_scenario:instagram"])

check("מתג פייסבוק כבוי - תרחיש כבוי אינו ממצא",
      run(config={"facebook_autopost_enabled": "0"}, active={FB: False}) == [])

got = run(token="")
check("בלי טוקן - ממצא נמוך אחד שאומר שהבדיקה חלקית",
      codes(got) == ["make_unchecked"] and got[0].severity == "low")

got = run(active={})
check("ה-API לא ענה - ממצא בינוני, לא חמור",
      codes(got) == ["make_api_failed"] and got[0].severity == "medium")

queue = [{"channel": "facebook_page", "kind": "unconfirmed", "n": 1, "last_at": "2026-09-27"}]
got = run(queue=queue)
check("שורה ש-Make קיבל ולא אישר - ממצא גבוה, גם כשהתרחיש פעיל עכשיו",
      codes(got) == ["make_unconfirmed"] and got[0].severity == "high")
check("ההצעה נותנת את הפקודה להחזרה לתור", "queue_property_publication" in got[0].suggestion)

queue = [{"channel": "instagram", "kind": "off", "n": 3, "last_at": "2026-09-27"}]
got = run(queue=queue, token="")
check("שורות שנעצרו כי התרחיש כבוי - נספרות גם בלי טוקן",
      codes(got) == ["make_scenario_off_queue", "make_unchecked"])
off = [f for f in got if f.code == "make_scenario_off_queue"][0]
check("המספר בכותרת ובמדד", "3" in off.title and off.metric == 3)

print("\n" + ("✗ %d נכשלו" % failed if failed else "✓ _make_scenarios מדווחת בדיוק מתי שצריך"))
sys.exit(1 if failed else 0)
