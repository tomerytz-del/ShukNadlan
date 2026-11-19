#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""מכשיר שאומת נזכר ל-30 יום: הנפקה, מימוש, תפוגה, תקרה, כיבוי, והרשאות.

    python3 scripts/mfa_trusted_devices_test.py

רץ על Postgres מקומי (PGHOST / PGPORT / PGUSER כרגיל). מדמה את auth.uid() ו-
auth.jwt() כמו Supabase, ואת מצב ה-pending שבו ה-pre-request כבר איפס את
ה-claims והשאיר את shuk.mfa_pending_sub ו-shuk.mfa_pending_session.
הבדיקה אינה נוגעת ב-mfa_pre_request: המנעול לא זז, והמכשיר הזכור רק כותב
שורה מאומתת ל-wa_login_verifications, כמו הודעת הוואטסאפ.
"""

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIG = ROOT / "supabase/migrations/20271121150000_mfa_trusted_devices.sql"
DB = os.environ.get("MFA_DEVICES_DB", "mfa_devices_test")

USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1"
USER_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1"
S1 = "11111111-1111-1111-1111-111111111111"
S2 = "22222222-2222-2222-2222-222222222222"
S3 = "33333333-3333-3333-3333-333333333333"
S4 = "44444444-4444-4444-4444-444444444444"

SETUP = r"""
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;

