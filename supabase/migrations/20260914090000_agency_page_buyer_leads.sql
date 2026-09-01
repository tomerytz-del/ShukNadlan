-- ============================================================================
-- לידי מחפשי הנכס שנוצרו בדף המשרד
--
-- ‏agency.html מציג שלושה ווידג'טים שמייצרים לידים, וכולם צריכים לענות על
-- אותה הבטחה למנהל/ת המשרד: **מה שהדף שלכם מייצר שייך לכם.**
--
--   ‏1. הערכת השווי  → ‎owner-lead-intake‎ עם ‎agency_slug‎ ✔ (מיגרציה 20260911)
--   ‏2. מחשבון התשואה → ‎owner-lead-intake‎ עם ‎agency_slug‎ ✔ (מיגרציה 20260911)
--   ‏3. התאמת נכס     → ‎saved-search-intake‎ — וכאן ההבטחה נשברה.
--
-- באנר "מחפשים נכס? תנו לו למצוא אתכם" שומר חיפוש ב-‎saved_searches‎, ומשם
-- הוא נכנס למדף לידי מחפשי הדירה של הפלטפורמה — כלומר מוצע *לכל* הסוכנים
-- לרכישה, גם למתחרים של המשרד שבדף שבו הגולש/ת בחר/ה להשאיר פרטים. שאר
-- שני הכלים באותו דף מגיעים ישירות למנהל/ת המשרד, בחינם. אותו דף, שתי
-- התנהגויות הפוכות.
--
-- המיגרציה הזו סוגרת את הפער בשלושה שינויים:
--
--   ‏· ‎saved_searches.agency_id‎ — למי הליד שייך. ‏null = ליד פלטפורמה,
--     בדיוק כפי שהיה.
--   ‏· המדף (‏saved_search_leads_public) מדלג על חיפוש שיש לו ‎agency_id‎:
--     ליד של משרד אינו מלאי למכירה.
--   ‏· ‎create_saved_search‎ יודעת לשייך: ‎agency_id‎, ‎sold_to_agent_id‎
--     (מנהל/ת המשרד), ‎lead_status='sold'‎ ו-‎sold_at=now()‎ — אותו מצב
--     בדיוק של ליד שנרכש, ולכן הוא מופיע בתיבה של המנהל/ת ב-CRM בלי
--     שורת קוד נוספת שם, ובלי שנגבה עליו שקל.
--
-- ‏אין שורה ב-saved_search_lead_purchases. הטבלה הזו היא יומן חיובים, ולא
-- נגבה כאן תשלום: שורה בסכום 0 הייתה מזייפת רכישה שלא קרתה.
--
-- ---------------------------------------------------------------------------
-- שני דברים שהמיגרציה הזו **לא** עושה, בכוונה:
--
--   ‏· שיוך בלי הסכמה. ‎consent_agent_contact‎ הוא הקו שמפריד בין "רוצה
--     התראות" לבין "מוכן/ה שיצרו איתי קשר". מי שלא סימן/ה מקבל/ת התראות
--     ותו לא — גם בדף המשרד. הפונקציה מאפסת את השיוך כשאין הסכמה, ולא
--     סומכת על כך שהקורא כבר בדק.
--   ‏· גזילה של חיפוש קיים. חיפוש זהה של אותו טלפון מוחזר כ-‎duplicate‎,
--     כפי שהיה, ולא משנה בעלות: שורה שכבר יושבת במדף (או שכבר נרכשה) לא
--     תעבור ידיים בגלל ביקור בדף משרד.
--
-- הקובץ אידמפוטנטי.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. העמודה
-- ---------------------------------------------------------------------------
alter table public.saved_searches
  add column if not exists agency_id uuid references public.agencies(id) on delete set null;

comment on column public.saved_searches.agency_id is
  'המשרד שהחיפוש נוצר בדף שלו (ווידג''ט "מחפשים נכס" ב-agency.html). חיפוש כזה שייך למשרד: הוא אינו מוצע במדף לידי מחפשי הדירה ואינו נמכר, אלא משויך מיד למנהל/ת המשרד. null = ליד של הפלטפורמה, המסלול הרגיל.';

-- אינדקס חלקי: השאילתה היחידה שנשענת על העמודה היא "מה הדף של המשרד הזה
-- הביא", כלומר תמיד עם agency_id לא-null.
create index if not exists saved_searches_agency_idx
  on public.saved_searches (agency_id, created_at desc)
  where agency_id is not null;

-- ---------------------------------------------------------------------------
-- 2. הרשאת קריאה למנהל/ת המשרד
--
-- ‏policy "buyer reads purchased saved search" כבר מכסה את המקרה הרגיל, כי
-- השיוך נעשה דרך ‎sold_to_agent_id‎. הפוליסי הזה הוא הרשת מתחתיו: משרד
-- שמנהל/ת שלו התחלף/ה, או ליד שנוצר כשלא היה מנהל/ת פעיל/ה, עדיין נקרא/ת
-- על ידי מי שמנהל/ת את המשרד היום — ולא נעלם/ת לתיבה של אף אחד.
--
-- מנהל/ת בלבד ולא כל סוכני המשרד: השורה מכילה שם, טלפון ואימייל של אדם
-- פרטי, ואותה מדיניות בדיוק חלה על ליד בעל/ת נכס שמשויך לסוכן/ת אחד/ת.
-- ---------------------------------------------------------------------------
drop policy if exists "agency manager reads agency saved search" on public.saved_searches;
create policy "agency manager reads agency saved search"
  on public.saved_searches for select to authenticated
  using (agency_id is not null
         and agency_id = (select public.current_agency_id())
         and (select public.current_member_role()) = 'manager');

