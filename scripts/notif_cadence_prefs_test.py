#!/usr/bin/env python3
"""שמירת העדפות התראות כמו ה-upsert של crm-settings.js, בתפקיד authenticated.

רץ אחרי החלת המיגרציות על Postgres המקומי (migration_apply.yml).
בודק שהשורה נשמרת גם כשהדגל כבוי, ושסוכן/ת לא יכול/ה לכתוב קצב של אחר/ת.
"""
from __future__ import annotations

import os
import sys
import uuid

import psycopg


def fail(msg: str) -> None:
    print(f"✗ {msg}")
    sys.exit(1)


def filler(cur, data_type: str, udt: str, name: str):
    if name == "id" or data_type == "uuid":
        return str(uuid.uuid4())
    if data_type in ("text", "character varying"):
        return "t-" + uuid.uuid4().hex[:12]
    if data_type == "boolean":
        return False
    if data_type in ("integer", "bigint", "smallint", "numeric", "real", "double precision"):
        return 0
    if data_type == "ARRAY":
        return []
    if data_type == "jsonb" or data_type == "json":
        return {}
    if "timestamp" in data_type:
        return "2026-01-01T00:00:00Z"
    if data_type == "USER-DEFINED":
        cur.execute(
            """
            select e.enumlabel
              from pg_enum e
              join pg_type t on t.oid = e.enumtypid
             where t.typname = %s
             order by e.enumsortorder
             limit 1
            """,
            (udt,),
        )
        row = cur.fetchone()
        if row:
            return row[0]
    return None


def insert_min(cur, table: str, forced: dict) -> dict:
    cur.execute(
        """
        select column_name, data_type, udt_name, is_nullable, column_default, is_identity
          from information_schema.columns
         where table_schema = 'public' and table_name = %s
         order by ordinal_position
        """,
        (table,),
    )
    cols = cur.fetchall()
    values = dict(forced)
    for name, data_type, udt, nullable, default, identity in cols:
        if name in values:
            continue
        if nullable == "YES" or default is not None or identity == "YES":
            continue
        value = filler(cur, data_type, udt, name)
        if value is None:
            fail(f"אין ערך לעמודה חובה {table}.{name} ({data_type})")
        values[name] = value
    names = list(values)
    placeholders = ", ".join(["%s"] * len(names))
    collist = ", ".join(names)
    cur.execute(
        f"insert into public.{table} ({collist}) values ({placeholders})",
        [values[n] for n in names],
    )
    return values


def main() -> int:
    db = os.environ.get("MIGRATION_APPLY_DB", "migration_apply_ci")
    conn = psycopg.connect(
        host=os.environ.get("PGHOST", "localhost"),
        user=os.environ.get("PGUSER", "postgres"),
        dbname=db,
    )
    conn.autocommit = False
    cur = conn.cursor()
    try:
        cur.execute(
            """
            select 1 from pg_proc p
              join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'notif_cadence_since_ok'
            """
        )
        if cur.fetchone() is None:
            fail("notif_cadence_since_ok חסרה. המיגרציה לא הוחלה.")

        cur.execute(
            """
            create or replace function public.current_agent_id() returns uuid
            language sql stable as $$
              select nullif(current_setting('test.agent', true), '')::uuid
            $$
            """
        )
        cur.execute("grant execute on function public.current_agent_id() to authenticated")
        cur.execute("set local session_replication_role = replica")
        me = insert_min(cur, "agency_members", {"id": str(uuid.uuid4())})
        other = insert_min(cur, "agency_members", {"id": str(uuid.uuid4())})
        cur.execute("set local session_replication_role = origin")
        for col, val in (
            ("tier", "mid"),
            ("billing_status", "active"),
            ("active", True),
            ("closed_at", None),
            ("closure_requested_at", None),
        ):
            cur.execute(
                """
                select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'agency_members' and column_name = %s
                """,
                (col,),
            )
            if cur.fetchone():
                cur.execute(f"update public.agency_members set {col} = %s where id = %s", (val, me["id"]))
                cur.execute(f"update public.agency_members set {col} = %s where id = %s", (val, other["id"]))

        cur.execute("select set_config('test.agent', %s, true)", (me["id"],))
        cur.execute("select set_config('request.jwt.claims', '{\"role\":\"authenticated\"}', true)")
        cur.execute("set local role authenticated")
        upsert = """
          insert into public.agent_notification_preferences
            (agent_id, muted_types, whatsapp_off_types, updated_at)
          values (%s, '{}'::text[], '{}'::text[], now())
          on conflict (agent_id) do update set
            agent_id = excluded.agent_id,
            muted_types = excluded.muted_types,
            whatsapp_off_types = excluded.whatsapp_off_types,
            updated_at = excluded.updated_at
        """
        cur.execute(upsert, (me["id"],))
        cur.execute(upsert, (me["id"],))
        cur.execute("reset role")
        cur.execute(
            "select muted_types, whatsapp_off_types from public.agent_notification_preferences where agent_id = %s",
            (me["id"],),
        )
        row = cur.fetchone()
        if row is None:
            fail("ה-upsert של הסוכן/ת לא שמר שורה")

        cur.execute(
            "select enabled from public.notif_cadence_apply(%s, 'new_leads', 'choose', 'each')",
            (other["id"],),
        )
        enabled = cur.fetchone()[0]
        cur.execute("select count(*) from public.notif_cadence_log where agent_id = %s", (other["id"],))
        stolen = cur.fetchone()[0]
        if enabled or stolen:
            fail(f"סוכן/ת כתב/ה קצב של אחר/ת (enabled={enabled}, rows={stolen})")

        cur.execute(
            "select enabled from public.notif_cadence_apply(%s, 'new_leads', 'open', null)",
            (me["id"],),
        )
        cur.fetchone()
        cur.execute("select count(*) from public.notif_cadence_log where agent_id = %s", (me["id"],))
        if cur.fetchone()[0] < 1:
            fail("קצב של הסוכן/ת עצמו/ה לא נרשם")

        cur.execute("select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true)")
        cur.execute(
            "select enabled from public.notif_cadence_apply(%s, 'new_leads', 'open', null)",
            (other["id"],),
        )
        cur.fetchone()
        cur.execute("select count(*) from public.notif_cadence_log where agent_id = %s", (other["id"],))
        if cur.fetchone()[0] < 1:
            fail("service_role לא יכול לכתוב קצב של סוכן/ת")

        cur.execute("rollback")
    except Exception as exc:
        conn.rollback()
        fail(str(exc))
    finally:
        cur.close()
        conn.close()
    print("✓ upsert של העדפות כ-authenticated, וקצב רק של הסוכן/ת עצמו/ה")
    return 0


if __name__ == "__main__":
    sys.exit(main())
