"""בריאות המסד, הביצועים שלו, והמשאבים שנשרפים בו לחינם.

שלוש שאלות, כולן על אותו חיבור קריאה־בלבד:

1. **האם זה עובד** — תורים תקועים, ‏pg_cron שנופל, מנוע ששתק.
2. **כמה זה עולה** — שאילתות איטיות, סריקות טבלה, מטמון.
3. **מה נשרף לחינם** — אינדקסים מתים, שורות מתות, job ריק שרץ כל 5 דקות.

‏**כל בדיקה כאן בודקת קודם שהאובייקט קיים.** הסכימה משתנה, והסוכן אינו
אמור להפיל סריקה שלמה בגלל טבלה שקיבלה שם חדש.
"""

from __future__ import annotations

from typing import Iterator

from ..config import ENGINES, QUEUES
from ..models import Finding


def run(ctx) -> Iterator[Finding]:
    yield from _cron(ctx)
    yield from _queues(ctx)
    yield from _engines(ctx)
    yield from _slow_queries(ctx)
    yield from _seq_scans(ctx)
    yield from _bloat(ctx)
    yield from _cache_hit(ctx)
    yield from _unused_indexes(ctx)
    yield from _missing_fk_indexes(ctx)
    yield from _connections(ctx)


# ---------------------------------------------------------------- pg_cron

def _cron(ctx) -> Iterator[Finding]:
    """‏pg_cron הוא איך שרוב האוטומציה כאן רצה — 24 jobs נכון להיום.

    ‏job שנכשל אינו מדווח לאיש: אין מייל, אין לוג באתר, והתוצאה היא
    שקט שנראה בדיוק כמו הצלחה. זו הבדיקה היחידה שמפרידה ביניהם.
    """
    t = ctx.settings.thresholds
    ctx.count()
    try:
        rows = ctx.db.rows(
            """
            select j.jobname,
                   j.schedule,
                   j.active,
                   count(*) filter (where d.status <> 'succeeded') as failed,
                   count(*)                                        as runs,
                   max(d.start_time)                               as last_run,
                   (array_agg(d.return_message
                              order by d.start_time desc)
                    filter (where d.status <> 'succeeded'))[1]     as last_error
              from cron.job j
              left join cron.job_run_details d
                     on d.jobid = j.jobid
                    and d.start_time > now() - make_interval(hours => %s)
             group by j.jobname, j.schedule, j.active
            """,
            (t.cron_window_hours,),
        )
    except Exception as err:
        # אין הרשאה ל-cron, או שה-extension ירד. זה עצמו ממצא.
        yield Finding(
            area="health", code="cron_unreadable", severity="medium",
            subject="pg_cron",
            title="לא ניתן לקרוא את מצב ה-cron",
            detail="השאילתה על cron.job נכשלה: %s" % err,
            suggestion="בלי הבדיקה הזו, job שנופל אינו מדווח לאיש. לבדוק הרשאות "
                       "על סכימת cron עבור המשתמש שבסוד SUPABASE_DB_URL.",
        )
        return

    for row in rows:
        name = row["jobname"]
        failed = int(row["failed"] or 0)
        runs = int(row["runs"] or 0)

        if not row["active"]:
            yield Finding(
                area="health", code="cron_disabled", severity="medium",
                subject=name,
                title="‏job מכובה ב-cron: %s" % name,
                detail="ה-job רשום בתזמון %s אבל active=false — הוא אינו רץ."
                       % row["schedule"],
                suggestion="אם זה בכוונה, למחוק אותו. job כבוי שנשאר ברשימה הוא "
                           "מה שגורם להנחה שגויה שמשהו רץ.",
                evidence={"schedule": row["schedule"]},
            )
            continue

        if failed >= t.cron_fail_min:
            rate = failed / runs if runs else 1.0
            severity = "critical" if rate >= 0.5 else "high"
            yield Finding(
                area="health", code="cron_failing", severity=severity,
                subject=name,
                title="‏job נכשל ב-cron: %s" % name,
                detail="%d מתוך %d הרצות נכשלו ב-%d השעות האחרונות."
                       % (failed, runs, t.cron_window_hours),
                suggestion="השגיאה האחרונה: %s" % (row["last_error"] or "—"),
                metric=float(failed), metric_unit="כשלונות",
                evidence={"schedule": row["schedule"], "runs": runs,
                          "last_error": row["last_error"]},
            )
            continue

        # ‏job פעיל שלא רץ בכלל בחלון — לא נכשל, פשוט לא קרה. הסף גמיש
        # כי job יומי לא אמור לרוץ ב-24 שעות יותר מפעם אחת.
        if runs == 0 and _is_frequent(row["schedule"]):
            yield Finding(
                area="health", code="cron_silent", severity="high",
                subject=name,
                title="‏job תדיר שלא רץ כלל: %s" % name,
                detail="התזמון הוא %s, ובחלון של %d שעות לא נרשמה אף הרצה."
                       % (row["schedule"], t.cron_window_hours),
                suggestion="לבדוק את cron.job_run_details ואת מצב ה-worker. "
                           "‏job תדיר ששותק פירושו שהתכונה שתלויה בו מתה.",
                evidence={"schedule": row["schedule"]},
            )


