-- ============================================================================
-- מדף מחפשי הדירה: הטקסט החופשי בלי פרטים שמזהים את הפונה
--
-- ‏saved_search_leads_public הוסתרה משם, טלפון ומייל, אבל החזירה את
-- ‏free_text כמו שהוא. הטקסט הזה הוא מה שהפונה (או גבריאלה בשמו/ה) כתב/ה,
-- ובפנייה מאינסטגרם או מפייסבוק הוא נושא את שם המשתמש ברשת:
--
--     "... אישרה שסוכן יחזור אליה כשיהיה נכס כזה. (אינסטגרם shirel_19.5)"
--
-- כלומר כל סוכן/ת שפתח/ה את המדף יכול/ה היה/הייתה לפנות לפונה ישירות דרך
-- הפרופיל, בלי לרכוש את הליד. זה אותו כלל של leads_masked: מה שמתאר את
-- הצורך גלוי, מה שמזהה את האדם - רק אחרי רכישה.
--
-- ‏redact_contact_text מחליפה ב-"•••": שם משתמש אחרי שם של רשת, ‎@handle‎,
-- מילה לטינית בצורת שם משתמש (קו תחתון, ספרה בתוכה, נקודה בין אותיות),
-- קישור לפרופיל, מייל, טלפון, ואת השם של הפונה עצמו/ה (‎full_name‎, מילה
-- מילה ובגבולות מילה). שם הרשת עצמו נשאר ("(אינסטגרם •••)"): המקור גלוי
-- בכוונה. מחירים ("1.0-1.1 מיליון", "2,000,000"), חדרים ומילים לטיניות
-- רגילות ("WhatsApp") אינם נוגעים.
--
-- הטקסט המלא נשאר ב-saved_searches, ומי שרכש/ה קורא/ת אותו משם
-- (‏loadPurchasedSavedSearches) - כמו השם והטלפון.
--
-- ‏create or replace view: אותן עמודות באותו סדר, ורק הביטוי של label ושל
-- free_text השתנה. ה-view נשאר view של הבעלים (בלי security_invoker,
-- ראו 20270903090000_baseline_urgent_fixes_20261027.sql), וה-grant/revoke
-- עליו נשמרים ב-replace. הסגירה של הכתיבה חוזרת כאן בכל זאת, אידמפוטנטית.
--
-- הפונקציה טהורה (טקסט נכנס, טקסט יוצא, בלי טבלה), אבל PostgreSQL בודק
-- EXECUTE מול הקורא/ת של ה-view, ולכן authenticated חייב אותה.
-- ============================================================================

create or replace function public.redact_contact_text(p_text text, p_name text default null)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case when p_text is null then null else
  regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
  regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    -- השם של הפונה, מילה מילה. "פונה מאינסטגרם" הוא שם ברירת המחדל ואינו שם
    case when p_name is null or p_name ~ '^\s*פונה' then p_text else
      coalesce(regexp_replace(p_text,
        '(^|[^א-תA-Za-z0-9])(' || (
          select string_agg(regexp_replace(w, '([].*+?^${}()|\\[])', '\\\1', 'g'), '|')
            from regexp_split_to_table(btrim(p_name), '\s+') w
           where char_length(w) >= 2) || ')(?=$|[^א-תA-Za-z0-9])',
        '\1•••', 'gi'), p_text)
    end,
    -- מייל
    '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '•••', 'g'),
    -- קישור
    '(https?://|www\.)\S+', '•••', 'gi'),
    '(^|[^A-Za-z0-9])(instagram|facebook|fb|tiktok|t|wa|linktr)\.(com|me|ee)/\S*', '\1•••', 'gi'),
    -- שם של רשת ואחריו שם משתמש: "אינסטגרם shirel_19.5", "IG: dana"
    '(^|[^A-Za-z])(אינסטגרם|אינסטה|פייסבוק|פיסבוק|טיקטוק|טלגרם|יוזר|שם משתמש|פרופיל|instagram|insta|ig|facebook|fb|tiktok|telegram|username|user|profile)(\s*[:\-]?\s*)@?[A-Za-z0-9._]{2,}',
    '\1\2\3•••', 'gi'),
    -- ‎@handle‎
    '@[A-Za-z0-9._]{2,}', '•••', 'g'),
    -- מילה לטינית בצורת שם משתמש: קו תחתון, ספרה בתוכה, או נקודה בין אותיות
    '[A-Za-z0-9.]*_[A-Za-z0-9._]*|[A-Za-z0-9._]*[A-Za-z][A-Za-z0-9._]*[0-9][A-Za-z0-9._]*|[A-Za-z0-9._]*[0-9][A-Za-z0-9._]*[A-Za-z][A-Za-z0-9._]*|[A-Za-z0-9_]+\.[A-Za-z][A-Za-z0-9._]*',
    '•••', 'g'),
    -- טלפון: נייד, קווי, 972+, ורצף ארוך של ספרות
    '(\+?972|0)[\s.-]?(5[0-9]|7[0-9]|[2-489])([\s.-]?[0-9]){7}', '•••', 'g'),
    '[0-9]{9,}', '•••', 'g'),
    '•••([\s.,_-]*•••)+', '•••', 'g')
  end;
$$;

comment on function public.redact_contact_text(text, text) is
  'מסתירה מטקסט חופשי פרטים שמזהים את הפונה (שם משתמש ברשת, @, קישור לפרופיל, מייל, טלפון, והשם שלו/ה) לפני רכישת הליד. משמשת את saved_search_leads_public.';

revoke all on function public.redact_contact_text(text, text) from public, anon;
grant execute on function public.redact_contact_text(text, text) to authenticated, service_role;

create or replace view public.saved_search_leads_public as
select
  s.id,
  public.redact_contact_text(s.label, s.full_name) as label,
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
  public.redact_contact_text(s.free_text, s.full_name) as free_text,
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
  'מדף לידי מחפשי הדירה - הקריטריונים וציון ההתעניינות בלבד, בלי שם, טלפון או אימייל, והטקסט החופשי עובר redact_contact_text (בלי שם משתמש ברשת, קישור, טלפון או שם). רק חיפושים שבהם ניתן אישור מפורש ליצירת קשר, ורק כאלה שאינם שייכים למשרד (agency_id is null).';

revoke insert, update, delete, truncate, references, trigger
  on public.saved_search_leads_public from public, anon, authenticated;
