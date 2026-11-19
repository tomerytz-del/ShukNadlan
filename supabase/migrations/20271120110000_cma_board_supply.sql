-- ============================================================================
-- ההיצע בלוחות (יד2 / מדלן) בדוח ה-CMA
--
-- מה חסר היום:
--   שכבת "מול מי מתחרים" בדוח (market_comparables) נשענת רק על הנכסים הפעילים
--   באתר, 164 למכירה בכל האתר, ולכן רוב הדוחות נופלים ל-too_few ואין בהם
--   חציון מבוקש. במקביל listing_inventory מחזיק את מה שהקונה באמת רואה:
--   862 מודעות מכירה פעילות בעפולה לבדה (19.11.2026), והדוח אינו קורא אותו.
--
-- מה נכנס:
--   1. board_listing_kind(text): סוג הנכס של מודעת לוח -> house / garden /
--      roof / unit / land. property_kind הקיימת אינה מזהה את הכתיב של יד2
--      ("בית פרטי/ קוטג'" - 209 מודעות, "גג/ פנטהאוז" - 89: שתיהן null בגלל
--      הרווח אחרי הלוכסן). לא נוגעים ב-property_kind, שמשרתת את האתר ואת
--      מאגר העסקאות; זו פונקציה נפרדת למלאי בלבד, והיא חלה גם על סוג הנכס
--      של הנכס עצמו כדי ששני הצדדים יסווגו באותו כלל.
--   2. listing_supply_stats(city, deal, type, rooms, price): **החישוב היחיד**
--      של ההיצע בלוחות. כמה מודעות פעילות יש באותה עיר, אותו סוג עסקה, אותו
--      סוג נכס וחדרים ±0.5; רבעוני המחיר המבוקש; איפה המחיר של הנכס ביניהן;
--      וכמה מהן ירדו במחיר ב-30 הימים האחרונים. כל צרכן עתידי (כרטיס הנכס,
--      דוח לבעלים) קורא לה ולא מחשב בעצמו.
--   4. properties_board_supply(ids): אותו חישוב לרשימת הנכסים של הסוכן/ת,
--      לכרטיס הנכס ולחלון "דוח לבעלים" ב-CRM (ליועץ/ת בלבד). בסוף הקובץ.
--   3. cma_report_finish: העתק מלא מ-20271106100000 (md5(prosrc) בפרודקשן
--      4e96b8c46c32780017359e95459ca2f9, זהה לקובץ) עם בלוק אחד: board_supply.
--      הסיום משותף לדוח לנכס ולדוח לכתובת, ולכן שניהם מקבלים אותו.
--
-- הכללים שהחישוב שומר עליהם:
--   * מחיר מבוקש אינו מחיר עסקה. board_supply הוא אובייקט נפרד ואינו נוגע
--     ב-stats בשום תנאי (docs/cma.md, "שכבת השוק").
--   * מתחת לסף (8 מודעות) אין מספרים בכלל, רק status ו-sample. המסד מחליט,
--     לא התצוגה.
--   * ברמת עיר בלבד: במלאי אין מיקום. size_sqm, floor ו-neighborhood נכנסו
--     ב-20271119140000 ועוד לא מתמלאים; כשיתמלאו החישוב יוכל לרדת לשכונה
--     ולמחיר למ"ר, כאן ובמקום אחד.
--   * מודעות ולא נכסים: אותה דירה יכולה להופיע בלוח אצל כמה מפרסמים, ואין
--     כתובת שלפיה אפשר לאחד. שורה ש-#1330 יסמן is_duplicate (אותו נכס בלוח
--     השני) נספרת פעם אחת, כשהעמודה קיימת.
--   * ירידות מחיר נספרות רק אחרי 7 ימי מעקב (ההיסטוריה התחילה ב-19.11.2026),
--     ושינוי של יותר מ-50% נחשב טעות הקלדה ולא ירידה.
--   * מחיר שאינו סביר נשאר מחוץ לחישוב: מכירה 100 אלף עד 50 מיליון, שכירות
--     500 עד 50 אלף.
--
-- קריאה בלבד. אין כתיבה ל-listing_inventory, אין ליד, אין התראה ואין קישור
-- למודעה: הדוח נשלח ללקוח/ה, ומציג מספרים מצרפיים בלבד.
-- ============================================================================

