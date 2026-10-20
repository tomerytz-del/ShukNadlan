#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""הבדיקה של check_table_grants.py נבדקת בעצמה, על קורפוס מיגרציות מדומה.

הסיבה: היום אין אף טבלה אחרי ה-CUTOFF, ולכן ההרצה על הריפו עוברת ירוק
גם אם ה-regex שבור לגמרי. בלי המקרים כאן, הבדיקה הייתה מוכיחה כלום עד
הטבלה החדשה הראשונה - ואז, אם היא שבורה, מעבירה אותה בשקט.
"""
import contextlib
import io
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check_table_grants as ctg  # noqa: E402

OLD = '20200101000000'
NEW = '29990101000000'

CASES = [
    ('טבלה חדשה בלי שום הרשאה נחסמת', 1, {
        NEW: 'create table if not exists public.t1 (id int);',
    }),
    ('הדפוס הישן - revoke מ-anon בלבד - נחסם', 1, {
        NEW: 'create table public.t1 (id int);\n'
             'revoke all on table public.t1 from anon;',
    }),
    ('grant לשניים ו-revoke לשלישי עובר', 0, {
        NEW: 'create table public.t1 (id int);\n'
             'grant select, insert, update, delete on table public.t1 to authenticated, service_role;\n'
             'revoke all on table public.t1 from anon;',
    }),
    ('grant בלי המילה table, על רשימת טבלאות', 0, {
        NEW: 'create table public.t1 (id int);\ncreate table public.t2 (id int);\n'
             'grant select on public.t1, public.t2 to anon, authenticated, service_role;',
    }),
    ('grant דינמי ב-do $$ על מערך שמות', 0, {
        NEW: "create table public.t1 (id int);\n"
             "do $$ declare t text; begin\n"
             "  foreach t in array array['t1'] loop\n"
             "    execute format('revoke all on table public.%I from anon', t);\n"
             "    execute format('grant select on table public.%I to authenticated, service_role', t);\n"
             "  end loop;\nend $$;",
    }),
    ('view חדש נבדק גם הוא', 1, {
        NEW: 'create or replace view public.v1 as select 1;',
    }),
    ('החלפת view ותיק אינה יצירה', 0, {
        OLD: 'create view public.v1 as select 1;',
        NEW: 'create or replace view public.v1 as select 1, 2;',
    }),
    ('טבלה ותיקה שמופיעה שוב ב-if not exists אינה חדשה', 0, {
        OLD: 'create table public.t1 (id int);',
        NEW: 'create table if not exists public.t1 (id int);',
    }),
    ('create table בהערה אינו נספר', 0, {
        NEW: '-- create table public.t1 (id int);\nselect 1;',
    }),
    ('grant על פונקציה אינו נספר לטבלה', 1, {
        NEW: 'create table public.t1 (id int);\n'
             'grant execute on function public.t1() to anon, authenticated, service_role;',
    }),
]


def run(files: dict) -> int:
    with tempfile.TemporaryDirectory() as root:
        os.makedirs(os.path.join(root, 'supabase/migrations'))
        for version, sql in files.items():
            with open(os.path.join(root, f'supabase/migrations/{version}_x.sql'),
                      'w', encoding='utf-8') as f:
                f.write(sql)
        with contextlib.redirect_stdout(io.StringIO()):
            return ctg.main(root)


def main() -> int:
    failed = 0
    for title, want, files in CASES:
        got = run(files)
        ok = (got != 0) == (want != 0)
        failed += not ok
        print(f'{"✓" if ok else "✗"} {title}' + ('' if ok else f'  (קיבלתי {got}, ציפיתי {want})'))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
