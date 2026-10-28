#!/usr/bin/env python3
"""חלון הלקוחות ותקרת 3 לטלפון, על Postgres מקומי.

ראשון-חמישי 08:00-21:00. שישי וערב חג 08:00-13:00.
שבת, חג ויום כיפור סגורים. התביעה הרביעית לאותו טלפון באותו יום נכשלת.
הדגל customer_digest_enabled נשאר 0, והתקציר מחזיר אפס שורות.

    python3 scripts/customer_send_window_test.py
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MIG = ROOT / "supabase/migrations/20271029235900_customer_send_window.sql"
DB = os.environ.get("CUSTOMER_WINDOW_TEST_DB", "customer_window_test")


def fail(msg: str) -> None:
    print(f"✗ {msg}")
    sys.exit(1)


def psql(sql: str) -> str:
    proc = subprocess.run(
        ["psql", "-v", "ON_ERROR_STOP=1", "-d", DB, "-At", "-c", sql],
        text=True, capture_output=True,
    )
    if proc.returncode != 0:
        fail(f"psql נכשל:\n{proc.stderr}\n{sql[:500]}")
    return proc.stdout.strip()


def psql_file(path: Path) -> None:
    proc = subprocess.run(
        ["psql", "-v", "ON_ERROR_STOP=1", "-d", DB, "-f", str(path)],
        text=True, capture_output=True,
    )
    if proc.returncode != 0:
        fail(f"psql נכשל על {path.name}:\n{proc.stderr[-2500:]}")


def at(wall: str) -> str:
    return f"(timestamp '{wall}' at time zone 'Asia/Jerusalem')"


def expect(sql: str, want: str, label: str) -> None:
    got = psql(sql)
    if got != want:
        fail(f"{label}: ציפיתי {want}, קיבלתי {got}")


def main() -> int:
    if not MIG.is_file():
        fail("חסרה המיגרציה")
    subprocess.run(["dropdb", "--if-exists", DB], check=False)
    subprocess.run(["createdb", DB], check=True)
    psql("""
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
create table public.pricing_config (key text primary key, value int, description text);
create table public.saved_searches (
  id uuid primary key, phone_e164 text
);
create table public.saved_search_alerts (
  id uuid primary key default gen_random_uuid(),
  search_id uuid references public.saved_searches(id),
  property_id uuid,
  status text not null default 'pending',
  last_error text,
  constraint saved_search_alerts_status_check
    check (status in ('pending', 'sent', 'failed', 'skipped'))
);
""")
    psql_file(MIG)

    expect(f"select public.send_window_open('saved_search', {at('2026-08-02 08:00:00')})", "t", "ראשון 08:00")
    expect(f"select public.send_window_open('saved_search', {at('2026-08-02 07:59:00')})", "f", "ראשון 07:59")
    expect(f"select public.send_window_open('saved_search', {at('2026-08-02 20:59:00')})", "t", "ראשון 20:59")
    expect(f"select public.send_window_open('saved_search', {at('2026-08-02 21:00:00')})", "f", "ראשון 21:00")
    expect(f"select public.send_window_open('agent', {at('2026-08-07 10:00:00')})", "t", "שישי 10:00")
    expect(f"select public.send_window_open('agent', {at('2026-08-07 13:00:00')})", "f", "שישי 13:00")
    expect(f"select public.send_window_open('open_house', {at('2026-08-08 10:00:00')})", "f", "שבת 10:00")
    expect(f"select public.send_window_open('saved_search', {at('2026-09-21 10:00:00')})", "f", "יום כיפור")
    expect(f"select public.send_window_open('saved_search', {at('2026-09-20 10:00:00')})", "t", "ערב כיפור 10:00")
    expect(f"select public.send_window_open('saved_search', {at('2026-09-20 14:00:00')})", "f", "ערב כיפור 14:00")
    expect(f"select public.send_window_open('saved_search', {at('2026-09-12 11:00:00')})", "f", "ראש השנה")
    expect("select public.send_window_open('nope', now())", "f", "קהל לא מוכר")
    expect(f"select public.notification_send_window_open({at('2026-08-08 10:00:00')})", "f", "סוכן בשבת")
    expect(f"select public.notification_send_window_open({at('2026-09-21 12:00:00')})", "f", "סוכן ביום כיפור")
    expect("select count(*) from public.il_holidays", "30", "זרע 2026-2027")
    expect("select kind from public.il_holidays where holiday_date = '2026-09-21'", "holiday", "יום כיפור הוא חג")
    expect("select kind from public.il_holidays where holiday_date = '2027-10-10'", "eve", "ערב כיפור 2027")

    day = at("2026-08-03 10:00:00")
    for i, want in enumerate(("t", "t", "t", "f", "f"), start=1):
        expect(
            f"select public.customer_phone_claim('+972501234567', {day})",
            want,
            f"תביעה {i}",
        )
    expect(
        f"select public.customer_phone_claim('+972507654321', {day})",
        "t",
        "טלפון אחר",
    )
    expect(
        f"select public.customer_phone_claim('+972501234567', {at('2026-08-04 10:00:00')})",
        "t",
        "יום למחרת",
    )
    expect("select public.customer_phone_claim('  ', now())", "f", "טלפון ריק")
    expect(
        "select sent_count from public.customer_phone_day where phone_e164 = '+972501234567' and day = '2026-08-03'",
        "3",
        "המונה נעצר ב-3",
    )

    psql("""
