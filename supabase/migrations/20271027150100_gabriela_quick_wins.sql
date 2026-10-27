-- גבריאלה, ניצחונות מהירים.
--
-- 1. מחיר קריאה ממטמון של Sonnet 5.5. המחירון נכתב ב-20270620090000 לפי
--    עשירית מהקלט ($0.20). המחירון הציבורי של Anthropic מ-7.10.2026 הוא
--    0.05 ממחיר הקלט: $0.10 למיליון טוקנים. כתיבה למטמון ($2.50 / $4) ו-Sonnet 5
--    ($0.20) לא משתנים. בלי השורה הזו הערכת העלות בפאנל מכפילה את קריאות המטמון.
-- 2. whatsapp_pair_reserve: מרווח בין הודעות לאותו נמען (Meta 131056).
--    הבוט והתראות רצים בפונקציות נפרדות, ולכן המרווח בזיכרון אינו מספיק.
--    אם ה-RPC חסר, הקוד נשאר על המרווח המקומי (wa-pair-pace.ts, 1500).
--    שורות ישנות נמחקות במנות, כדי שהטבלה לא תצבור כל מספר שפנינו אליו.

update public.ai_model_prices
   set cache_read_usd_mtok = 0.10,
       updated_at = now()
 where model = 'claude-sonnet-5-5'
   and cache_read_usd_mtok is distinct from 0.10;

create table if not exists public.whatsapp_pair_slot (
  phone text primary key,
  next_at timestamptz not null default '-infinity'
);

comment on table public.whatsapp_pair_slot is
  'השעה שבה מותרת ההודעה הבאה לאותו מספר וואטסאפ. רק service_role, דרך whatsapp_pair_reserve.';

alter table public.whatsapp_pair_slot enable row level security;

revoke all on table public.whatsapp_pair_slot from anon, authenticated;
grant select, insert, update, delete on table public.whatsapp_pair_slot to service_role;

create or replace function public.whatsapp_pair_reserve(p_phone text, p_gap_ms integer default 1500)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_next timestamptz;
  v_send timestamptz;
  v_gap_ms integer := greatest(0, least(coalesce(p_gap_ms, 1500), 20000));
begin
  if p_phone is null or length(btrim(p_phone)) = 0 or v_gap_ms = 0 then
    return 0;
  end if;

  -- מנה קטנה, לא בכל קריאה: מספרים שלא נשלח אליהם שבוע יורדים.
  if random() < 0.02 then
    delete from public.whatsapp_pair_slot
     where phone in (
       select phone from public.whatsapp_pair_slot
        where next_at < v_now - interval '7 days'
        limit 50
     );
  end if;

  insert into public.whatsapp_pair_slot (phone, next_at)
  values (p_phone, '-infinity')
  on conflict (phone) do nothing;

  select next_at into v_next
    from public.whatsapp_pair_slot
   where phone = p_phone
   for update;

  v_send := greatest(v_next, v_now);
  update public.whatsapp_pair_slot
     set next_at = v_send + (v_gap_ms * interval '1 millisecond')
   where phone = p_phone;

  return greatest(0, floor(extract(epoch from (v_send - v_now)) * 1000))::integer;
end;
$$;

comment on function public.whatsapp_pair_reserve(text, integer) is
  'כמה מילישניות לחכות לפני הודעת וואטסאפ לאותו נמען. נקראת רק מ-Edge (service_role).';

revoke all on function public.whatsapp_pair_reserve(text, integer) from public, anon, authenticated;
grant execute on function public.whatsapp_pair_reserve(text, integer) to service_role;
