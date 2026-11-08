#!/usr/bin/env python3
# -*- coding: utf-8 -*-
""""יועצי נדל״ן" ולא "מתווכים" בטקסט שהאתר מציג (החלטת תומר, 27.10.2026).

**למה בדיקה:** המילה הישנה אינה שוברת דבר - הדף נטען ונראה תקין - והיא חוזרת
בכל נוסח חדש שמועתק מדף ישן. לכן היא נתפסת ב-CI.

**מה נבדק:** טקסט מוצג בלבד - טקסט ב-HTML, מאפיינים מוצגים ומחרוזות ב-JS/TS -
באותה מכונת מצבים של check_long_dash.py (הערות קוד פטורות).

**מה מותר:**
  * שמות סטטוטוריים: רשם המתווכים, פנקס המתווכים, חוק המתווכים, תקנות המתווכים, מאגר המתווכים (של משרד המשפטים).
  * כתובות: ‏/…/מתווכים (נתיבי SEO של PR #955 - רק טקסט העוגן משתנה).
  * העוגן "מתווכים בעפולה" לקישור ‏/afula/מתווכים בבלוק "חיפושים פופולריים" בפוטר (חריג SEO, 29.10).
  * ‏for-brokers.html כולו, ועוגן "פלטפורמה למתווכים" אל ‏/for-brokers (דף נחיתה, 6.11.2026). docs/for-brokers.md
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
    # דף נחיתה SEO. הנוסח אושר ב-6.11.2026 ומילת המפתח היא "מתווכים". docs/for-brokers.md
    'for-brokers.html',
    # קורס ההכנה למבחן: "מתווך" הוא המונח המשפטי שהבחינה משתמשת בו (תומר, 8.11.2026). docs/exam-course.md
    'course.html', 'learn.html', 'assets/learn.js',
}
# החלטה 10 (תומר, 27.10, אושרה במלואה): ב-title, ב-meta description וב-og של דפי המתווכים הניסוח
# המשולב "יועצי נדל״ן ומתווכים", וב-/agencies משפט גלוי אחד "יועצי נדל״ן (מתווכים) בעפולה ובעמק"
# חריג SEO (תומר 29.10 01:40, גבריאלה אישרה): עוגן הקישור ל-/afula/מתווכים בבלוק "חיפושים פופולריים" בפוטר
ALLOWED = re.compile(r'<a href="/afula/מתווכים">מתווכים בעפולה</a>|<a[^>]*href="/for-brokers"[^>]*>פלטפורמה למתווכים</a>|יועצי נדל״ן ומתווכים|יועצי נדל״ן \(מתווכים\)|<meta property="og:(?:title|description)" content="[^"]*"|חוק המתווכים, פרטי המתווך|(רשם|פנקס|חוק|תקנות|מאגר|מבחן) המתווכים|דיני מתווכים|([\x27"])בלוג המתווכים\2|ניתוח שוק / בלוג המתווכים|(תקנות|חוק) \x27 \+\s*\x27המתווכים|/מתווכים|%D7%9E%D7%AA%D7%95%D7%95%D7%9B%D7%99%D7%9D')
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
            h = []
            for m in WORD.finditer(src):
                line_end = src.find('\n', m.start())
                line = src[src.rfind('\n', 0, m.start()) + 1: len(src) if line_end < 0 else line_end]
                ctx = src[max(0, m.start() - 30):m.start() + 30].replace('\n', ' ')
                # השורה ב-llms.txt לדף /for-brokers. מילת המפתח אושרה עם הנוסח. docs/for-brokers.md
                if 'shuknadlan.co.il/for-brokers' in line:
                    continue
                if ALLOWED.search(src[max(0, m.start() - 6):m.start() + 12]):
                    continue
                if re.search(r'(רשם|פנקס|חוק|תקנות) המתווכים', ctx):
                    continue
                h.append((src.count('\n', 0, m.start()) + 1, ctx))
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
