#!/usr/bin/env python3
"""חלון הלקוחות: תוקף 72 שעות, מיזוג, פיזור 08:00-09:00 ומרווח 20 דקות.

    python3 scripts/customer_send_window_test.py
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MIG = ROOT / "supabase/migrations/20271030000100_customer_send_window.sql"
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
        fail(f"psql נכשל:\n{proc.stderr}\n{sql[:700]}")
    return proc.stdout.strip()


def psql_file(path: Path) -> None:
    sql = "set check_function_bodies = off;\n" + path.read_text(encoding="utf-8")
    proc = subprocess.run(
        ["psql", "-v", "ON_ERROR_STOP=1", "-d", DB],
        text=True, input=sql, capture_output=True,
    )
    if proc.returncode != 0:
        fail(f"psql נכשל על {path.name}:\n{proc.stderr[-3000:]}")


def at(wall: str) -> str:
    return f"(timestamp '{wall}' at time zone 'Asia/Jerusalem')"


def expect(sql: str, want: str, label: str) -> None:
    got = psql(sql)
    if got != want:
        fail(f"{label}: ציפיתי {want}, קיבלתי {got}")


def phone_with_minute(minute: int) -> str:
    got = psql(f"""
      select '+97250' || lpad(n::text, 7, '0')
        from generate_series(1, 400) n
       where public.customer_spread_minute('+97250' || lpad(n::text, 7, '0')) = {minute}
       limit 1
    """)
    if not got:
        fail(f"לא נמצא טלפון לדקה {minute}")
    return got


def main() -> int:
    if not MIG.is_file():
        fail("חסרה המיגרציה")
    src = MIG.read_text(encoding="utf-8")
    if "if tg_op = 'UPDATE' and not public.customer_send_window_on()" not in src:
        fail("עדכון status שולח פוש גם כשחלון הלקוחות כבוי")
    subprocess.run(["dropdb", "--if-exists", DB], check=False)
    subprocess.run(["createdb", DB], check=True)
    psql("""
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
create table public.pricing_config (key text primary key, value int, description text);
create table public.neighborhoods (id uuid primary key, name text);
create table public.saved_searches (
  id uuid primary key,
  full_name text,
  phone_e164 text,
  email text,
  contact_channel text,
  label text,
  unsubscribe_token text,
  status text default 'active',
  cities text[] default '{}',
  created_at timestamptz not null default now(),
  deal_type text,
  category text
);
create table public.properties (
  id uuid primary key,
  status text,
  title text,
  price numeric,
  rooms numeric,
  size_sqm numeric,
  area_sqm numeric,
  floor int,
  city text,
  street text,
  property_type text,
  deal_type text,
  images text[],
  neighborhood_id uuid
);
create table public.saved_search_alerts (
  id uuid primary key default gen_random_uuid(),
  search_id uuid,
  property_id uuid,
  status text not null default 'pending',
  whatsapp_status text not null default 'pending',
  email_status text not null default 'pending',
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  click_token text,
  constraint saved_search_alerts_status_check
    check (status in ('pending', 'sent', 'failed', 'skipped'))
);
create or replace function public.saved_search_matches(
  p_search public.saved_searches, p_property public.properties
) returns boolean language sql stable as $$
  select p_property.status = 'active'
     and (cardinality(coalesce(p_search.cities, '{}')) = 0
          or p_property.city = any(p_search.cities));
