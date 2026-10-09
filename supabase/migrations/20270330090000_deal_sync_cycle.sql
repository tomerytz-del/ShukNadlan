-- ===========================================================================
-- עסקאות לפי יישוב: כל ערי השווקים ברשימה, ומחזור עדכון במקום הדבקה ידנית
-- ===========================================================================
--
-- ## מה חסר אחרי 20270329090000
--
-- ‏deal_settlements נזרעה רק ביישובים שכבר היו להם עסקאות - 29 מתוך 243
-- ערים בשווקים. ‏214 ערים (חדרה, חריש, פרדס חנה-כרכור, כל שוק נתניה...)
-- לא היו ברשימה, ולכן "עדכן עסקאות" לא היה מגיע אליהן לעולם. ובנוסף,
-- ‏deal_sync_plan() החזירה בכל הרצה את כל היישובים הפעילים - אין "מתי
-- מגיע תורו של יישוב", ואין סימן שהמחזור לא רץ.
--
-- ההחלטה (9.10.2026): **סוכן הדפדפן מחליף את ההדבקה הידנית** כדרך שבה
-- עסקאות נכנסות. ההדבקה נשארת במסך כגיבוי בלבד.
--
-- ## מה נכנס
--
--   ‏1. ‏deal_settlements.city_id, ‏sync_every_days (ברירת מחדל 30 יום -
--      רשות המסים מפרסמת בקצב חודשי), ו-last_attempt_at.
--   ‏2. ‏deal_settlements_sync_cities(): כל עיר פעילה בשוק נכנסת לרשימה.
--      רצה כאן, ומטריגר על cities - עיר שמצטרפת לשוק מצטרפת גם לרשימה.
--   ‏3. ‏deal_sync_plan(p_limit) מחזירה רק יישובים **שהגיע תורם**, במנה:
--      מי שלא נוסה מעולם קודם, הגדולים קודם. ניסיון שנכשל זז לסוף התור
--      (‏last_attempt_at) במקום לחסום את ראשו.
--   ‏4. ‏upsert_deals ו-deal_sync_fail מסמנות last_attempt_at.
--   ‏5. ‏deal_settlements_public() - רק יישובים עם עסקאות: 214 דפים ריקים
--      באינדקס וב-sitemap היו "תוכן דל" בעיני גוגל.
--
-- האכיפה שהמחזור באמת רץ: הממצא deal_sync_overdue בסוכן התפעולי.
-- ‏docs/settlement-deals.md, "מחזור העדכון".
--
-- אידמפוטנטית.
-- ===========================================================================

alter table public.deal_settlements add column if not exists city_id uuid;
alter table public.deal_settlements add column if not exists sync_every_days int not null default 30;
alter table public.deal_settlements add column if not exists last_attempt_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'deal_settlements_city_id_fkey') then
    alter table public.deal_settlements
      add constraint deal_settlements_city_id_fkey
      foreign key (city_id) references public.cities(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'deal_settlements_sync_every_days_check') then
    alter table public.deal_settlements
      add constraint deal_settlements_sync_every_days_check check (sync_every_days between 1 and 365);
  end if;
end $$;

create index if not exists deal_settlements_city_id_idx on public.deal_settlements (city_id);

comment on column public.deal_settlements.sync_every_days is
  'כל כמה ימים היישוב חוזר לתור של deal_sync_plan. 30 כברירת מחדל - רשות המסים מפרסמת בקצב חודשי.';
comment on column public.deal_settlements.last_attempt_at is
  'הניסיון האחרון, מוצלח או לא. last_synced_at הוא ההצלחה האחרונה. ניסיון שנכשל מזיז את היישוב לסוף התור.';

-- ‏יישובים קיימים: ה-city_id לפי city_name_key ("נהרייה" במאגר = "נהריה").
update public.deal_settlements s
   set city_id = c.id
  from public.cities c
 where s.city_id is null
   and c.name_key = public.city_name_key(s.name);

