-- ============================================================================
-- ארבעה תיקונים שנובעים מאותה שורה: כתובת שאינה כתובת
--
-- שלושה מהם הם תיקון נתונים, והרביעי הוא שורת תצורה. מה שמחבר ביניהם
-- הוא שכולם נגזרים מהכלל של `docs/street-registry.md`: **שם רחוב הוא
-- שם רחוב, ושם פרויקט או נקודת ציון אינם.** כתובת שאינה במרשם אינה
-- נכשלת ברעש — היא פשוט לא מתגאוקדת, והנכס או העסקה נעדרים מכל מפה
-- ומכל חישוב רדיוס בלי שום שגיאה.
--
--   1. הטריגר `properties_guard_duplicate` מקבל מבחין גודל, כי בלעדיו
--      תיקון (2) חסום.
--   2. מודעה #1051 עוברת מ-"יוקה פארק 1" ל-"חרוד 1".
--   3. מודעה #1066 עוברת מ-"ליד בנק הפועלים 1" ל-"היצירה 3".
--   4. ‏15 עסקאות בעפולה עוברות מ-"רובע יזרעאל" ל-"שדרות רובע יזרעאל".
--   5. רדיוס הבסיס של דוח ה-CMA יורד מ-1,000 מ' ל-750 מ'.
--
-- ============================================================================
-- 1. הטריגר: שני נכסים מסחריים באותו בניין אינם אותו נכס
-- ============================================================================
--
-- ‏`property_dedupe_key` היא `city|street|house|rooms|floor|deal_type`.
-- בדירה, `rooms` ו-`floor` הם מה שמפריד בין השכנות; ב**נכס מסחרי שניהם
-- ‏`null`** — אין חדרים ואין קומה — ולכן **כל היחידות באותו בניין
-- מתכנסות למפתח אחד**, והשנייה שתעלה לאוויר תיחסם כ"כפילות".
--
-- זה לא תרחיש תיאורטי: זו בדיוק הסיבה שתיקון (2) למטה נכשל בניסיון
-- הקודם (‏PR ‎#348). מודעה #1049 היא 500 מ"ר להשכרה בחרוד 1, ומודעה
-- ‏#1051 היא 254 מ"ר להשכרה באותו מתחם. שתיהן `rooms is null`,
-- ‏`floor is null`, ואותו `deal_type` — כלומר אותו מפתח בדיוק, ושתי
-- יחידות שונות לגמרי. הניסיון הקודם עבר rollback מלא, והכתובת נשארה
-- שגויה.
--
-- **התיקון הצר, ולמה דווקא הוא:** המבחין נוסף **בתוך שאילתת הכפילות
-- של הטריגר** ולא בחתימת `property_dedupe_key`. שינוי המפתח עצמו היה
-- גורר הפלה ובנייה מחדש של האינדקס הפונקציונלי
-- `properties_dedupe_key_active_idx`, כתיבה מחדש של ארבע פונקציות
-- תלויות (`agreements_register_exclusivity`, `check_property_availability`,
-- `claim_property_exclusivity`, `property_listing_context`), שינוי חתימה
-- של אחת מהן ושל הקורא שלה ב-`assets/crm.js`, **והוא היה מייתם כל
-- ‏`property_exclusivities.dedupe_key` שכבר שמור** — כלומר בלעדיות חיה
-- שמפסיקה להתאים לנכס שלה.
--
-- **הכלל:** כששני הצדדים בלי חדרים ובלי קומה, נדרשת גם **התאמת שטח**
-- כדי לקרוא לזה כפילות.
--
-- **והמחיר, במפורש:** אותה יחידה מסחרית שתפורסם פעמיים עם שטח שונה
-- בשולי המדידה (‏254 מול 255) **תעבור** מעכשיו. זו הקלה מכוונת בכיוון
-- המתירני, והחלופה — לחסום שתי יחידות אמיתיות באותו בניין — היא
-- הכיוון הגרוע יותר, כי מודעה תקינה שנחסמת אינה ניתנת לעקיפה בלי
-- לזייף את הכתובת. בנכס עם חדרים או עם קומה שום דבר לא משתנה.
-- ============================================================================

-- **ותיקון אגב, בשורה אחת:** הודעת הכפילות נשאה מקף ארוך כברירת מחדל
-- ל-`listing_number` ריק. זו הודעה שסוכן/ת רואה על המסך, כלומר טקסט
-- מוצג, והכלל ב-CLAUDE.md חל עליה. ‏`scripts/check_long_dash.py` אינו
-- סורק קובצי SQL ולכן לא תפס אותה, וזו בדיוק הסיבה שהיא שרדה.

create or replace function public.properties_guard_duplicate()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_key        text;
  v_owner_key  text;
  v_holder     record;
  v_other      record;
begin
  v_key := public.property_dedupe_key(
    new.city, new.street, new.house_number, new.rooms, new.floor, new.deal_type);

  /* כתובת שהשתנתה על נכס שיש עליו בלעדיות חיה — הבלעדיות נוסעת איתו.
     בלעדיה היא הייתה נשארת תלויה על מפתח שלא קיים עוד, והנכס היה נחסם
     מול הבלעדיות של עצמו. */
  if tg_op = 'UPDATE' and v_key is not null then
    update public.property_exclusivities
       set dedupe_key = v_key
     where property_id = new.id
       and released_at is null
       and dedupe_key is distinct from v_key;
  end if;

  if new.status <> 'active' then
    return new;
  end if;

  -- מודעה שכבר הייתה באוויר על אותה זהות ואותו משרד: אין מה לבדוק מחדש
  if tg_op = 'UPDATE'
     and old.status = 'active'
     and old.agency_id = new.agency_id
     and public.property_dedupe_key(
           old.city, old.street, old.house_number, old.rooms, old.floor, old.deal_type)
         is not distinct from v_key then
    return new;
  end if;

  if v_key is null then
    return new;   -- אי אפשר לזהות את הנכס, ולכן אי אפשר לקבוע שהוא כפול
  end if;

  select e.agency_id,
         coalesce(m.display_name, 'מתווך/ת') as agent_name,
         coalesce(a.name, 'משרד אחר')        as agency_name
    into v_holder
    from public.property_exclusivities e
    join public.agency_members m on m.id = e.agent_id
    left join public.agencies   a on a.id = e.agency_id
   where e.dedupe_key = v_key
     and e.released_at is null
     and e.ends_on >= current_date
   limit 1;

  if found then
    if v_holder.agency_id = new.agency_id then
      return new;   -- הבלעדיות שלנו
    end if;
    /* בלי תאריך סיום, בכוונה — ראו ההערה בראש הקובץ. */
    raise exception 'הנכס נמצא בבלעדיות של % ממשרד %, ולכן אי אפשר לפרסם אותו.',
      v_holder.agent_name, v_holder.agency_name
      using hint = 'exclusive_elsewhere', errcode = 'P0001';
  end if;

  select public.property_owner_key(o.owner_phone) into v_owner_key
    from public.property_owners o
   where o.property_id = new.id;

  select p.listing_number,
         coalesce(m.display_name, 'מתווך/ת') as agent_name,
         coalesce(a.name, 'משרד אחר')        as agency_name,
         (p.agency_id = new.agency_id)       as same_agency
    into v_other
    from public.properties p
    join public.agency_members m on m.id = p.agent_id
    left join public.agencies   a on a.id = p.agency_id
    left join lateral (
      select public.property_owner_key(po.owner_phone) as owner_key
        from public.property_owners po where po.property_id = p.id
    ) o on true
   where p.status = 'active'
     and p.id <> new.id
     and public.property_dedupe_key(
           p.city, p.street, p.house_number, p.rooms, p.floor, p.deal_type) = v_key
     -- אותם בעלים, או שלאחד הצדדים אין בעלים רשומים ואי אפשר להפריד
     and (v_owner_key is null or o.owner_key is null or o.owner_key = v_owner_key)
     /* מבחין הגודל — ראו ההערה הארוכה בראש הקובץ. הוא נדרש **רק** כששני
        הצדדים בלי חדרים ובלי קומה, כלומר כשהמפתח לבדו אינו מפריד בין
        שתי יחידות מסחריות באותו בניין. בדירה התנאי מתקיים מיד ואינו
        משנה דבר. */
     and (new.rooms is not null
          or new.floor is not null
          or p.size_sqm is not distinct from new.size_sqm)
   order by p.created_at
   limit 1;

  if found then
    if v_other.same_agency then
      raise exception 'הנכס כבר מפורסם במשרד שלכם על ידי % (מודעה #%). אין צורך במודעה שנייה.',
        v_other.agent_name, coalesce(v_other.listing_number::text, '-')
        using hint = 'duplicate_same_agency', errcode = 'P0001';
    end if;
    raise exception 'הנכס כבר מפורסם במערכת על ידי % ממשרד %. אפשר לפרסם אותו רק על סמך הסכם בלעדיות חתום.',
      v_other.agent_name, v_other.agency_name
      using hint = 'duplicate_elsewhere', errcode = 'P0001';
  end if;

  return new;
end;
$function$;

-- ============================================================================
-- 2. מודעה #1051: "יוקה פארק 1" → "חרוד 1"
--
-- ‏"יוקה פארק" הוא שם הפרויקט ולא שם הרחוב, ולכן הוא נשאר בכותרת
-- ובתיאור ויורד מהכתובת. זה בדיוק הניסוח של המודעה השכנה #1049
-- ("תעשייה, יוקה פארק חרוד 1"), והיא זו שמראה שהמבנה הזה כבר עובד.
--
-- התיאור כבר נושא את שם הפרויקט ("להשכרה ביוקה פארק עפולה"), ולכן
-- אין כאן שום מידע שהולך לאיבוד.
--
-- ‏`lat`/`lng` הם `null` היום, ולכן התור יאסוף את המודעה מעצמו —
-- ‏`חרוד` הוא רחוב `gis` במרשם, והשכנות שלה בחרוד 1 כבר נושאות פין.
-- ============================================================================

update public.properties
   set street       = 'חרוד',
       house_number = '1',
       address      = 'חרוד 1',
       title        = 'תעשייה, יוקה פארק חרוד 1 - 254 מ"ר',
       geocode_attempts    = 0,
       geocode_attempted_at = null,
       geocode_error       = null
 where id = '07e2e78a-16c0-465e-a93a-8f6472a07d40'
   and street = 'יוקה פארק';

-- ============================================================================
-- 3. מודעה #1066: "ליד בנק הפועלים 1" → "היצירה 3"
--
-- ‏"ליד בנק הפועלים" הוא תיאור מיקום ולא רחוב. הוא נשאר בתיאור
-- ("חנות להשכרה באזור התעשייה, ליד בנק הפועלים, עפולה") ויורד מהכתובת.
--
-- **‏`lat`/`lng` נמחקים כאן בכוונה, והמחיר ידוע.** הפין ששמור היום
-- (‏32.601334 / 35.2940907) הוא **בדיוק** הפין של חמש המודעות בהיצירה 5,
-- כלומר הוא מעולם לא נפתר מהכתובת של המודעה הזו אלא הועתק מבניין אחר.
-- פין שנראה מדויק ואינו כזה הוא בדיוק מה ש-`docs/property-map.md` אוסר,
-- והשארתו הייתה מנציחה שגיאה שקטה. הסיכון בכיוון השני נאמר במפורש: אם
-- ‏"היצירה 3" אינה נקודת כתובת בשכבת העירייה, המודעה תישאר בלי פין עד
-- שיימצא לה מספר בית נכון — ואז אין פין כלל, וזה עדיף על פין שקרי.
-- ============================================================================

update public.properties
   set street       = 'היצירה',
       house_number = '3',
       address      = 'היצירה 3',
       title        = 'חנות, היצירה 3 - 115 מ"ר',
       lat          = null,
       lng          = null,
       geocode_attempts     = 0,
       geocode_attempted_at = null,
       geocode_error        = null
 where id = '29cc2ae2-ce75-4c82-b937-8de4df3c21ec'
   and street = 'ליד בנק הפועלים';

-- ============================================================================
-- 4. מרשם הרחובות: שתי שורות שאינן רחובות
--
-- אותה שמירה של `20261218090000`: מוחקים רק אם אף נכס אינו משתמש בשם.
-- ‏`יוקה פארק` נשאר שם עד היום בדיוק מפני שהמחיקה הקודמת רצה בזמן
-- שמודעה #1051 עדיין נשאה אותו, כלומר השמירה עבדה.
-- ============================================================================

delete from public.street_registry r
 where r.city = 'עפולה'
   and r.name in ('יוקה פארק', 'ליד בנק הפועלים')
   and not exists (
     select 1 from public.properties p
      where p.city = 'עפולה' and p.street = r.name);

-- ============================================================================
-- 5. מאגר העסקאות: "רובע יזרעאל" → "שדרות רובע יזרעאל"
--
-- ‏15 עסקאות בעפולה נקלטו תחת "רובע יזרעאל", ו**כולן החזירו
-- ‏`address_not_found`** — כי שם הרחוב במרשם ובשכבת העירייה הוא
-- **שדרות רובע יזרעאל**. זו אותה שגיאה בדיוק שתוקנה במודעה אחת
-- ב-`20261219090000`, והפעם היא במאגר שהדוח נשען עליו.
--
-- **העדות שזה יעבוד, ולא הערכה:** שלוש מודעות פעילות בשדרות רובע
-- יזרעאל 20, 28 ו-32 נושאות פין שנפתר משכבת העירייה. מספרי הבתים של
-- העסקאות הם 16, 20, 24, 28, 46 ו-50 — כלומר שניים מהם כבר הוכחו,
-- והשאר על אותו ציר.
--
-- המונים מאופסים כדי שהשורות ייכנסו לראש התור מיד, ולא ימתינו
-- לחלון ה-20 שעות של `geocode_backfill_queue`.
--
-- זה גם מה שסוגר את הפער שהדוח מראה: בלי פין, עסקה אינה נכנסת לשום
-- חישוב רדיוס, ולכן רובע יזרעאל — השכונה היקרה בעיר — נעדרה לגמרי
-- מהממוצע של כל נכס בסביבתה.
-- ============================================================================

update public.market_deals_official
   set street               = 'שדרות רובע יזרעאל',
       geocode_attempts     = 0,
       geocode_attempted_at = null,
       geocode_error        = null
 where city = 'עפולה'
   and street = 'רובע יזרעאל';

-- ============================================================================
-- 6. רדיוס הבסיס של דוח ה-CMA: 1,000 מ' → 750 מ'
--
-- החלטת מנהל/ת הפלטפורמה, אחרי שהדוח נבדק על נכסים אמיתיים כשכל 813
-- הפינים כבר היו במאגר. זו בדיוק הבדיקה החוזרת ש-`20261223090000`
-- ביקש: הערך של קילומטר נקבע כשהמאגר היה כמעט ריק מפינים, כלומר על
-- היעדר נתונים ולא על היעדר טווח.
--
--   היה   1,000 · 2,000 · 3,000 · 4,000 · 6,000
--   עכשיו   750 · 1,500 · 2,250 · 3,000 · 4,500
--
-- ‏750 מ' הוא פשרה מכוונת בין שני כיוונים שנמדדו: ב-500 מ' חמישה
-- מתוך שישה נכסים כבר קיבלו את מינימום ההשוואות, וקילומטר מערבב
-- שכונות שמחיר המ"ר בהן נע בין כ-9,000 בגבעת המורה לכ-15,000 ברובע
-- יזרעאל. הרדיוס מתרחב ממילא כשאין די עסקאות, ולכן מה שנקבע כאן הוא
-- **מאיפה מתחילים** ולא **עד לאן אפשר להגיע**.
--
-- ‏`radius_meters_used` חוזר בדוח ואומר בכל קריאה באיזה שלב באמת
-- נעצרנו, כלומר התשובה ממשיכה להימדד ולא להיות משוערת.
-- ============================================================================

update public.pricing_config
   set value = 750
 where key = 'cma_default_radius_meters';

insert into public.pricing_config (key, value)
values ('cma_default_radius_meters', 750)
on conflict (key) do nothing;

-- ============================================================================
-- דיווח: מה באמת השתנה
-- ============================================================================

do $$
declare
  v_radius   numeric;
  v_deals    integer;
  v_props    integer;
  v_registry integer;
begin
  select value into v_radius
    from public.pricing_config where key = 'cma_default_radius_meters';

  select count(*) into v_deals
    from public.market_deals_official
   where city = 'עפולה' and street = 'שדרות רובע יזרעאל';

  select count(*) into v_props
    from public.properties
   where id in ('07e2e78a-16c0-465e-a93a-8f6472a07d40',
                '29cc2ae2-ce75-4c82-b937-8de4df3c21ec')
     and street in ('חרוד', 'היצירה');

  select count(*) into v_registry
    from public.street_registry
   where city = 'עפולה' and name in ('יוקה פארק', 'ליד בנק הפועלים');

  raise notice 'עסקאות בשדרות רובע יזרעאל: % · מודעות שכתובתן תוקנה: %/2 · שורות מרשם שנותרו: % · רדיוס CMA: % מטר',
    v_deals, v_props, v_registry, v_radius;

  if v_props <> 2 then
    raise exception 'תיקון הכתובות לא הוחל על שתי המודעות (הוחל על %)', v_props;
  end if;
end $$;
