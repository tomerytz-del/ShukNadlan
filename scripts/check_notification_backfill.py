#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""מיגרציה שכותבת התראות חייבת לסמן שהן לא דחיפת מילוי.

מילוי כיסוי, ייבוא, או מיפוי עיר שכותב ל-notifications או ל-
client_match_alerts בלי suppress_push שופך וואטסאפ לסוכנים. הדגל
app.suppress_push הוא לטרנזקציה, והעמודה נשארת ל-cron.

אזכור של suppress_push ב-WHERE אינו סימון. גם קריאה לפונקציה
שמכניסה התראות (notify_agent_on_new_lead וכדומה) נספרת, לא רק
insert גלוי. הסימון חייב להיות בעמודות ה-insert, או קריאה ל-
notification_push_suppress() לפני הכתיבה באותו גוף.

הסף הוא מיגרציית השמירה (20271028140000) כולל. קבצים ישנים יותר
נכתבו לפני העמודה, והבדיקה לא מלמדת אותם מחדש.

    python3 scripts/check_notification_backfill.py
"""
import glob
import os
import re
import sys

CUTOFF = '20271028140000'
INSERT_RE = re.compile(
    r'\binsert\s+into\s+(?:public\.)?(notifications|client_match_alerts)\b',
    re.I,
)
GENERATORS = (
    'scraped_lead_notify_demand',
    'notify_agent_on_new_lead',
    'share_property_for_agent',
    'generate_client_match_alerts',
    'client_match_digest_run',
)
CALL_RE = re.compile(
    r'\b(?:select|perform)\s+(?:public\.)?(?:' + '|'.join(GENERATORS) + r')\s*\(',
    re.I,
)
SUPPRESS_CALL_RE = re.compile(
    r'\b(?:select|perform)\s+(?:public\.)?notification_push_suppress\s*\('
    r"|\b(?:select|perform)\s+set_config\s*\(\s*'app\.suppress_push'",
    re.I,
)
BODY_RE = re.compile(r'\$([A-Za-z0-9_]*)\$(.*?)\$\1\$', re.S)
COMMENT_RE = re.compile(r'--[^\n]*')
COL_MARKERS = {
    'notifications': 'suppress_push',
    'client_match_alerts': 'push_site_only',
}


def version_of(path: str) -> str:
    return os.path.basename(path).split('_', 1)[0]


def strip_comments(sql: str) -> str:
    return COMMENT_RE.sub(lambda m: ' ' * len(m.group(0)), sql)


def column_list_marked(code: str, match: re.Match) -> bool:
    table = match.group(1).lower()
    cols = re.match(r'\s*\(([^)]*)\)', code[match.end():], re.S)
    if not cols:
        return False
    return re.search(r'\b' + COL_MARKERS[table] + r'\b', cols.group(1), re.I) is not None


def suppress_before(code: str, pos: int) -> bool:
    return SUPPRESS_CALL_RE.search(code, 0, pos) is not None


def unmarked(code: str) -> bool:
    """True אם יש כתיבה בלי סמן בתוך הטקסט הזה."""
    for match in INSERT_RE.finditer(code):
        if column_list_marked(code, match):
            continue
        if suppress_before(code, match.start()):
            continue
        return True
    for match in CALL_RE.finditer(code):
        if suppress_before(code, match.start()):
            continue
        return True
    return False


def scan(sql: str) -> bool:
    """True אם יש כתיבת התראות בלי סמן מילוי.

    גוף פונקציה נבדק לבד: set_config בהגדרת העוזר אינו מדליק את
    הדגל ל-insert שמאוחר יותר בקובץ, ורק כשהפונקציה רצה.
    """
    code = strip_comments(sql)
    bodies = []

    def stash(match: re.Match) -> str:
        bodies.append(match.group(2))
        return ' ' * len(match.group(0))

    outside = BODY_RE.sub(stash, code)
    if unmarked(outside):
        return True
    return any(unmarked(body) for body in bodies)


HOOD_UPDATE_RE = re.compile(
    r'\bupdate\s+(?:only\s+)?(?:public\.)?properties\b',
    re.I,
)


PUBLISH_CHANNELS_UPDATE_RE = re.compile(
    r'\bupdate\s+(?:only\s+)?(?:public\.)?properties\b[\s\S]{0,800}?\bpublish_channels\s*=',
    re.I,
)


def publish_channels_backfill(sql: str) -> bool:
    """מילוי publish_channels על נכסים קיימים מכניס גל לתור הרשתות.

    הבחירה היא per property. עדכון המוני בזמן שהדגל דלוק עובר בטריגר
    של כל שורה. מילוי כזה לא נכתב במיגרציה.
    """
    return bool(PUBLISH_CHANNELS_UPDATE_RE.search(strip_comments(sql)))


def hood_backfill_unmarked(sql: str) -> bool:
    """עדכון neighborhood_id על properties בלי השתקה הוא גל התאמות.

    הטריגרים properties_client_match_alerts ו-properties_prune_stale_alerts
    רצים על כל שורה פעילה שהשכונה שלה משתנה. מילוי חוזר חייב
    notification_push_suppress לפני ה-update, או לרוץ במנות מחוץ למיגרציה.
    """
    code = strip_comments(sql)
    for match in HOOD_UPDATE_RE.finditer(code):
        window = code[match.start():match.start() + 1200]
        semi = window.find(';')
        stmt = window if semi < 0 else window[:semi]
        if not re.search(r'\bneighborhood_id\s*=', stmt, re.I):
            continue
        if suppress_before(code, match.start()):
            continue
        return True
    return False


def main(root: str = '.') -> int:
    bad = 0
    files = sorted(glob.glob(os.path.join(root, 'supabase/migrations/*.sql')))
    checked = 0
    for path in files:
        if version_of(path) < CUTOFF:
            continue
        checked += 1
        sql = open(path, encoding='utf-8').read()
        rel = os.path.relpath(path, root)
        if scan(sql):
            bad += 1
            print(f'✗ {rel}')
            print('    insert או קריאה למחולל התראות בלי סימון מילוי.')
            print('    suppress_push ב-WHERE אינו נחשב. צריך את העמודה')
            print('    ב-insert, או select public.notification_push_suppress(true)')
            print('    לפני הכתיבה באותו גוף.')
            print('    התיעוד: docs/notifications-center.md, "שמירה מפני התפרצות".')
        if publish_channels_backfill(sql):
            bad += 1
            print(f'✗ {rel}')
            print('    update של properties.publish_channels במיגרציה.')
            print('    זו בחירה per property. מילוי המוני נכנס לתור הרשתות.')
            print('    התיעוד: docs/facebook-auto-publish.md, "יעד מוואטסאפ".')
        if hood_backfill_unmarked(sql):
            bad += 1
            print(f'✗ {rel}')
            print('    update של properties.neighborhood_id בלי השתקת דחיפה.')
            print('    הטריגר יוצר גל התאמות. צריך')
            print('    select public.notification_push_suppress(true) לפניו,')
            print('    או מנות מחוץ למיגרציה.')
            print('    התיעוד: docs/notifications-center.md, "מלאי מחוללים".')
    if bad:
        print(f'\n{bad} מיגרציות כותבות התראות בלי סימון מילוי.')
        return 1
    print(f'✓ {checked} מיגרציות מ-{CUTOFF}: insert של התראות מסומן, או שאין insert.')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else '.'))
