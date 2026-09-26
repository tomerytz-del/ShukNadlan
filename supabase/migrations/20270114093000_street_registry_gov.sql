-- ===========================================================================
-- רשימת רחובות לכל עיר בשווקים - ממאגר רשות האוכלוסין ב-data.gov.il
--
-- עד היום רק לעפולה הייתה רשימה (341 רחובות משכבת ה-GIS של העירייה),
-- וטופס הנכס אוכף רחוב מרשימה סגורה **רק בעיר שיש לה רשימה**. לחיפה,
-- לקריות ולכל יישובי העמק שדה הרחוב היה טקסט חופשי. המאגר "רשימת רחובות
-- בישראל" (resource 9ad3862c-…, כ-63 אלף שורות) מכסה את כולן: חיפה 1,438,
-- קריית אתא 351, גן נר 24, אחוזת ברק 25 (נמדד על הקובץ מ-20.9.2026).
--
-- ## מה כאן
--
-- 1. ‏source = 'gov' - מקור שני, לצד 'gis'. שניהם "רשמיים" ואוכפים בטופס.
-- 2. ‏street_registry_syncs.source - כדי ששעון ארבעת החודשים של עפולה
--    (‏gis) ושל המאגר (‏gov) לא יסתירו זה את זה.
-- 3. ‏street_registry_absorb_gov - קליטה לעיר אחת.
-- 4. ‏cron לילי, 'street-registry-sync-gov', שיורה רק כשעברו ארבעה חודשים.
--
-- ## עפולה נשארת על ה-GIS, בכוונה
--
-- למאגר יש 451 שמות בעפולה מול 341 בשכבת העירייה, וחלק מההפרש הוא כתיב
-- אחר של אותו רחוב. הגיאוקוד של עפולה נשען על הכתיב של השכבה
-- (docs/street-registry.md), ולכן עיר שיש לה רשימת gis פעילה **אינה**
-- נקלטת מהמאגר - הפונקציה מדלגת עליה ורושמת למה.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. המקור
-- ---------------------------------------------------------------------------
alter table public.street_registry drop constraint if exists street_registry_source_chk;
alter table public.street_registry
  add constraint street_registry_source_chk check (source in ('gis', 'gov', 'manual', 'legacy'));

comment on column public.street_registry.source is
  'gis = משכבת העירייה · gov = ממאגר רשות האוכלוסין (data.gov.il) · manual = הוסף ידנית מהטופס · legacy = הוזרע מנכסים קיימים וטרם אושר';

-- ---------------------------------------------------------------------------
-- 2. היומן יודע מאיזה מקור הסבב
-- ---------------------------------------------------------------------------
alter table public.street_registry_syncs
  add column if not exists source text not null default 'gis';

-- השעון של עפולה סופר רק סבבי gis - סבב gov מוצלח לא ידחה את הסנכרון מהעירייה.
create or replace function public.street_registry_sync_due(
  p_city  text     default 'עפולה',
  p_every interval default interval '4 months'
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.street_registry_syncs
     where city = p_city and ok and source = 'gis' and finished_at > now() - p_every
  );
$$;

revoke all on function public.street_registry_sync_due(text, interval) from public, anon, authenticated;

-- סבב gov הוא סבב אחד לכל הערים. "הגיע הזמן" = אין סבב gov מוצלח בארבעת
-- החודשים האחרונים, באף עיר.
create or replace function public.street_registry_gov_sync_due(
  p_every interval default interval '4 months'
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.street_registry_syncs
     where ok and source = 'gov' and finished_at > now() - p_every
  );
$$;

comment on function public.street_registry_gov_sync_due(interval) is
  'האם עברו ארבעה חודשים מאז סבב gov מוצלח. תנאי הדליקה של ה-cron street-registry-sync-gov.';

