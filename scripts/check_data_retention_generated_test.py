#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""הבדיקה של check_data_retention_generated.py נבדקת בעצמה.

בלי זה רגרסיה בזיהוי ההגדרה האחרונה הייתה עוברת ירוק על הריפו כל עוד
הקבצים הקיימים במקרה תואמים את הדפוס השבור.
"""
import contextlib
import io
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check_data_retention_generated as chk  # noqa: E402

GOOD = (
    'create or replace function public.data_retention_run()\n'
    'returns jsonb language plpgsql security definer\n'
    "set search_path = ''\n"
    'as $$\n'
    'begin\n'
    '  update public.mortgage_leads\n'
    "     set full_name = 'נמחק', phone = '', email = null\n"
    '   where created_at < now();\n'
    '  update public.project_leads\n'
    '     set phone_e164 = null\n'
    '   where created_at < now();\n'
    'end $$;\n'
)
BAD = GOOD.replace(
    "set full_name = 'נמחק', phone = '', email = null",
    "set full_name = 'נמחק', phone = '', phone_e164 = null, email = null",
)
TIGHT = GOOD.replace(
    "phone = '', email = null",
    "phone = '', phone_e164=null, email = null",
)
COMMENT_ONLY = (
    '-- create or replace function public.data_retention_run()\n'
    '-- returns jsonb as $$\n'
    '-- update public.mortgage_leads set phone_e164 = null;\n'
    '-- end $$;\n'
)
BODY_COMMENT = GOOD.replace(
    'begin\n',
    'begin\n'
    '  -- אל תכתוב update public.mortgage_leads set phone_e164 = null;\n',
)
BLOCK_COMMENT = GOOD.replace(
    'begin\n',
    'begin\n'
    '  /* update public.mortgage_leads set phone_e164 = null where true; */\n',
)
FUNCTION_TAG = GOOD.replace('as $$', 'as $function$').replace('end $$;', 'end $function$;')


def write(root, name, sql):
    path = os.path.join(root, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(sql)


def run(layout):
    with tempfile.TemporaryDirectory() as root:
        for name, sql in layout.items():
            write(root, name, sql)
        with contextlib.redirect_stdout(io.StringIO()):
            return chk.main(root)


CASES = [
    ('הגדרה בלי השמה עוברת', 0, {
        'supabase/migrations/1_ok.sql': GOOD,
    }),
    ('השמה ל-phone_e164 נחסמת', 1, {
        'supabase/migrations/1_bad.sql': BAD,
    }),
    ('השמה בלי רווח נחסמת', 1, {
        'supabase/migrations/1_tight.sql': TIGHT,
    }),
    ('הגדרה ישנה פגומה והאחרונה תקינה עוברת', 0, {
        'supabase/migrations/1_bad.sql': BAD,
        'supabase/migrations/2_ok.sql': GOOD,
    }),
    ('הגדרה מאוחרת פגומה נחסמת', 1, {
        'supabase/migrations/1_ok.sql': GOOD,
        'supabase/migrations/2_bad.sql': BAD,
    }),
    ('רק בהערה אינו נספר', 1, {
        'supabase/migrations/1_comment.sql': COMMENT_ONLY,
    }),
    ('הערה בגוף הפונקציה אינה השמה', 0, {
        'supabase/migrations/1_body.sql': BODY_COMMENT,
    }),
    ('הערת בלוק בגוף אינה השמה', 0, {
        'supabase/migrations/1_block.sql': BLOCK_COMMENT,
    }),
    ('תגית $function$ נקראת', 0, {
        'supabase/migrations/1_tag.sql': FUNCTION_TAG,
    }),
    ('אין הגדרה בכלל נחסם', 1, {
        'supabase/migrations/1_empty.sql': 'select 1;\n',
    }),
]


def main():
    failed = 0
    for title, want, layout in CASES:
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
