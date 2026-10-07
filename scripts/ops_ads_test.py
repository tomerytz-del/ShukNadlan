#!/usr/bin/env python3
"""הבדיקה של הבדיקה: ‏probes/ads.py (קונסולת השיווק, שלב 6).

אותו נימוק של `ops_market_gate_test.py`: ‏probe שאמור לשתוק כמעט תמיד
הוא בדיוק זה שבאג בו אינו מתגלה לעולם. כאן הנקודה העדינה היא שכל ממצא
חייב להיות מסוגל להיסגר (docs/ops-agent.md, ‏heavy_query) - לכן נבדק גם
מה שאמור **לא** לדווח: כשל ישן שאחריו הצלחה, קונסולה כבויה, וקמפיין
תנועה שמטבעו אינו מביא לידים.

    python3 scripts/ops_ads_test.py
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ops_agent.config import Thresholds  # noqa: E402
from ops_agent.probes import ads  # noqa: E402


class _Db:
    """מחזיר תשובה לפי מילה שמזהה את השאילתה."""

    def __init__(self, answers, tables=None, enabled=True):
        self.answers = answers
        self.tables = tables
        self.enabled = enabled

    def has_table(self, name):
        return self.tables is None or name in self.tables

    def rows(self, sql, params=None):
        if "key = 'enabled'" in sql and "select value" in sql:
            return [{"value": self.enabled}]
        for word, ans in self.answers.items():
            if word in sql:
                return ans
        return []

    def one(self, sql, params=None):
        r = self.rows(sql, params)
        return r[0] if r else None


class _Settings:
    thresholds = Thresholds()


class _Ctx:
    def __init__(self, db):
        self.db = db
        self.settings = _Settings()
        self.root = ROOT

    def count(self):
        pass


failed = 0


def check(name, ok):
    global failed
    print(("✓ " if ok else "✗ ") + name)
    if not ok:
        failed += 1


def codes(fn, db):
    return [f.code for f in fn(_Ctx(db))]


# ---- טוקן
dead = {"token_dead": True, "ok": False, "action": "sync_insights", "created_at": "2026-10-07"}
check("טוקן: הקריאה האחרונה נכשלה ב-190 - ממצא חמור",
      [(f.code, f.severity) for f in ads._token(_Ctx(_Db({"ads_actions_log": [dead]})))] == [("ads_token_invalid", "critical")])
check("טוקן: הקריאה האחרונה הצליחה - שקט (כשל ישן כבר טופל)",
      codes(ads._token, _Db({"ads_actions_log": [{**dead, "ok": True, "token_dead": False}]})) == [])
check("טוקן: כשל אחר (לא 190) - שקט, זה לא הטוקן",
      codes(ads._token, _Db({"ads_actions_log": [{**dead, "token_dead": False}]})) == [])
check("טוקן: אין יומן - שקט", codes(ads._token, _Db({})) == [])

# ---- סנכרון
check("סנכרון: דלוק ו-50 שעות בלי הצלחה - ממצא",
      codes(ads._sync_silent, _Db({"sync_insights": [{"hours": 50, "last_ok": None, "last_any": None}]})) == ["ads_sync_silent"])
check("סנכרון: 20 שעות - שקט",
      codes(ads._sync_silent, _Db({"sync_insights": [{"hours": 20, "last_ok": "x", "last_any": "x"}]})) == [])
check("סנכרון: הקונסולה כבויה - שקט גם אחרי שבוע",
      codes(ads._sync_silent, _Db({"sync_insights": [{"hours": 200}]}, enabled=False)) == [])

# ---- קמפיין בלי לידים
camp = {"campaign_id": "120", "name": "SN · נכס", "spend": 180, "before_results": 0, "console_lead": True}
check("קמפיין לידים מהקונסולה, ₪180 בלי ליד - ממצא",
      codes(ads._campaigns_without_leads, _Db({"ads_insights_daily": [camp]})) == ["ads_campaign_no_leads"])
check("קמפיין שהביא לידים בחודש שלפני והפסיק - ממצא",
      codes(ads._campaigns_without_leads, _Db({"ads_insights_daily": [{**camp, "console_lead": False, "before_results": 7}]})) == ["ads_campaign_no_leads"])
check("קמפיין תנועה שמעולם לא הביא לידים - שקט (יחידה אחרת)",
      codes(ads._campaigns_without_leads, _Db({"ads_insights_daily": [{**camp, "console_lead": False, "before_results": 0}]})) == [])
f = list(ads._campaigns_without_leads(_Ctx(_Db({"ads_insights_daily": [camp]}))))[0]
check("קמפיין: המספר ב-metric, הנושא יציב בלי מספר", f.metric == 180 and f.subject == "120")

# ---- לידים
check("לידים שנכשלו - ממצא חמור",
      [(f.code, f.severity) for f in ads._leads_failed(_Ctx(_Db({"ads_leads": [{"n": 3, "dead": 2, "oldest": "x", "errors": ["missing_city"]}]})))]
      == [("ads_leads_failed", "high")])
check("אין לידים שנכשלו - שקט", codes(ads._leads_failed, _Db({"ads_leads": [{"n": 0, "dead": 0}]})) == [])
check("טופס לא משויך - ממצא לכל טופס",
      codes(ads._leads_unmapped, _Db({"ads_leads": [{"form_id": "1", "form_name": "א", "n": 4, "oldest": "x"},
                                                   {"form_id": "2", "form_name": "ב", "n": 1, "oldest": "x"}]}))
      == ["ads_leads_unmapped", "ads_leads_unmapped"])

# ---- יצירה שנעצרה
check("קמפיין שנעצר באמצע - ממצא נמוך",
      [(f.code, f.severity) for f in ads._partial_campaigns(_Ctx(_Db({"ads_campaigns": [
          {"id": "u1", "name": "SN", "status": "failed", "error": "boom", "objects": 2}]})))]
      == [("ads_campaign_partial", "low")])

# ---- אין טבלאות (לפני המיגרציה) - שקט, לא קריסה
check("אין טבלאות של הקונסולה - שקט", list(ads.run(_Ctx(_Db({}, tables=set())))) == [])

sys.exit(1 if failed else 0)
