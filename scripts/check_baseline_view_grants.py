#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""אחרי baseline_urgent_fixes_20261027 הסגירה נשארת הסגירה.

המיגרציה הזו היא סנכרון של החלה שכבר רצה בפרודקשן. create or replace על
market_city_names בלי security_invoker מאפס את האפשרות (כמו שקרה ל-
leads_masked). grant של כתיבה על שלושת ה-views מחזיר את החור. revoke של
EXECUTE על agent_share_fit מ-authenticated מחזיר 403 במסך
"נכסים ששותפו איתי", כי PostgreSQL בודק את ההרשאה מול הקורא/ת ולא מול
בעל ה-view.

הבדיקה קוראת קבצים בלבד: בלי רשת, בלי סודות, ובלי חיבור למסד.
היא אינה משנה את check_leads_masked_invoker: שם כל יצירה של leads_masked
חייבת את האפשרות. כאן היצירה הישנה של market_city_names נשארת כמו שהיא,
והסגירה היא המיגרציה המאוחרת.
"""
import glob
import os
import re
import sys

BASELINE_SUFFIX = '_baseline_urgent_fixes_20261027.sql'
VIEWS = (
    'public.market_city_names',
    'public.saved_search_leads_public',
    'public.project_leads_shelf',
)
WRITE_PRIVS = {'all', 'insert', 'update', 'delete', 'truncate',
               'references', 'trigger'}
OPEN_ROLES = {'public', 'anon', 'authenticated'}

# הגוף שהוחל בפרודקשן, בלי רווחים. הערות אינן חלק ממנו.
REQUIRED = (
    'revoke all on public.market_city_names from public, anon, authenticated;',
    'alter view public.market_city_names set (security_invoker = true);',
    'revoke insert, update, delete, truncate, references, trigger on '
    'public.saved_search_leads_public from public, anon, authenticated;',
    'revoke insert, update, delete, truncate, references, trigger on '
    'public.project_leads_shelf from public, anon, authenticated;',
    'grant execute on function public.agent_share_fit(uuid, text, uuid) '
    'to authenticated;',
)

CREATE_RE = re.compile(
    r'\bcreate\s+(?:or\s+replace\s+)?view\s+public\.market_city_names\b',
    re.I)
AS_RE = re.compile(r'\bas\b', re.I)
INVOKER_TRUE_RE = re.compile(r'\bsecurity_invoker\s*=\s*true\b', re.I)
INVOKER_FALSE_RE = re.compile(
    r'\balter\s+view\s+public\.market_city_names\s+set\s*\([^)]*'
    r'\bsecurity_invoker\s*=\s*false\b',
    re.I | re.S)
INVOKER_RESET_RE = re.compile(
    r'\balter\s+view\s+public\.market_city_names\s+reset\s*\(\s*security_invoker\s*\)',
    re.I)

GRANT_RE = re.compile(
    r'\bgrant\s+(.*?)\s+on\s+(?:table\s+)?'
    r'((?:public\.[a-z_][a-z0-9_]*\s*,\s*)*public\.[a-z_][a-z0-9_]*)\s+'
    r'to\s+([^;]+);',
    re.I | re.S)
REVOKE_FN_RE = re.compile(
    r'\brevoke\s+(?:all|execute)[^;]*?\bon\s+function\s+'
    r'public\.agent_share_fit\s*\([^)]*\)\s+from\s+([^;]+);',
    re.I | re.S)
GRANT_FN_RE = re.compile(
    r'\bgrant\s+execute\s+on\s+function\s+'
    r'public\.agent_share_fit\s*\([^)]*\)\s+to\s+([^;]+);',
    re.I | re.S)


def squash(sql):
    return re.sub(r'\s+', ' ', sql).strip().lower()


def strip_comments(src):
    """מוחק הערות שורה ובלוק, ושומר מעברי שורה כדי שמספר השורה יישאר."""
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
        i += 1
    return ''.join(chars)


def roles_of(blob):
    blob = re.sub(r'\bwith\s+grant\s+option\b', '', blob, flags=re.I)
    return {r.strip().strip('"').lower()
            for r in blob.replace('\n', ' ').split(',') if r.strip()}


def privs_of(blob):
    out = set()
    for part in blob.replace('\n', ' ').split(','):
        word = part.strip().lower().split(' ', 1)[0].strip('(')
        if word:
            out.add(word)
    return out


def line_of(sql, pos):
    return sql.count('\n', 0, pos) + 1


def migration_files(root):
    found = sorted(glob.glob(os.path.join(root, 'supabase', 'migrations', '*.sql')))
    schema = os.path.join(root, 'schema.sql')
    if os.path.isfile(schema):
        found.append(schema)
    return found


def version_of(path):
    base = os.path.basename(path)
    if len(base) >= 14 and base[:14].isdigit():
        return base[:14]
    return None


def problems(root):
    """מחזיר רשימת (נתיב, שורה, סיבה)."""
    bad = []
    files = migration_files(root)
    baselines = [p for p in files if p.endswith(BASELINE_SUFFIX)]
    if len(baselines) != 1:
        bad.append((
            'supabase/migrations',
            0,
            f'נדרש קובץ אחד שמסתיים ב-{BASELINE_SUFFIX}, נמצאו {len(baselines)}',
        ))
        return bad

    baseline = baselines[0]
    sentinel = version_of(baseline)
    body = squash(strip_comments(open(baseline, encoding='utf-8').read()))
    for snippet in REQUIRED:
        if squash(snippet) not in body:
            bad.append((os.path.relpath(baseline, root), 0,
                        f'חסר המשפט שהוחל בפרודקשן: {snippet}'))

    # אחרי ה-grant של קובץ הבסיס, authenticated מחזיק EXECUTE.
    auth_execute = True
    auth_where = (os.path.relpath(baseline, root), 0)

    for path in files:
        ver = version_of(path)
        # schema.sql נסרק תמיד: הוא אינו מיגרציה, ואם הוא מחזיר את החור
        # ה-db reset אינו משחזר את הפרודקשן.
        if ver is not None and (sentinel is None or ver <= sentinel):
            continue
        raw = open(path, encoding='utf-8').read()
        src = strip_comments(raw)
        rel = os.path.relpath(path, root)

        for match in CREATE_RE.finditer(src):
            as_match = AS_RE.search(src, match.end())
            header = src[match.end():as_match.start()] if as_match else src[match.end():]
            line = line_of(src, match.start())
            if not INVOKER_TRUE_RE.search(header):
                bad.append((rel, line,
                            'create or replace של market_city_names בלי '
                            'security_invoker = true מאפס את האפשרות'))

        for rx, why in (
            (INVOKER_FALSE_RE, 'security_invoker = false מחזיר את ה-view לבעלים'),
            (INVOKER_RESET_RE, 'reset (security_invoker) מאפס את האפשרות'),
        ):
            m = rx.search(src)
            if m:
                bad.append((rel, line_of(src, m.start()), why))

        for m in GRANT_RE.finditer(src):
            privs = privs_of(m.group(1))
            names = {n.strip().lower()
                     for n in re.split(r'\s*,\s*', m.group(2).strip())}
            roles = roles_of(m.group(3))
            hit_views = names & set(VIEWS)
            hit_roles = roles & OPEN_ROLES
            if hit_views and hit_roles and privs & WRITE_PRIVS:
                bad.append((
                    rel, line_of(src, m.start()),
                    'grant של כתיבה על ' + ', '.join(sorted(hit_views))
                    + ' ל-' + ', '.join(sorted(hit_roles)),
                ))

        events = []
        for m in REVOKE_FN_RE.finditer(src):
            if 'authenticated' in roles_of(m.group(1)):
                events.append((m.start(), False))
        for m in GRANT_FN_RE.finditer(src):
            if 'authenticated' in roles_of(m.group(1)):
                events.append((m.start(), True))
        for pos, granted in sorted(events):
            auth_execute = granted
            auth_where = (rel, line_of(src, pos))

    if not auth_execute:
        rel, line = auth_where
        bad.append((rel, line,
                    'EXECUTE של agent_share_fit נלקח מ-authenticated '
                    'ואחר כך לא הוחזר'))
    return bad


def main(root=None):
    root = root or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    bad = problems(root)
    if not bad:
        print('✓ baseline_urgent_fixes_20261027 נשאר המצב הסופי: '
              'בלי כתיבה על שלושת ה-views, market_city_names עם '
              'security_invoker, ו-EXECUTE של agent_share_fit ל-authenticated.')
        return 0
    print('✗ סגירת baseline_urgent_fixes_20261027 נפתחה מחדש:\n')
    for rel, line, why in bad:
        where = f'{rel}:{line}' if line else rel
        print(f'  {where}  {why}')
    return 1


if __name__ == '__main__':
    sys.exit(main())
