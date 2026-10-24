-- ============================================================================
-- לידים מפייסבוק ומאינסטגרם (גבריאלה דרך Zernio) - מקור משלהם, ובלי כפילויות
--
-- גבריאלה עונה בפייסבוק ובאינסטגרם ושולחת לידים לפונקציות הקליטה הקיימות.
-- עד היום הם נספרו כלידים מהאתר: normalizeSource מחק את המקור, ו-
-- property-inquiry-intake רשם null (‏= "פנייה מדף נכס"). ושום דבר לא מנע
-- מאותה פנייה להיכנס פעמיים כשהשליחה חוזרת על עצמה.
--
-- מה נכנס (‏docs/social-leads.md):
--   ‏1. ‏leads.external_ref - המזהה אצל הספק (‏Zernio), ייחודי לכל source.
--      **לא ב-source_detail**: הוא מוצג לסוכן/ת בכרטיס הליד.
--   ‏2. ‏saved_searches.source - מאיפה הגיע/ה המחפש/ת, כדי שהרכישה בחנות
--      תעביר את זה הלאה (‏store_purchase_to_lead) ולא תדרוס ב-'store'.
--   ‏3. ‏create_saved_search מקבלת status ('paused' = ליד בלי התראות) ו-source.
--      העתק מלא מ-20260914090000 (md5 זהה לפרודקשן) ועוד שתי עמודות.
--   ‏4. ‏lead_source_label() - תווית קריאה לסוכן/ת ("פייסבוק · הודעה").
--   ‏5. ‏lead_source_channel() - ערוץ social. העתק מ-20270409090000 ועוד ענף.
--   ‏6. ‏social_leads - אידמפוטנטיות לפי מזהה Zernio, כמו ads_leads.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. leads.external_ref
-- ---------------------------------------------------------------------------
alter table public.leads add column if not exists external_ref text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'leads_external_ref_format') then
    alter table public.leads add constraint leads_external_ref_format
      check (external_ref is null or external_ref ~ '^[A-Za-z0-9._:/-]{1,128}$');
  end if;
end $$;

-- ‏partial: רק לידים שיש להם מזהה חיצוני. ‏source בתוך המפתח, כי שני ספקים
-- יכולים לתת את אותו מזהה.
create unique index if not exists leads_source_external_ref_key
  on public.leads (source, external_ref) where external_ref is not null;

comment on column public.leads.external_ref is
  'המזהה של הפנייה אצל הספק (Zernio), ייחודי לכל source - מונע ליד כפול כשהשליחה חוזרת. לא מוצג לסוכן/ת. docs/social-leads.md';

-- ---------------------------------------------------------------------------
-- 2. saved_searches.source
-- ---------------------------------------------------------------------------
alter table public.saved_searches add column if not exists source text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'saved_searches_source_len') then
    alter table public.saved_searches add constraint saved_searches_source_len
      check (source is null or length(source) between 2 and 60);
  end if;
end $$;

comment on column public.saved_searches.source is
  'מזהה המקור שנרשם גם ב-lead_routing_log (homepage_search_agent, facebook_dm...). store_purchase_to_lead מעביר אותו לליד שנרכש. null = נשמר לפני 20270806090000';

