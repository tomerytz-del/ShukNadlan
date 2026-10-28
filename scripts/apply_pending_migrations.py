#!/usr/bin/env python3
"""מחיל על Postgres מקומי את המיגרציות שהפרודקשן עוד לא רשם.

הסכימה מגיעה מ-pg_dump --schema-only של הפרודקשן (בלי שורות). אחר כך
רצים, לפי הסדר, רק קבצים שה-version שלהם אינו ב-schema_migrations.
כך נתפסת שגיאת תחביר כמו normalize(..., 'NFKC') לפני db push לפרודקשן.

הסקריפט לא כותב לפרודקשן. החיבור אליו רץ עם
default_transaction_read_only. ההחלה המקומית היא simple query דרך
psycopg (כמו db push), בלי פקודות meta של psql, ובתהליך בלי כתובת
הפרודקשן. הלקסר נשאר רק כלינט: אם לא ברור אם $ פותח ציטוט, שתי
הקריאות נבדקות, ודי שפקודת backslash גלויה באחת מהן כדי לחסום.

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


# שחזור הסכימה בריצה 40707160525 (PR #1063, 14 שגיאות) וגם ב-40706127898
# נתן רק את שתי אלה: public כבר קיים אחרי createdb, ומפתחות זרים ל-auth.users
# שה-dump של public לא מביא. כל שגיאה אחרת עוצרת.
RESTORE_ALLOWED_ERRORS = (
    'schema "public" already exists',
    'relation "auth.users" does not exist',
)


def restore_error_allowed(line: str) -> bool:
    return any(piece in line for piece in RESTORE_ALLOWED_ERRORS)


def psql_error_lines(stderr: str) -> list[str]:
    """psql -f מקדים כל שגיאה ב-psql:<stdin>:N: ולא בשורה שמתחילה ב-ERROR."""
    found = []
    for ln in stderr.splitlines():
        if ": ERROR:" in ln or ln.startswith("ERROR:"):
            found.append(ln)
    return found


def _ident_char(c: str) -> bool:
    """המשך מזהה כמו ident_cont של Postgres: אות, ספרה, _, $, וכל תו מעל ASCII."""
    return c.isalnum() or c in "_$" or ord(c) >= 128


def _ident_run_before(sql: str, i: int) -> str:
    """רצף תווי המזהה הצמוד לפני i, או מחרוזת ריקה."""
    j = i - 1
    while j >= 0 and _ident_char(sql[j]):
        j -= 1
    return sql[j + 1:i]


def _dollar_continues_identifier(sql: str, i: int) -> bool:
    """$ בתוך מזהה אמיתי אינו פותח ציטוט. רצף שמתחיל בספרה אינו מזהה."""
    run = _ident_run_before(sql, i)
    return bool(run) and not ("0" <= run[0] <= "9")


def _dollar_number_ambiguous(sql: str, i: int) -> bool:
    """רצף שמתחיל בספרה ואינו רק ספרות: psql והציטוט חולקים עליו.

    1$a$ הוא מספר ואז ציטוט. 1e5$a$ ו-1_000$a$ הם אצל psql טוקן אחד.
    לא מכריעים. שתי הקריאות נסרקות.
    """
    run = _ident_run_before(sql, i)
    if not run or not ("0" <= run[0] <= "9"):
        return False
    return any(not ("0" <= c <= "9") for c in run)


# תגית: $ + מזהה אופציונלי שמתחיל באות או בקו תחתון + $. $1$ אינו ציטוט.
_DOLLAR_TAG = re.compile(r"\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$")


def _advance_line(sql: str, i: int, line: int) -> tuple[int, int]:
    if sql[i] == "\n":
        return i + 1, line + 1
    return i + 1, line


def _skip_standard_string(sql: str, i: int, line: int) -> tuple[int, int]:
    """מחרוזת '...'. גרש כפול נשאר בפנים. backslash אינו בריחה."""
    n = len(sql)
    i += 1
    while i < n:
        if sql.startswith("''", i):
            i += 2
            continue
        if sql[i] == "'":
            return i + 1, line
        i, line = _advance_line(sql, i, line)
    return i, line


def _skip_escape_string(sql: str, i: int, line: int) -> tuple[int, int]:
    """מחרוזת E'...' או e'...'. \\' הוא גרש, לא סוף המחרוזת."""
    n = len(sql)
    i += 2  # E'
    while i < n:
        if sql[i] == "\\":
            i += 1
            if i < n:
                i, line = _advance_line(sql, i, line)
            continue
        if sql.startswith("''", i):
            i += 2
            continue
        if sql[i] == "'":
            return i + 1, line
        i, line = _advance_line(sql, i, line)
    return i, line