def _is_frequent(schedule: str) -> bool:
    """האם התזמון הוא לפחות שעתי. ‏job יומי ששתק 24 שעות אינו בהכרח תקול."""
    s = (schedule or "").strip()
    if s.startswith("*/") or "-" in s.split(" ")[0]:
        return True
    parts = s.split()
    # דקה קבועה + כל שעה => '17 * * * *'
    return len(parts) == 5 and parts[1] == "*"


# ---------------------------------------------------------------- תורים

def _queues(ctx) -> Iterator[Finding]:
    """תור עם שורה ישנה — אבל **לא כל המתנה היא תקלה**.

    כל תור כאן מתאר תכונה שהמשתמש/ת מחכה לה. לכן ההודעה נושאת גם את
    השם הטכני וגם **מה שבור מבחינתו/ה** — "ההדמיה לא נוצרת" ולא
    "‏visualization_jobs pending".

    ## ‏`attempts` הוא ההבדל בין תקלה להמתנה מתוכננת

    הגרסה הראשונה דיווחה על שורה בתור הפרסום לפייסבוק שהמתינה 51 שעות,
    והיא **לא הייתה תקועה**: ‏`pending_property_publications` מסננת
    נכס בלי תמונה, הנכס ההוא היה בלי תמונה, ולכן הפונקציה מעולם לא
    בחרה אותו. זו המתנה מכוונת — המודעה תפורסם ברגע שתעלה תמונה
    (`20261025090000_publish_when_image_arrives`).

    ‏**`attempts = 0` ובלי `last_error` פירושו שאיש לא ניסה.** זו חסימה
    מקדימה, והמקום לחפש בו הוא השאילתה שבוחרת שורות — לא העובד.
    ‏`attempts > 0` עם שגיאה הוא ההפך: מישהו ניסה, וזה נכשל.

    ההבחנה חשובה כי שתיהן נראות זהה בדוח, ורק אחת מהן דורשת תיקון
    בקוד. שורה חסומה שמדווחת כ"תור תקוע" כל שש שעות היא הדרך להפוך את
    הדוח לרעש — וזה קרה כאן בפועל.
    """
    t = ctx.settings.thresholds
    for table, status_col, pending, time_col, label, breaks in QUEUES:
        if not ctx.db.has_table(table):
            continue
        ctx.count()

        # לא לכל תור יש `attempts`. בלי העמודה אין דרך להבחין, ואז
        # ההתנהגות נשארת כשהייתה — עדיף לדווח מדי מאשר לבלוע.
        has_attempts = ctx.db.has_column(table, "attempts")
        attempts_cols = (
            """,
                   count(*) filter (where coalesce(attempts, 0) > 0) as tried,
                   count(*) filter (where coalesce(attempts, 0) = 0) as untouched"""
            if has_attempts else """,
                   count(*) as tried,
                   0        as untouched"""
        )

        row = ctx.db.one(
            """
            select count(*) as stuck,
                   min({time_col}) as oldest,
                   round(extract(epoch from (now() - min({time_col}))) / 3600.0, 1)
                     as age_hours{attempts_cols}
              from public.{table}
             where {status_col} = any(%s)
               and {time_col} < now() - make_interval(hours => %s)
            """.format(table=table, status_col=status_col, time_col=time_col,
                       attempts_cols=attempts_cols),
            (list(pending), t.queue_stuck_hours),
        )
        stuck = int((row or {}).get("stuck") or 0)
        if not stuck:
            continue

        untouched = int((row or {}).get("untouched") or 0)
        tried = int((row or {}).get("tried") or 0)

        # שורות שאיש לא נגע בהן — חסימה מקדימה, לא תור שבור
        if has_attempts and untouched:
            yield Finding(
                area="health", code="queue_blocked",
                severity="medium" if untouched >= t.queue_stuck_critical_min_rows
                         else "low",
                subject=table + ":blocked",
                title="ממתין לתנאי מקדים: %s" % label,
                detail="%d שורות שאיש לא ניסה לעבד (attempts=0), הוותיקה כבר "
                       "%.1f שעות." % (untouched, float(row.get("age_hours") or 0)),
                suggestion="‏attempts=0 פירושו שהעובד **לא בחר** את השורות האלה, "
                           "ולא שהוא נכשל עליהן. לחפש בשאילתה שבוחרת מה לעבד: "
                           "בתור הפרסום לפייסבוק, למשל, "
                           "‏pending_property_publications מסננת נכס בלי תמונה, "
                           "והמודעה תצא מעצמה ברגע שתעלה אחת. זו לרוב התנהגות "
                           "תקינה — מה שצריך בדיקה הוא התנאי שלא מתקיים.",
                metric=float(untouched), metric_unit="שורות",
                evidence={"oldest": (row or {}).get("oldest"),
                          "attempts": 0, "blocked": True},
            )

        # מכאן והלאה: רק מה שבאמת נוסה ונכשל
        if has_attempts:
            stuck = tried
            if not stuck:
                continue

        age = float((row or {}).get("age_hours") or 0)

        # ‏**גיל לבדו אינו מסלים ל"חמור", וזה תוקן אחרי הסריקה הראשונה.**
        # שם הכלל היה `גיל >= 24 או שורות >= 25`, ושורה בודדת שנתקעה
        # יומיים פתחה Issue בדרגת "חמור" — בזמן ש"חמור" הוגדר כ"אתר
        # נפל / נתונים חשופים / הצינור שבור". פרסום אחד שלא יצא לפייסבוק
        # אינו זה.
        #
        # עכשיו נדרשים **גם** ותק וגם נפח, או נפח גדול לבדו: תור שמצטבר
        # הוא תקלה מערכתית, שורה אחת תקועה היא כנראה שורה אחת רעה.
        severity = "high"
        if stuck >= t.queue_stuck_critical_rows or (
                age >= t.queue_stuck_critical_hours
                and stuck >= t.queue_stuck_critical_min_rows):
            severity = "critical"
        elif stuck < t.queue_stuck_critical_min_rows:
            # שורה בודדת שנתקעה היא מטרד, לא תקלה
            severity = "medium"

        yield Finding(
            area="health", code="queue_stuck", severity=severity,
            subject=table,
            title="תור תקוע: %s" % label,
            detail="%d שורות ממתינות, הוותיקה כבר %.1f שעות." % (stuck, age),
            suggestion="מה שבור בפועל: %s. לבדוק את ה-cron job ואת הפונקציה "
                       "שמרוקנת את התור, ואת last_error בשורות עצמן." % breaks,
            metric=float(stuck), metric_unit="שורות",
            evidence={"oldest": (row or {}).get("oldest"), "age_hours": age,
                      "pending_values": list(pending)},
        )


