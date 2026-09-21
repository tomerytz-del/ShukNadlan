#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""‏grant שמדיר את anon, בלי revoke שמוציא אותו בפועל.

## למה הבדיקה הזו קיימת

‏Supabase מגדירה הרשאות ברירת מחדל לסכימה `public`:

    alter default privileges in schema public
      grant all on functions to anon, authenticated, service_role;

ולכן **כל** פונקציה שנוצרת שם נולדת עם `EXECUTE` ל-`anon` כהרשאה
**ישירה** — לא דרך `PUBLIC`. וזו כל המלכודת: הכתיבה המתבקשת

    revoke all on function public.f(text) from public;
    grant execute on function public.f(text) to authenticated, service_role;

נראית כמו צמצום ל-`authenticated`, ואינה. ‏`revoke ... from public` מוריד
את הרשאת ה-`PUBLIC` של Postgres ואינו נוגע בהרשאה הישירה של `anon`,
שנשארת בדיוק כפי שהייתה. ה-`grant` שאחריו **מוסיף** ואינו מחליף.

ב-`proacl` רואים את שתי ההרשאות בנפרד, וזה ההבדל:

    postgres=X/postgres | anon=X/postgres | authenticated=X/postgres   ← פתוח
    postgres=X/postgres | service_role=X/postgres                      ← סגור

‏PostgREST חושף כל פונקציה ב-`/rest/v1/rpc/<שם>`, ומפתח ה-anon יושב גלוי
בקוד המקור של כל דף באתר — כי זה תפקידו. כלומר פונקציה במצב הראשון היא
נקודת קצה פומבית, גם כשהמיגרציה שיצרה אותה הצהירה על ההיפך.

## למה זה חוזר, ולמה davka בדיקה

זה כבר קרה כאן פעמיים:

  • ‏`20261112090000_revoke_anon_tier_rpc.sql` סגרה חמש פונקציות כתיבה.
    הקשה שבהן, `record_tier_selection`, אפשרה להוריד כל מנוי/ה משלם/ת
    ל-`free` בשתי בקשות HTTP בלי התחברות בכלל.
  • ‏**ואחר כך זה קרה שוב.** ‏`city_id_from_address` נכתבה במיגרציה
    ‏`20261212090000` — חודש *אחרי* אותה סגירה — עם אותה שורת
    ‏`revoke ... from public` בדיוק, ונשארה פתוחה ל-anon. באותו קובץ
    עצמו, `agencies_backfill_city_id` כן כתבה `from public, anon,
    authenticated` ונסגרה כראוי. שתי שורות, שני גורלות, אותו קובץ.

הלקח לא החזיק כי שום דבר לא אכף אותו. הטעות שקטה לחלוטין: המיגרציה
עוברת, הסכימה נכונה, הפונקציה עובדת, ואין מה שיתלונן — היא פשוט פתוחה
למי שלא התכוונו. הסוכן התפעולי מגלה את זה אחרי הפריסה; הבדיקה הזו מגלה
את זה לפניה.

## מה נבדק

לכל `grant execute on function <חתימה> to <תפקידים>` שבו `anon` **אינו**
ברשימה — נדרשת ראיה שהרשאת ברירת המחדל של `anon` בוטלה: ‏`revoke` על אותה
פונקציה שכולל `anon`, באיזו מיגרציה שהיא. הראיה נאספת מכל הקורפוס ולא
מהקובץ הבודד, כי סגירה מאוחרת היא סגירה תקפה (וכך `20261112090000` סוגרת
פונקציות שנוצרו בספטמבר).

‏`revoke` דינמי בתוך `do $$ ... $$` נספר גם הוא — זו הצורה שבה
‏`20261112090000` כתובה, ובלי זה הבדיקה הייתה מדווחת על חמש פונקציות
שכבר סגורות.

