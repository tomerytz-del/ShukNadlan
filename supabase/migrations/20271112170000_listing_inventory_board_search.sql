-- ============================================================================
-- אינדקס לחיפוש של גבריאלה במלאי הלוחות
--
-- גבריאלה, כשהיא מחפשת נכס לסוכן/ת או מתאימה ללקוח/ה, קוראת גם את
-- listing_inventory: מודעות חיות מיד2 וממדלן. הסינון הוא עיר (כולל
-- קבוצה כמו חבל תענך, רשימת city_id) וסוג עסקה, ורק שורות באוויר.
-- האינדקס הקיים הוא (source, city). כאן (city_id, deal_type) על
-- removed_at is null, כדי שהשאילתה מה-Edge Function לא תסרוק את כל
-- המלאי. אין כאן RPC: הקריאה היא service_role, ו-RLS נשאר סגור
-- ל-anon ול-authenticated. אין טלפון ואין שם בטבלה.
-- docs/listing-inventory.md
-- ============================================================================

create index if not exists listing_inventory_active_city_deal_idx
  on public.listing_inventory (city_id, deal_type)
  where removed_at is null;

-- יומן לדיווח יומי: שורה אחת לכל הודעה שגבריאלה באמת הציגה לסוכן/ת.
-- כשל בכתיבה לא עוצר את התשובה. אין טלפון ואין כתובת.
-- service_role מכניס בלבד. anon ו-authenticated בלי הרשאה.
create table if not exists public.board_listing_presentations (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  agent_id     uuid not null,
  tool         text not null check (tool in ('search_properties', 'client_matches')),
  listing_ids  uuid[] not null check (cardinality(listing_ids) >= 1),
  sources      text[] not null check (
    cardinality(sources) = cardinality(listing_ids)
    and sources <@ array['yad2', 'madlan']::text[]
  )
);

comment on table public.board_listing_presentations is
  'פעם אחת לכל הודעת לוחות שגבריאלה הציגה. sources באותו סדר כמו listing_ids. docs/listing-inventory.md';

create index if not exists board_listing_presentations_created_idx
  on public.board_listing_presentations (created_at);

alter table public.board_listing_presentations enable row level security;
revoke all on table public.board_listing_presentations from public, anon, authenticated;
grant insert on table public.board_listing_presentations to service_role;
