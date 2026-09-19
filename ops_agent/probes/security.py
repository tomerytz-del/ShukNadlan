"""חורי אבטחה — במסד ובקוד.

שני מקורות, ובכוונה באותה probe: ממצא אבטחה אמיתי כמעט תמיד חוצה את
הגבול. טבלה בלי RLS אינה מסוכנת עד שדף באתר קורא ממנה; סוד בקוד אינו
מסוכן עד שהוא מגיע לדפדפן.

## מה זה **לא** מחליף

‏`scripts/check_escapers.py` כבר חוסם ב-CI הגדרת בריחה חדשה בדף, ו-
‏`scripts/check_edge_config.py` את `verify_jwt`. הבדיקות כאן מכסות את מה
ששתיהן אינן רואות: את מצב המסד החי, ואת מה שהצטבר בקוד לפני שהבדיקות
נכתבו.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Iterator

from ..config import EDGE_AUTH_PATTERNS, PUBLIC_EDGE_FUNCTIONS
from ..models import Finding

_EDGE_AUTH_CACHE = None

# ‏JWT של Supabase. שלושה חלקים base64 שמתחילים ב-eyJ — החתימה היא מה
# שמבדיל בין מפתח אמיתי למחרוזת שנראית כמוהו.
_JWT_RE = re.compile(r"eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}")
# ‏service_role מופיע ב-payload המפוענח; כאן מחפשים את המחרוזת בקוד.
_SERVICE_HINT = re.compile(r"service_role|SERVICE_ROLE_KEY|sk-ant-|SUPABASE_SERVICE")
_TARGET_BLANK = re.compile(r"<a\b[^>]*target\s*=\s*[\"']_blank[\"'][^>]*>", re.I)
_REL_OK = re.compile(r"rel\s*=\s*[\"'][^\"']*noopener", re.I)
_HTTP_SRC = re.compile(r"(?:src|href)\s*=\s*[\"']http://(?!localhost|127\.)", re.I)


def run(ctx) -> Iterator[Finding]:
    yield from _rls(ctx)
    yield from _anon_rpc(ctx)
    yield from _search_path(ctx)
    yield from _anon_grants(ctx)
    yield from _storage(ctx)
    yield from _secrets_in_repo(ctx)
    yield from _html_hygiene(ctx)
    yield from _edge_functions(ctx)
    yield from _headers_file(ctx)


# ---------------------------------------------------------------- מסד

def _rls(ctx) -> Iterator[Finding]:
    """טבלה חשופה ל-API בלי RLS היא טבלה פתוחה לקריאה לכל אדם באינטרנט.

    ‏**אין דרגה בינונית בממצא הזה.** ‏PostgREST חושף כל טבלה ב-public,
    ‏RLS כבוי פירושו שכל מי שמחזיק/ה את ה-anon key — והוא מוטמע בכל דף
    באתר — קורא/ת את כל השורות.
    """
    ctx.count()
    rows = ctx.db.rows(
        """
        select c.relname as table_name,
               c.relrowsecurity as rls_on,
               (select count(*) from pg_policies p
                 where p.schemaname = 'public' and p.tablename = c.relname) as policies,
               has_table_privilege('anon', c.oid, 'select')          as anon_select,
               has_table_privilege('authenticated', c.oid, 'select') as auth_select
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r'
         order by c.relname
        """
    )
    for row in rows:
        name = row["table_name"]
        exposed = bool(row["anon_select"] or row["auth_select"])
        if not row["rls_on"] and exposed:
            yield Finding(
                area="security", code="rls_off", severity="critical",
                subject=name,
                title="טבלה בלי RLS חשופה ל-API: %s" % name,
                detail="‏RLS כבוי על public.%s, והטבלה נגישה ל-%s."
                       % (name, "anon" if row["anon_select"] else "authenticated"),
                suggestion="‏PostgREST חושף כל טבלה ב-public. כל מי שמחזיק/ה את "
                           "מפתח ה-anon — והוא בכל דף באתר — קורא/ת את כל השורות. "
                           "להדליק RLS ולהוסיף policy במיגרציה.",
                evidence={"anon_select": row["anon_select"],
                          "authenticated_select": row["auth_select"]},
            )
        elif row["rls_on"] and not row["policies"] and exposed:
            # לא חור: בלי policy הכול חסום. אבל זה בדרך כלל סימן לטבלה
            # שנועדה להיקרא דרך RPC, ושווה לוודא שזו אכן הכוונה.
            yield Finding(
                area="security", code="rls_no_policy", severity="info",
                subject=name,
                title="‏RLS דלוק בלי policy: %s" % name,
                detail="הטבלה חסומה לחלוטין לכל תפקיד שאינו service_role.",
                suggestion="אם היא נקראת דרך RPC של security definer — זה תקין "
                           "וזו ההתנהגות הרצויה. אם דף באתר אמור לקרוא ממנה, "
                           "הוא מקבל רשימה ריקה בלי שגיאה.",
            )


def _anon_rpc(ctx) -> Iterator[Finding]:
    """פונקציית SECURITY DEFINER שאנונימי/ת יכול/ה להריץ.

    זו נקודת קצה פומבית, לא פרט פנימי: ‏PostgREST חושף כל פונקציה תחת
    ‏`/rest/v1/rpc/<name>`. הדפוס הנכון בריפו הזה כבר קיים — בדיקת
    ‏`current_is_platform_admin()` בשורה הראשונה, ואז
    ‏`revoke … from public, anon`. הבדיקה מחפשת את מי שחסר לו/ה אחד מהשניים.

    ‏**פונקציות טריגר מוחרגות, וזה לא פרט טכני.** ‏PostgREST אינו חושף
    פונקציה שמחזירה `trigger` — אי אפשר לקרוא לה ב-HTTP בכלל. בלי
    ההחרגה הזו הבדיקה מחזירה 31 ממצאים במקום 11, ו-20 מהם טריגרים
    תקינים לחלוטין. דוח שרובו שקר הוא דוח שמפסיקים לפתוח.
    """
    ctx.count()
    rows = ctx.db.rows(
        """
        select p.proname                                 as name,
               pg_get_function_identity_arguments(p.oid) as args,
               pg_get_functiondef(p.oid)                 as body
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.prosecdef
           and p.prorettype <> 'trigger'::regtype
           and has_function_privilege('anon', p.oid, 'execute')
         order by p.proname
        """
    )
    guarded_names: list[str] = []
    for row in rows:
        body = row["body"] or ""
        # פונקציה שבודקת הרשאה בעצמה היא בדיוק הדפוס שהריפו בנה. החשופות
        # באמת הן אלה שאינן בודקות דבר.
        if re.search(r"current_is_platform_admin|auth\.uid\s*\(\s*\)|current_agent|"
                     r"errcode\s*=\s*'42501'", body):
            guarded_names.append(row["name"])
            continue

        # פונקציה שרק **קוראת** היא סיפור אחר מפונקציה ש**כותבת**.
        # ‏`property_map_enabled(uuid)` חושפת דגל תצוגה; פונקציה שמריצה
        # ‏insert או update בהרשאות של בעל/ת הפונקציה היא הסלמת הרשאות.
        # הגרסה הראשונה דיווחה על 11 כאלה ב-`high` — כולן קריאה בלבד.
        writes = bool(re.search(
            r"\b(insert\s+into|update\s+\w|delete\s+from|truncate|"
            r"perform\s+set_config|grant\s|revoke\s)\b", body, re.I))

        yield Finding(
            area="security", code="anon_secdef_unguarded",
            severity="high" if writes else "medium",
            subject=row["name"],
            title=("פונקציה פתוחה לאנונימי/ת שכותבת למסד: %s" % row["name"])
                  if writes else
                  ("שליפה פתוחה לאנונימי/ת בלי בדיקת הרשאה: %s" % row["name"]),
            detail="‏SECURITY DEFINER עם הרשאת execute ל-anon, ואין בגוף שום "
                   "בדיקת זהות. ‏PostgREST חושף אותה ב-/rest/v1/rpc/%s."
                   % row["name"],
            suggestion=("הפונקציה **כותבת** בהרשאות של בעליה, וכל אדם באינטרנט "
                        "יכול לקרוא לה עם כל קלט. זו הסלמת הרשאות. להוסיף בדיקת "
                        "זהות בשורה הראשונה, ו-revoke execute from anon.")
                       if writes else
                       ("קריאה בלבד, ולכן זו חשיפת מידע ולא הסלמה — השאלה היא "
                        "האם הערך שהיא מחזירה אמור להיות גלוי לכל אדם. אם לא, "
                        "‏revoke execute from anon במיגרציה."),
            evidence={"args": row["args"], "writes": writes},
        )

    # המוגנות מרוכזות לשורה אחת. הן אינן חשיפה — הן רשימה לסקירה
    # תקופתית, ושורה נפרדת לכל אחת מהן רק הייתה מטביעה את מי שכן חשופה.
    if guarded_names:
        yield Finding(
            area="security", code="anon_secdef_guarded", severity="info",
            subject="rpc_surface",
            title="%d פונקציות פומביות שבודקות הרשאה בעצמן" % len(guarded_names),
            detail="הפונקציות: %s" % ", ".join(guarded_names),
            suggestion="אלה תקינות: ‏SECURITY DEFINER שעוקף RLS, עם בדיקת זהות "
                       "בשורה הראשונה — בדיוק הדפוס הנכון. השורה כאן היא רשימת "
                       "משטח ה-API הפומבי, לסקירה כשמשהו נראה חשוד.",
            metric=float(len(guarded_names)), metric_unit="פונקציות",
            evidence={"functions": guarded_names},
        )


def _search_path(ctx) -> Iterator[Finding]:
    """‏SECURITY DEFINER בלי search_path נעול — הסלמת הרשאות קלאסית."""
    ctx.count()
    rows = ctx.db.rows(
        """
        select p.proname as name,
               pg_get_function_identity_arguments(p.oid) as args
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.prosecdef
           and (p.proconfig is null
                or not exists (select 1 from unnest(p.proconfig) c
                                where c like 'search\\_path=%%'))
         order by p.proname
        """
    )
    names = [r["name"] for r in rows]
    if not names:
        return
    yield Finding(
        area="security", code="secdef_mutable_search_path", severity="high",
        subject="functions",
        title="%d פונקציות SECURITY DEFINER בלי search_path נעול" % len(names),
        detail="הפונקציות: %s" % ", ".join(names[:12])
               + (" ועוד %d" % (len(names) - 12) if len(names) > 12 else ""),
        suggestion="בלי `set search_path = public`, משתמש/ת שיכול/ה ליצור סכימה "
                   "יכול/ה לשתול טבלה או פונקציה שתיקרא במקום האמיתית — והקוד "
                   "ירוץ בהרשאות של בעל/ת הפונקציה. להוסיף את השורה לכל אחת "
                   "מהן במיגרציה.",
        metric=float(len(names)), metric_unit="פונקציות",
        evidence={"functions": names},
    )


def _anon_grants(ctx) -> Iterator[Finding]:
    """‏policy של כתיבה בלי שום תנאי.

    ‏**הבדיקה הזו נכתבה פעם אחת לא נכון, וזה מלמד משהו.** הניסיון
    הראשון חיפש את מי שיש לו `grant update` — והחזיר 61 טבלאות. הסיבה:
    ‏Supabase מעניקה `grant all` ל-anon ול-authenticated כברירת מחדל על
    כל הסכימה, ומה ששומר בפועל הוא ה-RLS. דוח עם 61 "חורי אבטחה" שכולם
    תקינים הוא דוח שמלמדים להתעלם ממנו.

    מה שכן מסוכן הוא ה-**policy**: כתיבה שה-`using`/`with check` שלה הוא
    ‏`true`, כלומר בלי שום תנאי. ‏insert כזה קיים כאן בכוונה בשלוש
    טבלאות מונים (`property_views`, `project_views`,
    ‏`pwa_install_events`) — שורה שם היא מונה ולא נכס שכדאי לתקוף.
    ‏update או delete בלי תנאי הם סיפור אחר לגמרי: הם מאפשרים לכל אדם
    באינטרנט לשנות או למחוק שורות קיימות.
    """
    ctx.count()
    rows = ctx.db.rows(
        """
        select tablename  as table_name,
               policyname as policy,
               cmd,
               roles::text as roles
          from pg_policies
         where schemaname = 'public'
           and cmd in ('UPDATE', 'DELETE', 'ALL', 'INSERT')
           and (roles @> array['anon']::name[] or roles @> array['public']::name[])
           and coalesce(qual, with_check, 'true') = 'true'
           and coalesce(with_check, qual, 'true') = 'true'
         order by tablename
        """
    )
    for row in rows:
        cmd = row["cmd"]
        insert_only = cmd == "INSERT"
        yield Finding(
            area="security",
            code="open_write_policy_insert" if insert_only else "open_write_policy",
            severity="info" if insert_only else "critical",
            subject="%s.%s" % (row["table_name"], row["policy"]),
            title=("כתיבה אנונימית פתוחה: %s" % row["table_name"]) if insert_only
                  else ("‏policy של %s בלי שום תנאי: %s"
                        % (cmd, row["table_name"])),
            detail="ה-policy \"%s\" מתיר %s לכל פונה, בלי תנאי."
                   % (row["policy"], cmd),
            suggestion=("טבלת מונים שפתוחה לכתיבה אנונימית בכוונה — מי שיכתוב "
                        "לכאן זבל יטה מונה, הוא לא ידלוף דבר. שווה לוודא שלא "
                        "נוספו לטבלה עמודות שכן מזהות מישהו/י.")
                       if insert_only else
                       ("כל אדם באינטרנט יכול לשנות או למחוק שורות קיימות "
                        "בטבלה הזו. להוסיף תנאי ל-using/with check במיגרציה, "
                        "עכשיו."),
            evidence={"cmd": cmd, "roles": row["roles"]},
        )


def _storage(ctx) -> Iterator[Finding]:
    """דליים פומביים ב-Storage. פומבי = כל קובץ בו נגיש בלי טוקן."""
    ctx.count()
    try:
        rows = ctx.db.rows(
            "select id, name, public, file_size_limit from storage.buckets order by id")
    except Exception:
        return
    for row in rows:
        if not row["public"]:
            continue
        yield Finding(
            area="security", code="public_bucket", severity="info",
            subject=str(row["id"]),
            title="דלי אחסון פומבי: %s" % row["id"],
            detail="כל קובץ בדלי נגיש בכתובת ישירה, בלי טוקן ובלי התחברות.",
            suggestion="תמונות נכסים אמורות להיות פומביות — זה תקין. מה שאסור "
                       "להיכנס לדלי כזה: מסמכי הסכמים חתומים, צילומי תעודות, "
                       "וכל קובץ שהועלה בטופס. לוודא שאין.",
            evidence={"file_size_limit": row["file_size_limit"]},
        )


# ---------------------------------------------------------------- קוד

def _secrets_in_repo(ctx) -> Iterator[Finding]:
    """סוד שהגיע לקוד. בדף HTML זה אומר שהוא בדפדפן של כל גולש/ת."""
    root: Path = ctx.root
    ctx.count()
    for path in sorted(root.glob("*.html")):
        text = _read(path)
        if text is None:
            continue
        for match in _JWT_RE.finditer(text):
            token = match.group(0)
            # מפתח ה-anon אמור להיות בדף — זה כל הרעיון שלו. מה שאסור הוא
            # מפתח שנושא role אחר. הבדיקה מפענחת את ה-payload.
            role = _jwt_role(token)
            if role in ("anon", None):
                continue
            yield Finding(
                area="security", code="key_in_page", severity="critical",
                subject=path.name,
                title="מפתח %s בתוך %s" % (role, path.name),
                detail="נמצא JWT עם role=%s בקובץ שנשלח לדפדפן." % role,
                suggestion="מפתח שאינו anon עוקף RLS. כל מי שפותח/ת את מקור הדף "
                           "מקבל/ת גישה מלאה למסד. להחליף את המפתח ב-Supabase "
                           "מיד, ולהעביר את הקריאה ל-Edge Function.",
                evidence={"role": role},
            )
    # קבצי assets — אותה בדיקה, אותו סיכון
    for path in sorted((root / "assets").glob("*.js")):
        text = _read(path)
        if text and _SERVICE_HINT.search(text) and _JWT_RE.search(text):
            yield Finding(
                area="security", code="key_in_asset", severity="critical",
                subject="assets/" + path.name,
                title="מפתח שירות בקובץ assets: %s" % path.name,
                detail="הקובץ מכיל גם רמז ל-service_role וגם JWT.",
                suggestion="קבצי assets נטענים בדפדפן ככל קובץ אחר.",
            )


def _jwt_role(token: str) -> str | None:
    import base64
    import json
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        data = json.loads(base64.urlsafe_b64decode(payload))
        return data.get("role")
    except Exception:
        return None


def _html_hygiene(ctx) -> Iterator[Finding]:
    """שתי תקלות קטנות שמצטברות: ‏target=_blank בלי noopener, ומשאב ב-http."""
    root: Path = ctx.root
    ctx.count()
    blank: list[str] = []
    insecure: list[str] = []
    for path in sorted(root.glob("*.html")):
        text = _read(path)
        if text is None:
            continue
        for tag in _TARGET_BLANK.findall(text):
            if not _REL_OK.search(tag):
                blank.append(path.name)
                break
        if _HTTP_SRC.search(text):
            insecure.append(path.name)

    if blank:
        yield Finding(
            area="security", code="target_blank", severity="low",
            subject="html",
            title="קישורים ל-_blank בלי rel=noopener",
            detail="בדפים: %s" % ", ".join(sorted(set(blank))[:10]),
            suggestion="הדף שנפתח מקבל גישה ל-window.opener ויכול להחליף את הדף "
                       "המקורי בעמוד התחזות. להוסיף rel=\"noopener noreferrer\".",
            metric=float(len(set(blank))), metric_unit="דפים",
            evidence={"pages": sorted(set(blank))},
        )
    if insecure:
        yield Finding(
            area="security", code="mixed_content", severity="medium",
            subject="html",
            title="משאבים שנטענים ב-http",
            detail="בדפים: %s" % ", ".join(sorted(set(insecure))[:10]),
            suggestion="הדפדפן חוסם תוכן מעורב, ולכן המשאב פשוט לא נטען — בלי "
                       "שגיאה גלויה. להחליף ל-https.",
            evidence={"pages": sorted(set(insecure))},
        )


def _edge_functions(ctx) -> Iterator[Finding]:
    """פונקציה עם verify_jwt=false שאינה מאמתת דבר.

    ## שתי טעויות שהגרסה הראשונה עשתה, ושתיהן אותה טעות

    הבדיקה הראשונה דיווחה על **31 פונקציות**. קריאה בקוד הראתה שכמעט
    כולן מוגנות — רק לא בדרך שה-regex הכיר:

    * ‏`property-description` מייבאת `authorizeInternalCaller` מ-
      ‏`_shared/cron-auth.ts`, שמשווה `ALERT_CRON_SECRET` בזמן קבוע.
    * ‏`professional-manage` ו-`saved-search-manage` נשענות על אסימון
      בגוף הבקשה או בכתובת.
    * ‏`platform-mail` מגדירה `authorized()` משלה ומחזירה 401.
    * ‏`property-visualize` חוסמת לפי מסלול (403) ולפי מכסה (429).

    והטעות השנייה, העמוקה יותר: **טופס ציבורי אינו חור.** ‏`verify_jwt`
    כבוי ב-`newsletter-subscribe` כי מי שנרשם/ת לניוזלטר אינו/ה מחובר/ת.
    לדווח על זה כ"גבוה" פירושו להטביע את הממצא האמיתי בתוך עשרים כאלה.

    לכן: מה שמאמת — לא מדווח. מה שאינו מאמת אבל **מוצהר** כפומבי
    (`PUBLIC_EDGE_FUNCTIONS`) — `info`, עם הערה על הגבלת קצב. כל השאר —
    ‏`high`, כי פונקציה חדשה בלי אימות היא חשודה עד שמישהו/י מחליט/ה
    אחרת במודע.
    """
    root: Path = ctx.root
    config = root / "supabase" / "config.toml"
    text = _read(config)
    if text is None:
        return
    ctx.count()

    # ‏[functions.<name>] ואחריו verify_jwt = false
    for block in re.finditer(
            r"\[functions\.([a-z0-9-]+)\]([^\[]*)", text, re.I):
        name, body = block.group(1), block.group(2)
        if not re.search(r"verify_jwt\s*=\s*false", body):
            continue
        src = root / "supabase" / "functions" / name / "index.ts"
        code = _read(src)
        if code is None:
            continue

        if _edge_auth_re().search(code):
            continue

        if name in PUBLIC_EDGE_FUNCTIONS:
            yield Finding(
                area="security", code="public_edge_function", severity="info",
                subject=name,
                title="נקודת קצה פומבית מוצהרת: %s" % name,
                detail="‏verify_jwt=false ואין אימות — כמתוכנן, כי הפונה אינו/ה "
                       "מחובר/ת בשלב הזה.",
                suggestion="מה שכן נשאר פתוח כאן הוא **הגבלת קצב**. טופס ציבורי "
                           "בלי rate limit הוא הזמנה להצפה — גם כשהוא אמור "
                           "להיות פומבי. שווה לוודא שיש מגבלה לפי IP או לפי "
                           "טלפון.",
            )
            continue

        yield Finding(
            area="security", code="open_edge_function", severity="high",
            subject=name,
            title="‏Edge Function פתוחה בלי אימות: %s" % name,
            detail="‏verify_jwt=false ב-config.toml, ולא נמצאה בקוד שום בדיקה "
                   "שדוחה בקשה — לא סוד, לא אסימון, ולא 401/403/429.",
            suggestion="הפונקציה נגישה לכל מי שיודע/ת את הכתובת, בלי התחברות. "
                       "אם היא webhook — לאמת חתימה. אם היא נקראת מ-cron — "
                       "‏authorizeInternalCaller מ-_shared/cron-auth.ts. אם היא "
                       "**כן** אמורה להיות פומבית — להוסיף אותה ל-"
                       "‏PUBLIC_EDGE_FUNCTIONS ב-ops_agent/config.py, וכך "
                       "ההחלטה נרשמת במקום להישכח.",
        )


def _edge_auth_re():
    """מהודר פעם אחת. הדפוסים עצמם ב-config, כי הם כיול ולא לוגיקה."""
    global _EDGE_AUTH_CACHE
    if _EDGE_AUTH_CACHE is None:
        _EDGE_AUTH_CACHE = re.compile("|".join(EDGE_AUTH_PATTERNS), re.I)
    return _EDGE_AUTH_CACHE


def _headers_file(ctx) -> Iterator[Finding]:
    """כותרות האבטחה של Netlify — ובמיוחד CSP שנשאר במצב דיווח."""
    text = _read(ctx.root / "_headers")
    if text is None:
        return
    ctx.count()

    required = {
        "X-Frame-Options": "הגנה מפני clickjacking",
        "X-Content-Type-Options": "מניעת ניחוש Content-Type",
        "Referrer-Policy": "מניעת דליפת כתובות פנימיות",
        "Strict-Transport-Security": "אכיפת HTTPS",
        "Permissions-Policy": "חסימת מצלמה/מיקרופון/מיקום",
    }
    missing = [f"{h} ({why})" for h, why in required.items() if h not in text]
    if missing:
        yield Finding(
            area="security", code="headers_missing", severity="medium",
            subject="_headers",
            title="כותרות אבטחה חסרות",
            detail="חסרות: %s" % "; ".join(missing),
            suggestion="הכותרות מוחלות על כל בקשה ב-Netlify מהקובץ _headers.",
            evidence={"missing": missing},
        )

    if "Content-Security-Policy-Report-Only" in text \
            and "Content-Security-Policy:" not in text:
        yield Finding(
            area="security", code="csp_report_only", severity="medium",
            subject="_headers",
            title="‏CSP עדיין במצב דיווח בלבד",
            detail="קיים Content-Security-Policy-Report-Only ואין CSP אוכף.",
            suggestion="במצב דיווח הדפדפן מדווח על הפרה אבל **מריץ אותה**. הזרקת "
                       "סקריפט תעבוד. זה מצב ביניים נכון להתחלה — השאלה היא מתי "
                       "עוברים, ולכן הממצא נשאר פתוח עד שעוברים.",
        )


def _read(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
