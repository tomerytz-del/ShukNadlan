-- ============================================================================
-- פוסטי בעלים מפייסבוק נכנסים למלאי, ומחפשים מותאמים למלאי הקיים
--
-- ## הבעיה
-- scraped_lead_add כותב פוסט של בעלים מ-facebook_group רק ל-scraped_leads.
-- listing_inventory מקבל יד2 ומדלן, וה-CHECK שלו דוחה כל מקור אחר. לכן
-- גבריאלה של הסוכנים, שמחפשת גם במלאי, לא רואה את הפוסטים האלה.
-- מחפש/ת מפייסבוק לא הושווה/תה ל-listing_inventory בכלל.
--
-- ## למה לא דרך listing_inventory_sync
-- הפוסט אינו צילום מלא של עיר. סנכרון שמסמן כמוסר כל מה שלא בתמונה היה
-- מוחק שורות פייסבוק בכל צילום של יד2. הסנכרון, הזריעה ותקרת 5 ההתראות
-- של יד2 ומדלן לא משתנים. מקור facebook נדחה שם כמו קודם (invalid_source).
--
-- ## מה נכנס
-- טריגר על scraped_leads, לא גוף שמוחלף בכל מיגרציה: אחרי insert או
-- עדכון של שדות המלאי, בעל/ת מקבוצת פייסבוק נכתב/ת ל-listing_inventory
-- עם source = facebook. external_ref הוא group:post כשאפשר, ואחרת
-- המזהה הקנוני שכבר עומד ב-regex של המלאי. url הוא הקישור לפוסט.
-- אין טלפון, אין שם ואין רחוב. שכונה רק אחרי listing_area_text.
-- from_seed נשאר true ו-lead_offered_at מתמלא, כדי שגם אם מישהו יריץ
-- סנכרון על המקור הזה בעתיד לא ייפתח ליד שני. הליד עצמו נשאר זה
-- ש-scraped_lead_add כבר יצר, והתראה שנייה לא נשלחת.
-- מחיקת השורה (סירוב, או 30 יום) מוחקת גם את שורת המלאי.
-- מילוי לאחור הוא update על השורות הקיימות, בלי scraped_lead_add
-- ובלי scraped_lead_notify_demand.
--
-- מחפש/ת: אותם שדות (עיר, עסקה, חדרים, תקציב, שכונה) נשמרים, ו-
-- scraped_seeker_supply סופר נכסים פעילים ומודעות חיות. שורת ההתראה
-- מתווספת רק כש-scraped_lead_matching_enabled דלוק. no_broker לא מוצג
-- ולא נספר. אין פניה לפונה.
--
-- היצע ה-CMA (_listing_supply_pool) נשאר יד2 ומדלן, כדי שפוסט טרי
-- לא ירענן צילום ישן ולא ייכנס לרבעונים.
--
-- אידמפוטנטית. docs/scraped-leads.md, docs/listing-inventory.md
-- ============================================================================

alter table public.scraped_leads
  add column if not exists area_text text
    check (area_text is null or char_length(area_text) between 1 and 60);
alter table public.scraped_leads
  add column if not exists size_sqm numeric
    check (size_sqm is null or (size_sqm >= 5 and size_sqm <= 100000));
alter table public.scraped_leads
  add column if not exists floor int
    check (floor is null or (floor >= -5 and floor <= 120));

comment on column public.scraped_leads.area_text is
  'שם שכונה מהסורק, אחרי ניקוי. בלי רחוב, בלי מספר בית ובלי טלפון. docs/scraped-leads.md';
comment on column public.scraped_leads.size_sqm is
  'שטח במ"ר שסורק הפייסבוק שלח. נכתב למלאי. ריק כשהערך אינו סביר.';
comment on column public.scraped_leads.floor is
  'קומה שסורק הפייסבוק שלח. 0 היא קרקע.';

-- source: קוראים את האילוץ הקיים ומוסיפים facebook. seeds ו-sync_log
-- נשארים יד2 ומדלן, כי לפייסבוק אין צילום.
do $src$
declare
  r record;
  v_vals text[];
begin
  for r in
    select c.conname, c.conrelid::regclass as rel, pg_get_constraintdef(c.oid) as def
      from pg_constraint c
      join pg_attribute a
        on a.attrelid = c.conrelid
       and a.attnum = any (c.conkey)
       and a.attname = 'source'
     where c.contype = 'c'
       and c.conrelid = 'public.listing_inventory'::regclass
       and pg_get_constraintdef(c.oid) ilike '%yad2%'
       and pg_get_constraintdef(c.oid) not ilike '%facebook%'
  loop
    select coalesce(array_agg(distinct m[1]), '{}')
      into v_vals
      from regexp_matches(r.def, '''([^'']+)''', 'g') as m;
    if v_vals is null or not ('yad2' = any (v_vals)) or not ('madlan' = any (v_vals)) then
      continue;
    end if;
    v_vals := (
      select array_agg(distinct x order by x)
        from unnest(v_vals || array['facebook']) as x
    );
    execute format('alter table %s drop constraint %I', r.rel, r.conname);
    execute format(
      'alter table %s add constraint %I check (source = any (%L::text[]))',
      r.rel, r.conname, v_vals);
  end loop;
end
$src$;

do $pres$
declare
  r record;
begin
  if to_regclass('public.board_listing_presentations') is null then
    return;
  end if;
  for r in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.board_listing_presentations'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ilike '%madlan%'
       and pg_get_constraintdef(c.oid) not ilike '%facebook%'
  loop
    execute format(
      'alter table public.board_listing_presentations drop constraint %I', r.conname);
    execute format(
      'alter table public.board_listing_presentations add constraint %I check (%s)',
      r.conname,
      'cardinality(sources) = cardinality(listing_ids) and sources <@ array[''yad2'', ''madlan'', ''facebook'']::text[]');
  end loop;
end
$pres$;