def _skip_dollar(sql: str, i: int, line: int, tag: str) -> tuple[int, int]:
    """גוף $tag$...$tag$ אטום ל-psql, כולל backslash שבתוכו."""
    n = len(sql)
    i += len(tag)
    while i < n and not sql.startswith(tag, i):
        i, line = _advance_line(sql, i, line)
    if i < n:
        i += len(tag)
    return i, line


def _skip_quoted_ident(sql: str, i: int, line: int, hits: list[int]) -> tuple[int, int]:
    """מזהה "...". גרש בתוכו אינו פותח מחרוזת. backslash מחוץ למחרוזת נחסם."""
    n = len(sql)
    i += 1
    while i < n:
        if sql.startswith('""', i):
            i += 2
            continue
        if sql[i] == '"':
            return i + 1, line
        if sql[i] == "\\":
            if not hits or hits[-1] != line:
                hits.append(line)
        i, line = _advance_line(sql, i, line)
    return i, line


def meta_command_lines(sql: str) -> list[int]:
    """לינט משני. backslash מחוץ למחרוזת ולהערה נחסם.

    אם לא ברור אם $ פותח ציטוט (רצף שמתחיל בספרה ואינו מספר שלם),
    נסרקות שתי הקריאות. די שפקודה גלויה באחת מהן.
    """
    hits: list[int] = []
    n = len(sql)

    def scan(i: int, line: int) -> None:
        while i < n:
            c = sql[i]
            if c == "\n":
                line += 1
                i += 1
                continue
            if c in " \t\r":
                i += 1
                continue
            if sql.startswith("--", i):
                i += 2
                while i < n and sql[i] != "\n":
                    i += 1
                continue
            if sql.startswith("/*", i):
                i += 2
                while i < n and not sql.startswith("*/", i):
                    i, line = _advance_line(sql, i, line)
                if i < n:
                    i += 2
                continue
            if c == "$":
                if _dollar_continues_identifier(sql, i):
                    i += 1
                    continue
                m = _DOLLAR_TAG.match(sql, i)
                if m and _dollar_number_ambiguous(sql, i):
                    i_open, line_open = _skip_dollar(sql, i, line, m.group(0))
                    scan(i_open, line_open)
                    scan(i + 1, line)
                    return
                if m:
                    i, line = _skip_dollar(sql, i, line, m.group(0))
                    continue
                i += 1
                continue
            if c == '"':
                i, line = _skip_quoted_ident(sql, i, line, hits)
                continue
            if c in "Ee" and i + 1 < n and sql[i + 1] == "'" and (i == 0 or not _ident_char(sql[i - 1])):
                i, line = _skip_escape_string(sql, i, line)
                continue
            if c == "'":
                i, line = _skip_standard_string(sql, i, line)
                continue
            if c == "\\":
                if line not in hits:
                    hits.append(line)
                while i < n and sql[i] != "\n":
                    i += 1
                continue
            i += 1

    scan(0, 1)
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
    if not restore_error_allowed('psql:<stdin>:4: ERROR:  relation "auth.users" does not exist'):
        fail("FK ל-auth.users לא ברשימה")
    if not restore_error_allowed('ERROR:  schema "public" already exists'):
        fail("schema public already exists לא ברשימה")
    if restore_error_allowed('ERROR:  relation "t_dup" already exists'):
        fail("relation already exists לא אמור לעבור")
    if restore_error_allowed('ERROR:  syntax error at or near "SELEC"'):
        fail("שגיאת תחביר לא אמורה לעבור")
    if meta_command_lines("select 1;\n\\! echo hi\n") != [2]:
        fail("\\! בתחילת שורה לא נחסם")
    if meta_command_lines("select 1;\n  \\c other\n") != [2]:
        fail("\\c מוזח לא נחסם")
    if meta_command_lines("select 1; \\! echo X\n") != [1]:
        fail("\\! אחרי פקודה באותה שורה לא נחסם")
    if meta_command_lines("select 'select 1' \\gexec\n") != [1]:
        fail("\\gexec אחרי מחרוזת לא נחסם")
    if meta_command_lines("select E'\\'' ;\n\\! echo X\n") != [2]:
        fail("\\! אחרי E'\\\\'' לא נחסם")
    if meta_command_lines("create table \"a'b\"(id int);\n\\! echo X\n") != [2]:
        fail("\\! אחרי מזהה עם גרש לא נחסם")
    buried = "create table t$a$ (id int);\n\\! echo PWN\ndrop table t$a$;\n"
    if meta_command_lines(buried) != [2]:
        fail(f"\\! אחרי t$a$ לא נחסם: {meta_command_lines(buried)}")
    positional = "select $1;\n\\! echo PWN\n"
    if meta_command_lines(positional) != [2]:
        fail(f"\\! אחרי $1 לא נחסם: {meta_command_lines(positional)}")
    if meta_command_lines("select $1$;\n\\! echo PWN\n") != [2]:
        fail("$1$ נפתח כציטוט ובלע את ה-backslash")
    hebrew = "create table ט$a$ (id int);\n\\! echo PWN\n"
    if meta_command_lines(hebrew) != [2]:
        fail(f"\\! אחרי ט$a$ לא נחסם: {meta_command_lines(hebrew)}")
    cafe = "create table café$a$ (id int);\n\\! echo PWN\n"
    if meta_command_lines(cafe) != [2]:
        fail(f"\\! אחרי café$a$ לא נחסם: {meta_command_lines(cafe)}")
    xed = "select 1 as x$E'\\' \\! echo PWN"
    if meta_command_lines(xed) != [1]:
        fail(f"\\! אחרי x$E' לא נחסם: {meta_command_lines(xed)}")
    number = "select 1$a$ ' $a$ \\! echo PWN\n';\n"
    if meta_command_lines(number) != [1]:
        fail(f"\\! אחרי 1$a$ לא נחסם: {meta_command_lines(number)}")
    # select 1$a$x$a$ : המספר נגמר, $a$ נפתח, הגוף הוא x, ו-$a$ סוגר.
    # backslash בגוף אינו פקודה.
    if meta_command_lines("select 1$a$x\\!$a$\n"):
        fail("select 1$a$x$a$ לא לקסיקון כציטוט")
    # מספר לא-שלם לפני $: psql קורא טוקן אחד והציטוט בולע. שתי הקריאות,
    # ודי שאחת חושפת את ה-backslash.
    for num in ("1e5", "1.5e3x", "1e", "0x1F", "0x", "0b1", "0o7", "1_000", "1_", "1abc", "1ט"):
        sample_num = f"select {num}$a$ \\! echo PWN $a$;\n"
        if not meta_command_lines(sample_num):
            fail(f"{num}$a$ לא נחסם")
    if meta_command_lines("do $$\nbegin\n  perform 1;\nend\n$$;\n"):
        fail("גוף פונקציה סומן כפקודת psql")
    if meta_command_lines("select '\\! echo hi';\n"):
        fail("backslash בתוך מחרוזת סומן כפקודת psql")
    if meta_command_lines("select E'\\\\!';\n"):
        fail("backslash בתוך E'...' סומן כפקודת psql")
    if meta_command_lines("do $$\n\\! echo hi\n$$;\n"):
        fail("backslash בתוך dollar quote סומן כפקודת psql")
    if meta_command_lines("-- \\! echo\nselect 1;\n"):
        fail("backslash בהערת שורה סומן כפקודת psql")
    if meta_command_lines("/* \\gexec */\nselect 1;\n"):
        fail("backslash בהערת בלוק סומן כפקודת psql")
    if meta_command_lines("select E'\\n' || 'a';\n"):
        fail("E'\\\\n' סומן כפקודת psql")
    false_pos = []
    for path in sorted(MIG_DIR.glob("*.sql")):
        found = meta_command_lines(path.read_text(encoding="utf-8"))
        if found:
            false_pos.append(f"{path.name}:{found[0]}")
    if false_pos:
        fail("פקודת psql מדומה במיגרציה קיימת:\n" + "\n".join(false_pos[:20]))
    migs = sorted(MIG_DIR.glob("*.sql"))
    print(f"✓ {len(migs)} מיגרציות בלי פקודת psql")
    report_driver_limitations(migs)
    assert_bang_does_not_run()
    saved_skip = {k: os.environ.get(k) for k in ("FORK_PR", "GITHUB_ACTOR", "SUPABASE_DB_URL")}
    os.environ["FORK_PR"] = "true"
    os.environ["GITHUB_ACTOR"] = "someone"
    if not may_skip_missing_secret():
        fail("fork בלי סוד לא דולג")
    os.environ["FORK_PR"] = "false"
    os.environ["GITHUB_ACTOR"] = "dependabot[bot]"
    if not may_skip_missing_secret():
        fail("Dependabot בלי סוד לא דולג")
    os.environ["GITHUB_ACTOR"] = "tomer"
    if may_skip_missing_secret():
        fail("PR מהריפו בלי סוד דולג")
    os.environ["SUPABASE_DB_URL"] = "postgresql://secret.example/db"
    clean = clean_env_for_apply()
    if "SUPABASE_DB_URL" in clean or any("secret.example" in v for v in clean.values()):
        fail("סביבת ה-exec כוללת את הסוד")
    probe = subprocess.run(
        [sys.executable, "-c",
         "import pathlib; raw = pathlib.Path('/proc/self/environ').read_bytes(); "
         "raise SystemExit(0 if b'SUPABASE_DB_URL=' not in raw and b'secret.example' not in raw else 1)"],
        env=clean, capture_output=True, text=True,
    )
    if probe.returncode != 0:
        fail("תהליך ההחלה רואה את הסוד ב-/proc/self/environ")
    for key, val in saved_skip.items():
        if val is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = val
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
    try:
        restore(db, "create schema public;\n")
    except MigrationFailed as exc:
        fail(f"schema public already exists היה צריך לעבור: {exc}")
    try:
        restore(
            db,
            "create schema if not exists auth;\n"
            "create table public.fk_users (id uuid references auth.users);\n",
        )
    except MigrationFailed as exc:
        fail(f"FK ל-auth.users היה צריך לעבור: {exc}")
    try:
        restore(db, "create table public.t_extra (id int);\ncreate table public.t_extra (id int);\n")
    except MigrationFailed as exc:
        if "already exists" not in str(exc).lower():
            fail(f"שגיאה לא צפויה לא זוהתה: {exc}")
    else:
        fail("relation already exists לא עצר את השחזור")
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


