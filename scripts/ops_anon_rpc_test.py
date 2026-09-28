#!/usr/bin/env python3
"""הבדיקה של הבדיקה: ‏`_anon_rpc` ו-`PUBLIC_RPC`.

‏28.9.2026: תשע פונקציות דווחו כ"שליפה פתוחה לאנונימי/ת". שש פומביות
בכוונה (דף הנכס קורא להן בלי התחברות) ונרשמו ב-`PUBLIC_RPC`; שלוש נסגרו
במיגרציה. הבדיקה כאן מוודאת שההצהרה משתיקה רק את מה שהיא אמורה.

    python3 scripts/ops_anon_rpc_test.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ops_agent.config import PUBLIC_RPC  # noqa: E402
from ops_agent.probes.security import _anon_rpc  # noqa: E402

READ = "select exists (select 1 from public.properties where id = $1)"
WRITE = "insert into public.properties (id) values ($1)"
GUARD = "if not public.current_is_platform_admin() then raise; end if;"


class _Db:
    def __init__(self, rows):
        self._rows = rows

    def rows(self, sql, params=None):
        return self._rows


class _Ctx:
    def __init__(self, rows):
        self.db = _Db(rows)

    def count(self):
        pass


def run(*fns):
    rows = [{"name": n, "args": "", "body": b} for n, b in fns]
    return {(f.code, f.subject, f.severity) for f in _anon_rpc(_Ctx(rows))}


failed = 0


def check(name, ok, detail=""):
    global failed
    print(("✓ " if ok else "✗ ") + name + (("\n    " + str(detail)) if not ok and detail else ""))
    failed += 0 if ok else 1


found = run(("property_map_enabled", READ))
check("מוצהרת, קריאה בלבד - שורת מידע ולא ממצא",
      found == {("anon_secdef_declared", "public_rpc", "info")}, found)

found = run(("property_map_enabled", WRITE))
check("מוצהרת שהתחילה לכתוב - גבוה",
      found == {("anon_secdef_unguarded", "property_map_enabled", "high")}, found)

found = run(("notification_type_enabled", READ))
check("לא מוצהרת - בינוני",
      found == {("anon_secdef_unguarded", "notification_type_enabled", "medium")}, found)

found = run(("some_admin_rpc", GUARD))
check("בודקת הרשאה בעצמה - לא מושפעת מההצהרה",
      found == {("anon_secdef_guarded", "rpc_surface", "info")}, found)

# ‏שם ברשימה שאינו קיים באף מיגרציה הוא שגיאת כתיב - ושגיאת כתיב כאן
# אינה שקטה בלבד: היא משאירה פתוחה את הפונקציה האמיתית בלי שאיש ידע.
corpus = "\n".join(p.read_text(encoding="utf-8")
                   for p in (ROOT / "supabase" / "migrations").glob("*.sql"))
missing = [n for n in PUBLIC_RPC
           if not re.search(r"function\s+(public\.)?%s\s*\(" % re.escape(n), corpus, re.I)]
check("כל שם ב-PUBLIC_RPC מוגדר במיגרציה", not missing, missing)
check("לכל שורה ב-PUBLIC_RPC יש קורא/ת", all(v.strip() for v in PUBLIC_RPC.values()))

print("\n" + ("✗ %d נכשלו" % failed if failed else "✓ _anon_rpc מדווחת בדיוק מתי שצריך"))
sys.exit(1 if failed else 0)
