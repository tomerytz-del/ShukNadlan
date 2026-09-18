-- ============================================================================
-- סטטוס נכס, מניעת כפילויות ובלעדיות בין משרדים
--
-- ## מה שבור היום
--
-- **1. אין "ירד מפרסום".** ל-‏properties.status יש ארבעה ערכים בלבד —
-- ‏active/sold/rented/archived. סוכן/ת שרוצה להוריד מודעה מהאתר לשבועיים
-- (הבעלים בחו״ל, השיפוץ לא נגמר, המחיר בבדיקה) נאלץ/ת לבחור בין "נמכר"
-- שהוא שקר שנכנס ל"עסקאות אחרונות" באתר, לבין "הוסר" שנראה כמו סוף הדרך.
-- בפועל רוב הסוכנים פשוט משאירים את המודעה באוויר.
--
-- **2. אותו נכס עולה עשרות פעמים.** בעל/ת נכס מוסר/ת את אותה דירה לחמישה
-- משרדים, וחמש מודעות זהות עולות לאתר. הגולש/ת רואה את אותה דירה חמש פעמים
-- במחירים שונים במקצת, מתקשר/ת לחמישה סוכנים, ואיכות התוצאות בחיפוש נהרסת.
-- בדיקת הכפילות שכבר קיימת ב-CRM (‏findPropertyDuplicate) רצה **רק על
-- הנכסים של הסוכן/ת עצמו/ה** — ‏RLS ממילא לא מראה לה אחרים — ולכן היא לא
-- רואה את הכפילות האמיתית, זו שבין משרדים.
--
-- **3. אין מקום לבלעדיות.** ‏agreements כבר יודעת להחתים על בלעדיות
-- (‏kind = exclusive_sell / exclusive_landlord, עם exclusive_from/until),
-- אבל ההסכם החתום לא עושה דבר: הוא לא מונע ממישהו אחר לפרסם את אותו נכס,
-- ולא מוריד מודעה קודמת מהאתר.
--
-- ## מה נכנס כאן
--
-- **הסטטוס `unpublished`** — "ירד מפרסום". כמו archived הוא אינו נקרא על
-- ידי אנונימי/ת (ה-policy הקיימת מחזירה status='active' בלבד), אבל הוא
-- אומר דבר אחר: המודעה חיה, היא פשוט לא באוויר עכשיו.
--
-- **מפתח זהות לנכס** — ‏`property_dedupe_key(city, street, house_number,
-- rooms, floor, deal_type)`. ‏IMMUTABLE, ולכן משמש גם כאינדקס חלקי על
-- הנכסים הפעילים. אין כאן עמודה שמורה בכוונה: עמודה מחושבת הייתה מחייבת
-- שכתוב של הטבלה ובקאפיל שמפעיל את שבעה־עשר הטריגרים האחרים של properties.
--
-- **זהות הבעלים** — ‏`property_owner_key(owner_phone)`, תשע הספרות
-- האחרונות של הטלפון. שתי דירות באותה קומה עם אותו מספר חדרים הן מקרה
-- אמיתי ונפוץ (דירה 5 ודירה 6), ולכן הכתובת לבדה אינה מספיקה: הכפילות
-- נחסמת רק כששני הנכסים מצביעים על **אותם בעלים**, או כשלאחד מהם אין
-- בעלים רשומים בכלל.
--
-- **הטריגר `properties_guard_duplicate`** — ‏BEFORE INSERT OR UPDATE.
-- מודעה נכנסת ל-‎status='active'‎ רק אם אין באוויר מודעה אחרת לאותו נכס
-- ואותם בעלים, ורק אם אין בלעדיות חיה של משרד אחר. זו נקודת האכיפה
-- היחידה — הבדיקות ב-CRM הן נוחות, לא גבול.
--
-- **`property_exclusivities`** — שורה אחת חיה לכל מפתח זהות, שנוצרת רק
-- דרך ‎claim_property_exclusivity()‎ ורק על סמך הסכם בלעדיות **חתום**
-- שקיים במערכת. בלעדיות חדשה גוברת: הרשומה הקודמת משתחררת, המודעות של
-- המשרדים האחרים יורדות ל-‎unpublished‎, וכל סוכן/ת שמודעתו/ה ירדה מקבל/ת
-- התראה עם שם המתווך/ת החדש/ה ועד מתי הבלעדיות בתוקף.
--
-- **מה לא נאמר למי שאינו בעל/ת הבלעדיות:** תאריך הסיום. סוכן/ת שמנסה
-- להחזיר לפרסום נכס שנמצא בבלעדיות של אחר/ת מקבל/ת את שם המתווך/ת ואת שם
-- המשרד בלבד — מי שיודע/ת מתי הבלעדיות נגמרת יודע/ת מתי לחזור לבעלים,
-- ומידע מסחרי כזה אינו שלו/ה.
--
-- הסיפור המלא, כולל הסדר שבו ה-CRM יוצר נכס חדש ולמה:
-- ‏docs/property-status-exclusivity.md
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. הסטטוס החדש
-- ---------------------------------------------------------------------------
alter table public.properties drop constraint if exists properties_status_check;
alter table public.properties add constraint properties_status_check
  check (status in ('active', 'unpublished', 'sold', 'rented', 'archived'));

