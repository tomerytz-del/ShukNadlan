-- ============================================================================
-- דוח ה-CMA: העסקאות הדומות ביותר במקום כל מה שברדיוס, וטווח שוק למ"ר
--
-- ## מה היה
--
-- ‏`comparables` החזיר **כל** עסקה ברדיוס שנבחר - 180 בנכס רגיל בעפולה, ומעל
-- 200 בחלק מהנכסים - והדוח הדפיס את כולן בטבלה אחת. ללקוח/ה זה קיר של
-- מספרים שאיש לא קורא, והוא מסתיר את מה שכן מעניין: אילו עסקאות באמת
-- דומות לנכס הזה.
--
-- ## מה כאן
--
-- ‏`agent_cma_report_full` (העטיפה מ-20270115091000) מוסיפה שלב אחרון,
-- **אחרי** שכל המספרים כבר חושבו:
--
-- 1. **טווח שוק למ"ר** - רבעון תחתון, חציון ורבעון עליון של המחיר למ"ר, על
--    אותן עסקאות שנספרות ב-stats (‏`in_stats`). רק כשהסטטיסטיקה עצמה קיימת
--    (‏`has_statistics`), ורק כשיש די עסקאות עם שטח (‏`cma_min_comparables`) -
--    אותו כלל השתקה של כל מספר אחר בדוח. זה מה שמאפשר בתצוגה פס שמראה
--    איפה הנכס יושב בתוך השוק, ולא רק "גבוה ב-X% מהממוצע".
-- 2. **בחירת העסקאות להצגה** - הן מדורגות לפי דמיון לנכס, ונשארות
--    ‏`cma_comparables_listed` (ברירת מחדל 8). הדירוג: קודם מה שנספר
--    בממוצע (וכשיש כאלה - רק הן), ובתוכו ציון שמשקלל פער שטח, מרחק ותאריך:
--
--        פער שטח יחסי  +  0.5 × מרחק בק"מ  +  0.4 × גיל בשנים
--
--    כלומר 10% הבדל בשטח שקולים לכ-200 מ' או לכ-3 חודשים. השטח מוביל כי
--    הוא מה שקובע את המחיר הכולל, שהוא הכותרת שנשלחת ללקוח/ה.
--
-- ## ומה לא השתנה, בכוונה
--
-- ‏stats, ‏`data_coverage.comparables_found`, ספירת הבעלות והפיצול שלה -
-- כולם מחושבים **לפני** החיתוך, על כל העסקאות. החיתוך הוא החלטה של תצוגה
-- ולא של חישוב: הממוצע עדיין נשען על 180 עסקאות, והדוח אומר את זה
-- (‏`comparables_listed_of`). דוח שחותך רשימה חייב לומר שחתך - אותו כלל
-- של `city_comparables_total`.
--
-- העוזר בוואטסאפ קורא לאותה עטיפה, ולכן גם הוא מקבל עכשיו את הדומות
-- ביותר ולא את הקרובות ביותר.
-- ============================================================================

insert into public.pricing_config (key, value)
values ('cma_comparables_listed', 8)
on conflict (key) do nothing;

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
  v_gush     text;     -- הבניין של הנכס (גוש+חלקה מהמידע התכנוני)
  v_helka    text;
  v_psm      numeric;  -- המחיר המבוקש למ"ר של הנכס
begin
  v_r := public.agent_cma_report(p_agent_id, p_property_id);

  -- שגיאה (מסלול, נכס לא נמצא, שכירות) חוזרת כמו שהיא.
  if v_r ? 'error' then
    return v_r;
  end if;

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
      from public.property_planning_info i
      join public.land_ownership o
        on o.gush  = public.land_parcel_num(i.gush)
       and o.helka = public.land_parcel_num(i.helka)
     where i.property_id = p_property_id;

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
  select nullif(btrim(i.gush), ''), nullif(btrim(i.helka), '')
    into v_gush, v_helka
    from public.property_planning_info i
   where i.property_id = p_property_id;
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

  if not v_loaded then
    -- עוד לא נטען כלום: ownership: null אומר לתצוגה לשתוק.
    return v_r || jsonb_build_object('ownership', null);
  end if;

  return v_r || jsonb_build_object('ownership', jsonb_build_object(
    'as_of',        v_as_of,
    'subject',      v_subject,
    'counts',       v_counts,
    'split',        v_split,
    'min_required', v_min
  ));
end;
$$;

revoke all on function public.agent_cma_report_full(uuid, uuid) from public, anon, authenticated;
grant execute on function public.agent_cma_report_full(uuid, uuid) to service_role;

comment on function public.agent_cma_report_full(uuid, uuid) is
  'agent_cma_report ועליו: שכבת סוג הבעלות (טאבו), טווח שוק למ"ר (רבעונים, מעל הסף בלבד), ו-comparables מצומצם ל-cma_comparables_listed הדומות ביותר - אחרי שכל המספרים חושבו על כל העסקאות. docs/cma.md';
