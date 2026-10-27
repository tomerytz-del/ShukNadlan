#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""הבדיקה של check_baseline_view_grants.py נבדקת בעצמה.

בלי זה רגרסיה ב-regex הייתה עוברת ירוק על הריפו כל עוד אין קובץ מאוחר
שמחזיר את החור.
"""
import contextlib
import io
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check_baseline_view_grants as chk  # noqa: E402

BASELINE = """-- revoke all on public.market_city_names from public;
revoke all on public.market_city_names from public, anon, authenticated;
alter view public.market_city_names set (security_invoker = true);
revoke insert, update, delete, truncate, references, trigger on public.saved_search_leads_public from public, anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.project_leads_shelf from public, anon, authenticated;
grant execute on function public.agent_share_fit(uuid, text, uuid) to authenticated;
"""
EARLIER = (
    'create or replace view public.market_city_names as\n'
    'select 1 as id;\n'
    'grant insert, update, delete on public.market_city_names to anon;\n'
    'revoke all on function public.agent_share_fit(uuid, text, uuid) '
    'from public, anon, authenticated;\n'
)
BASE = 'supabase/migrations/20270902090000_baseline_urgent_fixes_20261027.sql'
OLD = 'supabase/migrations/20270115101000_agency_city.sql'


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


def base(**later):
    layout = {OLD: EARLIER, BASE: BASELINE}
    layout.update(later)
    return layout


CASES = [
    ('יצירה ישנה בלי invoker, והסגירה אחריה, עוברת', 0, base()),
    ('אין קובץ בסיס', 1, {OLD: EARLIER}),
    ('grant select מאוחר עובר', 0, base(**{
        'supabase/migrations/20270903090000_later.sql':
            'grant select on public.saved_search_leads_public to authenticated;\n',
    })),
    ('grant insert מאוחר נחסם', 1, base(**{
        'supabase/migrations/20270903090000_later.sql':
            'grant insert on public.project_leads_shelf to authenticated;\n',
    })),
    ('grant all ל-service_role עובר', 0, base(**{
        'supabase/migrations/20270903090000_later.sql':
            'grant all on public.market_city_names to service_role;\n',
    })),
    ('create מאוחר בלי invoker נחסם', 1, base(**{
        'supabase/migrations/20270903090000_later.sql':
            'create or replace view public.market_city_names as select 1 as id;\n',
    })),
    ('create מאוחר עם invoker עובר', 0, base(**{
        'supabase/migrations/20270903090000_later.sql':
            'create or replace view public.market_city_names\n'
            'with (security_invoker = true) as select 1 as id;\n',
    })),
    ('revoke של authenticated בלי grant נחסם', 1, base(**{
        'supabase/migrations/20270903090000_later.sql':
            'revoke all on function public.agent_share_fit(uuid, text, uuid) '
            'from authenticated;\n',
    })),
    ('revoke ואחר כך grant באותו קובץ עובר', 0, base(**{
        'supabase/migrations/20270903090000_later.sql':
            'revoke all on function public.agent_share_fit(uuid, text, uuid) '
            'from public, anon, authenticated;\n'
            'grant execute on function public.agent_share_fit(uuid, text, uuid) '
            'to authenticated;\n',
    })),
    ('grant בהערה אינו נספר', 0, base(**{
        'supabase/migrations/20270903090000_later.sql':
            '-- grant insert on public.saved_search_leads_public to anon;\n',
    })),
    ('schema.sql שמחזיר כתיבה נחסם', 1, base(**{
        'schema.sql':
            'grant update, delete on public.market_city_names to anon;\n',
    })),
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