-- ---------------------------------------------------------------------------
-- כל עיר פעילה בשוק - ברשימה
--
-- ‏slug מ-cities, חוץ מ-c-NN הזמני (198 מהערים) - שם תעתיק. התנגשות slug
-- (שתי ערים שמתעתקות זהה) מקבלת סיומת מה-id, ואינה מפילה את ההכנסה.
-- ‏SECURITY DEFINER כי היא רצה מטריגר על cities, שנכתבת גם ממנהל/ת דרך
-- RLS; ההרשאות סגורות לכולם - אין לה קורא/ת חוץ מהטריגר וממיגרציה.
-- ---------------------------------------------------------------------------
create or replace function public.deal_settlements_sync_cities()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r     record;
  v_slug text;
  v_n    int := 0;
begin
  for r in
    select c.id, c.name, c.slug
      from public.cities c
     where c.market_slug is not null
       and c.active
       and not exists (select 1 from public.deal_settlements s
                        where s.city_id = c.id
                           or public.city_name_key(s.name) = c.name_key)
     order by c.population desc nulls last
  loop
    v_slug := case when r.slug ~ '^c-[0-9]+$' or r.slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
                   then public.deal_slugify(r.name) else r.slug end;
    if v_slug is null then
      continue;
    end if;
    if exists (select 1 from public.deal_settlements where slug = v_slug) then
      v_slug := v_slug || '-' || left(replace(r.id::text, '-', ''), 6);
    end if;
    insert into public.deal_settlements (name, slug, city_id)
    values (r.name, v_slug, r.id)
    on conflict do nothing;
    if found then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;

comment on function public.deal_settlements_sync_cities() is
  'מכניסה ל-deal_settlements כל עיר פעילה בשוק שאינה שם. רצה מהטריגר על cities. מחזירה כמה נוספו.';

revoke all on function public.deal_settlements_sync_cities() from public, anon, authenticated;
grant execute on function public.deal_settlements_sync_cities() to service_role;

create or replace function public.deal_settlements_on_cities()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.deal_settlements_sync_cities();
  return null;
end $$;

revoke all on function public.deal_settlements_on_cities() from public, anon, authenticated;

drop trigger if exists cities_deal_settlements on public.cities;
create trigger cities_deal_settlements
  after insert or update of market_slug, active, name on public.cities
  for each statement execute function public.deal_settlements_on_cities();

select public.deal_settlements_sync_cities();

-- ---------------------------------------------------------------------------
-- deal_sync_plan(p_limit): רק מי שהגיע תורו
--
-- ‏drop ולא create or replace: נוסף פרמטר וטיפוס ההחזרה השתנה, וגרסה בלי
-- פרמטרים לצד גרסה עם ברירת מחדל הייתה הופכת את `rpc('deal_sync_plan')`
-- לדו-משמעית.
--
-- הסדר: מי שלא נוסה מעולם, ואז מי שהניסיון שלו הכי ישן; בתוך זה הגדולים
-- קודם. יישוב שנכשל (‏deal_sync_fail) מקבל last_attempt_at ויורד לסוף,
-- כך שתקלה אחת אינה חוסמת את המנה. ‏due_total - כמה ממתינים בסך הכול,
-- כדי שהסוכן ידע אם להמשיך למנה נוספת.
-- ---------------------------------------------------------------------------
drop function if exists public.deal_sync_plan();

create or replace function public.deal_sync_plan(p_limit int default 25)
returns table (name text, sync_from date, last_synced_at timestamptz, due_total int)
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
  with due as (
    select s.*, c.population
      from public.deal_settlements s
      left join public.cities c on c.id = s.city_id
     where s.active
       and (s.last_synced_at is null
            or s.last_synced_at < now() - make_interval(days => s.sync_every_days))
  )
  select d.name,
         coalesce(
           (select max(o.sold_at) from public.market_deals_official o where o.city = d.name) - 90,
           (current_date - make_interval(months => d.months_back))::date),
         d.last_synced_at,
         (select count(*) from due)::int
    from due d
   order by d.last_attempt_at asc nulls first, d.population desc nulls last, d.name
   limit greatest(1, least(coalesce(p_limit, 25), 500));