def assert_bang_does_not_run() -> None:
    """\\! אינו פקודה בדרייבר. הוא שגיאת שרת, ולא יוצר קובץ."""
    marker = Path("/tmp/migration_apply_pwn_marker")
    marker.unlink(missing_ok=True)
    db = "migration_apply_driver_test"
    env = local_env()
    run(["dropdb", "--if-exists", db], env=env)
    proc = run(["createdb", db], env=env)
    if proc.returncode != 0:
        fail(f"createdb לדרייבר נכשל:\n{proc.stderr[-400:]}")
    conn = local_connection(db)
    try:
        try:
            apply_sql(conn, f"\\! echo PWN > {marker}\n", name="bang")
        except MigrationFailed:
            pass
        else:
            fail("הדרייבר לא נכשל על \\!")
    finally:
        conn.close()
    if marker.exists():
        marker.unlink(missing_ok=True)
        fail("\\! רץ ויצר קובץ")
    run(["dropdb", "--if-exists", db], env=env)
    assert_driver_protocol()


def assert_driver_protocol() -> None:
    """קובץ אחד = טרנזקציה אחת, כמו db push. קבצים נפרדים מתחייבים בנפרד."""
    db = "migration_apply_protocol_test"
    env = local_env()
    run(["dropdb", "--if-exists", db], env=env)
    proc = run(["createdb", db], env=env)
    if proc.returncode != 0:
        fail(f"createdb לפרוטוקול נכשל:\n{proc.stderr[-400:]}")
    conn = local_connection(db)
    try:
        apply_sql(conn, "create table public.multi_stmt(id int); insert into public.multi_stmt values (1), (2);", name="multi")
        with conn.cursor() as cur:
            cur.execute("select count(*) from public.multi_stmt", prepare=False)
            if cur.fetchone() != (2,):
                fail("קובץ מרובה פקודות לא רץ כמחרוזת אחת")
        apply_sql(conn, "do $$ begin insert into public.multi_stmt values (3); end $$;", name="do")
        with conn.cursor() as cur:
            cur.execute("select count(*) from public.multi_stmt", prepare=False)
            if cur.fetchone() != (3,):
                fail("בלוק DO לא רץ")
        try:
            apply_sql(conn, "insert into public.multi_stmt values (9); select 1/0;", name="bad")
            fail("שגיאה באמצע קובץ לא עצרה")
        except MigrationFailed:
            pass
        with conn.cursor() as cur:
            cur.execute("select count(*) from public.multi_stmt where id = 9", prepare=False)
            if cur.fetchone() != (0,):
                fail("שגיאה באמצע קובץ לא התגלגלה לאחור")
        apply_sql(conn, "do $$ begin create type public.mood as enum ('a'); end $$; alter type public.mood add value 'b';", name="enum")
        try:
            apply_sql(conn, "alter type public.mood add value 'c'; select 'c'::public.mood;", name="same-file-value")
            fail("ערך enum חדש באותו קובץ היה צריך להיכשל, כמו db push")
        except MigrationFailed as exc:
            if "unsafe use of new value" not in str(exc).lower() and "55P04" not in str(exc):
                # הניסוח משתנה. די שהקובץ נכשל והערך לא נשאר בשימוש.
                if "syntax error" in str(exc).lower():
                    fail(f"ADD VALUE נכשל מסיבה אחרת: {exc}")
        apply_sql(conn, "select 'b'::public.mood;", name="next-file")
        apply_sql(conn, "set search_path to pg_catalog;", name="path-a")
        apply_sql(conn, "select 1;", name="path-b")
        with conn.cursor() as cur:
            cur.execute("show search_path", prepare=False)
            seen = str(cur.fetchone()[0])
        if seen.strip() == "pg_catalog":
            fail(f"קובץ ב' ראה search_path של קובץ א': {seen}")
        try:
            apply_sql(conn, "create index concurrently mood_idx on public.multi_stmt(id);", name="conc")
        except MigrationFailed as exc:
            fail(f"CONCURRENTLY מחוץ לטרנזקציה נכשל, ו-db push מעביר אותו: {exc}")
    finally:
        conn.close()
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
    unexpected = [ln for ln in errors if not restore_error_allowed(ln)]
    if unexpected:
        raise MigrationFailed(
            "שחזור הסכימה נעצר על שגיאה שאינה ברשימה:\n" + "\n".join(unexpected[:20])
        )
    print(f"שחזור הסכימה: {len(errors)} שגיאות מהרשימה המותרת")
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
                f"{path.name} שורה {hits[0]}: פקודת backslash גלויה ללינט "
                "(גם אם רק באחת הקריאות של $). db push לא מריץ אותה."
            )


