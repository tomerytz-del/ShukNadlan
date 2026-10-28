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


class MigrationFailed(Exception):
    pass


def fail(msg: str) -> None:
    print(f"✗ {msg}", file=sys.stderr)
    raise SystemExit(1)


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


def psql_error_lines(stderr: str) -> list[str]:
    """psql -f מקדים כל שגיאה ב-psql:<stdin>:N: ולא בשורה שמתחילה ב-ERROR."""
    found = []
    for ln in stderr.splitlines():
        if ": ERROR:" in ln or ln.startswith("ERROR:"):
            found.append(ln)
    return found


def meta_command_lines(sql: str) -> list[int]:
    """שורות ש-psql היה מריץ כפקודת meta, מחוץ למחרוזת ולהערה.

    db push לא מריץ \\! ו-\\c. שורה כזו נחסמת לפני שהקובץ מגיע ל-psql,
    כדי שלא ייקרא environ של התהליך.
    """
    hits: list[int] = []
    i, n = 0, len(sql)
    line = 1
    dollar = None
    in_squote = False
    in_line_comment = False
    in_block = False
    at_line_start = True
    while i < n:
        c = sql[i]
        if c == "\n":
            line += 1
            i += 1
            in_line_comment = False
            at_line_start = True
            continue
        if in_line_comment:
            i += 1
            continue
        if in_block:
            if sql.startswith("*/", i):
                in_block = False
                i += 2
            else:
                i += 1
            at_line_start = False
            continue
        if dollar:
            if sql.startswith(dollar, i):
                i += len(dollar)
                dollar = None
            else:
                i += 1
            at_line_start = False
            continue
        if in_squote:
            if c == "'" and sql.startswith("''", i):
                i += 2
                continue
            if c == "'":
                in_squote = False
            i += 1
            at_line_start = False
            continue
        if c in " \t\r":
            i += 1
            continue
        if at_line_start and c == "\\" :
            hits.append(line)
            while i < n and sql[i] != "\n":
                i += 1
            continue
        at_line_start = False
        if sql.startswith("--", i):
            in_line_comment = True
            i += 2
            continue
        if sql.startswith("/*", i):
            in_block = True
            i += 2
            continue
        if c == "'":
            in_squote = True
            i += 1
            continue
        if c == "$":
            m = re.match(r"\$[A-Za-z0-9_]*\$", sql[i:])
            if m:
                dollar = m.group(0)
                i += len(dollar)
                continue
        i += 1
    return hits


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
    if env.get("PGHOST") or env.get("PGUSER") or env.get("PGOPTIONS") or env.get("PGPASSWORD"):
        fail("יעד מרוחק נשאר בסביבת ההחלה המקומית")
    penv = prod_env("postgresql://prod.example/db")
    if READ_ONLY not in penv.get("PGOPTIONS", ""):
        fail("חיבור הפרודקשן אינו לקריאה בלבד")
    canned = "psql:<stdin>:1: ERROR:  syntax error at or near \"SELEC\"\npsql:<stdin>:3: ERROR:  relation \"t_dup\" already exists\n"
    parsed = psql_error_lines(canned)
    if len(parsed) != 2 or not any("syntax error" in ln.lower() for ln in parsed):
        fail(f"קידומת psql:<stdin> לא נספרה: {parsed}")
    if meta_command_lines("select 1;\n\\! echo hi\n") != [2]:
        fail("\\! בתחילת שורה לא נחסם")
    if meta_command_lines("select 1;\n  \\c other\n") != [2]:
        fail("\\c מוזח לא נחסם")
    if meta_command_lines("do $$\nbegin\n  perform 1;\nend\n$$;\n"):
        fail("גוף פונקציה סומן כפקודת psql")
    if meta_command_lines("select '\\! echo hi';\n"):
        fail("backslash בתוך מחרוזת סומן כפקודת psql")
    if meta_command_lines("do $$\n\\! echo hi\n$$;\n"):
        fail("backslash בתוך dollar quote סומן כפקודת psql")
    assert_restore_and_apply_fail()
    print("✓ סינון ה-dump")
    print("✓ ההחלה המקומית בלי כתובת פרודקשן, והקריאה אליו ב-read-only")
    print("✓ שגיאת psql:<stdin> נספרת, והחלה שנכשלת מתגלגלת לאחור")


