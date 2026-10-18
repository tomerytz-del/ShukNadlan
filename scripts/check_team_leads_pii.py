#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""מנהל/ת צוות לעולם אינו/ה מקבל/ת טלפון של ליד או את ההודעה החופשית.

## למה הבדיקה הזו קיימת

זו החלטה של תומר (docs/handoff/crm-redesign/HANDOFF.md, החלטה 3):
מנהל/ת **צוות** רואה מדדים מסוכמים, ובנוסף את שם הלקוח/ה ופרטי הליד של
הלידים בצוות - **בלי מספרי טלפון**. הגישה היא רק דרך `team_leads()`
(security definer), וה-RLS של `leads` לא הורחב (docs/team-dashboard.md).

כלומר כל מה שהפונקציה מחזירה - יוצא. ועמודה אחת שנוספת לה "רק כדי שיהיה
נוח לחזור ללקוח" היא בדיוק הדליפה, והיא שקטה לגמרי: המיגרציה עוברת,
הדאשבורד עובד, ואין שום סימן שמנהל/ת הצוות רואה עכשיו טלפונים.

## מה נבדק

לכל פונקציה בשם ברשימה `GUARDED`, **ההגדרה האחרונה** שלה במיגרציות (לפי
סדר ה-version): הגוף, ורשימת העמודות שהיא מחזירה, אינם מזכירים עמודה
אסורה - `raw_phone`, `display_phone`, `phone`, `raw_message`,
`display_message`, `phone_e164`, ‏`phone_tail` וכל מה שנגזר מהם.

הרצה:
    python scripts/check_team_leads_pii.py
"""
import os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIG = os.path.join(ROOT, 'supabase', 'migrations')

# פונקציות שמחזירות נתוני לידים למי שאינו/ה הסוכן/ת המטפל/ת
GUARDED = ['team_leads']

FORBIDDEN = re.compile(r'\b(raw_phone|display_phone|phone_e164|phone_tail\w*|phone|raw_message|display_message)\b',
                       re.IGNORECASE)


def strip_comments(sql):
    return re.sub(r'--[^\n]*', '', sql)


def latest_definition(name):
    """הגוף של ההגדרה האחרונה: מ-create ... function public.<name>( ועד סוף ה-$$."""
    found = None
    for fn in sorted(os.listdir(MIG)):
        if not fn.endswith('.sql'):
            continue
        sql = open(os.path.join(MIG, fn), encoding='utf-8').read()
        for m in re.finditer(r'create\s+(?:or\s+replace\s+)?function\s+public\.' + re.escape(name) + r'\s*\(',
                             sql, re.IGNORECASE):
            rest = sql[m.start():]
            tag = re.search(r'as\s+(\$[A-Za-z_]*\$)', rest, re.IGNORECASE)
            if not tag:
                continue
            body_start = tag.end()
            body_end = rest.find(tag.group(1), body_start)
            found = (fn, rest[:body_end if body_end > 0 else len(rest)])
    return found


def main():
    problems = []
    for name in GUARDED:
        hit = latest_definition(name)
        if not hit:
            continue   # הפונקציה עוד לא קיימת - אין מה לבדוק
        fn, text = hit
        bad = sorted(set(m.group(1).lower() for m in FORBIDDEN.finditer(strip_comments(text))))
        if bad:
            problems.append(f'{name} ({fn}) מזכירה: {", ".join(bad)}')
    if problems:
        print('✗ פונקציה שמוסרת לידים למנהל/ת צוות מזכירה טלפון או הודעה חופשית:\n')
        for p in problems:
            print('  · ' + p)
        print('\nהטלפון וההודעה נשארים אצל הסוכן/ת המטפל/ת. ‏docs/team-dashboard.md')
        return 1
    print(f'✓ {", ".join(GUARDED)}: אין טלפון ואין הודעה חופשית בפלט.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