def literal_blank(sql: str) -> str:
    """מחליף מחרוזות, ציטוטי דולר, מזהים והערות ברווחים. שומר שורות."""
    out: list[str] = []
    i, n = 0, len(sql)
    while i < n:
        if sql.startswith("--", i):
            j = sql.find("\n", i)
            if j < 0:
                j = n
            out.append(" " * (j - i))
            i = j
            continue
        if sql.startswith("/*", i):
            j = sql.find("*/", i + 2)
            end = n if j < 0 else j + 2
            chunk = sql[i:end]
            out.append("".join("\n" if c == "\n" else " " for c in chunk))
            i = end
            continue
        if sql[i] == "$":
            m = _DOLLAR_TAG.match(sql, i)
            if m and not _dollar_continues_identifier(sql, i):
                tag = m.group(0)
                j = sql.find(tag, i + len(tag))
                end = n if j < 0 else j + len(tag)
                chunk = sql[i:end]
                out.append("".join("\n" if c == "\n" else " " for c in chunk))
                i = end
                continue
        if sql[i] == "'":
            j, _line = _skip_standard_string(sql, i, 1)
            chunk = sql[i:j]
            out.append("".join("\n" if c == "\n" else " " for c in chunk))
            i = j
            continue
        if sql[i] in "Ee" and i + 1 < n and sql[i + 1] == "'" and (i == 0 or not _ident_char(sql[i - 1])):
            j, _line = _skip_escape_string(sql, i, 1)
            chunk = sql[i:j]
            out.append("".join("\n" if c == "\n" else " " for c in chunk))
            i = j
            continue
        if sql[i] == '"':
            j = i + 1
            while j < n:
                if sql.startswith('""', j):
                    j += 2
                    continue
                if sql[j] == '"':
                    j += 1
                    break
                j += 1
            chunk = sql[i:j]
            out.append("".join("\n" if c == "\n" else " " for c in chunk))
            i = j
            continue
        out.append(sql[i])
        i += 1
    return "".join(out)


