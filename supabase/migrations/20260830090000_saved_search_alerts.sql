-- ============================================================================
-- הסוכן החכם — חיפוש שמור והתראות מותאמות אישית למחפשי דירה
--
-- מבקר/ת באתר מגדיר/ה פעם אחת "4 חדרים ברובע יזרעאל עד 1.4M", וברגע שנכס כזה
-- עולה — ההתראה יוצאת בוואטסאפ או במייל. שני דברים קורים כאן בבת אחת:
--
--   ‏1. ריטנשן — מי שקיבל/ה התראה רלוונטית חוזר/ת לאתר. זו הסיבה שכל התראה
--      נושאת click_token: הקליק הוא מדד ההתעניינות היחיד שיש לנו על אדם
--      שלא נרשם לאתר.
--   ‏2. ליד — חיפוש שמור *הוא* ליד קונה מובנה. הוא יודע תקציב, אזור, חדרים
--      ורמת התעניינות מוכחת, וזה יותר ממה שטופס "צור קשר" מספק אי פעם.
--      לכן אותה שורה עצמה נמכרת לסוכן/ת אחד/ת במדף, באותו מנגנון
--      ‏Pay-per-lead של rss_leads ו-mortgage_leads.
--
-- ‏ההפרדה שמחזיקה את שני התפקידים בשורה אחת בלי להתנגש:
--   ‏status      — מצב ההתראות (‏active/paused/unsubscribed). של המחפש/ת.
--   ‏lead_status — מצב המכירה (‏new/sold/archived). של הפלטפורמה.
-- מי שביטל/ה התראות מפסיק/ה לקבל אותן אבל הליד שכבר נמכר נשאר בידי הקונה.
--
-- ‏מבנה הקובץ:
--   ‏1. מספרים עסקיים ב-pricing_config
--   ‏2. saved_searches — החיפוש עצמו
--   ‏3. saved_search_matches() — מקור האמת היחיד להתאמה
--   ‏4. saved_search_alerts — תור ההתראות
--   ‏5. generate_saved_search_alerts() + טריגרים על properties
--   ‏6. ה-API של שרת ההתראות (משיכה, סימון, קליק, ביטול)
--   ‏7. מדף הלידים: ה-view הציבורי, ציון ההתעניינות והרכישה האטומית
--   ‏8. תזמון pg_cron
--
-- הקובץ אידמפוטנטי — אפשר להריץ אותו שוב ושוב.
--
-- ‏תלויות שכבר קיימות בפרויקט: normalize_msisdn() (מיגרציית הוואטסאפ),
-- ‏rss_set_updated_at() (schema.sql), current_agent_id(), pricing_config,
-- ‏agency_members, properties, neighborhoods.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. מספרים עסקיים
--
-- כמו כל מספר עסקי בפרויקט — ב-pricing_config ולא בקוד, כדי שאפשר יהיה
-- לשנות אותו בלי פריסה מחדש.
-- ---------------------------------------------------------------------------
insert into public.pricing_config (key, value, description) values
  ('saved_search_lead_price', 60,
   '₪ לרכישת ליד מחפש/ת דירה ממדף הסוכן החכם'),
  ('saved_search_daily_cap', 5,
   'מקסימום התראות ליממה לחיפוש שמור אחד — בלם הצפה'),
  ('saved_search_max_per_phone', 5,
   'מקסימום חיפושים שמורים פעילים לאותו מספר טלפון'),
  ('saved_search_quiet_from_hour', 22,
   'השעה (שעון ישראל) שממנה מפסיקים לשלוח התראות'),
  ('saved_search_quiet_to_hour', 8,
   'השעה (שעון ישראל) שממנה חוזרים לשלוח התראות'),
  ('saved_search_lead_min_intent', 45,
   'ציון ההתעניינות המינימלי שממנו ליד מחפש/ת דירה מוצג במדף')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. החיפוש השמור
--
-- ‏למה העמודות ולא jsonb אחד: ההתאמה רצה על כל נכס חדש מול כל החיפושים
-- הפעילים, והיא חייבת להיות אינדקסבילה וקריאה. jsonb היה הופך את
-- ‏saved_search_matches לשדה מוקשים של קאסטים.
--
-- ‏free_text נשמר אבל **אינו משתתף בהתאמה**. התאמת טקסט חופשי ב-SQL מייצרת
-- התראות שגויות ("גן" תופס גם "דירת גן" וגם "רחוב הגן"), והתראה שגויה
-- למחפש/ת דירה עולה יותר מהתראה שלא נשלחה. הטקסט מוצג לסוכן/ת שקונה את
-- הליד — שם הוא שווה זהב — ובאתר הוא מתורגם למזהי שכונות עוד לפני השמירה.
-- ---------------------------------------------------------------------------
create table if not exists public.saved_searches (
  id             uuid primary key default gen_random_uuid(),

  -- מי מחפש/ת. אדם פרטי — הטבלה סגורה ל-anon לגמרי (ראו §7).
  full_name      text not null check (length(btrim(full_name)) >= 2),
  phone          text,
  phone_e164     text generated always as (public.normalize_msisdn(phone)) stored,
  email          text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  contact_channel text not null default 'whatsapp'
                 check (contact_channel in ('whatsapp','email','both')),

  -- תיאור החיפוש בעברית, כפי שנבנה באתר ("4 חדרים ברובע יזרעאל עד ₪1.4M").
  -- נשמר ולא נגזר בקריאה כדי שההתראה והמדף יראו בדיוק מה שהמחפש/ת אישר/ה.
  label          text,

  -- הקריטריונים
  deal_type      text not null default 'sale'  check (deal_type in ('sale','rent')),
  category       text not null default 'residential'
                 check (category in ('residential','commercial')),
  cities            text[] not null default '{}',
  neighborhood_ids  uuid[] not null default '{}',
  property_types    text[] not null default '{}',
  min_price      numeric(14,2) check (min_price is null or min_price >= 0),
  max_price      numeric(14,2) check (max_price is null or max_price >= 0),
  min_rooms      numeric(4,1)  check (min_rooms is null or min_rooms > 0),
  max_rooms      numeric(4,1)  check (max_rooms is null or max_rooms > 0),
  min_size_sqm   numeric(10,2) check (min_size_sqm is null or min_size_sqm >= 0),
  max_size_sqm   numeric(10,2) check (max_size_sqm is null or max_size_sqm >= 0),
  min_floor      smallint,
  max_floor      smallint,
  required_features text[] not null default '{}',
  condition      text,
  free_text      text,

  -- מצב ההתראות — שייך למחפש/ת
  status         text not null default 'active'
                 check (status in ('active','paused','unsubscribed')),
  unsubscribe_token text not null unique default encode(gen_random_bytes(24), 'hex'),
  consent_agent_contact boolean not null default false,

  -- טלמטריה שמזינה את ציון ההתעניינות
  alerts_sent    integer not null default 0,
  alerts_clicked integer not null default 0,
  last_alert_at  timestamptz,
  last_click_at  timestamptz,

  -- מצב המכירה — שייך לפלטפורמה
  lead_status    text not null default 'new'
                 check (lead_status in ('new','sold','archived')),
  sold_at        timestamptz,
  sold_to_agent_id uuid references public.agency_members(id) on delete set null,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- טווחים הפוכים הם תמיד באג בצד הקורא, ולא בקשה לגיטימית
  constraint saved_searches_price_range check (min_price is null or max_price is null or min_price <= max_price),
  constraint saved_searches_rooms_range check (min_rooms is null or max_rooms is null or min_rooms <= max_rooms),
  constraint saved_searches_size_range  check (min_size_sqm is null or max_size_sqm is null or min_size_sqm <= max_size_sqm),
  constraint saved_searches_floor_range check (min_floor is null or max_floor is null or min_floor <= max_floor),

  -- חייב להיות לאן לשלוח, ובערוץ שנבחר
  constraint saved_searches_reachable check (
    (contact_channel in ('whatsapp','both') and phone is not null)
    or (contact_channel in ('email','both') and email is not null)
  )
);