# ---------------------------------------------------------------- מנועים

def _engines(ctx) -> Iterator[Finding]:
    """מנוע ששתק. שלוש סיבות אפשריות, וכולן נראות זהה מבחוץ."""
    t = ctx.settings.thresholds
    for table, time_col, label, workflow, silence_hours in ENGINES:
        if not ctx.db.has_table(table):
            continue
        ctx.count()
        row = ctx.db.one(
            """
            select max({time_col}) as last_row,
                   round(extract(epoch from (now() - max({time_col}))) / 3600.0, 1)
                     as silent_hours
              from public.{table}
            """.format(table=table, time_col=time_col)
        )
        silent = (row or {}).get("silent_hours")
        if silent is None:
            continue
        silent = float(silent)
        if silent < (silence_hours or t.engine_silence_hours):
            continue
        yield Finding(
            area="health", code="engine_silent", severity="medium",
            subject=table,
            title="מנוע ששתק: %s" % label,
            detail="לא נכנסה שורה חדשה כבר %.0f שעות." % silent,
            suggestion="ארבע סיבות אפשריות, וכולן נראות זהה מכאן: הפיד נשבר, "
                       "הסוד פג, ‏%s כבוי — **או שהוא רץ בהצלחה ופשוט לא היה "
                       "מה לשמור.** שתי הראשונות מופיעות כ-workflow_failing "
                       "והשלישית כ-workflow_silent; אם שתיהן שקטות, זו "
                       "הרביעית. להתחיל מלשונית Actions." % workflow,
            metric=silent, metric_unit="שעות",
            evidence={"last_row": (row or {}).get("last_row"), "workflow": workflow},
        )


# ---------------------------------------------------------------- שאילתות

# חלון מינימלי לחישוב קצב. שתי סריקות במרווח של דקה אינן ראיה לשום
# "שניות ליום", ולכן חלון קצר יותר מחולק **כאילו** היה שעה. ההטיה
# מכוונת כלפי מטה: דיווח חסר בסריקה אחת עדיף על ממצא מנופח שנעלם
# בסריקה הבאה.
_RATE_FLOOR_SEC = 3_600.0

# כמה שאילתות נשלפות כמועמדות. המיון ב-SQL הוא לפי הזמן המצטבר — המדד
# ה**שגוי** — ולכן הרשימה רחבה בכוונה, והדירוג האמיתי נעשה בפייתון לפי
# הקצב. ‏200 מתוך ~5,000 רשומות מכסות כל מה שצרך יותר משבריר שנייה.
_QUERY_CANDIDATES = 200

