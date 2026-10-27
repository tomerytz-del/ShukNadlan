#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""מיגרציה שכותבת התראות חייבת לסמן שהן לא דחיפת מילוי.

מילוי כיסוי, ייבוא, או מיפוי עיר שכותב ל-notifications או ל-
client_match_alerts בלי suppress_push שופך וואטסאפ לסוכנים. הדגל
app.suppress_push הוא לטרנזקציה, והעמודה נשארת ל-cron.

הסף הוא מיגרציית השמירה (20271028140000) כולל. קבצים ישנים יותר
נכתבו לפני העמודה, והבדיקה לא מלמדת אותם מחדש.

    python3 scripts/check_notification_backfill.py
"""
import glob
import os
import re
import sys

CUTOFF = '20271028140000'
NAME = r'(?:public\.)?(?:notifications|client_match_alerts)\b'
INSERT_RE = re.compile(r'\binsert\s+into\s+' + NAME, re.I)
MARKERS = (
    'notification_push_suppress',
    'app.suppress_push',
    'suppress_push',
    'push_site_only',
)
COMMENT_RE = re.compile(r'--[^\n]*')


def version_of(path: str) -> str:
    return os.path.basename(path).split('_', 1)[0]


def scan(sql: str) -> bool:
    """True אם יש insert בלי סמן מילוי בקובץ."""
    code = COMMENT_RE.sub(lambda m: ' ' * len(m.group(0)), sql)
    if not INSERT_RE.search(code):
        return False
    return not any(marker in code for marker in MARKERS)


def main(root: str = '.') -> int:
    bad = 0
    files = sorted(glob.glob(os.path.join(root, 'supabase/migrations/*.sql')))
    checked = 0
    for path in files:
        if version_of(path) < CUTOFF:
            continue
        checked += 1
        sql = open(path, encoding='utf-8').read()
        if scan(sql):
            bad += 1
            rel = os.path.relpath(path, root)
            print(f'✗ {rel}')
            print('    insert ל-notifications או ל-client_match_alerts בלי')
            print('    notification_push_suppress / suppress_push / push_site_only.')
            print('    לפני הכתיבה: select public.notification_push_suppress(true);')
            print('    התיעוד: docs/notifications-center.md, "שמירה מפני התפרצות".')
    if bad:
        print(f'\n{bad} מיגרציות כותבות התראות בלי סימון מילוי.')
        return 1
    print(f'✓ {checked} מיגרציות מ-{CUTOFF}: insert של התראות מסומן, או שאין insert.')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else '.'))