create or replace function public.board_listing_kind(p_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when t is null then null
    when t ~ '(פנטהאוז|גג)' then 'roof'
    when t ~ 'דירת גן' then 'garden'
    when t ~ '(קוטג|בית פרטי|דו משפחתי|דו-משפחתי|וילה)' then 'house'
    when t ~ '^מגרש' then 'land'
    when t ~ '^(דירה|דופלקס|טריפלקס|יחידת דיור|סטודיו)' then 'unit'
  end
  from (select nullif(regexp_replace(btrim(coalesce(p_type, '')), '\s*/\s*', '/', 'g'), '') as t) s
$$;
comment on function public.board_listing_kind(text) is
  'סוג נכס של מודעת לוח (ושל הנכס שמשווים אליה): house / garden / roof / unit / land, או null לסוג שאין לו השוואה (מסחרי, משק, בניין). סובל את הכתיב של יד2 עם רווח אחרי הלוכסן. docs/listing-inventory.md';
revoke all on function public.board_listing_kind(text) from public, anon, authenticated;
grant execute on function public.board_listing_kind(text) to service_role;

create or replace function public.listing_supply_stats(
  p_city  text,
  p_deal  text,
  p_type  text,
  p_rooms numeric,
  p_price numeric
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
  v_kind     text := public.board_listing_kind(p_type);
  v_min      int := 8;
  v_lo       numeric;
  v_hi       numeric;
  v_has_dup  boolean;
  v_track    timestamptz := '2026-11-19 17:00:00+00';  -- תחילת רישום שינויי המחיר
  v_days     int;
  v_n        int := 0;
  v_stats    jsonb;
  v_drops    jsonb := null;
  v_sql      text;
begin
  if v_city is null or p_deal is null or p_deal not in ('sale', 'rent') or v_kind is null then
    return null;
  end if;
  -- בלי חדרים אין "דומה": דירת 2 ודירת 6 אינן אותו שוק. מגרש נספר בלי חדרים.
  if v_kind <> 'land' and (p_rooms is null or p_rooms <= 0) then
    return null;
  end if;

  begin
    v_min := coalesce((select value::int from public.app_config
                        where key = 'listing_supply_min_sample'), 8);
  exception when others then
    v_min := 8;
  end;
  if v_min < 3 then v_min := 8; end if;
  -- מתי התחיל רישום שינויי המחיר. ברירת המחדל היא המיזוג של 20271119140000.
  begin
    v_track := coalesce((select value::timestamptz from public.app_config
                          where key = 'listing_price_history_since'), v_track);
  exception when others then
    null;
  end;

  if p_deal = 'sale' then v_lo := 100000; v_hi := 50000000;
  else v_lo := 500; v_hi := 50000; end if;

  v_city_id := public.city_id_for_name(v_city);

  -- is_duplicate מגיע עם #1330. כל עוד העמודה אינה קיימת - אין מה לסנן.
  v_has_dup := exists (
    select 1 from pg_catalog.pg_attribute a
     where a.attrelid = 'public.listing_inventory'::regclass
       and a.attname = 'is_duplicate' and not a.attisdropped);

  v_sql := '
    select i.id, i.source, i.price, i.last_seen_at
      from public.listing_inventory i
     where i.removed_at is null
       and i.deal_type = $1
       and i.price between $2 and $3
       and i.price <> ''NaN''::numeric
       and (($4::uuid is not null and i.city_id = $4) or btrim(i.city) = $5)
       and public.board_listing_kind(i.property_type) = $6
       and ($6 = ''land'' or (i.rooms is not null and abs(i.rooms - $7) <= 0.5))'
    || case when v_has_dup then ' and not coalesce(i.is_duplicate, false)' else '' end;

  -- פונקציה stable אינה יוצרת טבלה: הבריכה נאספת למערך של שורות jsonb.
  execute 'select coalesce(jsonb_agg(jsonb_build_object(
             ''id'', q.id, ''source'', q.source, ''price'', q.price, ''seen'', q.last_seen_at)), ''[]''::jsonb)
             from (' || v_sql || ') q'
     into v_stats
    using p_deal, v_lo, v_hi, v_city_id, v_city, v_kind, p_rooms;

  v_n := jsonb_array_length(v_stats);

  if v_n < v_min then
    return jsonb_build_object(
      'status', 'too_few', 'sample', v_n, 'min_required', v_min,
      'city', v_city, 'deal_type', p_deal, 'kind', v_kind);
  end if;

  -- ירידות מחיר: רק אחרי שבוע של מעקב, ורק ירידה של עד 50% (מעבר לזה טעות הקלדה).
  v_days := least(30, floor(extract(epoch from (pg_catalog.now() - v_track)) / 86400)::int);
  if v_days >= 7 then
    select jsonb_build_object(
             'window_days', v_days,
             'listings', count(*),
             'share_pct', round(100.0 * count(*) / v_n),
             'median_drop_pct', round((percentile_cont(0.5) within group (order by d.pct))::numeric, 1))
      into v_drops
      from (
        select h.listing_id,
               100.0 * (max(h.old_price) - min(h.new_price)) / max(h.old_price) as pct
          from public.listing_inventory_price_history h
          join jsonb_array_elements(v_stats) x on (x->>'id')::uuid = h.listing_id
         where h.changed_at >= pg_catalog.now() - make_interval(days => v_days)
           and h.new_price < h.old_price
           and h.new_price >= h.old_price * 0.5
         group by h.listing_id
      ) d;
  end if;

  return (
    select jsonb_build_object(
             'status', 'ok',
             'sample', v_n,
             'min_required', v_min,
             'city', v_city,
             'deal_type', p_deal,
             'kind', v_kind,
             'rooms_from', case when v_kind <> 'land' then p_rooms - 0.5 end,
             'rooms_to',   case when v_kind <> 'land' then p_rooms + 0.5 end,
             'p25_price',    round((percentile_cont(0.25) within group (order by (x->>'price')::numeric))::numeric),
             'median_price', round((percentile_cont(0.5)  within group (order by (x->>'price')::numeric))::numeric),
             'p75_price',    round((percentile_cont(0.75) within group (order by (x->>'price')::numeric))::numeric),
             'min_price', min((x->>'price')::numeric),
             'max_price', max((x->>'price')::numeric),
             -- כמה מהמודעות זולות מהנכס (שוויון נספר בחצי), כמו האחוזון ב-stats
             'subject_percentile', case when p_price is not null and p_price > 0 then round(100.0 *
                 (count(*) filter (where (x->>'price')::numeric < p_price)
                  + 0.5 * count(*) filter (where (x->>'price')::numeric = p_price)) / count(*)) end,
             'cheaper_count', case when p_price is not null and p_price > 0 then
                 count(*) filter (where (x->>'price')::numeric < p_price) end,
             'sources', jsonb_build_object(
               'yad2',   count(*) filter (where x->>'source' = 'yad2'),
               'madlan', count(*) filter (where x->>'source' = 'madlan')),
             'price_drops', v_drops,
             'as_of', max((x->>'seen')::timestamptz))
      from jsonb_array_elements(v_stats) x
  );
