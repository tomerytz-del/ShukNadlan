-- ===========================================================================
-- שוק חדש: "יקנעם, רמת ישי והסביבה" (yokneam) - לא חי
--
-- 28 בתוכנית (החלטה של 18.10.2026, docs/regional-pages.md): יקנעם עילית,
-- יקנעם המושבה, רמת ישי, יישובי מועצת מגידו ויישובי עמק יזרעאל המערבי
-- שבין יקנעם, קריית טבעון ורמת ישי. כ-60 אלף תושבים רשומים
-- (20270114096000). נולד **לא חי** (הסקיל new-market).
--
-- ## כולם כבר ברישום (20270114095000) - ולכן update ולא insert
--
--   - ‏market_slug - רק אם ריק (לא דורסים החלטה של מנהל/ת).
--   - ‏slug אמיתי לרשויות, רק כשהוא עדיין זמני.
-- ===========================================================================

update public.cities c
   set market_slug = coalesce(c.market_slug, v.market),
       slug        = case when v.slug is not null and c.slug = 'c-' || c.muni_code
                          then v.slug else c.slug end
  from (values
    ('240', 'yokneam-illit', 'yokneam'),
    ('241', 'yokneam-moshava', 'yokneam'),
    ('122', 'ramat-yishai', 'yokneam'),
    ('270', null, 'yokneam'),   -- עין השופט
    ('335', null, 'yokneam'),   -- רמת השופט
    ('300', null, 'yokneam'),   -- דליה
    ('369', null, 'yokneam'),   -- גלעד (אבן יצחק)
    ('2029', null, 'yokneam'),   -- מדרך עוז
    ('586', null, 'yokneam'),   -- מגידו
    ('130', null, 'yokneam'),   -- משמר העמק
    ('367', null, 'yokneam'),   -- עין העמק
    ('445', null, 'yokneam'),   -- רמות מנשה
    ('682', null, 'yokneam'),   -- אליקים
    ('703', null, 'yokneam'),   -- גבעת עוז
    ('285', null, 'yokneam'),   -- אלונים
    ('1337', null, 'yokneam'),   -- שמשית
    ('1244', null, 'yokneam'),   -- תמרת
    ('430', null, 'yokneam'),   -- בית לחם הגלילית
    ('1182', null, 'yokneam'),   -- אלון הגליל
    ('1288', null, 'yokneam'),   -- גבעת אלה
    ('140', null, 'yokneam'),   -- כפר יהושע
    ('142', null, 'yokneam'),   -- שדה יעקב
    ('250', null, 'yokneam'),   -- הזורע
    ('677', null, 'yokneam'),   -- הסוללים
    ('353', null, 'yokneam')   -- בית זיד
  ) as v(muni_code, slug, market)
 where c.muni_code = v.muni_code;

do $$
declare
  v_0 integer;
  v_other integer;
begin
  select count(*) filter (where v.m = 'yokneam' and c.market_slug = 'yokneam'),
         count(*) filter (where c.market_slug is distinct from v.m)
    into v_0, v_other
    from public.cities c
    join (values
      ('240', 'yokneam'),
      ('241', 'yokneam'),
      ('122', 'yokneam'),
      ('270', 'yokneam'),
      ('335', 'yokneam'),
      ('300', 'yokneam'),
      ('369', 'yokneam'),
      ('2029', 'yokneam'),
      ('586', 'yokneam'),
      ('130', 'yokneam'),
      ('367', 'yokneam'),
      ('445', 'yokneam'),
      ('682', 'yokneam'),
      ('703', 'yokneam'),
      ('285', 'yokneam'),
      ('1337', 'yokneam'),
      ('1244', 'yokneam'),
      ('430', 'yokneam'),
      ('1182', 'yokneam'),
      ('1288', 'yokneam'),
      ('140', 'yokneam'),
      ('142', 'yokneam'),
      ('250', 'yokneam'),
      ('677', 'yokneam'),
      ('353', 'yokneam')
    ) as v(muni_code, m) on v.muni_code = c.muni_code;
  raise notice 'yokneam: %', v_0;
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
-- רחובות: ערי השוק ייקלטו בסבב ה-gov הבא (כמו ב-20270619090000).
-- ---------------------------------------------------------------------------
update public.street_registry_syncs
   set finished_at = least(finished_at, now() - interval '5 months')
 where source = 'gov' and ok;
