-- ===========================================================================
-- שוק חדש: "עכו ונהריה" (akko-nahariya) - לא חי
--
-- הצפון של אזור "חיפה והגליל המערבי": עכו, נהריה, שלומי, מעלות-תרשיחא,
-- כפר ורדים, ו-32 יישובי המועצה האזורית מטה אשר. כ-217 אלף תושבים רשומים
-- (20270114096000). השוק נולד **לא חי** - הכתובת מגישה "נפתחים בקרוב"
-- ב-noindex, והיא הקישור לגיוס המשרדים באזור (הסקיל new-market).
--
-- ## איך נבחרו הערים
--
-- המבחן של שוק הוא החלופות של הקונה (docs/regional-pages.md): מי שמחפש/ת
-- בנהריה בודק/ת את עכו ואת מושבי מטה אשר, לא את חיפה ולא את כרמיאל. מטה
-- אשר נכנסת **לפי המועצה** (קוד 4 בקובץ רשות האוכלוסין), ולא יישוב-יישוב:
-- כלל אחד שאפשר לבדוק, במקום 32 החלטות.
--
-- **המחיר של הכלל, ושווה לדעת אותו:** חמישה יישובים בדרום המועצה (כפר
-- מסריק, עין המפרץ, אפק, יסעור, אחיהוד) צמודים לקריות, ונקודת GPS שם נופלת
-- בתיבה של חיפה. אם יתברר שהקונים שם מחפשים בקריות - זה update נפרד.
--
-- **היישובים הערביים בנפת עכו** (ג'דיידה-מכר, כפר יאסיף, אבו סנאן, ירכא
-- ועוד) - **לא כאן**. אין בהם כיום מתווכים או מלאי מקוון, ושוק נפתח לפי
-- המשרדים שנרשמים ולא לפי המפה. הם נשארים ברישום, בלי שוק.
--
-- ## כולם כבר ברישום (20270114095000) - ולכן update ולא insert
--
--   - ‏market_slug - רק אם ריק (אותו coalesce של כל מיגרציית שווקים).
--   - ‏slug אמיתי **לחמש הערים** במקום c-<סמל>, רק כשהוא עדיין זמני.
--     ‏32 יישובי מטה אשר נשארים עם הזמני: slug נדרש רק לעיר חיה
--     (cities_live_needs_real_slug_chk), ותעתיק שאנחנו ממציאים הוא בדיוק
--     הכשל השקט ש-docs/cities-and-regions.md מזהיר ממנו.
-- ===========================================================================

update public.cities c
   set market_slug = coalesce(c.market_slug, 'akko-nahariya'),
       slug        = case when v.slug is not null and c.slug = 'c-' || c.muni_code
                          then v.slug else c.slug end
  from (values
    -- הערים
    ('7600', 'akko'),
    ('9100', 'nahariya'),
    ('812',  'shlomi'),
    ('1063', 'maalot-tarshiha'),
    ('1263', 'kfar-vradim'),
    -- מטה אשר (קוד מועצה 4)
    ('280',  null), ('282',  null), ('289',  null), ('294',  null),
    ('297',  null), ('313',  null), ('325',  null), ('376',  null),
    ('390',  null), ('409',  null), ('432',  null), ('454',  null),
    ('463',  null), ('559',  null), ('572',  null), ('574',  null),
    ('575',  null), ('576',  null), ('579',  null), ('589',  null),
    ('595',  null), ('658',  null), ('674',  null), ('708',  null),
    ('712',  null), ('785',  null), ('792',  null), ('1068', null),
    ('1143', null), ('1183', null), ('1246', null), ('1256', null)
  ) as v(muni_code, slug)
 where c.muni_code = v.muni_code;

do $$
declare
  v_in    integer;
  v_other integer;
begin
  select count(*) filter (where market_slug = 'akko-nahariya'),
         count(*) filter (where market_slug is distinct from 'akko-nahariya')
    into v_in, v_other
    from public.cities
   where muni_code in ('7600','9100','812','1063','1263',
                       '280','282','289','294','297','313','325','376','390','409',
                       '432','454','463','559','572','574','575','576','579','589',
                       '595','658','674','708','712','785','792','1068','1143','1183',
                       '1246','1256');
  raise notice 'akko-nahariya: % יישובים בשוק', v_in;
  if v_other > 0 then
    raise warning '% יישובים משויכים לשוק אחר או חסרים ברישום - לא נדרסו. לבדוק ביד.', v_other;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- ההשלמה - כמו בכל מיגרציית שווקים. היום אין אף נכס או משרד בערים האלה,
-- ולכן זו הגנה על מה שייכנס מחר.
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
-- רחובות: סבב ה-gov הבא יקלוט גם את ערי השוק החדש (אותו טריק כמו ב-
-- 20270114097000 - הסבב קורא את כל ערי השווקים, ואידמפוטנטי לקיימות).
-- ---------------------------------------------------------------------------
update public.street_registry_syncs
   set finished_at = least(finished_at, now() - interval '5 months')
 where source = 'gov' and ok;