-- ---------------------------------------------------------------------------
-- 4. lead_source_label - לפני store_purchase_to_lead שקוראת לה
-- ---------------------------------------------------------------------------
create or replace function public.lead_source_label(p_source text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_source
    when 'facebook_dm'       then 'פייסבוק · הודעה'
    when 'facebook_comment'  then 'פייסבוק · תגובה'
    when 'instagram_dm'      then 'אינסטגרם · הודעה'
    when 'instagram_comment' then 'אינסטגרם · תגובה'
  end;
$$;
comment on function public.lead_source_label(text) is
  'תווית לסוכן/ת למקור של ליד מהרשתות (facebook_dm → פייסבוק · הודעה), או null. אותה מפה כמו SOCIAL_SOURCE_LABELS ב-_shared/lead-routing.ts';
revoke all on function public.lead_source_label(text) from public, anon, authenticated;
grant execute on function public.lead_source_label(text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. create_saved_search (העתק מלא + status ו-source)
-- ---------------------------------------------------------------------------
create or replace function public.create_saved_search(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id      uuid;
  v_label   text;
  v_cap     int;
  v_count   int;
  v_phone   text;
  v_consent boolean := coalesce((p_payload->>'consent_agent_contact')::boolean, false);
  v_agency  uuid    := nullif(p_payload->>'agency_id', '')::uuid;
  v_agent   uuid    := nullif(p_payload->>'assigned_agent_id', '')::uuid;
  -- 20270806090000: ליד בלי התראות (lead_only) נשמר 'paused' - המדף מסנן רק
  -- 'unsubscribed', ומנוע ההתראות רק 'active'. כל ערך אחר - 'active' כמו תמיד.
  v_status  text    := case when p_payload->>'status' = 'paused' then 'paused' else 'active' end;
  v_source  text    := nullif(left(btrim(coalesce(p_payload->>'source', '')), 60), '');
begin
  -- בלי הסכמה מפורשת אין ליד — יש חיפוש עם התראות. השיוך נמחק כאן ולא
  -- נבדק אצל הקורא בלבד: זו השורה שמפרידה בין השתיים.
  if not v_consent then
    v_agency := null;
    v_agent  := null;
  end if;
  -- סוכן/ת בלי משרד אינו שיוך אלא תקלה: השיוך כולו הוא "הליד של המשרד הזה"
  if v_agency is null then
    v_agent := null;
  end if;

  begin
    insert into public.saved_searches (
      full_name, phone, email, contact_channel, label,
      deal_type, category, cities, neighborhood_ids, property_types,
      min_price, max_price, min_rooms, max_rooms,
      min_size_sqm, max_size_sqm, min_floor, max_floor,
      required_features, condition, free_text, consent_agent_contact,
      agency_id, sold_to_agent_id, lead_status, sold_at, status, source
    ) values (
      p_payload->>'full_name',
      p_payload->>'phone',
      p_payload->>'email',
      coalesce(p_payload->>'contact_channel', 'whatsapp'),
      p_payload->>'label',
      coalesce(p_payload->>'deal_type', 'sale'),
      coalesce(p_payload->>'category', 'residential'),
      coalesce(array(select jsonb_array_elements_text(p_payload->'cities')), '{}'),
      coalesce(array(select jsonb_array_elements_text(p_payload->'neighborhood_ids')::uuid), '{}'),
      coalesce(array(select jsonb_array_elements_text(p_payload->'property_types')), '{}'),
      (p_payload->>'min_price')::numeric,
      (p_payload->>'max_price')::numeric,
      (p_payload->>'min_rooms')::numeric,
      (p_payload->>'max_rooms')::numeric,
      (p_payload->>'min_size_sqm')::numeric,
      (p_payload->>'max_size_sqm')::numeric,
      (p_payload->>'min_floor')::smallint,
      (p_payload->>'max_floor')::smallint,
      coalesce(array(select jsonb_array_elements_text(p_payload->'required_features')), '{}'),
      p_payload->>'condition',
      p_payload->>'free_text',
      v_consent,
      v_agency,
      v_agent,
      -- ‏'sold' ולא סטטוס חדש: זה בדיוק המצב "יש לו בעלים ואינו במדף",
      -- וכל מה שקורא את הטבלה כבר יודע לקרוא אותו נכון.
      case when v_agency is not null then 'sold' else 'new' end,
      case when v_agency is not null then now() else null end,
      v_status,
      v_source
    )
    returning id, label, phone_e164 into v_id, v_label, v_phone;
  exception
    when unique_violation then
      -- אותו חיפוש בדיוק כבר שמור אצל אותו טלפון. מבחינת המחפש/ת זו הצלחה,
      -- והבעלות על השורה הקיימת אינה משתנה.
      return jsonb_build_object('success', true, 'duplicate', true);
    when check_violation then
      return jsonb_build_object('error', 'invalid_criteria');
  end;

  -- התקרה נבדקת רק על מי שמסר/ה טלפון: זהו המזהה היחיד שיש לנו לאדם
  -- שאינו רשום לאתר.
  if v_phone is not null then
    v_cap := coalesce((select value::int from public.pricing_config
                        where key = 'saved_search_max_per_phone'), 5);
    select count(*) into v_count
      from public.saved_searches
     where phone_e164 = v_phone and status <> 'unsubscribed';

    if v_count > v_cap then
      delete from public.saved_searches where id = v_id;
      return jsonb_build_object('error', 'too_many_searches', 'limit', v_cap);
    end if;
  end if;

  return jsonb_build_object(
    'success', true,
    'search_id', v_id,
    'label', v_label,
    -- הקורא צריך לדעת אם השיוך אכן נעשה, כדי לרשום ניתוב נכון ביומן
    -- ולומר לגולש/ת למי הפרטים הגיעו
    'agency_id', v_agency,
    'assigned_agent_id', v_agent
  );
end;
$$;

revoke all on function public.create_saved_search(jsonb) from public, anon, authenticated;
grant execute on function public.create_saved_search(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 2א. store_purchase_to_lead - המקור המקורי נשמר ב-source_detail
--     (העתק מלא מ-20270712090000, md5 זהה לפרודקשן, ושורה אחת)
-- ---------------------------------------------------------------------------
create or replace function public.store_purchase_to_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agency uuid;
  v_name   text;
  v_phone  text;
  v_msg    text;
  v_detail text;
  v_city   text;
  v_type   text;
  v_deal   text;
begin
  if new.sold_to_agent_id is null or (tg_op = 'UPDATE' and old.sold_to_agent_id is not distinct from new.sold_to_agent_id) then
    return new;
  end if;
  select m.agency_id into v_agency from public.agency_members m where m.id = new.sold_to_agent_id;

  if tg_table_name = 'rss_leads' then
    v_detail := 'חנות הלידים';
    v_msg    := coalesce(nullif(btrim(new.raw_content), ''), new.teaser_description);
    v_city   := new.city;
    v_type   := new.property_type;
  elsif tg_table_name = 'saved_searches' then
    -- 20270806090000: מאיפה הגיע/ה המחפש/ת (פייסבוק, אינסטגרם), במקום 'מחפשי דירה' בלבד
    v_detail := 'מחפשי דירה' || coalesce(' · ' || public.lead_source_label(new.source), '');
    v_name   := new.full_name;
    v_phone  := coalesce(new.phone_e164, new.phone);
    v_msg    := coalesce(nullif(btrim(new.free_text), ''), new.label);
    v_city   := new.cities[1];
    v_type   := new.property_types[1];
    v_deal   := case when new.deal_type in ('sale', 'rent') then new.deal_type end;
  elsif tg_table_name = 'mortgage_leads' then
    v_detail := 'משכנתאות';
    v_name   := new.full_name;
    v_phone  := coalesce(new.phone_e164, new.phone);
    v_msg    := 'ליד ייעוץ משכנתא'
                || coalesce(' · הלוואה ₪' || to_char(new.loan_amount, 'FM999,999,999'), '');
  else
    return new;
  end if;

  insert into public.leads (lead_type, agent_id, agency_id, status, unlocked_at, raw_name, raw_phone,
                            raw_message, city, property_type, deal_type, source, source_detail, origin_id, created_at)
  values ('store', new.sold_to_agent_id, v_agency, 'unlocked', coalesce(new.sold_at, now()), v_name, v_phone,
          left(v_msg, 4000), v_city, v_type, v_deal, 'store', v_detail, new.id, coalesce(new.sold_at, now()))
  on conflict (lead_type, origin_id) where origin_id is not null do nothing;
  return new;
end $$;

revoke all on function public.store_purchase_to_lead() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. lead_source_channel - ערוץ social
-- ---------------------------------------------------------------------------
create or replace function public.lead_source_channel(p_source text)
returns text
language sql
immutable
as $$
  select case
    when p_source is null                       then 'other'
    when p_source like 'whatsapp\_bot%'         then 'whatsapp_bot'
    when p_source = 'rss_engine'                then 'rss_engine'
    when p_source like 'homepage%'              then 'homepage'
    when p_source = 'footer_buyer_wizard'       then 'footer'
    -- לפני property_page: ההדמיה יושבת בדף הנכס, אבל היא כלי אחר עם קהל אחר
    when p_source = 'property_page_visualization' then 'visualization'
    when p_source like 'property\_page%'        then 'property_page'
    when p_source like 'agency\_page%'
      or p_source = 'agency'                    then 'agency_page'
    when p_source like 'agent\_page%'           then 'agent_page'
    when p_source like 'project%'               then 'project_page'
    when p_source = 'open_house_page'           then 'open_house'
    when p_source like 'meta\_ads%'             then 'meta_ads'
    -- 20270806090000: גבריאלה בפייסבוק ובאינסטגרם (social-lead-intake)
    when p_source like 'facebook\_%'
      or p_source like 'instagram\_%'          then 'social'
    when p_source = 'unattributed'              then 'unattributed'
    else 'other'
  end;
$$;
comment on function public.lead_source_channel(text) is
  'הערוץ שאליו שייך מזהה מקור הליד: whatsapp_bot · homepage · footer · property_page · visualization · agency_page · agent_page · project_page · open_house · meta_ads · social · rss_engine · unattributed · other. המיפוי בקידומת, כדי שמקור חדש ייכנס לערוץ הנכון בלי מיגרציה.';

-- ---------------------------------------------------------------------------
-- 6. social_leads - פנייה אחת מ-Zernio = שורה אחת, ונשלחת למסלול פעם אחת
--
-- אותה תבנית כמו ads_leads: השורה נשמרת קודם (‏on conflict do nothing), ואז
-- ‏social_lead_claim נותנת אותה לקורא אחד. ‏payload נשמר כדי שאפשר יהיה
-- לנתב מחדש ליד שנכשל; יש בו שם וטלפון, ולכן קריאה רק למנהל/ת הפלטפורמה.
-- ---------------------------------------------------------------------------
create table if not exists public.social_leads (
  zernio_id    text primary key check (zernio_id ~ '^[A-Za-z0-9._:/-]{1,128}$'),
  channel      text not null check (channel in ('facebook_dm', 'facebook_comment', 'instagram_dm', 'instagram_comment')),
  kind         text not null check (kind in ('property', 'buyer', 'owner', 'mortgage')),
  payload      jsonb not null default '{}'::jsonb,
  status       text not null default 'new' check (status in ('new', 'routing', 'routed', 'failed')),
  attempts     int not null default 0,
  claimed_at   timestamptz,
  target       jsonb,
  lead_id      uuid,
  error        text,
  received_at  timestamptz not null default now(),
  routed_at    timestamptz
);

create index if not exists social_leads_received_idx on public.social_leads (received_at desc);
create index if not exists social_leads_failed_idx on public.social_leads (received_at) where status = 'failed';

comment on table public.social_leads is
  'פניות מגבריאלה בפייסבוק ובאינסטגרם (Zernio). zernio_id הוא המפתח - שליחה חוזרת אינה יוצרת ליד שני. target = לאיזו פונקציית קליטה נשלח ומה חזר. docs/social-leads.md';

alter table public.social_leads enable row level security;
drop policy if exists "platform admin reads social leads" on public.social_leads;
create policy "platform admin reads social leads" on public.social_leads
  for select to authenticated using (public.current_is_platform_admin());

grant select on table public.social_leads to authenticated;
grant select, insert, update, delete on table public.social_leads to service_role;
revoke all on table public.social_leads from anon;

create or replace function public.social_lead_claim(p_zernio_id text)
returns boolean
language sql
volatile
security definer
set search_path = public
as $$
  with c as (
    update public.social_leads
       set status = 'routing', attempts = attempts + 1, claimed_at = now()
     where zernio_id = p_zernio_id
       and (status in ('new', 'failed')
            or (status = 'routing' and claimed_at < now() - interval '10 minutes'))
       and attempts < 5
    returning 1
  )
  select exists (select 1 from c);
$$;
comment on function public.social_lead_claim(text) is
  'נעילת פנייה מהרשתות לשליחה למסלול: true רק לקורא אחד, עד 5 ניסיונות. נקראת מ-social-lead-intake בלבד';
revoke all on function public.social_lead_claim(text) from public, anon, authenticated;
grant execute on function public.social_lead_claim(text) to service_role;
