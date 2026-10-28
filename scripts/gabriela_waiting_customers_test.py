#!/usr/bin/env python3
"""לקוחות שמחכים אחרי מענה חלופי של הבוט הציבורי.

הפונקציה מחזירה שורה אחת לשיחה: המענה האחרון ב-48 שעות, אם עברו שעתיים
ואין אחריו תשובת בוט. לא טלפון ולא גוף. רק service_role.

    python3 scripts/gabriela_waiting_customers_test.py
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MIG = ROOT / "supabase/migrations/20271030000400_gabriela_waiting_customers.sql"
DB = os.environ.get("GABRIELA_WAITING_TEST_DB", "gabriela_waiting_test")


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
        fail(f"psql נכשל על {path.name}:\n{proc.stderr[-2000:]}")


def main() -> int:
    src = MIG.read_text(encoding="utf-8")
    if "returns table" not in src or "conversation_id uuid" not in src:
        fail("החתימה אינה מזהה שיחה")
    if "fallback_at timestamptz" not in src or "window_open boolean" not in src:
        fail("חסר זמן מענה או חלון")
    returns = src.split("returns table", 1)[1].split(")", 1)[0]
    for banned in ("wa_phone", "body", "phone"):
        if banned in returns:
            fail(f"התוצאה כוללת {banned}")
    if "revoke all on function public.gabriela_waiting_customers() from public, anon, authenticated" not in src:
        fail("אין revoke מ-public, anon, authenticated")
    if "grant execute on function public.gabriela_waiting_customers() to service_role" not in src:
        fail("אין grant ל-service_role")
    if "security definer" not in src.lower() or "search_path = ''" not in src:
        fail("הפונקציה אינה definer עם search_path ריק")
    if "distinct on (f.conversation_id)" not in src or "interval '48 hours'" not in src:
        fail("אין שורה אחת לשיחה או אין גבול של 48 שעות")
    if "interval '2 minutes'" in src:
        fail("המענה החלופי עדיין מזוהה לפי חלון של שתי דקות")
    other = "סליחה, משהו השתבש אצלי רגע לפני שעניתי. אפשר לשלוח לי את ההודעה שוב?"
    bill = "סליחה, אני לא זמינה כרגע בגלל תקלה אצלי. אפשר לנסות שוב מאוחר יותר, או לחפש נכסים באתר בינתיים: https://shuknadlan.co.il"
    if other not in src or bill not in src:
        fail("הנוסח המאושר אינו מסומן כמענה חלופי")

    subprocess.run(["dropdb", "--if-exists", DB], check=False)
    subprocess.run(["createdb", DB], check=True)
    setup = """
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role;
  end if;
end $$;

create table public.whatsapp_public_conversations (
  id uuid primary key,
  wa_phone text not null unique
);
create table public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  direction text not null,
  wa_phone text not null,
  agent_id uuid,
  msg_type text not null default 'text',
  body text,
  error text,
  status text,
  created_at timestamptz not null default now()
);
create table public.gabriela_llm_fallbacks (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  channel text not null,
  created_at timestamptz not null default now(),
  reason text not null,
  sent boolean not null default false
);
"""
    proc = subprocess.run(
        ["psql", "-v", "ON_ERROR_STOP=1", "-d", DB],
        text=True, input=setup, capture_output=True,
    )
    if proc.returncode != 0:
        fail(f"הקמה נכשלה:\n{proc.stderr[-2000:]}")
    psql_file(MIG)

    seed = r"""
begin;
create temp table tclock as select clock_timestamp() as t;
insert into public.whatsapp_public_conversations (id, wa_phone) values
  ('10000000-0000-4000-8000-000000000001', '972500000001'),
  ('10000000-0000-4000-8000-000000000002', '972500000002'),
  ('10000000-0000-4000-8000-000000000003', '972500000003'),
  ('10000000-0000-4000-8000-000000000004', '972500000004'),
  ('10000000-0000-4000-8000-000000000005', '972500000005'),
  ('10000000-0000-4000-8000-000000000007', '972500000007'),
  ('10000000-0000-4000-8000-000000000008', '972500000008'),
  ('10000000-0000-4000-8000-000000000009', '972500000009'),
  ('10000000-0000-4000-8000-000000000010', '972500000010'),
  ('10000000-0000-4000-8000-000000000011', '972500000011'),
  ('10000000-0000-4000-8000-000000000012', '972500000012'),
  ('10000000-0000-4000-8000-000000000013', '972500000013'),
  ('10000000-0000-4000-8000-000000000014', '972500000014');

