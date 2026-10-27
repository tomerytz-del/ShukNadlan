#!/usr/bin/env python3
# -*- coding: utf-8 -*-
""""יועצי נדל״ן" ולא "מתווכים" בטקסט שהאתר מציג (החלטת תומר, 27.10.2026).

**למה בדיקה:** המילה הישנה אינה שוברת דבר - הדף נטען ונראה תקין - והיא חוזרת
בכל נוסח חדש שמועתק מדף ישן. לכן היא נתפסת ב-CI.

**מה נבדק:** טקסט מוצג בלבד - טקסט ב-HTML, מאפיינים מוצגים ומחרוזות ב-JS/TS -
באותה מכונת מצבים של check_long_dash.py (הערות קוד פטורות).

**מה מותר:**
  * שמות סטטוטוריים: רשם המתווכים, פנקס המתווכים, חוק המתווכים, תקנות המתווכים.
  * כתובות: ‏/…/מתווכים (נתיבי SEO של PR #955 - רק טקסט העוגן משתנה).
  * הערך במסד "בלוג המתווכים" (קטגוריית כתבות; התצוגה ממופה בקוד).
  * מסמכים משפטיים ותבניות ההסכם (נוסח החוק) וקבצי PR #955 - לא נסרקים.

הרצה:
    python scripts/check_yoetz_copy.py
"""
import sys, os, glob, re

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check_long_dash as ld

SKIP = {
    # מסמכים משפטיים - מגדירים את הצדדים לפי חוק המתווכים במקרקעין (אחרי בדיקה משפטית בלבד)
    'terms.html', 'privacy.html', 'ethics-code.html',
    # נוסח הזמנת שירותי תיווך שהחוק מחייב
    'assets/agreement-templates.js',
    # קבצי PR #955 - מעקב אחרי שהוא ימוזג
    'brokers.html', 'silo.html', 'assets/brokers-render.js', 'assets/brokers.js', 'assets/silo-render.js', 'assets/silo.js',
    'assets/landing.js', 'netlify/edge-functions/brokers-page.ts', 'netlify/edge-functions/silo-page.ts',
}
# החלטה 10 (תומר, 27.10): ב-title וב-meta description של דפי המתווכים הניסוח המשולב "יועצי נדל״ן
# ומתווכים" אושר; og:title/og:description שם ממתינים לאישור ולכן נשארים כמו שהם
ALLOWED = re.compile(r'יועצי נדל״ן ומתווכים|<meta property="og:(?:title|description)" content="[^"]*"|חוק המתווכים, פרטי המתווך|(רשם|פנקס|חוק|תקנות) המתווכים|([\x27"])בלוג המתווכים\2|ניתוח שוק / בלוג המתווכים|(תקנות|חוק) \x27 \+\s*\x27המתווכים|/מתווכים|%D7%9E%D7%AA%D7%95%D7%95%D7%9B%D7%99%D7%9D')
WORD = re.compile(r'מתווכ|מתווך')


def files():
    pats = ['*.html', 'assets/*.js', 'netlify/edge-functions/*.ts', 'netlify/functions/*.mjs']
    out = []
    for p in pats: out += sorted(glob.glob(p))
    return [f for f in out if f not in SKIP]


def hits(path, src):
    """(שורה, הקשר) לכל מופע מוצג של המילה שאינו בביטוי מותר"""
    ld.DASHES = 'מ'
    kinds = {i: k for i, _, k in ld.scan(src, path.endswith('.html'))}
    allowed = set()
    for m in ALLOWED.finditer(src):
        allowed.update(range(m.start(), m.end()))
    out = []
    for m in WORD.finditer(src):
        i = m.start()
        # ‏'code' נחשב מוצג: המכונה מסווגת טקסט שאחרי ‎${…}‎ בתבנית JS כקוד, ושם המילה מוצגת
        if kinds.get(i) == 'comment' or i in allowed: continue
        line = src.count('\n', 0, i) + 1
        out.append((line, src[max(0, i - 30):i + 30].replace('\n', ' ').strip()))
    return out


def main():
    bad = []
    for f in files():
        src = open(f, encoding='utf-8').read()
        if not WORD.search(src): continue
        h = hits(f, src)
        if h: bad.append((f, h))
    for f in ('llms.txt', 'manifest.webmanifest', 'app-crm.webmanifest'):
        if os.path.exists(f):
            src = open(f, encoding='utf-8').read()
            h = [(src.count('\n', 0, m.start()) + 1, src[max(0, m.start() - 30):m.start() + 30].replace('\n', ' '))
                 for m in WORD.finditer(src) if not ALLOWED.search(src[max(0, m.start() - 6):m.start() + 12])]
            h = [x for x in h if not re.search(r'(רשם|פנקס|חוק|תקנות) המתווכים', x[1])]
            if h: bad.append((f, h))
    if not bad:
        print('✓ אין "מתווך/מתווכים" בטקסט שהאתר מציג (חוץ מהחריגים המותרים).')
        return 0
    total = sum(len(h) for _, h in bad)
    print(f'✗ {total} מופעים של "מתווך/מתווכים" בטקסט מוצג, ב-{len(bad)} קבצים - צריך "יועץ/יועצי נדל״ן":\n')
    for f, h in bad:
        print(f'  {len(h):4d}  {f}')
        for line, ctx in h[:4]:
            print(f'        שורה {line}: …{ctx}…')
    print('\nכללי ההחלפה: docs/yoetz-copy.md')
    return 1


if __name__ == '__main__':
    sys.exit(main())
