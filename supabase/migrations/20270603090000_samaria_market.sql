-- ===========================================================================
-- שוק חדש: "אריאל והשומרון" (samaria) - לא חי
--
-- הראשון משלושת שווקי יהודה ושומרון (החלטה של 18.10.2026, docs/regional-pages.md):
-- אריאל, קרני שומרון, אורנית, אלפי מנשה, עמנואל, אלקנה, קדומים, ויישובי
-- השומרון וצפון בקעת הירדן. כ-140 אלף תושבים רשומים (20270114096000). נולד
-- **לא חי** (הסקיל new-market).
--
-- ## איך נבחרו היישובים
--
-- נפות טול כרם, שכם וג'נין כולן, ויישובי צפון הבקעה (מעל 32.08 - מחולה ועד
-- גיתית ומשואה). החלוקה גאוגרפית - סמל המועצה אינו ברישום.
--
-- **לא כאן:**
--   - עלי (נפת שכם, מטה בנימין) - בבנימין, הבא בתור, יחד עם שילה ומעלה לבונה.
--   - יישובי מרכז ודרום הבקעה (מעלה אפרים, פצאל, נעמ"ה, ייט"ב, יישובי מגילות)
--     - בבנימין.
--
-- ## כולם כבר ברישום (20270114095000) - ולכן update ולא insert
--
--   - ‏market_slug - רק אם ריק (לא דורסים החלטה של מנהל/ת).
--   - ‏slug אמיתי לשבע הרשויות, רק כשהוא עדיין זמני.
-- ===========================================================================

update public.cities c
   set market_slug = coalesce(c.market_slug, 'samaria'),
       slug        = case when v.slug is not null and c.slug = 'c-' || c.muni_code
                          then v.slug else c.slug end
  from (values
    ('3570', 'ariel'),
    ('3640', 'karnei-shomron'),
    ('3760', 'oranit'),
    ('3750', 'alfei-menashe'),
    ('3660', 'immanuel'),
    ('3560', 'elkana'),
    ('3557', 'kedumim'),
    -- נפת טול כרם
    ('3826', null), ('3727', null), ('3791', null), ('3647', null), ('3744', null), ('3793', null),
    ('3654', null), ('3768', null), ('3790', null), ('3567', null), ('3572', null), ('3712', null),
    ('3746', null), ('3892', null), ('3642', null), ('3868', null), ('3901', null), ('3910', null),
    -- נפת שכם (בלי עלי)
    ('3795', null), ('3710', null), ('3749', null), ('3579', null), ('3762', null), ('3822', null),
    ('3571', null), ('3751', null), ('3880', null), ('3906', null), ('3887', null),
    -- נפת ג'נין
    ('3643', null), ('3649', null), ('3569', null), ('3568', null), ('3717', null), ('3873', null),
    ('3711', null), ('3729', null), ('3758', null), ('3879', null), ('3894', null), ('3907', null),
    ('3908', null),
    -- צפון הבקעה
    ('3599', null), ('3578', null), ('3782', null), ('3785', null), ('3646', null), ('3619', null),
    ('3612', null), ('3609', null), ('3614', null), ('3598', null), ('3605', null), ('3613', null),
    ('3566', null)
  ) as v(muni_code, slug)
 where c.muni_code = v.muni_code;

do $$
declare
  v_in    integer;
  v_other integer;
begin
  select count(*) filter (where market_slug = 'samaria'),
         count(*) filter (where market_slug is distinct from 'samaria')
    into v_in, v_other
    from public.cities
   where muni_code in ('3570', '3640', '3760', '3750', '3660', '3560', '3557',
                       '3826', '3727', '3791', '3647', '3744', '3793', '3654', '3768', '3790', '3567',
                       '3572', '3712', '3746', '3892', '3642', '3868', '3901', '3910',
                       '3795', '3710', '3749', '3579', '3762', '3822', '3571', '3751', '3880', '3906', '3887',
                       '3643', '3649', '3569', '3568', '3717', '3873', '3711', '3729', '3758', '3879',
                       '3894', '3907', '3908',
                       '3599', '3578', '3782', '3785', '3646', '3619', '3612', '3609', '3614', '3598',
                       '3605', '3613', '3566');
  raise notice 'samaria: % יישובים בשוק', v_in;
  if v_other > 0 then
    raise warning '% יישובים משויכים לשוק אחר או חסרים ברישום - לא נדרסו. לבדוק ביד.', v_other;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- ההשלמה - כמו בכל מיגרציית שווקים.
-- ---------------------------------------------------------------------------
do $$
declare
  v integer;
  v_total integer := 0;
begin
  loop
    v := public.properties_backfill_city_id(200);
    v_total := v_total + v;
    exit when v = 0;
  end loop;
  raise notice 'properties.city_id: הושלמו % שורות', v_total;
end $$;

do $$
declare r record;
begin
  select * into r from public.agencies_backfill_city_id();
  raise notice 'agencies.city_id: % מכתובת, % מנכסים, % נותרו ריקים',
    r.from_address, r.from_properties, r.still_null;
end $$;

do $$
declare v_done integer;
begin
  update public.neighborhoods n
     set city_id = public.city_id_for_name(n.city)
   where n.city_id is null
     and public.city_id_for_name(n.city) is not null;
  get diagnostics v_done = row_count;
  raise notice 'neighborhoods.city_id: הושלמו % שורות', v_done;
end $$;

-- ---------------------------------------------------------------------------
-- רחובות: ערי השוק ייקלטו בסבב ה-gov הבא (כמו ב-20270602090000).
-- ---------------------------------------------------------------------------
update public.street_registry_syncs
   set finished_at = least(finished_at, now() - interval '5 months')
 where source = 'gov' and ok;
