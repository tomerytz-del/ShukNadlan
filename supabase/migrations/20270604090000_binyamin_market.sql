-- ===========================================================================
-- שוק חדש: "בנימין ומודיעין עילית" (binyamin) - לא חי
--
-- השני משלושת שווקי יהודה ושומרון (החלטה של 18.10.2026, docs/regional-pages.md):
-- מודיעין עילית, בית אל, הר אדר, בית אריה, ויישובי מטה בנימין, מרכז ודרום
-- בקעת הירדן ומגילות. כ-205 אלף תושבים רשומים (20270114096000). נולד **לא
-- חי** (הסקיל new-market).
--
-- ## איך נבחרו היישובים
--
-- נפת רמאללה כולה (בלי גבעת זאב - כבר בירושלים, 20270602090000), עלי (נפת
-- שכם, מטה בנימין), ויישובי נפת יריחו שמתחת ל-32.08 - מעלה אפרים ופצאל ועד
-- מצפה שלם. צפון הבקעה (מחולה ועד גיתית) כבר בשומרון (20270603090000).
--
-- ## כולם כבר ברישום (20270114095000) - ולכן update ולא insert
--
--   - ‏market_slug - רק אם ריק (לא דורסים החלטה של מנהל/ת).
--   - ‏slug אמיתי לארבע הרשויות, רק כשהוא עדיין זמני.
-- ===========================================================================

update public.cities c
   set market_slug = coalesce(c.market_slug, 'binyamin'),
       slug        = case when v.slug is not null and c.slug = 'c-' || c.muni_code
                          then v.slug else c.slug end
  from (values
    ('3797', 'modiin-illit'),
    ('3574', 'beit-el'),
    ('3652', 'beit-aryeh'),
    ('3769', 'har-adar'),
    -- נפת רמאללה
    ('3815', null), ('3763', null), ('3641', null), ('3788', null), ('3638', null), ('3779', null),
    ('3823', null), ('3617', null), ('3564', null), ('3787', null), ('3770', null), ('3709', null),
    ('3651', null), ('3796', null), ('3655', null), ('3659', null), ('3747', null), ('3573', null),
    ('3715', null), ('3575', null), ('3644', null), ('3752', null), ('3767', null), ('3648', null),
    ('3658', null), ('3565', null), ('3824', null), ('3871', null), ('3862', null), ('3889', null),
    ('3870', null), ('3875', null), ('3872', null), ('3890', null), ('3874', null), ('3876', null),
    ('3898', null), ('3909', null), ('3902', null), ('3863', null),
    -- עלי (נפת שכם)
    ('3765', null),
    -- מרכז ודרום הבקעה ומגילות (נפת יריחו)
    ('3576', null), ('3608', null), ('3601', null), ('3864', null), ('3615', null), ('3825', null),
    ('3639', null), ('3645', null), ('3558', null), ('3556', null), ('3713', null), ('3786', null),
    ('3607', null), ('3555', null), ('3606', null), ('3610', null), ('3620', null), ('3893', null),
    ('3895', null), ('3877', null), ('3897', null), ('3757', null), ('3904', null), ('3878', null),
    ('3903', null)
  ) as v(muni_code, slug)
 where c.muni_code = v.muni_code;

do $$
declare
  v_in    integer;
  v_other integer;
begin
  select count(*) filter (where market_slug = 'binyamin'),
         count(*) filter (where market_slug is distinct from 'binyamin')
    into v_in, v_other
    from public.cities
   where muni_code in ('3797', '3574', '3652', '3769',
                       '3815', '3763', '3641', '3788', '3638', '3779', '3823', '3617', '3564', '3787',
                       '3770', '3709', '3651', '3796', '3655', '3659', '3747', '3573', '3715', '3575',
                       '3644', '3752', '3767', '3648', '3658', '3565', '3824', '3871', '3862', '3889',
                       '3870', '3875', '3872', '3890', '3874', '3876', '3898', '3909', '3902', '3863',
                       '3765',
                       '3576', '3608', '3601', '3864', '3615', '3825', '3639', '3645', '3558', '3556',
                       '3713', '3786', '3607', '3555', '3606', '3610', '3620', '3893', '3895', '3877',
                       '3897', '3757', '3904', '3878', '3903');
  raise notice 'binyamin: % יישובים בשוק', v_in;
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
-- רחובות: ערי השוק ייקלטו בסבב ה-gov הבא (כמו ב-20270603090000).
-- ---------------------------------------------------------------------------
update public.street_registry_syncs
   set finished_at = least(finished_at, now() - interval '5 months')
 where source = 'gov' and ok;
