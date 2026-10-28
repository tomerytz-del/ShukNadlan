#!/usr/bin/env python3
"""מחפש/ת מהרשתות יורד/ת לביקוש הפתוח רק כשהדגל 1 ושתי התקרות דלוקות.

הטריגר רץ אחרי insert ל-saved_searches. הוא לא נוגע ב-social-lead-intake,
לא קורא ל-scraped_lead_notify_demand, ולא מעתיק שם או טלפון.
lead_status=archived לא משנה את status של מנוי ההתראות.

    python3 scripts/social_buyer_demand_test.py
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MIG = ROOT / "supabase/migrations/20271029240000_social_buyer_open_demand.sql"
DB = os.environ.get("SOCIAL_BUYER_TEST_DB", "social_buyer_demand_test")
CITY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
AGENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

HELPERS = (
    "social_buyer_num(",
    "social_buyer_is_dm(",
    "social_buyer_conversation_id(",
    "social_buyer_search_conversation_id(",
    "social_buyer_caps_ready(",
    "social_buyer_handover(",
    "social_buyer_to_open_demand(",
    "open_demand_claim(",
    "scraped_lead_notify_demand(",
)


def fail(msg: str) -> None:
    print(f"✗ {msg}")
    sys.exit(1)


def extract(path: Path, name: str) -> str:
    text = path.read_text(encoding="utf-8")
    needle = f"function public.{name}"
    idx = text.find(needle)
    if idx < 0:
        fail(f"לא נמצאה {name}")
    start = text.rfind("create or replace function", 0, idx + len("function"))
    dollar = text.find("$$", start)
    end = text.find("$$", dollar + 2)
    if min(start, dollar, end) < 0:
        fail(f"לא חולצה {name}")
    return text[start:end + 2] + ";\n"


def psql(sql: str) -> str:
    proc = subprocess.run(
        ["psql", "-v", "ON_ERROR_STOP=1", "-d", DB, "-At", "-c", sql],
        text=True, capture_output=True,
    )
    if proc.returncode != 0:
        fail(f"psql:\n{proc.stderr}\n{sql[:500]}")
    lines = proc.stdout.strip().splitlines()
    if lines and re.match(r"^(INSERT|UPDATE|DELETE|MERGE)\b", lines[-1]):
        lines = lines[:-1]
    return "\n".join(lines).strip()


def psql_script(sql: str) -> None:
    proc = subprocess.run(
        ["psql", "-v", "ON_ERROR_STOP=1", "-d", DB],
        text=True, input=sql, capture_output=True,
    )
    if proc.returncode != 0:
        fail(f"psql:\n{proc.stderr[-2500:]}")


def main() -> int:
    src = MIG.read_text(encoding="utf-8")
    code = re.sub(r"--[^\n]*", "", src)
    if "('social_buyer_open_demand_enabled', 0," not in src:
        fail("הדגל אינו נולד 0")
    trigger = extract(MIG, "social_buyer_to_open_demand(")
    if "scraped_lead_notify_demand" in trigger:
        fail("הטריגר קורא להתראה")
    if re.search(r"\b(select|perform)\s+(public\.)?scraped_lead_notify_demand\s*\(", code):
        fail("המיגרציה מפעילה התראה (מילוי לאחור)")
    if "notify_agent_on_new_lead" in code or "notifications_apply_preferences" in code:
        fail("הטריגר נוגע בפונקציות שאסור לשנות")
    social_arm = src.split("when v_social", 1)[1].split("else", 1)[0]
    if "פוסט" in social_arm:
        fail("נוסח השיחה כולל את המילה פוסט")
    if "social_buyer_handover" not in extract(MIG, "open_demand_claim("):
        fail("התפיסה לא קוראת למסירה")

    subprocess.run(["dropdb", "--if-exists", DB], check=False)
    subprocess.run(["createdb", DB], check=True)
    try:
        setup = """
