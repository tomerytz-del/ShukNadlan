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
others = [t for t, s in ctx.db.sql.items() if t != "property_publications" and "not exists" in s]
check("שאר התורים לא השתנו", not others, others)
check("ההגדרה זהה ל-listings_no_image",
      "coalesce(array_length(p.images, 1), 0) = 0" in pub
      and "coalesce(array_length(p.images, 1), 0) = 0"
      in (ROOT / "ops_agent" / "probes" / "behavior.py").read_text(encoding="utf-8"))

print("\n" + ("✗ %d נכשלו" % failed if failed else "✓ slow_ttfb ו-queue_blocked מודדות את מה שהן טוענות"))
sys.exit(1 if failed else 0)