def assert_restore_and_apply_fail() -> None:
    """משחזר SQL שבור על Postgres אמיתי ובודק שהשגיאה נספרת ושההחלה נכשלת."""
    db = "migration_apply_parse_test"
    env = local_env()
    run(["dropdb", "--if-exists", db], env=env)
    proc = run(["createdb", db], env=env)
    if proc.returncode != 0:
        fail(f"createdb לבדיקה נכשל:\n{proc.stderr[-400:]}")
    broken = "SELEC 1;\nCREATE TABLE t_dup (id int);\nCREATE TABLE t_dup (id int);\n"
    probe = run(
        ["psql", "-v", "ON_ERROR_STOP=0", "-q", "-d", db, "-f", "-"],
        input_text=broken,
        env=env,
    )
    errors = psql_error_lines(probe.stderr)
    if len(errors) < 2 or not any("syntax error" in ln.lower() for ln in errors):
        fail(f"restore לא ראה את שגיאות psql:\n{probe.stderr}")
    try:
        restore(db, "SELEC 1;\n")
    except MigrationFailed as exc:
        if "syntax error" not in str(exc).lower():
            fail(f"restore נכשל בלי שגיאת התחביר: {exc}")
    else:
        fail("restore לא נכשל על שגיאת תחביר")
    bad = Path("/tmp/migration_apply_bad.sql")
    bad.write_text("CREATE TABLE rolled (id int);\nSELEC 1;\n", encoding="utf-8")
    try:
        apply_files(db, [bad])
    except MigrationFailed as exc:
        if "syntax error" not in str(exc).lower():
            fail(f"apply_files נכשל בלי שגיאת התחביר: {exc}")
    else:
        fail("apply_files לא נכשל")
    left = run(
        ["psql", "-Atq", "-d", db, "-c", "select to_regclass('public.rolled')"],
        env=env,
    )
    if left.stdout.strip() not in ("", "null"):
        fail(f"הטרנזקציה לא התגלגלה לאחור: {left.stdout!r}")
    run(["dropdb", "--if-exists", db], env=env)


def run(cmd: list[str], *, input_text: str | None = None, env: dict | None = None, timeout: int = 600) -> subprocess.CompletedProcess[str]:
    # stdin סגור כשאין קלט, כדי שבקשת סיסמה לא תחכה בלי סוף.
    kwargs: dict = {"text": True, "capture_output": True, "env": env, "timeout": timeout}
    if input_text is None:
        kwargs["stdin"] = subprocess.DEVNULL
    else:
        kwargs["input"] = input_text
    return subprocess.run(cmd, **kwargs)


def prod_env(url: str) -> dict:
    """סביבה ל-psql ול-pg_dump מול הפרודקשן. קריאה בלבד."""
    env = os.environ.copy()
    env["PGURL"] = url
    prev = env.get("PGOPTIONS", "")
    env["PGOPTIONS"] = f"{prev} {READ_ONLY}".strip()
    return env


def _local_target() -> dict[str, str]:
    """יעד מקומי בלבד. מארח מרוחק נזרק. בלי PGHOST נשאר הסוקט."""
    host = os.environ.get("PGHOST", "")
    kept: dict[str, str] = {"PGCONNECT_TIMEOUT": "5"}
    if host in ("localhost", "127.0.0.1", "::1", "/var/run/postgresql"):
        kept["PGHOST"] = host
        if os.environ.get("PGPORT"):
            kept["PGPORT"] = os.environ["PGPORT"]
        if os.environ.get("PGUSER"):
            kept["PGUSER"] = os.environ["PGUSER"]
    return kept


def local_env() -> dict:
    """ההחלה המקומית לא יורשת כתובת פרודקשן.

    מיגרציה עם \\! או \\c רצה ב-psql, והסביבה של התהליך זמינה לפקודה.
    בלי SUPABASE_DB_URL וכל משתני PG* אין לאן להתחבר מלבד Postgres מקומי.
    """
    env = os.environ.copy()
    for key in list(env):
        if key in ("SUPABASE_DB_URL", "PGURL", "DATABASE_URL") or key.startswith("PG"):
            del env[key]
    env.update(_local_target())
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
    errors = psql_error_lines(proc.stderr)
    # שגיאות של הרחבה חסרה או של owner אינן עוצרות. שגיאת תחביר בסכימה כן.
    fatal = [ln for ln in errors if "syntax error" in ln.lower()]
    if fatal:
        raise MigrationFailed("שחזור הסכימה נעצר על תחביר:\n" + "\n".join(fatal[:20]))
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


def reject_meta_commands(files: list[Path]) -> None:
    for path in files:
        hits = meta_command_lines(path.read_text(encoding="utf-8"))
        if hits:
            fail(
                f"{path.name} שורה {hits[0]} מתחילה בפקודת psql (\\). "
                "db push לא מריץ אותן, והן נחסמות כדי שלא ייקרא environ."
            )


