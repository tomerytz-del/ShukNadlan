-- ============================================================================
-- מלאי יד2/מדלן: היסטוריית מחירים, ושטח, קומה ושכונה
--
-- מה חסר היום:
--   listing_inventory_sync דורס את המחיר בכל סנכרון
--   (price = coalesce(excluded.price, ...)), ולכן אי אפשר לדעת איזו מודעה
--   ירדה במחיר, מתי ובכמה. זה נתון שאי אפשר לשחזר למפרע: כל יום בלי
--   הטבלה הוא יום של שינויי מחיר שאבדו.
--   ובמודעה יש רק עיר, סוג, חדרים ומחיר. בלי שטח, קומה ושכונה אין מחיר
--   למ"ר ואין דירוג: כרטיס לקוח/ה בעפולה "מתאים" ל-134 מודעות בחציון
--   (נמדד 19.11.2026), כלומר לא מתאים לאף אחת.
--
-- מה נכנס:
--   1. listing_inventory_price_history - שורה לכל שינוי מחיר (ישן, חדש,
--      מתי), לפי מודעה. מקור ועיר נשמרים בשורה, כמו ביומן הסנכרון, כדי
--      שיד2 ומדלן יישארו מופרדים. בלי טלפון ובלי שם.
--   2. size_sqm, floor, neighborhood ב-listing_inventory. רשות: סורק שאינו
--      שולח אותם ממשיך לעבוד כמו היום, וערך חסר אינו דורס ערך קיים.
--      ערך שאינו סביר נזרק ולא מנוחש. אין כתובת רחוב.
--      את השורה כותב טריגר על listing_inventory, לא גוף הסנכרון.
--   3. listing_inventory_sync: העתק מלא של הגרסה מ-20271112130000
--      (md5(prosrc) בפרודקשן 2593f055fc95dc358c0c4f5a57f22540, זהה לקובץ),
--      עם שלושת השדות ו-price_changes בתשובה וביומן.
--      מי שמחליף את הפונקציה אחרי המיגרציה הזו מעתיק מכאן:
--      scripts/listing_inventory_test.py נכשל על העתק שחסרים בו השדות.
--
-- מה לא משתנה: הזריעה, הלידים, ההתראות, סימון ההסרות, וההפרדה בין מקור
-- למקור ובין עיר לעיר. docs/listing-inventory.md
-- ============================================================================

alter table public.listing_inventory
  add column if not exists size_sqm numeric
    check (size_sqm is null or (size_sqm >= 5 and size_sqm <= 100000));
alter table public.listing_inventory
  add column if not exists floor int
    check (floor is null or (floor >= -5 and floor <= 120));
alter table public.listing_inventory
  add column if not exists neighborhood text
    check (neighborhood is null or char_length(neighborhood) between 1 and 60);

comment on column public.listing_inventory.size_sqm is
  'שטח במ"ר כפי שהסורק ראה. ריק כשלא נשלח או כשהערך אינו סביר.';
comment on column public.listing_inventory.floor is
  'קומה. 0 היא קומת קרקע. ריק כשלא נשלח.';
comment on column public.listing_inventory.neighborhood is
  'שם השכונה כפי שמופיע במודעה, טקסט חופשי. לא כתובת רחוב.';

alter table public.listing_inventory_sync_log
  add column if not exists price_changes int not null default 0;

create table if not exists public.listing_inventory_price_history (
  id          uuid primary key default gen_random_uuid(),
  listing_id  uuid not null references public.listing_inventory(id) on delete cascade,
  source      text not null check (source in ('yad2', 'madlan')),
  city        text not null check (char_length(city) between 1 and 80),
  deal_type   text check (deal_type is null or deal_type in ('sale', 'rent')),
  old_price   numeric not null check (old_price > 0),
  new_price   numeric not null check (new_price > 0),
  changed_at  timestamptz not null default now(),
  check (old_price <> new_price)
);
comment on table public.listing_inventory_price_history is
  'שינויי מחיר של מודעות במלאי יד2/מדלן. שורה לכל שינוי שהסנכרון ראה, כמו שהוא. המחיר הראשון של מודעה אינו שורה: הוא old_price של השינוי הראשון שלה. בלי טלפון ובלי שם. docs/listing-inventory.md';

create index if not exists listing_inventory_price_history_listing_idx
  on public.listing_inventory_price_history (listing_id, changed_at);
create index if not exists listing_inventory_price_history_city_idx
  on public.listing_inventory_price_history (source, city, changed_at desc);

alter table public.listing_inventory_price_history enable row level security;
revoke all on table public.listing_inventory_price_history from public, anon, authenticated;
grant select, insert, update, delete on table public.listing_inventory_price_history to service_role;

-- הרישום בטריגר ולא בגוף listing_inventory_sync, בכוונה: הפונקציה מוחלפת
-- כולה בכל מיגרציה שנוגעת בה (ו-PR פתוח, #1330, כבר מעתיק אותה מהגרסה
-- הקודמת). העתק ישן שנכנס אחרי המיגרציה הזו היה מוחק את הרישום בשקט, ושינוי
-- מחיר שלא נרשם אינו ניתן לשחזור. טריגר על הטבלה אינו תלוי בגרסת הפונקציה.
create or replace function public.listing_inventory_price_history_log()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.listing_inventory_price_history (
    listing_id, source, city, deal_type, old_price, new_price
  ) values (
    new.id, new.source, new.city, new.deal_type, old.price, new.price
  );
  return null;
end $$;
comment on function public.listing_inventory_price_history_log() is
  'טריגר: שורה ב-listing_inventory_price_history לכל שינוי מחיר במלאי. docs/listing-inventory.md';
revoke all on function public.listing_inventory_price_history_log() from public, anon, authenticated;
grant execute on function public.listing_inventory_price_history_log() to service_role;

drop trigger if exists listing_inventory_price_history_trg on public.listing_inventory;
create trigger listing_inventory_price_history_trg
  after update of price on public.listing_inventory
  for each row
  when (old.price is not null and new.price is not null and old.price <> new.price)
  execute function public.listing_inventory_price_history_log();

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
    if v_price is not null and v_price <= 0 then
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
     and t.price <> i.price;

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
  'מעדכן מלאי מודעות למקור ועיר. הסנכרון הראשון זורע בלי לידים, וגם השלמה גדולה בתוך חלון הימים. דחייה לא מנוסה שוב עד 30 יום או עד שינוי טלפון או מחיר. קולט גם size_sqm, floor ו-neighborhood, ומחזיר price_changes. docs/listing-inventory.md';
revoke all on function public.listing_inventory_sync(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.listing_inventory_sync(text, text, jsonb) to service_role;