comment on table public.saved_searches is
  'חיפוש שמור של מחפש/ת דירה — מזין את ההתראות, ובמקביל הוא ליד קונה מובנה שנמכר לסוכן/ת אחד/ת. שם, טלפון ואימייל רגישים: anon נשלל מהטבלה לגמרי.';
comment on column public.saved_searches.status is
  'מצב ההתראות, בידי המחפש/ת: active = שולחים · paused = הושהה · unsubscribed = ביטל/ה. אינו נוגע ב-lead_status.';
comment on column public.saved_searches.lead_status is
  'מצב המכירה, בידי הפלטפורמה: new = פנוי במדף · sold = נמכר · archived = הוסר. ליד שנמכר נשאר בידי הקונה גם אם ההתראות בוטלו.';
comment on column public.saved_searches.free_text is
  'הטקסט החופשי שהוקלד בחיפוש. נשמר לטובת הסוכן/ת שקונה את הליד — ואינו משתתף בהתאמה, כדי לא לייצר התראות שגויות.';
comment on column public.saved_searches.unsubscribe_token is
  'סוד לכל חיפוש. כל התראה נושאת אותו כקישור "הפסקת התראות", וזו הדרך היחידה לבטל בלי חשבון משתמש.';
comment on column public.saved_searches.consent_agent_contact is
  'אישור מפורש שמתווך/ת רשאי/ת ליצור קשר. בלעדיו החיפוש עובד כרגיל אבל אינו מוצע במדף הלידים — ראו saved_search_leads_public.';
comment on column public.saved_searches.alerts_clicked is
  'כמה פעמים נלחצה התראה. מדד ההתעניינות היחיד שיש לנו על אדם שאינו רשום לאתר, והמשקל הכבד בציון ההתעניינות.';

-- ‏טביעת האצבע של הקריטריונים, שמונעת שכפול של אותו חיפוש על ידי אותו אדם.
--
-- ‏למה טריגר ולא עמודה מחושבת (generated): הביטוי מכיל מערכים, והמרת מערך
-- לטקסט ב-PostgreSQL היא stable ולא immutable (array_out) — עמודה מחושבת
-- דורשת immutable ותידחה. הטריגר גם עושה משהו שעמודה מחושבת לא יכולה:
-- הוא **ממיין** את המערכים לפני החישוב, ולכן {'דירה','דירת גן'} ו-
-- ‏{'דירת גן','דירה'} הם אותו חיפוש — כפי שהם באמת. הנרמול יושב במסד ולא
-- בקוד הקורא, כדי שיתקיים גם על כתיבה מה-SQL Editor.
alter table public.saved_searches
  add column if not exists criteria_hash text;

comment on column public.saved_searches.criteria_hash is
  'טביעת אצבע של הקריטריונים, מחושבת בטריגר על מערכים ממוינים. עם phone_e164 היא מונעת שכפול של אותו חיפוש בדיוק על ידי אותו אדם.';

create or replace function public.saved_searches_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.full_name := btrim(new.full_name);
  new.email     := nullif(lower(btrim(coalesce(new.email, ''))), '');
  new.phone     := nullif(btrim(coalesce(new.phone, '')), '');
  new.free_text := nullif(btrim(coalesce(new.free_text, '')), '');

  -- מיון + הסרת כפילויות. ‏distinct כאן אינו קוסמטיקה: ['דירה','דירה']
  -- ו-['דירה'] הם אותו חיפוש, ובלי ההסרה הם היו שתי שורות.
  select coalesce(array_agg(distinct v order by v), '{}')
    into new.cities            from unnest(new.cities) v;
  select coalesce(array_agg(distinct v order by v), '{}')
    into new.neighborhood_ids  from unnest(new.neighborhood_ids) v;
  select coalesce(array_agg(distinct v order by v), '{}')
    into new.property_types    from unnest(new.property_types) v;
  select coalesce(array_agg(distinct v order by v), '{}')
    into new.required_features from unnest(new.required_features) v;

  new.criteria_hash := md5(
    new.deal_type || '|' || new.category || '|' ||
    array_to_string(new.cities, ',')            || '|' ||
    array_to_string(new.neighborhood_ids, ',')  || '|' ||
    array_to_string(new.property_types, ',')    || '|' ||
    coalesce(new.min_price::text, '')    || '|' || coalesce(new.max_price::text, '')    || '|' ||
    coalesce(new.min_rooms::text, '')    || '|' || coalesce(new.max_rooms::text, '')    || '|' ||
    coalesce(new.min_size_sqm::text, '') || '|' || coalesce(new.max_size_sqm::text, '') || '|' ||
    coalesce(new.min_floor::text, '')    || '|' || coalesce(new.max_floor::text, '')    || '|' ||
    array_to_string(new.required_features, ',')  || '|' || coalesce(new.condition, '')
  );

  return new;
end;
$$;

comment on function public.saved_searches_normalize() is
  'מנרמלת חיפוש שמור לפני כתיבה: מיון והסרת כפילויות מהמערכים, ניקוי שדות הקשר, וחישוב criteria_hash. הנרמול במסד ולא בקוד הקורא כדי שיתקיים לכל כותב.';

drop trigger if exists saved_searches_normalize on public.saved_searches;
create trigger saved_searches_normalize
  before insert or update on public.saved_searches
  for each row execute function public.saved_searches_normalize();

create unique index if not exists saved_searches_dedupe_key
  on public.saved_searches (phone_e164, criteria_hash)
  where phone_e164 is not null and status <> 'unsubscribed';

-- החיפוש הנפוץ ביותר: כל החיפושים הפעילים לסוג עסקה וקטגוריה מסוימים.
-- זו השאילתה שרצה על כל נכס חדש, ולכן היא מקבלת אינדקס חלקי משלה.
create index if not exists saved_searches_active_idx
  on public.saved_searches (deal_type, category)
  where status = 'active';
create index if not exists saved_searches_shelf_idx
  on public.saved_searches (created_at desc)
  where lead_status = 'new' and consent_agent_contact = true;
create index if not exists saved_searches_buyer_idx
  on public.saved_searches (sold_to_agent_id);

drop trigger if exists saved_searches_set_updated_at on public.saved_searches;
create trigger saved_searches_set_updated_at
  before update on public.saved_searches
  for each row execute function public.rss_set_updated_at();