comment on column public.properties.status is
  'active = באוויר · unpublished = ירד מפרסום זמנית · sold/rented = עסקה נסגרה · archived = ארכיון. רק active נקרא על ידי אנונימי/ת.';

-- ---------------------------------------------------------------------------
-- 2. מפתחות הזהות
--
-- ‏property_text_key מנרמלת טקסט חופשי בדיוק כמו propNormText ב-crm.html:
-- ‏"רח׳ העלייה 20" ו-"העליה  20" הם אותה כתובת. שתיהן חייבות להישאר זהות —
-- בדיקה בדפדפן שמנרמלת אחרת מהמסד מציגה "אין כפילות" ואז נופלת בשמירה.
-- ---------------------------------------------------------------------------
create or replace function public.property_text_key(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    btrim(
      regexp_replace(
        regexp_replace(
          regexp_replace(lower(coalesce(p_value, '')), '^[[:space:]]*(רחוב|רח[׳'']?)[[:space:]]+', ''),
          '[''"׳״,.\-]', '', 'g'),
        '[[:space:]]+', ' ', 'g')),
    '');
$$;

comment on function public.property_text_key(text) is
  'נרמול טקסט להשוואת כתובות. תאום מדויק של propNormText ב-crm.html — שינוי כאן מחייב שינוי שם.';

/* מפתח הזהות של נכס. ‏null = אי אפשר לקבוע זהות (אין עיר/רחוב/מספר בית),
   ואז אין חסימה: עדיף מודעה כפולה מחסימת מודעה תקינה שכתובתה חלקית. */
