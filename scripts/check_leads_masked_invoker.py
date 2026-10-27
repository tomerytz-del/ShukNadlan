#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""leads_masked חייב security_invoker בכל יצירה.

create or replace view בלי with (security_invoker = true) מאפס את
האפשרות. ה-view חוזר לרוץ כבעלים, עוקף RLS, ומפתח ה-anon הציבורי קורא
את כל הלידים. זה מה שקרה ב-20270712090000, אחרי ש-20261230090000 כבר
הגדיר את האפשרות והסביר למה בלעדיה כל הסוכנים רואים את הלידים של כולם.

הבדיקה קוראת קבצים בלבד: בלי רשת, בלי סודות, ובלי חיבור למסד.
"""
import glob
import os
import re
import sys

CREATE_RE = re.compile(
    r'\bcreate\s+(?:or\s+replace\s+)?view\s+public\.leads_masked\b',
    re.I)
AS_RE = re.compile(r'\bas\b', re.I)
INVOKER_TRUE_RE = re.compile(r'\bsecurity_invoker\s*=\s*true\b', re.I)


def blank_comments_and_dollar(src):
    """מוחק הערות וגופי dollar-quote, ושומר מעברי שורה כדי שמספר השורה יישאר."""
    chars = list(src)
    i, n = 0, len(chars)
    while i < n:
        if chars[i] == '-' and i + 1 < n and chars[i + 1] == '-':
            while i < n and chars[i] != '\n':
                chars[i] = ' '
                i += 1
            continue
        if chars[i] == '/' and i + 1 < n and chars[i + 1] == '*':
            chars[i] = chars[i + 1] = ' '
            i += 2
            while i + 1 < n and not (chars[i] == '*' and chars[i + 1] == '/'):
                if chars[i] != '\n':
                    chars[i] = ' '
                i += 1
            if i + 1 < n:
                chars[i] = chars[i + 1] = ' '
                i += 2
            continue
        if chars[i] in "'\"":
            q = chars[i]
            i += 1
            while i < n:
                if chars[i] == q:
                    i += 1
                    break
                if chars[i] == '\\':
                    i += 2
                    continue
                i += 1
            continue
        if chars[i] == '$':
            tag = re.match(r'\$[A-Za-z0-9_]*\$', ''.join(chars[i:]))
            if tag:
                token = tag.group(0)
                end = ''.join(chars).find(token, i + len(token))
                stop = n if end < 0 else end + len(token)
                while i < stop:
                    if chars[i] != '\n':
                        chars[i] = ' '
                    i += 1
                continue
        i += 1
    return ''.join(chars)


def files(root):
    found = sorted(glob.glob(os.path.join(root, 'supabase', 'migrations', '*.sql')))
    schema = os.path.join(root, 'schema.sql')
    if os.path.isfile(schema):
        found.append(schema)
    return found


def problems(root):
    """מחזיר רשימת (נתיב, שורה, סיבה)."""
    bad = []
    creates = 0
    for path in files(root):
        raw = open(path, encoding='utf-8').read()
        src = blank_comments_and_dollar(raw)
        for match in CREATE_RE.finditer(src):
            creates += 1
            as_match = AS_RE.search(src, match.end())
            header = src[match.end():as_match.start()] if as_match else src[match.end():]
            line = src.count('\n', 0, match.start()) + 1
            rel = os.path.relpath(path, root)
            if not as_match:
                bad.append((rel, line, 'אין as אחרי שם ה-view'))
            elif not INVOKER_TRUE_RE.search(header):
                bad.append((rel, line, 'חסר with (security_invoker = true) לפני ה-as'))
    if creates == 0:
        bad.append(('supabase/migrations', 0, 'אין אף יצירה של public.leads_masked'))
    return bad


def main(root=None):
    root = root or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    bad = problems(root)
    if not bad:
        print('✓ leads_masked נוצר עם security_invoker = true.')
        return 0
    print('✗ leads_masked בלי security_invoker חושף את כל הלידים למפתח הציבורי:\n')
    for rel, line, why in bad:
        where = f'{rel}:{line}' if line else rel
        print(f'  {where}  {why}')
    print('\nלכל create or replace view public.leads_masked חובה:')
    print('  with (security_invoker = true)')
    return 1


if __name__ == '__main__':
    sys.exit(main())