-- 1. מחכה, החלון פתוח. רק שליחת המענה עצמו.
insert into public.gabriela_llm_fallbacks (conversation_id, channel, reason, sent, created_at)
values ('10000000-0000-4000-8000-000000000001', 'public', 'other', true, (select t from tclock) - interval '3 hours');
insert into public.whatsapp_messages (direction, wa_phone, body, status, created_at) values
  ('in', '972500000001', 'הודעה נכנסת', null, (select t from tclock) - interval '1 hour'),
  ('out', '972500000001', 'סליחה, משהו השתבש אצלי רגע לפני שעניתי. אפשר לשלוח לי את ההודעה שוב?', 'sent', (select t from tclock) - interval '3 hours' + interval '5 seconds');

-- 2. מחכה, החלון סגור (נכנסת אחרונה לפני 30 שעות).
insert into public.gabriela_llm_fallbacks (conversation_id, channel, reason, sent, created_at)
values ('10000000-0000-4000-8000-000000000002', 'public', 'billing', true, (select t from tclock) - interval '5 hours');
insert into public.whatsapp_messages (direction, wa_phone, body, status, created_at) values
  ('in', '972500000002', 'ישנה', null, (select t from tclock) - interval '30 hours'),
  ('out', '972500000002', 'סליחה, משהו השתבש אצלי רגע לפני שעניתי. אפשר לשלוח לי את ההודעה שוב?', 'sent', (select t from tclock) - interval '5 hours' + interval '2 seconds');

-- 3. תשובה אמיתית אחרי 30 דקות.
insert into public.gabriela_llm_fallbacks (conversation_id, channel, reason, sent, created_at)
values ('10000000-0000-4000-8000-000000000003', 'public', 'other', true, (select t from tclock) - interval '4 hours');
insert into public.whatsapp_messages (direction, wa_phone, body, status, created_at) values
  ('in', '972500000003', 'עוד', null, (select t from tclock) - interval '2 hours'),
  ('out', '972500000003', 'סליחה, משהו השתבש אצלי רגע לפני שעניתי. אפשר לשלוח לי את ההודעה שוב?', 'sent', (select t from tclock) - interval '4 hours' + interval '3 seconds'),
  ('out', '972500000003', 'הנה דירות', 'sent', (select t from tclock) - interval '4 hours' + interval '30 minutes');

-- 4. מוקדם מדי: השעתיים עוד לא נגמרו.
insert into public.gabriela_llm_fallbacks (conversation_id, channel, reason, sent, created_at)
values ('10000000-0000-4000-8000-000000000004', 'public', 'other', true, (select t from tclock) - interval '90 minutes');
insert into public.whatsapp_messages (direction, wa_phone, body, status, created_at) values
  ('in', '972500000004', 'עכשיו', null, (select t from tclock) - interval '10 minutes'),
  ('out', '972500000004', 'סליחה, משהו השתבש אצלי רגע לפני שעניתי. אפשר לשלוח לי את ההודעה שוב?', 'sent', (select t from tclock) - interval '90 minutes' + interval '4 seconds');

-- 5. נרשם אבל לא נשלח.
insert into public.gabriela_llm_fallbacks (conversation_id, channel, reason, sent, created_at)
values ('10000000-0000-4000-8000-000000000005', 'public', 'other', false, (select t from tclock) - interval '3 hours');

-- 6. ערוץ סוכן, גם אם יש שיחה ציבורית באותו מזהה.
insert into public.gabriela_llm_fallbacks (conversation_id, channel, reason, sent, created_at)
values ('10000000-0000-4000-8000-000000000001', 'agent', 'other', true, (select t from tclock) - interval '3 hours');

-- 7. תשובה אמיתית בדיוק אחרי שעתיים מורידה את השיחה.
insert into public.gabriela_llm_fallbacks (conversation_id, channel, reason, sent, created_at)
values ('10000000-0000-4000-8000-000000000007', 'public', 'transient', true, (select t from tclock) - interval '3 hours');
insert into public.whatsapp_messages (direction, wa_phone, body, status, created_at) values
  ('in', '972500000007', 'נכנסת', null, (select t from tclock) - interval '20 minutes'),
  ('out', '972500000007', 'סליחה, משהו השתבש אצלי רגע לפני שעניתי. אפשר לשלוח לי את ההודעה שוב?', 'sent', (select t from tclock) - interval '3 hours' + interval '5 seconds'),
  ('out', '972500000007', 'תשובה על הגבול', 'delivered', (select t from tclock) - interval '3 hours' + interval '2 hours');

