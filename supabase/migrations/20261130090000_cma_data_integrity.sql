-- ============================================================================
-- דוח ה-CMA אומר את האמת על מה שיש לו
--
-- ## מה שבור היום
--
-- דוח ה-CMA נמכר כיכולת בתשלום (‏PROFESSIONAL ו-Elite, ‏`pricing.html`),
-- והוא מוצג לסוכן/ת ככותרת "תמונת השוק" עם ממוצע, חציון וממוצע למ״ר. ארבעה
-- דברים בו אינם נכונים, וכולם שקטים — הדוח נראה תקין בכל אחד מהם:
--
-- 1. **ממוצע ממדגם אחד.** ‏`cma_min_comparables` הוא 5, אבל המספר הזה שימש
--    רק כדי להחליט מתי להפסיק להרחיב את הרדיוס. גם כשנמצאה עסקה **אחת**
--    היא הוצגה כ"מחיר ממוצע", והדוח הוסיף "המחיר המבוקש גבוה ב-17% מממוצע
--    העסקאות בסביבה" — משפט שנשמע כמו ממצא ונשען על נקודה אחת.
--
-- 2. **מחיר מבוקש שמוצג כמחיר עסקה.** ‏`handle_property_sold` רשמה
--    ‏`new.price` — מחיר הפרסום — כ-`sale_price`, ו-`current_date` כ-
--    ‏`sold_at`. פער המיקוח נכנס למאגר כאילו היה מחיר סגירה, והתאריך היה
--    תאריך לחיצת הכפתור. אותה שורה מופיעה גם ברצועת המבזקים בדף הבית
--    ("נמכרה ב-₪X") ובעמוד המשרד — כלומר האי-דיוק יצא גם לגולשים.
--
-- 3. **דוח מכר על נכס להשכרה.** הכפתור הוצג לכל נכס, ו-49 מתוך 79 הנכסים
--    הפעילים הם להשכרה. ‏`market_deals` מכילה עסקאות מכר בלבד, ולכן הדוח
--    השווה שכ״ד חודשי מול ממוצע עסקאות מכר והכריז "המחיר המבוקש נמוך
--    ב-99%".
--
-- 4. **בלי גבול זמן.** לא ברדיוס ולא ב-`city_comparables`. עסקה מלפני חמש
--    שנים נכנסה לממוצע באותו משקל כמו עסקה מהחודש שעבר.
--
-- ועל כל אלה חתם משפט הפוטר "הדוח הופק אוטומטית ממאגר העסקאות של שוק
-- נדל״ן" — נכון, אבל לא אומר שזה המקור **היחיד**, ושהוא מונה עסקאות
-- שנסגרו בפלטפורמה עצמה בלבד.
--
-- ## מה נכנס
--
-- ‏`price_basis` על `market_deals` — ‏`asking` / `reported` / `official`.
-- זו העמודה שמפרידה בין "כך פורסם" ל"כך נסגר", והיא ברירת מחדל `asking`
-- בכוונה: שורה שאיש לא הצהיר עליה דבר היא מחיר מבוקש, לא מחיר עסקה.
-- ‏`official` שמור למקור רשמי (רשות המיסים) ואינו נכתב מהטריגר.
--
-- ‏`sale_closed_price` ו-`sale_closed_on` על `properties` — מה שהסוכן/ת
-- מדווח/ת בפועל ברגע סימון "נמכר". הטריגר מעדיף אותם, ונופל למחיר המבוקש
-- רק כשלא נמסרו — ואז רושם `asking` ואומר זאת.
--
-- ‏`agent_cma_report` מחזירה `data_coverage` ו-`sources`, ומפסיקה להחזיר
-- ממוצע כשהמדגם קטן מ-`cma_min_comparables`. **ההשתקה יושבת במסד ולא
-- בתצוגה**, מאותה סיבה שהגידור ל-mid/premium יושב שם: מה שלא חוזר מה-RPC
-- אי אפשר להציג בטעות, לא בדשבורד ולא בעוזר בוואטסאפ.
--
-- ## תלויות קיימות
--
-- ‏`properties`, ‏`market_deals`, ‏`property_planning_info`, ‏`pricing_config`,
-- ‏`agency_members`, ‏`current_agent_id()`, ‏`handle_property_sold()`.
--
-- הקובץ אידמפוטנטי — אפשר להריץ אותו שוב.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. ‏price_basis: מה המספר הזה בעצם
--
-- העמודה חייבת ברירת מחדל ו-not null, כי שורה בלי בסיס ידוע היא בדיוק
-- הבעיה שהיא באה לפתור. ברירת המחדל היא `asking` — ההנחה הזהירה.
-- ---------------------------------------------------------------------------
alter table public.market_deals
  add column if not exists price_basis text not null default 'asking';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'market_deals_price_basis_check') then
    alter table public.market_deals
      add constraint market_deals_price_basis_check
      check (price_basis in ('asking', 'reported', 'official'));
  end if;
