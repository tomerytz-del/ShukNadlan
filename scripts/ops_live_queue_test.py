#!/usr/bin/env python3
"""הבדיקה של הבדיקה: ‏`slow_ttfb` ו-`queue_blocked`.

שני ממצאים בינוניים מ-28.9.2026 שמדדו דבר אחר ממה שהכותרת טוענת:

1. **‏"תגובה איטית: דף הבית"** בכל סריקה - כי דף הבית היה הראשון ברשימה,
   והוא לבדו שילם על פתיחת החיבור מה-runner. כאן: ‏session מדומה שבקשתו
   הראשונה איטית (חיבור קר), וכל השאר מהירות.
2. **‏"ממתין לתנאי מקדים: פרסום לרשתות"** ספר שלוש מודעות בלי תמונה, שכבר
   נספרו ב-`listings_no_image`.

    python3 scripts/ops_live_queue_test.py
"""

from __future__ import annotations

import sys
import time
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ops_agent.config import LIVE_PAGES, Settings  # noqa: E402

failed = 0


def check(name, ok, detail=""):
    global failed
    print(("✓ " if ok else "✗ ") + name + (("\n    " + str(detail)) if not ok and detail else ""))
    failed += 0 if ok else 1


# ---------------------------------------------------------------- slow_ttfb

class _Resp:
    status_code = 200
    headers = {"content-encoding": "gzip"}
    content = b"<html></html>"


class _Session:
    urls: list = []

    def __init__(self):
        self.headers = {}
        self._warm = False

    def get(self, url, **kwargs):
        _Session.urls.append(url)
        if not self._warm:          # ‏חיבור קר: ‏DNS + TCP + TLS
            self._warm = True
            time.sleep(0.9)
        return _Resp()


sys.modules["requests"] = types.SimpleNamespace(Session=_Session)
from ops_agent.probes.frontend import _live  # noqa: E402


class _LiveCtx:
    def __init__(self):
        self.settings = Settings()
        self.settings.site_base_url = "https://example.test"

    def count(self):
        pass


found = [(f.code, f.subject) for f in _live(_LiveCtx())]
check("חיבור קר אינו נספר כתגובה איטית של הדף הראשון", found == [], found)
check("בקשת החימום לפני הדף הראשון",
      _Session.urls[0].endswith("/robots.txt") and _Session.urls[1] == "https://example.test/",
      _Session.urls[:2])
check("הדפים נמדדים בלי .html (אחרת נמדדת הפניית 301)",
      not any(p.endswith(".html") for p, _ in LIVE_PAGES), LIVE_PAGES)

# ‏502 בודד אינו "דף שבור בפרודקשן"; ‏502 בשתי בקשות - כן; ‏404 אינו מנוסה שוב.
class _Bad(_Resp):
    def __init__(self, status):
        self.status_code = status


class _Flaky(_Session):
    seen: dict = {}

    def get(self, url, **kwargs):
        n = _Flaky.seen[url] = _Flaky.seen.get(url, 0) + 1
        if url.endswith("/") and n == 1:
            return _Bad(502)
        if url.endswith("/projects"):
            return _Bad(503)
        if url.endswith("/articles"):
            return _Bad(404)
        return _Resp()


_real_sleep = time.sleep
time.sleep = lambda s: None          # שלוש השניות שבין הניסיונות
sys.modules["requests"].Session = _Flaky
flaky = {(f.code, f.subject): f for f in _live(_LiveCtx())}
time.sleep = _real_sleep
check("502 בודד שאחריו 200 הוא ממצא נמוך, לא חמור",
      flaky.get(("page_error_once", "/")) is not None
      and flaky[("page_error_once", "/")].severity == "low"
      and ("page_error", "/") not in flaky, sorted(flaky))
check("503 בשתי בקשות נשאר חמור, עם שני הניסיונות ב-evidence",
      ("page_error", "/projects") in flaky
      and flaky[("page_error", "/projects")].severity == "critical"
      and [x["status"] for x in flaky[("page_error", "/projects")].evidence["attempts"]] == [503, 503],
      sorted(flaky))