-- 8. תשובה אמיתית דקה אחרי השעתיים מורידה את השיחה.
insert into public.gabriela_llm_fallbacks (conversation_id, channel, reason, sent, created_at)
values ('10000000-0000-4000-8000-000000000008', 'public', 'other', true, (select t from tclock) - interval '3 hours');
insert into public.whatsapp_messages (direction, wa_phone, body, status, created_at) values
  ('in', '972500000008', 'נכנסת', null, (select t from tclock) - interval '25 hours'),
  ('out', '972500000008', 'סליחה, משהו השתבש אצלי רגע לפני שעניתי. אפשר לשלוח לי את ההודעה שוב?', 'sent', (select t from tclock) - interval '3 hours' + interval '5 seconds'),
  ('out', '972500000008', 'מאוחר', 'sent', (select t from tclock) - interval '3 hours' + interval '2 hours 1 minute');

-- 9. שני מענים, בלי תשובה אמיתית. חוזרת שורה אחת, של המענה המאוחר.
insert into public.gabriela_llm_fallbacks (conversation_id, channel, reason, sent, created_at) values
  ('10000000-0000-4000-8000-000000000009', 'public', 'other', true, (select t from tclock) - interval '6 hours'),
  ('10000000-0000-4000-8000-000000000009', 'public', 'billing', true, (select t from tclock) - interval '4 hours');
insert into public.whatsapp_messages (direction, wa_phone, body, status, created_at) values
  ('in', '972500000009', 'נכנסת', null, (select t from tclock) - interval '20 minutes'),
  ('out', '972500000009', 'סליחה, משהו השתבש אצלי רגע לפני שעניתי. אפשר לשלוח לי את ההודעה שוב?', 'sent', (select t from tclock) - interval '6 hours' + interval '3 seconds'),
  ('out', '972500000009', 'סליחה, אני לא זמינה כרגע בגלל תקלה אצלי. אפשר לנסות שוב מאוחר יותר, או לחפש נכסים באתר בינתיים: https://shuknadlan.co.il', 'sent', (select t from tclock) - interval '4 hours' + interval '3 seconds');

-- 10. יציאה שנכשלה אינה תשובה.
insert into public.gabriela_llm_fallbacks (conversation_id, channel, reason, sent, created_at)
values ('10000000-0000-4000-8000-000000000010', 'public', 'other', true, (select t from tclock) - interval '3 hours');
insert into public.whatsapp_messages (direction, wa_phone, body, error, status, created_at) values
  ('in', '972500000010', 'נכנסת', null, null, (select t from tclock) - interval '2 hours'),
  ('out', '972500000010', 'סליחה, משהו השתבש אצלי רגע לפני שעניתי. אפשר לשלוח לי את ההודעה שוב?', null, 'sent', (select t from tclock) - interval '3 hours' + interval '5 seconds'),
  ('out', '972500000010', 'נכשל בגרף', 'graph', null, (select t from tclock) - interval '3 hours' + interval '10 minutes'),
  ('out', '972500000010', 'מטא החזירה failed', null, 'failed', (select t from tclock) - interval '3 hours' + interval '20 minutes');

-- 11. הודעה של בוט הסוכנים (agent_id מלא) אינה תשובת הבוט הציבורי.
insert into public.gabriela_llm_fallbacks (conversation_id, channel, reason, sent, created_at)
values ('10000000-0000-4000-8000-000000000011', 'public', 'other', true, (select t from tclock) - interval '3 hours');
insert into public.whatsapp_messages (direction, wa_phone, agent_id, body, status, created_at) values
  ('in', '972500000011', null, 'נכנסת', null, (select t from tclock) - interval '1 hour'),
  ('out', '972500000011', null, 'סליחה, משהו השתבש אצלי רגע לפני שעניתי. אפשר לשלוח לי את ההודעה שוב?', 'sent', (select t from tclock) - interval '3 hours' + interval '5 seconds'),
  ('out', '972500000011', '20000000-0000-4000-8000-000000000011', 'התראת סוכן', 'sent', (select t from tclock) - interval '3 hours' + interval '15 minutes');

-- 12. תשובה אמיתית 90 שניות אחרי המענה, אחרי שליחת המענה עצמו.
insert into public.gabriela_llm_fallbacks (conversation_id, channel, reason, sent, created_at)
values ('10000000-0000-4000-8000-000000000012', 'public', 'other', true, (select t from tclock) - interval '3 hours');
insert into public.whatsapp_messages (direction, wa_phone, body, status, created_at) values
  ('in', '972500000012', 'נכנסת', null, (select t from tclock) - interval '1 hour'),
  ('out', '972500000012', 'סליחה, משהו השתבש אצלי רגע לפני שעניתי. אפשר לשלוח לי את ההודעה שוב?', 'sent', (select t from tclock) - interval '3 hours' + interval '5 seconds'),
  ('out', '972500000012', 'הנה התשובה', 'read', (select t from tclock) - interval '3 hours' + interval '90 seconds');

