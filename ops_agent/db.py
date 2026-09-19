"""החיבור למסד — ובעיקר, מה שהוא **אינו** יכול לעשות.

## הסריקה היא לקריאה בלבד, ברמת המסד

‏`Scanner` נפתח עם `default_transaction_read_only = on`. זו אינה הצהרת
כוונות בתיעוד אלא סירוב של Postgres עצמו: כל `insert`, `update`,
‏`delete` או DDL שיגיע משם ייפול עם `25006`. הסיבה שזה חשוב דווקא כאן:
הסוכן רץ על מסד הפרודקשן, אוטומטית, כל כמה שעות, בלי שאיש קורא את
השאילתות לפני שהן יוצאות. חיבור שיכול לכתוב הוא חיבור שיום אחד יכתוב.

זה גם מה שמקיים את הכלל החשוב ב-CLAUDE.md — **אין להחיל DDL מחוץ
לצינור**. הסוכן פיזית אינו יכול, גם אם ייכתב לו בטעות `create index`
כ"תיקון אוטומטי".

## הכתיבה נפרדת, צרה, ומוגבלת לטבלה אחת

הממצאים חייבים להישמר, ולכן יש `Writer` — חיבור שני, נפתח רק בסוף
הריצה, כותב אך ורק ל-`ops_findings` ו-`ops_scans`, וסוגר. הוא אינו
עובר דרך שום probe.

## ‏statement_timeout ולא "נראה לי שזה מהיר"

כל שאילתת ניטור רצה עם תקרת זמן. שאילתה על `pg_stat_statements` בזמן
עומס יכולה להיתקע, והסוכן הוא האחרון שמותר לו להיות הסיבה לאיטיות
באתר. שאילתה שחורגת נופלת, ה-probe מדווח על כך, והסריקה ממשיכה.
"""

from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Any, Iterator, Sequence

import psycopg2
import psycopg2.extras

log = logging.getLogger(__name__)


class DbError(RuntimeError):
    pass


class Scanner:
    """חיבור קריאה־בלבד לשאילתות הניטור."""

    def __init__(self, dsn: str, statement_timeout_ms: int = 15_000) -> None:
        if not dsn:
            raise DbError("SUPABASE_DB_URL ריק — אין למה להתחבר")
        self._dsn = dsn
        self._timeout = statement_timeout_ms
        self._conn: Any = None

    def connect(self) -> None:
        self._conn = psycopg2.connect(self._dsn, connect_timeout=15)
        self._conn.set_session(readonly=True, autocommit=True)
        with self._conn.cursor() as cur:
            cur.execute("set statement_timeout = %s", (self._timeout,))
            # שם מזוהה בלוגים של המסד. מי שיראה שאילתה מוזרה ב-
            # pg_stat_activity צריך לדעת מיד שזה הסוכן ולא תקלה.
            cur.execute("set application_name = 'ops_agent'")

    def close(self) -> None:
        if self._conn is not None:
            try:
                self._conn.close()
            finally:
                self._conn = None

    def rows(self, sql: str, params: Sequence[Any] | None = None) -> list[dict]:
        """מריצה שאילתה ומחזירה שורות כמילונים. חריגה נזרקת החוצה ל-probe."""
        if self._conn is None:
            raise DbError("אין חיבור פתוח")
        with self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params or ())
            return [dict(r) for r in cur.fetchall()]

    def one(self, sql: str, params: Sequence[Any] | None = None) -> dict | None:
        found = self.rows(sql, params)
        return found[0] if found else None

    def has_table(self, name: str) -> bool:
        """האם הטבלה קיימת ב-public.

        ה-probes מתארים מבנה שנכון **היום**. טבלה שתשתנה שם או תיעלם
        אינה אמורה להפיל סריקה שלמה — היא אמורה לגרום לדילוג שקט על
        הבדיקה הזו בלבד.
        """
        found = self.one(
            "select to_regclass(%s) is not null as ok", ("public." + name,))
        return bool(found and found["ok"])

    def has_column(self, table: str, column: str) -> bool:
        found = self.one(
            """
            select 1 as ok
              from information_schema.columns
             where table_schema = 'public'
               and table_name = %s
               and column_name = %s
            """,
            (table, column),
        )
        return bool(found)


class Writer:
    """חיבור הכתיבה. נפתח בסוף, נוגע בשתי טבלאות, ונסגר."""

    def __init__(self, dsn: str, statement_timeout_ms: int = 15_000) -> None:
        self._dsn = dsn
        self._timeout = statement_timeout_ms

    @contextmanager
    def session(self) -> Iterator[Any]:
        conn = psycopg2.connect(self._dsn, connect_timeout=15)
        try:
            conn.set_session(autocommit=False)
            with conn.cursor() as cur:
                cur.execute("set statement_timeout = %s", (self._timeout,))
                cur.execute("set application_name = 'ops_agent_write'")
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