# רצפה מכנית, לא סף כיול: שאילתה שרצה פחות מ-10 פעמים **אי פעם** אין
# ממנה קצב להסיק. הכיול עצמו (`slow_query_min_calls_per_day`) יושב
# ב-config.py כמו כל סף אחר.
_MIN_LIFETIME_CALLS = 10

# ‏`subject` של הממצא הוא טביעת האצבע של טקסט השאילתה, אבל
# ‏pg_stat_statements מפצל את אותו טקסט לשורה לכל role. ‏173 טביעות
# במסד הזה מופיעות ביותר משורה אחת — בעיקר קריאות PostgREST שמגיעות גם
# מ-`anon` וגם מ-`authenticated`. בלי `group by md5(query)` כל שורה
# הייתה מקבלת את אותו מפתח ודורסת את חברתה, והדלתא של הסריקה הבאה
# הייתה מחושבת מול הבסיס של ה-role השני.


def _previous_samples(ctx) -> dict[str, dict]:
    """הדגימה הגולמית של הסריקה הקודמת, לפי `subject`.

    ‏`pg_stat_statements` הוא מונה מצטבר, והממצאים כאן הם על **קצב**.
    כדי לגזור קצב צריך שתי נקודות בזמן, והשנייה חייבת לשרוד בין ריצות
    של תהליך שרץ פעם בשש שעות ומת.

    המקום שבו היא שורדת הוא `ops_findings.evidence` — אותה טבלה שהממצא
    נכתב אליה ממילא. **אין כאן טבלה חדשה וגם לא יכולה להיות:** חיבור
    הסריקה הוא `read_only` ברמת Postgres (ראו `db.py`), ולכן probe אינה
    יכולה לדגום ולשמור בעצמה. היא יכולה רק לקרוא את מה שה-`Writer` כתב
    בסוף הסריקה הקודמת.

    שורה שנסגרה (`resolved_at`) נקראת גם היא: הדגימה שבה עדיין תקפה
    כנקודת בסיס, ו-`last_seen` אומר מתי בדיוק היא נלקחה.
    """
    if not ctx.db.has_table("ops_findings"):
        return {}
    try:
        rows = ctx.db.rows(
            """
            select subject,
                   (evidence->>'calls')::bigint            as calls,
                   (evidence->>'total_ms')::float8         as total_ms,
                   extract(epoch from (now() - last_seen)) as age_sec
              from public.ops_findings
             where code in ('slow_query', 'heavy_query')
               and subject is not null
               and evidence ? 'total_ms'
             order by last_seen desc
            """
        )
    except Exception:  # noqa: BLE001
        # בסיס חסר אינו סיבה להפיל probe שלמה. הנפילה לאחור אינה שקטה:
        # ‏`window_source` בממצא יגיד "lifetime" במקום "delta".
        return {}

    out: dict[str, dict] = {}
    for row in rows:
        # אותה שאילתה יכולה להופיע גם כ-slow_query וגם כ-heavy_query, עם
        # אותו subject ואותה דגימה. הראשונה (החדשה ביותר) מנצחת.
        out.setdefault(str(row["subject"]), row)
    return out


def _window_start(ctx) -> str:
    """הביטוי שאומר מתי החל החלון של הרשומה — לנפילה לאחור בלבד.

    ‏PG17 נותן `stats_since` **לכל רשומה**, וזה המדויק: רשומה שנוצרה
    אתמול לא תיראה כאילו היא צוברת מאז האיפוס הגלובלי. בגרסה ישנה יותר
    העמודה אינה קיימת, ואז אין ברירה אלא `stats_reset` הגלובלי — שמותח
    את החלון ומקטין את הקצב, כלומר שוב שוגה לכיוון הבטוח.
    """
    try:
        found = ctx.db.one(
            """
            select 1 as ok
              from pg_attribute
             where attrelid = 'extensions.pg_stat_statements'::regclass
               and attname  = 'stats_since'
               and attnum > 0
            """
        )
    except Exception:  # noqa: BLE001
        found = None
    if found:
        return "stats_since"
    return "(select stats_reset from extensions.pg_stat_statements_info)"


