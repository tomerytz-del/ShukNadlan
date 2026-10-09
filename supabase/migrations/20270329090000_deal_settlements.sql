-- ===========================================================================
-- עסקאות לפי יישוב: רשימת היישובים לסוכן, upsert_deals, ודפי /deals
-- ===========================================================================
--
-- ## מה שבור היום
--
-- ‏market_deals_official מחזיקה כ-30 אלף עסקאות רשמיות ב-29 יישובים, וכולן
-- נכנסו בהדבקה ידנית ממסך "ייבוא עסקאות רשמיות" ב-CRM. המשיכה האוטומטית
-- (‏deals_engine) מנותקת, כי nadlan.gov.il ו-GovMap חוסמים שליפה תוכניתית
-- (‏reCAPTCHA, ‏docs/market-deals-official.md "למה הצינור מנותק").
--
-- מעכשיו את המשיכה עושה סוכן דפדפן (Claude in Chrome) בדפדפן של מנהל/ת
-- הפלטפורמה, שעובר את ה-reCAPTCHA כמו אדם. מה שחסר לו:
--
--   1. רשימה **במסד** של היישובים שצריך למשוך - ‏deal_settlements.
--   2. מאיפה להמשיך בכל יישוב - ‏deal_sync_plan().
--   3. דרך לכתוב שורות גולמיות מהטבלה של GovMap - ‏upsert_deals(), שמנרמלת
--      בעצמה ובונה את אותו external_key שההדבקה בונה, ולכן עסקה שכבר
--      הודבקה אינה נכנסת פעמיים.
--
-- ושלישית, האתר מקבל דף לכל יישוב - ‏/deals/{slug} - דרך
-- ‏deal_settlement_page() ו-deal_settlements_public().
--
-- ## למה לא טבלת עסקאות חדשה
--
-- המפרט המקורי ביקש ‏real_estate_deals נפרדת עם קריאה ציבורית. שתי סיבות
-- שלא:
--
--   ‏· דוח ה-CMA (‏agent_cma_report) והדף /prices (‏city_price_table) קוראים
--     מ-market_deals_official. טבלה שנייה הייתה מפצלת את המאגר, ועסקאות
--     שהסוכן מושך לא היו מגיעות לדוח שנמכר ב-Mid/Premium.
--   ‏· עסקה בודדת נושאת גוש, חלקה ומספר בית. הטבלה סגורה ל-anon בכוונה
--     (‏docs/property-address-privacy.md), והדף הציבורי מקבל רחוב בלי מספר
--     ובלי גוש/חלקה - דרך פונקציה, לא דרך policy.
--
-- ## ההרשאות
--
-- ‏upsert_deals ו-deal_sync_plan סגורות ל-anon. הן **פתוחות ל-authenticated
-- עם גידור פנימי** ב-current_is_platform_admin() - התבנית של
-- ‏market_deals_import - כי הסוכן רץ בדפדפן שבו ה-CRM מחובר, ולא מחזיק
-- מפתח service_role. מפתח כזה בדפדפן היה עוקף את כל ה-RLS באתר.
--
-- אידמפוטנטית.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. slug מתעתיק
--
-- ‏cities.slug קיים לרוב היישובים, וממנו לוקחים קודם. התעתיק הוא רשת
-- ביטחון ליישוב שאינו ב-cities (נהרייה נכתבת שם "נהריה") או שה-slug שלו
-- זמני (‏c-53). אותו מיפוי בדיוק ב-dealSlugify ב-assets/crm.js.
-- ---------------------------------------------------------------------------
create or replace function public.deal_slugify(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    btrim(
      regexp_replace(
        translate(
          replace(replace(replace(replace(lower(btrim(coalesce(p_name, ''))),
            'ש', 'sh'), 'צ', 'tz'), 'ץ', 'tz'), 'ח', 'ch'),
          'אבגדהוזטיכךלמםנןסעפףקרת',
          'abgdhvztykklmmnnsappkrt'),
        '[^a-z0-9]+', '-', 'g'),
      '-'),
    '')
