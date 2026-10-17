-- ===========================================================================
-- שוק חדש: "פתח תקווה וראש העין" (petah-tikva) - לא חי
--
-- השישי בדרך דרומה (docs/regional-pages.md, "ההתפרסות דרומה"). פתח תקווה,
-- ראש העין, גבעת שמואל, ו-16 יישובי החצי הדרומי של דרום השרון. כ-416 אלף
-- תושבים רשומים (20270114096000). נולד **לא חי** (הסקיל new-market).
--
-- ## איך נבחרו הערים
--
-- פתח תקווה וראש העין הן שוק אחד, וגבעת שמואל צמודה לפתח תקווה ממערב.
-- **דרום השרון, החצי הדרומי** - כפי שנקבע ב-20270512090000: היישובים
-- שצמודים לפתח תקווה ולראש העין, מכפר סירקין ועד בני עטרות. החצי הצפוני
-- (גן חיים עד ירקונה) כבר בכפר סבא ורעננה.
--
-- **לא כאן:** אלעד (בני ברק ואלעד, 20270517090000), כפר קאסם וג'לג'וליה
-- (אותו כלל של הערים הערביות), ושוהם (מודיעין והסביבה).
--
-- ## כולם כבר ברישום (20270114095000) - ולכן update ולא insert
--
--   - ‏market_slug - רק אם ריק (לא דורסים החלטה של מנהל/ת).
--   - ‏slug אמיתי לשלוש הרשויות, רק כשהוא עדיין זמני.
-- ===========================================================================

update public.cities c
   set market_slug = coalesce(c.market_slug, 'petah-tikva'),
       slug        = case when v.slug is not null and c.slug = 'c-' || c.muni_code
                          then v.slug else c.slug end
  from (values
    ('7900', 'petah-tikva'),
    ('2640', 'rosh-haayin'),
    ('681', 'givat-shmuel'),
    -- דרום השרון, החצי הדרומי
    ('249', null),  -- כפר סירקין
    ('705', null),  -- נחשונים
    ('722', null),  -- מגשימים
    ('870', null),  -- גבעת השלושה
    ('871', null),  -- עינת
    ('606', null),  -- מזור
    ('449', null),  -- נחלים
    ('663', null),  -- טירת יהודה
    ('448', null),  -- בני עטרות
    ('616', null),  -- רינתיה
    ('802', null),  -- גבעת כ"ח
    ('230', null),  -- מעש
    ('450', null),  -- בארות יצחק
    ('257', null),  -- נופך
    ('128', null),  -- גת רימון
    ('2038', null)  -- ברקת
  ) as v(muni_code, slug)
 where c.muni_code = v.muni_code;

do $$
declare
  v_in    integer;
  v_other integer;
begin
  select count(*) filter (where market_slug = 'petah-tikva'),
         count(*) filter (where market_slug is distinct from 'petah-tikva')
    into v_in, v_other
    from public.cities
   where muni_code in ('7900', '2640', '681', '249', '705', '722', '870', '871', '606', '449',
                       '663', '448', '616', '802', '230', '450', '257', '128', '2038');
  raise notice 'petah-tikva: % יישובים בשוק', v_in;
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
-- רחובות: ערי השוק ייקלטו בסבב ה-gov הבא (כמו ב-20270517090000).
-- ---------------------------------------------------------------------------
update public.street_registry_syncs
   set finished_at = least(finished_at, now() - interval '5 months')
 where source = 'gov' and ok;
