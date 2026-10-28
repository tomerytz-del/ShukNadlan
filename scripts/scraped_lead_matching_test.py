#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""התאמת ליד מפוסט: דגל כבוי כמו היום, התאמה קודם, גל שני אחרי 30 דקות."""

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/20271030210000_scraped_lead_matching.sql"

SETUP = r"""
create table public.pricing_config (
  key text primary key,
  value int not null,
  description text
);
insert into public.pricing_config (key, value) values
  ('scraped_lead_matching_enabled', 0),
  ('open_demand_notify_cap_enabled', 0),
  ('notif_burst_demand_fanout', 15),
  ('notif_burst_scraped_stale_days', 14),
  ('open_demand_notify_cap', 8),
  ('open_demand_pull_lookback_days', 14);

create table public.agencies (
  id uuid primary key,
  city_id uuid
);
create table public.agency_members (
  id uuid primary key,
  agency_id uuid references public.agencies(id),
  active boolean not null default true,
  tier text not null default 'mid',
  released_at timestamptz,
  license_status text
);
create table public.neighborhoods (
  id uuid primary key,
  city_id uuid
);
create table public.agent_lead_preferences (
  agent_id uuid,
  active boolean,
  preferred_neighborhoods uuid[]
);
create table public.whatsapp_conversations (
  agent_id uuid,
  last_message_at timestamptz
);
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  lead_type text,
  agent_id uuid,
  agency_id uuid,
  status text,
  quota_source text,
  unlocked_at timestamptz,
  unlocked_by uuid,
  raw_name text,
  raw_phone text,
  raw_message text,
  city text,
  neighborhood_id uuid,
  deal_type text,
  property_type text,
  property_details text,
  source text,
  source_detail text,
  external_ref text,
  created_at timestamptz not null default now()
);
create unique index leads_source_ref on public.leads (source, external_ref)
  where external_ref is not null;

create table public.scraped_leads (
  id uuid primary key,
  lead_type text not null,
  status text not null default 'pending_consent',
  source text not null,
  source_detail text,
  post_url text not null,
  external_ref text not null,
  posted_at timestamptz not null default now(),
  raw_name text,
  raw_phone text,
  raw_message text,
  city text not null,
  city_id uuid,
  neighborhood_id uuid,
  deal_type text,
  property_type text,
  rooms numeric,
  budget numeric,
  move_in text,
  property_details text,
  consent_requested_at timestamptz,
  consent_answered_at timestamptz,
  open_demand_at timestamptz,
  lead_id uuid,
  demand_notified_at timestamptz,
  claimed_by uuid,
  claimed_at timestamptz,
  no_broker text,
  push_site_only boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.scraped_lead_blocks (
  ref_hash text primary key,
  expires_at timestamptz not null
);
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid,
  type text,
  title text,
  body text,
  suppress_push boolean,
  related_lead_id uuid,
  created_at timestamptz not null default now()
);
create table public.agent_clients (
  id uuid primary key,
  agent_id uuid not null,
  client_kind text not null default 'seeker',
  status text not null default 'active',
  deal_type text not null default 'sale',
  cities text[] not null default '{}',
  min_rooms numeric,
  max_rooms numeric,
  min_price numeric,
  max_price numeric,
  full_name text not null default 'לקוח'
);
create table public.saved_searches (
  id uuid primary key,
  sold_to_agent_id uuid,
  status text not null default 'active',
  lead_status text not null default 'sold',
  deal_type text not null default 'sale',
  cities text[] not null default '{}',
  neighborhood_ids uuid[] not null default '{}',
  min_rooms numeric,
  max_rooms numeric,
  min_price numeric,
  max_price numeric
);
create table public.properties (
  id uuid primary key,
  agent_id uuid,
  status text,
  listing_expires_at date,
  city_id uuid,
  city text,
  neighborhood_id uuid,
  deal_type text,
  rooms numeric,
  price numeric,
  street text
);

create function public.agent_works_city(p_agent uuid, p_city uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.agency_members m
    join public.agencies a on a.id = m.agency_id
    where m.id = p_agent and a.city_id = p_city
  );
$$;
create function public.agent_handles_type(p_agent uuid, p_type text, p_deal text)
returns boolean language sql stable as $$ select true $$;
create function public.scraped_lead_is_demand(
  p_status text, p_lead_type text, p_no_broker text, p_posted timestamptz, p_city uuid
) returns boolean language sql stable as $$
  select p_city is not null and p_status in ('pending_consent', 'open_demand');
$$;
create function public.notifications_suppress_on()
returns boolean language sql stable as $$ select false $$;
create function public.scraped_leads_launch_active()
returns boolean language sql stable as $$ select false $$;
create function public.log_lead_routing(p jsonb)
returns void language plpgsql as $$ begin return; end $$;
create function public.notification_type_enabled(p_agent uuid, p_type text)
returns boolean language sql stable as $$ select true $$;

create function public.notify_agent_on_new_lead()
returns trigger language plpgsql as $$
begin
  if new.agent_id is null then
    return new;
  end if;
  insert into public.notifications (agent_id, type, title, body, related_lead_id)
  values (new.agent_id, 'new_lead', 'ליד', coalesce(new.city, ''), new.id);
  return new;
end $$;
create trigger leads_notify after insert on public.leads
  for each row execute function public.notify_agent_on_new_lead();
"""