-- ---------------------------------------------------------------------------
-- 3. המדף מדלג על לידים של משרד
--
-- אותו view בדיוק, בתוספת תנאי אחד. ‏lead_status='sold'‎ כבר היה מוציא
-- אותו מהרשימה שה-CRM מציג ("פנוי" בלבד), אבל התנאי המפורש כאן הוא מה
-- שמבטיח שגם שאילתה עתידית שתסתכל על ‎sold‎ לא תציע למכירה ליד שכבר שייך
-- למשרד.
-- ---------------------------------------------------------------------------
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
  (s.phone is not null) as has_phone,
  (s.email is not null) as has_email
  from public.saved_searches s
 where s.consent_agent_contact = true
   and s.agency_id is null
   and s.status <> 'unsubscribed'
   and s.lead_status in ('new','sold')
   and public.saved_search_intent_score(s) >=
       coalesce((select value::int from public.pricing_config
                  where key = 'saved_search_lead_min_intent'), 45);

comment on view public.saved_search_leads_public is
  'מדף לידי מחפשי הדירה — הקריטריונים וציון ההתעניינות בלבד, בלי שם, טלפון או אימייל. רק חיפושים שבהם ניתן אישור מפורש ליצירת קשר, ורק כאלה שאינם שייכים למשרד (agency_id is null).';

revoke all on public.saved_search_leads_public from anon;
grant select on public.saved_search_leads_public to authenticated;

-- ---------------------------------------------------------------------------
-- 4. היצירה, עם שיוך אופציונלי למשרד
--
-- כל מה שהיה נשאר: הכנסה קודם וספירה אחר כך (התקרה וזיהוי הכפילות נשענים
-- על ‎criteria_hash‎ ועל ‎phone_e164‎ שהטריגר מחשב), אותה החזרה על כפילות,
-- ואותה ולידציה. מה שנוסף הוא שלושת השדות של השיוך — וכולם נגזרים משני
-- ערכים בלבד שהקורא שולח: ‎agency_id‎ ו-‎assigned_agent_id‎.
-- ---------------------------------------------------------------------------
create or replace function public.create_saved_search(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id      uuid;
  v_label   text;
  v_cap     int;
  v_count   int;
  v_phone   text;
  v_consent boolean := coalesce((p_payload->>'consent_agent_contact')::boolean, false);
  v_agency  uuid    := nullif(p_payload->>'agency_id', '')::uuid;
  v_agent   uuid    := nullif(p_payload->>'assigned_agent_id', '')::uuid;
begin
  -- בלי הסכמה מפורשת אין ליד — יש חיפוש עם התראות. השיוך נמחק כאן ולא
  -- נבדק אצל הקורא בלבד: זו השורה שמפרידה בין השתיים.
  if not v_consent then
    v_agency := null;
    v_agent  := null;
  end if;
  -- סוכן/ת בלי משרד אינו שיוך אלא תקלה: השיוך כולו הוא "הליד של המשרד הזה"
  if v_agency is null then
    v_agent := null;
  end if;

  begin
    insert into public.saved_searches (
      full_name, phone, email, contact_channel, label,
      deal_type, category, cities, neighborhood_ids, property_types,
      min_price, max_price, min_rooms, max_rooms,
      min_size_sqm, max_size_sqm, min_floor, max_floor,
      required_features, condition, free_text, consent_agent_contact,
      agency_id, sold_to_agent_id, lead_status, sold_at
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
      v_consent,
      v_agency,
      v_agent,
      -- ‏'sold' ולא סטטוס חדש: זה בדיוק המצב "יש לו בעלים ואינו במדף",
      -- וכל מה שקורא את הטבלה כבר יודע לקרוא אותו נכון.
      case when v_agency is not null then 'sold' else 'new' end,
      case when v_agency is not null then now() else null end
    )
    returning id, label, phone_e164 into v_id, v_label, v_phone;
  exception
    when unique_violation then
      -- אותו חיפוש בדיוק כבר שמור אצל אותו טלפון. מבחינת המחפש/ת זו הצלחה,
      -- והבעלות על השורה הקיימת אינה משתנה.
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

  return jsonb_build_object(
    'success', true,
    'search_id', v_id,
    'label', v_label,
    -- הקורא צריך לדעת אם השיוך אכן נעשה, כדי לרשום ניתוב נכון ביומן
    -- ולומר לגולש/ת למי הפרטים הגיעו
    'agency_id', v_agency,
    'assigned_agent_id', v_agent
  );
end;
$$;

comment on function public.create_saved_search(jsonb) is
  'יוצרת חיפוש שמור מהאתר. מכניסה קודם וסופרת אחר כך, כדי שהתקרה וזיהוי הכפילות יישענו על criteria_hash ועל phone_e164 שהטריגר חישב. ‏agency_id + assigned_agent_id משייכים את הליד למשרד שבדף שבו נוצר — ורק כשניתנה הסכמה מפורשת ליצירת קשר. ל-service_role בלבד, דרך saved-search-intake.';

revoke all on function public.create_saved_search(jsonb) from public;
revoke all on function public.create_saved_search(jsonb) from anon, authenticated;
grant execute on function public.create_saved_search(jsonb) to service_role;
