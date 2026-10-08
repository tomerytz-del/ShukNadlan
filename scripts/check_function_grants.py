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

לכל `grant execute on function <חתימה> to <תפקידים>`, ולכל אחד משני
התפקידים ש-Supabase מעניקה בברירת מחדל — `anon` ו-`authenticated` —
שאינו ברשימת ההענקה: נדרשת ראיה שהרשאת ברירת המחדל שלו בוטלה, כלומר
‏`revoke` על אותה פונקציה שמונה אותו בשם, באיזו מיגרציה שהיא. הראיה
נאספת מכל הקורפוס ולא מהקובץ הבודד, כי סגירה מאוחרת היא סגירה תקפה
(וכך `20261112090000` סוגרת פונקציות שנוצרו בספטמבר).

**שני תפקידים ולא רק `anon`, וזה נלמד בדרך הקשה.** הגרסה הראשונה של
הבדיקה כאן בדקה `anon` בלבד, ולכן היא אישרה את
‏`order_lead_candidates(uuid[])` — שההצהרה שלה היא `service_role` בלבד,
ושנשארה פתוחה ל-`authenticated` גם אחרי `20261226090000`, מאותו מנגנון
בדיוק תפקיד אחד הלאה. ‏`SECURITY DEFINER` בלי בדיקת זהות שקוראת
‏`agent_lead_preferences` חוצה-סוכנים, פתוחה לכל מי שמחובר/ת. הסגירה היא
‏`20261227090000`, וההכללה כאן היא מה שמונע את החזרה.

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

# שני התפקידים שמקבלים EXECUTE מברירת המחדל של Supabase על כל פונקציה
# חדשה בסכימה public. ‏service_role אינו כאן: הוא המנוע של ה-Edge Functions,
# וההענקה אליו היא תמיד מכוונת.
DEFAULT_GRANTED = ('anon', 'authenticated')

# ---------------------------------------------------------------------------
# חריגים, לפי (חתימה, תפקיד): הרשאה שנשארת בכוונה. הנימוק חייב להיות כתוב
# כאן — חריג בלי סיבה הוא חריג שיישאר לנצח.
# ---------------------------------------------------------------------------
ALLOW = {
    ('public.current_is_platform_admin()', 'anon'):
        'חמש policy-ות של RLS קוראות לה, ושלוש מהן חלות על התפקיד public — '
        'כלומר גם על anon. ביטול ה-EXECUTE היה הופך שליפה אנונימית מהטבלאות '
        'האלה משורות-אפס ל-permission denied. הפונקציה עצמה היא הגייט: '
        'היא מחזירה false למי שאינו מחובר/ת.',
}

# ---------------------------------------------------------------------------
# ‏SECURITY DEFINER שאין עליה החלטה בכלל — לא grant ולא revoke שמונה את
# התפקיד. הבדיקה למעלה נדלקת רק מ-grant, ולכן פונקציה שנכתבה בלי שום שורת
# הרשאות עברה כאן בשקט ונשארה פתוחה ל-anon ול-authenticated מברירת המחדל.
#
# כך נמצאה saved_search_quiet_now() (‏20260830090000, נסגרה ב-
# 20270322090000): לא בבדיקה ולא בסוכן התפעולי, אלא בהשוואת סקירות קוד.
# היא SECURITY INVOKER ולכן נזקה חסום ב-RLS - אבל אותו חור בדיוק על
# ‏DEFINER הוא נקודת קצה שעוקפת RLS, וזה מה שנבדק כאן לפני הפריסה.
#
# פונקציית טריגר אינה כאן: Postgres מסרב לקריאה ישירה אליה.
#
# הרשימה היא מה שהיה פתוח ביום שהכלל נולד (8.10.2026), כל אחת עם הסיבה
# שלה. פונקציה **חדשה** בלי החלטה נחסמת.
# ---------------------------------------------------------------------------
UNDECIDED_DEFINER_OK = {
    'public.current_developer_id':
        'policy-ות של RLS קוראות לה, ומחזירה null למי שאינו מחובר/ת.',
    'public.current_is_platform_admin':
        'policy-ות של RLS קוראות לה (ראו ALLOW), ומחזירה false למי שאינו מחובר/ת.',
    'public.platform_prior_rating':
        'ה-view agency_rating_scores קורא לה בהרשאות הקורא/ת - ‏PUBLIC_RPC '
        'ב-ops_agent/config.py.',
    'public.compute_agency_rankings':
        'סגורה במסד (proacl: service_role בלבד, נבדק 8.10.2026), אבל שורת '
        'ה-revoke אינה בריפו.',
    'public.compute_agent_rankings':
        'כמו compute_agency_rankings.',
}

