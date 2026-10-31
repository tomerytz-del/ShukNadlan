#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
מפתח הרחוב בחיפוש (‏20271031230000_street_key_search.sql), על Postgres מקומי.

  1. התאמה: public.street_name_key במסד מול SearchCore.streetNameKey בשני
     העותקים (‏assets ו-_shared, שממנו הבוט טוען) - אותו פלט על כל הרשימה.
  2. המיגרציה רצה פעמיים, ומוסיפה בלבד.
  3. crm_search ו-admin_search: חמשת הנכסים של "עלייה" בעפולה נמצאים בכל
     אחד מחמשת הכתיבים, התאמה מדויקת קודם, ו"הרצל", "העמק" ו"הנשיאים" לא
     מאבדים אף נכס ומוסיפים רק כתיב אחר של אותו רחוב.

    python3 scripts/street_key_test.py

docs/street-registry.md, "חיפוש לפי המפתח".
"""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/20271031230000_street_key_search.sql"
REGISTRY = ROOT / "supabase/migrations/20261109090000_street_registry.sql"
CRM_SEARCH = ROOT / "supabase/migrations/20270601120000_crm_search.sql"
ADMIN_SEARCH = ROOT / "supabase/migrations/20270630090000_admin_search.sql"
SETUP = ROOT / "scripts/street_key_setup.sql"

SAMPLES = [
    "העלייה", "עלייה", "העליה", "עליה", "רחוב העלייה", "שד׳ ירושלים", "שדרות רוטשילד",
    "רח' הרצל", "הרצל", "יהושע חנקין", "העליה השניה", "בן־גוריון", "בן-גוריון",
    "הנשיא  ויצמן", "  העמק  ", "", "ה", "״ה״", "רחוב", "שד", "היי", "הה", "דרך העמק",
    "רחוב  הרצל", "שדרת הגעתון", "ה' באייר", "“הגליל”",
]

failures = []


def check(cond, msg):
    if not cond:
        failures.append(msg)


def psql(db, sql=None, files=(), quiet=False):
    cmd = ["psql", "-v", "ON_ERROR_STOP=1", "-q", "-tA", db]
    for f in files:
        cmd += ["-f", str(f)]
    if sql is not None:
        cmd += ["-c", sql]
    return subprocess.check_output(
        cmd, env={**os.environ, "PGOPTIONS": "-c client_min_messages=error"}, text=True,
        stderr=subprocess.DEVNULL if quiet else None).strip()


def static_checks():
    sql = MIGRATION.read_text(encoding="utf-8")
    flat = re.sub(r"--[^\n]*", "", sql).lower()
    for bad in ("drop ", "rename ", "function public.street_name_key", "update public.properties",
                "create extension", "alter column"):
        check(bad not in flat, f"המיגרציה מכילה '{bad.strip()}' - היא אמורה רק להוסיף")


def key_function_sql():
    src = REGISTRY.read_text(encoding="utf-8")
    m = re.search(r"create or replace function public\.street_name_key.*?\$\$;", src, re.S)
    if not m:
        sys.exit("street_name_key לא נמצאה ב-" + REGISTRY.name)
    return m.group(0)


def js_keys(path):
    code = (
        "const S=require(process.argv[1]);"
        "const xs=JSON.parse(require('fs').readFileSync(0,'utf8'));"
        "process.stdout.write(JSON.stringify(xs.map(x=>S.streetNameKey(x))));"
    )
    out = subprocess.check_output(["node", "-e", code, str(path)], input=json.dumps(SAMPLES), text=True)
    return json.loads(out)


def sql_keys(db):
    arr = json.dumps(SAMPLES, ensure_ascii=False).replace("'", "''")
    out = psql(db, f"select json_agg(public.street_name_key(x) order by o) "
                   f"from json_array_elements_text('{arr}'::json) with ordinality t(x, o)")
    return json.loads(out)


AGENT = "11111111-1111-1111-1111-111111111111"
OTHER = "22222222-2222-2222-2222-222222222222"

DATA = f"""
insert into public.properties (listing_number, title, street, address, city, agent_id, created_at) values
  (1076, 'דירת 4 חדרים ברחוב העלייה', 'עלייה', 'עלייה 3', 'עפולה', '{AGENT}', now() - interval '5 day'),
  (1090, 'דירה בהעלייה', 'עלייה', 'עלייה 8', 'עפולה', '{AGENT}', now() - interval '4 day'),
  (1139, 'בית בעליה', 'עלייה', 'עלייה 12', 'עפולה', '{AGENT}', now() - interval '3 day'),
  (1161, 'דירת גן', 'עלייה', 'עלייה 20', 'עפולה', '{AGENT}', now() - interval '2 day'),
  (1302, 'פנטהאוז בעלייה', 'עלייה', 'עלייה 1', 'עפולה', '{AGENT}', now() - interval '1 day'),
  (2001, 'דירה בהרצל', 'הרצל', 'הרצל 5', 'עפולה', '{AGENT}', now()),
  (2002, 'דירה', 'רח'' הרצל', 'רח'' הרצל 9', 'עפולה', '{AGENT}', now()),
  (2003, 'דירה ברצל', 'רצל', 'רצל 1', 'עפולה', '{AGENT}', now()),
  (2004, 'בית', 'העמק', 'העמק 2', 'עפולה', '{AGENT}', now()),
  (2005, 'דירה', 'הנשיאים', 'הנשיאים 4', 'עפולה', '{AGENT}', now()),
  (2006, 'דירה בעפולה עלית', 'עלית', 'עלית 3', 'עפולה', '{AGENT}', now()),
  (2007, 'דירה של אחר', 'עלייה', 'עלייה 30', 'עפולה', '{OTHER}', now());