def driver_limitation(sql: str) -> str | None:
    """COPY FROM stdin ו-CONCURRENTLY אינם simple query בתוך טרנזקציה."""
    mask = literal_blank(sql)
    if re.search(r"(?i)\bcopy\b[^;]*\bfrom\s+stdin\b", mask):
        return "copy-stdin"
    if re.search(
        r"(?i)\b(?:create\s+(?:unique\s+)?index|refresh\s+materialized\s+view)\s+concurrently\b",
        mask,
    ):
        return "concurrently"
    return None


def report_driver_limitations(files: list[Path]) -> None:
    found = []
    for path in files:
        kind = driver_limitation(path.read_text(encoding="utf-8"))
        if kind:
            found.append(f"{path.name}: {kind}")
    if found:
        print("הדרייבר מטפל בהם מחוץ לטרנזקציה, או עוצר בלי להריץ:")
        print("\n".join(found))
    else:
        print("✓ אין COPY FROM stdin ואין CONCURRENTLY בקובצי המיגרציה")


def simple_exec(conn, sql: str) -> None:
    """מחרוזת אחת, בלי פרמטרים ובלי prepare: simple query, כמו db push.

    פקודת \\\\ ב-psql לא קיימת כאן. השרת רואה אותה כשגיאת תחביר.
    """
    try:
        with conn.cursor() as cur:
            cur.execute(sql, prepare=False)
    except MigrationFailed:
        raise
    except Exception as exc:
        raise MigrationFailed(str(exc)) from exc


