-- ---------------------------------------------------------------------------
-- ‏הרשמה ליריד הבתים הפתוחים (v2), הסכמה עם חותמת זמן, וערוץ להחלקה
-- (‏PR 1010, חלק 5 §9; ‏docs/open-house-fair.md, ‏docs/swipe-mode.md).
--
-- הצעה (‏docs/proposals): לא רצה. תומר מאשר ומעביר ל-supabase/migrations עם version חדש. כל מה שבה אדיטיבי:
--   1. ‏leads: ‏consent_contact_at / consent_text / consent_version - כרטיס
--      "חושבים למכור?" בהחלקה (‏owner-lead-intake) ושאר הטפסים בעתיד.
--   2. ‏saved_searches: ‏open_house_only + ההסכמה השיווקית עם חותמת זמן -
--      טופס היריד בדף ‏/open-house ובגיליון שבהחלקה (‏saved-search-intake).
--   3. התראות לחיפוש "רק יריד": נכס שאינו ביריד **עכשיו** לא נכנס לתור
--      (טריגר לפני ה-insert), ונכס שנכנס ליריד אחרי ההרשמה נכנס לתור גם
--      כשהשדות שמריצים את ההתאמה הרגילה לא השתנו (‏open_house_fair_alerts
--      ב-cron, באותו קצב של expire-open-house).
--   4. ‏lead_source_channel(): ‏nocommission_fair / swipe_fair → open_house,
--      ‏swipe* → ערוץ חדש swipe, ‏sell_page* → ערוץ חדש sell_page. הגוף הועתק
--      מהפרודקשן ב-27.10.2026 והשינוי הוא שלוש שורות בלבד.
--
-- הטופס בדפדפן נשאר כבוי (‏FAIR_SIGNUP_V2 = false ב-open-house.html
-- וב-assets/fair-signup.js) עד שהמיגרציה והפונקציות באוויר.
-- ---------------------------------------------------------------------------

-- 1) הסכמה עם חותמת זמן על הליד. ‏consent_contact_at נכתב בשרת (‏now()) ולעולם
--    לא מהדפדפן.
alter table public.leads
  add column if not exists consent_contact_at timestamptz,
  add column if not exists consent_text text,
  add column if not exists consent_version text;

comment on column public.leads.consent_contact_at is
  'מתי הפונה אישר/ה בטופס שיועץ נדל״ן יחזור אליו/ה. נכתב בשרת. ‏null - הטופס לא ביקש הסכמה מפורשת.';
comment on column public.leads.consent_text is 'הנוסח המדויק שאושר (עד 400 תווים).';
comment on column public.leads.consent_version is 'גרסת הנוסח, למשל seller-v1.';

-- 2) חיפוש "רק דירות ביריד" עם הסכמה שיווקית
alter table public.saved_searches
  add column if not exists open_house_only boolean not null default false,
  add column if not exists marketing_consent_at timestamptz,
  add column if not exists consent_text text,
  add column if not exists consent_version text;

comment on column public.saved_searches.open_house_only is
  'ההרשמה ליריד הבתים הפתוחים: התראות רק על נכסים שביריד ברגע ההתראה (‏open_house_fair_alerts).';
comment on column public.saved_searches.marketing_consent_at is
  'מתי אושרה קבלת עדכונים (וואטסאפ, SMS, אימייל). נכתב בשרת.';

create index if not exists saved_searches_open_house_only_idx
  on public.saved_searches (open_house_only) where open_house_only and status = 'active';

-- 3א) חיפוש "רק יריד" מקבל רק נכסים שביריד עכשיו. ‏generate_saved_search_alerts
--     רצה מטריגר על properties ואינה יודעת על היריד; במקום לשכתב אותה ואת
--     ‏saved_search_matches (שתיהן חיות ומשותפות לכל החיפושים) - שומר בכניסה לתור.
create or replace function public.saved_search_alerts_fair_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.saved_searches s where s.id = new.search_id and s.open_house_only)
     and not exists (
       select 1 from public.properties p
        where p.id = new.property_id
          and p.open_house
          and p.open_house_start <= now()
          and p.open_house_end > now())
  then
    return null;
  end if;
  return new;
end;
$$;