def _slow_queries(ctx) -> Iterator[Finding]:
    """‏pg_stat_statements — מי באמת אוכל את המסד.

    שני ממצאים שונים מאותו מקור, ובכוונה:

    * **איטית** — ממוצע גבוה. זה מה שהמשתמש/ת מרגיש/ה.
    * **כבדה** — הרבה זמן מסד ליום. זו מה שמייקרת את החשבון, גם אם כל
      קריאה בודדת נראית סבירה. שאילתה של 10ms שרצה 200 אלף פעם היא
      הבעיה הגדולה יותר, והיא זו שלא מופיעה בשום דוח "שאילתות איטיות".

    ## למה **ליום** ולא "מאז איפוס הסטטיסטיקה"

    המונים ב-`pg_stat_statements` מצטברים ולעולם אינם יורדים. בדיקה
    שמשווה את הסכום המצטבר לסף קבוע נשברת בשלוש דרכים בבת אחת:

    * **הממצא אינו יכול להיסגר.** ברגע שעברה את הסף היא מעליו לנצח, גם
      אחרי שהשאילתה הפסיקה לרוץ לגמרי. הסגירה האוטומטית (`store.py`) —
      הדבר היחיד שמראה שמשהו תוקן — אינה יכולה לפעול עליה.
    * **‏`prev_metric` חסר משמעות.** מונה שרק עולה יכול להחמיר או לעמוד
      במקום, לעולם לא להשתפר. מנגנון המגמה מת.
    * **הסף אומר דבר אחר בכל יום.** ‏120 שניות הן הרבה ביום שאחרי
      איפוס, ואפס אחרי שנה.

    ‏**זה לא תיאורטי — זה קרה.** ב-19.9.2026 הממצא הכבד ביותר בדשבורד
    היה `net.http_post` של ה-cron: ‏173 שניות על פני 17,204 קריאות.
    השאילתה הזו לא רצה אפילו פעם אחת מאז 13.9 — ארבע מיגרציות
    (‏`20261020`, ‏`20261021`, ‏`20261029`) החליפו את פקודות ה-cron
    בגרסה מותנית, וה-17,204 הן מאובן של 29.8–13.9. שתי סריקות רצופות
    במרחק עשר שעות דיווחו **בדיוק** 173.2 שניות, ואיש לא יכול היה
    לראות מהמספר שהבעיה כבר נפתרה.

    ## איך נמדד החלון

    קודם כול דלתא מול הדגימה של הסריקה הקודמת (`_previous_samples`) —
    זה המדויק, ושאילתה שהפסיקה לרוץ צונחת לאפס תוך סריקה אחת. אם אין
    בסיס (סריקה ראשונה, או שאילתה שלא דווחה מעולם) נופלים לחלון החיים
    של הרשומה. מונה שירד — איפוס של `pg_stat_statements` — מזוהה בכך
    שהוא נמוך מהבסיס או שהרשומה צעירה מהדגימה, ואז גם הוא נופל לחלון
    החיים במקום לייצר דלתא שלילית.
    """
    t = ctx.settings.thresholds
    ctx.count()
    samples = _previous_samples(ctx)
    try:
        rows = ctx.db.rows(
            """
            select sum(calls)::bigint                          as calls,
                   sum(total_exec_time)                        as total_ms,
                   extract(epoch from (now() - min({window}))) as age_sec,
                   min(left(regexp_replace(query, '\\s+', ' ', 'g'), 200))
                                                               as sample,
                   md5(query)                                  as fingerprint
              from extensions.pg_stat_statements
             where query not ilike '%%pg_stat_statements%%'
               and query not ilike '%%ops_agent%%'
             group by md5(query)
            having sum(calls) >= %s
             order by sum(total_exec_time) desc
             limit {limit}
            """.format(window=_window_start(ctx), limit=_QUERY_CANDIDATES),
            (_MIN_LIFETIME_CALLS,),
        )
    except Exception as err:
        yield Finding(
            area="performance", code="stat_statements_unreadable", severity="low",
            subject="pg_stat_statements",
            title="לא ניתן לקרוא את סטטיסטיקת השאילתות",
            detail=str(err),
            suggestion="בלי זה אין דרך לדעת מה מעמיס על המסד. לוודא שה-extension "
                       "‏pg_stat_statements מותקן ושיש הרשאת קריאה.",
        )
        return

    measured = [_measure(row, samples) for row in rows]
    measured.sort(key=lambda m: m["sec_per_day"], reverse=True)

    for m in measured[:10]:
        evidence = {
            "query": m["sample"],
            "mean_ms": round(m["mean_ms"], 1),
            "calls_per_day": round(m["calls_per_day"]),
            "sec_per_day": round(m["sec_per_day"], 1),
            "window_hours": round(m["window_sec"] / 3_600, 1),
            "window_source": m["source"],
            # הדגימה הגולמית. **זה הבסיס של הסריקה הבאה** — מפתח שיישמט
            # כאן יחזיר את הבדיקה כולה למדידה מצטברת, בשקט.
            "calls": m["calls"],
            "total_ms": round(m["total_ms"], 1),
        }
        # ‏`calls_per_day` חוסם רק את "איטית", וזו לא קפדנות יתר: ממוצע
        # גבוה על שאילתה שרצה פעמיים ביום אינו בעיה. ל"כבדה" אין גישה
        # כזו — היא נמדדת בזמן המסד שהיא צורכת, וחמש קריאות ביום של
        # שלוש שניות כל אחת הן בדיוק אותה בעיה.
        if (m["mean_ms"] >= t.slow_query_mean_ms
                and m["calls_per_day"] >= t.slow_query_min_calls_per_day):
            yield Finding(
                area="performance", code="slow_query",
                severity="high" if m["mean_ms"] >= t.slow_query_mean_ms * 5
                         else "medium",
                subject="query_" + m["fingerprint"],
                title="שאילתה איטית — ממוצע %.0fms" % m["mean_ms"],
                detail="%d קריאות ביום, ממוצע %.1fms, %.0f שניות מסד ליום. %s"
                       % (m["calls_per_day"], m["mean_ms"], m["sec_per_day"],
                          _window_text(m)),
                suggestion="להריץ explain analyze על השאילתה. ממוצע גבוה עם הרבה "
                           "קריאות הוא בדרך כלל אינדקס חסר או policy של RLS "
                           "שמחושב לכל שורה.",
                metric=round(m["mean_ms"], 1), metric_unit="ms",
                evidence=evidence,
            )
        elif m["sec_per_day"] >= t.heavy_query_sec_per_day:
            yield Finding(
                area="cost", code="heavy_query", severity="medium",
                subject="query_" + m["fingerprint"],
                title="שאילתה שצורכת את רוב זמן המסד",
                detail="%.0f שניות מסד ליום — %d קריאות ביום, ממוצע %.1fms "
                       "בלבד. %s"
                       % (m["sec_per_day"], m["calls_per_day"], m["mean_ms"],
                          _window_text(m)),
                suggestion="כל קריאה נראית זולה, ולכן היא לא מופיעה בשום דוח "
                           "'שאילתות איטיות'. השאלה כאן אינה כמה היא לוקחת אלא "
                           "האם צריך לקרוא לה כל כך הרבה.",
                metric=round(m["sec_per_day"], 1), metric_unit="שניות/יום",
                evidence=evidence,
            )


