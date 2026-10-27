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

-- כפילות לקוח/ה על כל הקובץ, לא על 500 השורות האחרונות ש-PostgREST מחזיר.
-- השלד זהה ל-nameSkeleton ב-whatsapp-webhook/hebrew-name.ts: י' באמצע
-- המילה יורדת, י' בראש המילה ו-י' בסופה נשארות.

create or replace function public.client_phone_key(p_raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when length(d) >= 9 then right(d, 9) else '' end
    from (
      select case
               when length(x) = 9 and left(x, 1) = '5' then '0' || x
               else x
             end as d
        from (
          select case
                   when digits like '972%' then '0' || substr(digits, 4)
                   else digits
                 end as x
            from (
              select regexp_replace(coalesce(p_raw, ''), '[^0-9]', '', 'g') as digits
            ) s
        ) s2
    ) s3;
$$;

create or replace function public.client_phones_match(p_a text, p_b text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select length(public.client_phone_key(p_a)) >= 9
     and public.client_phone_key(p_a) = public.client_phone_key(p_b);
$$;

create or replace function public.client_name_skeleton(p_raw text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  s text;
  w text;
  words text[] := '{}';
  lead text;
  tail text;
  mid text;
begin
  s := lower(coalesce(p_raw, ''));
  s := regexp_replace(s, '[֑-ׇ]', '', 'g');
  s := regexp_replace(s, '["''״׳`]', '', 'g');
  s := translate(s, 'םןץףך', 'מנצפכ');
  s := regexp_replace(s, '[^א-תA-Za-z0-9[:space:]]', ' ', 'g');
  s := regexp_replace(s, 'ו{2,}', 'ו', 'g');
  s := translate(s, 'כקטת', 'קקתת');
  s := btrim(regexp_replace(s, '[[:space:]]+', ' ', 'g'));
  if s = '' then
    return '';
  end if;
  foreach w in array regexp_split_to_array(s, ' ')
  loop
    if length(w) <= 2 then
      words := words || w;
    else
      lead := left(w, 1);
      tail := right(w, 1);
      mid := regexp_replace(substr(w, 2, length(w) - 2), 'י', '', 'g');
      words := words || (lead || mid || tail);
    end if;
  end loop;
  return array_to_string(words, ' ');
end;
$$;

create or replace function public.client_name_tokens(p_raw text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (select array_agg(tok order by ord)
       from unnest(string_to_array(public.client_name_skeleton(p_raw), ' '))
              with ordinality as u(tok, ord)
      where length(tok) >= 2),
    '{}'::text[]
  );
$$;

create or replace function public.client_names_likely_same(p_a text, p_b text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  ta text[] := public.client_name_tokens(p_a);
  tb text[] := public.client_name_tokens(p_b);
  short text[];
  long text[];
  w text;
begin
  if coalesce(array_length(ta, 1), 0) = 0 or coalesce(array_length(tb, 1), 0) = 0 then
    return false;
  end if;
  if array_length(ta, 1) >= 2 and array_length(tb, 1) >= 2 then
    if ta[1] is distinct from tb[1] then
      return false;
    end if;
    return ta[2:array_length(ta, 1)] && tb[2:array_length(tb, 1)];
  end if;
  if coalesce(array_length(ta, 1), 0) <= coalesce(array_length(tb, 1), 0) then
    short := ta;
    long := tb;
  else
    short := tb;
    long := ta;
  end if;
  if array_length(short, 1) = 1 and array_length(long, 1) >= 2 then
    w := short[1];
    if w = long[1] then
      return true;
    end if;
    return length(w) >= 4 and w = any(long);
  end if;
  return short[1] = long[1];
end;
$$;

create or replace function public.client_names_need_confirm(p_a text, p_b text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  ta text[] := public.client_name_tokens(p_a);
  tb text[] := public.client_name_tokens(p_b);
  last_a text;
  last_b text;
begin
  if coalesce(array_length(ta, 1), 0) < 2 or coalesce(array_length(tb, 1), 0) < 2 then
    return false;
  end if;
  if ta[1] = tb[1] then
    return false;
  end if;
  last_a := ta[array_length(ta, 1)];
  last_b := tb[array_length(tb, 1)];
  return length(last_a) >= 3 and last_a = last_b;
end;
$$;

create or replace function public.agent_client_duplicate(
  p_agent_id uuid,
  p_full_name text,
  p_phone text
)
returns table (
  id uuid,
  full_name text,
  phone text,
  status text,
  kind text
)
language sql
stable
set search_path = ''
as $$
  select c.id,
         c.full_name,
         c.phone,
         c.status,
         case
           when public.client_phones_match(p_phone, c.phone)
             or public.client_names_likely_same(p_full_name, c.full_name)
           then 'duplicate'
           else 'confirm'
         end as kind
    from public.agent_clients c
   where c.agent_id = p_agent_id
     and (
       public.client_phones_match(p_phone, c.phone)
       or public.client_names_likely_same(p_full_name, c.full_name)
       or public.client_names_need_confirm(p_full_name, c.full_name)
     )
   order by
     case
       when public.client_phones_match(p_phone, c.phone)
         or public.client_names_likely_same(p_full_name, c.full_name)
       then 0 else 1
     end,
     c.created_at desc
   limit 20;
$$;

comment on function public.agent_client_duplicate(uuid, text, text) is
  'כפילות לקוח/ה אצל סוכן/ת: אותו שם או אותו טלפון על כל הקובץ. kind=duplicate חוסם, kind=confirm שואל.';

revoke all on function public.client_phone_key(text) from public, anon, authenticated;
revoke all on function public.client_phones_match(text, text) from public, anon, authenticated;
revoke all on function public.client_name_skeleton(text) from public, anon, authenticated;
revoke all on function public.client_name_tokens(text) from public, anon, authenticated;
revoke all on function public.client_names_likely_same(text, text) from public, anon, authenticated;
revoke all on function public.client_names_need_confirm(text, text) from public, anon, authenticated;
revoke all on function public.agent_client_duplicate(uuid, text, text) from public, anon, authenticated;
grant execute on function public.client_phone_key(text) to service_role;
grant execute on function public.client_phones_match(text, text) to service_role;
grant execute on function public.client_name_skeleton(text) to service_role;
grant execute on function public.client_name_tokens(text) to service_role;
grant execute on function public.client_names_likely_same(text, text) to service_role;
grant execute on function public.client_names_need_confirm(text, text) to service_role;
grant execute on function public.agent_client_duplicate(uuid, text, text) to service_role;
