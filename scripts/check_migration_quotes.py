#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""מיתרים לא סגורים וגרש מוברח בבקסלאש במיגרציות.

## למה הבדיקה הזו קיימת

‏20261210090000 נפלה בפרודקשן על התו הראשון של ההערה הראשונה:

    comment on function public.city_name_key(text) is
      '... ואינו מוחק גרש — "ג\\'ת" אינה "גת".';

ב-PostgreSQL עם ‏standard_conforming_strings = on (ברירת המחדל, ונבדק
בפרודקשן) **בקסלאש אינו תו בריחה**. הגרש סגר את המחרוזת באמצע, ומה
שאחריו הפך ל-SQL שבור: ‏`syntax error at or near "ת"`.

והמחיר אינו רק המיגרציה הזו. ‏`db push` מריץ לפי סדר, ולכן שגיאה בקובץ
הראשון **עצרה את כל שבע המיגרציות** של אותו מיזוג. ‏CLAUDE.md קורא לזה
נכון: workflow אדום שם הוא תקלת פרודקשן ולא רעש CI, כי ה-HTML כבר באוויר
והסכימה לא.

זו בדיוק המשפחה שהריפו הזה חוסם ב-CI: שקטה בכתיבה, יקרה בפריסה.

## מה נבדק

1. **בקסלאש לפני גרש, מחוץ לגוף מצוטט ב-$$.** תמיד באג. בתוך `$$` הוא
   מותר, כי שם יושבים regex-ים שמכילים גרשים בכוונה.
2. **מחרוזת שלא נסגרה עד סוף הקובץ.** זה מה שתופס את השגיאה גם כשהיא
   נכתבת אחרת.

הכתיב הנכון לגרש בתוך מחרוזת הוא הכפלה: ‏`'ג''ת'`.
"""
import glob
import sys

def scan(sql: str):
    """מחזיר (שגיאות, האם נשארה מחרוזת פתוחה). לקסר קטן שמכבד הערות,
    ציטוט דולר ומחרוזות רגילות."""
    errs = []
    i, n = 0, len(sql)
    line = 1
    in_str = False          # בתוך '...'
    str_line = 0
    while i < n:
        c = sql[i]
        if c == '\n':
            line += 1; i += 1; continue

        if in_str:
            if c == "'":
                # גרש כפול הוא גרש ספרותי, לא סוף מחרוזת
                if i + 1 < n and sql[i + 1] == "'":
                    i += 2; continue
                in_str = False; i += 1; continue
            if c == '\\' and i + 1 < n and sql[i + 1] == "'":
                errs.append((line, "בקסלאש לפני גרש בתוך מחרוזת. "
                                   "standard_conforming_strings פעיל, "
                                   "ולכן הגרש סוגר את המחרוזת. הכתיב הנכון: ''"))
                i += 2; continue
            i += 1; continue

        # מחוץ למחרוזת
        if c == '-' and sql.startswith('--', i):
            j = sql.find('\n', i)
            i = n if j < 0 else j; continue
        if c == '/' and sql.startswith('/*', i):
            j = sql.find('*/', i + 2)
            if j < 0: i = n; continue
            line += sql.count('\n', i, j); i = j + 2; continue
        if c == '$':
            # ציטוט דולר: $tag$ ... $tag$
            j = sql.find('$', i + 1)
            if j >= 0 and all(ch.isalnum() or ch == '_' for ch in sql[i + 1:j]):
                tag = sql[i:j + 1]
                k = sql.find(tag, j + 1)
                if k < 0: i = n; continue
                line += sql.count('\n', i, k); i = k + len(tag); continue
            i += 1; continue
        if c == "'":
            in_str = True; str_line = line; i += 1; continue
        i += 1
    return errs, (str_line if in_str else 0)

def main() -> int:
    bad = 0
    files = sorted(glob.glob('supabase/migrations/*.sql'))
    for path in files:
        sql = open(path, encoding='utf-8').read()
        errs, open_at = scan(sql)
        for ln, msg in errs:
            print(f'✗ {path}:{ln} — {msg}'); bad += 1
        if open_at:
            print(f'✗ {path}:{open_at} — מחרוזת נפתחה ולא נסגרה עד סוף הקובץ'); bad += 1
    if bad:
        print(f'\n{bad} בעיות. מיגרציה שנופלת עוצרת את כל אלה שאחריה באותו מיזוג.')
        return 1
    print(f'✓ {len(files)} מיגרציות: אין מחרוזת פתוחה ואין גרש מוברח בבקסלאש.')
    return 0

if __name__ == '__main__':
    sys.exit(main())