def apply_files(db: str, files: list[Path]) -> None:
    reject_meta_commands(files)
    for path in files:
        print(f"מחיל {path.name}", flush=True)
        sql = path.read_text(encoding="utf-8")
        # אותה יחידה כמו db push: קובץ אחד, טרנזקציה אחת, עצירה בשגיאה הראשונה.
        proc = run(
            ["psql", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-q", "-d", db, "-f", "-"],
            input_text=sql,
            env=local_env(),
            timeout=900,
        )
        if proc.returncode != 0:
            err = proc.stderr[-2500:]
            raise MigrationFailed(f"{path.name} נכשלה:\n{err}")
    print(f"✓ {len(files)} מיגרציות שעוד לא בפרודקשן עברו על Postgres")


def marker_dir() -> Path:
    path = Path(os.environ.get("MIGRATION_APPLY_DIR", "/tmp/migration-apply-ci"))
    path.mkdir(parents=True, exist_ok=True)
    return path


def gh_output(key: str, value: str) -> None:
    path = os.environ.get("GITHUB_OUTPUT")
    if not path:
        return
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(f"{key}={value}\n")


def scrub_process_env() -> None:
    """מוציא את כתובת הפרודקשן מ-environ של התהליך עצמו, לא רק של הבן.

    \\! cat /proc/<pid>/environ קורא את האב. מחיקה כאן משאירה רק יעד מקומי.
    """
    kept = _local_target()
    for key in list(os.environ):
        if key in ("SUPABASE_DB_URL", "PGURL", "DATABASE_URL") or key.startswith("PG"):
            del os.environ[key]
    os.environ.update(kept)


def skip_without_secret() -> None:
    if os.environ.get("FORK_PR") == "true":
        why = "PR מ-fork אינו מקבל סודות"
    else:
        why = "אין SUPABASE_DB_URL (Dependabot, או שהסוד לא הועבר לריצה)"
    print(f"{why}. הבדיקה דולגת ולא נכשלת.")
    print("כדי להריץ אותה צריך את הסוד על ענף בריפו הזה.")
    gh_output("apply", "false")
    (marker_dir() / "apply").write_text("false", encoding="utf-8")


def fetch() -> int:
    raw = os.environ.get("SUPABASE_DB_URL", "")
    if not raw.strip():
        skip_without_secret()
        return 0
    url = clean_url(raw)
    applied = versions_from_prod(url)
    print(f"בפרודקשן רשומות {len(applied)} מיגרציות")
    files = pending_files(set(applied))
    folder = marker_dir()
    if not files:
        print("✓ אין מיגרציה שלא רשומה בפרודקשן")
        gh_output("apply", "false")
        (folder / "apply").write_text("false", encoding="utf-8")
        return 0
    print("ממתינות: " + ", ".join(p.name.split("_", 1)[0] for p in files))
    reject_meta_commands(files)
    (folder / "dump.sql").write_text(filter_dump(dump_public(url)), encoding="utf-8")
    (folder / "pending.txt").write_text(
        "\n".join(str(p) for p in files) + "\n", encoding="utf-8"
    )
    (folder / "apply").write_text("true", encoding="utf-8")
    gh_output("apply", "true")
    return 0


def apply_local() -> int:
    scrub_process_env()
    if "SUPABASE_DB_URL" in os.environ or "PGURL" in os.environ or "DATABASE_URL" in os.environ:
        fail("ההחלה המקומית עדיין רואה כתובת פרודקשן")
    folder = marker_dir()
    flag = folder / "apply"
    if not flag.is_file() or flag.read_text(encoding="utf-8").strip() != "true":
        print("אין מה להחיל מקומית")
        return 0
    files = [Path(ln) for ln in (folder / "pending.txt").read_text(encoding="utf-8").splitlines() if ln.strip()]
    reject_meta_commands(files)
    db = scratch_db()
    restore(db, (folder / "dump.sql").read_text(encoding="utf-8"))
    apply_files(db, files)
    return 0


def main() -> int:
    try:
        if "--self-test" in sys.argv:
            self_test()
            return 0
        if "--fetch" in sys.argv:
            return fetch()
        if "--apply-local" in sys.argv:
            return apply_local()
        # הרצה מקומית אחת: המשיכה עם הסוד, ואז מחיקתו לפני שה-SQL רץ.
        code = fetch()
        if code != 0:
            return code
        return apply_local()
    except MigrationFailed as exc:
        fail(str(exc))
        return 1


if __name__ == "__main__":
    sys.exit(main())
