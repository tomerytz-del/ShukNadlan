-- ============================================================================
-- אותו נכס ביד2 ובמדלן: סימון, בלי לחסום
--
-- ## הבעיה
-- scraped_lead_add מאחד רק אותו מקור ואותו external_ref, אותו phone_hash,
-- וליד קיים עם אותו טלפון. listing_inventory_sync מאחד רק source+external_ref.
-- אין כתובת באף אחת מהטבלאות, וליד2 אין טלפון, ולכן אותו נכס שנקלט גם
-- ממדלן וגם מיד2 נשמר פעמיים והסוכנים יכולים לקבל עליו שתי התראות.
-- ב-19.11.2026, בקריאה בלבד: 15 לידי מדלן עם ליד יד2 זהה בעיר, בסוג העסקה,
-- בחדרים ובמחיר (כולם עפולה; למשל 4 חדרים מכירה 1430000, 5 חדרים מכירה
-- 2180000, 4 חדרים השכרה 4400). 39 לידי מדלן תאמו שורת מלאי אחת או יותר
-- ביד2, לפעמים בכמה מועמדים (עפולה, 4 חדרים, 1250000, שמונה מודעות).
-- שתי מודעות מדלן שדומות זו לזו אינן כאן: רק יד2 מול מדלן.
--
-- ## הכלל
-- בקליטה ל-listing_inventory (רק שורה חדשה) ובקליטה ל-scraped_leads
-- מחפשים שורה חיה מהלוח השני. פייסבוק בחוץ. התאמה:
--   * עיר: כשלשני הצדדים יש city_id, הם חייבים להיות שווים. אחרת משווים
--     את שם העיר אחרי btrim.
--   * deal_type שווה (sale או rent), rooms שווה ומלא, מחיר מלא וחיובי.
--   * הפער לכל היותר max(2% מהמחיר הגבוה מבין השניים, רצפה).
--     מכירה: הרצפה 10000 שקל. שכירות: הרצפה 100 שקל.
--     10000 בשכירות היה מאחד כמעט כל דירת 4 חדרים בעיר (4400 מול 14000).
--     100 שקל תופס עיגול של מדרגה אחת (4400 מול 4500). מ-5000 שקל הרצפה
--     כבר קטנה מ-2%, ואז הפער המותר הוא 2% מהמחיר הגבוה.
--     הרצועה סימטרית, כדי שמילוי לאחור יסמן את שני הצדדים של אותו זוג.
-- סוג הנכס אינו חלק מהכלל. אין כתובת, ולכן 1250000 בעפולה יכול להתאים
-- לכמה מודעות. זה סימון, לא זיהוי ודאי.
--
-- כמה מועמדים: סופרים את כולם. duplicate_of מצביע על הוותיקה ביותר
-- באותה טבלה (לידים: created_at ואז id. מלאי: first_seen_at ואז id).
-- מועמד בטבלה השניה נשמר ב-duplicate_match (lead_id או inventory_id),
-- כי מפתח זר לא חוצה טבלה. candidate_count הוא סכום השורות, ואותה מודעה
-- יכולה להיספר פעם כליד ופעם כמלאי. מלאי עם removed_at אינו מועמד.
--
-- השורה החדשה נכנסת כרגיל. אין מחיקה, אין דילוג, ואין שינוי בתשובת
-- ה-RPC. ההתראה לסוכנים לא משתנה: התאמה של 1250000 לשמונה מודעות אינה
-- הוכחה שזו אותה דירה, ושורת מלאי שנזרעה לא שלחה התראה. מי שירצה לדלג
-- על התראה לשורה מסומנת יכול לעשות את זה אחר כך, על העמודה.
-- סימון נקבע פעם אחת, בקליטה. עדכון מחיר של שורה קיימת לא מסמן ולא מוחק.
--
-- ## הבסיס
-- scraped_lead_add מהגרסה שאחרי 20271115210000.
-- md5(prosrc) בפרודקשן ב-19.11.2026: b612faa7468b66611a7a907d3db78373
-- (אורך 12681 תווים). listing_inventory_sync מ-20271119140000 (עם size_sqm,
-- floor, neighborhood ו-price_changes; העתק מגרסה קודמת מוחק אותם בשקט).
-- md5(prosrc): 394339773a663648aea6287a6d236f1b (אורך 14832 תווים).
-- שני הגופים זהים לפרודקשן מלבד הסימון.
--
-- מילוי חד-פעמי מסמן שורות קיימות באותו כלל, ורק את שלוש העמודות החדשות.
-- service_role בלבד על הפונקציה החדשה. אידמפוטנטית.
-- docs/listing-inventory.md , docs/scraped-leads.md
-- ============================================================================

alter table public.listing_inventory
  add column if not exists duplicate_of uuid,
  add column if not exists is_duplicate boolean not null default false,
  add column if not exists duplicate_match jsonb;

alter table public.scraped_leads
  add column if not exists duplicate_of uuid,
  add column if not exists is_duplicate boolean not null default false,
  add column if not exists duplicate_match jsonb;