revoke all on function public.street_registry_gov_sync_due(interval) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. הקליטה
--
-- כמו street_registry_absorb, בשלושה הבדלים:
--   - ‏source = 'gov'.
--   - עיר שיש לה רשימת gis פעילה - דילוג (ראו למעלה), עם שורה ביומן.
--   - אין רף מינימום: ליישוב קטן יש 8 רחובות (כפר גדעון), ולחלק אין בכלל.
--     הביטחון מפני "המאגר ענה שטויות" יושב אחד למעלה, בפונקציה - מאגר עם
--     פחות מ-40 אלף שורות, או הורדה חלקית, אינו נקלט לאף עיר.
--
-- רחוב שכבר קיים (ידני, legacy) מקבל את הכתיב של המאגר ואת source = 'gov',
-- בדיוק כמו ב-gis. ‏active לא נוגעים בו: כיבוי ידני הוא החלטה.
-- ---------------------------------------------------------------------------
create or replace function public.street_registry_absorb_gov(
  p_city  text,
  p_names text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_names       text[];
  v_inserted    integer := 0;
  v_updated     integer := 0;
  v_deactivated integer := 0;
  v_seen        integer := 0;
begin
  if exists (select 1 from public.street_registry
              where city = p_city and source = 'gis' and active) then
    insert into public.street_registry_syncs (city, ok, names_seen, source, error)
    values (p_city, true, coalesce(array_length(p_names, 1), 0), 'gov', 'skipped: city has a gis registry');
    return jsonb_build_object('city', p_city, 'skipped', 'gis');
  end if;

  select array_agg(v.n order by v.n) into v_names
    from (
      select distinct on (public.street_name_key(c.n)) c.n
        from (
          select btrim(regexp_replace(x, '\s+', ' ', 'g')) as n
            from unnest(coalesce(p_names, '{}'::text[])) as x
        ) c
       where char_length(c.n) between 2 and 80
         and c.n ~ '[א-תa-zA-Z]'
       order by public.street_name_key(c.n), c.n
    ) v;

  v_seen := coalesce(array_length(v_names, 1), 0);

  if v_seen > 0 then
    with upserted as (
      insert into public.street_registry (city, name, source, last_seen_at)
      select p_city, s, 'gov', now() from unnest(v_names) as s
      on conflict (city, name_key) do update
        set name         = excluded.name,
            source       = 'gov',
            last_seen_at = now()
      returning (xmax = 0) as is_insert
    )
    select count(*) filter (where is_insert),
           count(*) filter (where not is_insert)
      into v_inserted, v_updated
      from upserted;

    -- הזרעות שהמאגר לא אישר - רק כשיש מולן רשימה אמיתית (v_seen > 0)
    update public.street_registry
       set active = false
     where city = p_city
       and source = 'legacy'
       and last_seen_at is null
       and active = true;
    get diagnostics v_deactivated = row_count;
  end if;

  insert into public.street_registry_syncs (city, ok, names_seen, inserted, updated, deactivated, source)
  values (p_city, true, v_seen, v_inserted, v_updated, v_deactivated, 'gov');

  return jsonb_build_object(
    'city', p_city, 'names_seen', v_seen, 'inserted', v_inserted,
    'updated', v_updated, 'deactivated', v_deactivated);
end $$;

comment on function public.street_registry_absorb_gov(text, text[]) is
  'קולטת את רחובות עיר אחת ממאגר רשות האוכלוסין (source=gov). מדלגת על עיר שיש לה רשימת gis. ל-service_role בלבד.';

revoke all on function public.street_registry_absorb_gov(text, text[]) from public, anon, authenticated;
grant execute on function public.street_registry_absorb_gov(text, text[]) to service_role;

-- כישלון סבב gov נרשם עם המקור, כדי שלא ייראה כמו כישלון של עפולה.
create or replace function public.street_registry_sync_failed_source(
  p_city text, p_error text, p_source text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.street_registry_syncs (city, ok, error, source)
  values (p_city, false, left(coalesce(p_error, 'unknown'), 500), coalesce(p_source, 'gis'));
$$;

revoke all on function public.street_registry_sync_failed_source(text, text, text) from public, anon, authenticated;
grant execute on function public.street_registry_sync_failed_source(text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. התזמון
--
-- ‏4:35, עשר דקות אחרי סנכרון עפולה (4:25), ובאותה תבנית: cron יומי עם
-- תנאי, כך שהסבב הראשון רץ כבר בלילה שאחרי המיזוג, וכישלון פשוט ינוסה מחר.
-- ‏timeout 150 שניות: שלוש-ארבע הורדות של 32 אלף שורות ו-21 קליטות.
-- ---------------------------------------------------------------------------
do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/street-registry-sync';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - אין מה לתזמן';
    return;
  end if;

  perform cron.unschedule('street-registry-sync-gov')
    where exists (select 1 from cron.job where jobname = 'street-registry-sync-gov');

  perform cron.schedule('street-registry-sync-gov', '35 4 * * *', format($cron$
    select net.http_post(
      url := %L,
      body := '{"source":"gov"}'::jsonb,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1))),
      timeout_milliseconds := 150000
    )
    where public.street_registry_gov_sync_due()
  $cron$, v_url));
end $$;