**מה שאינו נבדק כאן:** פונקציה שהוענקה במפורש ל-`anon`. זו החלטה מוצהרת
(‏`city_id_for_name`, `property_map_enabled` וחברותיהן — דגלי תצוגה שדפי
הנכס קוראים בלי התחברות), ולא תקלה. ההחלטה אם ערך מסוים אמור להיות פומבי
היא שיפוט, והבדיקה הזו בודקת עקביות בין הצהרה למציאות — לא את השיפוט.
"""
import glob
import re
import sys

# ---------------------------------------------------------------------------
# חריגים: פונקציה שהוענקה ל-authenticated בלבד, ושהרשאת ה-anon שלה נשארת
# בכוונה. הנימוק חייב להיות כתוב כאן — חריג בלי סיבה הוא חריג שיישאר לנצח.
# ---------------------------------------------------------------------------
ALLOW = {
    'public.current_is_platform_admin()':
        'חמש policy-ות של RLS קוראות לה, ושלוש מהן חלות על התפקיד public — '
        'כלומר גם על anon. ביטול ה-EXECUTE היה הופך שליפה אנונימית מהטבלאות '
        'האלה משורות-אפס ל-permission denied. הפונקציה עצמה היא הגייט: '
        'היא מחזירה false למי שאינו מחובר/ת.',
}

GRANT_RE = re.compile(
    r'\bgrant\s+execute\s+on\s+function\s+'
    r'([a-z_][a-z_0-9]*\.[a-z_][a-z_0-9]*\s*\([^)]*\))\s*to\s+([^;]+);',
    re.I | re.S)

REVOKE_RE = re.compile(
    r'\brevoke\s+(?:all|execute)[^;]*?\bon\s+function\s+'
    r'([a-z_][a-z_0-9]*\.[a-z_][a-z_0-9]*\s*\([^)]*\))\s*from\s+([^;]+);',
    re.I | re.S)

# ‏do $$ ... $$ — כאן יושב ה-revoke הדינמי, ושמות הפונקציות במערך שלידו.
DO_BLOCK_RE = re.compile(r'do\s*\$\$(.*?)\$\$\s*;', re.I | re.S)
QUALIFIED_RE = re.compile(r'\b([a-z_][a-z_0-9]*\.[a-z_][a-z_0-9]*)\s*\(', re.I)


def norm(sig: str) -> str:
    """‏public.f( uuid , text ) → public.f(uuid,text). ‏`int` ו-`integer`
    הם אותו טיפוס, ומיגרציות כאן כותבות את שניהם."""
    sig = re.sub(r'\s+', '', sig).lower()
    sig = re.sub(r'\bint\b', 'integer', sig)
    sig = re.sub(r'\bint4\b', 'integer', sig)
    sig = re.sub(r'\bbool\b', 'boolean', sig)
    return sig


def roles_of(blob: str) -> set:
    return {r.strip().lower() for r in blob.replace('\n', ' ').split(',') if r.strip()}


def line_of(sql: str, pos: int) -> int:
    return sql.count('\n', 0, pos) + 1


def main() -> int:
    files = sorted(glob.glob('supabase/migrations/*.sql'))

    # ראיה שהרשאת anon בוטלה, לפי שם מלא (בלי ארגומנטים) ולפי חתימה מדויקת.
    revoked_sig, revoked_name = set(), set()
    # ‏grant שמדיר את anon: חתימה → (קובץ, שורה)
    granted_without_anon = {}

    for path in files:
        sql = open(path, encoding='utf-8').read()

        for m in REVOKE_RE.finditer(sql):
            if 'anon' in roles_of(m.group(2)):
                revoked_sig.add(norm(m.group(1)))
                revoked_name.add(norm(m.group(1)).split('(')[0])

        # ‏revoke דינמי: בלוק שיש בו revoke ... from anon מזכה כל שם
        # פונקציה שמוזכר בו. זו הצורה של 20261112090000.
        for blk in DO_BLOCK_RE.finditer(sql):
            body = blk.group(1)
            if re.search(r'revoke', body, re.I) and 'anon' in body.lower():
                for q in QUALIFIED_RE.finditer(body):
                    revoked_name.add(norm(q.group(1) + '('). rstrip('('))

        for m in GRANT_RE.finditer(sql):
            if 'anon' in roles_of(m.group(2)):
                continue
            sig = norm(m.group(1))
            granted_without_anon.setdefault(sig, (path, line_of(sql, m.start())))

    bad = 0
    for sig, (path, ln) in sorted(granted_without_anon.items()):
        if sig in ALLOW:
            continue
        if sig in revoked_sig or sig.split('(')[0] in revoked_name:
            continue
        bad += 1
        print(f'✗ {path}:{ln} — {sig}')
        print(f'    ה-grant מדיר את anon, אבל אין revoke שמוציא אותו. הרשאת')
        print(f'    ברירת המחדל של Supabase נשארת, ו-PostgREST חושף את')
        print(f'    הפונקציה ב-/rest/v1/rpc/{sig.split("(")[0].split(".")[-1]}')
        print(f'    התיקון — במיגרציה חדשה, או באותה שורה:')
        print(f'        revoke all on function {sig} from public, anon;')

    if bad:
        print(f'\n{bad} פונקציות מוענקות בלי anon ונשארות פתוחות לו בפועל.')
        print('אם החשיפה מכוונת — להעניק ל-anon במפורש, או להוסיף שורה')
        print('ל-ALLOW ב-scripts/check_function_grants.py עם הנימוק.')
        return 1

    print(f'✓ {len(files)} מיגרציות, {len(granted_without_anon)} פונקציות '
          f'שהוענקו בלי anon: לכולן יש revoke בפועל '
          f'({len(ALLOW)} חריגים מתועדים).')
    return 0


if __name__ == '__main__':
    sys.exit(main())
