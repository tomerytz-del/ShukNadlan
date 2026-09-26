-- ===========================================================================
-- שוק חדש: "נצרת ונוף הגליל" (nazareth-nof-hagalil) - לא חי
--
-- נצרת, נוף הגליל ומגדל העמק. כ-172 אלף תושבים רשומים (20270114096000).
-- נולד **לא חי** - הכתובת מגישה "נפתחים בקרוב" ב-noindex, לגיוס המשרדים
-- (הסקיל new-market).
--
-- ## מגדל העמק כאן, ולא בעפולה והעמק
--
-- מגדל העמק צמודה לנוף הגליל (כ-5 ק"מ) ורחוקה מעפולה פי שניים, והקונה
-- שמחפש/ת בה משווה/ה לנוף הגליל. במאגר העסקאות הרשמי כבר יש לה 1,063
-- עסקאות ולנוף הגליל 592 - בלי שוק, ולכן תצוגת המנהל/ת לא ספרה אותן. מעכשיו
-- הן נספרות כאן. (העיר מנהלית בנפת עפולה, נצרת ונוף הגליל בנפת נצרת - שתיהן
-- באזור "העמקים", כך ששלושתן באותו area.)
--
-- ## נצרת נכנסת - והיישובים שסביבה לא, עדיין
--
-- נצרת נכנסת כי השוק נקרא על שמה. יפיע, ריינה, כפר כנא, עין מאהל, משהד,
-- עילוט ואכסאל צמודות לה, אבל נשארות בלי שוק: אותו כלל של עכו ושל כרמיאל -
-- עיר ערבית עצמאית נכנסת כשיש בה משרדים. שורה אחת כשזה יקרה.
--
-- ## כולן כבר ברישום (20270114095000) - ולכן update ולא insert
--
--   - ‏market_slug - רק אם ריק.
--   - ‏slug אמיתי לשלוש, רק כשהוא עדיין זמני.
--
-- התיבה ב-assets/markets.js נגזרה מפיני העסקאות, ותיבות ה-locate של עפולה
-- והעמק (שוק חי) עוקפות אותה. לגולשים שום דבר לא משתנה עד שהשוק ייפתח:
-- הזיהוי האוטומטי שולח רק לשוק חי, ועפולה עדיין הקרוב ביותר.
-- ===========================================================================

update public.cities c
   set market_slug = coalesce(c.market_slug, 'nazareth-nof-hagalil'),
       slug        = case when c.slug = 'c-' || c.muni_code then v.slug else c.slug end
  from (values
    ('7300', 'nazareth'),
    ('1061', 'nof-hagalil'),
    ('874',  'migdal-haemek')
  ) as v(muni_code, slug)
 where c.muni_code = v.muni_code;

do $$
declare
  v_in    integer;
  v_other integer;
begin
  select count(*) filter (where market_slug = 'nazareth-nof-hagalil'),
         count(*) filter (where market_slug is distinct from 'nazareth-nof-hagalil')
    into v_in, v_other
    from public.cities
   where muni_code in ('7300', '1061', '874');
  raise notice 'nazareth-nof-hagalil: % ערים בשוק', v_in;
  if v_other > 0 then
    raise warning '% ערים משויכות לשוק אחר או חסרות ברישום - לא נדרסו. לבדוק ביד.', v_other;
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
-- רחובות: סבב ה-gov הבא יקלוט גם את ערי השוק (כמו ב-20270114098000).
-- ---------------------------------------------------------------------------
update public.street_registry_syncs
   set finished_at = least(finished_at, now() - interval '5 months')
 where source = 'gov' and ok;