create or replace function public.property_dedupe_key(
  p_city text, p_street text, p_house_number text,
  p_rooms numeric, p_floor integer, p_deal_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when public.property_text_key(p_city) is null
      or public.property_text_key(p_street) is null
      or public.property_text_key(p_house_number) is null
    then null
    else public.property_text_key(p_city)
      || '|' || public.property_text_key(p_street)
      || '|' || public.property_text_key(p_house_number)
      || '|' || coalesce(trim_scale(p_rooms)::text, '')
      || '|' || coalesce(p_floor::text, '')
      || '|' || coalesce(p_deal_type, '')
  end;
$$;

comment on function public.property_dedupe_key(text, text, text, numeric, integer, text) is
  'זהות הנכס הפיזי: עיר|רחוב|מספר בית|חדרים|קומה|סוג עסקה. ‏null כשהכתובת חלקית מכדי לזהות.';

/* תשע ספרות אחרונות: ‏050-1234567‎, ‏+972501234567‎ ו-‏0501234567‎ הם אותו
   אדם. פחות מתשע ספרות אינו טלפון שאפשר לזהות לפיו. */
create or replace function public.property_owner_key(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when length(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')) < 9 then null
    else right(regexp_replace(p_phone, '[^0-9]', '', 'g'), 9)
  end;
$$;

comment on function public.property_owner_key(text) is
  'זהות בעל/ת הנכס לצורך השוואה בלבד — תשע ספרות אחרונות של הטלפון.';

-- האינדקס שעליו רצה בדיקת הכפילות. חלקי על active: רק מודעה באוויר חוסמת.
create index if not exists properties_dedupe_key_active_idx
  on public.properties (
    public.property_dedupe_key(city, street, house_number, rooms, floor, deal_type))
  where status = 'active';

-- ---------------------------------------------------------------------------
-- 3. טבלת הבלעדיות
--
-- שורה חיה אחת לכל מפתח זהות (האינדקס הייחודי החלקי). שחרור הוא
-- ‏released_at ולא מחיקה: מי החזיק בלעדיות על הנכס ומתי היא עברה לאחר/ת הוא
-- בדיוק מה שנשאל כשיש מחלוקת.
-- ---------------------------------------------------------------------------
create table if not exists public.property_exclusivities (
  id           uuid primary key default gen_random_uuid(),
  dedupe_key   text not null,
  property_id  uuid not null references public.properties(id)      on delete cascade,
  agency_id    uuid not null references public.agencies(id)        on delete cascade,
  agent_id     uuid not null references public.agency_members(id)  on delete cascade,
  agreement_id uuid          references public.agreements(id)      on delete set null,

  starts_on    date not null default current_date,
  ends_on      date not null,

  released_at     timestamptz,
  released_reason text,

  created_at   timestamptz not null default now(),

  constraint property_exclusivities_range check (starts_on <= ends_on)
);

create unique index if not exists property_exclusivities_live_key_idx
  on public.property_exclusivities (dedupe_key)
  where released_at is null;

create index if not exists property_exclusivities_agent_idx
  on public.property_exclusivities (agent_id, created_at desc);

create index if not exists property_exclusivities_property_idx
  on public.property_exclusivities (property_id);

comment on table public.property_exclusivities is
  'בלעדיות חיה על נכס פיזי (dedupe_key). נוצרת רק דרך claim_property_exclusivity() ורק מול הסכם בלעדיות חתום.';
comment on column public.property_exclusivities.released_at is
  'שוחררה — בלעדיות חדשה גברה עליה, או שהסוכן/ת ויתר/ה. לא נמחקת: זו ההיסטוריה שנשאלת במחלוקת.';

alter table public.property_exclusivities enable row level security;

/* קריאה למי שהבלעדיות נוגעת לו/ה: בעל/ת הבלעדיות ומשרדו/ה. מי שהנכס שלו/ה
   נחסם רואה את שם המחזיק/ה דרך ‎property_listing_context()‎ בלבד — שם, בלי
   התאריכים. */
drop policy if exists "agent reads own exclusivities" on public.property_exclusivities;
create policy "agent reads own exclusivities" on public.property_exclusivities
  for select using (
    agent_id = public.current_agent_id()
    or agency_id = public.current_agency_id()
  );

-- ---------------------------------------------------------------------------
-- 4. ההתראה לסוכן/ת שמודעתו/ה ירדה
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('new_lead','system','review_request','review_alert','client_match',
                  'review_new','deal_closed','lead_unrouted','marketing_copy',
                  'agreement_signed','platform_signup','platform_upgrade',
                  'onboarding_property','onboarding_client','onboarding_agreement',
                  'onboarding_lead','exclusivity_taken'));

-- ---------------------------------------------------------------------------
-- 5. הטריגר — נקודת האכיפה היחידה
--
-- ‏SECURITY DEFINER כי הוא חייב לקרוא את ‎property_owners‎ של משרדים אחרים,
-- ש-RLS מסתירה. הוא **אינו** מסתמך על שום בדיקה בדפדפן.
-- ---------------------------------------------------------------------------
create or replace function public.properties_guard_duplicate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
   order by p.created_at
   limit 1;

  if found then
    if v_other.same_agency then
      raise exception 'הנכס כבר מפורסם במשרד שלכם על ידי % (מודעה #%). אין צורך במודעה שנייה.',
        v_other.agent_name, coalesce(v_other.listing_number::text, '—')
        using hint = 'duplicate_same_agency', errcode = 'P0001';
    end if;
    raise exception 'הנכס כבר מפורסם במערכת על ידי % ממשרד %. אפשר לפרסם אותו רק על סמך הסכם בלעדיות חתום.',
      v_other.agent_name, v_other.agency_name
      using hint = 'duplicate_elsewhere', errcode = 'P0001';
  end if;

  return new;
end;
$$;

comment on function public.properties_guard_duplicate() is
  'חוסמת מעבר ל-status=active כשהנכס כבר באוויר אצל אחר/ת או נמצא בבלעדיות של משרד אחר.';

drop trigger if exists properties_guard_duplicate on public.properties;
create trigger properties_guard_duplicate
  before insert or update on public.properties
  for each row execute function public.properties_guard_duplicate();

-- ---------------------------------------------------------------------------
-- 6. בדיקת זמינות לפני פרסום — מה ה-CRM מציג
--
-- שתי פונקציות, אותה שאלה בשני רגעים: ‎check_property_availability‎ לנכס
-- שעוד לא קיים (טופס "הוספת נכס"), ו-‎property_listing_context‎ לנכס קיים
-- (בלוק הסטטוס בכרטיס). שתיהן SECURITY DEFINER כדי לראות מעבר ל-RLS,
-- ושתיהן מחזירות **שמות בלבד** על נכס של אחר/ת: לא מזהה, לא טלפון, ולא
-- תאריך סיום של בלעדיות שאינה שלך.
-- ---------------------------------------------------------------------------
create or replace function public.check_property_availability(
  p_city text, p_street text, p_house_number text,
  p_rooms numeric default null, p_floor integer default null,
  p_deal_type text default null, p_owner_phone text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent     uuid := public.current_agent_id();
  v_agency    uuid := public.current_agency_id();
  v_key       text;
  v_owner_key text := public.property_owner_key(p_owner_phone);
  v_holder    record;
  v_other     record;
begin
  if v_agent is null then
    raise exception 'לא מחובר/ת' using hint = 'not_authenticated', errcode = 'P0001';
  end if;

  v_key := public.property_dedupe_key(p_city, p_street, p_house_number, p_rooms, p_floor, p_deal_type);
  if v_key is null then
    return jsonb_build_object('state', 'unknown');
  end if;

  select e.agency_id, e.ends_on,
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

  if found and v_holder.agency_id is distinct from v_agency then
    return jsonb_build_object(
      'state',       'exclusive_elsewhere',
      'agent_name',  v_holder.agent_name,
      'agency_name', v_holder.agency_name);
  end if;

  select p.id, p.listing_number, p.status,
         (p.agent_id = v_agent)   as mine,
         (p.agency_id = v_agency) as same_agency,
         coalesce(m.display_name, 'מתווך/ת') as agent_name,
         coalesce(a.name, 'משרד אחר')        as agency_name
    into v_other
    from public.properties p
    join public.agency_members m on m.id = p.agent_id
    left join public.agencies   a on a.id = p.agency_id
    left join lateral (
      select public.property_owner_key(po.owner_phone) as owner_key
        from public.property_owners po where po.property_id = p.id
    ) o on true
   where p.status = 'active'
     and public.property_dedupe_key(
           p.city, p.street, p.house_number, p.rooms, p.floor, p.deal_type) = v_key
     and (v_owner_key is null or o.owner_key is null or o.owner_key = v_owner_key)
   order by (p.agent_id = v_agent) desc, p.created_at
   limit 1;

  if not found then
    return jsonb_build_object('state', 'clear');
  end if;

  if v_other.mine then
    -- הכפילות של הסוכן/ת עם עצמו/ה — הזרימה הקיימת ב-CRM מטפלת בה
    return jsonb_build_object(
      'state', 'mine',
      'property_id', v_other.id,
      'listing_number', v_other.listing_number);
  end if;

  return jsonb_build_object(
    'state',          case when v_other.same_agency then 'duplicate_same_agency' else 'duplicate_elsewhere' end,
    'agent_name',     v_other.agent_name,
    'agency_name',    v_other.agency_name,
    'listing_number', case when v_other.same_agency then v_other.listing_number else null end);
end;
$$;

revoke all on function public.check_property_availability(text, text, text, numeric, integer, text, text)
  from public, anon;
grant execute on function public.check_property_availability(text, text, text, numeric, integer, text, text)
  to authenticated;

comment on function public.check_property_availability(text, text, text, numeric, integer, text, text) is
  'האם מותר לפרסם את הנכס הזה — לפני שהוא נוצר. מחזירה שמות בלבד על נכס של משרד אחר.';

/* ההקשר של נכס קיים: מה הבלעדיות שלי עליו, מי חוסם אותו, והאם יש הסכם
   בלעדיות חתום שאפשר לתבוע על פיו. זה מה שמזין את בלוק הסטטוס בכרטיס. */
create or replace function public.property_listing_context(p_property_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent   uuid := public.current_agent_id();
  v_agency  uuid := public.current_agency_id();
  v_prop    record;
  v_key     text;
  v_holder  record;
  v_other   record;
  v_agree   record;
  v_mine    boolean := false;
  v_owner_key text;
begin
  if v_agent is null then
    raise exception 'לא מחובר/ת' using hint = 'not_authenticated', errcode = 'P0001';
  end if;

  select p.* into v_prop from public.properties p where p.id = p_property_id;
  if not found then
    raise exception 'הנכס לא נמצא' using hint = 'property_not_found', errcode = 'P0001';
  end if;
  if v_prop.agent_id <> v_agent and v_prop.agency_id is distinct from v_agency then
    raise exception 'הנכס אינו שלך' using hint = 'not_your_property', errcode = 'P0001';
  end if;

  v_key := public.property_dedupe_key(
    v_prop.city, v_prop.street, v_prop.house_number, v_prop.rooms, v_prop.floor, v_prop.deal_type);

  if v_key is null then
    return jsonb_build_object('state', 'unknown', 'status', v_prop.status);
  end if;

  select e.agency_id, e.ends_on,
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

  v_mine := found and v_holder.agency_id is not distinct from v_agency;

  -- הסכם בלעדיות חתום ובתוקף שמכסה את הנכס הזה — מה שמאפשר לתבוע בלעדיות
  select g.id, g.exclusive_until
    into v_agree
    from public.agreements g
   where g.agent_id = v_agent
     and g.status = 'signed'
     and g.kind in ('exclusive_sell', 'exclusive_landlord')
     and g.exclusive_until is not null
     and g.exclusive_until >= current_date
     and p_property_id = any(g.property_ids)
   order by g.exclusive_until desc
   limit 1;

  if v_mine then
    return jsonb_build_object(
      'state',   'exclusive_mine',
      'status',  v_prop.status,
      'ends_on', v_holder.ends_on,
      'agent_name', v_holder.agent_name,
      'signed_agreement_id', v_agree.id,
      'signed_until', v_agree.exclusive_until);
  end if;

  if v_holder.agency_id is not null then
    return jsonb_build_object(
      'state',       'exclusive_elsewhere',
      'status',      v_prop.status,
      'agent_name',  v_holder.agent_name,
      'agency_name', v_holder.agency_name,
      'signed_agreement_id', v_agree.id,
      'signed_until', v_agree.exclusive_until);
  end if;

  select public.property_owner_key(o.owner_phone) into v_owner_key
    from public.property_owners o where o.property_id = p_property_id;

  select coalesce(m.display_name, 'מתווך/ת') as agent_name,
         coalesce(a.name, 'משרד אחר')        as agency_name,
         (p.agency_id = v_agency)            as same_agency,
         p.listing_number
    into v_other
    from public.properties p
    join public.agency_members m on m.id = p.agent_id
    left join public.agencies   a on a.id = p.agency_id
    left join lateral (
      select public.property_owner_key(po.owner_phone) as owner_key
        from public.property_owners po where po.property_id = p.id
    ) o on true
   where p.status = 'active'
     and p.id <> p_property_id
     and public.property_dedupe_key(
           p.city, p.street, p.house_number, p.rooms, p.floor, p.deal_type) = v_key
     and (v_owner_key is null or o.owner_key is null or o.owner_key = v_owner_key)
   order by p.created_at
   limit 1;

  if found then
    return jsonb_build_object(
      'state',       case when v_other.same_agency then 'duplicate_same_agency' else 'duplicate_elsewhere' end,
      'status',      v_prop.status,
      'agent_name',  v_other.agent_name,
      'agency_name', v_other.agency_name,
      'listing_number', case when v_other.same_agency then v_other.listing_number else null end,
      'signed_agreement_id', v_agree.id,
      'signed_until', v_agree.exclusive_until);
  end if;

  return jsonb_build_object(
    'state',  'clear',
    'status', v_prop.status,
    'signed_agreement_id', v_agree.id,
    'signed_until', v_agree.exclusive_until);
end;
$$;

revoke all on function public.property_listing_context(uuid) from public, anon;
grant execute on function public.property_listing_context(uuid) to authenticated;

comment on function public.property_listing_context(uuid) is
  'מצב הפרסום של נכס קיים: בלעדיות שלי, בלעדיות חוסמת (שם בלבד), מודעה מתחרה, והסכם בלעדיות חתום שאפשר לתבוע על פיו.';

-- ---------------------------------------------------------------------------
-- 7. תביעת בלעדיות
--
-- הדרך היחידה לפרסם נכס שכבר קיים במערכת. היא דורשת הסכם בלעדיות **חתום**
-- שקיים במערכת ומקושר לנכס — לא הצהרה ולא תיבת סימון. זה מה שמונע
-- מהמנגנון להפוך לכפתור "דרוס את המודעה של המתחרה".
-- ---------------------------------------------------------------------------
create or replace function public.claim_property_exclusivity(
  p_property_id uuid, p_agreement_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent   uuid := public.current_agent_id();
  v_agency  uuid := public.current_agency_id();
  v_prop    record;
  v_key     text;
  v_agree   record;
  v_me      record;
  v_owner_key text;
  v_superseded int := 0;
  r         record;
begin
  if v_agent is null then
    raise exception 'לא מחובר/ת' using hint = 'not_authenticated', errcode = 'P0001';
  end if;

  select p.* into v_prop from public.properties p where p.id = p_property_id;
  if not found then
    raise exception 'הנכס לא נמצא' using hint = 'property_not_found', errcode = 'P0001';
  end if;
  if v_prop.agent_id <> v_agent then
    raise exception 'הנכס אינו שלך' using hint = 'not_your_property', errcode = 'P0001';
  end if;

  v_key := public.property_dedupe_key(
    v_prop.city, v_prop.street, v_prop.house_number, v_prop.rooms, v_prop.floor, v_prop.deal_type);
  if v_key is null then
    raise exception 'כדי לרשום בלעדיות צריך שהנכס יכלול עיר, רחוב ומספר בית.'
      using hint = 'address_incomplete', errcode = 'P0001';
  end if;

  select g.id, g.exclusive_until, g.exclusive_from
    into v_agree
    from public.agreements g
   where g.agent_id = v_agent
     and g.status = 'signed'
     and g.kind in ('exclusive_sell', 'exclusive_landlord')
     and g.exclusive_until is not null
     and g.exclusive_until >= current_date
     and p_property_id = any(g.property_ids)
     and (p_agreement_id is null or g.id = p_agreement_id)
   order by g.exclusive_until desc
   limit 1;

  if not found then
    raise exception 'לא נמצא הסכם בלעדיות חתום ובתוקף על הנכס הזה. החתימו בלעדיות ונסו שוב.'
      using hint = 'exclusivity_agreement_required', errcode = 'P0001';
  end if;

  -- בלעדיות קיימת: שלי — מאריכים; של אחר/ת — נדחקת מפני ההסכם החדש
  select e.* into v_me
    from public.property_exclusivities e
   where e.dedupe_key = v_key and e.released_at is null
   for update;

  if found then
    if v_me.agent_id = v_agent and v_me.property_id = p_property_id then
      update public.property_exclusivities
         set ends_on = greatest(ends_on, v_agree.exclusive_until),
             agreement_id = v_agree.id
       where id = v_me.id;
    else
      update public.property_exclusivities
         set released_at = now(), released_reason = 'superseded'
       where id = v_me.id;
      insert into public.property_exclusivities
        (dedupe_key, property_id, agency_id, agent_id, agreement_id, starts_on, ends_on)
      values (v_key, p_property_id, v_prop.agency_id, v_agent, v_agree.id,
              coalesce(v_agree.exclusive_from, current_date), v_agree.exclusive_until);
    end if;
  else
    insert into public.property_exclusivities
      (dedupe_key, property_id, agency_id, agent_id, agreement_id, starts_on, ends_on)
    values (v_key, p_property_id, v_prop.agency_id, v_agent, v_agree.id,
            coalesce(v_agree.exclusive_from, current_date), v_agree.exclusive_until);
  end if;

  /* המודעות שיורדות. ההתראה נשלחת **לפני** העדכון כדי שהיא תתאר את המודעה
     כפי שהייתה, ולכל סוכן/ת בנפרד — התראה אחת למשרד לא מגיעה למי שהנכס
     בתיק שלו/ה. */
  select public.property_owner_key(o.owner_phone) into v_owner_key
    from public.property_owners o where o.property_id = p_property_id;

  for r in
    select p.id, p.listing_number, p.agent_id, p.street, p.house_number, p.city
      from public.properties p
      left join lateral (
        select public.property_owner_key(po.owner_phone) as owner_key
          from public.property_owners po where po.property_id = p.id
      ) o on true
     where p.status = 'active'
       and p.id <> p_property_id
       and public.property_dedupe_key(
             p.city, p.street, p.house_number, p.rooms, p.floor, p.deal_type) = v_key
       and (v_owner_key is null or o.owner_key is null or o.owner_key = v_owner_key)
  loop
    insert into public.notifications (agent_id, type, title, body)
    values (
      r.agent_id,
      'exclusivity_taken',
      'נכס עבר לבלעדיות של מתווך/ת אחר/ת',
      format('הנכס ב%s %s, %s נכנס לבלעדיות של %s ממשרד %s עד %s. המודעה שלך (#%s) ירדה מפרסום.',
             coalesce(r.street, ''), coalesce(r.house_number, ''), coalesce(r.city, ''),
             (select coalesce(display_name, 'מתווך/ת') from public.agency_members where id = v_agent),
             (select coalesce(name, 'משרד') from public.agencies where id = v_prop.agency_id),
             to_char(v_agree.exclusive_until, 'DD/MM/YYYY'),
             coalesce(r.listing_number::text, '—')));

    update public.properties set status = 'unpublished' where id = r.id;
    v_superseded := v_superseded + 1;
  end loop;

  if v_prop.status <> 'active' then
    update public.properties set status = 'active' where id = p_property_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'ends_on', v_agree.exclusive_until,
    'superseded', v_superseded);
end;
$$;

revoke all on function public.claim_property_exclusivity(uuid, uuid) from public, anon;
grant execute on function public.claim_property_exclusivity(uuid, uuid) to authenticated;

comment on function public.claim_property_exclusivity(uuid, uuid) is
  'מפרסמת נכס על סמך הסכם בלעדיות חתום: דוחקת בלעדיות קודמת, מורידה מודעות מתחרות ל-unpublished ומתריעה לסוכניהן.';

-- ---------------------------------------------------------------------------
-- 8. ויתור על בלעדיות
--
-- סוכן/ת שהבעלים חזר/ה בו/ה, או שהעסקה נסגרה — משחרר/ת את הנכס כדי
-- שהמערכת לא תחסום אחרים על סמך בלעדיות שאינה קיימת עוד בפועל.
-- ---------------------------------------------------------------------------
create or replace function public.release_property_exclusivity(p_property_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent uuid := public.current_agent_id();
  v_count int;
begin
  if v_agent is null then
    raise exception 'לא מחובר/ת' using hint = 'not_authenticated', errcode = 'P0001';
  end if;

  update public.property_exclusivities
     set released_at = now(), released_reason = 'released_by_agent'
   where property_id = p_property_id
     and agent_id = v_agent
     and released_at is null;

  get diagnostics v_count = row_count;
  return jsonb_build_object('ok', true, 'released', v_count);
end;
$$;

revoke all on function public.release_property_exclusivity(uuid) from public, anon;
grant execute on function public.release_property_exclusivity(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. בלעדיות שנחתמה — רישום אוטומטי
--
-- הסכם בלעדיות שנחתם דרך המערכת רושם את הבלעדיות לבד, אבל **רק כשאין
-- בלעדיות אחרת חיה על הנכס**. דחיקת בלעדיות של משרד אחר והורדת המודעה שלו
-- היא פעולה שהסוכן/ת עושה במודע דרך הכפתור בכרטיס, ולא תופעת לוואי של
-- חתימה.
-- ---------------------------------------------------------------------------
create or replace function public.agreements_register_exclusivity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prop record;
  v_key  text;
  pid    uuid;
begin
  if new.status <> 'signed' or new.kind not in ('exclusive_sell', 'exclusive_landlord') then
    return new;
  end if;
  if new.exclusive_until is null or new.exclusive_until < current_date then
    return new;
  end if;

  foreach pid in array new.property_ids loop
    select p.* into v_prop from public.properties p where p.id = pid and p.agent_id = new.agent_id;
    continue when not found;

    v_key := public.property_dedupe_key(
      v_prop.city, v_prop.street, v_prop.house_number, v_prop.rooms, v_prop.floor, v_prop.deal_type);
    continue when v_key is null;

    if exists (select 1 from public.property_exclusivities
                where dedupe_key = v_key and released_at is null) then
      continue;   -- יש בלעדיות חיה — הדחיקה היא פעולה מודעת, לא אוטומטית
    end if;

    insert into public.property_exclusivities
      (dedupe_key, property_id, agency_id, agent_id, agreement_id, starts_on, ends_on)
    values (v_key, pid, v_prop.agency_id, new.agent_id, new.id,
            coalesce(new.exclusive_from, current_date), new.exclusive_until)
    on conflict do nothing;
  end loop;

  return new;
end;
$$;

drop trigger if exists agreements_register_exclusivity on public.agreements;
create trigger agreements_register_exclusivity
  after insert or update of status on public.agreements
  for each row execute function public.agreements_register_exclusivity();

comment on function public.agreements_register_exclusivity() is
  'הסכם בלעדיות שנחתם רושם בלעדיות על הנכסים שלו — רק כשאין בלעדיות חיה אחרת עליהם.';