create schema if not exists auth;
create table auth.users (id uuid primary key, encrypted_password text);
create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade);
create or replace function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(auth.jwt()->>'sub', '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;

insert into auth.users (id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'), ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1');

create table public.pricing_config (key text primary key, value numeric not null, description text);
create table public.agent_wa_2fa (user_id uuid primary key references auth.users(id) on delete cascade);
create table public.wa_login_verifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  session_id   uuid not null,
  nonce        text not null,
  enable       boolean not null default false,
  requested_at timestamptz not null default now(),
  verified_at  timestamptz
);
"""


def psql(sql_text=None, db=None, file=None):
    cmd = ["psql", "-v", "ON_ERROR_STOP=1", "-q", "-tA", "-d", db or DB]
    if file:
        cmd += ["-f", str(file)]
    else:
        cmd += ["-c", sql_text]
    return subprocess.check_output(cmd, text=True, stderr=subprocess.STDOUT).strip()


def run(sql_text):
    """אותו חיבור, אותה עסקה. מחזיר את השורה האחרונה."""
    out = psql(f"begin; {sql_text} commit;")
    lines = [ln for ln in out.splitlines() if ln.strip()]
    return lines[-1] if lines else ""


def authed(uid, sid, aal="aal1"):
    return (
        "set local role authenticated; "
        f"select set_config('request.jwt.claims', "
        f"'{{\"role\":\"authenticated\",\"sub\":\"{uid}\",\"session_id\":\"{sid}\",\"aal\":\"{aal}\"}}', true); "
    )


def pending(uid, sid):
    # אחרי ש-mfa_pre_request איפס את ה-claims: אין auth.uid(), והזהות נשארת ב-GUC
    return (
        "set local role authenticated; "
        "select set_config('request.jwt.claims', '{\"role\":\"anon\",\"mfa_pending\":true}', true); "
        f"select set_config('shuk.mfa_pending_sub', '{uid}', true); "
        f"select set_config('shuk.mfa_pending_session', '{sid}', true); "
    )


def verify_session(uid, sid, nonce="123456", age="0 days"):
    psql(
        "insert into wa_login_verifications (user_id, session_id, nonce, verified_at) "
        f"values ('{uid}', '{sid}', '{nonce}', now() - interval '{age}')"
    )


def reset():
    psql("truncate wa_login_verifications, mfa_trusted_devices; delete from agent_wa_2fa; "
         "insert into pricing_config (key, value) values ('mfa_device_trust_days', 30) "
         "on conflict (key) do update set value = 30")


def fail(msg):
    print("✗ " + msg)
    sys.exit(1)


def check(name, ok, detail=""):
    if not ok:
        fail(f"{name} {detail}".strip())
    print("✓ " + name)


def remember(uid, sid, aal="aal1"):
    return run(authed(uid, sid, aal) + "select public.mfa_device_remember();")


def token_of(json_text):
    import json
    return json.loads(json_text).get("token")


def claim(uid, sid, token):
    safe = token.replace("'", "''")   # הציטוט של הבדיקה עצמה; הפונקציה מקבלת את המחרוזת כמו שהיא
    return run(pending(uid, sid) + f"select public.mfa_device_claim('{safe}');")


def main():
    subprocess.run(["dropdb", "--if-exists", DB], check=True)
    subprocess.run(["createdb", DB], check=True)
    psql(SETUP)
    psql(file=MIG)
    psql(file=MIG)  # אידמפוטנטית: רצה פעמיים בלי שגיאה
    print("✓ המיגרציה רצה פעמיים")

    # ---- הנפקה ----
    reset()
    r = remember(USER_A, S1)
    check("session שלא אומת אינו מנפיק אסימון", '"not_verified"' in r, r)

    verify_session(USER_A, S1)
    r = remember(USER_A, S1)
    tok = token_of(r)
    check("session מאומת מנפיק אסימון של 64 תווים", bool(tok) and len(tok) == 64, r)
    stored = psql("select token_hash from mfa_trusted_devices")
    check("במסד נשמר ה-hash ולא האסימון", stored != tok and len(stored) == 64 and tok not in stored)
    days = psql("select round(extract(epoch from expires_at - verified_at) / 86400) from mfa_trusted_devices")
    check("התוקף 30 יום", days == "30", days)

    # ---- מימוש ----
    check("אסימון תקף מאמת session חדש", claim(USER_A, S2, tok) == "t")
    rows = psql(f"select count(*) from wa_login_verifications where session_id = '{S2}' "
                "and verified_at is not null and nonce like 'device:%'")
    check("נכתבה שורה מאומתת אחת ל-session החדש", rows == "1", rows)
    check("מימוש חוזר אינו מכפיל שורות", claim(USER_A, S2, tok) == "t"
          and psql(f"select count(*) from wa_login_verifications where session_id = '{S2}'") == "1")
    check("נרשם last_used_at", psql("select last_used_at is not null from mfa_trusted_devices") == "t")

    check("אסימון שגוי נדחה", claim(USER_A, S3, "0" * 64) == "f")
    check("פורמט שאינו hex נדחה", claim(USER_A, S3, "zz'; drop table x; --") == "f")
    check("אסימון של חשבון אחר נדחה", claim(USER_B, S3, tok) == "f")
    check("לא נכתבה שורה ל-session שנדחה",
          psql(f"select count(*) from wa_login_verifications where session_id = '{S3}'") == "0")

    # ---- session שאומת מאסימון לא מנפיק אסימון ----
    r = remember(USER_A, S2)
    check("session שאומת מאסימון אינו מנפיק חדש (30 הימים לא מתגלגלים)", '"not_verified"' in r, r)

    # ---- aal2 (אפליקציה) מנפיק ----
    r = remember(USER_A, S4, aal="aal2")
    check("אימות מאפליקציה (aal2) מנפיק אסימון", bool(token_of(r)), r)

    # ---- התוקף מרגע האימות ----
    reset()
    verify_session(USER_A, S1, age="20 days")
    r = remember(USER_A, S1)
    left = psql("select round(extract(epoch from expires_at - now()) / 86400) from mfa_trusted_devices")
    check("התוקף נספר מרגע האימות ולא מרגע ההנפקה", bool(token_of(r)) and left == "10", f"{r} {left}")
    reset()
    verify_session(USER_A, S1, age="31 days")
    r = remember(USER_A, S1)
    check("אימות בן יותר מ-30 יום אינו מנפיק", '"expired"' in r, r)

    # ---- תפוגה ----
    reset()
    verify_session(USER_A, S1)
    tok = token_of(remember(USER_A, S1))
    psql("update mfa_trusted_devices set expires_at = now() - interval '1 minute'")
    check("אסימון שפג אינו מאמת", claim(USER_A, S2, tok) == "f")
    check("ומספר המכשירים הזכורים אינו סופר אותו",
          run(authed(USER_A, S1) + "select public.mfa_devices_count();") == "0")

    # ---- תקרה של 10 ----
    reset()
    verify_session(USER_A, S1)
    for _ in range(12):
        remember(USER_A, S1)
    n = psql("select count(*) from mfa_trusted_devices")
    check("עד 10 מכשירים לחשבון", n == "10", n)

    # ---- שכחו הכול ----
    tok = token_of(remember(USER_A, S1))
    gone = run(authed(USER_A, S1) + "select public.mfa_devices_forget();")
    check("mfa_devices_forget מוחקת את כולם", int(gone) >= 10 and psql("select count(*) from mfa_trusted_devices") == "0", gone)
    check("ואסימון שנמחק אינו מאמת", claim(USER_A, S2, tok) == "f")

    # ---- מתג כיבוי ----
    reset()
    verify_session(USER_A, S1)
    tok = token_of(remember(USER_A, S1))
    psql("update pricing_config set value = 0 where key = 'mfa_device_trust_days'")
    check("מתג 0: אסימון קיים מפסיק להתממש", claim(USER_A, S2, tok) == "f")
    check("מתג 0: לא מונפקים חדשים", '"disabled"' in remember(USER_A, S1))
    check("מתג 0: מספר הימים 0", run(authed(USER_A, S1) + "select public.mfa_device_trust_days();") == "0")
    psql("delete from pricing_config where key = 'mfa_device_trust_days'")
    check("בלי שורה בהגדרות הזכירה כבויה", claim(USER_A, S2, tok) == "f")

    # ---- כיבוי האימות בוואטסאפ מוחק מכשירים ----
    reset()
    psql(f"insert into agent_wa_2fa (user_id) values ('{USER_A}'), ('{USER_B}')")
    verify_session(USER_A, S1)
    verify_session(USER_B, S3)
    remember(USER_A, S1)
    remember(USER_B, S3)
    psql(f"delete from agent_wa_2fa where user_id = '{USER_A}'")
    left = psql("select string_agg(user_id::text, ',') from mfa_trusted_devices")
    check("כיבוי אימות מוחק רק את המכשירים של אותו חשבון", left == USER_B, left)

    # ---- שינוי סיסמה ----
    reset()
    psql(f"update auth.users set encrypted_password = 'p0'")
    verify_session(USER_A, S1)
    verify_session(USER_B, S3)
    remember(USER_A, S1)
    remember(USER_B, S3)
    psql(f"update auth.users set encrypted_password = encrypted_password where id = '{USER_A}'")
    check("עדכון סיסמה לאותו ערך אינו מוחק", psql(f"select count(*) from mfa_trusted_devices where user_id = '{USER_A}'") == "1")
    psql(f"update auth.users set encrypted_password = 'p1' where id = '{USER_A}'")
    left = psql("select string_agg(user_id::text, ',') from mfa_trusted_devices")
    check("שינוי סיסמה מוחק רק את המכשירים של אותו חשבון", left == USER_B, left)

    # ---- יציאה מכל המכשירים ----
    def sessions(uid, n):
        psql(f"delete from auth.sessions where user_id = '{uid}'")
        psql(f"insert into auth.sessions (user_id) select '{uid}' from generate_series(1, {n})")

    def devices(uid):
        return psql(f"select count(*) from mfa_trusted_devices where user_id = '{uid}'")

    reset()
    verify_session(USER_A, S1)
    verify_session(USER_B, S3)
    remember(USER_A, S1)
    remember(USER_B, S3)
    sessions(USER_A, 3)
    sessions(USER_B, 1)
    psql(f"delete from auth.sessions where id = (select id from auth.sessions where user_id = '{USER_A}' limit 1)")
    check("יציאה רגילה (session אחד מתוך שלושה) אינה מוחקת", devices(USER_A) == "1")
    psql(f"delete from auth.sessions where id in (select id from auth.sessions where user_id = '{USER_A}' limit 1)")
    check("נשאר session אחד: אינה מוחקת", devices(USER_A) == "1")
    sessions(USER_A, 3)
    psql(f"delete from auth.sessions where user_id = '{USER_A}' and id in (select id from auth.sessions where user_id = '{USER_A}' limit 2)")
    check("מחיקת שניים משלושה (נשאר אחד) אינה מוחקת", devices(USER_A) == "1")
    sessions(USER_A, 3)
    psql(f"delete from auth.sessions where user_id = '{USER_A}'")
    check("יציאה מכל המכשירים (כל ה-sessions בהצהרה אחת) מוחקת", devices(USER_A) == "0")
    check("ולא נוגעת בחשבון אחר", devices(USER_B) == "1")
    psql(f"delete from auth.sessions where user_id = '{USER_B}'")
    check("session יחיד שנמחק אינו מוחק (זהה ליציאה רגילה, מתועד)", devices(USER_B) == "1")

    # ---- כשל בטריגר אינו עוצר פעולת auth ----
    psql("alter table mfa_trusted_devices rename to mfa_trusted_devices_x")
    try:
        psql(f"update auth.users set encrypted_password = 'p2' where id = '{USER_B}'")
        sessions(USER_B, 2)
        psql(f"delete from auth.sessions where user_id = '{USER_B}'")
        ok = True
    except subprocess.CalledProcessError as e:
        ok = False
        print(e.output)
    finally:
        psql("alter table mfa_trusted_devices_x rename to mfa_trusted_devices")
    check("טבלה שבורה: שינוי סיסמה ויציאה עדיין עוברים (אזהרה בלבד)", ok)

    for fn in ("mfa_trusted_devices_on_password_change()", "mfa_trusted_devices_on_global_signout()"):
        for role in ("anon", "authenticated"):
            e = psql(f"select has_function_privilege('{role}', 'public.{fn}', 'execute')")
            check(f"{fn}: סגורה ל-{role}", e == "f")

    # ---- בלי זהות ----
    err = subprocess.run(
        ["psql", "-v", "ON_ERROR_STOP=1", "-q", "-tA", "-d", DB, "-c",
         "begin; set local role authenticated; select public.mfa_device_claim('" + "0" * 64 + "');"],
        text=True, capture_output=True)
    check("מימוש בלי זהות ו-session נכשל", err.returncode != 0 and "unauthorized" in err.stderr, err.stderr)

    # ---- הרשאות ----
    def priv(sql):
        return psql(sql)

    for fn in ("mfa_device_claim(text)", "mfa_device_remember()", "mfa_devices_forget()",
               "mfa_devices_count()", "mfa_device_trust_days()"):
        anon = priv(f"select has_function_privilege('anon', 'public.{fn}', 'execute')")
        auth = priv(f"select has_function_privilege('authenticated', 'public.{fn}', 'execute')")
        check(f"{fn}: anon סגור ו-authenticated פתוח", anon == "f" and auth == "t", f"anon={anon} auth={auth}")
    for role in ("anon", "authenticated"):
        t = priv(f"select has_table_privilege('{role}', 'public.mfa_trusted_devices', 'select')")
        check(f"הטבלה סגורה ל-{role}", t == "f")
    trig = priv("select has_function_privilege('authenticated', 'public.mfa_trusted_devices_on_2fa_off()', 'execute')")
    check("פונקציית הטריגר סגורה ל-authenticated", trig == "f")

    subprocess.run(["dropdb", "--if-exists", DB], check=True)
    print("עבר")


if __name__ == "__main__":
    main()