revoke all on function public.saved_search_alerts_fair_only() from public, anon, authenticated;

drop trigger if exists saved_search_alerts_fair_only on public.saved_search_alerts;
create trigger saved_search_alerts_fair_only
  before insert on public.saved_search_alerts
  for each row execute function public.saved_search_alerts_fair_only();

-- 3ב) נכס שנכנס ליריד (או שהחלון שלו נפתח) אחרי ההרשמה. כניסה ליריד אינה
--     משנה מחיר או חדרים, ולכן הטריגר של ההתאמה הרגילה לא רץ בגללה.
--     ‏on conflict - צמד חיפוש-נכס נכנס לתור פעם אחת בלבד.
create or replace function public.open_house_fair_alerts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_created int := 0;
begin
  with hits as (
    select s.id as search_id, p.id as property_id
      from public.saved_searches s
      join public.properties p
        on p.status = 'active'
       and p.open_house
       and p.open_house_start <= now()
       and p.open_house_end > now()
       and p.deal_type = s.deal_type
       and p.category = s.category
     where s.status = 'active'
       and s.open_house_only
       and greatest(coalesce(p.open_house_joined_at, p.open_house_start), p.open_house_start) > s.created_at
       and public.saved_search_matches(s, p)
  ),
  ins as (
    insert into public.saved_search_alerts (search_id, property_id)
    select h.search_id, h.property_id from hits h
    on conflict (search_id, property_id) do nothing
    returning 1
  )
  select count(*)::int into v_created from ins;
  return v_created;
end;
$$;

comment on function public.open_house_fair_alerts() is
  'מכניסה לתור התראה לכל חיפוש "רק יריד" על נכס שנכנס ליריד אחרי ההרשמה. רצה ב-cron כל 15 דקות. אינה שולחת דבר.';

revoke all on function public.open_house_fair_alerts() from public, anon, authenticated;
grant execute on function public.open_house_fair_alerts() to service_role;

-- הדקה 3 ולא 7 או 11: ‏expire-open-house (‏7) ו-open-house-notify (‏11) כבר שם
select cron.unschedule('open-house-fair-alerts')
where exists (select 1 from cron.job where jobname = 'open-house-fair-alerts');

select cron.schedule('open-house-fair-alerts', '3-59/15 * * * *', $$select public.open_house_fair_alerts()$$);

-- 4) הערוץ. הגוף מהפרודקשן (27.10.2026) + שתי שורות: היריד לפני swipe%,
--    כי swipe_fair הוא הרשמה ליריד ולא פנייה על נכס
create or replace function public.lead_source_channel(p_source text)
returns text
language sql
immutable
as $function$
  select case
    when p_source is null                       then 'other'
    when p_source like 'whatsapp\_bot%'         then 'whatsapp_bot'
    when p_source = 'rss_engine'                then 'rss_engine'
    when p_source like 'homepage%'              then 'homepage'
    when p_source = 'footer_buyer_wizard'       then 'footer'
    -- לפני property_page: ההדמיה יושבת בדף הנכס, אבל היא כלי אחר עם קהל אחר
    when p_source = 'property_page_visualization' then 'visualization'
    when p_source like 'property\_page%'        then 'property_page'
    when p_source like 'agency\_page%'
      or p_source = 'agency'                    then 'agency_page'
    when p_source like 'agent\_page%'           then 'agent_page'
    when p_source like 'project%'               then 'project_page'
    -- ההרשמה ליריד בדף ‏/open-house ובגיליון שבהחלקה
    when p_source in ('open_house_page', 'nocommission_fair', 'swipe_fair') then 'open_house'
    -- גלישה בהחלקה (פנייה, כרטיס סיום, ממומן, חושבים למכור)
    when p_source like 'swipe%'                 then 'swipe'
    -- דף "חושבים למכור?" (‏/sell)
    when p_source like 'sell\_page%'            then 'sell_page'
    when p_source like 'meta\_ads%'             then 'meta_ads'
    -- 20270806090000: גבריאלה בפייסבוק ובאינסטגרם (social-lead-intake)
    when p_source like 'facebook\_%'
      or p_source like 'instagram\_%'          then 'social'
    when p_source = 'unattributed'              then 'unattributed'
    else 'other'
  end;
$function$;