do $$ begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'listing_inventory_duplicate_of_fkey'
       and conrelid = 'public.listing_inventory'::regclass
  ) then
    alter table public.listing_inventory
      add constraint listing_inventory_duplicate_of_fkey
      foreign key (duplicate_of) references public.listing_inventory (id)
      on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'scraped_leads_duplicate_of_fkey'
       and conrelid = 'public.scraped_leads'::regclass
  ) then
    alter table public.scraped_leads
      add constraint scraped_leads_duplicate_of_fkey
      foreign key (duplicate_of) references public.scraped_leads (id)
      on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'listing_inventory_duplicate_chk'
       and conrelid = 'public.listing_inventory'::regclass
  ) then
    alter table public.listing_inventory
      add constraint listing_inventory_duplicate_chk
      check (
        (is_duplicate = false and duplicate_of is null and duplicate_match is null)
        or (is_duplicate = true and duplicate_match is not null)
      );
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'scraped_leads_duplicate_chk'
       and conrelid = 'public.scraped_leads'::regclass
  ) then
    alter table public.scraped_leads
      add constraint scraped_leads_duplicate_chk
      check (
        (is_duplicate = false and duplicate_of is null and duplicate_match is null)
        or (is_duplicate = true and duplicate_match is not null)
      );
  end if;
end $$;

comment on column public.listing_inventory.duplicate_of is
  'השורה הוותיקה ביותר באותה טבלה מהלוח השני (יד2 מול מדלן) שעומדת בכלל המחיר. ריק אם ההתאמה היא רק בטבלה השניה. נמחק איתה (set null).';
comment on column public.listing_inventory.is_duplicate is
  'true כשיש מודעה חיה מהלוח השני עם אותה עיר, אותו סוג עסקה, אותו מספר חדרים ומחיר בתוך הרצועה. השורה עצמה נשארת.';
comment on column public.listing_inventory.duplicate_match is
  'פירוט ההתאמה: ספירות, המזהה שנבחר, והרצועה. בלי טלפון ובלי שם.';
comment on column public.scraped_leads.duplicate_of is
  'הליד הוותיק ביותר מהלוח השני שעומד בכלל המחיר. ריק אם ההתאמה היא רק במלאי. נמחק איתו (set null).';
comment on column public.scraped_leads.is_duplicate is
  'true כשיש מודעה חיה מהלוח השני עם אותה עיר, אותו סוג עסקה, אותו מספר חדרים ומחיר בתוך הרצועה. השורה עצמה נשארת.';
comment on column public.scraped_leads.duplicate_match is
  'פירוט ההתאמה: ספירות, המזהה שנבחר, והרצועה. בלי טלפון ובלי שם.';

create index if not exists listing_inventory_cross_source_idx
  on public.listing_inventory (source, city_id, deal_type, rooms)
  where removed_at is null;

create index if not exists scraped_leads_board_cross_source_idx
  on public.scraped_leads (source, city_id, deal_type, rooms)
  where source in ('yad2', 'madlan');

create index if not exists listing_inventory_duplicate_of_idx
  on public.listing_inventory (duplicate_of)
  where duplicate_of is not null;

create index if not exists scraped_leads_duplicate_of_idx
  on public.scraped_leads (duplicate_of)
  where duplicate_of is not null;

