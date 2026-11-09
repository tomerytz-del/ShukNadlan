#!/usr/bin/env python3
"""הבדיקה של check_shelf_audience נבדקת בעצמה: שומר חסר, בהערה, ב-OR, או בתת-שאילתה אינו נחשב."""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check_shelf_audience as c  # noqa: E402

GATE = r"\bcurrent_is_mortgage_advisor\s*\("
CASES = [
    ("and (select public.current_is_mortgage_advisor())", "select 1 from t where status = 'new' and (select public.current_is_mortgage_advisor())", True),
    ("שומר ללא select", "select 1 from t where status = 'new' and public.current_is_mortgage_advisor()", True),
    ("בלי שומר", "select 1 from t where status = 'new'", False),
    ("בהערה", c.strip_sql("select 1 from t where status = 'new' -- current_is_mortgage_advisor()\n"), False),
    ("בבלוק הערה", c.strip_sql("select 1 from t where status = 'new' /* current_is_mortgage_advisor() */"), False),
    ("במחרוזת", c.strip_sql("select 1 from t where status = 'current_is_mortgage_advisor()'"), False),
    ("ב-OR ברמה העליונה", "select 1 from t where status = 'new' or (select public.current_is_mortgage_advisor())", False),
    ("ב-OR בתוך סוגריים", "select 1 from t where status = 'new' and (a = 1 or public.current_is_mortgage_advisor())", False),
    ("OR אחר, השומר ב-AND", "select 1 from t where (a = 1 or b = 2) and (select public.current_is_mortgage_advisor())", True),
    ("השומר בתת-שאילתה של ה-select ולא ב-where העליון", "select (select 1 from x where public.current_is_mortgage_advisor()) from t where status = 'new'", False),
]
bad = 0
for name, body, want in CASES:
    got = c.gated(body, GATE)
    ok = got == want
    bad += not ok
    print(("✓ " if ok else "✗ ") + name + ("" if ok else f"  קיבלנו {got}, ציפינו ל-{want}"))
semi = c.strip_sql("create view public.x_leads_public as select 'a;b' as s -- ;\nfrom t where 1=1;")
print(("✓ " if "a;b" not in semi and ";" in semi else "✗ ") + "נקודה-פסיק במחרוזת ובהערה אינה מקצרת את הגוף")
bad += not ("a;b" not in semi and ";" in semi)
sys.exit(1 if bad else 0)