$$;

comment on function public.deal_slugify(text) is
  'תעתיק שם יישוב ל-slug. עותק זהה ב-dealSlugify ב-assets/crm.js. docs/settlement-deals.md';

revoke all on function public.deal_slugify(text) from public, anon, authenticated;
grant execute on function public.deal_slugify(text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. היישובים
-- ---------------------------------------------------------------------------
create table if not exists public.deal_settlements (
  id             bigint generated always as identity primary key,
  name           text not null unique,
  slug           text not null unique,
  active         boolean not null default true,
  months_back    int not null default 12,
  last_synced_at timestamptz,
  last_status    text,
  deals_added    int,
  deals_updated  int,
  created_at     timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'deal_settlements_months_back_check') then
    alter table public.deal_settlements
      add constraint deal_settlements_months_back_check check (months_back between 1 and 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'deal_settlements_slug_check') then
    alter table public.deal_settlements
      add constraint deal_settlements_slug_check check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
  end if;
end $$;

comment on table public.deal_settlements is
  'היישובים שסוכן הדפדפן מושך מ-GovMap. name הוא שם היישוב כפי שהוא ב-GovMap וב-market_deals_official.city; slug הוא הכתובת /deals/{slug}. docs/settlement-deals.md';
comment on column public.deal_settlements.last_status is
  'ok, ok עם מספר שורות שנדחו, או השגיאה שהסוכן דיווח ב-deal_sync_fail.';

alter table public.deal_settlements enable row level security;

-- ‏הדף הציבורי והאינדקס צריכים שם ו-slug של יישוב פעיל. יישוב כבוי אינו
-- נחשף, וגם השדות התפעוליים נקראים רק דרך deal_settlements_admin().
drop policy if exists "deal settlements public read" on public.deal_settlements;
create policy "deal settlements public read" on public.deal_settlements
  for select to anon, authenticated
  using (active);

drop policy if exists "deal settlements admin" on public.deal_settlements;
create policy "deal settlements admin" on public.deal_settlements
  for all to authenticated
  using (public.current_is_platform_admin())
  with check (public.current_is_platform_admin());

revoke all on table public.deal_settlements from public, anon, authenticated;
grant select on table public.deal_settlements to anon;
grant select, insert, update, delete on table public.deal_settlements to authenticated;
grant all on table public.deal_settlements to service_role;

-- ‏הזרע: עפולה ומגדל העמק כפי שהתבקש, ועתלית ביד כי ב-cities יש לה slug
-- זמני (‏c-53) והתעתיק נותן "atlyt".
insert into public.deal_settlements (name, slug) values
  ('עפולה', 'afula'),
  ('מגדל העמק', 'migdal-haemek'),
  ('עתלית', 'atlit')
on conflict do nothing;

-- ‏וכל יישוב שכבר יש לו עסקאות במאגר - אלה "הנתונים הקיימים", כ-30 אלף
-- עסקאות שהודבקו מ-GovMap, והם כבר בטבלה הנכונה ולא צריכים ייבוא. ‏slug
-- מ-cities לפי city_name_key (‏"נהרייה" במאגר הוא "נהריה" ב-cities),
-- ותעתיק כשאין.
insert into public.deal_settlements (name, slug)
select o.city,
       coalesce(
         (select c.slug from public.cities c
           where c.name_key = public.city_name_key(o.city)
             and c.slug !~ '^c-[0-9]+$' limit 1),
         public.deal_slugify(o.city))
  from (select distinct city from public.market_deals_official) o
 where public.deal_slugify(o.city) is not null
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. מנהל/ת: הרשימה עם ספירת העסקאות
-- ---------------------------------------------------------------------------
create or replace function public.deal_settlements_admin()
returns table (
  id             bigint,
  name           text,
  slug           text,
  active         boolean,
  months_back    int,
  last_synced_at timestamptz,
  last_status    text,
  deals_added    int,
  deals_updated  int,
  deals_total    int,
  newest         date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  return query
  select s.id, s.name, s.slug, s.active, s.months_back, s.last_synced_at,
         s.last_status, s.deals_added, s.deals_updated,
         coalesce(d.n, 0), d.newest
    from public.deal_settlements s
    left join (select o.city, count(*)::int as n, max(o.sold_at) as newest
                 from public.market_deals_official o group by o.city) d
      on d.city = s.name
   order by s.active desc, s.name;
end $$;

comment on function public.deal_settlements_admin() is
  'רשימת היישובים עם מספר העסקאות במאגר ומצב המשיכה האחרונה. מנהל/ת פלטפורמה בלבד.';

revoke all on function public.deal_settlements_admin() from public, anon, authenticated;
grant execute on function public.deal_settlements_admin() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. upsert_deals - מה שהסוכן קורא לו
--
-- ‏p_rows: מערך של אובייקטים, כל שדה כפי שהוא מופיע בטבלה של GovMap:
--   address        "הנביאים 12" | "אין מידע" | ריק
--   neighborhood   אופציונלי
--   gush, helka, tat_helka   או gush_helka אחד בצורה "17014-6-52"
--   deal_date      YYYY-MM-DD או DD.MM.YYYY
--   property_type, rooms, floor, area_sqm, price   ("-" הוא ריק)
--
-- הנרמול כאן ולא אצל הסוכן: תווי כיווניות, פסיקים, ₪, "אין מידע" ו-"-".
-- זו אותה רשימת מלכודות שהפרסר של ההדבקה כבר פגש (‏parseGovmapDeals).
--
-- ## external_key זהה להדבקה
--
--   govmap:<גוש>-<חלקה>-<תת>:<תאריך>:<מחיר>:<מ"ר>
--
-- ‏trim_scale ולא ::text ישיר: 96.0 מ-JSON היה נותן "96.0", וההדבקה כתבה
-- "96". מפתח שונה לאותה עסקה הוא בדיוק הכפילות שהמפתח נועד למנוע.
--
-- ## עדכון ולא התעלמות - אבל לא של המחיר והשטח
--
-- שורה קיימת מתעדכנת כשהסוכן מביא כתובת, שכונה, סוג, חדרים או קומה שלא
-- היו (‏GovMap משלים "אין מידע" בדיעבד). ערך ריק מהסוכן **אינו מוחק** ערך
-- קיים. מחיר ומ"ר הם חלק מהמפתח (שתי עסקאות שונות באותה תת-חלקה ובאותו
-- יום נבדלות רק בהם), ולכן שינוי בהם הוא עסקה אחרת ולא עדכון.
--
-- ‏updated_at מתעדכן רק כשמשהו השתנה בפועל - ה-where על ה-do update - כדי
-- ש"מה השתנה מאז" יישאר שאלה שאפשר לענות עליה.
--
-- ## שורה פגומה נספרת ומוחזרת, ואינה מנוחשת
--
-- הכלל של deals_engine. היא אינה מפילה את שאר השורות.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_deals(p_settlement text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- LRM, RLM, LRE..RLO, LRI..PDI
  c_bidi     constant text := chr(8206) || chr(8207) || chr(8234) || chr(8235)
                              || chr(8236) || chr(8237) || chr(8238) || chr(8294)
                              || chr(8295) || chr(8296) || chr(8297);
  v_set      public.deal_settlements%rowtype;
  v_run      uuid;
  v_row      jsonb;
  v_added    int := 0;
  v_updated  int := 0;
  v_same     int := 0;
  v_rejected jsonb := '[]'::jsonb;
  v_reason   text;
  v_addr     text;
  v_street   text;
  v_house    text;
  v_gh       text[];
  v_gush     text;
  v_helka    text;
  v_tat      text;
  v_date_t   text;
  v_sold     date;
  v_price    numeric;
  v_sqm      numeric;
  v_rooms    numeric;
  v_type     text;
  v_floor    text;
  v_hood     text;
  v_key      text;
  v_ins      boolean;
begin
  if not (public.current_is_platform_admin() or coalesce(auth.role(), '') = 'service_role') then
    return jsonb_build_object('error', 'forbidden');
  end if;

  select * into v_set from public.deal_settlements where name = btrim(coalesce(p_settlement, ''));
  if not found then
    return jsonb_build_object('error', 'unknown_settlement', 'settlement', p_settlement);
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    return jsonb_build_object('error', 'invalid_payload');
  end if;

  insert into public.market_deal_import_runs (city, status, rows_seen)
  values (v_set.name, 'running', jsonb_array_length(p_rows))
  returning id into v_run;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_reason := null;
    v_sold := null; v_price := null; v_sqm := null; v_rooms := null;

    -- ‏ערך ריק, "-" ו"אין מידע" הם null. תווי כיווניות נמחקים קודם.
    v_addr  := nullif(nullif(nullif(btrim(translate(coalesce(v_row->>'address', ''), c_bidi, '')), ''), '-'), 'אין מידע');
    v_hood  := nullif(nullif(btrim(translate(coalesce(v_row->>'neighborhood', ''), c_bidi, '')), ''), '-');
    v_type  := nullif(nullif(btrim(translate(coalesce(v_row->>'property_type', ''), c_bidi, '')), ''), '-');
    v_floor := nullif(nullif(btrim(translate(coalesce(v_row->>'floor', ''), c_bidi, '')), ''), '-');

    v_street := v_addr; v_house := null;
    if v_addr ~ '^.*?\s+[0-9]+[א-ת]?$' then
      v_street := btrim(regexp_replace(v_addr, '\s+[0-9]+[א-ת]?$', ''));
      v_house  := substring(v_addr from '([0-9]+[א-ת]?)$');
    end if;

    v_gush  := btrim(translate(coalesce(v_row->>'gush', ''), c_bidi, ''));
    v_helka := btrim(translate(coalesce(v_row->>'helka', ''), c_bidi, ''));
    v_tat   := btrim(translate(coalesce(v_row->>'tat_helka', ''), c_bidi, ''));
    if v_gush = '' and v_row ? 'gush_helka' then
      v_gh := regexp_match(btrim(translate(v_row->>'gush_helka', c_bidi, '')), '^([0-9]+)-([0-9]+)(?:-([0-9]+))?$');
      if v_gh is not null then
        v_gush := v_gh[1]; v_helka := v_gh[2]; v_tat := coalesce(v_gh[3], '');
      end if;
    end if;

    v_date_t := btrim(translate(coalesce(v_row->>'deal_date', ''), c_bidi, ''));

    begin
      v_sold := case
        when v_date_t ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then v_date_t::date
        when v_date_t ~ '^[0-9]{2}\.[0-9]{2}\.[0-9]{4}$' then to_date(v_date_t, 'DD.MM.YYYY')
        else null end;
      v_price := nullif(regexp_replace(translate(coalesce(v_row->>'price', ''), c_bidi, ''), '[,₪\s]', '', 'g'), '')::numeric;
      v_sqm   := nullif(nullif(regexp_replace(translate(coalesce(v_row->>'area_sqm', ''), c_bidi, ''), '[,\s]', '', 'g'), ''), '-')::numeric;
      v_rooms := nullif(nullif(regexp_replace(translate(coalesce(v_row->>'rooms', ''), c_bidi, ''), '\s', '', 'g'), ''), '-')::numeric;
    exception when others then
      v_reason := 'ערך מספרי או תאריך לא תקין';
    end;

    if v_reason is null then
      v_reason := case
        when v_gush !~ '^[0-9]+$' or v_helka !~ '^[0-9]+$' then 'גוש או חלקה לא תקינים'
        when v_tat <> '' and v_tat !~ '^[0-9]+$'           then 'תת-חלקה לא תקינה'
        when v_sold  is null                  then 'חסר תאריך עסקה'
        when v_sold  > current_date           then 'תאריך עסקה בעתיד'
        when v_sold  < date '1990-01-01'      then 'תאריך עסקה מוקדם מדי'
        when v_price is null or v_price <= 0  then 'מחיר לא תקין'
        when v_price < 10000                  then 'מחיר נמוך באופן חשוד'
        when v_price > 500000000              then 'מחיר גבוה באופן חשוד'
        when v_sqm is not null and v_sqm <= 0 then 'שטח לא תקין'
        when v_rooms is not null and (v_rooms < 0 or v_rooms > 50) then 'מספר חדרים לא תקין'
        else null
      end;
    end if;

    if v_reason is not null then
      v_rejected := v_rejected || jsonb_build_object(
        'row', v_row, 'reason', v_reason);
      continue;
    end if;

    v_key := 'govmap:' || v_gush || '-' || v_helka || '-' || v_tat || ':'
          || to_char(v_sold, 'YYYY-MM-DD') || ':'
          || trim_scale(v_price)::text || ':'
          || coalesce(trim_scale(v_sqm)::text, '');

    v_ins := null;
    insert into public.market_deals_official as t
      (external_key, source, city, neighborhood, street, house_number,
       gush, helka, property_type, rooms, size_sqm, floor, sale_price, sold_at, raw)
    values (
      v_key, 'tax_authority', v_set.name, v_hood, v_street, v_house,
      v_gush, v_helka, v_type, v_rooms, v_sqm, v_floor, v_price, v_sold,
      jsonb_build_object('ingest', 'browser_agent', 'portal', 'govmap',
                         'at', now(), 'tat_helka', nullif(v_tat, '')))
    on conflict (external_key) do update set
      street        = coalesce(excluded.street, t.street),
      house_number  = coalesce(excluded.house_number, t.house_number),
      neighborhood  = coalesce(excluded.neighborhood, t.neighborhood),
      property_type = coalesce(excluded.property_type, t.property_type),
      rooms         = coalesce(excluded.rooms, t.rooms),
      floor         = coalesce(excluded.floor, t.floor)
    where (t.street, t.house_number, t.neighborhood, t.property_type, t.rooms, t.floor)
          is distinct from
          (coalesce(excluded.street, t.street), coalesce(excluded.house_number, t.house_number),
           coalesce(excluded.neighborhood, t.neighborhood), coalesce(excluded.property_type, t.property_type),
           coalesce(excluded.rooms, t.rooms), coalesce(excluded.floor, t.floor))
    returning (t.xmax = 0) into v_ins;

    if v_ins is null then v_same := v_same + 1;
    elsif v_ins then v_added := v_added + 1;
    else v_updated := v_updated + 1;
    end if;
  end loop;

  update public.deal_settlements
     set last_synced_at = now(),
         last_status    = case when jsonb_array_length(v_rejected) > 0
                               then 'ok, ' || jsonb_array_length(v_rejected) || ' שורות נדחו'
                               else 'ok' end,
         deals_added    = v_added,
         deals_updated  = v_updated
   where id = v_set.id;

  update public.market_deal_import_runs
     set finished_at  = now(),
         status       = 'ok',
         rows_written = v_added + v_updated,
         rows_skipped = v_same + jsonb_array_length(v_rejected),
         error        = case when jsonb_array_length(v_rejected) > 0
                             then jsonb_array_length(v_rejected) || ' rejected (browser_agent)' end
   where id = v_run;

  return jsonb_build_object(
    'added',          v_added,
    'updated',        v_updated,
    'unchanged',      v_same,
    'rejected',       v_rejected,
    'rejected_count', jsonb_array_length(v_rejected));
end $$;

comment on function public.upsert_deals(text, jsonb) is
  'כתיבת עסקאות GovMap של יישוב אחד מסוכן הדפדפן אל market_deals_official. מנרמלת, בונה את external_key של ההדבקה, מעדכנת שדות שהיו ריקים, ומחזירה {added, updated, unchanged, rejected}. מנהל/ת פלטפורמה או service_role. docs/settlement-deals.md';

revoke all on function public.upsert_deals(text, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_deals(text, jsonb) to authenticated, service_role;

-- ‏הסוכן מדווח כאן כשהמשיכה נכשלה (‏reCAPTCHA, יישוב שלא נמצא ב-GovMap).
-- בלי זה "לא רץ" ו"רץ ונכשל" נראים אותו דבר במסך היישובים.
create or replace function public.deal_sync_fail(p_settlement text, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (public.current_is_platform_admin() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;
  update public.deal_settlements
     set last_status = 'שגיאה: ' || left(coalesce(nullif(btrim(p_error), ''), 'לא ידוע'), 300)
   where name = btrim(coalesce(p_settlement, ''));
  insert into public.market_deal_import_runs (city, status, finished_at, error)
  values (btrim(coalesce(p_settlement, '')), 'failed', now(), left(p_error, 1000));
end $$;

comment on function public.deal_sync_fail(text, text) is
  'הסוכן מדווח על משיכה שנכשלה ביישוב. מנהל/ת פלטפורמה או service_role.';

revoke all on function public.deal_sync_fail(text, text) from public, anon, authenticated;
grant execute on function public.deal_sync_fail(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. מאיפה להמשיך
--
-- 90 יום אחורה מהעסקה האחרונה ולא ממנה: רשות המסים מדווחת באיחור, ועסקה
-- מלפני חודשיים עלולה להופיע ב-GovMap רק עכשיו. החפיפה זולה - המפתח
-- הופך אותה ל-unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.deal_sync_plan()
returns table (name text, sync_from date)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.current_is_platform_admin() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  return query
  select s.name,
         coalesce(
           (select max(o.sold_at) from public.market_deals_official o where o.city = s.name) - 90,
           (current_date - make_interval(months => s.months_back))::date)
    from public.deal_settlements s
   where s.active
   order by s.last_synced_at asc nulls first, s.name;
end $$;

comment on function public.deal_sync_plan() is
  'לכל יישוב פעיל: מאיזה תאריך למשוך. 90 יום לפני העסקה האחרונה במאגר, או months_back חודשים אחורה ביישוב ריק. מנהל/ת פלטפורמה או service_role.';

revoke all on function public.deal_sync_plan() from public, anon, authenticated;
grant execute on function public.deal_sync_plan() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. הדפים הציבוריים
--
-- ‏SECURITY DEFINER כי anon אינו קורא את market_deals_official. מה שיוצא:
--
--   ‏· מגורים בלבד: בלי 'בנין', 'קרקע' ו'משק חקלאי', ובטווחים השפויים של
--     /prices (‏25-400 מ"ר, ‏200 אלף עד 15 מיליון ₪). בניגוד ל-/prices,
--     קוטג' ובית נכללים - ביישוב קטן הם רוב השוק.
--   ‏· 12 חודשים מהעסקה האחרונה ביישוב, ולא מהיום - מאותה סיבה כמו /prices.
--   ‏· חציון של קבוצת חדרים עם פחות מ-5 עסקאות מושתק (‏null).
--   ‏· העסקאות האחרונות: רחוב ושכונה, **בלי מספר בית, גוש וחלקה**
--     (‏docs/property-address-privacy.md).
-- ---------------------------------------------------------------------------
create or replace function public.deal_settlement_page(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with s as (
    select st.id, st.name, st.slug, st.last_synced_at
      from public.deal_settlements st
     where st.slug = lower(btrim(coalesce(p_slug, ''))) and st.active
  ), bounds as (
    select max(o.sold_at) as period_end, max(o.imported_at) as last_import
      from public.market_deals_official o, s
     where o.city = s.name
  ), d as (
    select o.sold_at, o.street, o.neighborhood, o.property_type, o.rooms,
           o.floor, o.size_sqm, o.sale_price,
           round(o.sale_price / o.size_sqm) as ppsqm,
           case when o.rooms < 3.5 then 3
                when o.rooms < 4.5 then 4
                when o.rooms < 5.5 then 5
                else 6 end as bucket
      from public.market_deals_official o, s, bounds b
     where o.city = s.name
       and o.sold_at > b.period_end - interval '12 months'
       and coalesce(o.property_type, 'דירה') not in ('בנין', 'קרקע', 'משק חקלאי')
       and o.size_sqm between 25 and 400
       and o.sale_price between 200000 and 15000000
  ), rooms as (
    select d.bucket, count(*)::int as n,
           round(percentile_cont(0.5) within group (order by d.sale_price)::numeric, -3) as mp,
           round(percentile_cont(0.5) within group (order by d.ppsqm)::numeric, -1) as mq
      from d
     where d.rooms is not null and d.rooms >= 1
     group by d.bucket
  )
  select case when not exists (select 1 from s) then null else jsonb_build_object(
    'name',         (select name from s),
    'slug',         (select slug from s),
    'updated_at',   coalesce((select last_synced_at from s), (select last_import from bounds)),
    'period_start', ((select period_end from bounds) - interval '12 months')::date + 1,
    'period_end',   (select period_end from bounds),
    'deals',        (select count(*) from d),
    'median_price', case when (select count(*) from d) >= 5 then
                      (select round(percentile_cont(0.5) within group (order by d.sale_price)::numeric, -3) from d) end,
    'median_ppsqm', case when (select count(*) from d) >= 5 then
                      (select round(percentile_cont(0.5) within group (order by d.ppsqm)::numeric, -1) from d) end,
    'by_rooms',     coalesce((select jsonb_agg(jsonb_build_object(
                        'rooms', r.bucket, 'deals', r.n,
                        'median_price', case when r.n >= 5 then r.mp end,
                        'median_ppsqm', case when r.n >= 5 then r.mq end)
                      order by r.bucket) from rooms r), '[]'::jsonb),
    'recent',       coalesce((select jsonb_agg(x order by x.sold_at desc) from (
                        select d.sold_at, d.street, d.neighborhood, d.property_type,
                               d.rooms, d.floor, d.size_sqm, d.sale_price, d.ppsqm
                          from d order by d.sold_at desc limit 60) x), '[]'::jsonb)
  ) end
$$;

comment on function public.deal_settlement_page(text) is
  'הנתונים של /deals/{slug}: סיכום 12 חודשים, חציון לפי חדרים (תא מתחת ל-5 מושתק) ו-60 עסקאות אחרונות בלי מספר בית, גוש וחלקה. null ליישוב לא קיים או כבוי. docs/settlement-deals.md';

revoke all on function public.deal_settlement_page(text) from public, anon, authenticated;
grant execute on function public.deal_settlement_page(text) to anon, authenticated, service_role;

create or replace function public.deal_settlements_public()
returns table (name text, slug text, deals int, newest date, updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select s.name, s.slug, coalesce(d.n, 0), d.newest,
         coalesce(s.last_synced_at, d.last_import)
    from public.deal_settlements s
    left join (select o.city, count(*)::int as n, max(o.sold_at) as newest,
                      max(o.imported_at) as last_import
                 from public.market_deals_official o group by o.city) d
      on d.city = s.name
   where s.active
   order by coalesce(d.n, 0) desc, s.name;
$$;

comment on function public.deal_settlements_public() is
  'היישובים הפעילים לאינדקס /deals ול-sitemap, עם מספר העסקאות במאגר. צבירה בלבד.';

revoke all on function public.deal_settlements_public() from public, anon, authenticated;
grant execute on function public.deal_settlements_public() to anon, authenticated, service_role;