-- ---------------------------------------------------------------------------
-- ‏2ג. יצירת חיפוש — הכתיבה היחידה מהאתר
--
-- ‏למה פונקציה ולא insert רגיל מה-Edge Function: התקרה למספר החיפושים לאותו
-- אדם והזיהוי של "אותו חיפוש בדיוק" חייבים לקרות **אחרי** שהטריגר חישב את
-- ‏criteria_hash ואת phone_e164. ספירה מוקדמת בקוד הקורא הייתה מחייבת אותו
-- לשכפל את normalize_msisdn ואת חישוב ה-hash — שתי נוסחאות שנפרדות בשקט,
-- ובינתיים מי שהגיע/ה לתקרה ושלח/ה שוב את אותו חיפוש היה מקבל/ת "יותר מדי
-- חיפושים" במקום "נשמר".
--
-- ‏לכן הסדר כאן הפוך: קודם מכניסים, ואז סופרים.
--   ‏· נפילה על unique = אותו חיפוש בדיוק כבר קיים. מבחינת המחפש/ת זו הצלחה.
--   ‏· חריגה מהתקרה = מוחקים את השורה שזה עתה נכנסה ומחזירים שגיאה. הכול
--     בטרנזקציה אחת, ולכן לא נשארת שארית.
-- ---------------------------------------------------------------------------
create or replace function public.create_saved_search(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    uuid;
  v_label text;
  v_cap   int;
  v_count int;
  v_phone text;
begin
  begin
    insert into public.saved_searches (
      full_name, phone, email, contact_channel, label,
      deal_type, category, cities, neighborhood_ids, property_types,
      min_price, max_price, min_rooms, max_rooms,
      min_size_sqm, max_size_sqm, min_floor, max_floor,
      required_features, condition, free_text, consent_agent_contact
    ) values (
      p_payload->>'full_name',
      p_payload->>'phone',
      p_payload->>'email',
      coalesce(p_payload->>'contact_channel', 'whatsapp'),
      p_payload->>'label',
      coalesce(p_payload->>'deal_type', 'sale'),
      coalesce(p_payload->>'category', 'residential'),
      coalesce(array(select jsonb_array_elements_text(p_payload->'cities')), '{}'),
      coalesce(array(select jsonb_array_elements_text(p_payload->'neighborhood_ids')::uuid), '{}'),
      coalesce(array(select jsonb_array_elements_text(p_payload->'property_types')), '{}'),
      (p_payload->>'min_price')::numeric,
      (p_payload->>'max_price')::numeric,
      (p_payload->>'min_rooms')::numeric,
      (p_payload->>'max_rooms')::numeric,
      (p_payload->>'min_size_sqm')::numeric,
      (p_payload->>'max_size_sqm')::numeric,
      (p_payload->>'min_floor')::smallint,
      (p_payload->>'max_floor')::smallint,
      coalesce(array(select jsonb_array_elements_text(p_payload->'required_features')), '{}'),
      p_payload->>'condition',
      p_payload->>'free_text',
      coalesce((p_payload->>'consent_agent_contact')::boolean, false)
    )
    returning id, label, phone_e164 into v_id, v_label, v_phone;
  exception
    when unique_violation then
      return jsonb_build_object('success', true, 'duplicate', true);
    when check_violation then
      return jsonb_build_object('error', 'invalid_criteria');
  end;

  -- התקרה נבדקת רק על מי שמסר/ה טלפון: זהו המזהה היחיד שיש לנו לאדם
  -- שאינו רשום לאתר.
  if v_phone is not null then
    v_cap := coalesce((select value::int from public.pricing_config
                        where key = 'saved_search_max_per_phone'), 5);
    select count(*) into v_count
      from public.saved_searches
     where phone_e164 = v_phone and status <> 'unsubscribed';

    if v_count > v_cap then
      delete from public.saved_searches where id = v_id;
      return jsonb_build_object('error', 'too_many_searches', 'limit', v_cap);
    end if;
  end if;

  return jsonb_build_object('success', true, 'search_id', v_id, 'label', v_label);
end;
$$;

comment on function public.create_saved_search(jsonb) is
  'יוצרת חיפוש שמור מהאתר. מכניסה קודם וסופרת אחר כך, כדי שהתקרה וזיהוי הכפילות יישענו על criteria_hash ועל phone_e164 שהטריגר חישב. ל-service_role בלבד, דרך saved-search-intake.';

revoke all on function public.create_saved_search(jsonb) from public;
revoke all on function public.create_saved_search(jsonb) from anon, authenticated;
grant execute on function public.create_saved_search(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 3. ההתאמה — מקור אמת אחד
--
-- ‏boolean ולא ציון, בניגוד ל-client_property_match של הסוכנים. שם הצרכן/ית
-- הוא סוכן/ת מקצועי/ת שביקש/ה לראות התאמות, וגם 60% שווה הצגה עם הסבר על
-- הפער. כאן הצרכן/ית הוא אדם פרטי שאמר/ה "עד 1.4 מיליון", וכל הודעה על נכס
-- ב-1.55 מיליון היא הודעה שמלמדת אותו/ה להתעלם מההודעה הבאה. אין "כמעט".
--
-- ‏שדה חסר בנכס פוסל כשהמחפש/ת הגביל/ה אותו: נכס בלי מספר חדרים לא יישלח
-- למי שביקש/ה 4 חדרים. זה מקרה נדיר, והמחיר של התראה שגויה גבוה מהמחיר של
-- התראה שלא יצאה.
--
-- ‏size_sqm מול area_sqm: שתי העמודות קיימות ב-properties ולא כל מודעה
-- ממלאת את שתיהן, ולכן ההשוואה על ה-coalesce ביניהן.
-- ---------------------------------------------------------------------------
create or replace function public.saved_search_matches(
  p_search   public.saved_searches,
  p_property public.properties
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
        p_property.status    = 'active'
    and p_property.deal_type = p_search.deal_type
    and p_property.category  = p_search.category

    -- מיקום: עיר או שכונה. שתי הרשימות ריקות = כל מקום.
    and (
      (cardinality(p_search.cities) = 0 and cardinality(p_search.neighborhood_ids) = 0)
      or p_property.city = any(p_search.cities)
      or (p_property.neighborhood_id is not null
          and p_property.neighborhood_id = any(p_search.neighborhood_ids))
    )

    and (cardinality(p_search.property_types) = 0
         or p_property.property_type = any(p_search.property_types))

    and (p_search.max_price is null or p_property.price <= p_search.max_price)
    and (p_search.min_price is null or p_property.price >= p_search.min_price)

    and (p_search.min_rooms is null
         or (p_property.rooms is not null and p_property.rooms >= p_search.min_rooms))
    and (p_search.max_rooms is null
         or (p_property.rooms is not null and p_property.rooms <= p_search.max_rooms))

    and (p_search.min_size_sqm is null
         or (coalesce(p_property.size_sqm, p_property.area_sqm) is not null
             and coalesce(p_property.size_sqm, p_property.area_sqm) >= p_search.min_size_sqm))
    and (p_search.max_size_sqm is null
         or (coalesce(p_property.size_sqm, p_property.area_sqm) is not null
             and coalesce(p_property.size_sqm, p_property.area_sqm) <= p_search.max_size_sqm))

    and (p_search.min_floor is null
         or (p_property.floor is not null and p_property.floor >= p_search.min_floor))
    and (p_search.max_floor is null
         or (p_property.floor is not null and p_property.floor <= p_search.max_floor))

    and (cardinality(p_search.required_features) = 0
         or p_property.features @> p_search.required_features)

    and (p_search.condition is null or p_property.condition = p_search.condition);
$$;

comment on function public.saved_search_matches(public.saved_searches, public.properties) is
  'האם הנכס עונה על החיפוש השמור. בוליאני ולא ציון — למחפש/ת דירה התראה חלקית היא ספאם. מקור האמת של הטריגרים ושל תצוגת ההתאמות גם יחד.';

revoke all on function public.saved_search_matches(public.saved_searches, public.properties) from public;
revoke all on function public.saved_search_matches(public.saved_searches, public.properties) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. תור ההתראות
--
-- ‏unique(search_id, property_id) הוא הלב, בדיוק כמו ב-client_match_alerts:
-- אותו נכס מתריע פעם אחת לכל חיפוש, לכל החיים. בלי זה כל עדכון מחיר היה
-- הודעת וואטסאפ נוספת על נכס שכבר נשלח.
--
-- ‏הפרדת הערוצים לשתי עמודות ולא לסטטוס אחד: מי שביקש/ה "both" וקיבל/ה מייל
-- אבל הוואטסאפ נכשל צריך/ה שהוואטסאפ יישלח בניסיון הבא — ולא שההתראה
-- תיחשב "נשלחה" או תישלח פעמיים במייל.
-- ---------------------------------------------------------------------------
create table if not exists public.saved_search_alerts (
  id          uuid primary key default gen_random_uuid(),
  search_id   uuid not null references public.saved_searches(id) on delete cascade,
  property_id uuid not null references public.properties(id)     on delete cascade,

  status      text not null default 'pending'
              check (status in ('pending','sent','failed','skipped')),
  whatsapp_status text not null default 'pending'
              check (whatsapp_status in ('pending','sent','failed','not_requested')),
  email_status    text not null default 'pending'
              check (email_status in ('pending','sent','failed','not_requested')),

  attempts    smallint not null default 0,
  last_error  text,

  -- הקליק הוא המדד. טוקן לכל התראה, כדי לדעת *איזה* נכס עניין ולא רק שהיה קליק.
  click_token text not null unique default encode(gen_random_bytes(16), 'hex'),
  clicked_at  timestamptz,

  created_at  timestamptz not null default now(),
  sent_at     timestamptz,

  constraint saved_search_alerts_unique unique (search_id, property_id)
);

comment on table public.saved_search_alerts is
  'תור ההתראות למחפשי דירה. שורה אחת לכל צמד חיפוש–נכס לכל החיים; שרת ההתראות מושך ממנה ומסמן.';
comment on column public.saved_search_alerts.status is
  'pending = ממתין למשלוח · sent = יצא בערוץ אחד לפחות · failed = נכשל אחרי מספר ניסיונות · skipped = לא נשלח (החיפוש הושהה/בוטל, הנכס כבר לא פעיל).';
comment on column public.saved_search_alerts.click_token is
  'סוד לכל התראה. הקישור בהודעה עובר דרכו, וכך נמדדת ההתעניינות בנכס הספציפי.';

create index if not exists saved_search_alerts_queue_idx
  on public.saved_search_alerts (created_at)
  where status = 'pending';
create index if not exists saved_search_alerts_search_idx
  on public.saved_search_alerts (search_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 5. פתיחת ההתראות לנכס אחד
--
-- אותה תבנית כמו generate_client_match_alerts: הצהרה אחת, on conflict do
-- nothing כרשת ביטחון, והספירה מה-returning.
--
-- ‏הכתיבה כאן היא רק לתור. המשלוח עצמו נעשה בשרת ההתראות ולא בטריגר: קריאת
-- ‏HTTP יוצאת מתוך טריגר הייתה כובלת את זמן שמירת הנכס לזמן התגובה של
-- ‏Meta, ונפילה של Meta הייתה נפילה של פרסום מודעה.
-- ---------------------------------------------------------------------------
create or replace function public.generate_saved_search_alerts(p_property_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prop    public.properties%rowtype;
  v_created int := 0;
begin
  select * into v_prop from public.properties where id = p_property_id;
  if not found or v_prop.status <> 'active' then
    return 0;
  end if;

  with hits as (
    select s.id as search_id
      from public.saved_searches s
     where s.status = 'active'
       and s.deal_type = v_prop.deal_type
       and s.category  = v_prop.category
       and public.saved_search_matches(s, v_prop)
  ),
  ins as (
    insert into public.saved_search_alerts (search_id, property_id)
    select h.search_id, v_prop.id from hits h
    on conflict (search_id, property_id) do nothing
    returning 1
  )
  select count(*)::int into v_created from ins;

  return v_created;
end;
$$;

comment on function public.generate_saved_search_alerts(uuid) is
  'מכניסה לתור התראה לכל חיפוש שמור פעיל שהנכס עונה עליו. אידמפוטנטית — צמד חיפוש–נכס שכבר בתור לא נכנס שוב. אינה שולחת דבר; המשלוח בשרת ההתראות.';

revoke all on function public.generate_saved_search_alerts(uuid) from public;
revoke all on function public.generate_saved_search_alerts(uuid) from anon, authenticated;

-- הטריגרים. כישלון בתור לא מפיל שמירת נכס — פרסום מודעה הוא הפעולה,
-- וההתראה היא תוצר לוואי שלה. אותה החלטה כמו בהתראות ההתאמה של הסוכנים.
create or replace function public.properties_saved_search_alerts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform public.generate_saved_search_alerts(new.id);
  exception when others then
    raise warning 'saved search alerts failed for property %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists properties_saved_search_alerts_ins on public.properties;
create trigger properties_saved_search_alerts_ins
  after insert on public.properties
  for each row
  when (new.status = 'active')
  execute function public.properties_saved_search_alerts();

-- ‏אותה רשימת שדות כמו בהתראות ההתאמה, מאותה סיבה: ירידת מחיר שמכניסה נכס
-- קיים לתקציב היא בדיוק הרגע ששווה להתריע עליו. עדכון כותרת או תמונות
-- לא מריץ כלום.
drop trigger if exists properties_saved_search_alerts_upd on public.properties;
create trigger properties_saved_search_alerts_upd
  after update on public.properties
  for each row
  when (new.status = 'active' and (
        old.status        is distinct from new.status
     or old.price         is distinct from new.price
     or old.rooms         is distinct from new.rooms
     or old.size_sqm      is distinct from new.size_sqm
     or old.area_sqm      is distinct from new.area_sqm
     or old.floor         is distinct from new.floor
     or old.city          is distinct from new.city
     or old.neighborhood_id is distinct from new.neighborhood_id
     or old.property_type is distinct from new.property_type
     or old.deal_type     is distinct from new.deal_type
     or old.category      is distinct from new.category
     or old.condition     is distinct from new.condition
     or old.features      is distinct from new.features))
  execute function public.properties_saved_search_alerts();

-- ---------------------------------------------------------------------------
-- 6. ה-API של שרת ההתראות
--
-- שלוש פונקציות, כולן ל-service_role בלבד: משיכה, סימון, וטיפול בקישורים
-- שבתוך ההודעה (קליק וביטול).
-- ---------------------------------------------------------------------------

-- 6א. שקט לילי — האם מותר לשלוח עכשיו.
-- ‏Asia/Jerusalem במפורש: השרת ב-UTC, ו"22:00" של מחפש/ת דירה הוא שעון
-- ישראל. חלון שחוצה חצות (22→8) הוא or ולא and.
create or replace function public.saved_search_quiet_now()
returns boolean
language sql
stable
set search_path = ''
as $$
  with cfg as (
    select
      coalesce((select value::int from public.pricing_config where key = 'saved_search_quiet_from_hour'), 22) as from_h,
      coalesce((select value::int from public.pricing_config where key = 'saved_search_quiet_to_hour'),   8)  as to_h
  ),
  now_h as (
    select extract(hour from (now() at time zone 'Asia/Jerusalem'))::int as h
  )
  select case
           when cfg.from_h = cfg.to_h then false               -- שקט מבוטל
           when cfg.from_h < cfg.to_h then now_h.h >= cfg.from_h and now_h.h < cfg.to_h
           else now_h.h >= cfg.from_h or now_h.h < cfg.to_h    -- חלון שחוצה חצות
         end
    from cfg, now_h;
$$;

comment on function public.saved_search_quiet_now() is
  'האם אנחנו בתוך שעות השקט (שעון ישראל). התראה שנוצרה בשתיים בלילה ממתינה בתור עד הבוקר במקום להעיר מחפש/ת דירה.';

-- 6ב. המשיכה. מחזירה הודעות מוכנות לשליחה — הכתובת, הטקסט והקישורים —
-- כדי ששרת ההתראות לא יצטרך להרכיב אותם משבע שאילתות.
--
-- שלושה מסננים חיים כאן ולא בשרת, כי הם כללי מוצר ולא פרטי מימוש:
--   ‏· החיפוש עדיין פעיל והנכס עדיין פעיל — אחרת ההתראה נזרקת (skipped).
--   ‏· שעות שקט.
--   ‏· תקרת התראות ליממה לכל חיפוש.
create or replace function public.saved_search_pending_alerts(p_limit int default 50)
returns table (
  alert_id      uuid,
  search_id     uuid,
  full_name     text,
  phone_e164    text,
  email         text,
  contact_channel text,
  label         text,
  unsubscribe_token text,
  click_token   text,
  property_id   uuid,
  title         text,
  price         numeric,
  rooms         numeric,
  size_sqm      numeric,
  floor         int,
  city          text,
  neighborhood  text,
  street        text,
  property_type text,
  deal_type     text,
  image_url     text
)
language sql
security definer
set search_path = ''
as $$
  with cap as (
    select coalesce((select value::int from public.pricing_config
                      where key = 'saved_search_daily_cap'), 5) as daily_cap
  ),
  sent_today as (
    select a.search_id, count(*) as n
      from public.saved_search_alerts a
     where a.status = 'sent' and a.sent_at > now() - interval '24 hours'
     group by a.search_id
  )
  select
    a.id, s.id, s.full_name, s.phone_e164, s.email, s.contact_channel,
    s.label, s.unsubscribe_token, a.click_token,
    p.id, p.title, p.price, p.rooms::numeric,
    coalesce(p.size_sqm, p.area_sqm)::numeric, p.floor::int,
    p.city, n.name, p.street, p.property_type, p.deal_type,
    (case when array_length(p.images, 1) > 0 then p.images[1] else null end)
    from public.saved_search_alerts a
    join public.saved_searches s on s.id = a.search_id
    join public.properties     p on p.id = a.property_id
    left join public.neighborhoods n on n.id = p.neighborhood_id
    cross join cap
    left join sent_today t on t.search_id = a.search_id
   where a.status = 'pending'
     and s.status = 'active'
     and p.status = 'active'
     and not public.saved_search_quiet_now()
     and coalesce(t.n, 0) < cap.daily_cap
   order by a.created_at
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

comment on function public.saved_search_pending_alerts(int) is
  'ההתראות שמותר לשלוח עכשיו, עם כל מה שדרוש להרכבת ההודעה. מסננת חיפושים ונכסים שאינם פעילים, שעות שקט ותקרה יומית.';

revoke all on function public.saved_search_pending_alerts(int) from public;
revoke all on function public.saved_search_pending_alerts(int) from anon, authenticated;
grant execute on function public.saved_search_pending_alerts(int) to service_role;

-- 6ג. הסימון. עדכון ההתראה והמונה על החיפוש בהצהרה אחת, כדי ש-alerts_sent
-- לא יסטה מהמציאות אם השרת נפל בין שתי קריאות.
--
-- ‏status נגזר מהערוצים ולא מתקבל מהשרת: "נשלח" פירושו שערוץ אחד לפחות
-- הצליח, וזו החלטה של המוצר.
create or replace function public.mark_saved_search_alert(
  p_alert_id        uuid,
  p_whatsapp_status text,
  p_email_status    text,
  p_error           text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_search uuid;
begin
  v_status := case
    when p_whatsapp_status = 'sent' or p_email_status = 'sent' then 'sent'
    when p_whatsapp_status = 'not_requested' and p_email_status = 'not_requested' then 'skipped'
    else 'failed'
  end;

  update public.saved_search_alerts
     set whatsapp_status = p_whatsapp_status,
         email_status    = p_email_status,
         status          = v_status,
         attempts        = attempts + 1,
         last_error      = p_error,
         sent_at         = case when v_status = 'sent' then now() else sent_at end
   where id = p_alert_id
   returning search_id into v_search;

  if v_search is null then
    return 'not_found';
  end if;

  if v_status = 'sent' then
    update public.saved_searches
       set alerts_sent = alerts_sent + 1, last_alert_at = now()
     where id = v_search;
  end if;

  return v_status;
end;
$$;

comment on function public.mark_saved_search_alert(uuid, text, text, text) is
  'סוגרת התראה אחרי ניסיון משלוח ומעדכנת את מוני החיפוש. הסטטוס הכולל נגזר מהערוצים: ערוץ אחד שהצליח = נשלחה.';

revoke all on function public.mark_saved_search_alert(uuid, text, text, text) from public;
revoke all on function public.mark_saved_search_alert(uuid, text, text, text) from anon, authenticated;
grant execute on function public.mark_saved_search_alert(uuid, text, text, text) to service_role;

-- ‏6ד. התראות שמיצו את הניסיונות. בלעדיה התור מנסה לנצח לשלוח לטלפון שגוי,
-- ובכל סבב הן חוסמות את המכסה של אלה שכן יכולות לצאת.
create or replace function public.expire_saved_search_alerts()
returns integer
language sql
security definer
set search_path = ''
as $$
  with dead as (
    update public.saved_search_alerts
       set status = 'failed'
     where status = 'pending' and attempts >= 5
    returning 1
  ),
  stale as (
    -- נכס שכבר לא פעיל, או חיפוש שהושהה/בוטל, בזמן שההתראה חיכתה בתור.
    -- ‏attempts < 5 מפריד את הקבוצה הזו מ-dead: שני עדכונים על אותה שורה
    -- באותה הצהרה נשענים על אותו snapshot, והשני היה נבלע בשקט.
    update public.saved_search_alerts a
       set status = 'skipped'
      from public.saved_searches s, public.properties p
     where a.search_id = s.id and a.property_id = p.id
       and a.status = 'pending' and a.attempts < 5
       and (s.status <> 'active' or p.status <> 'active')
    returning 1
  )
  select (select count(*) from dead)::int + (select count(*) from stale)::int;
$$;

comment on function public.expire_saved_search_alerts() is
  'מנקה מהתור התראות שמיצו חמישה ניסיונות, ואת אלה שהחיפוש או הנכס שלהן חדלו להיות פעילים בזמן ההמתנה.';

revoke all on function public.expire_saved_search_alerts() from public;
revoke all on function public.expire_saved_search_alerts() from anon, authenticated;

-- ‏6ה. קליק. מחזירה את מזהה הנכס כדי שהפונקציה שמטפלת בקישור תוכל להפנות
-- מיד, ומעדכנת את מוני ההתעניינות. קליק שני על אותה התראה לא נספר פעמיים —
-- מדד ההתעניינות צריך לספור נכסים, לא רענוני דפדפן.
create or replace function public.click_saved_search_alert(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert  public.saved_search_alerts%rowtype;
begin
  select * into v_alert from public.saved_search_alerts where click_token = p_token;
  if not found then
    return null;
  end if;

  if v_alert.clicked_at is null then
    update public.saved_search_alerts set clicked_at = now() where id = v_alert.id;
    update public.saved_searches
       set alerts_clicked = alerts_clicked + 1, last_click_at = now()
     where id = v_alert.search_id;
  end if;

  return v_alert.property_id;
end;
$$;

comment on function public.click_saved_search_alert(text) is
  'רושמת קליק על התראה ומחזירה את הנכס להפניה. קליק חוזר על אותה התראה אינו נספר שוב.';

revoke all on function public.click_saved_search_alert(text) from public;
revoke all on function public.click_saved_search_alert(text) from anon, authenticated;
grant execute on function public.click_saved_search_alert(text) to service_role;

-- ‏6ו. ביטול והשהיה. הטוקן הוא ההרשאה: מי שמחזיק/ה בו קיבל/ה אותו בהודעה
-- שנשלחה אליו/ה. ‏unsubscribe אינו מוחק את השורה — ליד שכבר נמכר חייב
-- להישאר בידי הקונה, וגם צריך לזכור שלא לשלוח שוב.
create or replace function public.manage_saved_search(p_token text, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_search public.saved_searches%rowtype;
  v_new    text;
begin
  select * into v_search from public.saved_searches where unsubscribe_token = p_token;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;

  v_new := case p_action
             when 'unsubscribe' then 'unsubscribed'
             when 'pause'       then 'paused'
             when 'resume'      then 'active'
             else null
           end;
  if v_new is null then
    return jsonb_build_object('error', 'invalid_action');
  end if;

  -- מי שביטל/ה לא חוזר/ת ל'active' דרך אותו קישור: החזרה נעשית בשמירת
  -- חיפוש חדש באתר, שבה יש שוב הסכמה מפורשת.
  if v_search.status = 'unsubscribed' and v_new = 'active' then
    return jsonb_build_object('error', 'already_unsubscribed');
  end if;

  update public.saved_searches set status = v_new where id = v_search.id;

  -- מה שממתין בתור כבר לא רלוונטי ברגע שההתראות כובו
  if v_new <> 'active' then
    update public.saved_search_alerts
       set status = 'skipped'
     where search_id = v_search.id and status = 'pending';
  end if;

  return jsonb_build_object('success', true, 'status', v_new, 'label', v_search.label);
end;
$$;

comment on function public.manage_saved_search(text, text) is
  'הפסקה, השהיה או חידוש של חיפוש שמור לפי הטוקן שבהודעה. ביטול אינו מוחק את השורה — הליד שנמכר נשאר בידי הקונה, והמערכת צריכה לזכור לא לשלוח שוב.';

revoke all on function public.manage_saved_search(text, text) from public;
revoke all on function public.manage_saved_search(text, text) from anon, authenticated;
grant execute on function public.manage_saved_search(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 7. ‏RLS ומדף הלידים
--
-- ‏saved_searches מכילה שם, טלפון ואימייל של אדם פרטי. כמו ב-rss_leads
-- וב-mortgage_leads, anon נשלל מהטבלה לגמרי ולא נשענים על RLS בלבד —
-- מבקר/ת באתר קורא/ת רק את ה-view, וכותב/ת רק דרך Edge Function.
-- ---------------------------------------------------------------------------
alter table public.saved_searches      enable row level security;
alter table public.saved_search_alerts enable row level security;

revoke select on public.saved_searches      from anon;
revoke select on public.saved_search_alerts from anon;

drop policy if exists "platform admin manage saved searches" on public.saved_searches;
create policy "platform admin manage saved searches"
  on public.saved_searches for all
  using (exists (
    select 1 from public.agency_members
     where agency_members.user_id = (select auth.uid())
       and agency_members.is_platform_admin = true))
  with check (exists (
    select 1 from public.agency_members
     where agency_members.user_id = (select auth.uid())
       and agency_members.is_platform_admin = true));

-- מי שקנה/תה את הליד רואה את השורה המלאה, כולל שם וטלפון.
drop policy if exists "buyer reads purchased saved search" on public.saved_searches;
create policy "buyer reads purchased saved search"
  on public.saved_searches for select
  using (sold_to_agent_id is not null and sold_to_agent_id = public.current_agent_id());

-- אין policy של insert/update לאף אחד מלבד מנהל/ת הפלטפורמה: הכתיבה כולה
-- עוברת ב-service_role מתוך ה-Edge Functions.
drop policy if exists "platform admin reads saved search alerts" on public.saved_search_alerts;
create policy "platform admin reads saved search alerts"
  on public.saved_search_alerts for select
  using (exists (
    select 1 from public.agency_members
     where agency_members.user_id = (select auth.uid())
       and agency_members.is_platform_admin = true));

-- ‏7א. ציון ההתעניינות
--
-- ‏מה שסוכן/ת קונה כאן אינו "פנייה" אלא כוונה מוכחת, ולכן הציון בנוי משלושה
-- דברים שאפשר לאמת: כמה החיפוש מוגדר (מי שכתב/ה תקציב ואזור יודע/ת מה
-- הוא/היא רוצה), כמה הוא חי (קליקים על התראות), וכמה הוא טרי.
--
-- הדעיכה בזמן היא החלק החשוב: מחפש/ת דירה שהגדיר/ה חיפוש לפני חודשיים
-- ולא לחצ/ה על כלום כנראה כבר קנה/תה. ליד כזה לא צריך לעלות אותו דבר.
create or replace function public.saved_search_intent_score(p_search public.saved_searches)
returns int
language sql
stable   -- ‏stable ולא immutable: הדעיכה בזמן נשענת על now()
set search_path = ''
as $$
  select greatest(1, least(100,
      40
    + case when p_search.max_price is not null then 15 else 0 end
    + case when p_search.min_rooms is not null or p_search.max_rooms is not null then 8 else 0 end
    + case when cardinality(p_search.neighborhood_ids) > 0 then 8
           when cardinality(p_search.cities) > 0 then 4 else 0 end
    + case when p_search.contact_channel = 'both' then 6
           when p_search.phone is not null then 4 else 0 end
    -- ההתעניינות המוכחת: כל קליק על התראה שווה יותר מכל שדה שמולא בטופס
    + least(20, p_search.alerts_clicked * 7)
    -- דעיכה לפי הפעילות האחרונה: קליק אחרון, ואם לא היה — יום ההרשמה
    - case
        when coalesce(p_search.last_click_at, p_search.created_at) < now() - interval '60 days' then 30
        when coalesce(p_search.last_click_at, p_search.created_at) < now() - interval '30 days' then 18
        when coalesce(p_search.last_click_at, p_search.created_at) < now() - interval '14 days' then 8
        else 0
      end
  ))::int;
$$;

comment on function public.saved_search_intent_score(public.saved_searches) is
  'ציון התעניינות 1–100 לליד מחפש/ת דירה: כמה החיפוש מוגדר, כמה קליקים על התראות, וכמה הוא טרי. דועך בזמן — מי שלא לחץ/ה חודשיים כנראה כבר קנה/תה.';

revoke all on function public.saved_search_intent_score(public.saved_searches) from public;
revoke all on function public.saved_search_intent_score(public.saved_searches) from anon;

-- ‏authenticated חייב את ההרשאה הזו, גם ש-saved_search_leads_public הוא view
-- של הבעלים: PostgreSQL בודק הרשאת EXECUTE על פונקציה מול המשתמש/ת הקורא/ת
-- ולא מול בעל ה-view — בניגוד לבדיקת ההרשאות על הטבלאות שמאחוריו. בלי
-- ה-grant הזה כל טעינה של המדף ב-CRM הייתה נופלת על
-- "permission denied for function saved_search_intent_score".
--
-- אין כאן דליפה: הפונקציה מקבלת שורת saved_searches כארגומנט, ואת השורות
-- עצמן authenticated אינו יכול לקרוא. חישוב ציון על ערכים שהקורא/ת המציא/ה
-- בעצמו/ה אינו מגלה דבר.
grant execute on function public.saved_search_intent_score(public.saved_searches) to authenticated;

-- ‏7ב. המדף
--
-- ‏View ללא security_invoker, בדיוק כמו rss_leads_public ו-mortgage_leads_public:
-- הוא רץ בהרשאות הבעלים ולכן חושף את הקריטריונים בלי לתת גישה לטבלה עצמה.
-- ה-linter של Supabase מסמן את התבנית כ-"Security Definer View" — כאן זה
-- מכוון, וזו בדיוק המטרה.
--
-- ‏שלושה תנאים לכניסה למדף, וכולם עקרוניים:
--   ‏· consent_agent_contact — בלי אישור מפורש ליצירת קשר אין ליד. מי שרצה/תה
--     רק התראות מקבל/ת רק התראות; הפרטים שלו/ה לא נמכרים.
--   ‏· status <> 'unsubscribed' — מי שביקש/ה להפסיק ביקש/ה להפסיק.
--   ‏· ציון התעניינות מעל הרף — ליד מת אינו מלאי.
create or replace view public.saved_search_leads_public as
select
  s.id,
  s.label,
  s.deal_type,
  s.category,
  s.cities,
  s.neighborhood_ids,
  s.property_types,
  s.min_price,
  s.max_price,
  s.min_rooms,
  s.max_rooms,
  s.min_size_sqm,
  s.required_features,
  s.free_text,
  s.alerts_sent,
  s.alerts_clicked,
  s.last_click_at,
  s.lead_status,
  s.created_at,
  public.saved_search_intent_score(s) as intent_score,
  -- מה הסוכן/ת יקבל/י אחרי הרכישה, בלי לחשוף אותו עכשיו
  (s.phone is not null) as has_phone,
  (s.email is not null) as has_email
  from public.saved_searches s
 where s.consent_agent_contact = true
   and s.status <> 'unsubscribed'
   and s.lead_status in ('new','sold')
   and public.saved_search_intent_score(s) >=
       coalesce((select value::int from public.pricing_config
                  where key = 'saved_search_lead_min_intent'), 45);

comment on view public.saved_search_leads_public is
  'מדף לידי מחפשי הדירה — הקריטריונים וציון ההתעניינות בלבד, בלי שם, טלפון או אימייל. רק חיפושים שבהם ניתן אישור מפורש ליצירת קשר.';

-- ‏מלאי מקצועי בתוך ה-CRM ולא ויטרינה פומבית, בדיוק כמו mortgage_leads_public:
-- ‏authenticated בלבד.
revoke all on public.saved_search_leads_public from anon;
grant select on public.saved_search_leads_public to authenticated;

-- ‏7ג. יומן הרכישות
create table if not exists public.saved_search_lead_purchases (
  id         uuid primary key default gen_random_uuid(),
  search_id  uuid not null unique references public.saved_searches(id) on delete cascade,
  agent_id   uuid not null references public.agency_members(id) on delete cascade,
  agency_id  uuid references public.agencies(id) on delete set null,
  amount     numeric(10,2) not null check (amount >= 0),
  intent_score smallint,
  status     text not null default 'success' check (status in ('success','refunded')),
  payment_method text not null default 'balance',
  created_at timestamptz not null default now()
);

comment on table public.saved_search_lead_purchases is
  'רכישות לידי מחפשי דירה. unique(search_id) מונע מכירה כפולה גם אם שתי בקשות רצות במקביל.';
comment on column public.saved_search_lead_purchases.amount is
  'הסכום שחויב בפועל. לא נגזר מחדש מ-pricing_config, כדי ששינוי מחיר לא ישכתב היסטוריית חיובים.';
comment on column public.saved_search_lead_purchases.intent_score is
  'הציון ברגע הרכישה — מה שהסוכן/ת ראה/תה כשהחליט/ה לקנות, לתחקור מחלוקות בדיעבד.';

create index if not exists saved_search_lead_purchases_agent_idx
  on public.saved_search_lead_purchases (agent_id, created_at desc);

alter table public.saved_search_lead_purchases enable row level security;
revoke select on public.saved_search_lead_purchases from anon;

drop policy if exists "agent reads own saved search purchases" on public.saved_search_lead_purchases;
create policy "agent reads own saved search purchases"
  on public.saved_search_lead_purchases for select
  using (agent_id = public.current_agent_id());

drop policy if exists "platform admin reads saved search purchases" on public.saved_search_lead_purchases;
create policy "platform admin reads saved search purchases"
  on public.saved_search_lead_purchases for select
  using (exists (
    select 1 from public.agency_members
     where agency_members.user_id = (select auth.uid())
       and agency_members.is_platform_admin = true));

-- ‏7ד. הרכישה האטומית
--
-- אותה תבנית בדיוק כמו purchase_rss_lead ו-purchase_mortgage_lead: for update
-- על השורה מסדר שתי רכישות מקבילות בטור, והפונקציה נעולה ל-service_role כי
-- הטריגר protect_sensitive_agency_member_fields מתעלם משינוי credit_balance
-- שלא הגיע משם — חיוב מהדפדפן היה נבלע בשקט והליד היה נמכר בחינם.
create or replace function public.purchase_saved_search_lead(p_search_id uuid, p_agent_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_search public.saved_searches%rowtype;
  v_agent  public.agency_members%rowtype;
  v_price  numeric;
  v_score  int;
  v_rows   int;
begin
  select * into v_search from public.saved_searches where id = p_search_id for update;
  if not found then
    return jsonb_build_object('error', 'lead_not_found');
  end if;

  -- לחיצה חוזרת של הקונה עצמו/ה מחזירה את הסחורה בלי לחייב שוב
  if v_search.lead_status = 'sold' then
    if v_search.sold_to_agent_id = p_agent_id then
      return jsonb_build_object(
        'success', true, 'already_purchased', true, 'price_charged', 0,
        'full_name', v_search.full_name, 'phone', v_search.phone,
        'email', v_search.email, 'label', v_search.label,
        'free_text', v_search.free_text);
    end if;
    return jsonb_build_object('error', 'lead_already_sold');
  end if;

  if v_search.lead_status <> 'new' then
    return jsonb_build_object('error', 'lead_not_available');
  end if;

  -- ההסכמה נבדקת כאן ולא רק ב-view: ה-view הוא תצוגה, וזו ההגנה.
  if v_search.consent_agent_contact is not true or v_search.status = 'unsubscribed' then
    return jsonb_build_object('error', 'lead_not_available');
  end if;

  select * into v_agent from public.agency_members where id = p_agent_id and active = true;
  if not found then
    return jsonb_build_object('error', 'agent_not_found');
  end if;

  select value into v_price from public.pricing_config where key = 'saved_search_lead_price';
  v_price := coalesce(v_price, 60);
  v_score := public.saved_search_intent_score(v_search);

  if v_price > 0 then
    update public.agency_members
       set credit_balance = credit_balance - v_price
     where id = p_agent_id and credit_balance >= v_price;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      return jsonb_build_object('error', 'insufficient_balance',
                                'required', v_price, 'balance', v_agent.credit_balance);
    end if;
  end if;

  update public.saved_searches
     set lead_status = 'sold', sold_at = now(), sold_to_agent_id = p_agent_id
   where id = p_search_id and lead_status = 'new';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    -- לא אמור לקרות — השורה נעולה מתחילת הפונקציה. אם בכל זאת, raise מגלגל
    -- אחורה גם את ניכוי הארנק, ולכן אסור להחזיר כאן jsonb של שגיאה.
    raise exception 'saved_search_lead_purchase_race' using errcode = '40001';
  end if;

  insert into public.saved_search_lead_purchases
    (search_id, agent_id, agency_id, amount, intent_score, status, payment_method)
  values (p_search_id, p_agent_id, v_agent.agency_id, v_price, v_score, 'success', 'balance');

  return jsonb_build_object(
    'success', true,
    'price_charged', v_price,
    'balance', v_agent.credit_balance - v_price,
    'full_name', v_search.full_name,
    'phone', v_search.phone,
    'email', v_search.email,
    'label', v_search.label,
    'free_text', v_search.free_text);
end;
$$;

comment on function public.purchase_saved_search_lead(uuid, uuid) is
  'רכישת ליד מחפש/ת דירה: ניכוי מהארנק, סימון הליד כנמכר ורישום ביומן — טרנזקציה אחת. ל-service_role בלבד, דרך ה-Edge Function saved-search-lead-purchase.';

revoke all on function public.purchase_saved_search_lead(uuid, uuid) from public;
revoke all on function public.purchase_saved_search_lead(uuid, uuid) from anon;
revoke all on function public.purchase_saved_search_lead(uuid, uuid) from authenticated;
grant execute on function public.purchase_saved_search_lead(uuid, uuid) to service_role;

-- ‏7ה. הנכסים שכבר נשלחו למחפש/ת — הראיה שהסוכן/ת קונה בשבילה
--
-- אחרי הרכישה שווה לדעת *על מה* הליד לחץ. זו שיחת הפתיחה הטובה ביותר
-- שיש: "ראיתי שהתעניינת בדירה ברחוב X". מוגבלת לקונה בלבד.
create or replace function public.saved_search_lead_activity(p_search_id uuid)
returns table (
  property_id uuid,
  title       text,
  price       numeric,
  city        text,
  street      text,
  rooms       numeric,
  sent_at     timestamptz,
  clicked_at  timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.title, p.price, p.city, p.street, p.rooms::numeric, a.sent_at, a.clicked_at
    from public.saved_search_alerts a
    join public.properties     p on p.id = a.property_id
    join public.saved_searches s on s.id = a.search_id
   where a.search_id = p_search_id
     and a.status = 'sent'
     and s.sold_to_agent_id is not null
     and s.sold_to_agent_id = public.current_agent_id()
   order by (a.clicked_at is not null) desc, a.sent_at desc
   limit 50;
$$;

comment on function public.saved_search_lead_activity(uuid) is
  'הנכסים שנשלחו למחפש/ת, ומה מתוכם נלחץ. לקונה הליד בלבד — זו שיחת הפתיחה שהוא/היא שילמ/ה עליה.';

revoke all on function public.saved_search_lead_activity(uuid) from public;
revoke all on function public.saved_search_lead_activity(uuid) from anon;
grant execute on function public.saved_search_lead_activity(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. תזמון
--
-- ‏שתי משימות, באותה תבנית של weekly-news-ticker-crawler שכבר רצה בפרויקט:
-- ‏pg_cron קורא ל-Edge Function דרך pg_net.
--
-- ‏"מיידי" כאן הוא עד שתי דקות. הטריגר כותב לתור ברגע שהנכס נשמר, ושרת
-- ההתראות מרוקן אותו כל שתי דקות. הבחירה בתור ולא בקריאת HTTP מתוך הטריגר
-- מכוונת: נפילה של Meta או של ספק המייל לא יכולה להפיל פרסום מודעה.
--
-- ‏ה-header עם הסוד נקרא מ-Vault. אם הסוד לא הוגדר, ה-header יוצא ריק —
-- ואז שרת ההתראות פועל בלי אימות (ראו ALERT_CRON_SECRET בתיעוד). זו בחירה
-- מכוונת כדי שהמנגנון יעבוד מיד אחרי הפריסה, וההידוק הוא צעד אחד בתיעוד.
-- ---------------------------------------------------------------------------
do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/saved-search-notify';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן — יש לתזמן את saved-search-notify בדרך אחרת';
    return;
  end if;

  perform cron.unschedule('saved-search-notify')
    where exists (select 1 from cron.job where jobname = 'saved-search-notify');
  perform cron.unschedule('saved-search-expire-alerts')
    where exists (select 1 from cron.job where jobname = 'saved-search-expire-alerts');

  perform cron.schedule('saved-search-notify', '*/2 * * * *', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1)))
    );
  $cron$, v_url));

  perform cron.schedule('saved-search-expire-alerts', '17 * * * *',
                        'select public.expire_saved_search_alerts()');
end;
$$;