def _measure(row: dict, samples: dict[str, dict]) -> dict:
    """ממירה מונה מצטבר לקצב, מול הדגימה הקודמת אם יש כזו."""
    calls = int(row["calls"] or 0)
    total_ms = float(row["total_ms"] or 0.0)
    age_sec = float(row["age_sec"] or 0.0)
    fingerprint = str(row["fingerprint"])[:12]

    d_calls, d_ms, window_sec, source = calls, total_ms, age_sec, "lifetime"
    prev = samples.get("query_" + fingerprint)
    if prev is not None:
        prev_calls = prev["calls"]
        prev_ms = prev["total_ms"]
        prev_age = float(prev["age_sec"] or 0.0)
        # ‏calls שירד, total שירד, או רשומה צעירה מהדגימה — כל אחד מהם
        # פירושו איפוס של pg_stat_statements בין הסריקות, והדלתא הייתה
        # יוצאת שלילית או מנופחת.
        if (prev_calls is not None and prev_ms is not None and prev_age > 0
                and calls >= int(prev_calls) and total_ms >= float(prev_ms)
                and age_sec >= prev_age):
            d_calls = calls - int(prev_calls)
            d_ms = total_ms - float(prev_ms)
            window_sec = prev_age
            source = "delta"

    days = max(window_sec, _RATE_FLOOR_SEC) / 86_400.0
    return {
        "calls": calls,
        "total_ms": total_ms,
        "fingerprint": fingerprint,
        "sample": row["sample"],
        "window_sec": window_sec,
        "source": source,
        "calls_per_day": d_calls / days,
        "sec_per_day": (d_ms / 1_000.0) / days,
        "mean_ms": (d_ms / d_calls) if d_calls else 0.0,
    }


def _window_text(m: dict) -> str:
    hours = m["window_sec"] / 3_600.0
    span = ("%.0f שעות" % hours) if hours < 48 else ("%.0f ימים" % (hours / 24))
    if m["source"] == "delta":
        return "נמדד על פני %s מאז הסריקה הקודמת." % span
    return "נמדד על פני %s — אין עדיין דגימה קודמת להשוות אליה." % span


def _seq_scans(ctx) -> Iterator[Finding]:
    """סריקת טבלה מלאה על טבלה גדולה = אינדקס חסר שממתין לקרות."""
    t = ctx.settings.thresholds
    ctx.count()
    rows = ctx.db.rows(
        """
        select relname                        as table_name,
               seq_scan,
               idx_scan,
               n_live_tup                     as live_rows,
               seq_tup_read / greatest(seq_scan, 1) as rows_per_scan
          from pg_stat_user_tables
         where schemaname = 'public'
           and seq_scan >= %s
           and n_live_tup >= %s
           and seq_scan > coalesce(idx_scan, 0)
         order by seq_tup_read desc
         limit 10
        """,
        (t.seq_scan_min_scans, t.seq_scan_min_rows),
    )
    for row in rows:
        yield Finding(
            area="performance", code="seq_scan", severity="medium",
            subject=row["table_name"],
            title="סריקה מלאה על %s" % row["table_name"],
            detail="%d סריקות רצף מול %d שימושי אינדקס, %d שורות בטבלה."
                   % (row["seq_scan"], row["idx_scan"] or 0, row["live_rows"]),
            suggestion="לזהות את השאילתה (ראו 'שאילתה איטית' באותו דוח) ולהוסיף "
                       "אינדקס במיגרציה. ‏**לא** להריץ create index ידנית — "
                       "זה מפיל את צינור המיגרציות (CLAUDE.md).",
            metric=float(row["seq_scan"]), metric_unit="סריקות",
            evidence={"live_rows": row["live_rows"],
                      "rows_per_scan": float(row["rows_per_scan"] or 0)},
        )