end $$;

comment on column public.market_deals.price_basis is
  'מה המספר ב-sale_price: asking = המחיר המבוקש שהיה בפרסום (לא מחיר עסקה), reported = מחיר הסגירה שדיווח/ה הסוכן/ת, official = מקור רשמי (רשות המיסים). ברירת המחדל asking היא ההנחה הזהירה.';

-- השורות שכבר במאגר נוצרו מ-`new.price`, כלומר מחיר מבוקש — ו-`add column`
-- עם `default` כבר מילא להן `asking`. אין כאן `update` משלים: העמודה
-- ‏`not null`, ושורה עם `price_basis is null` אינה יכולה להתקיים.

-- הדוח מסנן לפי גיל העסקה ולפי בסיס המחיר, ושתי השאילתות סורקות את הטבלה.
create index if not exists market_deals_sold_at_idx on public.market_deals (sold_at desc);
create index if not exists market_deals_city_sold_at_idx on public.market_deals (city, sold_at desc);

-- ---------------------------------------------------------------------------
-- 2. מחיר הסגירה האמיתי, על הנכס
--
-- למה על `properties` ולא ישירות ל-`market_deals`: הסוכן/ת מדווח/ת בשעה
-- שבה הוא/היא משנה סטטוס, וזו פעולת `update` אחת על שורת הנכס. הטריגר כבר
-- רץ שם ורואה את `new` — כלומר אין מירוץ בין שתי כתיבות, ואין מסלול שבו
-- הסטטוס השתנה והמחיר לא נרשם.
-- ---------------------------------------------------------------------------
alter table public.properties
  add column if not exists sale_closed_price numeric,
  add column if not exists sale_closed_on    date;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'properties_sale_closed_price_check') then
    alter table public.properties
      add constraint properties_sale_closed_price_check
      check (sale_closed_price is null or sale_closed_price > 0);
  end if;
end $$;

-- אין כאן `check (sale_closed_on <= current_date)`: ‏Postgres דורש שפונקציה
-- בתוך CHECK תהיה IMMUTABLE, ו-`current_date` היא STABLE — האילוץ היה מפיל
-- את המיגרציה. תאריך עתידי נחסם בטופס, והטריגר ממילא רושם את מה שנמסר.

comment on column public.properties.sale_closed_price is
  'מחיר הסגירה בפועל כפי שדווח בסימון "נמכר". ריק = לא דווח, והטריגר יירשם על מחיר מבוקש (price_basis=asking).';
comment on column public.properties.sale_closed_on is
  'תאריך סגירת העסקה בפועל. ריק = לא דווח, והטריגר יירשם על תאריך סימון הסטטוס.';

-- ---------------------------------------------------------------------------
-- 3. הטריגר רושם את מה שדווח, ואומר על מה הוא נשען
--
-- שני שינויים מעבר למחיר ולתאריך:
--
-- ‏`deal_type = 'sale'` — נכס להשכרה עובר ל-`rented` ולא ל-`sold`, ולכן
-- הטריגר ממילא לא רץ עליו. הגבול כאן הוא בשביל הדרך האחת שבה זה כן קורה:
-- ייבוא CSV ממפה "נמכר" ל-`sold` בלי להסתכל על `deal_type`, ושכ״ד חודשי
-- שנכנס למאגר עסקאות המכר מרעיל כל ממוצע שמחושב ממנו.
--
-- ‏`update` לפני `insert` — שינוי סטטוס חוזר (נמכר → פעיל → נמכר) יצר
-- שורה שנייה לאותה עסקה, ושתי השורות נספרו באותו ממוצע. עכשיו דיווח חוזר
-- **מתקן** את השורה הקיימת, וזו גם הדרך לתקן מחיר שדווח שגוי.
-- ---------------------------------------------------------------------------
-- אינדקס רגיל ולא ייחודי: סביבה שכבר צברה שתי שורות לאותו נכס (שינוי
-- סטטוס חוזר) הייתה מפילה כאן את כל ה-job, וזו בדיוק התקלה השקטה שהכלל
-- על הצינור בא למנוע. הייחודיות נאכפת בטריגר, שמעדכן לפני שהוא מוסיף.
create index if not exists market_deals_related_property_idx
  on public.market_deals (related_property_id)
  where related_property_id is not null;

