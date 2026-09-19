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
    """תור עם שורה ישנה = משהו בצד השני לא רץ.

    כל תור כאן מתאר תכונה שהמשתמש/ת מחכה לה. לכן ההודעה נושאת גם את
    השם הטכני וגם **מה שבור מבחינתו/ה** — "ההדמיה לא נוצרת" ולא
    "‏visualization_jobs pending".
    """
    t = ctx.settings.thresholds
    for table, status_col, pending, time_col, label, breaks in QUEUES:
        if not ctx.db.has_table(table):
            continue
        ctx.count()
        row = ctx.db.one(
            """
            select count(*) as stuck,
                   min({time_col}) as oldest,
                   round(extract(epoch from (now() - min({time_col}))) / 3600.0, 1)
                     as age_hours
              from public.{table}
             where {status_col} = any(%s)
               and {time_col} < now() - make_interval(hours => %s)
            """.format(table=table, status_col=status_col, time_col=time_col),
            (list(pending), t.queue_stuck_hours),
        )
        stuck = int((row or {}).get("stuck") or 0)
        if not stuck:
            continue

        age = float((row or {}).get("age_hours") or 0)
        severity = "high"
        if age >= t.queue_stuck_critical_hours or stuck >= t.queue_stuck_critical_rows:
            severity = "critical"

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
    for table, time_col, label, workflow in ENGINES:
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
        if silent < t.engine_silence_hours:
            continue
        yield Finding(
            area="health", code="engine_silent", severity="high",
            subject=table,
            title="מנוע ששתק: %s" % label,
            detail="לא נכנסה שורה חדשה כבר %.0f שעות." % silent,
            suggestion="שלוש סיבות אפשריות, וכולן נראות זהה: הפיד נשבר, הסוד פג, "
                       "או ש-%s כבוי. להתחיל מלשונית Actions." % workflow,
            metric=silent, metric_unit="שעות",
            evidence={"last_row": (row or {}).get("last_row"), "workflow": workflow},
        )


# ---------------------------------------------------------------- שאילתות

def _slow_queries(ctx) -> Iterator[Finding]:
    """‏pg_stat_statements — מי באמת אוכל את המסד.

    שני ממצאים שונים מאותו מקור, ובכוונה:

    * **איטית** — ממוצע גבוה. זה מה שהמשתמש/ת מרגיש/ה.
    * **כבדה** — סך זמן גבוה. זו מה שמייקרת את החשבון, גם אם כל קריאה
      בודדת נראית סבירה. שאילתה של 10ms שרצה 200 אלף פעם היא הבעיה
      הגדולה יותר, והיא זו שלא מופיעה בשום דוח "שאילתות איטיות".
    """
    t = ctx.settings.thresholds
    ctx.count()
    try:
        rows = ctx.db.rows(
            """
            select calls,
                   round(mean_exec_time::numeric, 1)          as mean_ms,
                   round((total_exec_time / 1000)::numeric, 1) as total_sec,
                   round(rows::numeric / greatest(calls, 1), 1) as rows_per_call,
                   left(regexp_replace(query, '\\s+', ' ', 'g'), 200) as sample,
                   md5(query)                                  as fingerprint
              from extensions.pg_stat_statements
             where query not ilike '%%pg_stat_statements%%'
               and query not ilike '%%ops_agent%%'
               and calls >= %s
             order by total_exec_time desc
             limit 40
            """,
            (t.slow_query_min_calls,),
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

    for row in rows[:10]:
        mean_ms = float(row["mean_ms"] or 0)
        total_sec = float(row["total_sec"] or 0)
        calls = int(row["calls"] or 0)
        fp = str(row["fingerprint"])[:12]

        if mean_ms >= t.slow_query_mean_ms:
            yield Finding(
                area="performance", code="slow_query",
                severity="high" if mean_ms >= t.slow_query_mean_ms * 5 else "medium",
                subject="query_" + fp,
                title="שאילתה איטית — ממוצע %.0fms" % mean_ms,
                detail="%d קריאות, ממוצע %.1fms, סך הכל %.0f שניות."
                       % (calls, mean_ms, total_sec),
                suggestion="להריץ explain analyze על השאילתה. ממוצע גבוה עם הרבה "
                           "קריאות הוא בדרך כלל אינדקס חסר או policy של RLS "
                           "שמחושב לכל שורה.",
                metric=mean_ms, metric_unit="ms",
                evidence={"calls": calls, "total_sec": total_sec,
                          "rows_per_call": float(row["rows_per_call"] or 0),
                          "query": row["sample"]},
            )
        elif total_sec >= t.heavy_query_total_sec:
            yield Finding(
                area="cost", code="heavy_query", severity="medium",
                subject="query_" + fp,
                title="שאילתה שצורכת את רוב זמן המסד",
                detail="%.0f שניות מצטברות על פני %d קריאות (ממוצע %.1fms בלבד)."
                       % (total_sec, calls, mean_ms),
                suggestion="כל קריאה נראית זולה, ולכן היא לא מופיעה בשום דוח "
                           "'שאילתות איטיות'. השאלה כאן אינה כמה היא לוקחת אלא "
                           "האם צריך לקרוא לה כל כך הרבה.",
                metric=total_sec, metric_unit="שניות",
                evidence={"calls": calls, "mean_ms": mean_ms, "query": row["sample"]},
            )


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
