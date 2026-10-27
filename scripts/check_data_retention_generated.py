#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""data_retention_run לא משים ערך ל-mortgage_leads.phone_e164.

העמודה generated always as (normalize_msisdn(phone)) stored. השמה אליה
מפילה את כל הריצה הלילית:

    ERROR: column "phone_e164" can only be updated to DEFAULT

זה נשאר שקט כל עוד המדיניות כבויה (הרצה יבשה לא מגיעה ל-update), ונשבר
ברגע ש-20270826090000 הדליקה אותן. phone = '' מחשב את העמודה מחדש.
project_leads.phone_e164 היא עמודה רגילה, וההשמה אליה נשארת.

נבדקת ההגדרה האחרונה של הפונקציה. המיגרציה המקורית עדיין מכילה את
ההשמה, והתיקון הוא create or replace מאוחר יותר. יצירה שמופיעה רק
בהערה אינה נספרת.

הבדיקה קוראת קבצים בלבד: בלי רשת, בלי סודות, ובלי חיבור למסד.
"""
import glob
import os
import re
import sys

CREATE_RE = re.compile(
    r'\bcreate\s+(?:or\s+replace\s+)?function\s+'
    r'public\.data_retention_run\s*\(\s*\)',
    re.I)
AS_RE = re.compile(r'\bas\s+(\$[A-Za-z0-9_]*\$)', re.I)
UPDATE_RE = re.compile(
    r'\bupdate\s+public\.mortgage_leads\b(.*?);',
    re.I | re.S)
SET_RE = re.compile(r'\bset\b(.*?)(?:\bwhere\b|$)', re.I | re.S)
ASSIGN_RE = re.compile(r'\bphone_e164\s*=', re.I)


def _mask_span(chars, start, stop):
    for i in range(start, stop):
        if chars[i] != '\n':
            chars[i] = ' '


def mask_sql_comments(sql):
    """מוחק הערות מחוץ לציטוט, ושומר אורכים כדי שמספר השורה יישאר.

    גוף $...$ נשאר כמו שהוא: ההערות שבתוכו הן חלק מקוד הפונקציה, לא
    מהמיגרציה, והן מסוננות אחר כך ב-plpgsql_code.
    """
    chars = list(sql)
    i, n = 0, len(chars)
    while i < n:
        c = chars[i]
        if c == '-' and i + 1 < n and chars[i + 1] == '-':
            j = i
            while j < n and chars[j] != '\n':
                j += 1
            _mask_span(chars, i, j)
            i = j
            continue
        if c == '/' and i + 1 < n and chars[i + 1] == '*':
            end = sql.find('*/', i + 2)
            stop = n if end < 0 else end + 2
            _mask_span(chars, i, stop)
            i = stop
            continue
        if c == "'":
            i += 1
            while i < n:
                if chars[i] == "'":
                    if i + 1 < n and chars[i + 1] == "'":
                        i += 2
                        continue
                    i += 1
                    break
                i += 1
            continue
        if c == '$':
            tag = re.match(r'\$[A-Za-z0-9_]*\$', sql[i:])
            if tag:
                token = tag.group(0)
                end = sql.find(token, i + len(token))
                if end < 0:
                    break
                i = end + len(token)
                continue
        i += 1
    return ''.join(chars)


def plpgsql_code(body):
    """מוחק הערות ומחרוזות מגוף הפונקציה, כדי שהשמה תימדד רק ב-SQL."""
    chars = list(body)
    i, n = 0, len(chars)
    while i < n:
        c = chars[i]
        if c == '-' and i + 1 < n and chars[i + 1] == '-':
            j = i
            while j < n and chars[j] != '\n':
                j += 1
            _mask_span(chars, i, j)
            i = j
            continue
        if c == '/' and i + 1 < n and chars[i + 1] == '*':
            end = body.find('*/', i + 2)
            stop = n if end < 0 else end + 2
            _mask_span(chars, i, stop)
            i = stop
            continue
        if c == "'":
            j = i + 1
            while j < n:
                if chars[j] == "'":
                    if j + 1 < n and chars[j + 1] == "'":
                        j += 2
                        continue
                    j += 1
                    break
                j += 1
            _mask_span(chars, i, j)
            i = j
            continue
        i += 1
    return ''.join(chars)


def migration_files(root):
    return sorted(glob.glob(os.path.join(root, 'supabase', 'migrations', '*.sql')))


def latest_body(root):
    """ההגדרה האחרונה לפי סדר שמות הקבצים, ואז לפי סדר בקובץ.

    מחזיר (נתיב יחסי, שורה, גוף) או None.
    """
    found = None
    for path in migration_files(root):
        raw = open(path, encoding='utf-8').read()
        masked = mask_sql_comments(raw)
        for match in CREATE_RE.finditer(masked):
            as_match = AS_RE.search(masked, match.end())
            rel = os.path.relpath(path, root)
            line = raw.count('\n', 0, match.start()) + 1
            if not as_match:
                found = (rel, line, None)
                continue
            tag = as_match.group(1)
            start = as_match.end()
            end = raw.find(tag, start)
            body = None if end < 0 else raw[start:end]
            found = (rel, line, body)
    return found


def problems(root):
    """מחזיר רשימת (נתיב, שורה, סיבה)."""
    found = latest_body(root)
    if found is None:
        return [('supabase/migrations', 0,
                 'אין הגדרה של public.data_retention_run')]
    rel, line, body = found
    if body is None:
        return [(rel, line, 'אין גוף $...$ אחרי ההגדרה')]
    code = plpgsql_code(body)
    bad = []
    for upd in UPDATE_RE.finditer(code):
        clause = upd.group(1)
        set_match = SET_RE.search(clause)
        set_sql = set_match.group(1) if set_match else clause
        if ASSIGN_RE.search(set_sql):
            bad.append((rel, line,
                        'update על mortgage_leads משים ערך ל-phone_e164, '
                        'שהיא עמודה מחושבת'))
    return bad


def main(root=None):
    root = root or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    bad = problems(root)
    if not bad:
        print('✓ data_retention_run אינה משים ערך ל-mortgage_leads.phone_e164.')
        return 0
    print('✗ השמה ל-phone_e164 ב-mortgage_leads מפילה את data-retention-run:\n')
    for rel, line, why in bad:
        where = f'{rel}:{line}' if line else rel
        print(f'  {where}  {why}')
    print('\nהעמודה מחושבת מ-phone. מספיק phone = \'\', בלי phone_e164.')
    print('ב-project_leads העמודה רגילה, וההשמה ל-null נשארת.')
    return 1


if __name__ == '__main__':
    sys.exit(main())
