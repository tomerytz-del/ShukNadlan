#!/usr/bin/env python3
"""מחיל על Postgres מקומי את המיגרציות שהפרודקשן עוד לא רשם.

הסכימה מגיעה מ-pg_dump --schema-only של הפרודקשן (בלי שורות). אחר כך
רצים, לפי הסדר, רק קבצים שה-version שלהם אינו ב-schema_migrations.
כך נתפסת שגיאת תחביר כמו normalize(..., 'NFKC') לפני db push לפרודקשן.

הסקריפט לא כותב לפרודקשן. החיבור אליו רץ עם
default_transaction_read_only, וההחלה המקומית לא רואה את כתובת
הפרודקשן. עדיף משתמש מסד שמותר לו רק SELECT: הדגל לא עוצר פקודת
psql כמו \\! או \\c, והסרת המשתנה מהסביבה כן.

  python3 scripts/apply_pending_migrations.py
  python3 scripts/apply_pending_migrations.py --self-test
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MIG_DIR = ROOT / "supabase" / "migrations"
# הרחבות שיש ב-postgres:17 בלי ספרייה חיצונית. pg_cron, pg_net ו-vault
# אין בתמונה, והמיגרציות החדשות בודקות את pg_cron לפני schedule.
DROP_EXTENSIONS = {"pg_cron", "pg_net", "supabase_vault", "pg_stat_statements", "pgjwt", "pgsodium", "pg_graphql"}
# כתיבה לפרודקשן חסומה בשכבת הטרנזקציה. משתמש ייעודי לקריאה עדיף,
# כי PGOPTIONS לא עוצר \\! ו-\\c של psql.
READ_ONLY = "-c default_transaction_read_only=on"


def fail(msg: str) -> None:
    print(f"✗ {msg}", file=sys.stderr)
    sys.exit(1)


def clean_url(raw: str) -> str:
    text = raw.strip().strip('"').strip("'")
    text = re.sub(r"[\u200b-\u200f\u202a-\u202e\ufeff]", "", text)
    text = text.replace("\u00a0", " ").strip()
    if not text.startswith(("postgresql://", "postgres://")):
        fail("SUPABASE_DB_URL אינו מתחיל ב-postgresql://")
    return text


def filter_dump(sql: str) -> str:
    """מוריד הרחבות שאין בתמונת Postgres הרגילה, ופקודות psql חדשות."""
    out = []
    for line in sql.splitlines(keepends=True):
        stripped = line.strip()
        if stripped.startswith("\\restrict") or stripped.startswith("\\unrestrict"):
            continue
        m = re.match(
            r"(?i)create\s+extension(?:\s+if\s+not\s+exists)?\s+(?:public\.)?\"?([a-z0-9_]+)\"?",
            stripped,
        )
        if m and m.group(1).lower() in DROP_EXTENSIONS:
            continue
        if re.match(r"(?i)comment\s+on\s+extension\s+", stripped):
            name = re.sub(r'(?i)comment\s+on\s+extension\s+"?', "", stripped).split()[0].strip('";')
            if name.lower() in DROP_EXTENSIONS:
                continue
        out.append(line)
    return "".join(out)


def self_test() -> None:
    sample = """\
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA public;
COMMENT ON EXTENSION pg_cron IS 'cron';
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
\\restrict abc
CREATE TABLE public.t (id int);
\\unrestrict abc
"""
    got = filter_dump(sample)
    if "pg_cron" in got:
        fail("הסינון השאיר pg_cron")
    if "pgcrypto" not in got or "CREATE TABLE public.t" not in got:
        fail("הסינון מחק שורות שצריך לשמור")
    if "\\restrict" in got or "\\unrestrict" in got:
        fail("הסינון השאיר פקודות restrict")
    saved = {k: os.environ.get(k) for k in ("SUPABASE_DB_URL", "PGURL", "PGPASSWORD", "PGOPTIONS", "PGHOST")}
    os.environ["SUPABASE_DB_URL"] = "postgresql://prod.example/db"
    os.environ["PGURL"] = "postgresql://prod.example/db"
    os.environ["PGPASSWORD"] = "secret"
    os.environ["PGOPTIONS"] = READ_ONLY
    os.environ["PGHOST"] = "db.example"
    env = local_env()
    for key, val in saved.items():
        if val is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = val
    if any(k in env for k in ("SUPABASE_DB_URL", "PGURL", "PGPASSWORD", "DATABASE_URL")):
        fail("סביבת ההחלה המקומית עדיין רואה את הפרודקשן")
    if env.get("PGHOST") != "localhost" or env.get("PGOPTIONS"):
        fail("החיבור המקומי לא נשאר על localhost בלי PGOPTIONS")
    penv = prod_env("postgresql://prod.example/db")
    if READ_ONLY not in penv.get("PGOPTIONS", ""):
        fail("חיבור הפרודקשן אינו לקריאה בלבד")
    print("✓ סינון ה-dump")
    print("✓ ההחלה המקומית בלי כתובת פרודקשן, והקריאה אליו ב-read-only")


def run(cmd: list[str], *, input_text: str | None = None, env: dict | None = None, timeout: int = 600) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        input=input_text,
        text=True,
        capture_output=True,
        env=env,
        timeout=timeout,
    )


def prod_env(url: str) -> dict:
    """סביבה ל-psql ול-pg_dump מול הפרודקשן. קריאה בלבד."""
    env = os.environ.copy()
    env["PGURL"] = url
    prev = env.get("PGOPTIONS", "")
    env["PGOPTIONS"] = f"{prev} {READ_ONLY}".strip()
    return env


def local_env() -> dict:
    """ההחלה המקומית לא יורשת כתובת פרודקשן.

    מיגרציה עם \\! או \\c רצה ב-psql, והסביבה של התהליך זמינה לפקודה.
    בלי SUPABASE_DB_URL וכל משתני PG* אין לאן להתחבר מלבד ה-Postgres המקומי.
    """
    env = os.environ.copy()
    for key in list(env):
        if key in ("SUPABASE_DB_URL", "PGURL", "DATABASE_URL") or key.startswith("PG"):
            del env[key]
    env["PGHOST"] = "localhost"
    env["PGPORT"] = "5432"
    env["PGUSER"] = "postgres"
    return env


def psql_scratch(sql: str, db: str) -> subprocess.CompletedProcess[str]:
    return run(
        ["psql", "-v", "ON_ERROR_STOP=1", "-q", "-d", db, "-f", "-"],
        input_text=sql,
        env=local_env(),
    )


def versions_from_prod(url: str) -> list[str]:
    env = prod_env(url)
    # המחרוזת במשתנה, לא בארגומנט: ארגומנט מופיע בלוג כשהפקודה נכשלת.
    proc = run(
        ["sh", "-c",
         "psql -v ON_ERROR_STOP=1 -Atq \"$PGURL\" -c "
         "\"select version from supabase_migrations.schema_migrations order by version\""],
        env=env,
    )
    if proc.returncode != 0:
        err = proc.stderr[-1500:]
        err = re.sub(r"postgres(?:ql)?://\S+", "postgresql://…", err)
        fail(f"קריאת schema_migrations נכשלה:\n{err}")
    return [ln.strip() for ln in proc.stdout.splitlines() if ln.strip()]


def dump_public(url: str) -> str:
    env = prod_env(url)
    # pg_dump בגרסת השרת (17). הלקוח של ubuntu-latest ישן ממנו.
    # PGOPTIONS נכנס לקונטיינר יחד עם PGURL, כדי שההפעלה תהיה לקריאה בלבד.
    proc = run(
        [
            "docker", "run", "--rm", "--network", "host",
            "-e", "PGURL", "-e", "PGOPTIONS",
            "postgres:17",
            "sh", "-c",
            "pg_dump --schema-only --no-owner --no-acl --schema=public \"$PGURL\"",
        ],
        env=env,
        timeout=900,
    )
    if proc.returncode != 0:
        err = proc.stderr[-2000:]
        err = re.sub(r"postgres(?:ql)?://\S+", "postgresql://…", err)
        fail(f"pg_dump נכשל:\n{err}")
    if "CREATE " not in proc.stdout and "create " not in proc.stdout.lower():
        fail("pg_dump החזיר סכימה ריקה")
    return proc.stdout


def scratch_db() -> str:
    name = os.environ.get("MIGRATION_APPLY_DB", "migration_apply_ci")
    env = local_env()
    run(["dropdb", "--if-exists", name], env=env)
    proc = run(["createdb", name], env=env)
    if proc.returncode != 0:
        fail(f"createdb נכשל:\n{proc.stderr[-500:]}")
    prelude = """
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then create role supabase_admin nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select ''::text $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
"""
    proc = psql_scratch(prelude, name)
    if proc.returncode != 0:
        fail(f"הכנת התפקידים נכשלה:\n{proc.stderr[-1500:]}")
    return name


def restore(db: str, sql: str) -> None:
    proc = run(
        ["psql", "-v", "ON_ERROR_STOP=0", "-q", "-d", db, "-f", "-"],
        input_text=sql,
        env=local_env(),
        timeout=900,
    )
    errors = [ln for ln in proc.stderr.splitlines() if ln.startswith("ERROR")]
    # שגיאות של הרחבה חסרה או של owner אינן עוצרות. שגיאת תחביר בסכימה כן.
    fatal = [ln for ln in errors if "syntax error" in ln.lower()]
    if fatal:
        fail("שחזור הסכימה נעצר על תחביר:\n" + "\n".join(fatal[:20]))
    print(f"שחזור הסכימה: {len(errors)} שגיאות (הרחבות ואובייקטים שאין בתמונה נספרים, לא עוצרים)")
    shown = errors[:30]
    if shown:
        print("שגיאות השחזור הראשונות:")
        print("\n".join(shown))
    if len(errors) > 30:
        print(f"... ועוד {len(errors) - 30}")


def pending_files(applied: set[str]) -> list[Path]:
    files = []
    for path in sorted(MIG_DIR.glob("*.sql")):
        ver = path.name.split("_", 1)[0]
        if ver.isdigit() and ver not in applied:
            files.append(path)
    return files


def apply_files(db: str, files: list[Path]) -> None:
    for path in files:
        print(f"מחיל {path.name}", flush=True)
        sql = path.read_text(encoding="utf-8")
        proc = run(
            ["psql", "-v", "ON_ERROR_STOP=1", "-q", "-d", db, "-f", "-"],
            input_text=sql,
            env=local_env(),
            timeout=900,
        )
        if proc.returncode != 0:
            err = proc.stderr[-2500:]
            fail(f"{path.name} נכשלה:\n{err}")
    print(f"✓ {len(files)} מיגרציות שעוד לא בפרודקשן עברו על Postgres")


def main() -> int:
    if "--self-test" in sys.argv:
        self_test()
        return 0
    self_test()
    raw = os.environ.get("SUPABASE_DB_URL", "")
    if not raw.strip():
        # ל-PR מ-fork אין סודות. כישלון כאן היה חוסם כל מיזוג כזה בלי סיבה
        # שאפשר לתקן מתוך ה-fork.
        if os.environ.get("FORK_PR") == "true":
            print("PR מ-fork אינו מקבל את SUPABASE_DB_URL. הבדיקה דולגת ולא נכשלת.")
            print("כדי להריץ אותה, פותחים את הענף בריפו הזה.")
            return 0
        fail("SUPABASE_DB_URL ריק. בלי הסכימה מהפרודקשן אי אפשר להחיל את המיגרציות החסרות.")
    url = clean_url(raw)
    applied = versions_from_prod(url)
    print(f"בפרודקשן רשומות {len(applied)} מיגרציות")
    files = pending_files(set(applied))
    if not files:
        print("✓ אין מיגרציה שלא רשומה בפרודקשן")
        return 0
    print("ממתינות: " + ", ".join(p.name.split("_", 1)[0] for p in files))
    dump = filter_dump(dump_public(url))
    db = scratch_db()
    restore(db, dump)
    apply_files(db, files)
    return 0


if __name__ == "__main__":
    sys.exit(main())