check("404 נשאר חמור ואינו מנוסה שוב",
      ("page_error", "/articles") in flaky
      and _Flaky.seen.get("https://example.test/articles") == 1, _Flaky.seen)

# דגימה ראשונה איטית (צומת edge קר) אינה ממצא; דף שאיטי בכל בקשה - כן.
class _ColdFirst(_Session):
    slow_always = "/agencies"
    seen: dict = {}

    def get(self, url, **kwargs):
        n = _ColdFirst.seen[url] = _ColdFirst.seen.get(url, 0) + 1
        if url.endswith(_ColdFirst.slow_always) or (url.endswith("/projects") and n == 1):
            time.sleep(0.85)
        return _Resp()


sys.modules["requests"].Session = _ColdFirst
found = [(f.code, f.subject, len(f.evidence["samples_ms"])) for f in _live(_LiveCtx())]
check("דגימה קרה אחת אינה תגובה איטית, ודף שאיטי בכל בקשה נשאר ממצא",
      found == [("slow_ttfb", "/agencies", 3)], found)
check("דף מהיר נמדד פעם אחת, ודף שחצה את הסף שלוש",
      _ColdFirst.seen.get("https://example.test/") == 1
      and _ColdFirst.seen.get("https://example.test/projects") == 3, _ColdFirst.seen)

# ---------------------------------------------------------------- queue_blocked

from ops_agent.probes import database  # noqa: E402


class _Db:
    def __init__(self):
        self.sql = {}

    def has_table(self, name):
        return True

    def has_column(self, table, col):
        return True

    def one(self, sql, params=None):
        table = sql.split("from public.", 1)[1].split()[0]
        self.sql[table] = sql
        return {"stuck": 0}


class _QCtx:
    def __init__(self):
        self.db = _Db()
        self.settings = Settings()

    def count(self):
        pass


ctx = _QCtx()
list(database._queues(ctx))
pub = ctx.db.sql.get("property_publications", "")
check("תור הפרסום מחריג מודעה בלי תמונה", "not exists" in pub and "marketing_image is null" in pub, pub)
alerts = ctx.db.sql.get("saved_search_alerts", "")
check("תור ההתראות מחריג חיפוש שמיצה את התקרה היומית",
      "not exists" in alerts and "saved_search_daily_cap" in alerts
      and "t.status = 'sent'" in alerts and "interval '24 hours'" in alerts, alerts)
# ‏ההגדרה של "נשלח היממה" חייבת להישאר זו של saved_search_pending_alerts,
# אחרת ה-probe מחריג שורות שהעובד דווקא כן היה בוחר.
_MIG = ROOT / "supabase" / "migrations"
_pending_defs = [f for f in sorted(_MIG.glob("*.sql"))
                 if "function public.saved_search_pending_alerts" in f.read_text(encoding="utf-8")]
check("ההגדרה זהה ל-saved_search_pending_alerts",
      bool(_pending_defs)
      and "a.status = 'sent' and a.sent_at > now() - interval '24 hours'"
      in _pending_defs[-1].read_text(encoding="utf-8"), [f.name for f in _pending_defs])
others = [t for t, s in ctx.db.sql.items()
          if t not in ("property_publications", "saved_search_alerts") and "not exists" in s]
check("שאר התורים לא השתנו", not others, others)
check("ההגדרה זהה ל-listings_no_image",
      "coalesce(array_length(p.images, 1), 0) = 0" in pub
      and "coalesce(array_length(p.images, 1), 0) = 0"
      in (ROOT / "ops_agent" / "probes" / "behavior.py").read_text(encoding="utf-8"))

print("\n" + ("✗ %d נכשלו" % failed if failed else "✓ slow_ttfb ו-queue_blocked מודדות את מה שהן טוענות"))
sys.exit(1 if failed else 0)
