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
    ('suppress_push רק ב-WHERE נחסם', 1, {
        f'{NEW}_where.sql':
            'insert into public.notifications (agent_id, type)\n'
            'select agent_id, type from public.notifications where not suppress_push;',
    }),
    ('הקריאה אחרי ה-insert לא מכסה אותו', 1, {
        f'{NEW}_after.sql':
            'insert into public.notifications (agent_id) values (1);\n'
            'select public.notification_push_suppress(true);',
    }),
    ('מחולל בלי דגל נחסם', 1, {
        f'{NEW}_call.sql':
            "select public.notify_agent_on_new_lead('00000000-0000-0000-0000-000000000001');",
    }),
    ('select star from מחולל נחסם', 1, {
        f'{NEW}_star.sql':
            'select * from public.generate_client_match_alerts();',
    }),
    ('מחולל אחרי הדגל עובר', 0, {
        f'{NEW}_call_ok.sql':
            'select public.notification_push_suppress(true);\n'
            'perform public.generate_client_match_alerts();',
    }),
    ('מילוי publish_channels נחסם', 1, {
        f'{NEW}_channels.sql':
            "update public.properties set publish_channels = array['site']::text[] where status = 'active';",
    }),
    ('השמה ל-NEW אינה מילוי', 0, {
        f'{NEW}_sync.sql':
            "new.publish_channels := array['site']::text[];\n"
            "new.share_with_brokers := true;",
    }),
    ('set_config בתוך פונקציה לא מכסה insert בחוץ', 1, {
        f'{NEW}_body.sql':
            "create function public.notification_push_suppress(p_on boolean) returns void language plpgsql as $$\n"
            "begin perform set_config('app.suppress_push', 'on', true); end $$;\n"
            'insert into public.notifications (agent_id, type) values (1, \'x\');',
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