create or replace function public.listing_area_text(p text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select case
    when s is null then null
    when s ~* 'https?://|@' then null
    when char_length(regexp_replace(s, '\D', '', 'g')) >= 5 then null
    when s ~ '^(רחוב[[:space:]]|רח''|רח׳|רח\.|שדרות[[:space:]]|שד''|סמטת[[:space:]])' then null
    when s ~ '[0-9]' and s !~ '^(רובע|שכונה)[[:space:]]+[0-9]{1,2}$' then null
    else s
  end
  from (select left(nullif(btrim(p), ''), 60) as s) x;
$fn$;

comment on function public.listing_area_text(text) is
  'שם שכונה למלאי: עד 60 תווים, בלי רחוב, בלי מספר בית ובלי טלפון. docs/listing-inventory.md';
revoke all on function public.listing_area_text(text) from public, anon, authenticated;
grant execute on function public.listing_area_text(text) to service_role;

create or replace function public.listing_inventory_facebook_ref(p_url text, p_canonical text)
returns text
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_group text;
  v_post text;
  v_ref text;
begin
  v_group := substring(coalesce(p_url, '') from 'groups/([A-Za-z0-9._-]{1,64})');
  v_post := substring(coalesce(p_url, '') from '/posts/([0-9]{5,20})');
  if v_post is null then
    v_post := substring(coalesce(p_url, '') from '/permalink/([0-9]{5,20})');
  end if;
  if v_post is null then
    v_post := substring(coalesce(p_url, '') from '[?&]story_fbid=([0-9]{5,20})');
  end if;
  if v_post is null then
    v_post := substring(coalesce(p_url, '') from '[?&]multi_permalinks=([0-9]{5,20})');
  end if;
  if v_group is not null and v_post is not null then
    v_ref := v_group || ':' || v_post;
  elsif v_post is not null then
    v_ref := v_post;
  else
    v_ref := null;
  end if;
  if v_ref is null or v_ref !~ '^[A-Za-z0-9._:/-]{1,128}$' then
    v_ref := nullif(btrim(p_canonical), '');
  end if;
  if v_ref is null or v_ref !~ '^[A-Za-z0-9._:/-]{1,128}$' then
    return null;
  end if;
  return v_ref;
end
$fn$;

comment on function public.listing_inventory_facebook_ref(text, text) is
  'מזהה מלאי לפוסט פייסבוק: group:post כשיש מזהים, ואחרת המזהה הקנוני. docs/listing-inventory.md';
revoke all on function public.listing_inventory_facebook_ref(text, text) from public, anon, authenticated;
grant execute on function public.listing_inventory_facebook_ref(text, text) to service_role;

create or replace function public.listing_inventory_facebook_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_ref text;
  v_hood text;
  v_price numeric;
  v_size numeric;
  v_url text;
begin
  if tg_op = 'DELETE' then
    if old.source = 'facebook_group' and old.lead_type = 'owner_inbound' then
      delete from public.listing_inventory
       where source = 'facebook'
         and (
           scraped_lead_id = old.id
           or external_ref = public.listing_inventory_facebook_ref(old.post_url, old.external_ref)
         );
    end if;
    return old;
  end if;

  if new.source is distinct from 'facebook_group'
     or new.lead_type is distinct from 'owner_inbound' then
    if tg_op = 'UPDATE'
       and old.source = 'facebook_group'
       and old.lead_type = 'owner_inbound' then
      delete from public.listing_inventory
       where source = 'facebook' and scraped_lead_id = old.id;
    end if;
    return new;
  end if;

  begin
    v_ref := public.listing_inventory_facebook_ref(new.post_url, new.external_ref);
    if v_ref is null or nullif(btrim(new.city), '') is null then
      return new;
    end if;
    v_hood := null;
    if new.neighborhood_id is not null then
      select public.listing_area_text(n.name) into v_hood
        from public.neighborhoods n
       where n.id = new.neighborhood_id;
    end if;
    if v_hood is null then
      v_hood := public.listing_area_text(new.area_text);
    end if;
    v_price := new.budget;
    if v_price is not null and (
         v_price <= 0 or v_price = 'NaN'::numeric or v_price > 100000000000) then
      v_price := null;
    end if;
    v_size := new.size_sqm;
    if v_size is not null and (v_size < 5 or v_size > 100000 or v_size = 'NaN'::numeric) then
      v_size := null;
    end if;
    v_url := null;
    if new.post_url ~ '^https://' and char_length(new.post_url) <= 500 then
      v_url := new.post_url;
    end if;

    insert into public.listing_inventory (
      source, external_ref, city, city_id, deal_type, property_type, rooms, price,
      size_sqm, floor, neighborhood, url,
      first_seen_at, last_seen_at, removed_at,
      scraped_lead_id, from_seed, lead_offered_at
    ) values (
      'facebook', v_ref, left(btrim(new.city), 80), new.city_id,
      case when new.deal_type in ('sale', 'rent') then new.deal_type end,
      left(nullif(btrim(new.property_type), ''), 40),
      case when new.rooms is not null and new.rooms > 0 then new.rooms end,
      v_price, v_size, new.floor, v_hood, v_url,
      coalesce(new.posted_at, pg_catalog.now()), pg_catalog.now(), null,
      new.id, true, coalesce(new.created_at, pg_catalog.now())
    )
    on conflict (source, external_ref) do update
      set city = excluded.city,
          city_id = coalesce(excluded.city_id, public.listing_inventory.city_id),
          deal_type = coalesce(excluded.deal_type, public.listing_inventory.deal_type),
          property_type = coalesce(excluded.property_type, public.listing_inventory.property_type),
          rooms = coalesce(excluded.rooms, public.listing_inventory.rooms),
          price = coalesce(excluded.price, public.listing_inventory.price),
          size_sqm = coalesce(excluded.size_sqm, public.listing_inventory.size_sqm),
          floor = coalesce(excluded.floor, public.listing_inventory.floor),
          neighborhood = coalesce(excluded.neighborhood, public.listing_inventory.neighborhood),
          url = coalesce(excluded.url, public.listing_inventory.url),
          last_seen_at = pg_catalog.now(),
          removed_at = null,
          scraped_lead_id = excluded.scraped_lead_id,
          lead_offered_at = coalesce(public.listing_inventory.lead_offered_at, excluded.lead_offered_at);
  exception when others then
    raise warning 'listing_inventory facebook sync skipped: %', sqlerrm;
  end;
  return new;
end
$fn$;

comment on function public.listing_inventory_facebook_sync() is
  'טריגר: בעל/ת מקבוצת פייסבוק נכתב/ת למלאי בלי טלפון ובלי שם. מחיקת הליד מוחקת את השורה. אין ליד שני. docs/listing-inventory.md';
revoke all on function public.listing_inventory_facebook_sync() from public, anon, authenticated;
grant execute on function public.listing_inventory_facebook_sync() to service_role;

drop trigger if exists listing_inventory_facebook_trg on public.scraped_leads;
create trigger listing_inventory_facebook_trg
  after insert or update of city, city_id, deal_type, property_type, rooms, budget,
    neighborhood_id, area_text, size_sqm, floor, post_url
  on public.scraped_leads
  for each row
  execute function public.listing_inventory_facebook_sync();

drop trigger if exists listing_inventory_facebook_del_trg on public.scraped_leads;
create trigger listing_inventory_facebook_del_trg
  before delete on public.scraped_leads
  for each row
  execute function public.listing_inventory_facebook_sync();

-- שינוי מחיר של פוסט פייסבוק אינו נכתב ליומן היד2/מדלן: ה-CHECK שם
-- לא כולל facebook, והיומן הוא של צילומי הלוחות.
do $hist$
begin
  if to_regprocedure('public.listing_inventory_price_history_log()') is null then
    return;
  end if;
  drop trigger if exists listing_inventory_price_history_trg on public.listing_inventory;
  create trigger listing_inventory_price_history_trg
    after update of price on public.listing_inventory
    for each row
    when (old.price is not null and new.price is not null and old.price <> new.price
          and old.deal_type is not distinct from new.deal_type
          and new.source in ('yad2', 'madlan'))
    execute function public.listing_inventory_price_history_log();
end
$hist$;


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
  v_details jsonb;
  v_area    text;
  v_size    numeric;
  v_floor   int;
  v_floor_n numeric;
  v_budget_fallback numeric;
  v_rooms_fallback numeric;
  v_deal_fallback text;
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

  -- שדות מלאי ומחפש/ת לפייסבוק בלבד. יד2 ומדלן לא נקראים מכאן.
  -- ערך לא סביר נזרק. תקציב או חדרים לא תקינים בשדה העליון עדיין
  -- מפילים את ההכנסה, כמו קודם, ורק אחרי בדיקת הכפילות.
  v_details := null;
  v_area := null;
  v_size := null;
  v_floor := null;
  v_budget_fallback := null;
  v_rooms_fallback := null;
  v_deal_fallback := null;
  if v_source = 'facebook_group' then
    if left(btrim(coalesce(p ->> 'property_details', '')), 1) = '{' then
      begin
        v_details := btrim(p ->> 'property_details')::jsonb;
      exception when others then
        v_details := null;
      end;
    end if;
    v_area := public.listing_area_text(coalesce(
      nullif(btrim(p ->> 'neighborhood'), ''),
      nullif(btrim(v_details ->> 'neighborhood'), '')));
    begin
      v_size := nullif(coalesce(p ->> 'size_sqm', v_details ->> 'size_sqm'), '')::numeric;
    exception when others then
      v_size := null;
    end;
    if v_size is not null and (v_size < 5 or v_size > 100000 or v_size = 'NaN'::numeric) then
      v_size := null;
    end if;
    begin
      v_floor_n := nullif(coalesce(p ->> 'floor', v_details ->> 'floor'), '')::numeric;
    exception when others then
      v_floor_n := null;
    end;
    if v_floor_n is not null and v_floor_n = trunc(v_floor_n)
       and v_floor_n >= -5 and v_floor_n <= 120 then
      v_floor := v_floor_n::int;
    end if;
    begin
      if v_type = 'owner_inbound' then
        v_budget_fallback := nullif(coalesce(
          p ->> 'price', v_details ->> 'price', v_details ->> 'budget'), '')::numeric;
      else
        v_budget_fallback := nullif(v_details ->> 'budget', '')::numeric;
      end if;
    exception when others then
      v_budget_fallback := null;
    end;
    if v_budget_fallback is not null and (
         v_budget_fallback <= 0 or v_budget_fallback = 'NaN'::numeric
         or v_budget_fallback > 100000000000) then
      v_budget_fallback := null;
    end if;
    begin
      v_rooms_fallback := nullif(v_details ->> 'rooms', '')::numeric;
    exception when others then
      v_rooms_fallback := null;
    end;
    if v_rooms_fallback is not null and v_rooms_fallback <= 0 then
      v_rooms_fallback := null;
    end if;
    v_deal_fallback := nullif(btrim(v_details ->> 'deal_type'), '');
    if v_deal_fallback is not null and v_deal_fallback not in ('sale', 'rent') then
      v_deal_fallback := null;
    end if;
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
    if v_source = 'facebook_group' then
      begin
        update public.scraped_leads
           set rooms = coalesce(nullif(p ->> 'rooms', '')::numeric, v_rooms_fallback, rooms),
               budget = coalesce(nullif(p ->> 'budget', '')::numeric, v_budget_fallback, budget),
               deal_type = coalesce(v_deal, v_deal_fallback, deal_type),
               property_type = coalesce(
                 nullif(btrim(p ->> 'property_type'), ''),
                 nullif(btrim(v_details ->> 'property_type'), ''),
                 property_type),
               size_sqm = coalesce(v_size, size_sqm),
               floor = coalesce(v_floor, floor),
               area_text = coalesce(v_area, area_text),
               neighborhood_id = coalesce(neighborhood_id, (
                 select n.id from public.neighborhoods n
                  where n.city_id = scraped_leads.city_id
                    and n.name = nullif(btrim(coalesce(
                      p ->> 'neighborhood', v_details ->> 'neighborhood')), '')
                  limit 1))
         where id = v_id;
      exception when others then
        null;
      end;
    end if;
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

  if v_deal is null then
    v_deal := v_deal_fallback;
  end if;

  insert into public.scraped_leads (lead_type, source, source_detail, post_url, external_ref, posted_at,
                                    raw_name, raw_phone, raw_message, city, city_id, neighborhood_id,
                                    deal_type, property_type, rooms, budget, move_in, property_details,
                                    consent_requested_at, no_broker, demand_summary, phone_hash,
                                    push_site_only, date_known, size_sqm, floor, area_text)
  values (v_type, v_source, left(nullif(btrim(p ->> 'source_detail'), ''), 120), v_url, v_ref, v_posted,
          left(nullif(btrim(p ->> 'raw_name'), ''), 80), v_phone, left(nullif(btrim(p ->> 'raw_message'), ''), 4000),
          v_city, v_city_id,
          (select n.id from public.neighborhoods n
            where n.id::text = nullif(btrim(p ->> 'neighborhood_id'), '')
               or (n.city_id = v_city_id and n.name = nullif(btrim(coalesce(
                    p ->> 'neighborhood', v_details ->> 'neighborhood')), ''))
            limit 1),
          v_deal,
          coalesce(nullif(btrim(p ->> 'property_type'), ''), nullif(btrim(v_details ->> 'property_type'), '')),
          coalesce(nullif(p ->> 'rooms', '')::numeric, v_rooms_fallback),
          coalesce(nullif(p ->> 'budget', '')::numeric, v_budget_fallback),
          left(nullif(btrim(p ->> 'move_in'), ''), 60), left(nullif(btrim(p ->> 'property_details'), ''), 300),
          case when v_ask then now() end,
          v_nobrk, left(nullif(btrim(p ->> 'summary'), ''), 160), v_hash,
          v_site_only, v_known, v_size, v_floor, v_area)
  on conflict (source, external_ref) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.scraped_leads
     where source = v_source and external_ref = v_ref;
    if v_source = 'facebook_group' then
      begin
        update public.scraped_leads
           set rooms = coalesce(nullif(p ->> 'rooms', '')::numeric, v_rooms_fallback, rooms),
               budget = coalesce(nullif(p ->> 'budget', '')::numeric, v_budget_fallback, budget),
               deal_type = coalesce(v_deal, v_deal_fallback, deal_type),
               property_type = coalesce(
                 nullif(btrim(p ->> 'property_type'), ''),
                 nullif(btrim(v_details ->> 'property_type'), ''),
                 property_type),
               size_sqm = coalesce(v_size, size_sqm),
               floor = coalesce(v_floor, floor),
               area_text = coalesce(v_area, area_text),
               neighborhood_id = coalesce(neighborhood_id, (
                 select n.id from public.neighborhoods n
                  where n.city_id = scraped_leads.city_id
                    and n.name = nullif(btrim(coalesce(
                      p ->> 'neighborhood', v_details ->> 'neighborhood')), '')
                  limit 1))
         where id = v_id;
      exception when others then
        null;
      end;
    end if;
    return jsonb_build_object('duplicate', 'post', 'id', v_id);
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
  'קליטת פוסט מפייסבוק או מודעה ממדלן/יד2. בלוח, date_known בלי first_seen_at נחשב רגע הקליטה ולא מלאי ישן. date_known false נשאר באתר. בלי טלפון רק למדלן וליד2. מספר מרכזיה של מדלן (073, 083, 093, 033) לא משתתף בכפילות. ליד שנולד לסוכן/ת נרשם assigned ב-lead_routing_log, בלי טלפון. לקבוצת פייסבוק נשמרים גם size_sqm, floor ו-area_text, והטריגר כותב שורת מלאי בלי טלפון. docs/scraped-leads.md';
revoke all on function public.scraped_lead_add(jsonb) from public, anon, authenticated;
grant execute on function public.scraped_lead_add(jsonb) to service_role;

create or replace function public.scraped_lead_notify_demand(p_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r        public.scraped_leads%rowtype;
  v_title  text;
  v_body   text;
  v_n      int := 0;
  v_days   int := greatest(1, coalesce(
             (select value::int from public.pricing_config
               where key = 'notif_burst_scraped_stale_days'), 14));
  v_site   boolean;
  v_on     boolean;
  v_cap    int;
  v_fanout int;
  v_look   int;
  v_suppress boolean := false;
  v_match  boolean;
  v_done   boolean := false;
  v_hits   int := 0;
  v_all    int := 0;
  v_prior  int := 0;
  v_rn     int := 0;
  v_nid    uuid;
  v_line   text;
  v_street text;
  v_prooms numeric;
  v_social boolean := false;
  v_tpl    boolean := false;
  v_link   text := null;
  v_supply jsonb;
  v_hood   text;
  v_place  text;
  v_size   text;
  v_floor  text;
  rec      record;
begin
  select * into r from public.scraped_leads where id = p_id for update;
  if not found or r.demand_notified_at is not null or r.claimed_by is not null
     or not public.scraped_lead_is_demand(r.status, r.lead_type, r.no_broker, r.posted_at, r.city_id) then
    return 0;
  end if;

  if pg_catalog.to_regprocedure('public.notifications_suppress_on()') is not null then
    execute 'select public.notifications_suppress_on()' into v_suppress;
  end if;
  v_site := coalesce(r.push_site_only, false)
    or (r.posted_at is not null and r.posted_at < now() - make_interval(days => v_days))
    or coalesce(v_suppress, false);
  -- מלאי בלי date_known, או שורה שסומנה לא לדחיפה: אין שורת התראה בכלל,
  -- לא בפעמון ולא בוואטסאפ. מודעה עם תאריך ידוע ובתוך התקרה ממשיכה כרגיל.
  if r.source in ('madlan', 'yad2') and (
    not coalesce(r.date_known, false) or coalesce(r.push_site_only, false)
  ) then
    return 0;
  end if;

  v_social := public.social_buyer_is_dm(r.source, r.lead_type);
  -- בלי יומן אי אפשר לחתוך ל-8. לא מסמנים כמופץ, והסבב ינסה שוב.
  if v_social and pg_catalog.to_regclass('public.open_demand_notify_log') is null then
    return 0;
  end if;
  if v_social and pg_catalog.to_regprocedure('public.whatsapp_template_cap_on()') is not null then
    execute 'select public.whatsapp_template_cap_on()' into v_tpl;
  end if;
  -- תקרת התבניות כבויה (notif_digest_enabled = 0): פעמון בלבד, בלי וואטסאפ.
  if v_social and not coalesce(v_tpl, false) then
    v_site := true;
  end if;

  v_on := coalesce((select value::int from public.pricing_config
                     where key = 'open_demand_notify_cap_enabled'), 0) = 1;
  v_match := coalesce((select value::int from public.pricing_config
                        where key = 'scraped_lead_matching_enabled'), 0) = 1;
  v_cap := greatest(1, least(coalesce(
             (select value::int from public.pricing_config
               where key = 'open_demand_notify_cap'), 8), 80));
  v_look := greatest(1, least(coalesce(
             (select value::int from public.pricing_config
               where key = 'open_demand_pull_lookback_days'), 14), 90));

  if r.source in ('madlan', 'yad2') then
    -- מודעת לוח: בלי טלפון, בלי חיוב ובלי פניה לבעלים.
    -- מיקום, חדרים, שטח, קומה ומחיר. הקישור ב-action_url, לא בטקסט.
    v_title := 'מודעה חדשה ב' || r.city;
    v_hood := null;
    if r.neighborhood_id is not null then
      select n.name into v_hood from public.neighborhoods n where n.id = r.neighborhood_id;
    end if;
    v_place := case
      when nullif(btrim(v_hood), '') is not null then btrim(v_hood) || ', ' || r.city
      else r.city
    end;
    -- מ"ר, מ״ר, מ׳ר, מר או מטר. "מרפסות" ו"מרתף" אינם שטח:
    -- אחרי היחידה חייב מפריד, לא אות.
    v_size := substring(
      coalesce(r.demand_summary, '') || ' '
      from '([0-9]{1,4})[[:space:]]*(מ["״׳]ר|מטר|מר)[[:space:],.]'
    );
    v_floor := substring(coalesce(r.demand_summary, '') from '(קומה[[:space:]]*[0-9]{1,2}|קרקע)');
    v_body := concat_ws(' · ',
      v_place,
      case when r.rooms is not null then trim_scale(r.rooms)::text || ' חדרים' end,
      case when v_size is not null then v_size || ' מ״ר' end,
      v_floor,
      case when r.budget is not null then '₪' || to_char(r.budget, 'FM999,999,999') end);
    v_link := null;
    if r.post_url ~* '^https://([a-z0-9-]+\.)*(madlan\.co\.il|yad2\.co\.il)/'
       and char_length(r.post_url) between 18 and 500
       and r.post_url !~ '[[:space:]@]' then
      v_link := r.post_url;
    end if;
  else
    v_title := 'ביקוש פתוח: '
      || case when r.lead_type = 'owner_inbound'
              then case r.deal_type when 'rent' then 'משכיר/ה' else 'מוכר/ת' end
              else case r.deal_type when 'rent' then 'מחפשים לשכור' else 'מחפשים לקנות' end end
      || ' ב' || r.city;
    v_body := concat_ws(' · ', r.property_type,
                        case when r.rooms is not null then trim_scale(r.rooms)::text || ' חדרים' end,
                        case when r.budget is not null
                             then case when r.lead_type = 'owner_inbound' then '₪' else 'עד ₪' end
                                  || to_char(r.budget, 'FM999,999,999') end,
                        case when r.move_in is not null then 'כניסה: ' || r.move_in end,
                        case when r.no_broker is not null then 'כתבו ללא תיווך' end)
      || case
           when v_social and public.social_post_host_ok(r.source_post_url)
             then '. בלי עלות. הסוכן הראשון שלוחץ "אני פונה" מקבל קישור לפוסט.'
           when v_social
             then '. בלי עלות. הסוכן הראשון שלוחץ "אני פונה" מקבל את פרטי הקשר.'
           else '. בלי עלות, למי שלוחץ ראשון על "אני פונה". '
                || 'אפשר להגיב רק בפוסט או בהודעת פייסבוק, לא ב-SMS ולא בוואטסאפ.'
         end;
    v_link := null;
  end if;


  -- מחפש/ת מפייסבוק: שורה על מלאי פעיל, רק כשהדגל הקיים דלוק.
  -- אין פניה לפונה. no_broker לא מגיע לכאן (scraped_lead_is_demand).
  if r.lead_type = 'seeker_inbound'
     and r.source = 'facebook_group'
     and r.no_broker is null
     and coalesce((select value::int from public.pricing_config
                    where key = 'scraped_lead_matching_enabled'), 0) = 1
     and pg_catalog.to_regprocedure('public.scraped_seeker_supply(uuid)') is not null then
    begin
      v_supply := public.scraped_seeker_supply(r.id);
      if coalesce((v_supply ->> 'properties')::int, 0)
         + coalesce((v_supply ->> 'listings')::int, 0) > 0 then
        v_body := left(v_body || E'\nיש התאמה במלאי הפעיל. בלי לפנות לבעלים.', 500);
      end if;
    exception when others then
      null;
    end;
  end if;

  -- התאמה רק כשהתקרה כבויה. תקרה דלוקה נשארת המסלול של 20271029220000.
  if v_match and not v_on and not v_social then
    v_fanout := coalesce(
      (select value::int from public.pricing_config
        where key = 'notif_burst_demand_fanout'), 15);

    if r.match_first_at is not null
       and r.match_first_at > now() - interval '30 minutes' then
      return 0;
    elsif r.match_first_at is not null then
      select count(*)::int into v_rn
        from public.scraped_lead_match_dispatch d
       where d.scraped_lead_id = p_id;
      for rec in
        select a.agent_id
          from public.scraped_lead_demand_audience(p_id) a
         where not exists (
           select 1 from public.scraped_lead_match_dispatch d
            where d.scraped_lead_id = p_id and d.agent_id = a.agent_id
         )
         order by a.base_rn
      loop
        v_rn := v_rn + 1;
        insert into public.notifications (agent_id, type, title, body, suppress_push, action_url)
        values (
          rec.agent_id, 'open_demand', v_title, left(v_body, 500),
          v_site or (v_fanout > 0 and v_rn > v_fanout),
          v_link
        )
        returning id into v_nid;
        insert into public.scraped_lead_match_dispatch
          (scraped_lead_id, agent_id, notification_id, wave, score)
        values (p_id, rec.agent_id, v_nid, 2, 0);
        v_n := v_n + 1;
      end loop;
      update public.scraped_leads set demand_notified_at = now() where id = p_id;
      return v_n;
    else
      select count(*)::int into v_all from public.scraped_lead_demand_audience(p_id);
      select count(*)::int into v_hits
        from public.scraped_lead_matches(p_id) h
        join public.scraped_lead_demand_audience(p_id) a on a.agent_id = h.agent_id;
      if v_hits > 0 then
        for rec in
          select h.agent_id, h.score, h.match_kind, h.matched_client_ids, h.matched_property_ids, h.exact
            from public.scraped_lead_matches(p_id) h
            join public.scraped_lead_demand_audience(p_id) a on a.agent_id = h.agent_id
           order by h.score desc, a.base_rn
        loop
          v_rn := v_rn + 1;
          v_street := null;
          v_prooms := null;
          if rec.match_kind = 'has_property' and rec.matched_property_ids[1] is not null then
            select p.street, p.rooms into v_street, v_prooms
              from public.properties p
             where p.id = rec.matched_property_ids[1];
          end if;
          v_line := public.scraped_lead_match_line(rec.match_kind, rec.exact, v_prooms, v_street);
          insert into public.notifications (
            agent_id, type, title, body, suppress_push, action_url,
            match_score, match_kind, matched_client_ids, matched_property_ids
          )
          values (
            rec.agent_id, 'open_demand', v_title,
            left(v_body || coalesce(E'\n' || v_line, ''), 500),
            v_site or (v_fanout > 0 and v_rn > v_fanout),
            v_link,
            rec.score, rec.match_kind, rec.matched_client_ids, rec.matched_property_ids
          )
          returning id into v_nid;
          insert into public.scraped_lead_match_dispatch (
            scraped_lead_id, agent_id, notification_id, wave, score, match_kind,
            matched_client_ids, matched_property_ids
          )
          values (
            p_id, rec.agent_id, v_nid, 1, rec.score, rec.match_kind,
            rec.matched_client_ids, rec.matched_property_ids
          );
          v_n := v_n + 1;
        end loop;
        if v_hits >= v_all then
          update public.scraped_leads
             set demand_notified_at = now(), match_first_at = now()
           where id = p_id;
        else
          update public.scraped_leads set match_first_at = now() where id = p_id;
        end if;
        return v_n;
      end if;
    end if;
  end if;

  -- מי שכבר קיבל בגל הראשון לא מקבל שוב, ונספר בתקרת 15.
  v_prior := coalesce((
    select count(*)::int from public.scraped_lead_match_dispatch d
     where d.scraped_lead_id = p_id
  ), 0);

  if not v_on and not v_social then
    v_fanout := coalesce(
      (select value::int from public.pricing_config
        where key = 'notif_burst_demand_fanout'), 15);
    insert into public.notifications (agent_id, type, title, body, suppress_push, action_url)
    select s.id, 'open_demand', v_title, left(v_body, 500),
           v_site or (v_fanout > 0 and (s.rn + v_prior) > v_fanout),
           v_link
      from (
        select m.id,
               row_number() over (
                 order by
                   case
                     when a.city_id = r.city_id then 0
                     when exists (
                       select 1
                         from public.agent_lead_preferences lp
                         join public.neighborhoods n
                           on n.id = any (lp.preferred_neighborhoods)
                        where lp.agent_id = m.id
                          and lp.active
                          and n.city_id = r.city_id
                     ) then 1
                     else 2
                   end,
                   w.last_message_at desc nulls last,
                   m.id
               ) as rn
          from public.agency_members m
          left join public.agencies a on a.id = m.agency_id
          left join public.whatsapp_conversations w on w.agent_id = m.id
         where m.active
           and public.agent_works_city(m.id, r.city_id)
           and public.agent_handles_type(m.id, r.property_type, r.deal_type)
           and not exists (
             select 1 from public.scraped_lead_match_dispatch d
              where d.scraped_lead_id = p_id and d.agent_id = m.id
           )
      ) s;
    get diagnostics v_n = row_count;
  else
    with eligible as (
      select m.id as agent_id, pulls.last_pull, noted.last_notified
        from public.agency_members m
        left join lateral (
          select max(x.at) as last_pull
            from (
              select l.unlocked_at as at
                from public.leads l
               where l.unlocked_by = m.id
                 and l.unlocked_at is not null
                 and l.unlocked_at >= now() - make_interval(days => v_look)
                 and l.unlocked_at > l.created_at + interval '1 second'
              union all
              select s.claimed_at
                from public.scraped_leads s
               where s.claimed_by = m.id
                 and s.claimed_at is not null
                 and s.claimed_at >= now() - make_interval(days => v_look)
            ) x
        ) pulls on true
        left join lateral (
          select max(n.created_at) as last_notified
            from public.notifications n
           where n.agent_id = m.id
             and n.type = 'open_demand'
        ) noted on true
       where m.active
         and m.released_at is null
         and coalesce(m.license_status, '') not in ('not_found', 'inactive')
         and public.notification_type_enabled(m.id, 'open_demand')
         and public.agent_works_city(m.id, r.city_id)
         and public.agent_handles_type(m.id, r.property_type, r.deal_type)
         and not exists (
           select 1 from public.scraped_lead_match_dispatch d
            where d.scraped_lead_id = p_id and d.agent_id = m.id
         )
    ),
    ranked as (
      select e.agent_id, e.last_pull, e.last_notified,
             row_number() over (
               order by e.last_pull asc nulls first,
                        e.last_notified asc nulls first,
                        random()
             ) as rk
        from eligible e
    ),
    picked as (
      select * from ranked where rk <= greatest(0, v_cap - v_prior)
    ),
    ins as (
      insert into public.notifications (agent_id, type, title, body, suppress_push, action_url)
      select p.agent_id, 'open_demand', v_title, left(v_body, 500), v_site, v_link
        from picked p
      returning agent_id
    ),
    logged as (
      insert into public.open_demand_notify_log
        (scraped_lead_id, agent_id, rank, reason, last_pull_at, last_notified_at, cap, lookback_days)
      select p_id, p.agent_id, p.rk,
             case when p.last_pull is null then 'no_pull' else 'recent_pull' end,
             p.last_pull, p.last_notified, v_cap, v_look
        from picked p
        join ins i on i.agent_id = p.agent_id
      returning agent_id
    )
    select count(*)::int into v_n
      from ins;
  end if;

  update public.scraped_leads set demand_notified_at = now() where id = p_id;
  return v_n;
end $$;

comment on function public.scraped_lead_notify_demand(uuid) is
  'התראת open_demand. במדלן וביד2 הגוף בלי טלפון ובלי כתובת, והקישור ב-action_url. פייסבוק נשאר כמו שהיה, ובמחפש/ת מתווספת שורת מלאי כשההתאמה דלוקה. מחפש/ת מהרשתות: עד התקרה, גם כשהדגל הגלובלי כבוי, ובלי וואטסאפ כשתקרת התבניות כבויה.';

revoke all on function public.scraped_lead_notify_demand(uuid) from public, anon, authenticated;
grant execute on function public.scraped_lead_notify_demand(uuid) to service_role;

create or replace function public._listing_supply_pool(
  p_city  text,
  p_deal  text,
  p_kind  text,
  p_rooms numeric
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_city     text := nullif(btrim(p_city), '');
  v_city_id  uuid;
  v_lo       numeric;
  v_hi       numeric;
  v_has_dup  boolean;
  v_stale    int := 4;
  v_boards   jsonb;
  v_as_of    timestamptz;
  v_items    jsonb;
begin
  if v_city is null or p_deal is null or p_deal not in ('sale', 'rent') or p_kind is null then
    return null;
  end if;
  -- בלי חדרים אין "דומה": דירת 2 ודירת 6 אינן אותו שוק. מגרש נספר בלי חדרים.
  if p_kind <> 'land' and (p_rooms is null or p_rooms <= 0) then
    return null;
  end if;

  if p_deal = 'sale' then v_lo := 100000; v_hi := 50000000;
  else v_lo := 500; v_hi := 50000; end if;

  v_city_id := public.city_id_for_name(v_city);

  -- האם המלאי מכסה את העיר בכלל, ומתי נראתה בה מודעה לאחרונה. עיר שאינה
  -- נסרקת אינה "0 מודעות בלוחות", וצילום שהפסיק להגיע אינו "כרגע".
  select coalesce(jsonb_agg(distinct i.source), '[]'::jsonb), max(i.last_seen_at)
    into v_boards, v_as_of
    from public.listing_inventory i
   where i.removed_at is null
     and i.source in ('yad2', 'madlan')
     and i.deal_type = p_deal
     and ((v_city_id is not null and i.city_id = v_city_id) or btrim(i.city) = v_city);
  if v_as_of is null then
    return null;
  end if;
  begin
    v_stale := coalesce((select value::int from public.app_config
                          where key = 'listing_supply_stale_days'), 4);
  exception when others then
    v_stale := 4;
  end;
  if v_stale < 1 then v_stale := 4; end if;
  if v_as_of < pg_catalog.now() - make_interval(days => v_stale) then
    return null;
  end if;

  -- is_duplicate מגיע עם #1330. כל עוד העמודה אינה קיימת - אין מה לסנן.
  v_has_dup := exists (
    select 1 from pg_catalog.pg_attribute a
     where a.attrelid = 'public.listing_inventory'::regclass
       and a.attname = 'is_duplicate' and not a.attisdropped);

  execute '
    select coalesce(jsonb_agg(jsonb_build_object(
             ''id'', i.id, ''source'', i.source, ''price'', i.price)), ''[]''::jsonb)
      from public.listing_inventory i
     where i.removed_at is null
       and i.source in (''yad2'', ''madlan'')
       and i.deal_type = $1
       and i.price between $2 and $3
       and i.price <> ''NaN''::numeric
       and (($4::uuid is not null and i.city_id = $4) or btrim(i.city) = $5)
       and public.board_listing_kind(i.property_type) = $6
       and ($6 = ''land'' or (i.rooms is not null and abs(i.rooms - $7) <= 0.5))'
    || case when v_has_dup then ' and not coalesce(i.is_duplicate, false)' else '' end
     into v_items
    using p_deal, v_lo, v_hi, v_city_id, v_city, p_kind, p_rooms;

  return jsonb_build_object(
    'city', v_city, 'deal_type', p_deal, 'kind', p_kind,
    'rooms', case when p_kind <> 'land' then p_rooms end,
    'boards', v_boards, 'as_of', v_as_of,
    'price_lo', v_lo, 'price_hi', v_hi,
    'items', v_items);
end $$;
revoke all on function public._listing_supply_pool(text, text, text, numeric) from public, anon, authenticated;
grant execute on function public._listing_supply_pool(text, text, text, numeric) to service_role;

comment on function public._listing_supply_pool(text, text, text, numeric) is
  'בריכת מודעות יד2 ומדלן בלבד. פוסט פייסבוק אינו צילום שוק ואינו מרענן את as_of. docs/listing-inventory.md';

create or replace function public.scraped_lead_enrich(p_id uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.scraped_leads%rowtype;
  v_size numeric;
  v_floor int;
  v_floor_n numeric;
  v_area text;
begin
  select * into s from public.scraped_leads where id = p_id for update;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;
  if s.status not in ('pending_consent', 'open_demand') then
    return jsonb_build_object('error', 'already_' || s.status);
  end if;
  if p ? 'deal_type' and nullif(btrim(p ->> 'deal_type'), '') not in ('sale', 'rent') then
    return jsonb_build_object('error', 'invalid_deal_type');
  end if;

  v_size := null;
  v_floor := null;
  v_area := null;
  if s.source = 'facebook_group' then
    begin
      v_size := nullif(p ->> 'size_sqm', '')::numeric;
    exception when others then
      v_size := null;
    end;
    if v_size is not null and (v_size < 5 or v_size > 100000 or v_size = 'NaN'::numeric) then
      v_size := null;
    end if;
    begin
      v_floor_n := nullif(p ->> 'floor', '')::numeric;
    exception when others then
      v_floor_n := null;
    end;
    if v_floor_n is not null and v_floor_n = trunc(v_floor_n)
       and v_floor_n >= -5 and v_floor_n <= 120 then
      v_floor := v_floor_n::int;
    end if;
    v_area := public.listing_area_text(nullif(btrim(p ->> 'neighborhood'), ''));
  end if;

  update public.scraped_leads
     set demand_summary = coalesce(left(nullif(btrim(p ->> 'summary'), ''), 160), demand_summary),
         budget         = coalesce(nullif(p ->> 'budget', '')::numeric, budget),
         rooms          = coalesce(nullif(p ->> 'rooms', '')::numeric, rooms),
         move_in        = coalesce(left(nullif(btrim(p ->> 'move_in'), ''), 60), move_in),
         property_type  = coalesce(nullif(btrim(p ->> 'property_type'), ''), property_type),
         deal_type      = coalesce(nullif(btrim(p ->> 'deal_type'), ''), deal_type),
         source_detail  = coalesce(left(nullif(btrim(p ->> 'source_detail'), ''), 120), source_detail),
         neighborhood_id = coalesce((select n.id from public.neighborhoods n
                                      where n.city_id = s.city_id and n.name = nullif(btrim(p ->> 'neighborhood'), '')
                                      limit 1), neighborhood_id),
         size_sqm = case when s.source = 'facebook_group' then coalesce(v_size, size_sqm) else size_sqm end,
         floor = case when s.source = 'facebook_group' then coalesce(v_floor, floor) else floor end,
         area_text = case when s.source = 'facebook_group' then coalesce(v_area, area_text) else area_text end
   where id = p_id
  returning * into s;

  if public.scraped_lead_no_broker(s.source_detail) then
    update public.scraped_leads set no_broker = 'group' where id = p_id;
  elsif s.no_broker is null and coalesce((p ->> 'no_broker')::boolean, false) then
    update public.scraped_leads set no_broker = 'post' where id = p_id;
  end if;

  select * into s from public.scraped_leads where id = p_id;
  return jsonb_build_object('success', true, 'id', p_id, 'no_broker', s.no_broker,
                            'open_demand', public.scraped_lead_is_demand(s.status, s.lead_type, s.no_broker,
                                                                         s.posted_at, s.city_id));
end $$;
comment on function public.scraped_lead_enrich(uuid, jsonb) is
  'הסורק משלים בפוסט קיים: summary, budget, rooms, move_in, property_type, deal_type, source_detail, neighborhood, וגם size_sqm, floor ו-area_text בפייסבוק. בלי שדות מזהים. docs/scraped-leads.md';
revoke all on function public.scraped_lead_enrich(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.scraped_lead_enrich(uuid, jsonb) to service_role;

create or replace function public.scraped_seeker_supply(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.scraped_leads%rowtype;
  v_ids uuid[] := '{}';
  v_area text;
  v_props int := 0;
  v_lists int := 0;
begin
  select * into s from public.scraped_leads where id = p_id;
  if not found or s.lead_type is distinct from 'seeker_inbound' or s.no_broker is not null then
    return jsonb_build_object('properties', 0, 'listings', 0);
  end if;
  if pg_catalog.to_regprocedure('public.city_ids_for_name(text)') is not null then
    execute 'select public.city_ids_for_name($1)' into v_ids using s.city;
  end if;
  v_ids := coalesce(v_ids, '{}'::uuid[]);
  v_area := public.listing_area_text(s.area_text);
  if v_area is null and s.neighborhood_id is not null
     and pg_catalog.to_regclass('public.neighborhoods') is not null then
    select public.listing_area_text(n.name) into v_area
      from public.neighborhoods n
     where n.id = s.neighborhood_id;
  end if;

  if pg_catalog.to_regclass('public.properties') is not null then
    execute $q$
      select count(*)::int
        from public.properties p
       where p.agent_id is not null
         and p.status = 'active'
         and (p.listing_expires_at is null or p.listing_expires_at >= current_date)
         and (
           ($1::uuid is not null and p.city_id = $1)
           or btrim(coalesce(p.city, '')) = btrim($2)
           or (p.city_id is not null and p.city_id = any($3))
         )
         and ($4::text is null or p.deal_type = $4)
         and ($5::numeric is null or p.rooms is null or abs(p.rooms - $5) <= 1)
         and ($6::numeric is null or p.price is null or p.price <= $6 * 1.15)
    $q$ into v_props
    using s.city_id, s.city, v_ids, s.deal_type, s.rooms, s.budget;
  end if;

  select count(*)::int into v_lists
    from public.listing_inventory i
   where i.removed_at is null
     and (
       (s.city_id is not null and i.city_id = s.city_id)
       or btrim(i.city) = btrim(s.city)
       or (i.city_id is not null and i.city_id = any(v_ids))
     )
     and (s.deal_type is null or i.deal_type = s.deal_type)
     and (s.rooms is null or i.rooms is null or abs(i.rooms - s.rooms) <= 1)
     and (s.budget is null or i.price is null or i.price <= s.budget * 1.15)
     and (
       v_area is null
       or i.neighborhood is null
       or public.listing_area_text(i.neighborhood) = v_area
     );

  return jsonb_build_object('properties', coalesce(v_props, 0), 'listings', coalesce(v_lists, 0));
end $$;

comment on function public.scraped_seeker_supply(uuid) is
  'כמה נכסים פעילים וכמה מודעות חיות מתאימים למחפש/ת. בלי טלפון ובלי כתובת. no_broker מחזיר אפס. docs/scraped-leads.md';
revoke all on function public.scraped_seeker_supply(uuid) from public, anon, authenticated;
grant execute on function public.scraped_seeker_supply(uuid) to service_role;

-- מילוי שקט. לא קורא ל-scraped_lead_add ולא שולח התראה.
update public.scraped_leads
   set area_text = area_text
 where source = 'facebook_group'
   and lead_type = 'owner_inbound';
