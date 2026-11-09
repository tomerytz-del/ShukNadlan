-- supabase/migrations/20271031250000_scraped_leads_phone_hash.sql
-- raw_phone is wiped after 7 days and on consent, so a repost on day 8
-- no longer matched phone_tail9(raw_phone). phone_hash is written at intake
-- and kept for the 30-day dedupe only.
-- The backfill below sets phone_hash and nothing else. scraped_leads has no
-- triggers, so it cannot write demand_notified_at or call
-- scraped_lead_notify_demand.

alter table public.scraped_leads add column if not exists phone_hash text;
create index if not exists scraped_leads_phone_hash_idx on public.scraped_leads (phone_hash, created_at desc)
  where phone_hash is not null;
comment on column public.scraped_leads.phone_hash is
  'sha256 of phone_tail9(raw_phone) || salt, written at intake and never cleared (raw_phone is wiped after 7 days / on consent). 30-day dedupe only.';

-- backfill: rows that still have a phone. Do NOT touch demand_notified_at / status.
update public.scraped_leads
   set phone_hash = encode(extensions.digest(public.phone_tail9(raw_phone) || '|shuk-scraped-v1', 'sha256'), 'hex')
 where phone_hash is null and raw_phone is not null;

create or replace function public.scraped_lead_add(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type    text := nullif(btrim(p ->> 'lead_type'), '');
  v_source  text := coalesce(nullif(btrim(p ->> 'source'), ''), 'facebook_group');
  v_url     text := nullif(btrim(p ->> 'external_ref'), '');
  v_ref     text;
  v_posted  timestamptz;
  v_phone   text := nullif(btrim(p ->> 'raw_phone'), '');
  v_tail    text;
  v_hash    text;
  v_city    text := nullif(btrim(p ->> 'city'), '');
  v_city_id uuid;
  v_deal    text := nullif(btrim(p ->> 'deal_type'), '');
  v_nobrk   text;
  v_id      uuid;
  v_notified int;
begin
  if v_type not in ('owner_inbound', 'seeker_inbound') then
    return jsonb_build_object('error', 'invalid_lead_type');
  end if;
  if v_source not in ('facebook_group', 'facebook_marketplace') then
    return jsonb_build_object('error', 'invalid_source');
  end if;
  if v_url is null or v_url !~ '^https://' then
    return jsonb_build_object('error', 'missing_post_url');
  end if;
  if v_city is null then
    return jsonb_build_object('error', 'missing_city');
  end if;
  if v_deal is not null and v_deal not in ('sale', 'rent') then
    return jsonb_build_object('error', 'invalid_deal_type');
  end if;
  begin
    v_posted := (p ->> 'posted_at')::timestamptz;
  exception when others then
    v_posted := null;
  end;
  if v_posted is null then
    return jsonb_build_object('error', 'missing_posted_at');
  end if;
  if v_posted < now() - interval '72 hours' or v_posted > now() + interval '1 hour' then
    return jsonb_build_object('error', 'post_too_old');
  end if;
  v_tail := public.phone_tail9(v_phone);
  if v_tail is null then
    return jsonb_build_object('error', 'missing_phone');
  end if;
  v_hash := encode(extensions.digest(v_tail || '|shuk-scraped-v1', 'sha256'), 'hex');

  v_ref := public.scraped_lead_ref(v_url);

  -- אותו פוסט: כבר אצלנו, או שבעליו סירב/ה
  select id into v_id from public.scraped_leads where source = v_source and external_ref = v_ref;
  if v_id is not null then
    return jsonb_build_object('duplicate', 'post', 'id', v_id);
  end if;
  if exists (select 1 from public.scraped_lead_blocks
              where ref_hash = encode(extensions.digest(v_source || '|' || v_ref, 'sha256'), 'hex')) then
    return jsonb_build_object('duplicate', 'declined');
  end if;
  -- אותו אדם ב-30 הימים האחרונים: פוסט אחר שממתין, או ליד מכל ערוץ.
  -- phone_hash נשאר אחרי ש-raw_phone נמחק (7 ימים / הסכמה).
  select id into v_id from public.scraped_leads
   where (phone_hash = v_hash or public.phone_tail9(raw_phone) = v_tail)
     and created_at > now() - interval '30 days' limit 1;
  if v_id is not null then
    return jsonb_build_object('duplicate', 'phone', 'id', v_id);
  end if;
  if exists (select 1 from public.leads
              where public.phone_tail9(raw_phone) = v_tail and created_at > now() - interval '30 days') then
    return jsonb_build_object('duplicate', 'lead');
  end if;

  v_city_id := public.city_id_for_name(v_city);
  -- 20270823090000: "ללא תיווך" - שם הקבוצה קודם (כלל של הקבוצה), ואז הסורק / הטקסט / הפרטים
  v_nobrk := case
    when public.scraped_lead_no_broker(p ->> 'source_detail') then 'group'
    when coalesce((p ->> 'no_broker')::boolean, false)
         or public.scraped_lead_no_broker(p ->> 'raw_message')
         or public.scraped_lead_no_broker(p ->> 'property_details') then 'post'
  end;

  insert into public.scraped_leads (lead_type, source, source_detail, post_url, external_ref, posted_at,
                                    raw_name, raw_phone, raw_message, city, city_id, neighborhood_id,
                                    deal_type, property_type, rooms, budget, move_in, property_details,
                                    consent_requested_at, no_broker, demand_summary, phone_hash)
  values (v_type, v_source, left(nullif(btrim(p ->> 'source_detail'), ''), 120), v_url, v_ref, v_posted,
          left(nullif(btrim(p ->> 'raw_name'), ''), 80), v_phone, left(nullif(btrim(p ->> 'raw_message'), ''), 4000),
          v_city, v_city_id,
          (select n.id from public.neighborhoods n
            where n.id::text = nullif(btrim(p ->> 'neighborhood_id'), '')
               or (n.city_id = v_city_id and n.name = nullif(btrim(p ->> 'neighborhood'), ''))
            limit 1),
          v_deal, nullif(btrim(p ->> 'property_type'), ''),
          nullif(p ->> 'rooms', '')::numeric, nullif(p ->> 'budget', '')::numeric,
          left(nullif(btrim(p ->> 'move_in'), ''), 60), left(nullif(btrim(p ->> 'property_details'), ''), 300),
          case when (p ->> 'consent_requested')::boolean then now() end,
          v_nobrk, left(nullif(btrim(p ->> 'summary'), ''), 160), v_hash)
  on conflict (source, external_ref) do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('duplicate', 'post');
  end if;

  -- מחוץ להשקה מחזירה 0: הפוסט עוד אינו ביקוש פתוח.
  -- השמה ולא perform: check_notification_backfill תופס perform/select
  -- של מחולל התראות במיגרציה חדשה. זו קליטה של פוסט אחד, לא מילוי.
  v_notified := public.scraped_lead_notify_demand(v_id);

  return jsonb_build_object('success', true, 'id', v_id, 'status', 'pending_consent',
                            'city_known', v_city_id is not null, 'no_broker', v_nobrk,
                            'open_demand', public.scraped_lead_is_demand('pending_consent', v_type, v_nobrk, v_posted, v_city_id));
end $$;

comment on function public.scraped_lead_add(jsonb) is
  'קליטת פוסט מקבוצת פייסבוק / מרקטפלייס כ-pending_consent, עם בדיקת כפילות לפי פוסט ולפי phone_hash (נשאר אחרי מחיקת הטלפון). docs/scraped-leads.md';
revoke all on function public.scraped_lead_add(jsonb) from public, anon, authenticated;
grant execute on function public.scraped_lead_add(jsonb) to service_role;