create function public.phone_tail9(p text) returns text language sql immutable as $$
  select case when length(regexp_replace(coalesce(p, ''), '\\D', '', 'g')) >= 9
              then right(regexp_replace(p, '\\D', '', 'g'), 9) end;
$$;
create function public.city_id_for_name(p_name text) returns uuid language sql stable as $$
  select case when btrim(coalesce(p_name, '')) = 'עפולה' then '""" + CITY + """'::uuid end;
$$;
create function public.lead_source_label(p text) returns text language sql immutable as $$
  select case when p = 'facebook_dm' then 'פייסבוק' end;
$$;
create function public.current_agent_id() returns uuid language sql stable as $$
  select '""" + AGENT + """'::uuid;
$$;
create function public.agent_works_city(p_agent uuid, p_city uuid) returns boolean
language sql stable as $$ select true $$;
create function public.agent_handles_type(p_agent uuid, p_type text, p_deal text)
returns boolean language sql stable as $$ select true $$;
create function public.notification_type_enabled(p_agent uuid, p_type text)
returns boolean language sql stable as $$ select true $$;
create function public.scraped_lead_is_demand(
  p_status text, p_lead_type text, p_no_broker text, p_posted_at timestamptz, p_city_id uuid
) returns boolean language sql stable as $$ select true $$;
create function public.notifications_suppress_on() returns boolean language sql stable as $$
  select false $$;
create table public.pricing_config (key text primary key, value int, description text);
insert into public.pricing_config (key, value) values ('social_buyer_open_demand_enabled', 0);
create table public.social_leads (
  zernio_id text primary key, channel text, kind text, payload jsonb,
  status text, received_at timestamptz default now()
);
create table public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  full_name text, phone text, phone_e164 text, email text, source text,
  cities text[], property_types text[], deal_type text,
  min_rooms numeric, max_rooms numeric, min_price numeric, max_price numeric,
  lead_status text default 'new', status text default 'active',
  agency_id uuid, sold_to_agent_id uuid
);
create table public.scraped_leads (
  id uuid primary key default gen_random_uuid(),
  lead_type text, status text, source text, source_detail text,
  post_url text, external_ref text, posted_at timestamptz, city text, city_id uuid,
  deal_type text, property_type text, rooms numeric, budget numeric,
  demand_summary text, open_demand_at timestamptz,
  raw_name text, raw_phone text, raw_message text,
  move_in text, no_broker text, push_site_only boolean default false,
  demand_notified_at timestamptz, claimed_by uuid, claimed_at timestamptz,
  created_at timestamptz default now(),
  unique (source, external_ref)
);
create table public.agency_members (
  id uuid primary key default gen_random_uuid(),
  active boolean default true,
  released_at timestamptz,
  license_status text,
  agency_id uuid
);
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  unlocked_by uuid, unlocked_at timestamptz, created_at timestamptz default now()
);
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid, type text, title text, body text,
  suppress_push boolean, created_at timestamptz default now()
);
"""
        for name in HELPERS:
            if name == "open_demand_claim(":
                continue
            if name == "scraped_lead_notify_demand(":
                continue
            setup += extract(MIG, name)
        trig = src[src.find("drop trigger if exists social_buyer_to_open_demand"):]
        trig = trig[:trig.find("create or replace function public.open_demand_list")]
        setup += trig
        psql_script(setup)

        def add_social(ref, kind, phone, email="", extra=""):
            payload = f"'phone', '{phone}', 'email', '{email}'"
            if extra:
                payload += ", " + extra
            psql_script(
                "insert into public.social_leads (zernio_id, channel, kind, status, payload) values ("
                f"'{ref}', 'facebook_dm', '{kind}', 'routing', jsonb_build_object({payload}));"
            )

        def add_search(phone, city, email="", source="facebook_dm", agency="null",
                       rooms="4", deal="sale", max_price="1500000", ptype="דירה"):
            city_sql = "null" if city is None else f"array['{city}']"
            ptype_sql = "null" if ptype is None else f"array['{ptype}']"
            rooms_sql = "null" if rooms is None else rooms
            max_rooms = "null" if rooms is None else f"{rooms} + 0.5"
            price_sql = "null" if max_price is None else max_price
            sid = psql(
                "insert into public.saved_searches "
                "(full_name, phone, phone_e164, email, source, cities, property_types, "
                "deal_type, min_rooms, max_rooms, max_price, agency_id, status) values ("
                f"'דנה כהן', '{phone}', '{phone}', '{email}', '{source}', {city_sql}, {ptype_sql}, "
                f"'{deal}', {rooms_sql}, {max_rooms}, {price_sql}, {agency}, 'active') returning id"
            )
            return sid, psql(
                f"select lead_status || '|' || status from public.saved_searches where id = '{sid}'"
            )

        add_social("z-off", "buyer", "0501234567")
        _sid, status = add_search("0501234567", "עפולה")
        if status != "new|active" or psql("select count(*) from public.scraped_leads") != "0":
            fail(f"דגל 0 שינה את המדף ({status})")
        print("✓ דגל 0 משאיר במדף")

        psql("update public.pricing_config set value = 1 where key = 'social_buyer_open_demand_enabled'")
        add_social("z-nocap", "buyer", "0501234500")
        _sid, status = add_search("0501234500", "עפולה")
        if status != "new|active" or psql("select count(*) from public.scraped_leads") != "0":
            fail("דגל 1 בלי תקרות העביר למדף הביקוש")
        print("✓ דגל 1 בלי שתי התקרות נשאר במדף")

        psql_script("""