def psql(db, *files, sql_text=None):
    cmd = ["psql", "-v", "ON_ERROR_STOP=1", "-q", "-tA", db]
    if sql_text is not None:
        cmd.extend(["-c", sql_text])
    for path in files:
        cmd.extend(["-f", str(path)])
    return subprocess.check_output(
        cmd,
        env={**os.environ, "PGOPTIONS": "-c client_min_messages=warning"},
        text=True,
    ).strip()


def fail(msg):
    sys.exit(msg)


def main():
    db = os.environ.get("SCRAPED_MATCH_DB", "scraped_match_test")
    subprocess.check_call(["dropdb", "--if-exists", "--maintenance-db=postgres", db])
    subprocess.check_call(["createdb", "--maintenance-db=postgres", db])
    psql(db, sql_text=SETUP)
    psql(db, MIGRATION)
    psql(db, MIGRATION)

    flag = psql(db, sql_text="select value::text from public.pricing_config where key = 'scraped_lead_matching_enabled'")
    if flag != "0":
        fail(f"הדגל לא נולד כבוי: {flag}")

    city = "11111111-1111-1111-1111-111111111111"
    hood = "22222222-2222-2222-2222-222222222222"
    agency = "33333333-3333-3333-3333-333333333333"
    a1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1"
    a2 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2"
    c1 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1"
    c2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2"
    post = "cccccccc-cccc-cccc-cccc-ccccccccccc1"
    prop_ok = "dddddddd-dddd-dddd-dddd-ddddddddddd1"
    prop_old = "dddddddd-dddd-dddd-dddd-ddddddddddd2"
    prop_off = "dddddddd-dddd-dddd-dddd-ddddddddddd3"

    psql(db, sql_text=f"""
      insert into public.neighborhoods (id, city_id) values ('{hood}', '{city}');
      insert into public.agencies (id, city_id) values ('{agency}', '{city}');
      insert into public.agency_members (id, agency_id, tier) values
        ('{a1}', '{agency}', 'free'),
        ('{a2}', '{agency}', 'mid');
      insert into public.agent_clients
        (id, agent_id, client_kind, status, deal_type, cities, min_rooms, max_rooms, max_price, full_name)
      values
        ('{c1}', '{a1}', 'seeker', 'active', 'sale', array['עפולה'], 3, 4, 1500000, 'דנה כהן'),
        ('{c2}', '{a2}', 'seeker', 'active', 'sale', array['עפולה'], 3, 4, 1500000, 'יוסי לוי');
      insert into public.properties
        (id, agent_id, status, listing_expires_at, city_id, city, neighborhood_id, deal_type, rooms, price, street)
      values
        ('{prop_ok}', '{a1}', 'active', current_date + 30, '{city}', 'עפולה', '{hood}', 'sale', 4, 1400000, 'הנשיא'),
        ('{prop_old}', '{a1}', 'active', current_date - 1, '{city}', 'עפולה', null, 'sale', 4, 1400000, 'ישן'),
        ('{prop_off}', '{a2}', 'unpublished', null, '{city}', 'עפולה', null, 'sale', 4, 1400000, 'טיוטה');
    """)

    def reset_post(kind, rooms="4", budget="1600000", deal="'sale'"):
        rooms_sql = "null" if rooms is None else rooms
        budget_sql = "null" if budget is None else budget
        psql(db, sql_text=f"""
          delete from public.scraped_lead_match_dispatch;
          delete from public.notifications;
          delete from public.leads;
          delete from public.scraped_leads;
          insert into public.scraped_leads (
            id, lead_type, status, source, post_url, external_ref, city, city_id,
            neighborhood_id, deal_type, property_type, rooms, budget, posted_at
          ) values (
            '{post}', '{kind}', 'open_demand', 'facebook_group', 'https://facebook.com/groups/1/posts/1',
            'fb:{kind}', 'עפולה', '{city}', '{hood}', {deal}, 'דירה', {rooms_sql}, {budget_sql}, now()
          );
        """)

    reset_post("owner_inbound")
    n = psql(db, sql_text=f"select public.scraped_lead_notify_demand('{post}')")
    if n != "2":
        fail(f"דגל כבוי היה צריך להודיע לשניהם: {n}")
    bodies = psql(db, sql_text="select count(*) from public.notifications where body like '%יש לך לקוח%'")
    if bodies != "0":
        fail("דגל כבוי הוסיף שורת התאמה")
    marked = psql(db, sql_text=f"select demand_notified_at is not null from public.scraped_leads where id = '{post}'")
    if marked != "t":
        fail("דגל כבוי לא סימן שההפצה הסתיימה")
    scores = psql(db, sql_text="select count(*) from public.notifications where match_score is not null")
    if scores != "0":
        fail("דגל כבוי כתב ציון")

    psql(db, sql_text="update public.pricing_config set value = 1 where key = 'scraped_lead_matching_enabled'")
    reset_post("owner_inbound")
    rows = psql(db, sql_text=f"""
      select agent_id::text || '|' || score::text || '|' || match_kind
             || '|' || matched_client_ids::text
        from public.scraped_lead_matches('{post}')
       order by score desc, agent_id
    """)
    lines = [ln for ln in rows.splitlines() if ln]
    if len(lines) != 2:
        fail(f"שתי התאמות לבעלים: {rows}")
    if c2 in lines[0] or c1 not in lines[0] and c1 not in rows:
        fail(f"מזהה לקוח דלף או חסר: {rows}")
    for ln in lines:
        agent, rest = ln.split("|", 1)
        ids = ln.split("|")[-1]
        if agent == a1 and c2 in ids:
            fail("לקוח של סוכן אחר הופיע אצל הראשון")
        if agent == a2 and c1 in ids:
            fail("לקוח פרטי של סוכן אחר הופיע")
    n = psql(db, sql_text=f"select public.scraped_lead_notify_demand('{post}')")
    if n != "2":
        fail(f"שניהם מתאימים ולכן יוצאים יחד: {n}")
    line_n = psql(db, sql_text="select count(*) from public.notifications where body like '%יש לך לקוח שמחפש בדיוק כזה%'")
    if line_n != "2":
        fail(f"חסרה שורת הסיבה: {line_n}")
    phone = psql(db, sql_text="select count(*) from public.notifications where body ~ '[0-9]{9}'")
    if phone != "0":
        fail("ההתראה נושאת מספר")

    # רק הראשון מתאים. השני מחכה.
    psql(db, sql_text=f"update public.agent_clients set cities = array['חיפה'] where id = '{c2}'")
    reset_post("owner_inbound")
    n = psql(db, sql_text=f"select public.scraped_lead_notify_demand('{post}')")
    if n != "1":
        fail(f"גל ראשון היה צריך נמען אחד: {n}")
    who = psql(db, sql_text="select agent_id::text from public.notifications where type = 'open_demand'")
    if who != a1:
        fail(f"הגל הראשון לא הלך למתאים: {who}")
    again = psql(db, sql_text=f"select public.scraped_lead_notify_demand('{post}')")
    if again != "0":
        fail(f"לפני 30 דקות לא אמור לצאת גל שני: {again}")
    still = psql(db, sql_text="select count(*) from public.notifications")
    if still != "1":
        fail("הגל השני יצא מוקדם")
    psql(db, sql_text=f"update public.scraped_leads set match_first_at = now() - interval '31 minutes' where id = '{post}'")
    later = psql(db, sql_text=f"select public.scraped_lead_notify_demand('{post}')")
    if later != "1":
        fail(f"אחרי 30 דקות השני היה צריך לקבל: {later}")
    second = psql(db, sql_text=f"select body from public.notifications where agent_id = '{a2}'")
    if "יש לך לקוח" in second:
        fail("למי שאין התאמה נוספה שורת התאמה")
    done = psql(db, sql_text=f"select demand_notified_at is not null from public.scraped_leads where id = '{post}'")
    if done != "t":
        fail("אחרי הגל השני ההפצה לא נסגרה")

    # נתפס: אין גל שני.
    reset_post("owner_inbound")
    psql(db, sql_text=f"select public.scraped_lead_notify_demand('{post}')")
    psql(db, sql_text=f"""
      update public.scraped_leads
         set claimed_by = '{a1}', match_first_at = now() - interval '31 minutes'
       where id = '{post}'
    """)
    claimed = psql(db, sql_text=f"select public.scraped_lead_notify_demand('{post}')")
    if claimed != "0":
        fail(f"ביקוש שנתפס לא אמור להמשיך: {claimed}")
    if psql(db, sql_text="select count(*) from public.notifications") != "1":
        fail("אחרי תפיסה יצאה התראה נוספת")

    # שדות חסרים: עדיין התאמה, ציון נמוך יותר מפוסט מלא.
    reset_post("owner_inbound", rooms=None, budget=None)
    low = psql(db, sql_text=f"select score::text from public.scraped_lead_matches('{post}') where agent_id = '{a1}'")
    reset_post("owner_inbound")
    high = psql(db, sql_text=f"select score::text from public.scraped_lead_matches('{post}') where agent_id = '{a1}'")
    if not low or not high or int(low) >= int(high):
        fail(f"שדה חסר לא נשאר ציון נמוך: {low} מול {high}")
    if psql(db, sql_text=f"select match_kind from public.scraped_lead_matches('{post}') where agent_id = '{a1}'") != "has_seeker":
        fail("ליד בעלים לא סומן has_seeker")

    # מחפש/ת: נכס פעיל נספר, פג תוקף וטיוטה לא.
    reset_post("seeker_inbound", rooms="4", budget="1600000")
    props = psql(db, sql_text=f"""
      select agent_id::text || '|' || matched_property_ids::text || '|' || score::text
        from public.scraped_lead_matches('{post}')
       order by agent_id
    """)
    if a2 in props:
        fail(f"נכס שלא באוויר נספר: {props}")
    if prop_old in props or prop_off in props:
        fail(f"נכס שפג או טיוטה נכנסו: {props}")
    if prop_ok not in props or "has_property" not in psql(
        db, sql_text=f"select match_kind from public.scraped_lead_matches('{post}')"
    ):
        fail(f"הנכס הפעיל לא בהתאמה: {props}")
    psql(db, sql_text="update public.pricing_config set value = 1 where key = 'scraped_lead_matching_enabled'")
    psql(db, sql_text=f"select public.scraped_lead_notify_demand('{post}')")
    body = psql(db, sql_text=f"select body from public.notifications where agent_id = '{a1}'")
    if "הנשיא" not in body or "4 חד" not in body:
        fail(f"שורת הנכס חסרה: {body}")
    if "ישן" in body or "טיוטה" in body:
        fail("רחוב של נכס לא כשיר נכנס להודעה")

    # הסכמה: ליד בעלים לא הולך ל-free. a1 עולה ל-mid, ורק לו יש לקוח בעיר.
    psql(db, sql_text=f"update public.agency_members set tier = 'mid' where id = '{a1}'")
    psql(db, sql_text=f"""
      delete from public.notifications;
      delete from public.leads;
      delete from public.scraped_lead_match_dispatch;
      delete from public.scraped_leads;
      insert into public.scraped_leads (
        id, lead_type, status, source, post_url, external_ref, city, city_id,
        deal_type, property_type, rooms, budget, move_in, posted_at, raw_name
      ) values (
        '{post}', 'owner_inbound', 'pending_consent', 'facebook_group',
        'https://facebook.com/groups/1/posts/9', 'fb:consent', 'עפולה', '{city}',
        'sale', 'דירה', 4, 1400000, 'מיידי', now(), 'דנה'
      );
    """)
    # a2's client is in Haifa, so only a1 matches. Give a2 a tighter client in Afula with a lower score
    # by leaving cities as Haifa. a1 should win.
    assigned = psql(db, sql_text=f"select public.scraped_lead_set_consent('{post}', 'consented') ->> 'assigned_by'")
    agent = psql(db, sql_text=f"select agent_id::text from public.leads")
    if assigned != "match" or agent != a1:
        fail(f"ההסכמה לא הלכה לציון הגבוה: {assigned} {agent}")
    copied = psql(db, sql_text="select budget::text || '|' || rooms::text || '|' || move_in || '|' || budget_source || '|' || rooms_source || '|' || move_in_source from public.leads")
    if copied != "1400000|4|מיידי|scraped_lead|scraped_lead|scraped_lead":
        fail(f"השדות לא הועתקו: {copied}")
    note = psql(db, sql_text="select body from public.notifications where type = 'new_lead'")
    if "יש לך לקוח" not in note:
        fail(f"התראת הליד בלי שורת ההתאמה: {note}")

    # דגל כבוי: הסבב לפי id, לא לפי ציון. רק ל-a2 יש לקוח בעיר, ועדיין a1 קודם.
    psql(db, sql_text="update public.pricing_config set value = 0 where key = 'scraped_lead_matching_enabled'")
    psql(db, sql_text=f"""
      update public.agent_clients set cities = array['חיפה'] where id = '{c1}';
      update public.agent_clients set cities = array['עפולה'] where id = '{c2}';
    """)
    psql(db, sql_text=f"""
      delete from public.notifications;
      delete from public.leads;
      delete from public.scraped_leads;
      insert into public.scraped_leads (
        id, lead_type, status, source, post_url, external_ref, city, city_id,
        deal_type, property_type, posted_at
      ) values (
        '{post}', 'owner_inbound', 'pending_consent', 'facebook_group',
        'https://facebook.com/groups/1/posts/8', 'fb:rot', 'עפולה', '{city}',
        'sale', 'דירה', now()
      );
    """)
    off = psql(db, sql_text=f"select public.scraped_lead_set_consent('{post}', 'consented') ->> 'assigned_by'")
    who = psql(db, sql_text="select agent_id::text from public.leads")
    if off != "rotation" or who != a1:
        fail(f"דגל כבוי לא נשאר בסבב: {off} {who}")
    if psql(db, sql_text="select count(*) from public.notifications where match_score is not null") != "0":
        fail("דגל כבוי כתב ציון על ליד")

    rest = psql(db, sql_text="select public.scraped_lead_matching_rest()")
    if rest != "0":
        fail(f"גל שני כשהדגל כבוי: {rest}")
    print("scraped lead matching: ok")


if __name__ == "__main__":
    main()
