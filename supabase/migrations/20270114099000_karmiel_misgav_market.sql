-- ===========================================================================
-- שוק חדש: "כרמיאל ומשגב" (karmiel-misgav) - לא חי
--
-- כרמיאל ו-37 יישובי המועצה האזורית משגב (קוד 56 בקובץ רשות האוכלוסין).
-- כ-89 אלף תושבים רשומים (20270114096000). נולד **לא חי** - הכתובת
-- מגישה "נפתחים בקרוב" ב-noindex, לגיוס המשרדים (הסקיל new-market).
--
-- ## איך נבחרו הערים - אותם שני כללים של עכו ונהריה (20270114098000)
--
--  1. **המועצה היא היחידה**: כל יישובי משגב, לפי קוד המועצה ולא יישוב-
--     יישוב - כולל יישובי הבדואים שבה (סלמה, כמאנה, חוסנייה, ערב אל נעים,
--     ראס אל-עין, דמיידה, חוג'ייראת). כלל אחד שאפשר לבדוק.
--  2. **עיר ערבית עצמאית נכנסת כשיש בה משרדים**: מג'ד אל-כרום, סח'נין,
--     עראבה ודייר חנא - צמודות לכרמיאל, ו**לא כאן**. אותה הכרעה כמו
--     ג'דיידה-מכר וכפר יאסיף ליד עכו.
--
-- ## כולם כבר ברישום (20270114095000) - ולכן update ולא insert
--
--   - ‏market_slug - רק אם ריק.
--   - ‏slug אמיתי **לכרמיאל בלבד** (`karmiel`), רק כשהוא עדיין זמני. יישובי
--     משגב נשארים עם c-<סמל>: slug נדרש רק לעיר חיה, ותעתיק שממציאים הוא
--     הכשל ש-docs/cities-and-regions.md מזהיר ממנו.
--
-- התיבה ב-assets/markets.js: מסגרת שמכסה את כל משגב (לסריקת השכונות),
-- ותיבת locate שעוקפת את עכו ואת הרצועה של מעלות-תרשיחא (`boxes`).
-- ===========================================================================

update public.cities c
   set market_slug = coalesce(c.market_slug, 'karmiel-misgav'),
       slug        = case when v.slug is not null and c.slug = 'c-' || c.muni_code
                          then v.slug else c.slug end
  from (values
    ('1139', 'karmiel'),
    -- משגב (קוד מועצה 56)
    ('917',  null), ('948',  null), ('1112', null), ('1138', null),
    ('1153', null), ('1160', null), ('1163', null), ('1171', null),
    ('1172', null), ('1174', null), ('1178', null), ('1179', null),
    ('1180', null), ('1181', null), ('1185', null), ('1188', null),
    ('1201', null), ('1202', null), ('1203', null), ('1204', null),
    ('1207', null), ('1209', null), ('1221', null), ('1222', null),
    ('1226', null), ('1228', null), ('1235', null), ('1245', null),
    ('1272', null), ('1275', null), ('1276', null), ('1298', null),
    ('1317', null), ('1331', null), ('1332', null), ('1334', null),
    ('1335', null)
  ) as v(muni_code, slug)
 where c.muni_code = v.muni_code;

do $$
declare
  v_in    integer;
  v_other integer;
begin
  select count(*) filter (where market_slug = 'karmiel-misgav'),
         count(*) filter (where market_slug is distinct from 'karmiel-misgav')
    into v_in, v_other
    from public.cities
   where muni_code in ('1139',
                       '917','948','1112','1138','1153','1160','1163','1171','1172','1174',
                       '1178','1179','1180','1181','1185','1188','1201','1202','1203','1204',
                       '1207','1209','1221','1222','1226','1228','1235','1245','1272','1275',
                       '1276','1298','1317','1331','1332','1334','1335');
  raise notice 'karmiel-misgav: % יישובים בשוק', v_in;
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
-- רחובות: סבב ה-gov הבא יקלוט גם את ערי השוק (כמו ב-20270114098000).
-- ---------------------------------------------------------------------------
update public.street_registry_syncs
   set finished_at = least(finished_at, now() - interval '5 months')
 where source = 'gov' and ok;
