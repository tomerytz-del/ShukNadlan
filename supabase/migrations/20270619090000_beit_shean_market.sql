-- ===========================================================================
-- שוק חדש: "בית שאן ועמק המעיינות" (beit-shean) - לא חי
--
-- 27 בתוכנית, שוק נפרד מעפולה (החלטה של 18.10.2026, docs/regional-pages.md):
-- בית שאן ו-23 יישובי עמק המעיינות, ממעלה גלבוע ומירב במערב ועד כפר רופין
-- ונווה אור על הירדן. כ-40 אלף תושבים רשומים (20270114096000). נולד **לא חי**
-- (הסקיל new-market).
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
    ('9200', 'beit-shean', 'beit-shean'),
    ('259', null, 'beit-shean'),   -- שדה נחום
    ('268', null, 'beit-shean'),   -- טירת צבי
    ('437', null, 'beit-shean'),   -- רשפים
    ('272', null, 'beit-shean'),   -- מעוז חיים
    ('295', null, 'beit-shean'),   -- כפר רופין
    ('439', null, 'beit-shean'),   -- שלוחות
    ('343', null, 'beit-shean'),   -- חמדיה
    ('296', null, 'beit-shean'),   -- נווה איתן
    ('383', null, 'beit-shean'),   -- עין הנצי"ב
    ('304', null, 'beit-shean'),   -- שדה אליהו
    ('1283', null, 'beit-shean'),   -- תל תאומים
    ('854', null, 'beit-shean'),   -- רחוב
    ('1282', null, 'beit-shean'),   -- מירב
    ('1127', null, 'beit-shean'),   -- מעלה גלבוע
    ('265', null, 'beit-shean'),   -- בית יוסף
    ('298', null, 'beit-shean'),   -- מסילות
    ('256', null, 'beit-shean'),   -- ניר דוד (תל עמל)
    ('95', null, 'beit-shean'),   -- בית אלפא
    ('90', null, 'beit-shean'),   -- חפצי-בה
    ('2026', null, 'beit-shean'),   -- ירדנה
    ('590', null, 'beit-shean'),   -- נווה אור
    ('2057', null, 'beit-shean'),   -- שדי תרומות
    ('2016', null, 'beit-shean')   -- רוויה
  ) as v(muni_code, slug, market)
 where c.muni_code = v.muni_code;

do $$
declare
  v_0 integer;
  v_other integer;
begin
  select count(*) filter (where v.m = 'beit-shean' and c.market_slug = 'beit-shean'),
         count(*) filter (where c.market_slug is distinct from v.m)
    into v_0, v_other
    from public.cities c
    join (values
      ('9200', 'beit-shean'),
      ('259', 'beit-shean'),
      ('268', 'beit-shean'),
      ('437', 'beit-shean'),
      ('272', 'beit-shean'),
      ('295', 'beit-shean'),
      ('439', 'beit-shean'),
      ('343', 'beit-shean'),
      ('296', 'beit-shean'),
      ('383', 'beit-shean'),
      ('304', 'beit-shean'),
      ('1283', 'beit-shean'),
      ('854', 'beit-shean'),
      ('1282', 'beit-shean'),
      ('1127', 'beit-shean'),
      ('265', 'beit-shean'),
      ('298', 'beit-shean'),
      ('256', 'beit-shean'),
      ('95', 'beit-shean'),
      ('90', 'beit-shean'),
      ('2026', 'beit-shean'),
      ('590', 'beit-shean'),
      ('2057', 'beit-shean'),
      ('2016', 'beit-shean')
    ) as v(muni_code, m) on v.muni_code = c.muni_code;
  raise notice 'beit-shean: %', v_0;
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
-- רחובות: ערי השוק ייקלטו בסבב ה-gov הבא (כמו ב-20270618090000).
-- ---------------------------------------------------------------------------
update public.street_registry_syncs
   set finished_at = least(finished_at, now() - interval '5 months')
 where source = 'gov' and ok;