def _bloat(ctx) -> Iterator[Finding]:
    """שורות מתות שה-autovacuum לא מדביק."""
    t = ctx.settings.thresholds
    ctx.count()
    rows = ctx.db.rows(
        """
        select relname as table_name,
               n_live_tup as live_rows,
               n_dead_tup as dead_rows,
               round(n_dead_tup::numeric / greatest(n_live_tup, 1), 3) as ratio,
               last_autovacuum
          from pg_stat_user_tables
         where schemaname = 'public'
           and n_dead_tup > %s
           and n_dead_tup::numeric / greatest(n_live_tup, 1) > %s
         order by n_dead_tup desc
         limit 8
        """,
        (t.dead_tuple_min_rows, t.dead_tuple_ratio),
    )
    for row in rows:
        yield Finding(
            area="cost", code="table_bloat", severity="low",
            subject=row["table_name"],
            title="שורות מתות ב-%s" % row["table_name"],
            detail="%d שורות מתות מול %d חיות (יחס %.0f%%)."
                   % (row["dead_rows"], row["live_rows"], float(row["ratio"]) * 100),
            suggestion="הטבלה תופסת מקום ונסרקת לאט יותר ממה שצריך. בדרך כלל זו "
                       "טבלת תור שנמחקת ממנה הרבה. ‏autovacuum אגרסיבי יותר עליה "
                       "נקבע במיגרציה (alter table … set (autovacuum_…)).",
            metric=float(row["ratio"]) * 100, metric_unit="%",
            evidence={"dead_rows": row["dead_rows"], "live_rows": row["live_rows"],
                      "last_autovacuum": row["last_autovacuum"]},
        )


def _cache_hit(ctx) -> Iterator[Finding]:
    """יחס פגיעה במטמון. מתחת לסף — המסד קורא מהדיסק יותר מדי."""
    t = ctx.settings.thresholds
    ctx.count()
    row = ctx.db.one(
        """
        select sum(heap_blks_hit)  as hits,
               sum(heap_blks_read) as reads
          from pg_statio_user_tables
        """
    )
    hits = float((row or {}).get("hits") or 0)
    reads = float((row or {}).get("reads") or 0)
    total = hits + reads
    if total < t.cache_hit_min_blocks:
        return
    ratio = hits / total
    if ratio >= t.cache_hit_min:
        return
    yield Finding(
        area="performance", code="cache_hit_low", severity="medium",
        subject="buffer_cache",
        title="יחס המטמון של המסד ירד ל-%.1f%%" % (ratio * 100),
        detail="%.0f קריאות מהדיסק מול %.0f מהזיכרון." % (reads, hits),
        suggestion="בדרך כלל אחד משניים: המסד גדל מעבר לזיכרון שיש לו, או "
                   "ששאילתה סורקת טבלה גדולה ודוחפת החוצה את השאר.",
        metric=ratio * 100, metric_unit="%",
    )


def _unused_indexes(ctx) -> Iterator[Finding]:
    """אינדקס שלא נקרא אף פעם — עולה בכל כתיבה ולא מחזיר דבר.

    הסינון על גיל האינדקס חשוב: אינדקס שנוצר אתמול "לא בשימוש" בהגדרה,
    וממצא עליו הוא רעש שמלמד להתעלם מהדוח.
    """
    t = ctx.settings.thresholds
    ctx.count()
    rows = ctx.db.rows(
        """
        select s.indexrelname as index_name,
               s.relname      as table_name,
               pg_relation_size(s.indexrelid) / 1024 as kb,
               s.idx_scan
          from pg_stat_user_indexes s
          join pg_index i on i.indexrelid = s.indexrelid
         where s.schemaname = 'public'
           and s.idx_scan = 0
           and not i.indisunique
           and not i.indisprimary
           and pg_relation_size(s.indexrelid) / 1024 >= %s
           and (select greatest(coalesce(stats_reset, '-infinity'::timestamptz),
                                '-infinity'::timestamptz)
                  from pg_stat_database
                 where datname = current_database())
               < now() - make_interval(days => %s)
         order by pg_relation_size(s.indexrelid) desc
         limit 12
        """,
        (t.unused_index_min_kb, t.unused_index_min_age_days),
    )
    for row in rows:
        yield Finding(
            area="cost", code="unused_index", severity="low",
            subject="%s.%s" % (row["table_name"], row["index_name"]),
            title="אינדקס שלא נקרא: %s" % row["index_name"],
            detail="על %s, תופס %d KB, אפס שימושים מאז איפוס הסטטיסטיקה."
                   % (row["table_name"], row["kb"]),
            suggestion="אינדקס לא בשימוש מאט כל INSERT ו-UPDATE בטבלה. לפני "
                       "מחיקה — לוודא שהוא לא נועד לשאילתה עונתית (דוח חודשי, "
                       "מיגרציה). המחיקה נעשית במיגרציה, לא ידנית.",
            metric=float(row["kb"]), metric_unit="KB",
            evidence={"table": row["table_name"]},
        )