end $$;

comment on function public.listing_supply_stats(text, text, text, numeric, numeric) is
  'ההיצע בלוחות יד2/מדלן לנכס: מודעות פעילות באותה עיר, סוג עסקה, סוג נכס וחדרים ±0.5; רבעוני המחיר המבוקש, אחוזון הנכס, וירידות מחיר. מתחת לסף - status too_few בלי מספרים. מחירים מבוקשים, לא עסקאות. החישוב היחיד: כל צרכן קורא לה. docs/listing-inventory.md';
revoke all on function public.listing_supply_stats(text, text, text, numeric, numeric) from public, anon, authenticated;
grant execute on function public.listing_supply_stats(text, text, text, numeric, numeric) to service_role;

create or replace function public.cma_report_finish(
  p_r     jsonb,
  p_gush  text,
  p_helka text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_r        jsonb;
  v_as_of    timestamptz;
  v_loaded   boolean;
  v_min      integer;
  v_listed   integer;
  v_subject  jsonb := null;
  v_counts   jsonb;
  v_split    jsonb := null;
  v_p_n      integer;
  v_s_n      integer;
  v_size     numeric;
  v_range    jsonb := null;
  v_of       integer;
  -- הבניין של הנכס. נכס במערכת - מהמידע התכנוני; כתובת - מעסקאות שנרשמו בה
  v_gush     text := nullif(btrim(p_gush), '');
  v_helka    text := nullif(btrim(p_helka), '');
  v_psm      numeric;  -- המחיר המבוקש למ"ר של הנכס
begin
  v_r := p_r;

  select coalesce(max(value) filter (where key = 'cma_min_comparables'), 5),
         coalesce(max(value) filter (where key = 'cma_comparables_listed'), 8)
    into v_min, v_listed
    from public.pricing_config;

  -- ---- שכבת הבעלות (20270115091000, ללא שינוי) ----
  select l.source_modified into v_as_of
    from public.land_ownership_loads l
   where l.status = 'done'
   order by l.finished_at desc
   limit 1;
  -- ‏found ולא `v_as_of is null`: טעינה מ-source_url ידני מצליחה בלי תאריך.
  v_loaded := found;

  if v_loaded then
    select jsonb_build_object('ownership', o.ownership, 'mixed_units', o.mixed_units)
      into v_subject
      from public.land_ownership o
     where o.gush  = public.land_parcel_num(v_gush)
       and o.helka = public.land_parcel_num(v_helka);

    v_r := jsonb_set(v_r, '{comparables}',              public.cma_annotate_ownership(v_r->'comparables'));
    v_r := jsonb_set(v_r, '{neighborhood_comparables}', public.cma_annotate_ownership(v_r->'neighborhood_comparables'));
    v_r := jsonb_set(v_r, '{city_comparables}',         public.cma_annotate_ownership(v_r->'city_comparables'));

    -- על מה הממוצע נשען, לפי בעלות. רק עסקאות שנספרות ב-stats (‏in_stats),
    -- וכולן - **לפני** החיתוך למטה.
    select jsonb_build_object(
             'in_stats',  count(*),
             'private',   count(*) filter (where x->>'ownership' = 'P'),
             'state',     count(*) filter (where x->>'ownership' = 'S'),
             'local',     count(*) filter (where x->>'ownership' = 'L'),
             'other',     count(*) filter (where x->>'ownership' in ('M', 'O')),
             'unknown',   count(*) filter (where x->>'ownership' is null)),
           count(*) filter (where x->>'ownership' = 'P' and x->>'price_per_sqm' is not null),
           count(*) filter (where x->>'ownership' = 'S' and x->>'price_per_sqm' is not null)
      into v_counts, v_p_n, v_s_n
      from jsonb_array_elements(v_r->'comparables') x
     where (x->>'in_stats')::boolean;

    if v_p_n >= v_min and v_s_n >= v_min then
      select jsonb_build_object(
               'private_median_price_per_sqm', round(percentile_cont(0.5) within group (
                   order by (x->>'price_per_sqm')::numeric) filter (where x->>'ownership' = 'P')::numeric),
               'state_median_price_per_sqm',   round(percentile_cont(0.5) within group (
                   order by (x->>'price_per_sqm')::numeric) filter (where x->>'ownership' = 'S')::numeric),
               'private_sample', v_p_n,
               'state_sample',   v_s_n)
        into v_split
        from jsonb_array_elements(v_r->'comparables') x
       where (x->>'in_stats')::boolean
         and x->>'price_per_sqm' is not null;
    end if;
  end if;

  -- ---- 1. טווח השוק למ"ר ----
  --
  -- רק מעל הסף, כמו כל מספר אחר בדוח: רבעונים משלוש עסקאות הם רעש
  -- שנראה כמו טווח.
  if (v_r->'data_coverage'->>'has_statistics')::boolean then
    select case when count(*) >= v_min then jsonb_build_object(
             'p25_price_per_sqm',    round(percentile_cont(0.25) within group (order by (x->>'price_per_sqm')::numeric)::numeric),
             'median_price_per_sqm', round(percentile_cont(0.5)  within group (order by (x->>'price_per_sqm')::numeric)::numeric),
             'p75_price_per_sqm',    round(percentile_cont(0.75) within group (order by (x->>'price_per_sqm')::numeric)::numeric),
             'min_price_per_sqm',    min((x->>'price_per_sqm')::numeric),
             'max_price_per_sqm',    max((x->>'price_per_sqm')::numeric)) end
      into v_range
      from jsonb_array_elements(v_r->'comparables') x
     where (x->>'in_stats')::boolean
       and x->>'price_per_sqm' is not null;

    -- והאחוזון של הנכס בתוך הטווח: כמה מהעסקאות זולות ממנו למ"ר (שוויון
    -- נספר בחצי). זה המספר שהשעון בתצוגה מראה - "יקר מ-72% מהעסקאות
    -- הדומות" - ובאותו סף כמו הרבעונים.
    v_psm := nullif((v_r->'subject'->>'price_per_sqm')::numeric, 0);
    if v_range is not null and v_psm is not null then
      select v_range || jsonb_build_object('subject_percentile', round(100.0 *
               (count(*) filter (where (x->>'price_per_sqm')::numeric < v_psm)
                + 0.5 * count(*) filter (where (x->>'price_per_sqm')::numeric = v_psm))
               / count(*)))
        into v_range
        from jsonb_array_elements(v_r->'comparables') x
       where (x->>'in_stats')::boolean
         and x->>'price_per_sqm' is not null;
    end if;

    if v_range is not null then
      v_r := jsonb_set(v_r, '{stats}', (v_r->'stats') || v_range);
    end if;
  end if;

  -- ---- 2. העסקאות להצגה: הדומות ביותר, לא כולן ----
  --
  -- **ואותו בניין קודם.** אין במאגר שנת בנייה (0 מתוך 23 אלף), ולכן עסקה
  -- באותו גוש+חלקה היא הקירוב הטוב ביותר לגיל ולרמת הבנייה של הנכס: אותו
  -- בניין, אותו גיל, אותו מפרט. היא מסומנת `same_building` ומקבלת עדיפות
  -- שקולה ל-40% פער בשטח או ל-800 מ׳ - כלומר עסקה בבניין גוברת כמעט תמיד.
  v_size := nullif((v_r->'subject'->>'size_sqm')::numeric, 0);
  v_of   := jsonb_array_length(coalesce(v_r->'comparables', '[]'::jsonb));

  v_r := jsonb_set(v_r, '{comparables}', coalesce((
    select jsonb_agg(z.x || jsonb_build_object('similarity_rank', z.rn, 'same_building', z.same_building)
                     order by z.rn)
      from (
        select t.x, b.same_building,
               coalesce((t.x->>'in_stats')::boolean, false) as in_stats,
               bool_or(coalesce((t.x->>'in_stats')::boolean, false)) over () as any_in_stats,
               row_number() over (
                 order by
                   -- מה שנספר בממוצע קודם: הטבלה מראה על מה המספר נשען
                   case when coalesce((t.x->>'in_stats')::boolean, false) then 0 else 1 end,
                   -- שטח לא ידוע (של הנכס או של העסקה) = פער בינוני, לא אפס:
                   -- עסקה בלי שטח אינה "זהה בגודל"
                   coalesce(abs((t.x->>'size_sqm')::numeric - v_size) / v_size, 0.35)
                   + 0.5 * coalesce((t.x->>'distance_meters')::numeric, 1000) / 1000.0
                   + 0.4 * coalesce((current_date - (t.x->>'sold_at')::date), 365) / 365.0
                   - case when b.same_building then 0.4 else 0 end,
                   t.ord) as rn
          from jsonb_array_elements(coalesce(v_r->'comparables', '[]'::jsonb))
               with ordinality t(x, ord)
          cross join lateral (
            -- גוש וחלקה כמספרים (land_parcel_num), כמו בשכבת הבעלות:
            -- "016720" במאגר ו-"16720" במידע התכנוני הם אותה חלקה.
            select coalesce(v_gush is not null and exists (
                     select 1 from public.market_deals_official d
                      where d.id = nullif(t.x->>'id', '')::uuid
                        and public.land_parcel_num(d.gush)  = public.land_parcel_num(v_gush)
                        and public.land_parcel_num(d.helka) = public.land_parcel_num(v_helka)), false)
                   as same_building
          ) b
      ) z
     -- כשיש עסקאות שנספרות - רק הן. השלמה בעסקאות מסוג אחר הייתה ממלאת
     -- את הטבלה בשורות "סוג אחר" שהממוצע אינו נשען עליהן.
     where z.rn <= v_listed
       and (z.in_stats or not z.any_in_stats)), '[]'::jsonb));

  v_r := jsonb_set(v_r, '{data_coverage}', (v_r->'data_coverage') || jsonb_build_object(
    'comparables_listed',    jsonb_array_length(v_r->'comparables'),
    'comparables_listed_of', v_of));

  -- ---- 3. ההיצע בלוחות (יד2 / מדלן) ----
  --
  -- מחירים **מבוקשים** של מודעות ציבוריות באותה עיר, ולכן אובייקט נפרד שאינו
  -- נוגע ב-stats, כמו market_stats. ההשתקה מתחת לסף נעשית בתוך
  -- listing_supply_stats, לא כאן ולא בתצוגה. כשל שם אינו מפיל את הדוח.
  begin
    v_r := v_r || jsonb_build_object('board_supply', public.listing_supply_stats(
      v_r->'subject'->>'city',
      v_r->'subject'->>'deal_type',
      v_r->'subject'->>'property_type',
      nullif(v_r->'subject'->>'rooms', '')::numeric,
      nullif(v_r->'subject'->>'price', '')::numeric));
  exception when others then
    v_r := v_r || jsonb_build_object('board_supply', null);
  end;

  if not v_loaded then
    -- עוד לא נטען כלום: ownership: null אומר לתצוגה לשתוק.
    return public.cma_attach_building_developer(v_r || jsonb_build_object('ownership', null));
  end if;

  return public.cma_attach_building_developer(v_r || jsonb_build_object('ownership', jsonb_build_object(
    'as_of',        v_as_of,
    'subject',      v_subject,
    'counts',       v_counts,
    'split',        v_split,
    'min_required', v_min
  )));
