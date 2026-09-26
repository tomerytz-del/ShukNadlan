-- ============================================================================
-- דוח ה-CMA: סוג הבעלות בקרקע (טאבו) - לנכס, לכל עסקה, ופיצול פרטית/מדינה
--
-- ‏`land_ownership` נטענה ב-20270115090000. כאן היא מתחברת לדוח.
--
-- ## למה עטיפה, ולא עוד בלוק בתוך agent_cma_report
--
-- ‏`agent_cma_report` היא 500 שורות של סטטיסטיקה מכוילת - סולם חדרים ורדיוס,
-- השתקה מתחת לסף, שלוש שכבות. כל גרסה שלה היא העתק מלא של הקודמת, ושינוי
-- שם נושא סיכון לכל מספר בדוח. הבעלות **אינה משנה אף מספר קיים**: היא
-- מוסיפה סימון לכל עסקה, ופיצול נפרד. לכן היא שכבה מעל התוצאה:
--
--     agent_cma_report_full(agent, property)
--       = agent_cma_report(agent, property)   -- ללא שינוי בתו
--         + ownership                          -- הנכס, as_of, הפיצול
--         + comparables[*].ownership           -- וכך גם בשכונה ובעיר
--
-- ‏`cma_report` (הדשבורד) והעוזר בוואטסאפ עוברים לקרוא לעטיפה. ‏stats, הרדיוס
-- ושכבות השוק והשכונה לא השתנו.
--
-- ## הפיצול, ולמה הוא לא נכנס לממוצע
--
-- ‏`ownership.split` הוא חציון למ"ר של עסקאות על קרקע פרטית מול קרקע מדינה,
-- מתוך אותן עסקאות שנספרות ב-stats. הוא **מושתק** כשאחת הקבוצות קטנה מ-
-- ‏`cma_min_comparables` - אותו כלל של כל חציון אחר בדוח. הממוצע עצמו לא
-- מסונן לפי בעלות: זו החלטה על שווי, והיא של השמאי/ת, לא של הדוח.
-- ============================================================================

-- גוש/חלקה ב-text (כך הם במאגר העסקאות ובמידע התכנוני) → המפתח של
-- ‏land_ownership. אותו נרמול של land_ownership_of: ספרות בלבד, עד תשע.
create or replace function public.land_parcel_num(p text)
returns integer
language sql
immutable
set search_path to ''
as $$
  select nullif(left(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 9), '')::integer;
$$;

revoke all on function public.land_parcel_num(text) from public, anon, authenticated;
grant execute on function public.land_parcel_num(text) to service_role;

-- ---------------------------------------------------------------------------
-- סימון מערך עסקאות: `ownership` לכל עסקה רשמית שהחלקה שלה במאגר
--
-- הצירוף לפי `id` מול market_deals_official: עסקאות הפלטפורמה (‏market_deals)
-- אין להן גוש/חלקה ולא יימצאו, ונשארות בלי סימון. **היעדר הסימון אינו
-- "פרטית"** - התצוגה מציגה "-".
-- ---------------------------------------------------------------------------
create or replace function public.cma_annotate_ownership(p_rows jsonb)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(jsonb_agg(
           case when o.ownership is null then t.x
                else t.x || jsonb_build_object('ownership', o.ownership,
                                               'ownership_mixed', o.mixed_units) end
           order by t.ord), '[]'::jsonb)
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) with ordinality t(x, ord)
    -- ‏uuid ולא השוואת text: כך הצירוף משתמש במפתח של market_deals_official.
    left join public.market_deals_official d
           on d.id = nullif(t.x->>'id', '')::uuid
    left join public.land_ownership o
           on o.gush  = public.land_parcel_num(d.gush)
          and o.helka = public.land_parcel_num(d.helka);
$$;

revoke all on function public.cma_annotate_ownership(jsonb) from public, anon, authenticated;
grant execute on function public.cma_annotate_ownership(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- הדוח המלא: agent_cma_report + שכבת הבעלות
-- ---------------------------------------------------------------------------
create or replace function public.agent_cma_report_full(
  p_agent_id    uuid,
  p_property_id uuid
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
  v_min      integer;
  v_subject  jsonb := null;
  v_counts   jsonb;
  v_split    jsonb := null;
  v_p_n      integer;
  v_s_n      integer;
begin
  v_r := public.agent_cma_report(p_agent_id, p_property_id);

  -- שגיאה (מסלול, נכס לא נמצא, שכירות) חוזרת כמו שהיא.
  if v_r ? 'error' then
    return v_r;
  end if;

  select l.source_modified into v_as_of
    from public.land_ownership_loads l
   where l.status = 'done'
   order by l.finished_at desc
   limit 1;

  -- עוד לא נטען כלום: הדוח כמו שהיה, ו-ownership: null אומר לתצוגה לשתוק.
  -- ‏found ולא `v_as_of is null`: טעינה מ-source_url ידני מצליחה בלי תאריך.
  if not found then
    return v_r || jsonb_build_object('ownership', null);
  end if;

  select coalesce(max(value) filter (where key = 'cma_min_comparables'), 5)
    into v_min
    from public.pricing_config;

  -- הנכס עצמו: לפי הגוש והחלקה שבמידע התכנוני שלו.
  select jsonb_build_object('ownership', o.ownership, 'mixed_units', o.mixed_units)
    into v_subject
    from public.property_planning_info i
    join public.land_ownership o
      on o.gush  = public.land_parcel_num(i.gush)
     and o.helka = public.land_parcel_num(i.helka)
   where i.property_id = p_property_id;

  v_r := jsonb_set(v_r, '{comparables}',              public.cma_annotate_ownership(v_r->'comparables'));
  v_r := jsonb_set(v_r, '{neighborhood_comparables}', public.cma_annotate_ownership(v_r->'neighborhood_comparables'));
  v_r := jsonb_set(v_r, '{city_comparables}',         public.cma_annotate_ownership(v_r->'city_comparables'));

  -- על מה הממוצע נשען, לפי בעלות. רק עסקאות שנספרות ב-stats (‏in_stats).
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

  -- הפיצול: רק כששתי הקבוצות מעל הסף. חציון מ-3 עסקאות אינו "פער של
  -- קרקע מדינה" - הוא רעש שנשמע כמו ממצא.
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

  return v_r || jsonb_build_object('ownership', jsonb_build_object(
    'as_of',       v_as_of,
    'subject',     v_subject,
    'counts',      v_counts,
    'split',       v_split,
    'min_required', v_min
  ));
end;
$$;

revoke all on function public.agent_cma_report_full(uuid, uuid) from public, anon, authenticated;
grant execute on function public.agent_cma_report_full(uuid, uuid) to service_role;

comment on function public.agent_cma_report_full(uuid, uuid) is
  'agent_cma_report ועליו שכבת סוג הבעלות (טאבו): הנכס, סימון לכל עסקה, ופיצול פרטית/מדינה. docs/land-ownership.md';

-- ---------------------------------------------------------------------------
-- הדשבורד: cma_report עוברת לדוח המלא. אותה חתימה, אותם קודי שגיאה.
-- ---------------------------------------------------------------------------
create or replace function public.cma_report(p_property_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select public.agent_cma_report_full(public.current_agent_id(), p_property_id);
$$;

revoke all on function public.cma_report(uuid) from public, anon;
grant execute on function public.cma_report(uuid) to authenticated, service_role;
