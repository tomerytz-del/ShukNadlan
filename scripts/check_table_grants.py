#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""טבלה חדשה ב-`public` בלי grant מפורש לשלושת התפקידים.

## למה הבדיקה הזו קיימת

עד 30.10.2026 Supabase הגדירה לסכימה `public` הרשאות ברירת מחדל שנתנו
`select, insert, update, delete` ל-`anon`, ל-`authenticated` ול-
`service_role` על **כל** טבלה חדשה. מ-30.10.2026 היא מפסיקה, גם בפרויקטים
קיימים (‏https://github.com/orgs/supabase/discussions/45329): טבלה שנוצרת
מאותו יום נולדת בלי הרשאה לאף אחד מהם, ו-PostgREST, ‏supabase-js ו-GraphQL
מחזירים עליה `permission denied`. הטבלאות שכבר קיימות שומרות את מה שיש להן.

המיגרציות כאן נכתבו על ההנחה הישנה. הדפוס השכיח הוא

    create table if not exists public.csm_staff (...);
    alter table public.csm_staff enable row level security;
    revoke all on table public.csm_staff from anon;

כלומר **מורידים** מה שלא רוצים, ו-`authenticated` ו-`service_role` נשענים
על מה שהיה ניתן מעצמו. אחרי 30.10 אותו קובץ בדיוק יוצר טבלה שה-CRM לא
יכול לקרוא, וגם פונקציות ה-Edge לא: ‏`service_role` עוקף RLS, אבל לא
הרשאות טבלה.

**והכשל שקט במקום הכי גרוע:** המיגרציה עוברת ירוק בצינור, הסכימה נכונה,
וה-`permission denied` מופיע רק כשמישהו מנסה להשתמש ביכולת באתר.

## מה נבדק

לכל טבלה או view ב-`public` שנוצרו **לראשונה** במיגרציה שה-version שלה
גדול מ-`CUTOFF`, ולכל אחד משלושת התפקידים: נדרשת החלטה מפורשת - `grant`
או `revoke` על האובייקט שמונה את התפקיד בשם, באיזו מיגרציה שהיא. ‏`revoke`
נספר כהחלטה כי זו בדיוק ההצהרה "לתפקיד הזה אין גישה" (‏`anon` על טבלה
פרטית), ואחרי 30.10 הוא פשוט אינו עושה כלום.

**‏view נבדק גם הוא:** ‏`alter default privileges ... on tables` חל ב-Postgres
גם על views, ולכן view חדש יורש את אותו שינוי. ‏`create or replace view` על
view שכבר קיים שומר את ההרשאות שלו, ולכן נספרת רק היצירה הראשונה.

‏`grant`/`revoke` דינמי בתוך `do $$ ... $$` (‏`format('... on table
public.%I to authenticated', t)` על מערך שמות) נספר גם הוא - זו הצורה של
‏`20270626090000_csm_adoption.sql`.

**למה `CUTOFF` ולא כל הקורפוס:** טבלה שנוצרה לפני הסף כבר קיימת בפרודקשן
עם ההרשאות הישנות, ו-Supabase אינה נוגעת בה. לחייב אותה בשורת grant היה
רעש בלבד - מאות טבלאות שעובדות.
"""
import glob
import os
import re
import sys

ROLES = ('anon', 'authenticated', 'service_role')

# המיגרציה האחרונה ב-main ביום שהכלל נולד (20.10.2026). כל מה שנוצר
# במיגרציה מאוחרת ממנה ירוץ בפרודקשן אחרי 30.10, או קרוב מספיק כדי שאין
# טעם להמר.
CUTOFF = '20270705090000'

# ---------------------------------------------------------------------------
# חריגים, לפי (אובייקט, תפקיד): אובייקט חדש שבכוונה אין עליו החלטה לתפקיד.
# הנימוק חייב להיות כתוב כאן - חריג בלי סיבה הוא חריג שיישאר לנצח.
# ---------------------------------------------------------------------------
ALLOW = {}

NAME = r'public\.[a-z_][a-z_0-9]*'

CREATE_RE = re.compile(
    r'\bcreate\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(' + NAME + r')\b'
    r'|\bcreate\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+'
    r'(?:if\s+not\s+exists\s+)?(' + NAME + r')\b',
    re.I)

# ‏grant/revoke על טבלה אחת או רשימה. ‏`on function`, ‏`on sequence`, ‏`on all
# tables in schema` ו-`on schema` אינם נתפסים, כי אחרי `on [table]` חייב לבוא
# שם מלא ב-public.
# מגרסה זו ואילך, revoke מ-public אינו מספיק: pg_default_acl ב-public
# נותן ל-authenticated את arwdDxtm ישירות. grant חלקי אחרי זה משאיר
# INSERT, UPDATE, TRUNCATE, REFERENCES ו-TRIGGER. חובה revoke all
# שמונה את authenticated בשם.
ACL_REVOKE_FROM = '20271028120000'

STMT_RE = re.compile(
    r'\b(grant|revoke)\s+(all\b|[^;]*?)\s+on\s+(?:table\s+)?'
    r'(' + NAME + r'(?:\s*,\s*' + NAME + r')*)\s+(?:to|from)\s+([^;]+);',
    re.I | re.S)

DO_BLOCK_RE = re.compile(r'do\s*\$([a-z_]*)\$(.*?)\$\1\$', re.I | re.S)
DYN_RE = re.compile(
    r'\b(?:grant|revoke)\s[^\']*?\bon\s+(?:table\s+)?public\.%[is]\s+'
    r'(?:to|from)\s+([^\']+)\'',
    re.I)
LITERAL_RE = re.compile(r"'([a-z_][a-z_0-9]*)'", re.I)

COMMENT_RE = re.compile(r'--[^\n]*')


def roles_of(blob: str) -> set:
    blob = re.sub(r'\bwith\s+grant\s+option\b', '', blob, flags=re.I)
    return {r.strip().strip('"').lower()
            for r in blob.replace('\n', ' ').split(',') if r.strip()}


def line_of(sql: str, pos: int) -> int:
    return sql.count('\n', 0, pos) + 1


def main(root: str = '.') -> int:
    files = sorted(glob.glob(os.path.join(root, 'supabase/migrations/*.sql')))

    # אובייקט → (version, קובץ, שורה) של היצירה הראשונה.
    created = {}
    # אובייקט → קבוצת התפקידים שיש עליהם החלטה.
    decided = {}
    # אובייקט שיש עליו revoke all שמונה את authenticated.
    revoked_all_authenticated = set()

    for path in files:
        version = os.path.basename(path).split('_', 1)[0]
        # ההערות מוסרות לפני החיפוש, כדי ש"create table" בהסבר לא ייספר.
        # החלפה ברווחים באותו אורך שומרת את מספרי השורות.
        sql = COMMENT_RE.sub(lambda m: ' ' * len(m.group(0)),
                             open(path, encoding='utf-8').read())

        for m in CREATE_RE.finditer(sql):
            name = (m.group(1) or m.group(2)).lower()
            if name not in created:
                created[name] = (version, path, line_of(sql, m.start()))

        for m in STMT_RE.finditer(sql):
            verb = m.group(1).lower()
            privilege = m.group(2).lower()
            rs = roles_of(m.group(4))
            for name in re.split(r'\s*,\s*', m.group(3).strip().lower()):
                decided.setdefault(name, set()).update(rs & set(ROLES))
                if (verb == 'revoke' and privilege.startswith('all')
                        and 'authenticated' in rs):
                    revoked_all_authenticated.add(name)

        for blk in DO_BLOCK_RE.finditer(sql):
            body = blk.group(2)
            rs = set()
            for d in DYN_RE.finditer(body):
                rs |= roles_of(d.group(1)) & set(ROLES)
            if not rs:
                continue
            for lit in LITERAL_RE.finditer(body):
                decided.setdefault('public.' + lit.group(1).lower(), set()).update(rs)

    fresh = {n: v for n, v in created.items() if v[0] > CUTOFF}

    bad = 0
    for name, (version, path, ln) in sorted(fresh.items(), key=lambda kv: kv[1]):
        rel = os.path.relpath(path, root)
        missing = [r for r in ROLES
                   if r not in decided.get(name, set()) and (name, r) not in ALLOW]
        if missing:
            bad += 1
            print(f'✗ {rel}:{ln} - {name}  [{", ".join(missing)}]')
            print(f'    אין grant או revoke שמונים את {" ו-".join(missing)}.')
            print('    מ-30.10.2026 Supabase אינה מעניקה הרשאות לטבלה חדשה ב-public,')
            print('    ובלי grant מפורש ה-Data API מחזיר עליה permission denied -')
            print('    גם ל-CRM וגם לפונקציות ה-Edge (‏service_role עוקף RLS, לא grant).')
            print('    התיקון, באותה מיגרציה, לפי מי שבאמת ניגש:')
            print(f'        grant select, insert, update, delete on table {name} to authenticated, service_role;')
            print(f'        revoke all on table {name} from anon;')
            print('    ‏`revoke` הוא החלטה תקפה: "לתפקיד הזה אין גישה".')
        if version >= ACL_REVOKE_FROM and name not in revoked_all_authenticated:
            bad += 1
            print(f'✗ {rel}:{ln} - {name}')
            print('    אין revoke all שמונה את authenticated.')
            print('    pg_default_acl ב-public נותן ל-authenticated את arwdDxtm,')
            print('    ו-revoke מ-public אינו מוריד הרשאה ישירה. grant חלקי משאיר')
            print('    INSERT, UPDATE, TRUNCATE, REFERENCES ו-TRIGGER.')
            print(f'        revoke all on table {name} from public, anon, authenticated;')

    stale = sorted(k for k in ALLOW if k[0] not in fresh)
    for name, role in stale:
        bad += 1
        print(f'✗ ALLOW מחזיק את ({name}, {role}), שאינו אובייקט חדש בקורפוס.')
        print('    להסיר את השורה, כדי שהחריג לא יכסה אובייקט אחר.')

    if bad:
        print(f'\n{bad} טבלאות/views חדשים בלי החלטת הרשאות מפורשת. הפרטים:')
        print('docs/supabase-migrations.md, "הרשאות טבלה חדשה".')
        return 1

    print(f'✓ {len(files)} מיגרציות, {len(fresh)} טבלאות/views שנוצרו אחרי '
          f'{CUTOFF}: לכולם החלטת הרשאות מפורשת ל-{", ".join(ROLES)}.')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else '.'))