CREATE_RE = re.compile(
    r'\bcreate\s+(?:or\s+replace\s+)?function\s+'
    r'(public\.[a-z_][a-z_0-9]*)\s*\((.*?)\)\s*returns\s+(.*?)\bas\s+\$',
    re.I | re.S)

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

    # ראיה שההרשאה בוטלה, לכל תפקיד בנפרד: לפי חתימה מדויקת ולפי שם מלא
    # (בלי ארגומנטים), כי revoke דינמי אינו נושא חתימה.
    revoked_sig = {r: set() for r in DEFAULT_GRANTED}
    revoked_name = {r: set() for r in DEFAULT_GRANTED}
    # ‏grant שמדיר תפקיד: (חתימה, תפקיד) → (קובץ, שורה)
    granted_without = {}
    # כל grant או revoke שמונה את התפקיד בשם - החלטה, לכל כיוון.
    decided = {r: set() for r in DEFAULT_GRANTED}
    # ‏SECURITY DEFINER שאינה טריגר: שם → (קובץ, שורה) של היצירה האחרונה.
    definers = {}

    for path in files:
        sql = open(path, encoding='utf-8').read()

        for m in CREATE_RE.finditer(sql):
            name = m.group(1).lower()
            header = m.group(3).lower()
            if header.strip().startswith('trigger'):
                definers.pop(name, None)
                continue
            if re.search(r'\bsecurity\s+definer\b', header):
                definers[name] = (path, line_of(sql, m.start()))
            else:
                definers.pop(name, None)

        for m in re.finditer(
                r'\b(?:grant|revoke)\s[^;]*?\bon\s+function\s+'
                r'(public\.[a-z_][a-z_0-9]*)[^;]*?\b(?:to|from)\s+([^;]+);',
                sql, re.I | re.S):
            rs = roles_of(m.group(2))
            for role in DEFAULT_GRANTED:
                if role in rs:
                    decided[role].add(m.group(1).lower())

        for m in REVOKE_RE.finditer(sql):
            rs = roles_of(m.group(2))
            for role in DEFAULT_GRANTED:
                if role in rs:
                    revoked_sig[role].add(norm(m.group(1)))
                    revoked_name[role].add(norm(m.group(1)).split('(')[0])

        # ‏revoke דינמי: בלוק שיש בו revoke והתפקיד מוזכר בו מזכה כל שם
        # פונקציה שמופיע בבלוק. זו הצורה של 20261112090000 ושל 20261226090000.
        for blk in DO_BLOCK_RE.finditer(sql):
            body = blk.group(1)
            if not re.search(r'revoke', body, re.I):
                continue
            for role in DEFAULT_GRANTED:
                if role in body.lower():
                    for q in QUALIFIED_RE.finditer(body):
                        revoked_name[role].add(norm(q.group(1)))

        for m in GRANT_RE.finditer(sql):
            rs = roles_of(m.group(2))
            sig = norm(m.group(1))
            for role in DEFAULT_GRANTED:
                if role not in rs:
                    granted_without.setdefault((sig, role),
                                               (path, line_of(sql, m.start())))

    bad = 0
    for (sig, role), (path, ln) in sorted(granted_without.items()):
        if (sig, role) in ALLOW:
            continue
        if sig in revoked_sig[role] or sig.split('(')[0] in revoked_name[role]:
            continue
        bad += 1
        rpc = sig.split('(')[0].split('.')[-1]
        print(f'✗ {path}:{ln} — {sig}  [{role}]')
        print(f'    ה-grant מדיר את {role}, אבל אין revoke שמוציא אותו.')
        print(f'    הרשאת ברירת המחדל של Supabase נשארת, ו-PostgREST חושף')
        print(f'    את הפונקציה ב-/rest/v1/rpc/{rpc}')
        print(f'    התיקון — במיגרציה חדשה, או באותה שורה:')
        print(f'        revoke all on function {sig} from public, {role};')

    undecided = 0
    for name, (path, ln) in sorted(definers.items()):
        if name in UNDECIDED_DEFINER_OK:
            continue
        missing = [r for r in DEFAULT_GRANTED
                   if name not in decided[r] and name not in revoked_name[r]]
        if not missing:
            continue
        undecided += 1
        print(f'✗ {path}:{ln} — {name}  [{", ".join(missing)}]')
        print(f'    ‏SECURITY DEFINER בלי שום החלטת הרשאות: אין grant ואין revoke')
        print(f'    שמונים את {" ו-".join(missing)}. מברירת המחדל של Supabase היא')
        print(f'    פתוחה להם, עוקפת RLS, וחשופה ב-/rest/v1/rpc/{name.split(".")[-1]}')
        print(f'    אם היא נקראת רק מהשרת:')
        print(f'        revoke all on function {name}(…) from public, anon, authenticated;')
        print(f'        grant execute on function {name}(…) to service_role;')
        print(f'    ואם היא נועדה לדפדפן - grant מפורש לתפקיד, כדי שזו תהיה החלטה.')

    stale = sorted(n for n in UNDECIDED_DEFINER_OK if n not in definers)
    for n in stale:
        undecided += 1
        print(f'✗ UNDECIDED_DEFINER_OK מחזיק את {n}, שאינה עוד SECURITY DEFINER')
        print(f'    בלי החלטה. להסיר את השורה, כדי שהחריג לא יכסה פונקציה חדשה.')

    if bad or undecided:
        if undecided and not bad:
            print(f'\n{undecided} פונקציות SECURITY DEFINER בלי החלטת הרשאות.')
            return 1
        print(f'\n{bad} הרשאות שההענקה מדירה אך נשארות פתוחות בפועל.')
        print('אם החשיפה מכוונת — להעניק לתפקיד במפורש, או להוסיף שורה')
        print('ל-ALLOW ב-scripts/check_function_grants.py עם הנימוק.')
        return 1

    print(f'✓ {len(files)} מיגרציות, {len(granted_without)} זוגות '
          f'(פונקציה, תפקיד) שההענקה מדירה: לכולם יש revoke בפועל '
          f'({len(ALLOW)} חריגים מתועדים); {len(definers)} פונקציות SECURITY '
          f'DEFINER, לכולן החלטת הרשאות ({len(UNDECIDED_DEFINER_OK)} ותיקות '
          f'מתועדות).')
    return 0


if __name__ == '__main__':
    sys.exit(main())