create or replace function public.board_cross_source_match(
  p_source text,
  p_city text,
  p_city_id uuid,
  p_deal text,
  p_rooms numeric,
  p_price numeric,
  p_exclude_lead uuid,
  p_exclude_inventory uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_other text;
  v_floor numeric;
  v_lead_id uuid;
  v_lead_price numeric;
  v_lead_seen timestamptz;
  v_lead_count int := 0;
  v_inv_id uuid;
  v_inv_price numeric;
  v_inv_seen timestamptz;
  v_inv_count int := 0;
begin
  if p_source = 'yad2' then
    v_other := 'madlan';
  elsif p_source = 'madlan' then
    v_other := 'yad2';
  else
    return null;
  end if;
  if p_deal is null or p_deal not in ('sale', 'rent') then
    return null;
  end if;
  if p_rooms is null or p_rooms <= 0 or p_price is null or p_price <= 0 then
    return null;
  end if;
  if p_city_id is null and nullif(btrim(p_city), '') is null then
    return null;
  end if;
  v_floor := case when p_deal = 'rent' then 100 else 10000 end;

  select q.id, q.budget, q.created_at, q.cnt
    into v_lead_id, v_lead_price, v_lead_seen, v_lead_count
    from (
      select s.id, s.budget, s.created_at, (count(*) over ())::int as cnt
        from public.scraped_leads s
       where s.source = v_other
         and (p_exclude_lead is null or s.id is distinct from p_exclude_lead)
         and s.deal_type = p_deal
         and s.rooms = p_rooms
         and s.budget is not null
         and s.budget > 0
         and abs(s.budget - p_price) <= greatest(0.02 * greatest(s.budget, p_price), v_floor)
         and (
           (p_city_id is not null and s.city_id is not null and s.city_id = p_city_id)
           or (
             (p_city_id is null or s.city_id is null)
             and btrim(s.city) = btrim(p_city)
           )
         )
    ) q
   order by q.created_at asc, q.id asc
   limit 1;
  if not found then
    v_lead_count := 0;
    v_lead_id := null;
    v_lead_price := null;
    v_lead_seen := null;
  end if;

  select q.id, q.price, q.first_seen_at, q.cnt
    into v_inv_id, v_inv_price, v_inv_seen, v_inv_count
    from (
      select i.id, i.price, i.first_seen_at, (count(*) over ())::int as cnt
        from public.listing_inventory i
       where i.source = v_other
         and i.removed_at is null
         and (p_exclude_inventory is null or i.id is distinct from p_exclude_inventory)
         and i.deal_type = p_deal
         and i.rooms = p_rooms
         and i.price is not null
         and i.price > 0
         and abs(i.price - p_price) <= greatest(0.02 * greatest(i.price, p_price), v_floor)
         and (
           (p_city_id is not null and i.city_id is not null and i.city_id = p_city_id)
           or (
             (p_city_id is null or i.city_id is null)
             and btrim(i.city) = btrim(p_city)
           )
         )
    ) q
   order by q.first_seen_at asc, q.id asc
   limit 1;
  if not found then
    v_inv_count := 0;
    v_inv_id := null;
    v_inv_price := null;
    v_inv_seen := null;
  end if;

  if v_lead_count = 0 and v_inv_count = 0 then
    return null;
  end if;

  return jsonb_build_object(
    'rule', 'board_cross_source_v1',
    'other_source', v_other,
    'deal_type', p_deal,
    'rooms', p_rooms,
    'price', p_price,
    'tolerance_pct', 2,
    'tolerance_floor_nis', v_floor,
    'tolerance_rule', 'gap <= max(2% of the higher price, floor); sale floor 10000, rent floor 100',
    'city_key', case when p_city_id is not null then 'city_id' else 'city_name' end,
    'candidate_count', v_lead_count + v_inv_count,
    'lead_count', v_lead_count,
    'lead_id', v_lead_id,
    'lead_price', v_lead_price,
    'lead_seen_at', v_lead_seen,
    'inventory_count', v_inv_count,
    'inventory_id', v_inv_id,
    'inventory_price', v_inv_price,
    'inventory_seen_at', v_inv_seen
  );
end
$$;

comment on function public.board_cross_source_match(text, text, uuid, text, numeric, numeric, uuid, uuid) is
  'האם מודעת יד2 ומודעת מדלן הן אותו נכס לפי עיר, סוג עסקה, חדרים ומחיר. null אם אין. לא מוחק ולא חוסם. docs/listing-inventory.md';
revoke all on function public.board_cross_source_match(text, text, uuid, text, numeric, numeric, uuid, uuid) from public, anon, authenticated;
grant execute on function public.board_cross_source_match(text, text, uuid, text, numeric, numeric, uuid, uuid) to service_role;

-- מילוי. רק שלוש העמודות החדשות. שורה בלי התאמה נשארת false / null.
update public.scraped_leads s
   set is_duplicate = (d.dup is not null),
       duplicate_of = nullif(d.dup ->> 'lead_id', '')::uuid,
       duplicate_match = d.dup
  from (
    select s2.id,
           public.board_cross_source_match(
             s2.source, s2.city, s2.city_id, s2.deal_type, s2.rooms, s2.budget,
             s2.id, null
           ) as dup
      from public.scraped_leads s2
     where s2.source in ('yad2', 'madlan')
  ) d
 where s.id = d.id
   and (s.is_duplicate, s.duplicate_of, s.duplicate_match)
       is distinct from
       ((d.dup is not null), nullif(d.dup ->> 'lead_id', '')::uuid, d.dup);

update public.listing_inventory i
   set is_duplicate = (d.dup is not null),
       duplicate_of = nullif(d.dup ->> 'inventory_id', '')::uuid,
       duplicate_match = d.dup
  from (
    select i2.id,
           public.board_cross_source_match(
             i2.source, i2.city, i2.city_id, i2.deal_type, i2.rooms, i2.price,
             null, i2.id
           ) as dup
      from public.listing_inventory i2
     where i2.source in ('yad2', 'madlan')
       and i2.removed_at is null
  ) d
 where i.id = d.id
   and (i.is_duplicate, i.duplicate_of, i.duplicate_match)
       is distinct from
       ((d.dup is not null), nullif(d.dup ->> 'inventory_id', '')::uuid, d.dup);

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
  v_virtual boolean := false;
  v_known   boolean := false;
  v_seen    timestamptz;
  v_raw     text;
  v_stale   int;
  v_cap     int;
  v_used    int;
  v_site_only boolean := false;
  v_ask     boolean := false;
  v_agent   uuid;
  v_agency  uuid;
  v_lead    uuid;
  v_city    text := nullif(btrim(p ->> 'city'), '');
  v_city_id uuid;
  v_deal    text := nullif(btrim(p ->> 'deal_type'), '');
  v_nobrk   text;
  v_id      uuid;
  v_notified int;
  v_routed  jsonb;
  v_dup     jsonb;
  v_rooms   numeric;
  v_budget  numeric;
begin
  if v_type not in ('owner_inbound', 'seeker_inbound') then
    return jsonb_build_object('error', 'invalid_lead_type');
  end if;
  if v_source not in ('facebook_group', 'facebook_marketplace', 'madlan', 'yad2') then
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
  -- 073, 083, 093, 033, also +972. Madlan shows these on many listings.
  v_virtual := public.madlan_switchboard_phone(v_phone);

  if v_source in ('madlan', 'yad2') then
    -- first_seen_at is when the scraper first saw the listing. On the
    -- initial scan that is today for the whole inventory, so it is not
    -- freshness unless date_known is true.
    if p ? 'date_known' then
      begin
        v_known := coalesce((p ->> 'date_known')::boolean, false);
      exception when others then
        v_known := false;
      end;
    end if;
    v_raw := coalesce(nullif(btrim(p ->> 'first_seen_at'), ''),
                      nullif(btrim(p ->> 'updated_at'), ''),
                      nullif(btrim(p ->> 'posted_at'), ''));
    if v_raw is not null then
      begin
        v_seen := v_raw::timestamptz;
      exception when others then
        v_seen := null;
      end;
      if v_seen is not null and v_seen > now() + interval '1 hour' then
        v_seen := null;
      end if;
    end if;
    -- date_known בלי חותמת: המודעה נקלטה עכשיו. היעדר first_seen_at
    -- לבדו אינו מלאי ישן, ולכן לא משאיר אותה רק באתר. תאריך שנשלח
    -- ולא נקרא, או date_known false, נשארים בלי דחיפה.
    if v_known and v_seen is null and v_raw is null then
      v_seen := now();
    end if;
    -- Older than 30 days would be deleted on the next lifecycle run.
    if v_seen is not null and v_seen >= now() - interval '30 days' then
      v_posted := v_seen;
    else
      v_posted := now();
    end if;
    v_stale := greatest(1, coalesce((select value::int from public.pricing_config
                                      where key = 'notif_burst_scraped_stale_days'), 14));
    -- בלי date_known, או מחוץ לחלון הטריות: אף פעם לא דחיפה.
    -- עם תאריך אמיתי: עד madlan_notify_daily_cap מודעות מדלן ויד2 יחד ביום.
    v_site_only := true;
    if v_known and v_seen is not null
       and v_seen <= now() + interval '1 hour'
       and v_seen >= now() - make_interval(days => v_stale) then
      begin
        v_cap := coalesce((select value::int from public.app_config
                            where key = 'madlan_notify_daily_cap'), 5);
      exception when others then
        v_cap := 5;
      end;
      if v_cap < 0 then
        v_cap := 5;
      end if;
      -- תקרה משותפת למדלן וליד2. מפתח קבוע, לפני הספירה, כדי ששתי
      -- קליטות במקביל לא יעברו יחד את madlan_notify_daily_cap.
      perform pg_catalog.pg_advisory_xact_lock(881151301);
      select count(*)::int into v_used
        from public.scraped_leads
       where source in ('madlan', 'yad2') and push_site_only = false
         and created_at >= date_trunc('day', now() at time zone 'Asia/Jerusalem')
                            at time zone 'Asia/Jerusalem';
      v_site_only := v_used >= v_cap;
    end if;
  else
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
  end if;
  v_tail := public.phone_tail9(v_phone);
  -- Yad2 and Madlan listings arrive without a phone on purpose. Every
  -- other source still needs one. The date_known window above is unchanged.
  if v_tail is null and v_source not in ('madlan', 'yad2') then
    return jsonb_build_object('error', 'missing_phone');
  end if;
  -- A Madlan switchboard number is not a person. phone_hash stays null so
  -- day-8 dedupe cannot merge two listings, and a Facebook post is not
  -- blocked by it. No phone at all: nothing to hash.
  if v_tail is null or (v_source = 'madlan' and v_virtual) then
    v_hash := null;
  else
    v_hash := encode(extensions.digest(v_tail || '|shuk-scraped-v1', 'sha256'), 'hex');
  end if;

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
  -- מספר מרכזיה של מדלן (073, 083, 093, 033) אינו אדם: לא מאחדים
  -- מודעות, ולא חוסמים פוסט בפייסבוק בגלל מודעה עם אותו מספר.
  -- No phone: nothing to merge. A Madlan switchboard number is not a person.
  if v_tail is not null and not (v_source = 'madlan' and v_virtual) then
    select id into v_id from public.scraped_leads
     where created_at > now() - interval '30 days'
       and (
         (v_hash is not null and phone_hash = v_hash)
         or (
           public.phone_tail9(raw_phone) = v_tail
           and not (source = 'madlan' and public.madlan_switchboard_phone(raw_phone))
         )
       )
     limit 1;
    if v_id is not null then
      return jsonb_build_object('duplicate', 'phone', 'id', v_id);
    end if;
    if exists (select 1 from public.leads
                where public.phone_tail9(raw_phone) = v_tail
                  and created_at > now() - interval '30 days'
                  and not (source = 'madlan' and public.madlan_switchboard_phone(raw_phone))) then
      return jsonb_build_object('duplicate', 'lead');
    end if;
  end if;

  v_city_id := public.city_id_for_name(v_city);
  -- 20270823090000: "ללא תיווך" - שם הקבוצה קודם (כלל של הקבוצה), ואז הסורק / הטקסט / הפרטים
  v_nobrk := case
    when public.scraped_lead_no_broker(p ->> 'source_detail') then 'group'
    when coalesce((p ->> 'no_broker')::boolean, false)
         or public.scraped_lead_no_broker(p ->> 'raw_message')
         or public.scraped_lead_no_broker(p ->> 'property_details') then 'post'
  end;

  -- מדלן: אין פניה לבעלים, אין בקשת הסכמה ואין תזכורת.
  v_ask := case when v_source in ('madlan', 'yad2') then false
                else coalesce((p ->> 'consent_requested')::boolean, false) end;

  -- אותו נכס בלוח השני: סימון בלבד. הקליטה, התקרה וההתראה לא משתנות.
  v_rooms := nullif(p ->> 'rooms', '')::numeric;
  v_budget := nullif(p ->> 'budget', '')::numeric;
  v_dup := public.board_cross_source_match(
    v_source, v_city, v_city_id, v_deal,
    case when v_rooms is not null and v_rooms > 0 then v_rooms end,
    case when v_budget is not null and v_budget > 0 then v_budget end,
    null, null);

  insert into public.scraped_leads (lead_type, source, source_detail, post_url, external_ref, posted_at,
                                    raw_name, raw_phone, raw_message, city, city_id, neighborhood_id,
                                    deal_type, property_type, rooms, budget, move_in, property_details,
                                    consent_requested_at, no_broker, demand_summary, phone_hash,
                                    push_site_only, date_known,
                                    is_duplicate, duplicate_of, duplicate_match)
  values (v_type, v_source, left(nullif(btrim(p ->> 'source_detail'), ''), 120), v_url, v_ref, v_posted,
          left(nullif(btrim(p ->> 'raw_name'), ''), 80), v_phone, left(nullif(btrim(p ->> 'raw_message'), ''), 4000),
          v_city, v_city_id,
          (select n.id from public.neighborhoods n
            where n.id::text = nullif(btrim(p ->> 'neighborhood_id'), '')
               or (n.city_id = v_city_id and n.name = nullif(btrim(p ->> 'neighborhood'), ''))
            limit 1),
          v_deal, nullif(btrim(p ->> 'property_type'), ''),
          v_rooms, v_budget,
          left(nullif(btrim(p ->> 'move_in'), ''), 60), left(nullif(btrim(p ->> 'property_details'), ''), 300),
          case when v_ask then now() end,
          v_nobrk, left(nullif(btrim(p ->> 'summary'), ''), 160), v_hash,
          v_site_only, v_known,
          v_dup is not null,
          nullif(v_dup ->> 'lead_id', '')::uuid,
          v_dup)
  on conflict (source, external_ref) do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('duplicate', 'post');
  end if;

  -- התאמה לסוכן/ת אחד/ת רק כשמותר לדחוף. אחרת הביקוש נשאר באתר,
  -- בלי וואטסאפ על כל המלאי. הליד נולד פתוח ובלי חיוב.
  if v_source in ('madlan', 'yad2') and not v_site_only
     and coalesce((select value::int from public.pricing_config
                    where key = 'scraped_lead_matching_enabled'), 0) = 1
     and pg_catalog.to_regprocedure('public.scraped_lead_matches(uuid)') is not null then
    select h.agent_id, m.agency_id into v_agent, v_agency
      from public.scraped_lead_matches(v_id) h
      join public.agency_members m on m.id = h.agent_id
     where m.active
       and public.agent_works_city(m.id, v_city_id)
       and public.agent_handles_type(m.id, nullif(btrim(p ->> 'property_type'), ''), v_deal)
     order by h.score desc, m.id
     limit 1;
    if v_agent is not null then
      insert into public.leads (
        lead_type, agent_id, agency_id, status, quota_source, unlocked_at, unlocked_by,
        raw_name, raw_phone, raw_message, city, deal_type, property_type,
        source, source_detail, external_ref
      )
      values (
        v_type, v_agent, v_agency, 'unlocked',
        case when v_source = 'yad2' then 'yad2_free' else 'madlan_free' end, now(), v_agent,
        left(nullif(btrim(p ->> 'raw_name'), ''), 80), v_phone,
        left(nullif(btrim(p ->> 'raw_message'), ''), 4000),
        v_city, v_deal, nullif(btrim(p ->> 'property_type'), ''),
        v_source,
        left((case when v_source = 'yad2' then 'יד2' else 'מדלן' end)
             || coalesce(' · ' || nullif(btrim(p ->> 'source_detail'), ''), ''), 120),
        v_ref
      )
      returning id into v_lead;
      update public.scraped_leads
         set status = 'consented', consent_answered_at = now(), lead_id = v_lead,
             raw_name = null, raw_phone = null, raw_message = null
       where id = v_id;
      -- יומן הניתוב. השמה ולא perform: check_notification_backfill
      -- תופס perform/select של מחולל התראות. הרישום הוא שיוך לסוכן/ת,
      -- בלי טלפון ובלי שם, ולא מעיר את מנהלי הפלטפורמה.
      v_routed := public.log_lead_routing(jsonb_build_object(
        'source', v_source,
        'lead_kind', 'agent_owner',
        'lead_table', 'leads',
        'lead_id', v_lead,
        'routing', 'assigned',
        'recipients', 1,
        'assigned_agent_id', v_agent,
        'city', v_city,
        'deal_type', v_deal,
        'property_type', nullif(btrim(p ->> 'property_type'), ''),
        'summary', left(concat_ws(' · ',
          case when v_source = 'yad2' then 'יד2' else 'מדלן' end,
          case v_deal when 'rent' then 'השכרה' when 'sale' then 'מכירה' end,
          nullif(btrim(p ->> 'property_type'), ''),
          v_city,
          nullif(btrim(p ->> 'summary'), '')
        ), 300)
      ));
    end if;
  end if;

  if v_lead is null then
    -- השמה ולא perform: check_notification_backfill תופס perform/select
    -- של מחולל התראות במיגרציה חדשה. זו קליטה של פוסט אחד, לא מילוי.
    v_notified := public.scraped_lead_notify_demand(v_id);
  end if;

  return jsonb_build_object('success', true, 'id', v_id,
                            'status', case when v_lead is null then 'pending_consent' else 'consented' end,
                            'city_known', v_city_id is not null, 'no_broker', v_nobrk,
                            'lead_id', v_lead, 'agent_id', v_agent,
                            'push_site_only', v_site_only, 'date_known', v_known);
end $$;

comment on function public.scraped_lead_add(jsonb) is
  'קליטת פוסט מפייסבוק או מודעה ממדלן/יד2. בלוח, date_known בלי first_seen_at נחשב רגע הקליטה ולא מלאי ישן. date_known false נשאר באתר. בלי טלפון רק למדלן וליד2. מספר מרכזיה של מדלן (073, 083, 093, 033) לא משתתף בכפילות. ליד שנולד לסוכן/ת נרשם assigned ב-lead_routing_log, בלי טלפון. מודעת יד2 או מדלן שמזהה את אותו נכס בלוח השני מסומנת is_duplicate, בלי לדלג על הקליטה או על ההתראה. docs/scraped-leads.md';
revoke all on function public.scraped_lead_add(jsonb) from public, anon, authenticated;
grant execute on function public.scraped_lead_add(jsonb) to service_role;

create or replace function public.listing_inventory_sync(p_source text, p_city text, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_city     text := nullif(btrim(p_city), '');
  v_city_id  uuid;
  v_ratio    numeric := 0.5;
  v_active   int := 0;
  v_n        int := 0;
  v_added    int := 0;
  v_updated  int := 0;
  v_removed  int := 0;
  v_new      int := 0;
  v_skip     boolean := false;
  v_seeded_before boolean := false;
  v_is_seed  boolean := false;
  v_catchup  boolean := false;
  v_catchup_days int := 2;
  v_catchup_ratio numeric := 2;
  v_seed_count int := 0;
  v_seeded_at timestamptz;
  v_note     text := 'ok';
  v_fp       text;
  v_item     jsonb;
  v_url      text;
  v_ref      text;
  v_deal     text;
  v_type     text;
  v_rooms    numeric;
  v_price    numeric;
  v_size     numeric;
  v_floor    numeric;
  v_hood     text;
  v_price_changes int := 0;
  v_phone    text;
  v_name     text;
  v_summary  text;
  v_payload  jsonb;
  v_res      jsonb;
  rec        record;
begin
  if p_source not in ('yad2', 'madlan') then
    return jsonb_build_object('error', 'invalid_source');
  end if;
  if v_city is null or char_length(v_city) > 80 then
    return jsonb_build_object('error', 'missing_city');
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return jsonb_build_object('error', 'invalid_items');
  end if;
  if jsonb_array_length(p_items) > 2000 then
    return jsonb_build_object('error', 'too_many_items');
  end if;

  -- סנכרון אחד לעיר בכל רגע. קריאה כפולה מחכה, ואז רואה את מה שהראשונה כתבה.
  perform pg_catalog.pg_advisory_xact_lock(881122, pg_catalog.hashtext(p_source || ':' || v_city));

  begin
    v_ratio := coalesce((select value::numeric from public.app_config
                          where key = 'listing_inventory_min_snapshot_ratio'), 0.5);
  exception when others then
    v_ratio := 0.5;
  end;
  if v_ratio <= 0 or v_ratio > 1 then
    v_ratio := 0.5;
  end if;
  begin
    v_catchup_days := coalesce((select value::int from public.app_config
                                 where key = 'listing_inventory_seed_catchup_days'), 2);
  exception when others then
    v_catchup_days := 2;
  end;
  begin
    v_catchup_ratio := coalesce((select value::numeric from public.app_config
                                  where key = 'listing_inventory_seed_catchup_ratio'), 2);
  exception when others then
    v_catchup_ratio := 2;
  end;
  if v_catchup_days < 0 then
    v_catchup_days := 2;
  end if;
  if v_catchup_ratio <= 1 then
    v_catchup_ratio := 2;
  end if;

  v_city_id := public.city_id_for_name(v_city);

  drop table if exists pg_temp._li_in;
  create temp table _li_in (
    external_ref text primary key,
    url text not null,
    deal_type text,
    property_type text,
    rooms numeric,
    price numeric,
    size_sqm numeric,
    floor int,
    neighborhood text,
    raw_phone text,
    raw_name text,
    summary text
  ) on commit drop;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' then
      continue;
    end if;
    v_url := nullif(btrim(coalesce(v_item ->> 'url', v_item ->> 'external_ref')), '');
    if v_url is null or v_url !~ '^https://' or char_length(v_url) > 500 then
      continue;
    end if;
    v_ref := public.scraped_lead_ref(v_url);
    if v_ref is null or v_ref !~ '^[A-Za-z0-9._:/-]{1,128}$' then
      continue;
    end if;
    v_deal := nullif(btrim(v_item ->> 'deal_type'), '');
    if v_deal is not null and v_deal not in ('sale', 'rent') then
      v_deal := null;
    end if;
    v_type := left(nullif(btrim(v_item ->> 'property_type'), ''), 40);
    begin
      v_rooms := nullif(v_item ->> 'rooms', '')::numeric;
    exception when others then
      v_rooms := null;
    end;
    if v_rooms is not null and v_rooms <= 0 then
      v_rooms := null;
    end if;
    begin
      v_price := nullif(v_item ->> 'price', '')::numeric;
    exception when others then
      v_price := null;
    end;
    -- NaN ו-Infinity עוברים את "גדול מאפס" (NaN גדול מכל מספר ב-Postgres),
    -- ומחיר כזה היה נכתב להיסטוריה ומרעיל כל ממוצע.
    if v_price is not null
       and (v_price <= 0 or v_price = 'NaN'::numeric or v_price > 100000000000) then
      v_price := null;
    end if;
    -- שטח, קומה ושכונה: רשות. ערך שאינו סביר נזרק ולא מנוחש.
    begin
      v_size := nullif(v_item ->> 'size_sqm', '')::numeric;
    exception when others then
      v_size := null;
    end;
    if v_size is not null and (v_size < 5 or v_size > 100000) then
      v_size := null;
    end if;
    begin
      v_floor := nullif(v_item ->> 'floor', '')::numeric;
    exception when others then
      v_floor := null;
    end;
    if v_floor is not null and (v_floor <> trunc(v_floor) or v_floor < -5 or v_floor > 120) then
      v_floor := null;
    end if;
    v_hood := left(nullif(btrim(v_item ->> 'neighborhood'), ''), 60);
    -- שם שכונה בלבד. חמש ספרות ומעלה הן טלפון או מיקוד, ו"רחוב ..." הוא
    -- כתובת: שניהם לא נשמרים במלאי.
    if v_hood is not null
       and (char_length(regexp_replace(v_hood, '\D', '', 'g')) >= 5
            or v_hood ~ '^(רחוב\s|רח''|רח׳|רח\.)')
    then
      v_hood := null;
    end if;
    v_phone := left(nullif(btrim(v_item ->> 'raw_phone'), ''), 40);
    v_name := left(nullif(btrim(v_item ->> 'raw_name'), ''), 80);
    v_summary := left(nullif(btrim(v_item ->> 'summary'), ''), 160);
    insert into _li_in (external_ref, url, deal_type, property_type, rooms, price,
                        size_sqm, floor, neighborhood, raw_phone, raw_name, summary)
    values (v_ref, v_url, v_deal, v_type, v_rooms, v_price,
            v_size, v_floor::int, v_hood, v_phone, v_name, v_summary)
    on conflict (external_ref) do update
      set url = excluded.url,
          deal_type = coalesce(excluded.deal_type, _li_in.deal_type),
          property_type = coalesce(excluded.property_type, _li_in.property_type),
          rooms = coalesce(excluded.rooms, _li_in.rooms),
          price = coalesce(excluded.price, _li_in.price),
          size_sqm = coalesce(excluded.size_sqm, _li_in.size_sqm),
          floor = coalesce(excluded.floor, _li_in.floor),
          neighborhood = coalesce(excluded.neighborhood, _li_in.neighborhood),
          raw_phone = coalesce(excluded.raw_phone, _li_in.raw_phone),
          raw_name = coalesce(excluded.raw_name, _li_in.raw_name),
          summary = coalesce(excluded.summary, _li_in.summary);
  end loop;

  select count(*)::int into v_n from _li_in;
  select count(*)::int into v_active
    from public.listing_inventory
   where source = p_source and city = v_city and removed_at is null;

  v_seeded_before := exists (
    select 1 from public.listing_inventory_seeds s
     where s.source = p_source and s.city = v_city
  );
  v_skip := v_active > 0 and (v_n::numeric / v_active::numeric) < v_ratio;
  v_is_seed := (not v_seeded_before) and v_n > 0 and not v_skip;
  -- זריעה של 10 מודעות ואחר כך 200 הייתה פותחת 190 לידים. בתוך חלון
  -- הימים, תמונה שגדולה לפחות פי היחס מהזריעה האחרונה היא השלמה שקטה.
  if v_seeded_before and v_catchup_days > 0 and not v_skip then
    select s.item_count, s.seeded_at into v_seed_count, v_seeded_at
      from public.listing_inventory_seeds s
     where s.source = p_source and s.city = v_city;
    v_catchup := coalesce(v_seed_count, 0) > 0
      and v_seeded_at >= pg_catalog.now() - make_interval(days => v_catchup_days)
      and v_n > v_seed_count
      and v_n::numeric >= v_seed_count::numeric * v_catchup_ratio;
  end if;

  if v_skip then
    v_note := case when v_n = 0 then 'empty_snapshot' else 'snapshot_too_small' end;
  elsif v_is_seed then
    v_note := 'seed';
  elsif v_catchup then
    v_note := 'seed_catchup';
  elsif v_n = 0 and v_active = 0 then
    v_note := 'empty';
  end if;

  drop table if exists pg_temp._li_existed;
  create temp table _li_existed on commit drop as
    select i.external_ref
      from public.listing_inventory i
      join _li_in t on t.external_ref = i.external_ref
     where i.source = p_source;

  -- רק ספירה, לתשובה וליומן. את השורה בהיסטוריה כותב הטריגר
  -- listing_inventory_price_history_trg, באותו תנאי.
  select count(*)::int into v_price_changes
    from public.listing_inventory i
    join _li_in t on t.external_ref = i.external_ref
   where i.source = p_source
     and i.price is not null
     and t.price is not null
     and t.price <> i.price
     and coalesce(t.deal_type, i.deal_type) is not distinct from i.deal_type;

  insert into public.listing_inventory (
    source, external_ref, city, city_id, deal_type, property_type, rooms, price,
    size_sqm, floor, neighborhood, url,
    first_seen_at, last_seen_at, removed_at, from_seed
  )
  select p_source, t.external_ref, v_city, v_city_id, t.deal_type, t.property_type,
         t.rooms, t.price, t.size_sqm, t.floor, t.neighborhood, t.url,
         pg_catalog.now(), pg_catalog.now(), null, false
    from _li_in t
  on conflict (source, external_ref) do update
    set city = excluded.city,
        city_id = excluded.city_id,
        deal_type = coalesce(excluded.deal_type, public.listing_inventory.deal_type),
        property_type = coalesce(excluded.property_type, public.listing_inventory.property_type),
        rooms = coalesce(excluded.rooms, public.listing_inventory.rooms),
        price = coalesce(excluded.price, public.listing_inventory.price),
        size_sqm = coalesce(excluded.size_sqm, public.listing_inventory.size_sqm),
        floor = coalesce(excluded.floor, public.listing_inventory.floor),
        neighborhood = coalesce(excluded.neighborhood, public.listing_inventory.neighborhood),
        url = excluded.url,
        last_seen_at = pg_catalog.now(),
        removed_at = null;

  select count(*)::int into v_updated from _li_existed;
  v_added := v_n - v_updated;

  -- מודעה חדשה בלבד. שורה שכבר הייתה לא מסומנת מחדש, גם אם המחיר השתנה.
  update public.listing_inventory i
     set is_duplicate = true,
         duplicate_of = nullif(m.dup ->> 'inventory_id', '')::uuid,
         duplicate_match = m.dup
    from _li_in t
    cross join lateral (
      select public.board_cross_source_match(
        p_source, v_city, v_city_id, t.deal_type, t.rooms, t.price, null, null
      ) as dup
    ) m
   where i.source = p_source
     and i.external_ref = t.external_ref
     and not exists (
       select 1 from _li_existed e where e.external_ref = i.external_ref
     )
     and m.dup is not null;

  if not v_skip then
    update public.listing_inventory i
       set removed_at = pg_catalog.now()
     where i.source = p_source
       and i.city = v_city
       and i.removed_at is null
       and not exists (select 1 from _li_in t where t.external_ref = i.external_ref);
    get diagnostics v_removed = row_count;
  end if;

  if v_is_seed then
    update public.listing_inventory i
       set from_seed = true
      from _li_in t
     where i.source = p_source
       and i.external_ref = t.external_ref;
    insert into public.listing_inventory_seeds (source, city, item_count)
    values (p_source, v_city, v_n)
    on conflict (source, city) do nothing;
  elsif v_catchup then
    update public.listing_inventory i
       set from_seed = true
      from _li_in t
     where i.source = p_source
       and i.external_ref = t.external_ref
       and i.scraped_lead_id is null;
    update public.listing_inventory_seeds
       set item_count = v_n,
           seeded_at = pg_catalog.now()
     where source = p_source and city = v_city;
  elsif v_seeded_before then
    for rec in
      select i.id, i.lead_offered_at, t.url, t.raw_phone, t.raw_name, t.summary,
             t.deal_type, t.property_type, t.rooms, t.price,
             encode(extensions.digest(
               coalesce(regexp_replace(coalesce(t.raw_phone, ''), '\D', '', 'g'), '')
               || '|' || coalesce(t.price::text, ''),
               'sha256'), 'hex') as fp
        from public.listing_inventory i
        join _li_in t on t.external_ref = i.external_ref
       where i.source = p_source
         and not i.from_seed
         and i.scraped_lead_id is null
         and i.removed_at is null
         and (i.lead_offered_at is null or i.lead_offered_at <= pg_catalog.now() - interval '30 days')
         and (
           i.lead_attempted_at is null
           or i.lead_attempted_at <= pg_catalog.now() - interval '30 days'
           or i.lead_attempt_fingerprint is distinct from encode(extensions.digest(
                coalesce(regexp_replace(coalesce(t.raw_phone, ''), '\D', '', 'g'), '')
                || '|' || coalesce(t.price::text, ''),
                'sha256'), 'hex')
         )
       order by i.external_ref
       for update of i
    loop
      v_payload := jsonb_build_object(
        'lead_type', 'owner_inbound',
        'source', p_source,
        'source_detail', v_city,
        'external_ref', rec.url,
        'first_seen_at', pg_catalog.now(),
        'date_known', true,
        'raw_phone', rec.raw_phone,
        'raw_name', rec.raw_name,
        'city', v_city,
        'summary', rec.summary,
        'consent_requested', false
      );
      if rec.deal_type is not null then
        v_payload := v_payload || jsonb_build_object('deal_type', rec.deal_type);
      end if;
      if rec.property_type is not null then
        v_payload := v_payload || jsonb_build_object('property_type', rec.property_type);
      end if;
      if rec.rooms is not null then
        v_payload := v_payload || jsonb_build_object('rooms', rec.rooms);
      end if;
      if rec.price is not null then
        v_payload := v_payload || jsonb_build_object('budget', rec.price);
      end if;
      -- השמה, לא perform: מחולל ההתראות רץ מתוך scraped_lead_add, ושם
      -- כבר יש suppress_push. קריאה כאן היא ליד אחד חדש, לא מילוי.
      v_res := public.scraped_lead_add(v_payload);
      v_fp := rec.fp;
      if coalesce(v_res ->> 'success', '') = 'true' and (v_res ->> 'id') is not null then
        update public.listing_inventory
           set scraped_lead_id = (v_res ->> 'id')::uuid,
               lead_offered_at = pg_catalog.now(),
               lead_skip_reason = null,
               lead_attempted_at = null,
               lead_attempt_fingerprint = null
         where id = rec.id;
        v_new := v_new + 1;
      elsif v_res ->> 'duplicate' = 'post' and (v_res ->> 'id') is not null then
        update public.listing_inventory
           set scraped_lead_id = (v_res ->> 'id')::uuid,
               lead_offered_at = coalesce(lead_offered_at, pg_catalog.now()),
               lead_skip_reason = null,
               lead_attempted_at = null,
               lead_attempt_fingerprint = null
         where id = rec.id;
      else
        update public.listing_inventory
           set lead_skip_reason = left(coalesce(v_res ->> 'error', v_res ->> 'duplicate', 'rejected'), 40),
               lead_attempted_at = pg_catalog.now(),
               lead_attempt_fingerprint = v_fp
         where id = rec.id;
      end if;
    end loop;
  end if;

  insert into public.listing_inventory_sync_log (
    source, city, item_count, active_before, added, updated, removed,
    new_leads, seeded, removals_skipped, note, price_changes
  ) values (
    p_source, v_city, v_n, v_active, v_added, v_updated, v_removed,
    v_new, (v_is_seed or v_catchup), v_skip, v_note, v_price_changes
  );

  return jsonb_build_object(
    'added', v_added,
    'updated', v_updated,
    'removed', v_removed,
    'new_leads', v_new,
    'seeded', (v_is_seed or v_catchup),
    'removals_skipped', v_skip,
    'price_changes', v_price_changes
  );
end $$;

comment on function public.listing_inventory_sync(text, text, jsonb) is
  'מעדכן מלאי מודעות למקור ועיר. הסנכרון הראשון זורע בלי לידים, וגם השלמה גדולה בתוך חלון הימים. דחייה לא מנוסה שוב עד 30 יום או עד שינוי טלפון או מחיר. קולט גם size_sqm, floor ו-neighborhood, ומחזיר price_changes. מודעה חדשה שמזהה מלאי או ליד של הלוח השני מסומנת is_duplicate. שורה שכבר הייתה לא מסומנת מחדש. docs/listing-inventory.md';
revoke all on function public.listing_inventory_sync(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.listing_inventory_sync(text, text, jsonb) to service_role;
