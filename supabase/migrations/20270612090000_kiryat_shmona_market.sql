-- ===========================================================================
-- שוק חדש: "קריית שמונה והגליל העליון" (kiryat-shmona) - לא חי
--
-- הראשון משלושת שווקי הגליל העליון והגולן (החלטה של 18.10.2026,
-- docs/regional-pages.md): קריית שמונה, מטולה, יסוד המעלה, ו-27 יישובי הגליל
-- העליון ועמק החולה. כ-55 אלף תושבים רשומים (20270114096000). נולד **לא חי**
-- (הסקיל new-market).
--
-- ## איך נבחרו היישובים
--
-- החלק הצפוני של נפת צפת - עמק החולה ואצבע הגליל, מיסוד המעלה ושדה אליעזר
-- בדרום ועד מטולה. **לא כאן:** צפת, ראש פינה, חצור, איילת השחר ויישובי מרום
-- הגליל - צפת והסביבה, הבא בתור; ריחאניה, ג'ש וטובא-זנגריה - אותו כלל של
-- היישובים הערביים.
--
-- ## כולם כבר ברישום (20270114095000) - ולכן update ולא insert
--
--   - ‏market_slug - רק אם ריק (לא דורסים החלטה של מנהל/ת).
--   - ‏slug אמיתי לשלוש הרשויות, רק כשהוא עדיין זמני.
-- ===========================================================================

update public.cities c
   set market_slug = coalesce(c.market_slug, v.market),
       slug        = case when v.slug is not null and c.slug = 'c-' || c.muni_code
                          then v.slug else c.slug end
  from (values
    ('2800', 'kiryat-shmona', 'kiryat-shmona'),
    ('43', 'metula', 'kiryat-shmona'),
    ('29', 'yesud-hamaala', 'kiryat-shmona'),
    ('356', null, 'kiryat-shmona'),   -- הגושרים
    ('329', null, 'kiryat-shmona'),   -- שדה נחמיה
    ('302', null, 'kiryat-shmona'),   -- דפנה
    ('357', null, 'kiryat-shmona'),   -- כפר בלום
    ('322', null, 'kiryat-shmona'),   -- בית הלל
    ('861', null, 'kiryat-shmona'),   -- שדה אליעזר
    ('366', null, 'kiryat-shmona'),   -- שמיר
    ('380', null, 'kiryat-shmona'),   -- להבות הבשן
    ('253', null, 'kiryat-shmona'),   -- חולתה
    ('303', null, 'kiryat-shmona'),   -- דן
    ('416', null, 'kiryat-shmona'),   -- מעין ברוך
    ('408', null, 'kiryat-shmona'),   -- נאות מרדכי
    ('76', null, 'kiryat-shmona'),   -- כפר גלעדי
    ('319', null, 'kiryat-shmona'),   -- עמיר
    ('453', null, 'kiryat-shmona'),   -- יפתח
    ('345', null, 'kiryat-shmona'),   -- כפר סאלד
    ('2009', null, 'kiryat-shmona'),   -- יובל
    ('1132', null, 'kiryat-shmona'),   -- שניר
    ('324', null, 'kiryat-shmona'),   -- שאר ישוב
    ('372', null, 'kiryat-shmona'),   -- רמות נפתלי
    ('596', null, 'kiryat-shmona'),   -- מלכיה
    ('852', null, 'kiryat-shmona'),   -- גונן
    ('843', null, 'kiryat-shmona'),   -- מרגליות
    ('2063', null, 'kiryat-shmona'),   -- דישון
    ('378', null, 'kiryat-shmona'),   -- משגב עם
    ('347', null, 'kiryat-shmona')   -- מנרה
  ) as v(muni_code, slug, market)
 where c.muni_code = v.muni_code;

do $$
declare
  v_0 integer;
  v_other integer;
begin
  select count(*) filter (where v.m = 'kiryat-shmona' and c.market_slug = 'kiryat-shmona'),
         count(*) filter (where c.market_slug is distinct from v.m)
    into v_0, v_other
    from public.cities c
    join (values
      ('2800', 'kiryat-shmona'),
      ('43', 'kiryat-shmona'),
      ('29', 'kiryat-shmona'),
      ('356', 'kiryat-shmona'),
      ('329', 'kiryat-shmona'),
      ('302', 'kiryat-shmona'),
      ('357', 'kiryat-shmona'),
      ('322', 'kiryat-shmona'),
      ('861', 'kiryat-shmona'),
      ('366', 'kiryat-shmona'),
      ('380', 'kiryat-shmona'),
      ('253', 'kiryat-shmona'),
      ('303', 'kiryat-shmona'),
      ('416', 'kiryat-shmona'),
      ('408', 'kiryat-shmona'),
      ('76', 'kiryat-shmona'),
      ('319', 'kiryat-shmona'),
      ('453', 'kiryat-shmona'),
      ('345', 'kiryat-shmona'),
      ('2009', 'kiryat-shmona'),
      ('1132', 'kiryat-shmona'),
      ('324', 'kiryat-shmona'),
      ('372', 'kiryat-shmona'),
      ('596', 'kiryat-shmona'),
      ('852', 'kiryat-shmona'),
      ('843', 'kiryat-shmona'),
      ('2063', 'kiryat-shmona'),
      ('378', 'kiryat-shmona'),
      ('347', 'kiryat-shmona')
    ) as v(muni_code, m) on v.muni_code = c.muni_code;
  raise notice 'kiryat-shmona: %', v_0;
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
-- רחובות: ערי השוק ייקלטו בסבב ה-gov הבא (כמו ב-20270607090000).
-- ---------------------------------------------------------------------------
update public.street_registry_syncs
   set finished_at = least(finished_at, now() - interval '5 months')
 where source = 'gov' and ok;
