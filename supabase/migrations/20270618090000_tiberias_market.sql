-- ===========================================================================
-- שוק חדש: "טבריה והכנרת" (tiberias) - לא חי
--
-- 26 בתוכנית (החלטה של 18.10.2026, docs/regional-pages.md): טבריה, יבנאל,
-- ויישובי נפת כנרת - חופי הכנרת, עמק הירדן והגליל התחתון. כ-100 אלף
-- תושבים רשומים (20270114096000). נולד **לא חי** (הסקיל new-market).
--
-- **לא כאן:** מגאר, עיילבון, כפר כמא וחמאם - אותו כלל של היישובים הערביים;
-- כדורי (כפר נוער).
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
    ('6700', 'tiberias', 'tiberias'),
    ('46', 'yavneel', 'tiberias'),
    ('65', null, 'tiberias'),   -- מגדל
    ('1293', null, 'tiberias'),   -- גבעת אבני
    ('1105', null, 'tiberias'),   -- פוריה - נווה עובד
    ('1313', null, 'tiberias'),   -- פוריה עילית
    ('1104', null, 'tiberias'),   -- פוריה - כפר עבודה
    ('176', null, 'tiberias'),   -- אפיקים
    ('307', null, 'tiberias'),   -- הזורעים
    ('48', null, 'tiberias'),   -- מנחמיה
    ('199', null, 'tiberias'),   -- אשדות יעקב (איחוד)
    ('188', null, 'tiberias'),   -- אשדות יעקב (מאוחד)
    ('57', null, 'tiberias'),   -- כנרת (קבוצה)
    ('63', null, 'tiberias'),   -- כנרת (מושבה)
    ('374', null, 'tiberias'),   -- חוקוק
    ('143', null, 'tiberias'),   -- בית זרע
    ('365', null, 'tiberias'),   -- בית קשת
    ('79', null, 'tiberias'),   -- דגניה ב'
    ('62', null, 'tiberias'),   -- דגניה א'
    ('721', null, 'tiberias'),   -- שדה אילן
    ('388', null, 'tiberias'),   -- כפר קיש
    ('306', null, 'tiberias'),   -- שדמות דבורה
    ('262', null, 'tiberias'),   -- גינוסר
    ('585', null, 'tiberias'),   -- לביא
    ('701', null, 'tiberias'),   -- ארבל
    ('786', null, 'tiberias'),   -- כפר זיתים
    ('292', null, 'tiberias'),   -- שרונה
    ('273', null, 'tiberias'),   -- עין גב
    ('719', null, 'tiberias'),   -- תל קציר
    ('255', null, 'tiberias'),   -- כפר חיטים
    ('264', null, 'tiberias'),   -- שער הגולן
    ('49', null, 'tiberias'),   -- אילניה
    ('1230', null, 'tiberias'),   -- לבנים
    ('305', null, 'tiberias'),   -- גשר
    ('1253', null, 'tiberias'),   -- אמנון
    ('1258', null, 'tiberias'),   -- מסד
    ('330', null, 'tiberias'),   -- אלומות
    ('1125', null, 'tiberias'),   -- אלמגור
    ('678', null, 'tiberias'),   -- מעגן
    ('1285', null, 'tiberias'),   -- כרכום
    ('1214', null, 'tiberias'),   -- טפחות
    ('263', null, 'tiberias'),   -- מסדה
    ('1211', null, 'tiberias'),   -- קדרים
    ('1047', null, 'tiberias'),   -- חזון
    ('1229', null, 'tiberias'),   -- כלנית
    ('702', null, 'tiberias'),   -- האון
    ('58', null, 'tiberias'),   -- מצפה
    ('1225', null, 'tiberias'),   -- רביד
    ('1322', null, 'tiberias')   -- הודיות
  ) as v(muni_code, slug, market)
 where c.muni_code = v.muni_code;

do $$
declare
  v_0 integer;
  v_other integer;
begin
  select count(*) filter (where v.m = 'tiberias' and c.market_slug = 'tiberias'),
         count(*) filter (where c.market_slug is distinct from v.m)
    into v_0, v_other
    from public.cities c
    join (values
      ('6700', 'tiberias'),
      ('46', 'tiberias'),
      ('65', 'tiberias'),
      ('1293', 'tiberias'),
      ('1105', 'tiberias'),
      ('1313', 'tiberias'),
      ('1104', 'tiberias'),
      ('176', 'tiberias'),
      ('307', 'tiberias'),
      ('48', 'tiberias'),
      ('199', 'tiberias'),
      ('188', 'tiberias'),
      ('57', 'tiberias'),
      ('63', 'tiberias'),
      ('374', 'tiberias'),
      ('143', 'tiberias'),
      ('365', 'tiberias'),
      ('79', 'tiberias'),
      ('62', 'tiberias'),
      ('721', 'tiberias'),
      ('388', 'tiberias'),
      ('306', 'tiberias'),
      ('262', 'tiberias'),
      ('585', 'tiberias'),
      ('701', 'tiberias'),
      ('786', 'tiberias'),
      ('292', 'tiberias'),
      ('273', 'tiberias'),
      ('719', 'tiberias'),
      ('255', 'tiberias'),
      ('264', 'tiberias'),
      ('49', 'tiberias'),
      ('1230', 'tiberias'),
      ('305', 'tiberias'),
      ('1253', 'tiberias'),
      ('1258', 'tiberias'),
      ('330', 'tiberias'),
      ('1125', 'tiberias'),
      ('678', 'tiberias'),
      ('1285', 'tiberias'),
      ('1214', 'tiberias'),
      ('263', 'tiberias'),
      ('1211', 'tiberias'),
      ('1047', 'tiberias'),
      ('1229', 'tiberias'),
      ('702', 'tiberias'),
      ('58', 'tiberias'),
      ('1225', 'tiberias'),
      ('1322', 'tiberias')
    ) as v(muni_code, m) on v.muni_code = c.muni_code;
  raise notice 'tiberias: %', v_0;
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
-- רחובות: ערי השוק ייקלטו בסבב ה-gov הבא (כמו ב-20270614090000).
-- ---------------------------------------------------------------------------
update public.street_registry_syncs
   set finished_at = least(finished_at, now() - interval '5 months')
 where source = 'gov' and ok;