def apply_sql(conn, sql: str, *, name: str) -> None:
    # כמו ה-CLI: איפוס מצב הסשן לפני כל קובץ, כדי ש-search_path מקובץ קודם לא יישאר.
    simple_exec(conn, "RESET ALL")
    kind = driver_limitation(sql)
    if kind == "copy-stdin":
        raise MigrationFailed(
            f"{name}: COPY FROM stdin אינו נשלח בדרייבר (אין נתוני stdin). הקובץ לא רץ."
        )
    if kind == "concurrently":
        print(f"{name}: CONCURRENTLY מחוץ לטרנזקציה")
        try:
            simple_exec(conn, sql)
        except MigrationFailed as exc:
            raise MigrationFailed(f"{name} נכשלה:\n{exc}") from exc
        return
    simple_exec(conn, "BEGIN")
    try:
        simple_exec(conn, sql)
    except MigrationFailed as exc:
        try:
            simple_exec(conn, "ROLLBACK")
        except MigrationFailed:
            pass
        raise MigrationFailed(f"{name} נכשלה:\n{exc}") from exc
    simple_exec(conn, "COMMIT")


def local_connection(db: str):
    import psycopg
    target = _local_target()
    kwargs: dict = {"dbname": db, "autocommit": True}
    if target.get("PGHOST"):
        kwargs["host"] = target["PGHOST"]
    if target.get("PGPORT"):
        kwargs["port"] = target["PGPORT"]
    if target.get("PGUSER"):
        kwargs["user"] = target["PGUSER"]
    return psycopg.connect(**kwargs)