create or replace function public.handle_property_sold()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status = 'sold'
     and (old.status is distinct from 'sold')
     and coalesce(new.deal_type, 'sale') = 'sale' then
    update market_deals set
      sale_price  = coalesce(new.sale_closed_price, new.price),
      sold_at     = coalesce(new.sale_closed_on, current_date),
      price_basis = case when new.sale_closed_price is not null then 'reported' else 'asking' end
     where related_property_id = new.id;

    if not found then
      insert into market_deals (
        property_type, rooms, city, neighborhood_id,
        sale_price, sold_at, source, price_basis,
        related_property_id, agency_id, agent_id
      )
      values (
        new.property_type, new.rooms, new.city, new.neighborhood_id,
        coalesce(new.sale_closed_price, new.price),
        coalesce(new.sale_closed_on, current_date),
        'platform_derived',
        case when new.sale_closed_price is not null then 'reported' else 'asking' end,
        new.id, new.agency_id, new.agent_id
      );
    end if;
  end if;
  return new;
end;
$$;

comment on function public.handle_property_sold() is
  'רושם עסקה ב-market_deals כשנכס מכר עובר ל-sold. מעדיף את מחיר ותאריך הסגירה שדווחו (price_basis=reported); בלעדיהם רושם את המחיר המבוקש ומסמן asking.';

-- ---------------------------------------------------------------------------
-- 4. גיל מרבי לעסקת השוואה
--
-- ‏24 חודשים: מעבר לכך העסקה מספרת על שוק אחר, ובלי הצמדה למדד היא רק
-- מושכת את הממוצע. ניתן לכוונון מ-`pricing_config` כמו שאר פרמטרי הדוח.
-- ---------------------------------------------------------------------------
insert into public.pricing_config (key, value, description)
select 'cma_max_deal_age_months', 24, 'גיל מרבי בחודשים לעסקה שנכנסת לדוח CMA'
 where not exists (
   select 1 from public.pricing_config where key = 'cma_max_deal_age_months');