create table public.open_demand_notify_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  scraped_lead_id uuid, agent_id uuid, rank int, reason text,
  last_pull_at timestamptz, last_notified_at timestamptz,
  cap int, lookback_days int
);
create function public.whatsapp_template_cap_on() returns boolean language sql stable as $$
  select true $$;
insert into public.pricing_config (key, value) values
  ('open_demand_notify_cap_enabled', 0),
  ('open_demand_notify_cap', 8),
  ('open_demand_pull_lookback_days', 14),
  ('open_demand_claims_daily', 2);
""")
        add_social("z-capoff", "buyer", "0501234501")
        _sid, status = add_search("0501234501", "עפולה")
        if status != "new|active":
            fail("תקרת ביקוש כבויה העבירה")
        psql("update public.pricing_config set value = 1 where key = 'open_demand_notify_cap_enabled'")
        psql("update public.pricing_config set value = 0 where key = 'social_buyer_open_demand_enabled'")
        # תבנית כבויה: מחליפים את הפונקציה ל-false, הדגל של המחפש/ת דלוק
        psql_script("create or replace function public.whatsapp_template_cap_on() returns boolean language sql stable as $$ select false $$;")
        psql("update public.pricing_config set value = 1 where key = 'social_buyer_open_demand_enabled'")
        add_social("z-tploff", "buyer", "0501234502")
        _sid, status = add_search("0501234502", "עפולה")
        if status != "new|active":
            fail("תקרת תבניות כבויה העבירה")
        psql_script("create or replace function public.whatsapp_template_cap_on() returns boolean language sql stable as $$ select true $$;")
        print("✓ בלי תקרת ביקוש או בלי תקרת תבניות נשאר במדף")

        add_social("z-buyer", "buyer", "0501234567",
                   extra="'city', 'עפולה', 'deal_type', 'sale', 'property_type', 'דירה', 'rooms', '4', 'max_price', '1500000'")
        # חיפוש אחר של אותו טלפון, חדש יותר, לא ייצמד
        psql_script(
            "insert into public.social_leads (zernio_id, channel, kind, status, received_at, payload) values ("
            "'z-other', 'facebook_dm', 'buyer', 'routing', now(), "
            "jsonb_build_object('phone', '0501234567', 'city', 'עפולה', 'deal_type', 'rent', "
            "'property_type', 'דירה', 'rooms', '2', 'max_price', '4000'));"
        )
        sid, status = add_search("0501234567", "עפולה")
        if status != "archived|active":
            fail(f"החיפוש לא ירד מהמדף, או שההתראות נעצרו ({status})")
        row = psql(
            "select status || '|' || lead_type || '|' || coalesce(raw_phone, '') || '|' "
            "|| coalesce(raw_name, '') || '|' || coalesce(demand_summary, '') || '|' "
            "|| city_id::text || '|' || external_ref || '|' || post_url "
            "from public.scraped_leads where external_ref = 'z-buyer'"
        )
        if not row.startswith("open_demand|seeker_inbound|||"):
            fail(f"השורה אינה אנונימית: {row}")
        if "דנה" in row or "0501234567" in row:
            fail(f"פירט מזהה בסיכום: {row}")
        if CITY not in row or "z-buyer" not in row:
            fail(f"נצמד לחיפוש הלא נכון או חסר עיר: {row}")
        if "z-other" in row:
            fail(f"נצמד לחיפוש האחר של אותו טלפון: {row}")
        if not row.endswith("https://shuknadlan.co.il/crm?goto=accLeads&tab=demand"):
            fail(f"post_url: {row}")
        if "4 חדרים" not in row or "מחפש/ת לקנות" not in row:
            fail(f"הסיכום חסר: {row}")
        print("✓ דגל 1 ותקרות: ארכיון בלי לעצור התראות, והקריטריונים בוחרים את השורה")

        hand = psql(
            "select public.social_buyer_handover(id)::text from public.scraped_leads "
            "where external_ref = 'z-buyer'"
        )
        if "pending" not in hand or "post_url" in hand or "phone" in hand or "050" in hand or "דנה" in hand:
            fail(f"המסירה חשפה פרטים: {hand}")
        print("✓ המסירה pending בלי שם ובלי טלפון")

        psql_script(extract(MIG, "open_demand_claim("))
        claimed = psql(
            "select public.open_demand_claim(id)::text from public.scraped_leads "
            "where external_ref = 'z-buyer'"
        )
        if "pending" not in claimed or "post_url" in claimed or "phone" in claimed or "דנה" in claimed:
            fail(f"אני פונה החזיר קישור או פרטים: {claimed}")
        print("✓ אני פונה קורא למסירה ולא לכתובת")

        add_social("z-nocity", "buyer", "0509999999")
        _sid, status = add_search("0509999999", None, rooms=None, max_price=None, ptype=None)
        if not status.startswith("new|") or psql("select count(*) from public.scraped_leads where external_ref = 'z-nocity'") != "0":
            fail("בלי עיר ירד מהמדף")
        print("✓ בלי עיר נשאר במדף")

        add_social("z-unknown", "buyer", "0508888888", extra="'city', 'עיר לא קיימת'")
        _sid, status = add_search("0508888888", "עיר לא קיימת", rooms=None, max_price=None, ptype=None)
        if not status.startswith("new|"):
            fail("עיר לא מזוהה ירדה מהמדף")
        print("✓ עיר לא מזוהה נשארת במדף")

        add_social("z-prop", "property", "0507777777")
        _sid, status = add_search("0507777777", "עפולה")
        if not status.startswith("new|") or psql("select count(*) from public.scraped_leads where external_ref = 'z-prop'") != "0":
            fail("פניית נכס נכנסה לביקוש")
        print("✓ kind=property נשאר במדף")

        _sid, status = add_search("0506666666", "עפולה")
        if not status.startswith("new|"):
            fail("חיפוש בלי שורת social_leads ירד מהמדף")
        print("✓ בלי שורת buyer נשאר במדף")

        add_social("z-mail", "buyer", "", email="dana@example.com",
                   extra="'city', 'עפולה', 'deal_type', 'rent'")
        sid = psql(
            "insert into public.saved_searches (full_name, email, source, cities, deal_type, status) "
            "values ('דנה', 'dana@example.com', 'facebook_dm', array['עפולה'], 'rent', 'active') "
            "returning id"
        )
        status = psql(f"select lead_status || '|' || status from public.saved_searches where id = '{sid}'")
        if status != "archived|active":
            fail(f"התאמת מייל לא העבירה ({status})")
        summary = psql("select demand_summary from public.scraped_leads where external_ref = 'z-mail'")
        if summary != "מחפש/ת לשכור" or "דנה" in (summary or ""):
            fail(f"סיכום מייל: {summary}")
        print("✓ התאמת מייל, בלי שם בסיכום")

        add_social("z-owned", "buyer", "0505555555", extra="'city', 'עפולה'")
        _sid, status = add_search("0505555555", "עפולה", agency=f"'{AGENT}'")
        if not status.startswith("new|") or psql("select count(*) from public.scraped_leads where external_ref = 'z-owned'") != "0":
            fail("חיפוש משויך ירד מהמדף")
        print("✓ חיפוש שכבר משויך נשאר במדף")

        # 12 סוכנים, 3 תפסו ליד לאחרונה. התקרה 8 לוקחת רק מי שלא תפס/ה.
        psql_script("""
