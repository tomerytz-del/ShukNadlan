#!/usr/bin/env python3
"""הבדיקה של הבדיקה: ממצא על שאילתה איטית אומר איזו פונקציה לבדוק.

קריאת RPC דרך PostgREST מתחילה בעטיפה ארוכה (`WITH pgrst_source ...
json_to_record ...`), ושם הפונקציה יושב אחרי התו ה-200. הדגימה נחתכה שם,
ולכן ב-20.11.2026 הממצא על `notification_push_claim` (‏2.5 שניות בממוצע)
הראה רק עטיפה עם `p_limit`, וכל RPC אחרת עם אותו פרמטר נראתה זהה.

    python3 scripts/ops_rpc_sample_test.py
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = (ROOT / "ops_agent" / "probes" / "database.py").read_text(encoding="utf-8")
tree = ast.parse(SRC)
failed = 0


def check(name, ok, detail=""):
    global failed
    print(("✓ " if ok else "✗ ") + name + (("\n    " + detail) if detail and not ok else ""))
    failed += 0 if ok else 1


# הפונקציות הטהורות, בלי לייבא את המודול (הוא מושך psycopg2).
ns: dict = {}
for node in tree.body:
    if isinstance(node, ast.FunctionDef) and node.name in ("_rpc_name", "_label"):
        exec(compile(ast.Module([node], []), "database.py", "exec"), ns)

rpc_name, label = ns["_rpc_name"], ns["_label"]

check("דגימת RPC מחזירה את שם הפונקציה",
      rpc_name("rpc: notification_push_claim | WITH pgrst_source AS (SELECT") == "notification_push_claim")
check("שאילתה רגילה אינה RPC", rpc_name("select 1 from public.leads") is None)
check("דגימה ריקה אינה נופלת", rpc_name(None) is None and rpc_name("") is None)
check("הכותרת נושאת את השם",
      label({"sample": "rpc: client_match_top | WITH"}) == " (client_match_top)")
check("שאילתה רגילה: אין תוספת לכותרת", label({"sample": "select 1"}) == "")
check("השאילתה משתמשת ב-_SAMPLE_SQL ולא בחיתוך עיוור",
      "{sample}" in SRC and "sample=_SAMPLE_SQL" in SRC,
      "ה-select ב-_slow_queries חזר לחתוך 200 תווים")

sys.exit(1 if failed else 0)