"""


def crm(db, q, agent=AGENT):
    out = psql(db, f"set test.agent = '{agent}'; select public.crm_search($q${q}$q$, 20)")
    return json.loads(out.splitlines()[-1])


def admin(db, q):
    out = psql(db, f"set test.admin = 'on'; select public.admin_search($q${q}$q$, 20)")
    return json.loads(out.splitlines()[-1])


def main():
    static_checks()

    ref = js_keys(ROOT / "assets/search-core.js")
    shared = js_keys(ROOT / "supabase/functions/_shared/search-core.js")
    check(ref == shared, "שני העותקים של streetNameKey מחזירים מפתחות שונים")

    db = os.environ.get("STREET_KEY_DB", "street_key_test")
    subprocess.check_call(["dropdb", "--if-exists", "--maintenance-db=postgres", db], stderr=subprocess.DEVNULL)
    subprocess.check_call(["createdb", "--maintenance-db=postgres", db])
    psql(db, files=[SETUP])
    psql(db, key_function_sql())
    psql(db, files=[CRM_SEARCH, ADMIN_SEARCH])
    psql(db, DATA)

    # המצב שלפני: ilike בלבד (הגרסה הקודמת של שתי הפונקציות)
    spot = ["הרצל", "העמק", "הנשיאים", "עלית"]
    before = {q: {r["title"] for r in crm(db, q)["props"]} for q in spot}

    psql(db, files=[MIGRATION])
    psql(db, files=[MIGRATION])  # פעם שנייה - אידמפוטנטית

    sql = sql_keys(db)
    for s, a, b in zip(SAMPLES, sql, ref):
        check(a == b, f"מפתח שונה ל-{s!r}: SQL {a!r}, JS {b!r}")

    # העמודה מלאה בשורות שכבר היו
    check(psql(db, "select count(*) from public.properties where street_key is null and street is not null") == "0",
          "street_key ריק בשורות קיימות")

    five = {"דירת 4 חדרים ברחוב העלייה", "דירה בהעלייה", "בית בעליה", "דירת גן", "פנטהאוז בעלייה"}
    five_ln = {1076, 1090, 1139, 1161, 1302}
    for q in ["העלייה", "עלייה", "העליה", "עליה", "רחוב העלייה"]:
        r = crm(db, q)
        titles = [p["title"] for p in r["props"]]
        check(five <= set(titles), f"crm_search {q!r}: חסרים {sorted(five - set(titles))}")
        check("דירה של אחר" not in titles, f"crm_search {q!r}: נכס של סוכן/ת אחר/ת")
        check("דירה בעפולה עלית" not in titles, f"crm_search {q!r}: עלית אינה עלייה")
        check(all("x_exact" not in p and "ts" not in p for p in r["props"]), "עמודת עזר דלפה לפלט")
        exact = [any(q in (p[f] or "") for f in ("title", "address")) for p in r["props"]]
        check(exact == sorted(exact, reverse=True), f"crm_search {q!r}: התאמה מדויקת לא קודמת {titles}")

        a = admin(db, q)
        nums = {p["listing_number"] for p in a["aprops"]}
        check(five_ln <= nums, f"admin_search {q!r}: חסרים {sorted(five_ln - nums)}")
        check(2006 not in nums, f"admin_search {q!r}: עלית אינה עלייה")

    # "עלייה" מדויק מקדים: 1076 ("ברחוב העלייה") ראשון ב"העלייה"
    first = crm(db, "העלייה")["props"][0]["title"]
    check(first in ("דירת 4 חדרים ברחוב העלייה", "דירה בהעלייה"), f"הראשון ב'העלייה' הוא {first}")

    for q in spot:
        after = {p["title"] for p in crm(db, q)["props"]}
        check(before[q] <= after, f"{q!r}: נעלמו {sorted(before[q] - after)}")
        added = after - before[q]
        keys = psql(db, "select coalesce(string_agg(distinct street_key, ','), '') from public.properties "
                        f"where title = any(array[{','.join(repr(t) for t in added) or 'null'}]::text[])")
        want = psql(db, f"select public.street_name_key($q${q}$q$)")
        check(all(k == want for k in keys.split(",") if k), f"{q!r}: נוספו נכסים שאינם אותו רחוב: {sorted(added)}")

    # גישה: anon אינו מריץ, ובלי מנהל/ת פלטפורמה admin_search נכשלת
    check(psql(db, "select has_function_privilege('anon', 'public.crm_search(text,int)', 'execute')") == "f",
          "anon יכול להריץ crm_search")
    check(psql(db, "select has_function_privilege('anon', 'public.admin_search(text,int)', 'execute')") == "f",
          "anon יכול להריץ admin_search")
    try:
        psql(db, "select public.admin_search('עלייה', 6)", quiet=True)
        failures.append("admin_search רצה בלי מנהל/ת פלטפורמה")
    except subprocess.CalledProcessError:
        pass

    if failures:
        print("\n".join("✗ " + f for f in failures))
        sys.exit(1)
    print(f"✓ {len(SAMPLES)} מפתחות זהים ב-SQL וב-JS, המיגרציה פעמיים, וחמשת הכתיבים מוצאים את כל החמישה")


if __name__ == "__main__":
    main()
