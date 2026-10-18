-- ===========================================================================
-- שוק חדש: "גוש עציון והר חברון" (gush-etzion) - לא חי
--
-- השלישי משלושת שווקי יהודה ושומרון (החלטה של 18.10.2026, docs/regional-pages.md):
-- אפרת, קריית ארבע, ויישובי גוש עציון, מזרח גוש עציון והר חברון. כ-67 אלף
-- תושבים רשומים (20270114096000). נולד **לא חי** (הסקיל new-market).
--
-- ## איך נבחרו היישובים
--
-- נפות בית לחם וחברון כולן (בלי ביתר עילית - כבר בירושלים, 20270602090000),
-- ושני (‏1287, נפת באר שבע): יישוב של מועצת הר חברון בתוך הקו הירוק, שהדרך
-- שלו היא למיתר ולהר חברון.
--
-- ## כולם כבר ברישום (20270114095000) - ולכן update ולא insert
--
--   - ‏market_slug - רק אם ריק (לא דורסים החלטה של מנהל/ת).
--   - ‏slug אמיתי לשתי הרשויות, רק כשהוא עדיין זמני.
-- ===========================================================================

update public.cities c
   set market_slug = coalesce(c.market_slug, 'gush-etzion'),
       slug        = case when v.slug is not null and c.slug = 'c-' || c.muni_code
                          then v.slug else c.slug end
  from (values
    ('3650', 'efrat'),
    ('3611', 'kiryat-arba'),
    -- נפת בית לחם
    ('3563', null), ('3726', null), ('3604', null), ('3725', null), ('3618', null), ('3794', null),
    ('3603', null), ('3781', null), ('3653', null), ('3602', null), ('3488', null), ('3561', null),
    ('3891', null), ('3499', null), ('3905', null), ('3865', null), ('3783', null),
    -- נפת חברון
    ('3754', null), ('3756', null), ('3766', null), ('3743', null), ('3748', null), ('3777', null),
    ('3764', null), ('3657', null), ('3724', null), ('3719', null), ('3745', null), ('3656', null),
    ('3759', null), ('3723', null), ('3784', null), ('3722', null), ('3400', null), ('3861', null),
    ('3869', null), ('3987', null), ('3899', null), ('3923', null), ('3896', null), ('3922', null),
    -- שני (הר חברון, בתוך הקו הירוק)
    ('1287', null)
  ) as v(muni_code, slug)
 where c.muni_code = v.muni_code;

do $$
declare
  v_in    integer;
  v_other integer;
begin
  select count(*) filter (where market_slug = 'gush-etzion'),
         count(*) filter (where market_slug is distinct from 'gush-etzion')
    into v_in, v_other
    from public.cities
   where muni_code in ('3650', '3611',
                       '3563', '3726', '3604', '3725', '3618', '3794', '3603', '3781', '3653', '3602',
                       '3488', '3561', '3891', '3499', '3905', '3865', '3783',
                       '3754', '3756', '3766', '3743', '3748', '3777', '3764', '3657', '3724', '3719',
                       '3745', '3656', '3759', '3723', '3784', '3722', '3400', '3861', '3869', '3987',
                       '3899', '3923', '3896', '3922',
                       '1287');
  raise notice 'gush-etzion: % יישובים בשוק', v_in;
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
-- רחובות: ערי השוק ייקלטו בסבב ה-gov הבא (כמו ב-20270604090000).
-- ---------------------------------------------------------------------------
update public.street_registry_syncs
   set finished_at = least(finished_at, now() - interval '5 months')
 where source = 'gov' and ok;