-- 13. מענה מלפני 49 שעות, בלי תשובה. מחוץ ל-48 השעות.
insert into public.gabriela_llm_fallbacks (conversation_id, channel, reason, sent, created_at)
values ('10000000-0000-4000-8000-000000000013', 'public', 'other', true, (select t from tclock) - interval '49 hours');
insert into public.whatsapp_messages (direction, wa_phone, body, status, created_at) values
  ('in', '972500000013', 'נכנסת', null, (select t from tclock) - interval '1 hour'),
  ('out', '972500000013', 'סליחה, משהו השתבש אצלי רגע לפני שעניתי. אפשר לשלוח לי את ההודעה שוב?', 'sent', (select t from tclock) - interval '49 hours' + interval '5 seconds');

-- 14. מענה ישן בלי תשובה, ומענה חדש שעוד לא עברו עליו שעתיים. השיחה לא נכנסת.
insert into public.gabriela_llm_fallbacks (conversation_id, channel, reason, sent, created_at) values
  ('10000000-0000-4000-8000-000000000014', 'public', 'other', true, (select t from tclock) - interval '5 hours'),
  ('10000000-0000-4000-8000-000000000014', 'public', 'billing', true, (select t from tclock) - interval '30 minutes');
insert into public.whatsapp_messages (direction, wa_phone, body, status, created_at) values
  ('in', '972500000014', 'נכנסת', null, (select t from tclock) - interval '20 minutes'),
  ('out', '972500000014', 'סליחה, משהו השתבש אצלי רגע לפני שעניתי. אפשר לשלוח לי את ההודעה שוב?', 'sent', (select t from tclock) - interval '5 hours' + interval '5 seconds'),
  ('out', '972500000014', 'סליחה, אני לא זמינה כרגע בגלל תקלה אצלי. אפשר לנסות שוב מאוחר יותר, או לחפש נכסים באתר בינתיים: https://shuknadlan.co.il', 'sent', (select t from tclock) - interval '30 minutes' + interval '5 seconds');
commit;
"""
    proc = subprocess.run(
        ["psql", "-v", "ON_ERROR_STOP=1", "-d", DB],
        text=True, input=seed, capture_output=True,
    )
    if proc.returncode != 0:
        fail(f"זריעה נכשלה:\n{proc.stderr[-2000:]}")

    cols = psql("""
select array_to_string(p.proargnames, ',')
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname = 'gabriela_waiting_customers'
""")
    if cols != "conversation_id,fallback_at,window_open":
        fail(f"עמודות לא צפויות: {cols}")

    priv = psql("""
select has_function_privilege('anon', 'public.gabriela_waiting_customers()', 'execute')
    || ',' || has_function_privilege('authenticated', 'public.gabriela_waiting_customers()', 'execute')
    || ',' || has_function_privilege('service_role', 'public.gabriela_waiting_customers()', 'execute')
""")
    if priv != "false,false,true":
        fail(f"הרשאות: {priv}")

    denied = subprocess.run(
        ["psql", "-v", "ON_ERROR_STOP=1", "-d", DB, "-c",
         "set role anon; select * from public.gabriela_waiting_customers();"],
        text=True, capture_output=True,
    )
    if denied.returncode == 0:
        fail("anon הצליח לקרוא")
    if "permission denied" not in (denied.stderr + denied.stdout).lower():
        fail(f"anon נכשל מסיבה אחרת:\n{denied.stderr}")

    rows = psql("""
select w.conversation_id::text || '|' || w.window_open || '|' ||
       (w.fallback_at = (
          select max(f.created_at)
            from public.gabriela_llm_fallbacks f
           where f.conversation_id = w.conversation_id
             and f.channel = 'public'
             and f.sent
             and f.created_at > now() - interval '48 hours'
       ))::text
  from public.gabriela_waiting_customers() w
 order by w.conversation_id::text
""")
    got = rows.splitlines() if rows else []
    expect = [
        "10000000-0000-4000-8000-000000000001|true|true",
        "10000000-0000-4000-8000-000000000002|false|true",
        "10000000-0000-4000-8000-000000000009|true|true",
        "10000000-0000-4000-8000-000000000010|true|true",
        "10000000-0000-4000-8000-000000000011|true|true",
    ]
    if got != expect:
        fail("תוצאה לא צפויה:\n" + "\n".join(got) + "\nצפוי:\n" + "\n".join(expect))

    leaked = psql("""
select count(*) from (
  select conversation_id::text || fallback_at::text || window_open::text as line
    from public.gabriela_waiting_customers()
) s
where line like '%972%' or line like '%סליחה%'
""")
    if leaked != "0":
        fail("התוצאה כוללת טלפון או גוף")

    print("✓ לקוחות שמחכים: כל הבדיקות עברו")
    return 0


if __name__ == "__main__":
    sys.exit(main())
