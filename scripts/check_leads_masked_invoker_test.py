#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""הבדיקה של check_leads_masked_invoker.py נבדקת בעצמה.

בלי זה רגרסיה ב-regex הייתה עוברת ירוק על הריפו כל עוד הקבצים הקיימים
במקרה תואמים את הדפוס השבור.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check_leads_masked_invoker as chk  # noqa: E402

GOOD = (
    'create or replace view public.leads_masked\n'
    'with (security_invoker = true) as\n'
    'select 1 as id;\n'
)
BAD = 'create or replace view public.leads_masked as select 1 as id;\n'
FALSE = (
    'create or replace view public.leads_masked\n'
    'with (security_invoker = false) as\n'
    'select 1 as id;\n'
)
COMMENT_ONLY = '-- create or replace view public.leads_masked as select 1;\n'
DOLLAR = (
    'create function public.f() returns void language sql as $$\n'
    '  select 1;\n'
    '$$;\n'
    + GOOD
)


def write(root, name, sql):
    path = os.path.join(root, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(sql)


def run(layout):
    import tempfile
    with tempfile.TemporaryDirectory() as root:
        for name, sql in layout.items():
            write(root, name, sql)
        return chk.main(root)


CASES = [
    ('with (security_invoker = true) עובר', 0, {
        'supabase/migrations/1_x.sql': GOOD,
    }),
    ('בלי האפשרות נחסם', 1, {
        'supabase/migrations/1_x.sql': BAD,
    }),
    ('security_invoker = false נחסם', 1, {
        'supabase/migrations/1_x.sql': FALSE,
    }),
    ('רק בהערה אינו נספר, ואין יצירה אמיתית', 1, {
        'supabase/migrations/1_x.sql': COMMENT_ONLY,
    }),
    ('אחת תקינה ואחת לא', 1, {
        'supabase/migrations/1_x.sql': GOOD + BAD,
    }),
    ('גוף dollar-quote אינו נסרק, היצירה שאחריו כן', 0, {
        'supabase/migrations/1_x.sql': DOLLAR,
    }),
    ('schema.sql נבדק גם הוא', 1, {
        'supabase/migrations/1_x.sql': GOOD,
        'schema.sql': BAD,
    }),
]


def main():
    failed = 0
    for title, want, layout in CASES:
        import contextlib
        import io
        with contextlib.redirect_stdout(io.StringIO()):
            got = run(layout)
        if got != want:
            print(f'✗ {title}: ציפינו {want}, קיבלנו {got}')
            failed += 1
        else:
            print(f'✓ {title}')
    if failed:
        print(f'\n{failed} מקרים נכשלו')
        return 1
    print(f'\n✓ {len(CASES)} מקרים')
    return 0


if __name__ == '__main__':
    sys.exit(main())