$$;
""")
    psql_file(MIG)

    expect(f"select public.send_window_open('saved_search', {at('2026-08-02 08:00:00')})", "t", "ראשון 08:00")
    expect(f"select public.send_window_open('saved_search', {at('2026-08-02 07:59:00')})", "f", "ראשון 07:59")
    expect(f"select public.send_window_open('saved_search', {at('2026-08-02 21:00:00')})", "f", "ראשון 21:00")
    expect(f"select public.send_window_open('open_house', {at('2026-08-08 10:00:00')})", "f", "שבת")
    expect(f"select public.send_window_open('saved_search', {at('2026-09-21 10:00:00')})", "f", "יום כיפור")
    expect(f"select public.send_window_open('saved_search', {at('2026-09-20 10:00:00')})", "t", "ערב כיפור 10:00")
    expect(f"select public.send_window_open('saved_search', {at('2026-09-20 14:00:00')})", "f", "ערב כיפור 14:00")
    expect(f"select public.notification_send_window_open({at('2026-09-21 10:00:00')})", "t", "סוכן ביום כיפור כשהדגל כבוי")
    psql("update public.pricing_config set value = 1 where key = 'agent_holiday_window_enabled'")
    expect(f"select public.notification_send_window_open({at('2026-09-21 10:00:00')})", "f", "סוכן ביום כיפור כשהדגל דלוק")
    psql("update public.pricing_config set value = 0 where key = 'agent_holiday_window_enabled'")
    ahead = psql("select (max(holiday_date) > current_date + 60) from public.il_holidays")
    if ahead != "t":
        fail("אין חג יותר מ-60 יום קדימה")
    expect("select kind from public.il_holidays where holiday_date = '2028-09-30'", "holiday", "יום כיפור 2028")

    psql("update public.pricing_config set value = 1 where key = 'customer_send_window_enabled'")
    early = phone_with_minute(0)
    later = phone_with_minute(30)
    t0 = at("2026-08-02 08:00:00")
    expect(
        f"select public.customer_phone_claim('{later}', {t0}, gen_random_uuid(), true)",
        "wait",
        "08:00 לא משחרר טלפון של דקה 30",
    )
    expect(
        f"select public.customer_phone_claim('{later}', {at('2026-08-02 08:30:00')}, gen_random_uuid(), true)",
        "ok",
        "08:30 משחרר את דקה 30",
    )
    ref1 = psql("select gen_random_uuid()")
    expect(
        f"select public.customer_phone_claim('{early}', {t0}, '{ref1}', true)",
        "ok",
        "08:00 משחרר דקה 0",
    )
    expect(
        f"select public.customer_phone_claim('{early}', {at('2026-08-02 08:10:00')}, gen_random_uuid(), true)",
        "wait",
        "מרווח 20 דקות",
    )
    expect(
        f"select public.customer_phone_claim('{early}', {at('2026-08-02 08:20:00')}, gen_random_uuid(), true)",
        "ok",
        "אחרי 20 דקות",
    )
    expect(
        f"select public.customer_phone_claim('{early}', {at('2026-08-02 08:40:00')}, gen_random_uuid(), true)",
        "ok",
        "הודעה שלישית",
    )
    expect(
        f"select public.customer_phone_claim('{early}', {at('2026-08-02 09:00:00')}, gen_random_uuid(), true)",
        "cap",
        "רביעית נעצרת",
    )
    psql(f"select public.customer_phone_release('{early}', '{ref1}', {t0})")
    expect(
        f"select sent_count from public.customer_phone_day where contact_key = '{early}' and day = '2026-08-02'",
        "2",
        "כשל לא נספר",
    )
    fresh = phone_with_minute(4)
    pushed = psql("select gen_random_uuid()")
    expect(
        f"select public.customer_phone_claim('{fresh}', {at('2026-08-02 10:00:00')}, '{pushed}', false)",
        "ok",
        "תפיסה עם דחיפה",
    )
    psql(f"update public.customer_phone_sends set push_sent_at = now() where ref_id = '{pushed}'")
    psql(f"select public.customer_phone_release('{fresh}', '{pushed}', {at('2026-08-02 10:00:00')})")
    expect(
        f"select sent_count from public.customer_phone_day where contact_key = '{fresh}' and day = '2026-08-02'",
        "1",
        "already עם דחיפה לא משחרר",
    )

    def seed(pid: str, sid: str, aid: str, phone: str, city: str, status: str, created: str, prop_status: str = "active") -> None:
        psql(f"""
          insert into public.saved_searches (id, full_name, phone_e164, email, status, cities)
          values ('{sid}', 'בדיקה', '{phone}', '{phone[1:]}@example.com', 'active', array['{city}']);
          insert into public.properties (id, status, city, title, price, rooms)
          values ('{pid}', '{prop_status}', '{city}', 'דירה', 1000000, 4);
          insert into public.saved_search_alerts (id, search_id, property_id, status, created_at)
          values ('{aid}', '{sid}', '{pid}', '{status}', {created});
        """)

    base = at("2026-08-02 08:00:00")
    seed("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1",
         "cccccccc-cccc-cccc-cccc-ccccccccccc1", early, "עפולה", "deferred", f"{base} - interval '73 hours'")
    psql(f"select public.customer_prepare({base})")
    expect(
        "select status from public.saved_search_alerts where id = 'cccccccc-cccc-cccc-cccc-ccccccccccc1'",
        "expired",
        "פג תוקף אחרי 72 שעות",
    )

    fresh_phone = phone_with_minute(0)
    # early כבר מלא חלקית; fresh_phone נקי חוץ מאם הוא early. ננקה את היום.
    psql("delete from public.customer_phone_sends; delete from public.customer_phone_day;")
    p_ok = phone_with_minute(0)
    seed("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2",
         "cccccccc-cccc-cccc-cccc-ccccccccccc2", p_ok, "עפולה", "deferred", f"{base} - interval '2 hours'", "sold")
    seed("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3",
         "cccccccc-cccc-cccc-cccc-ccccccccccc3", phone_with_minute(0), "חיפה", "deferred", f"{base} - interval '2 hours'", "active")
    psql("update public.saved_searches set cities = array['עפולה'] where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3'")
    psql(f"select public.customer_prepare({base})")
    expect(
        "select last_error from public.saved_search_alerts where id = 'cccccccc-cccc-cccc-cccc-ccccccccccc2'",
        "inactive",
        "נכס לא פעיל",
    )
    expect(
        "select last_error from public.saved_search_alerts where id = 'cccccccc-cccc-cccc-cccc-ccccccccccc3'",
        "no_match",
        "נכס שלא תואם",
    )

    psql("delete from public.customer_phone_sends; delete from public.customer_phone_day;")
    merge_phone = phone_with_minute(0)
    prop = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4"
    psql(f"""
      insert into public.properties (id, status, city, title, price, rooms)
      values ('{prop}', 'active', 'עפולה', 'דירה', 900000, 3);
      insert into public.saved_searches (id, full_name, phone_e164, status, cities)
      values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4', 'בדיקה', '{merge_phone}', 'active', array['עפולה']);
      insert into public.saved_search_alerts (id, search_id, property_id, status, created_at) values
        ('cccccccc-cccc-cccc-cccc-ccccccccccc4', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4', '{prop}', 'deferred', {base} - interval '3 hours'),
        ('cccccccc-cccc-cccc-cccc-ccccccccccc5', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4', '{prop}', 'deferred', {base} - interval '1 hour');
    """)
    psql(f"select public.customer_prepare({base})")
    expect(
        "select status || ' ' || coalesce(last_error, '') from public.saved_search_alerts where id = 'cccccccc-cccc-cccc-cccc-ccccccccccc4'",
        "skipped merged",
        "ההתראה הישנה מוזגה",
    )
    expect(
        "select status from public.saved_search_alerts where id = 'cccccccc-cccc-cccc-cccc-ccccccccccc5'",
        "pending",
        "החדשה נשארת",
    )

    psql("update public.pricing_config set value = 1 where key = 'customer_digest_enabled'")
    enabled = psql("select enabled_at from public.customer_digest_state where id = 1")
    if not enabled:
        fail("הדלקת התקציר לא נרשמה")
    dig_phone = phone_with_minute(0)
    psql(f"""
      insert into public.properties (id, status, city) values
        ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6', 'active', 'עפולה'),
        ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa7', 'active', 'עפולה');
      insert into public.saved_searches (id, full_name, phone_e164, status, cities) values
        ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb6', 'בדיקה', '{dig_phone}', 'active', array['עפולה']);
      insert into public.saved_search_alerts (id, search_id, property_id, status, created_at) values
        ('cccccccc-cccc-cccc-cccc-ccccccccccc6', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb6',
         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6', 'deferred', timestamp '{enabled}' - interval '2 days'),
        ('cccccccc-cccc-cccc-cccc-ccccccccccc7', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb6',
         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa7', 'deferred', timestamp '{enabled}' + interval '1 minute');
      insert into public.customer_message_holds (phone_e164, audience, alert_id, reason, deliver_on, created_at) values
        ('{dig_phone}', 'saved_search', 'cccccccc-cccc-cccc-cccc-ccccccccccc6', 'quiet', '2026-08-02', timestamp '{enabled}' - interval '2 days'),
        ('{dig_phone}', 'saved_search', 'cccccccc-cccc-cccc-cccc-ccccccccccc7', 'quiet', '2026-08-02', timestamp '{enabled}' + interval '1 minute');
    """)
    got = psql(f"select coalesce(string_agg(x::text, ','), '') from public.customer_digest_take({base}) d, unnest(d.alert_ids) x")
    if "cccccccc-cccc-cccc-cccc-ccccccccccc6" in got:
        fail("התקציר מילא אחורה")
    if "cccccccc-cccc-cccc-cccc-ccccccccccc7" not in got:
        fail(f"התקציר לא החזיר התראה תקפה: {got}")
    second = psql(f"select count(*) from public.customer_digest_take({base})")
    if second != "0":
        fail("התקציר חזר על אותה התראה")
    marked = psql("select delivered_at is not null from public.customer_message_holds where alert_id = 'cccccccc-cccc-cccc-cccc-ccccccccccc7'")
    if marked != "t":
        fail("delivered_at לא סומן")

    late = phone_with_minute(59)
    psql("delete from public.customer_phone_sends; delete from public.customer_phone_day;")
    expect(
        f"select public.customer_phone_claim('{late}', {at('2026-08-02 08:58:00')}, gen_random_uuid(), true)",
        "wait",
        "דקה 59 עוד לא ב-08:58",
    )
    expect(
        f"select public.customer_phone_claim('{late}', {at('2026-08-02 09:00:00')}, gen_random_uuid(), true)",
        "ok",
        "דקה 59 יוצאת ב-09:00",
    )
    psql("delete from public.customer_phone_sends; delete from public.customer_phone_day;")
    expect(
        f"select public.customer_phone_claim('{late}', {at('2026-08-02 08:56:00')}, gen_random_uuid(), false)",
        "ok",
        "יריד רגיל לא מחכה לדקה",
    )
    psql("delete from public.customer_phone_sends; delete from public.customer_phone_day;")
    noon = phone_with_minute(40)
    expect(
        f"select public.customer_phone_claim('{noon}', {at('2026-08-02 10:00:00')}, gen_random_uuid(), false)",
        "ok",
        "אחרי 09:00 אין השהיה",
    )

    psql("update public.pricing_config set value = 0 where key = 'customer_send_window_enabled'")
    psql(f"""
      insert into public.properties (id, status, city) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa8', 'active', 'עפולה');
      insert into public.saved_searches (id, full_name, phone_e164, status, cities)
      values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb8', 'בדיקה', '{p_ok}', 'active', array['עפולה']);
      insert into public.saved_search_alerts (id, search_id, property_id, status, created_at) values
        ('cccccccc-cccc-cccc-cccc-ccccccccccc8', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb8',
         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa8', 'deferred', {base} - interval '2 hours'),
        ('cccccccc-cccc-cccc-cccc-ccccccccccc9', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb8',
         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa8', 'deferred', {base} - interval '80 hours');
    """)
    psql(f"select public.customer_prepare({base})")
    expect(
        "select status from public.saved_search_alerts where id = 'cccccccc-cccc-cccc-cccc-ccccccccccc8'",
        "pending",
        "כיבוי הדגל מחזיר דחוי ל-pending",
    )
    expect(
        "select status from public.saved_search_alerts where id = 'cccccccc-cccc-cccc-cccc-ccccccccccc9'",
        "expired",
        "כיבוי הדגל לא מחזיר מה שפג",
    )

    defn = psql("select pg_get_functiondef('public.notification_push_due_agents()'::regprocedure)")
    quiet_at = defn.find("notification_agent_send_quiet")
    spread_at = defn.find("agent_backlog_waiting")
    if quiet_at < 0 or spread_at < 0 or quiet_at > spread_at:
        fail("פיזור הבוקר רץ לפני שעות השקט")
    if "cfg.priority" not in defn[spread_at:spread_at + 400]:
        fail("הפיזור לא משתמש ב-cfg.priority")
    if "array['new_lead'" in defn:
        fail("הפיזור מחזיק רשימת סוגים קשיחה")

    notify = (ROOT / "supabase/functions/saved-search-notify/index.ts").read_text(encoding="utf-8")
    if notify.find("if (phoneHeld)") > notify.find("await sendEmail("):
        fail("מייל יוצא גם כשהתקרה מלאה")
    email_catch = notify.split("await sendEmail(a);", 1)[1][:500]
    if "customer_phone_release" not in email_catch:
        fail("כישלון מייל לא משחרר את התפיסה")

    dig_only = phone_with_minute(0)
    psql(f"""
      insert into public.properties (id, status, city) values
        ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa9', 'active', 'עפולה');
      insert into public.saved_searches (id, full_name, phone_e164, status, cities)
      values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb9', 'בדיקה', '{dig_only}', 'active', array['עפולה']);
      insert into public.saved_search_alerts (id, search_id, property_id, status, created_at) values
        ('cccccccc-cccc-cccc-cccc-cccccccccc11', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb9',
         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa9', 'pending', now()),
        ('cccccccc-cccc-cccc-cccc-cccccccccc12', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb9',
         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa9', 'deferred', now());
      insert into public.customer_message_holds (phone_e164, audience, alert_id, reason, deliver_on, created_at) values
        ('{dig_only}', 'saved_search', 'cccccccc-cccc-cccc-cccc-cccccccccc11', 'quiet', '2026-08-02', now()),
        ('{dig_only}', 'saved_search', 'cccccccc-cccc-cccc-cccc-cccccccccc12', 'quiet', '2026-08-02', now());
    """)
    groups = psql(f"select coalesce(string_agg(x::text, ','), '') from public.customer_digest_groups({base}) d, unnest(d.alert_ids) x")
    if "cccccccccc11" in groups:
        fail("תקציר כולל התראה ממתינה")
    if "cccccccccc12" not in groups:
        fail(f"תקציר לא כולל דחויה: {groups}")

    psql("update public.pricing_config set value = 1 where key = 'customer_send_window_enabled'")
    psql("""
      create table if not exists public.app_push_log (alert_id uuid, device_id uuid);
      create table if not exists public.app_push_devices (
        id uuid primary key, saved_search_id uuid, disabled_at timestamptz
      );
      create or replace function public.app_push_enqueue(
        p_dev uuid, p_title text, p_body text, p_url text, p_kind text, p_alert uuid
      ) returns void language plpgsql as $fn$
      begin
        insert into public.app_push_log (alert_id, device_id) values (p_alert, p_dev);
      end $fn$;
    """)
    push_phone = phone_with_minute(0)
    psql("delete from public.customer_phone_sends; delete from public.customer_phone_day;")
    psql("update public.saved_search_alerts set status = 'skipped' where status = 'deferred'")
    psql(f"""
      insert into public.properties (id, status, city, title) values
        ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa10', 'active', 'עפולה', 'דירה');
      insert into public.saved_searches (id, full_name, phone_e164, status, cities)
      values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb10', 'בדיקה', '{push_phone}', 'active', array['עפולה']);
      insert into public.app_push_devices (id, saved_search_id)
      values ('dddddddd-dddd-dddd-dddd-dddddddddd10', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb10');
      insert into public.saved_search_alerts (id, search_id, property_id, status, created_at)
      values ('cccccccc-cccc-cccc-cccc-cccccccccc10', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb10',
              'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa10', 'deferred', now() - interval '1 hour');
    """)
    psql("select public.customer_prepare(now())")
    expect(
        "select count(*) from public.app_push_log where alert_id = 'cccccccc-cccc-cccc-cccc-cccccccccc10'",
        "1",
        "שחרור ל-pending שולח דחיפה",
    )
    expect(
        f"select sent_count from public.customer_phone_day where contact_key = '{push_phone}'",
        "1",
        "הדחיפה לא תופסת מקום שני",
    )

    one = phone_with_minute(5)
    one_alert = "cccccccc-cccc-cccc-cccc-cccccccccc13"
    psql("delete from public.customer_phone_sends; delete from public.customer_phone_day;")
    expect(
        f"select public.customer_phone_claim('{one}', {at('2026-08-02 10:00:00')}, '{one_alert}', false)",
        "ok",
        "תפיסה ראשונה",
    )
    expect(
        f"select public.customer_phone_claim('{one}', {at('2026-08-02 10:00:00')}, '{one_alert}', false)",
        "already",
        "אותה התראה בשני ערוצים נספרת פעם אחת",
    )
    expect(
        f"select sent_count from public.customer_phone_day where contact_key = '{one}' and day = '2026-08-02'",
        "1",
        "המונה נשאר 1",
    )
    for mins, ref in (("10:20:00", "cccccccc-cccc-cccc-cccc-cccccccccc14"), ("10:40:00", "cccccccc-cccc-cccc-cccc-cccccccccc15")):
        expect(
            f"select public.customer_phone_claim('{one}', {at('2026-08-02 ' + mins)}, '{ref}', false)",
            "ok",
            f"מילוי תקרה {mins}",
        )
    psql(f"""
      insert into public.properties (id, status, city, title) values
        ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa16', 'active', 'עפולה', 'דירה');
      insert into public.saved_searches (id, full_name, phone_e164, email, contact_channel, status, cities)
      values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb16', 'בדיקה', '{one}', 'a@example.com', 'both', 'active', array['עפולה']);
      insert into public.saved_search_alerts (id, search_id, property_id, status, created_at)
      values ('cccccccc-cccc-cccc-cccc-cccccccccc16', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb16',
              'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa16', 'deferred', {at('2026-08-02 09:00:00')});
    """)
    psql(f"select public.customer_prepare({at('2026-08-02 11:00:00')})")
    expect(
        "select status || ' ' || coalesce(last_error, '') from public.saved_search_alerts where id = 'cccccccc-cccc-cccc-cccc-cccccccccc16'",
        "deferred cap",
        "תקרה מלאה דוחה וואטסאפ ומייל יחד",
    )

    psql("update public.pricing_config set value = 0 where key = 'notif_send_window_friday_enabled'")
    psql("update public.pricing_config set value = 0 where key = 'agent_holiday_window_enabled'")
    psql("""
      create or replace function public.agent_reminder_quiet_at(
        p_at timestamptz, p_from int, p_to int, p_days smallint[]
      ) returns boolean language sql immutable as $$ select false; $$;
    """)
    expect(
        f"select public.notification_agent_send_quiet(21, 8, '{{5,6}}', {at('2026-09-21 10:00:00')}, 0)",
        "f",
        "בלי דגל חג, יום כיפור לא נסגר כשדגל שישי כבוי",
    )
    psql("update public.pricing_config set value = 1 where key = 'agent_holiday_window_enabled'")
    expect(
        f"select public.notification_agent_send_quiet(21, 8, '{{5,6}}', {at('2026-09-21 10:00:00')}, 0)",
        "t",
        "דגל חג דלוק ודגל שישי כבוי: יום כיפור סגור",
    )
    expect(
        f"select public.notification_agent_send_quiet(21, 8, '{{5,6}}', {at('2026-09-20 12:00:00')}, 0)",
        "f",
        "ערב חג לפני 13:00 פתוח",
    )
    expect(
        f"select public.notification_agent_send_quiet(21, 8, '{{5,6}}', {at('2026-09-20 13:00:00')}, 0)",
        "t",
        "ערב חג מ-13:00 סגור בלי דגל שישי",
    )

    notify = (ROOT / "supabase/functions/saved-search-notify/index.ts").read_text(encoding="utf-8")
    held = notify.find("if (phoneHeld)")
    wa = notify.find("await sendWhatsapp(")
    em = notify.find("await sendEmail(")
    rel = notify.rfind("customer_phone_release")
    if not (held < wa < em < rel):
        fail("הדחיה המשותפת או שחרור התפיסה לא בסוף")
    if notify.count("customer_phone_release") != 1:
        fail("התפיסה משוחררת יותר מפעם אחת")
    if 'slot.data === "ok" || slot.data === "already"' not in notify:
        fail("already לא נתפס יחד עם ok")
    if "push_sent_at" not in notify:
        fail("already משחרר גם כשיש דחיפה")
    if 'tookClaim && !pushSent && waStatus !== "sent" && emStatus !== "sent"' not in notify:
        fail("שחרור אחרי already בלי שליחה חסר")

    print("✓ תוקף, דילוג, מיזוג, פיזור, מרווח, תקרה, דחיפה, וחגים עד 2028.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