end $$;

comment on function public.deal_sync_plan(int) is
  'היישובים שהגיע תורם לעדכון (פעילים, ולא עודכנו sync_every_days ימים), עד p_limit, עם מאיזה תאריך למשוך ו-due_total. מנהל/ת פלטפורמה או service_role. docs/settlement-deals.md';

revoke all on function public.deal_sync_plan(int) from public, anon, authenticated;
grant execute on function public.deal_sync_plan(int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- הכתיבה והדיווח - כמו ב-20270329090000, ועכשיו מסמנות last_attempt_at
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
     set last_synced_at  = now(),
         last_attempt_at = now(),
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
     set last_attempt_at = now(),
         last_status = 'שגיאה: ' || left(coalesce(nullif(btrim(p_error), ''), 'לא ידוע'), 300)
   where name = btrim(coalesce(p_settlement, ''));
  insert into public.market_deal_import_runs (city, status, finished_at, error)
  values (btrim(coalesce(p_settlement, '')), 'failed', now(), left(p_error, 1000));
end $$;

comment on function public.deal_sync_fail(text, text) is
  'הסוכן מדווח על משיכה שנכשלה ביישוב. מנהל/ת פלטפורמה או service_role.';

revoke all on function public.deal_sync_fail(text, text) from public, anon, authenticated;
grant execute on function public.deal_sync_fail(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- מנהל/ת: הרשימה, ועכשיו גם מחזור, ניסיון אחרון, "ממתין" ואוכלוסייה
-- ---------------------------------------------------------------------------
drop function if exists public.deal_settlements_admin();

create or replace function public.deal_settlements_admin()
returns table (
  id              bigint,
  name            text,
  slug            text,
  active          boolean,
  months_back     int,
  sync_every_days int,
  last_synced_at  timestamptz,
  last_attempt_at timestamptz,
  last_status     text,
  deals_added     int,
  deals_updated   int,
  deals_total     int,
  newest          date,
  due             boolean,
  population      int
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
  select s.id, s.name, s.slug, s.active, s.months_back, s.sync_every_days,
         s.last_synced_at, s.last_attempt_at, s.last_status,
         s.deals_added, s.deals_updated,
         coalesce(d.n, 0), d.newest,
         s.active and (s.last_synced_at is null
                       or s.last_synced_at < now() - make_interval(days => s.sync_every_days)),
         c.population
    from public.deal_settlements s
    left join public.cities c on c.id = s.city_id
    left join (select o.city, count(*)::int as n, max(o.sold_at) as newest
                 from public.market_deals_official o group by o.city) d
      on d.city = s.name
   order by s.active desc, c.population desc nulls last, s.name;
end $$;

comment on function public.deal_settlements_admin() is
  'רשימת היישובים עם מספר העסקאות במאגר, מצב המשיכה, ומי ממתין לעדכון. מנהל/ת פלטפורמה בלבד.';

revoke all on function public.deal_settlements_admin() from public, anon, authenticated;
grant execute on function public.deal_settlements_admin() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- האינדקס וה-sitemap: רק יישובים עם עסקאות
-- ---------------------------------------------------------------------------
create or replace function public.deal_settlements_public()
returns table (name text, slug text, deals int, newest date, updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select s.name, s.slug, d.n, d.newest,
         coalesce(s.last_synced_at, d.last_import)
    from public.deal_settlements s
    join (select o.city, count(*)::int as n, max(o.sold_at) as newest,
                 max(o.imported_at) as last_import
            from public.market_deals_official o group by o.city) d
      on d.city = s.name
   where s.active
   order by d.n desc, s.name;
$$;

comment on function public.deal_settlements_public() is
  'היישובים הפעילים שיש להם עסקאות - לאינדקס /deals ול-sitemap. יישוב בלי עסקאות אינו נחשף, כדי לא להציף את גוגל בדפים ריקים.';

revoke all on function public.deal_settlements_public() from public, anon, authenticated;
grant execute on function public.deal_settlements_public() to anon, authenticated, service_role;