def apply_files(db: str, files: list[Path]) -> None:
    reject_meta_commands(files)
    report_driver_limitations(files)
    conn = local_connection(db)
    try:
        for path in files:
            print(f"מחיל {path.name}", flush=True)
            apply_sql(conn, path.read_text(encoding="utf-8"), name=path.name)
    finally:
        conn.close()
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


def clean_env_for_apply() -> dict[str, str]:
    """סביבה ראשונית להחלה. /proc/self/environ משקף רק את מה שהועבר ב-exec."""
    keep = ("PATH", "HOME", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "TEMP", "TMP", "USER", "LOGNAME", "SHELL", "MIGRATION_APPLY_DIR")
    env = {key: os.environ[key] for key in keep if os.environ.get(key)}
    env.update(_local_target())
    return env


def scrub_process_env() -> None:
    """מעדכן את os.environ. זה לא מוחק את /proc/self/environ, ולכן ההחלה רצה ב-exec."""
    kept = _local_target()
    for key in list(os.environ):
        if key in ("SUPABASE_DB_URL", "PGURL", "DATABASE_URL") or key.startswith("PG"):
            del os.environ[key]
    os.environ.update(kept)


def may_skip_missing_secret() -> bool:
    """דילוג רק ל-fork ול-Dependabot. PR מהריפו ו-push ל-main בלי סוד נכשלים."""
    return os.environ.get("FORK_PR") == "true" or os.environ.get("GITHUB_ACTOR") == "dependabot[bot]"


def skip_without_secret() -> None:
    actor = os.environ.get("GITHUB_ACTOR") or "unknown"
    event = os.environ.get("GITHUB_EVENT_NAME") or "unknown"
    if not may_skip_missing_secret():
        fail(
            f"אין SUPABASE_DB_URL (actor={actor}, event={event}). "
            "ב-PR מהריפו וב-push ל-main זו תקלה, לא דילוג."
        )
    if os.environ.get("FORK_PR") == "true":
        why = "PR מ-fork אינו מקבל סודות"
    else:
        why = f"{actor} אינו מקבל את SUPABASE_DB_URL"
    print(f"::warning::{why}. הבדיקה דולגת ולא נכשלת.")
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
        # המשיכה עם הסוד, ואז החלפת התהליך. מחיקה מ-os.environ לא מוציאה
        # את הערך מ-/proc/self/environ, ו-\! היה קורא אותו מהאב.
        code = fetch()
        if code != 0:
            return code
        flag = marker_dir() / "apply"
        if not flag.is_file() or flag.read_text(encoding="utf-8").strip() != "true":
            return 0
        script = str(Path(__file__).resolve())
        os.execve(sys.executable, [sys.executable, script, "--apply-local"], clean_env_for_apply())
    except MigrationFailed as exc:
        fail(str(exc))
        return 1


if __name__ == "__main__":
    sys.exit(main())