-- ---------------------------------------------------------------------------
-- 5. הדוח עצמו
--
-- ‏`data_coverage.status` הוא מה שהתצוגה נשענת עליו:
--
--   ‏`ok`          — ‎>= cma_min_comparables‎ עסקאות ברדיוס. יש סטטיסטיקה.
--   ‏`insufficient`— נמצאו עסקאות, אבל פחות מהמינימום. **אין סטטיסטיקה.**
--   ‏`none`        — לא נמצאה אף עסקה ברדיוס.
--   ‏`no_location` — לנכס אין קואורדינטות, ולכן לא רץ חישוב רדיוס בכלל.
--
-- ‏`stats` מכילה `avg_price` / `median_price` / `avg_price_per_sqm` **רק**
-- במצב `ok`. זה הלב של המיגרציה: אי אפשר להציג ממוצע שלא חזר.
-- ---------------------------------------------------------------------------
create or replace function public.agent_cma_report(
  p_agent_id    uuid,
  p_property_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_agent        record;
  v_prop         record;
  v_subject_size numeric;
  v_base_radius  numeric;
  v_min_comps    integer;
  v_max_age      integer;
  v_cutoff       date;
  v_radius       numeric;
  v_used_radius  numeric := null;
  v_comps        jsonb   := '[]'::jsonb;
  v_city_comps   jsonb   := '[]'::jsonb;
  v_n            integer := 0;
  v_stats        jsonb;
  v_planning     jsonb;
  v_coverage     text;
  v_sources      jsonb;
  v_asking_n     integer := 0;
begin
  select m.id, m.tier, m.active
    into v_agent
    from public.agency_members m
   where m.id = p_agent_id;

  if not found or not v_agent.active then
    return jsonb_build_object('error', 'no_matching_agent_profile');
  end if;

  if v_agent.tier not in ('mid', 'premium') then
    return jsonb_build_object(
      'error',  'upgrade_required',
      'detail', 'דוח CMA זמין רק למנוי Mid/Premium',
      'cta',    'שדרג למנוי Mid או Premium כדי להפיק דוחות CMA'
    );
  end if;

  -- אותה נראות שה-RLS נותן לסוכן: נכס שלו, או נכס פעיל כלשהו.
  select p.* into v_prop
    from public.properties p
   where p.id = p_property_id
     and (p.agent_id = v_agent.id or p.status = 'active');

  if not found then
    return jsonb_build_object('error', 'property_not_found');
  end if;

  -- ‏market_deals היא טבלת עסקאות מכר. השוואת שכ״ד חודשי מולה אינה "דוח
  -- עם מדגם קטן" אלא מספר חסר משמעות, ולכן היא נחסמת ולא מסויגת.
  if v_prop.deal_type = 'rent' then
    return jsonb_build_object(
      'error',  'rent_not_supported',
      'detail', 'דוח CMA מבוסס על עסקאות מכר בלבד. במאגר אין עסקאות שכירות להשוואה, ולכן לא ניתן להפיק דוח לנכס להשכרה.'
    );
  end if;

  v_subject_size := coalesce(v_prop.built_size_sqm, v_prop.size_sqm, v_prop.area_sqm);

  select coalesce(max(value) filter (where key = 'cma_default_radius_meters'), 500),
         coalesce(max(value) filter (where key = 'cma_min_comparables'), 5),
         coalesce(max(value) filter (where key = 'cma_max_deal_age_months'), 24)
    into v_base_radius, v_min_comps, v_max_age
    from public.pricing_config;

  v_cutoff := (current_date - (v_max_age || ' months')::interval)::date;

  -- הרחבת רדיוס עד שיש מספיק השוואות (או עד תקרה של פי 6).
  if v_prop.lat is not null and v_prop.lng is not null then
    foreach v_radius in array array[v_base_radius, v_base_radius*2, v_base_radius*3, v_base_radius*4, v_base_radius*6]
    loop
      select coalesce(jsonb_agg(c order by c.distance_meters), '[]'::jsonb), count(*)
        into v_comps, v_n
        from (
          select d.id,
                 d.property_type,
                 d.rooms,
                 d.sale_price,
                 d.sold_at,
                 d.source,
                 d.price_basis,
                 -- סימון ולא סינון: סוג זהה הוא ההשוואה הטובה, אבל סינון
                 -- קשיח עליו היה מרוקן את הדוח במקום לסייג אותו.
                 (d.property_type is not distinct from v_prop.property_type) as same_type,
                 round(
                   6371000 * 2 * asin(sqrt(
                     power(sin(radians(rp.lat - v_prop.lat) / 2), 2) +
                     cos(radians(v_prop.lat)) * cos(radians(rp.lat)) *
                     power(sin(radians(rp.lng - v_prop.lng) / 2), 2)
                   ))
                 ) as distance_meters,
                 coalesce(rp.built_size_sqm, rp.size_sqm, rp.area_sqm) as size_sqm,
                 case when coalesce(rp.built_size_sqm, rp.size_sqm, rp.area_sqm) > 0
                      then round(d.sale_price / coalesce(rp.built_size_sqm, rp.size_sqm, rp.area_sqm))
                 end as price_per_sqm
            from public.market_deals d
            join public.properties rp on rp.id = d.related_property_id
           where rp.lat is not null and rp.lng is not null
             and d.related_property_id <> p_property_id
             and d.sold_at >= v_cutoff
             and 6371000 * 2 * asin(sqrt(
                   power(sin(radians(rp.lat - v_prop.lat) / 2), 2) +
                   cos(radians(v_prop.lat)) * cos(radians(rp.lat)) *
                   power(sin(radians(rp.lng - v_prop.lng) / 2), 2)
                 )) <= v_radius
        ) c;

      v_used_radius := v_radius;
      exit when v_n >= v_min_comps;
    end loop;
  end if;

  -- עסקאות באותה עיר שאי אפשר למקם — מוחזרות בנפרד, לא מעורבבות ברדיוס
  -- ולא נכנסות לסטטיסטיקה.
  select coalesce(jsonb_agg(c order by c.sold_at desc), '[]'::jsonb)
    into v_city_comps
    from (
      select d.id, d.property_type, d.rooms, d.sale_price, d.sold_at, d.source, d.price_basis
        from public.market_deals d
        left join public.properties rp on rp.id = d.related_property_id
       where d.city = v_prop.city
         and d.sold_at >= v_cutoff
         and (rp.id is null or rp.lat is null or rp.lng is null)
    ) c;

  v_coverage := case
    when v_prop.lat is null or v_prop.lng is null then 'no_location'
    when v_n = 0                                  then 'none'
    when v_n < v_min_comps                        then 'insufficient'
    else 'ok'
  end;

  -- **כאן ההשתקה.** ממוצע מ-2 עסקאות אינו "ממוצע עם אזהרה" — הוא מספר
  -- שאסור לו לצאת מה-RPC, כי כל מי שיקבל אותו יציג אותו.
  if v_coverage = 'ok' then
    select jsonb_build_object(
             'comparables_count',   count(*),
             'avg_price',           round(avg((x->>'sale_price')::numeric)),
             'median_price',        round(percentile_cont(0.5) within group (order by (x->>'sale_price')::numeric)::numeric),
             'min_price',           min((x->>'sale_price')::numeric),
             'max_price',           max((x->>'sale_price')::numeric),
             'avg_price_per_sqm',   round(avg((x->>'price_per_sqm')::numeric) filter (where x->>'price_per_sqm' is not null)),
             'sqm_sample_size',     count(*) filter (where x->>'price_per_sqm' is not null),
             'same_type_count',     count(*) filter (where (x->>'same_type')::boolean),
             'asking_basis_count',  count(*) filter (where x->>'price_basis' = 'asking')
           )
      into v_stats
      from jsonb_array_elements(v_comps) x;
  else
    v_stats := jsonb_build_object('comparables_count', v_n, 'sample_too_small', true);
  end if;

  select count(*) into v_asking_n
    from jsonb_array_elements(v_comps || v_city_comps) x
   where x->>'price_basis' = 'asking';

  -- המקורות שהדוח הזה באמת נשען עליהם, מתוך השורות שהוא מציג — ולא רשימה
  -- קבועה בפוטר. מקור חדש שייכנס למאגר יופיע כאן מעצמו.
  select coalesce(jsonb_agg(jsonb_build_object(
           'source', s.source,
           'label',  case s.source
                       when 'platform_derived' then 'עסקאות שנסגרו דרך שוק נדל״ן'
                       when 'tax_authority'    then 'רשות המיסים — מאגר עסקאות מקרקעין'
                       else s.source end,
           'deals',  s.n) order by s.n desc), '[]'::jsonb)
    into v_sources
    from (
      select x->>'source' as source, count(*) as n
        from jsonb_array_elements(v_comps || v_city_comps) x
       group by 1
    ) s;

  select to_jsonb(i) - 'property_id' into v_planning
    from public.property_planning_info i where i.property_id = p_property_id;

  return jsonb_build_object(
    'generated_at', now(),
    'subject', jsonb_build_object(
      'id', v_prop.id, 'title', v_prop.title, 'address', v_prop.address,
      'city', v_prop.city, 'property_type', v_prop.property_type,
      'deal_type', v_prop.deal_type, 'price', v_prop.price, 'rooms', v_prop.rooms,
      'size_sqm', v_subject_size,
      'price_per_sqm', case when v_subject_size > 0 then round(v_prop.price / v_subject_size) end,
      'lat', v_prop.lat, 'lng', v_prop.lng
    ),
    'planning', v_planning,
    'radius_meters_used', v_used_radius,
    'radius_exhausted', (v_used_radius is not null and v_n < v_min_comps),
    'comparables', v_comps,
    'city_comparables', v_city_comps,
    'stats', v_stats,
    'data_coverage', jsonb_build_object(
      'status',             v_coverage,
      'comparables_found',  v_n,
      'min_required',       v_min_comps,
      'max_deal_age_months',v_max_age,
      'oldest_considered',  v_cutoff,
      'asking_basis_count', v_asking_n,
      'has_statistics',     (v_coverage = 'ok')
    ),
    'sources', v_sources
  );
end;
$$;

comment on function public.agent_cma_report(uuid, uuid) is
  'דוח CMA לפי מזהה סוכן/ת מפורש — הגרסה של cma_report לשרת (העוזר בוואטסאפ), שאין לו JWT. זהו מקור האמת לדוח; cma_report עוטפת אותה. סטטיסטיקה חוזרת רק כש-data_coverage.status=ok.';

revoke all on function public.agent_cma_report(uuid, uuid) from public;
revoke all on function public.agent_cma_report(uuid, uuid) from anon, authenticated;
grant execute on function public.agent_cma_report(uuid, uuid) to service_role;