def _missing_fk_indexes(ctx) -> Iterator[Finding]:
    """מפתח זר בלי אינדקס — מחיקה בטבלת האב סורקת את כל טבלת הבן."""
    ctx.count()
    rows = ctx.db.rows(
        """
        select c.conrelid::regclass::text as table_name,
               c.conname                  as constraint_name,
               a.attname                  as column_name,
               pg_relation_size(c.conrelid) / 1024 as table_kb
          from pg_constraint c
          join pg_attribute a
            on a.attrelid = c.conrelid
           and a.attnum = c.conkey[1]
          join pg_class t on t.oid = c.conrelid
          join pg_namespace n on n.oid = t.relnamespace
         where c.contype = 'f'
           and n.nspname = 'public'
           and array_length(c.conkey, 1) = 1
           and not exists (
                 select 1 from pg_index i
                  where i.indrelid = c.conrelid
                    and i.indkey[0] = c.conkey[1]
               )
           and pg_relation_size(c.conrelid) > 200 * 1024
         order by pg_relation_size(c.conrelid) desc
         limit 10
        """
    )
    for row in rows:
        yield Finding(
            area="performance", code="unindexed_fk", severity="low",
            subject="%s.%s" % (row["table_name"], row["column_name"]),
            title="מפתח זר בלי אינדקס: %s.%s"
                  % (row["table_name"], row["column_name"]),
            detail="הטבלה תופסת %d KB. מחיקה או עדכון בטבלת האב סורקת אותה במלואה."
                   % row["table_kb"],
            suggestion="להוסיף אינדקס על העמודה במיגרציה. רלוונטי במיוחד לטבלאות "
                       "שנמחקות מהן שורות (סגירת חשבון, ניקוי תור).",
            metric=float(row["table_kb"]), metric_unit="KB",
            evidence={"constraint": row["constraint_name"]},
        )


def _connections(ctx) -> Iterator[Finding]:
    """חיבורים פתוחים מול התקרה, וחיבורים שנתקעו ב-idle in transaction.

    ‏`idle in transaction` הוא הרוצח השקט: החיבור מחזיק נעילות ומונע
    מ-autovacuum לנקות, והאתר מאט בלי שאף שאילתה תיראה איטית.
    """
    ctx.count()
    row = ctx.db.one(
        """
        select count(*)                                                   as total,
               count(*) filter (where state = 'active')                   as active,
               count(*) filter (where state = 'idle in transaction')      as idle_tx,
               (select setting::int from pg_settings where name = 'max_connections')
                                                                          as max_conn,
               coalesce(max(extract(epoch from (now() - state_change)))
                        filter (where state = 'idle in transaction'), 0)  as idle_tx_sec
          from pg_stat_activity
         where datname = current_database()
        """
    )
    if not row:
        return

    total = int(row["total"] or 0)
    max_conn = int(row["max_conn"] or 1)
    if total / max_conn >= 0.8:
        yield Finding(
            area="health", code="connections_high", severity="high",
            subject="connections",
            title="החיבורים למסד מתקרבים לתקרה",
            detail="%d חיבורים פתוחים מתוך %d." % (total, max_conn),
            suggestion="מעל התקרה, בקשות מהאתר נדחות בשגיאת חיבור. לבדוק אם יש "
                       "תהליך שפותח חיבורים ולא סוגר.",
            metric=float(total), metric_unit="חיבורים",
            evidence={"max_connections": max_conn},
        )

    idle_sec = float(row["idle_tx_sec"] or 0)
    if int(row["idle_tx"] or 0) and idle_sec > 300:
        yield Finding(
            area="performance", code="idle_in_transaction", severity="medium",
            subject="idle_in_transaction",
            title="חיבור תקוע בתוך טרנזקציה",
            detail="%d חיבורים במצב idle in transaction, הוותיק כבר %.0f דקות."
                   % (int(row["idle_tx"]), idle_sec / 60),
            suggestion="חיבור כזה מחזיק נעילות ומונע מ-autovacuum לנקות. האתר "
                       "מאט בלי ששום שאילתה תיראה איטית.",
            metric=idle_sec / 60, metric_unit="דקות",
        )
