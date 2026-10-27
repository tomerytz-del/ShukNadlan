#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""הבדיקה של check_notification_backfill.py נבדקת על קבצים מדומים."""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check_notification_backfill as chk  # noqa: E402

OLD = '20200101000000'
NEW = '29990101000000'


def run(files: dict) -> int:
    with tempfile.TemporaryDirectory() as root:
        mig = os.path.join(root, 'supabase', 'migrations')
        os.makedirs(mig)
        for name, body in files.items():
            with open(os.path.join(mig, name), 'w', encoding='utf-8') as f:
                f.write(body)
        return chk.main(root)


CASES = [
    ('ישן בלי סמן עובר', 0, {
        f'{OLD}_old.sql': 'insert into public.notifications (agent_id) values (1);',
    }),
    ('חדש בלי סמן נחסם', 1, {
        f'{NEW}_bad.sql': 'insert into public.notifications (agent_id, type) values (1, \'x\');',
    }),
    ('חדש עם suppress_push עובר', 0, {
        f'{NEW}_ok.sql':
            'insert into public.notifications (agent_id, type, suppress_push)\n'
            'values (1, \'x\', true);',
    }),
    ('התאמות עם push_site_only עוברות', 0, {
        f'{NEW}_match.sql':
            'insert into client_match_alerts (agent_id, push_site_only) values (1, true);',
    }),
    ('insert בהערה אינו נספר', 0, {
        f'{NEW}_comment.sql': '-- insert into public.notifications (agent_id) values (1);\nselect 1;',
    }),
    ('קריאה ל-notification_push_suppress מספיקה', 0, {
        f'{NEW}_helper.sql':
            'select public.notification_push_suppress(true);\n'
            'insert into public.notifications (agent_id) values (1);',
    }),
]

failed = 0
for title, expect, files in CASES:
    got = run(files)
    ok = got == expect
    print(f'{"✓" if ok else "✗"} {title}')
    if not ok:
        failed += 1
        print(f'    ציפינו ל-{expect}, קיבלנו {got}')

if failed:
    sys.exit(1)
print(f'✓ {len(CASES)} מקרי מילוי עברו')