end;
$$;

comment on function public.cma_report_finish(jsonb, text, text) is
  'השלב האחרון של דוח ה-CMA: בעלות, רבעונים ואחוזון, חיתוך העסקאות להצגה, ההיצע בלוחות (board_supply), ואחריו חברה יזמית כשהדגל דלוק ויש התאמת כתובת. docs/cma.md';

revoke all on function public.cma_report_finish(jsonb, text, text) from public, anon, authenticated;
grant execute on function public.cma_report_finish(jsonb, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- ההיצע בלוחות לנכסים של הסוכן/ת: כרטיס הנכס וחלון "דוח לבעלים" ב-CRM
--
-- קריאה אחת לכל הרשימה (loadProperties), לא קריאה לכל כרטיס. אותו חישוב של
-- הדוח: listing_supply_stats. רק נכס שבאוויר, ורק של הסוכן/ת או של המשרד
-- שהוא/היא מנהל/ת, באותו תנאי null-safe של owner_report_create. נכס אחר
-- פשוט אינו בתשובה. **ליועץ/ת בלבד**: הדף שהבעלים רואים אינו מקבל את זה,
-- כי המערכת אינה מציעה לבעלים לדבר על מחיר (docs/owner-report.md).
-- ---------------------------------------------------------------------------
create or replace function public.properties_board_supply(p_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_agent  uuid := public.current_agent_id();
  v_agency uuid := public.current_agency_id();
  v_mgr    boolean := coalesce(public.current_member_role() = 'manager', false);
  v_out    jsonb := '{}'::jsonb;
  v_one    jsonb;
  r        record;
begin
  if v_agent is null or p_ids is null or coalesce(cardinality(p_ids), 0) = 0 then
    return v_out;
  end if;
  for r in
    select p.id, p.city, p.deal_type, p.property_type, p.rooms, p.price
      from public.properties p
     where p.id = any (p_ids[1:500])
       and p.status = 'active'
       and coalesce(p.agent_id = v_agent
                    or (v_mgr and v_agency is not null and p.agency_id = v_agency), false)
  loop
    begin
      v_one := public.listing_supply_stats(r.city, r.deal_type, r.property_type, r.rooms, r.price);
    exception when others then
      v_one := null;
    end;
    if v_one is not null then
      v_out := v_out || jsonb_build_object(r.id::text, v_one);
    end if;
  end loop;
  return v_out;
end $$;

comment on function public.properties_board_supply(uuid[]) is
  'ההיצע בלוחות יד2/מדלן לנכסים פעילים של הסוכן/ת (או של המשרד, למנהל/ת): מפה לפי מזהה נכס, מ-listing_supply_stats. לכרטיס הנכס ולחלון "דוח לבעלים" ב-CRM, ליועץ/ת בלבד. docs/listing-inventory.md';
revoke all on function public.properties_board_supply(uuid[]) from public, anon, authenticated;
grant execute on function public.properties_board_supply(uuid[]) to authenticated, service_role;
