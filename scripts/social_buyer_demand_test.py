#!/usr/bin/env python3
"""מחפש/ת מהרשתות יורד/ת לביקוש הפתוח רק כשהדגל 1.

הטריגר רץ אחרי insert ל-saved_searches. הוא לא נוגע ב-social-lead-intake,
לא קורא ל-scraped_lead_notify_demand, ולא מעתיק שם או טלפון.

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
    # ‏psql -c מדפיס אחרי RETURNING גם את תגית הפקודה (INSERT 0 1).
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
    if "scraped_lead_notify_demand" in code:
        fail("הטריגר קורא להתראה")
    if "notify_agent_on_new_lead" in code or "notifications_apply_preferences" in code:
        fail("הטריגר נוגע בפונקציות שאסור לשנות")

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
  lead_status text default 'new', agency_id uuid, sold_to_agent_id uuid
);
create table public.scraped_leads (
  id uuid primary key default gen_random_uuid(),
  lead_type text, status text, source text, source_detail text,
  post_url text, external_ref text, posted_at timestamptz, city text, city_id uuid,
  deal_type text, property_type text, rooms numeric, budget numeric,
  demand_summary text, open_demand_at timestamptz,
  raw_name text, raw_phone text, raw_message text,
  unique (source, external_ref)
);
"""
        setup += extract(MIG, "social_buyer_to_open_demand(")
        trig = src[src.find("drop trigger if exists social_buyer_to_open_demand"):]
        setup += trig
        psql_script(setup)

        def add_social(ref, kind, phone, email=""):
            psql_script(
                "insert into public.social_leads (zernio_id, channel, kind, status, payload) values ("
                f"'{ref}', 'facebook_dm', '{kind}', 'routing', "
                f"jsonb_build_object('phone', '{phone}', 'email', '{email}'));"
            )

        def add_search(phone, city, email="", source="facebook_dm", agency="null"):
            city_sql = "null" if city is None else f"array['{city}']"
            # הטריגר הוא AFTER INSERT ומעדכן את השורה. RETURNING רואה את
            # הערך שנכנס ('new'), לא את הארכיון.
            sid = psql(
                "insert into public.saved_searches "
                "(full_name, phone, phone_e164, email, source, cities, property_types, "
                "deal_type, min_rooms, max_price, agency_id) values ("
                f"'דנה כהן', '{phone}', '{phone}', '{email}', '{source}', {city_sql}, "
                f"array['דירה'], 'sale', 4, 1500000, {agency}) returning id"
            )
            return psql(f"select lead_status from public.saved_searches where id = '{sid}'")

        add_social("z-off", "buyer", "0501234567")
        status = add_search("0501234567", "עפולה")
        if status != "new" or psql("select count(*) from public.scraped_leads") != "0":
            fail(f"דגל 0 שינה את המדף ({status})")
        print("✓ דגל 0 משאיר במדף")

        psql("update public.pricing_config set value = 1 where key = 'social_buyer_open_demand_enabled'")
        add_social("z-buyer", "buyer", "0501234567")
        status = add_search("0501234567", "עפולה")
        if status != "archived":
            fail(f"החיפוש לא ירד מהמדף ({status})")
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
            fail(f"חסר עיר או מזהה: {row}")
        if not row.endswith("https://shuknadlan.co.il/crm?goto=accLeads&tab=demand"):
            fail(f"post_url: {row}")
        if "4 חדרים" not in row or "מחפש/ת לקנות" not in row:
            fail(f"הסיכום חסר: {row}")
        print("✓ דגל 1: ארכיון וביקוש פתוח בלי שם ובלי טלפון")

        add_social("z-nocity", "buyer", "0509999999")
        status = add_search("0509999999", None)
        if status != "new" or psql("select count(*) from public.scraped_leads where external_ref = 'z-nocity'") != "0":
            fail("בלי עיר ירד מהמדף")
        print("✓ בלי עיר נשאר במדף")

        add_social("z-unknown", "buyer", "0508888888")
        status = add_search("0508888888", "עיר לא קיימת")
        if status != "new":
            fail("עיר לא מזוהה ירדה מהמדף")
        print("✓ עיר לא מזוהה נשארת במדף")

        add_social("z-prop", "property", "0507777777")
        status = add_search("0507777777", "עפולה")
        if status != "new" or psql("select count(*) from public.scraped_leads where external_ref = 'z-prop'") != "0":
            fail("פניית נכס נכנסה לביקוש")
        print("✓ kind=property נשאר במדף")

        status = add_search("0506666666", "עפולה")
        if status != "new":
            fail("חיפוש בלי שורת social_leads ירד מהמדף")
        print("✓ בלי שורת buyer נשאר במדף")

        add_social("z-mail", "buyer", "", email="dana@example.com")
        sid = psql(
            "insert into public.saved_searches (full_name, email, source, cities, deal_type) "
            "values ('דנה', 'dana@example.com', 'facebook_dm', array['עפולה'], 'rent') "
            "returning id"
        )
        status = psql(f"select lead_status from public.saved_searches where id = '{sid}'")
        if status != "archived":
            fail("התאמת מייל לא העבירה")
        summary = psql("select demand_summary from public.scraped_leads where external_ref = 'z-mail'")
        if summary != "מחפש/ת לשכור" or "דנה" in (summary or ""):
            fail(f"סיכום מייל: {summary}")
        print("✓ התאמת מייל, בלי שם בסיכום")

        add_social("z-owned", "buyer", "0505555555")
        status = add_search("0505555555", "עפולה", agency="'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'")
        if status != "new" or psql("select count(*) from public.scraped_leads where external_ref = 'z-owned'") != "0":
            fail("חיפוש משויך ירד מהמדף")
        print("✓ חיפוש שכבר משויך נשאר במדף")

        if psql("select count(*) from public.scraped_leads") != "2":
            fail("נוצרו שורות מיותרות")
        print("עבר")
        return 0
    finally:
        subprocess.run(["dropdb", "--if-exists", DB], check=False)


if __name__ == "__main__":
    sys.exit(main())