insert into public.agency_members (active, license_status)
select true, 'active' from generate_series(1, 12);
insert into public.leads (unlocked_by, unlocked_at, created_at)
select id, now(), now() - interval '2 days'
  from public.agency_members
 order by id
 limit 3;
""")
        psql_script(extract(MIG, "scraped_lead_notify_demand("))
        n = psql(
            "select public.scraped_lead_notify_demand(id) from public.scraped_leads "
            "where external_ref = 'z-mail'"
        )
        if n != "8":
            fail(f"התקרה לא חתכה ל-8 ({n})")
        body = psql("select distinct body from public.notifications")
        if "פוסט" in body or "גבריאלה" not in body or "050" in body or "דנה" in body:
            fail(f"נוסח ההתראה: {body}")
        pulls = psql(
            "select count(*) from public.open_demand_notify_log l "
            "join public.leads d on d.unlocked_by = l.agent_id"
        )
        if pulls != "0":
            fail(f"נבחרו סוכנים שתפסו ליד: {pulls}")
        print("✓ התראת שיחה: 8 בלי תפיסה אחרונה, בלי המילה פוסט")

        psql_script(
            "create or replace function public.social_buyer_search_conversation_id(p_search_id uuid)\n"
            "returns text language sql stable as $$ select 'conv-a' $$;"
        )
        psql_script(
            "insert into public.social_leads (zernio_id, channel, kind, status, received_at, payload) values "
            "('z-conv-b', 'facebook_dm', 'buyer', 'routing', now(), "
            "jsonb_build_object('phone', '0501234333', 'city', 'עפולה', 'deal_type', 'sale', "
            "'property_type', 'דירה', 'rooms', '4', 'max_price', '1500000', 'conversation_id', 'conv-b')),"
            "('z-conv-a', 'facebook_dm', 'buyer', 'routing', now() - interval '5 minutes', "
            "jsonb_build_object('phone', '0501234333', 'city', 'עפולה', 'deal_type', 'sale', "
            "'property_type', 'דירה', 'rooms', '4', 'max_price', '1500000', 'conversation_id', 'conv-a'));"
        )
        _sid, status = add_search("0501234333", "עפולה")
        if status != "archived|active":
            fail(f"מזהה שיחה לא העביר ({status})")
        ref = psql("select external_ref from public.scraped_leads where external_ref like 'z-conv-%'")
        if ref != "z-conv-a":
            fail(f"נצמד לשיחה הלא נכונה: {ref}")
        print("✓ מזהה שיחה, כשהחיפוש נושא אחד, גובר על השורה החדשה יותר")

        if psql("select count(*) from public.scraped_leads") != "3":
            fail("נוצרו שורות מיותרות")
        print("עבר")
        return 0
    finally:
        subprocess.run(["dropdb", "--if-exists", DB], check=False)


if __name__ == "__main__":
    sys.exit(main())