insert into public.saved_searches (id, phone_e164)
values ('11111111-1111-1111-1111-111111111111', '+972501111111');
insert into public.saved_search_alerts (id, search_id, status)
values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'pending');
""")
    psql("select public.customer_message_defer('22222222-2222-2222-2222-222222222222', 'cap')")
    expect(
        "select status from public.saved_search_alerts where id = '22222222-2222-2222-2222-222222222222'",
        "deferred",
        "התראה דחויה",
    )
    expect(
        "select reason || ' ' || audience from public.customer_message_holds where alert_id = '22222222-2222-2222-2222-222222222222'",
        "cap saved_search",
        "השורה הדחויה",
    )
    expect("select count(*) from public.customer_digest_groups(now())", "0", "דגל 0: אין תקציר")
    psql("update public.pricing_config set value = 1 where key = 'customer_digest_enabled'")
    expect(
        f"select phone_e164 from public.customer_digest_groups({at('2027-08-02 10:00:00')})",
        "+972501111111",
        "דגל 1 בחלון פתוח: טלפון אחד",
    )
    expect(
        f"select count(*) from public.customer_digest_groups({at('2026-08-08 10:00:00')})",
        "0",
        "שבת: אין תקציר גם כשהדגל 1",
    )
    psql("update public.pricing_config set value = 0 where key = 'customer_digest_enabled'")
    expect("select value from public.pricing_config where key = 'customer_digest_enabled'", "0", "הדגל חוזר ל-0")

    anon = psql("select has_table_privilege('anon', 'public.il_holidays', 'select')")
    auth = psql("select has_table_privilege('authenticated', 'public.customer_phone_day', 'select')")
    svc = psql("select has_table_privilege('service_role', 'public.customer_message_holds', 'select')")
    if anon != "f" or auth != "f" or svc != "t":
        fail(f"הרשאות: anon={anon} authenticated={auth} service_role={svc}")
    fn = psql("select has_function_privilege('anon', 'public.send_window_open(text, timestamptz)', 'execute')")
    fn_svc = psql("select has_function_privilege('service_role', 'public.customer_phone_claim(text, timestamptz)', 'execute')")
    if fn != "f" or fn_svc != "t":
        fail(f"execute: anon={fn} service_role={fn_svc}")

    print("✓ חלון, חגים, תקרה 3, דחיה, ודגל התקציר כבוי.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
