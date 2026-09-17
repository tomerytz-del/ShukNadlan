-- ============================================================================
-- בקרת מנוע הלידים — מאיפה הלידים נכנסים, לאן הם הולכים, ומתי הם מתקררים
--
-- הלידים הם אחד ממנועי ההכנסה של הפלטפורמה, ועד היום אי אפשר היה לענות
-- מהממשק על שלוש שאלות בסיסיות:
--
--   1. **מאיפה הליד הגיע.** ‏platform_admin_monthly_report סופר לידים *לפי
--      סוג* (בעל/ת נכס, מחפש/ת דירה, משכנתא…) — כלומר לפי הקהל שהם מיועדים
--      לו. הוא אינו יודע לומר כמה מהם ייצר הבוט בוואטסאפ, כמה נכנסו מהבאנר
--      בדף הבית וכמה מהאשף בדף הנכס. זו שאלה אחרת לגמרי, ובלעדיה אי אפשר
--      לדעת איזה כלי שווה את מקומו בדף.
--   2. **מה כל משרד קיבל.** הטבלה הקיימת מציגה למשרד סוכנים, נכסים והכנסה —
--      כמה *שילם*. היא לא מציגה כמה לידים *קיבל*, ובוודאי לא מאיזה סוג.
--   3. **מה גיל הליד.** אין במערכת שום מושג של טריות. ‏untreated.oldest_days
--      מחזיר מספר אחד (הליד הישן ביותר שלא נפתח), ואין הגדרה של "חם" מול
--      "התקרר" — לא במסד, לא בקוד ולא במסמכים.
--
-- ---------------------------------------------------------------------------
-- שלוש ההחלטות המרכזיות בקובץ הזה
-- ---------------------------------------------------------------------------
--
-- **א. השדרה היא טבלאות הלידים, ו-lead_routing_log הוא ההעשרה.**
--
-- הפיתוי היה לבנות את כל הדוח מ-lead_routing_log: יש בו `source`, הוא נקי
-- מ-PII, והוא נבנה בדיוק בשביל השאלה הזו. אבל הוא **אינו מכסה את כל
-- הלידים**: רק שלוש פונקציות קליטה כותבות אליו (‏owner-lead-intake,
-- mortgage-lead-intake, saved-search-intake). ‏property-inquiry-intake,
-- agent-direct-inquiry-intake, property-visualize ו-project-lead-intake
-- אינן כותבות אליו כלל, וגם כל מה שנקלט לפני 13.9.2026 אינו שם.
--
-- ברגע כתיבת הקובץ: ‏31 שורות ב-leads מול 6 ב-lead_routing_log. דוח שנשען
-- על היומן בלבד היה מציג 6 לידים ונראה אמין לחלוטין — וזה בדיוק סוג הכשל
-- שדוח בקרה קיים כדי למנוע.
--
-- לכן `lead_spine_*` סופרות את **שורות הלידים עצמן**, בכל חמש הטבלאות,
-- ושולפות את המקור בשרשרת coalesce:
--
--     lead_routing_log.source   ← המדויק ביותר: מזהה הווידג'ט
--     → העמודה source של הטבלה  ← ‏leads.source, mortgage_leads.source…
--     → גזירה מ-lead_type       ← דטרמיניסטי: פונקציית קליטה אחת לכל סוג
--     → 'unattributed'          ← ולא ניחוש
--
-- הגזירה מ-lead_type אינה ניחוש אלא ידיעה: ‏lead_type='visualization' נוצר
-- אך ורק ב-property-visualize, שרץ אך ורק מתיבת ההדמיות בדף הנכס. אותו דבר
-- ל-property_inquiry ול-agent_direct_inquiry. מה שבאמת לא ידוע — חיפוש שמור
-- ישן, למשל — מקבל 'unattributed' ומוצג ככזה. דוח בקרה שמנחש גרוע מדוח
-- שמודה.
--
-- **ב. "ערוץ" הוא הקיבוץ, "מקור" הוא הפירוט.**
--
-- ‏lead_source_channel() ממפה 25+ מזהי מקור לתשעה ערוצים (בוט וואטסאפ, דף
-- הבית, דף הנכס, דף המשרד…). המיפוי הוא בקידומת ולא ברשימה סגורה, כדי
-- שמקור חדש ("‏homepage_xyz") ייכנס לערוץ הנכון ביום שייולד, בלי מיגרציה
-- ובלי ליפול ל"אחר" בשקט.
--
-- **ג. גיל הליד — ההגדרה שלא הייתה.**
--
-- שלושה ספים ב-pricing_config, ולא קבועים בקוד, כי הם החלטה עסקית שתשתנה
-- כשיהיו מספיק נתונים כדי לכייל אותה:
--
--   | מצב      | גיל            | המשמעות |
--   |----------|----------------|---------|
--   | חם       | עד 24 שעות     | הפונה עדיין בתוך החיפוש. זה החלון שבו שיחה נענית |
--   | פושר     | 24–72 שעות     | עדיין רלוונטי, אבל כבר לא ראשונים |
--   | מתקרר    | 3–7 ימים       | סביר שכבר דיבר/ה עם מישהו אחר |
--   | קר       | מעל 7 ימים     | מלאי, לא ליד |
--
-- **הגיל נמדד עד הנגיעה הראשונה, לא עד עכשיו.** ליד שנפתח אחרי שעתיים הוא
-- ליד חם לנצח — הוא נענה בזמן. ליד שלא נגעו בו ממשיך להזדקן, ולכן
-- ‏open_queue מחושב מול now() וממשיך לזוז כל עוד איש לא טיפל בו. "גיל
-- הליד" בלי ההבחנה הזו היה מודד את *הוותק* ולא את *התגובה*.
--
-- ---------------------------------------------------------------------------
-- למה RPC ולא view — אותה סיבה כמו בדוח החודשי
-- ---------------------------------------------------------------------------
--
-- ‏leads, saved_searches, mortgage_leads, lead_charges וכל טבלאות הרכישה
-- חסומות ב-RLS בפני מנהל/ת פלטפורמה בדיוק כמו בפני כל אחד אחר, וזה נכון:
-- שם וטלפון של פונה אינם עסק של איש מלבד הסוכן/ת שקנה/תה את הליד.
--
-- לכן הפונקציה כאן היא security definer שמחזירה **מספרים בלבד** — ספירות,
-- סכומים, ושמות משרדים שממילא פומביים דרך "public read agencies". אין בה
-- שם, טלפון, אימייל, טקסט חופשי של פנייה או מזהה ליד בודד. השורה הראשונה
-- בגוף הפונקציה היא current_is_platform_admin(), ובלעדיה היא מסרבת עם
-- ‏42501 — בדיוק כמו ה-policies שהיא עוקפת.
--
-- הקובץ אידמפוטנטי — אפשר להריץ אותו שוב.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. מדיניות טריות הליד
--
-- ב-pricing_config ולא כקבועים בקוד: אלה מספרים עסקיים שצריך יהיה לכייל
-- כשיצטברו מספיק לידים כדי למדוד מתי באמת יורד אחוז המענה. שינוי הערך כאן
-- משנה מיד גם את הדוח וגם את ההסבר שמוצג לצידו — התווית והסף לעולם לא
-- נפרדים.
--
-- ‏do nothing ולא do update: מי שכייל/ה את הסף בפרודקשן לא רוצה שהרצה
-- חוזרת של המיגרציה תחזיר אותו לברירת המחדל.
-- ---------------------------------------------------------------------------
insert into public.pricing_config (key, value, description) values
  ('lead_hot_hours', 24,
   'עד כמה שעות מהקליטה ליד נחשב חם. זה החלון שבו הפונה עדיין בתוך החיפוש והשיחה נענית'),
  ('lead_warm_hours', 72,
   'עד כמה שעות ליד נחשב פושר. מעבר לסף החם ועד כאן — עדיין רלוונטי, אבל כבר לא ראשונים'),
  ('lead_cooling_hours', 168,
   'עד כמה שעות ליד נחשב מתקרר. מעבר לסף הזה הוא קר: סביר שהפונה כבר סגר/ה עם מישהו אחר')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. הערוץ של המקור
--
-- ‏immutable כדי שהמתכנן יוכל לקרוא לה בתוך group by בלי לחשב מחדש לכל שורה,
-- ובלי לגעת בטבלה כלשהי.
--
-- המיפוי הוא **בקידומת** ולא ברשימה סגורה, וזו ההחלטה המרכזית כאן: מזהי
-- המקור נולדים בקוד של הווידג'טים (‏_shared/lead-routing.ts), לא כאן.
-- באנר חדש בדף הבית ייקרא 'homepage_משהו' ויתקבץ לערוץ הנכון ברגע שייולד.
-- רשימה סגורה הייתה מפילה אותו ל"אחר" — בשקט, ובדיוק בדוח שקיים כדי
-- לגלות כאלה.
-- ---------------------------------------------------------------------------
create or replace function public.lead_source_channel(p_source text)
returns text
language sql
immutable
as $$
  select case
    when p_source is null                       then 'other'
    when p_source like 'whatsapp\_bot%'         then 'whatsapp_bot'
    when p_source = 'rss_engine'                then 'rss_engine'
    when p_source like 'homepage%'              then 'homepage'
    when p_source = 'footer_buyer_wizard'       then 'footer'
    when p_source like 'property\_page%'        then 'property_page'
    when p_source like 'agency\_page%'
      or p_source = 'agency'                    then 'agency_page'
    when p_source like 'agent\_page%'           then 'agent_page'
    when p_source like 'project%'               then 'project_page'
    when p_source = 'open_house_page'           then 'open_house'
    when p_source = 'unattributed'              then 'unattributed'
    else 'other'
  end;
$$;

comment on function public.lead_source_channel(text) is
  'הערוץ שאליו שייך מזהה מקור הליד: whatsapp_bot · homepage · footer · property_page · agency_page · agent_page · project_page · open_house · rss_engine · unattributed · other. המיפוי בקידומת, כדי שמקור חדש ייכנס לערוץ הנכון בלי מיגרציה.';

-- ---------------------------------------------------------------------------
-- 3. טמפרטורת הליד
--
-- מקבלת גיל בשעות ואת שלושת הספים, ולא קוראת את pricing_config בעצמה:
-- כך היא immutable, והקורא קורא את ההגדרה **פעם אחת** ולא פעם לכל שורה.
-- ---------------------------------------------------------------------------
create or replace function public.lead_temperature(
  p_age_hours numeric,
  p_hot       numeric,
  p_warm      numeric,
  p_cooling   numeric
)
returns text
language sql
immutable
as $$
  select case
    when p_age_hours is null       then 'unknown'
    when p_age_hours <= p_hot      then 'hot'
    when p_age_hours <= p_warm     then 'warm'
    when p_age_hours <= p_cooling  then 'cooling'
    else 'cold'
  end;
$$;

comment on function public.lead_temperature(numeric, numeric, numeric, numeric) is
  'טמפרטורת הליד לפי גילו בשעות: hot · warm · cooling · cold. הספים נמסרים כפרמטרים (מ-pricing_config) כדי שהפונקציה תישאר immutable.';

-- ---------------------------------------------------------------------------
-- 4. הדוח
--
-- מחזירה jsonb אחד עם עשרה חלקים:
--
--   ‏range        — החלון שנבחר, בימים ובתאריכים
--   ‏policy       — שלושת ספי הטריות, כדי שהדפדפן יציג את ההגדרה ולא יקודד אותה
--   ‏totals       — מה נכנס בחלון: סך הלידים, מה נותב, מה נמכר, כמה הכניס
--   ‏by_channel[] — לפי ערוץ (הקיבוץ)
--   ‏by_source[]  — לפי מזהה מקור (הפירוט), עם פילוח הניתוב וההכנסה
--   ‏by_kind[]    — לפי קהל היעד
--   ‏trend[]      — סדרה לאורך החלון, עם פילוח לערוצים בכל דלי
--   ‏open_queue   — מה תקוע *עכשיו*, לפי טמפרטורה. לא נתון חלון
--   ‏response     — כמה מהר נוגעים בליד: חציון, ממוצע ואחוז המענה בחלון החם.
--                  נמדד **רק** על לידים שבאמת המתינו — ליד שנולד פתוח
--                  (דף משרד, דף סוכן/ת, הדמיה) מוחרג, אחרת הוא מכריז על
--                  זמן תגובה אפס למדד שלא נמדד בו כלל
--   ‏agencies[]   — כמה לידים כל משרד קיבל בחלון, מאיזה סוג, וכמה שילם
--
-- הגדרות שחשוב שיהיו כתובות ולא משתמעות:
--   ‏· "נקלט" נמדד לפי created_at של הליד, תמיד. גם ליד שנמכר חודש אחר כך
--     שייך לחודש שבו נכנס — אחרת "כמה הביא הבאנר במרץ" משתנה למפרע.
--   ‏· ההכנסה משויכת ל**ליד** ולא לרכישה: ליד שנקלט בחלון והכניס ₪50 נספר
--     כאן גם אם נקנה אחרי החלון. זו השאלה "כמה שווה הערוץ", ולא "כמה נכנס
--     לקופה החודש" — לזו יש כבר את הדוח החודשי.
--   ‏· ליד RSS נספר רק כש-is_lead. פוסט שסווג כספאם או כמתווך אינו ליד.
--   ‏· ‏no_consent אינו כשל: הפונה ביקש/ה התראות בלבד. הוא מוצג בנפרד
--     ואינו נספר כ"תקוע".
--   ‏· התור הפתוח מדלג על no_consent מאותה סיבה — אין מה לטפל בו.
--   ‏· במשרד, "קיבל" = שויך ישירות + נרכש מהמדף. פתיחת ליד ששויך ממילא
--     אינה ליד *נוסף*, ולכן היא נספרת כ"נפתחו" ולא כקבלה שנייה.
-- ---------------------------------------------------------------------------
create or replace function public.platform_lead_report(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days    integer := least(greatest(coalesce(p_days, 30), 1), 730);
  v_from    timestamptz;
  v_hot     numeric;
  v_warm    numeric;
  v_cooling numeric;
  v_bucket  text;
  v_result  jsonb;
begin
  -- הבדיקה קודמת לכל שאילתה. ‏42501 = insufficient_privilege, כדי שהדפדפן
  -- יבחין בין "אין לך הרשאה" לבין תקלה אמיתית.
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  v_from := date_trunc('day', now()) - ((v_days - 1) || ' days')::interval;

  -- ההגדרה נקראת פעם אחת, לא פעם לכל שורה
  select coalesce(max(value) filter (where key = 'lead_hot_hours'),     24),
         coalesce(max(value) filter (where key = 'lead_warm_hours'),    72),
         coalesce(max(value) filter (where key = 'lead_cooling_hours'), 168)
    into v_hot, v_warm, v_cooling
    from pricing_config;

  -- דלי הזמן בגרף נגזר מאורך החלון: 90 עמודות יומיות על מסך טלפון אינן
  -- גרף אלא רעש, ושבוע בודד מחולק לחודשים הוא עמודה אחת.
  v_bucket := case when v_days <= 45 then 'day'
                   when v_days <= 200 then 'week'
                   else 'month' end;

  with
  -- =====================================================================
  -- השדרה: שורה אחת לכל ליד במערכת, מכל חמש הטבלאות
  -- =====================================================================
  spine as (
    -- ליד אתר (הערכת שווי, פנייה על נכס, פנייה ישירה לסוכן/ת, הדמיה)
    select
      'leads'::text as lead_table,
      l.id          as lead_id,
      l.created_at,
      coalesce(
        rl.source,
        nullif(btrim(l.source), ''),
        -- גזירה דטרמיניסטית: לכל lead_type יש בדיוק פונקציית קליטה אחת
        case l.lead_type
          when 'visualization'        then 'property_page_visualization'
          when 'property_inquiry'     then 'property_page_inquiry'
          when 'agent_direct_inquiry' then 'agent_page_direct'
          when 'owner_inbound'        then 'homepage_owner_wizard'
        end,
        'unattributed'
      )             as source,
      coalesce(rl.lead_kind,
        case when l.lead_type = 'owner_inbound' then 'agent_owner' else 'agent_buyer' end
      )             as lead_kind,
      l.lead_type   as lead_type,
      coalesce(rl.routing,
        case when l.agent_id is null then 'unrouted' else 'assigned' end
      )             as routing,
      l.agency_id,
      l.unlocked_at as touched_at
    from leads l
    left join lead_routing_log rl
      on rl.lead_table = 'leads' and rl.lead_id = l.id

    union all

    -- מחפש/ת דירה — חיפוש שמור. ‏agency_id לא-null = נוצר בדף משרד ושויך לו
    select
      'saved_searches', s.id, s.created_at,
      coalesce(rl.source, 'unattributed'),
      'agent_buyer',
      'saved_search',
      coalesce(rl.routing,
        case when not coalesce(s.consent_agent_contact, false) then 'no_consent'
             when s.agency_id is not null                     then 'assigned'
             else 'shelf' end),
      s.agency_id,
      s.sold_at
    from saved_searches s
    left join lead_routing_log rl
      on rl.lead_table = 'saved_searches' and rl.lead_id = s.id

    union all

    -- ייעוץ משכנתאות. ‏mortgage_leads.source הוא אוצר מילים ישן ומצומצם
    -- יותר מזה של היומן, ולכן הוא מתורגם למזהי הווידג'טים.
    select
      'mortgage_leads', m.id, m.created_at,
      coalesce(rl.source,
        case m.source
          when 'homepage_calculator' then 'homepage_mortgage_calc'
          when 'property_page'       then 'property_page_mortgage_calc'
          when 'whatsapp_bot'        then 'whatsapp_bot_mortgage_calc'
          else 'unattributed'
        end),
      'mortgage_advisor',
      'mortgage',
      coalesce(rl.routing, 'shelf'),
      null::uuid,
      m.sold_at
    from mortgage_leads m
    left join lead_routing_log rl
      on rl.lead_table = 'mortgage_leads' and rl.lead_id = m.id

    union all

    -- מנוע ה-RSS. אין לו רישום ביומן (הוא סקרייפר ולא edge function), אבל
    -- המקור שלו ידוע לחלוטין — כל שורה בטבלה הזו נולדה שם.
    select
      'rss_leads', r.id, r.created_at,
      'rss_engine',
      case when r.lead_side in ('מוכר פרטי', 'משכיר') then 'agent_owner' else 'agent_buyer' end,
      'rss',
      'shelf',
      null::uuid,
      r.sold_at
    from rss_leads r
    where r.is_lead

    union all

    -- מחפש/ת פרויקט חדש — מדף היזמים
    select
      'project_leads', p.id, p.created_at,
      coalesce(nullif(btrim(p.source), ''), 'unattributed'),
      'developer',
      'project',
      case when coalesce(p.consent_contact, false) then 'shelf' else 'no_consent' end,
      null::uuid,
      p.sold_at
    from project_leads p
  ),

  -- =====================================================================
  -- הרכישות — כל חמשת ערוצי המכירה, בטבלה אחת
  -- =====================================================================
  purchases as (
    select 'leads'::text as lead_table, lead_id, agency_id, amount, created_at
      from lead_charges where status = 'success'
    union all
    select 'rss_leads', lead_id, agency_id, amount, created_at
      from rss_lead_purchases where status = 'success'
    union all
    select 'mortgage_leads', lead_id, agency_id, amount, created_at
      from mortgage_lead_purchases where status = 'success'
    union all
    select 'saved_searches', search_id, agency_id, amount, created_at
      from saved_search_lead_purchases where status = 'success'
    -- ליד פרויקט נקנה בידי יזם ולא בידי משרד תיווך, ולכן agency_id ריק:
    -- ההכנסה נספרת, והשיוך למשרד — לא, כי אין כזה.
    union all
    select 'project_leads', lead_id, null::uuid, amount, created_at
      from project_lead_purchases where status = 'success'
  ),
  purchase_by_lead as (
    select lead_table, lead_id, sum(amount) as amount
      from purchases group by 1, 2
  ),

  -- כל השדרה, עם ההכנסה, הערוץ והגיל
  enriched as (
    select
      s.*,
      public.lead_source_channel(s.source) as channel,
      coalesce(pb.amount, 0)               as revenue,
      (pb.lead_id is not null)             as sold,
      -- ליד שנולד פתוח אינו מודד זמן תגובה.
      --
      -- ליד מדף משרד, מדף סוכן/ת או תיבת ההדמיות נכנס כבר במצב unlocked —
      -- ‏unlocked_at שווה ל-created_at, ואין בו רגע אחד של המתנה. בלי
      -- ההבחנה הזו 26 הדמיות מושכות את החציון לאפס ומכריזות על זמן תגובה
      -- מושלם על מדד שלא נמדד בכלל.
      --
      -- שנייה אחת ולא אפס: ההוספה ל-leads והפתיחה הן שתי כתיבות, ו-clock
      -- זז ביניהן במיקרו-שניות.
      case when s.touched_at > s.created_at + interval '1 second'
           then extract(epoch from (s.touched_at - s.created_at)) / 3600.0
      end                                  as response_hours,
      (s.touched_at is not null
        and s.touched_at <= s.created_at + interval '1 second') as born_open,
      extract(epoch from (now() - s.created_at)) / 3600.0 as age_hours
    from spine s
    left join purchase_by_lead pb
      on pb.lead_table = s.lead_table and pb.lead_id = s.lead_id
  ),

  -- מה שנקלט בתוך החלון. זו הבסיס לכל מה שאינו "עכשיו".
  win as (
    select * from enriched where created_at >= v_from
  ),

  -- =====================================================================
  -- פילוחים
  -- =====================================================================
  by_source as (
    select
      w.source, w.channel,
      -- הקהל השכיח למקור הזה. מקור אחד יכול להזין שני קהלים (הבוט מזין
      -- שלושה), ולכן זו תווית ולא מפתח.
      mode() within group (order by w.lead_kind)            as lead_kind,
      count(*)                                              as leads,
      count(*) filter (where w.routing = 'assigned')        as assigned,
      count(*) filter (where w.routing = 'shelf')           as shelf,
      count(*) filter (where w.routing = 'unrouted')        as unrouted,
      count(*) filter (where w.routing = 'no_consent')      as no_consent,
      count(*) filter (where w.sold)                        as sold,
      count(*) filter (where w.touched_at is not null)      as touched,
      coalesce(sum(w.revenue), 0)                           as revenue
    from win w group by 1, 2
  ),
  by_channel as (
    select
      w.channel,
      count(*)                                              as leads,
      count(distinct w.source)                              as sources,
      count(*) filter (where w.routing in ('assigned','shelf')) as routed,
      count(*) filter (where w.routing = 'unrouted')        as unrouted,
      count(*) filter (where w.routing = 'no_consent')      as no_consent,
      count(*) filter (where w.sold)                        as sold,
      coalesce(sum(w.revenue), 0)                           as revenue
    from win w group by 1
  ),
  by_kind as (
    select
      w.lead_kind,
      count(*)                                              as leads,
      count(*) filter (where w.routing = 'unrouted')        as unrouted,
      count(*) filter (where w.sold)                        as sold,
      count(*) filter (where w.touched_at is not null)      as touched,
      coalesce(sum(w.revenue), 0)                           as revenue
    from win w group by 1
  ),

  -- =====================================================================
  -- המגמה — דלי לכל יום/שבוע/חודש, עם פילוח לערוצים בתוכו
  --
  -- ‏generate_series ולא group by על הנתונים בלבד: חלון שבו יומיים בלי
  -- לידים חייב להראות שתי עמודות אפס ולא לדלג עליהן, אחרת הגרף משקר לגבי
  -- הקצב.
  -- =====================================================================
  buckets as (
    select gs as bucket_start,
           gs + (case v_bucket when 'day'  then interval '1 day'
                               when 'week' then interval '1 week'
                               else interval '1 month' end) as bucket_end
      from generate_series(
             date_trunc(v_bucket, v_from),
             date_trunc(v_bucket, now()),
             (case v_bucket when 'day'  then interval '1 day'
                            when 'week' then interval '1 week'
                            else interval '1 month' end)
           ) gs
  ),
  trend_totals as (
    select b.bucket_start,
           count(x.lead_id)                        as leads,
           count(x.lead_id) filter (where x.sold)  as sold,
           coalesce(sum(x.revenue), 0)             as revenue
      from buckets b
      left join win x
        on x.created_at >= b.bucket_start and x.created_at < b.bucket_end
     group by b.bucket_start
  ),
  trend_rows as (
    select
      to_char(t.bucket_start, 'YYYY-MM-DD') as bucket,
      t.leads, t.sold, t.revenue,
      coalesce(c.channels, '{}'::jsonb)     as channels
    from trend_totals t
    left join (
      select b.bucket_start,
             jsonb_object_agg(ch.channel, ch.n) as channels
        from buckets b
        join lateral (
          select x.channel, count(*) n
            from win x
           where x.created_at >= b.bucket_start and x.created_at < b.bucket_end
           group by x.channel
        ) ch on true
       group by b.bucket_start
    ) c on c.bucket_start = t.bucket_start
  ),

  -- =====================================================================
  -- התור הפתוח — מה תקוע *עכשיו*, לפי טמפרטורה
  --
  -- לא נתון חלון: ליד שנקלט לפני חודשיים ועדיין לא נגעו בו הוא הבעיה
  -- הגדולה ביותר כאן, ודווקא הוא היה נופל מחלון של 30 יום.
  --
  -- ‏no_consent אינו נספר: הפונה ביקש/ה התראות בלבד, ואין מה "לטפל" בו.
  -- =====================================================================
  open_now as (
    select e.*,
           public.lead_temperature(e.age_hours, v_hot, v_warm, v_cooling) as temp
      from enriched e
     where e.touched_at is null
       and e.routing <> 'no_consent'
  ),
  open_by_temp as (
    select temp, count(*) n, coalesce(sum(revenue), 0) v
      from open_now group by 1
  ),
  open_by_kind as (
    select lead_kind,
           count(*)                                    as n,
           count(*) filter (where temp = 'hot')        as hot,
           count(*) filter (where temp = 'warm')       as warm,
           count(*) filter (where temp = 'cooling')    as cooling,
           count(*) filter (where temp = 'cold')       as cold,
           round(max(age_hours), 1)                    as oldest_hours
      from open_now group by 1
  ),

  -- =====================================================================
  -- זמן התגובה — כמה מהר נוגעים בליד
  --
  -- רק לידים שנגעו בהם: חציון של "עד עכשיו" על ליד נטוש אינו זמן תגובה
  -- אלא גיל, וזה כבר נמדד בתור הפתוח.
  -- =====================================================================
  touched_win as (
    select * from win where response_hours is not null
  ),

  -- =====================================================================
  -- לפי משרד — "קיבל" ולא "שילם"
  -- =====================================================================
  agency_assigned as (
    select w.agency_id, w.lead_type, count(*) n
      from win w where w.agency_id is not null
     group by 1, 2
  ),
  -- רכישה מהמדף היא קבלה של ליד *נוסף*. פתיחת ליד ששויך ממילא (lead_charges
  -- על leads) אינה — ולכן היא מוחרגת כאן ונספרת בנפרד כ"נפתחו".
  agency_bought as (
    select p.agency_id, e.lead_type, count(*) n, coalesce(sum(p.amount), 0) v
      from purchases p
      join enriched e on e.lead_table = p.lead_table and e.lead_id = p.lead_id
     where p.created_at >= v_from
       and p.agency_id is not null
       and p.lead_table <> 'leads'
     group by 1, 2
  ),
  agency_opened as (
    select p.agency_id, count(*) n, coalesce(sum(p.amount), 0) v
      from purchases p
     where p.created_at >= v_from and p.agency_id is not null and p.lead_table = 'leads'
     group by 1
  ),
  agency_spend as (
    select p.agency_id, coalesce(sum(p.amount), 0) v, count(*) n
      from purchases p
     where p.created_at >= v_from and p.agency_id is not null
     group by 1
  ),
  agency_types as (
    select agency_id, jsonb_object_agg(lead_type, n) types, sum(n) total
      from (
        select agency_id, lead_type, sum(n) n from (
          select agency_id, lead_type, n from agency_assigned
          union all
          select agency_id, lead_type, n from agency_bought
        ) u group by 1, 2
      ) g
     group by 1
  ),
  agency_rows as (
    select
      a.id, a.name,
      coalesce(ty.total, 0)                         as received,
      coalesce(ty.types, '{}'::jsonb)               as by_type,
      coalesce((select sum(n) from agency_assigned x where x.agency_id = a.id), 0) as assigned,
      coalesce((select sum(n) from agency_bought   x where x.agency_id = a.id), 0) as bought,
      coalesce(ao.n, 0)                             as opened,
      coalesce(sp.v, 0)                             as spend,
      (select count(*) from agency_members m where m.agency_id = a.id and m.active) as members
    from agencies a
    left join agency_types  ty on ty.agency_id = a.id
    left join agency_opened ao on ao.agency_id = a.id
    left join agency_spend  sp on sp.agency_id = a.id
  )

  select jsonb_build_object(
    'generated_at', now(),
    'range', jsonb_build_object(
      'days',   v_days,
      'from',   to_char(v_from, 'YYYY-MM-DD'),
      'to',     to_char(now(), 'YYYY-MM-DD'),
      'bucket', v_bucket
    ),

    -- ההגדרה נוסעת עם הנתונים, כדי שהדפדפן יציג את הסף האמיתי ולא יקודד
    -- עותק שלו שיישאר מאחור ביום שהערך יכויל.
    'policy', jsonb_build_object(
      'hot_hours',     v_hot,
      'warm_hours',    v_warm,
      'cooling_hours', v_cooling
    ),

    'totals', (
      select jsonb_build_object(
        'leads',       count(*),
        'assigned',    count(*) filter (where routing = 'assigned'),
        'shelf',       count(*) filter (where routing = 'shelf'),
        'unrouted',    count(*) filter (where routing = 'unrouted'),
        'no_consent',  count(*) filter (where routing = 'no_consent'),
        'sold',        count(*) filter (where sold),
        'touched',     count(*) filter (where touched_at is not null),
        -- הגיע לסוכן/ת פתוח מהרגע הראשון (דף משרד, דף סוכן/ת, הדמיה):
        -- נספר כליד לכל דבר, ומוחרג ממדידת זמן התגובה
        'born_open',   count(*) filter (where born_open),
        'waited',      count(*) filter (where response_hours is not null),
        'revenue',     coalesce(sum(revenue), 0),
        'sources',     count(distinct source),
        'channels',    count(distinct channel),
        'unattributed', count(*) filter (where source = 'unattributed')
      ) from win
    ),

    'by_channel', (
      select coalesce(jsonb_agg(to_jsonb(c) order by c.leads desc, c.channel), '[]'::jsonb)
        from by_channel c
    ),
    'by_source', (
      select coalesce(jsonb_agg(to_jsonb(s) order by s.leads desc, s.source), '[]'::jsonb)
        from by_source s
    ),
    'by_kind', (
      select coalesce(jsonb_agg(to_jsonb(k) order by k.leads desc), '[]'::jsonb)
        from by_kind k
    ),
    'trend', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.bucket), '[]'::jsonb)
        from trend_rows t
    ),

    'open_queue', jsonb_build_object(
      'total',        (select count(*) from open_now),
      -- ‏coalesce *סביב* התת-שאילתה ולא בתוכה: דלי ריק אינו מחזיר שורה
      -- אחת עם אפס אלא אפס שורות, ותת-שאילתה סקלרית ריקה היא null.
      'hot',          coalesce((select n from open_by_temp where temp = 'hot'), 0),
      'warm',         coalesce((select n from open_by_temp where temp = 'warm'), 0),
      'cooling',      coalesce((select n from open_by_temp where temp = 'cooling'), 0),
      'cold',         coalesce((select n from open_by_temp where temp = 'cold'), 0),
      'oldest_hours', (select coalesce(round(max(age_hours))::int, 0) from open_now),
      'by_kind',      (select coalesce(jsonb_agg(to_jsonb(k) order by k.n desc), '[]'::jsonb)
                         from open_by_kind k)
    ),

    -- ‏percentile_cont ולא avg בלבד: ליד אחד שנפתח אחרי חודש מזיז ממוצע של
    -- עשרה לידים שנענו תוך שעה לשש שעות, והחציון אומר את האמת על הרוב.
    'response', (
      select jsonb_build_object(
        'touched',      count(*),
        'median_hours', round(coalesce(percentile_cont(0.5)
                          within group (order by response_hours), 0)::numeric, 1),
        'avg_hours',    round(coalesce(avg(response_hours), 0)::numeric, 1),
        'within_hot',   count(*) filter (where response_hours <= v_hot),
        'within_warm',  count(*) filter (where response_hours <= v_warm)
      ) from touched_win
    ),

    'agencies', (
      select coalesce(jsonb_agg(to_jsonb(r) order by r.received desc, r.spend desc, r.name), '[]'::jsonb)
        from agency_rows r
       where r.received > 0 or r.opened > 0
    )
  ) into v_result;

  return v_result;
end;
$$;

comment on function public.platform_lead_report(integer) is
  'בקרת מנוע הלידים למנהל/ת הפלטפורמה: מקור וערוץ של כל ליד שנקלט, פילוח לפי קהל, מגמה, תור פתוח לפי טמפרטורה, זמן תגובה ופירוט לפי משרד. מספרים בלבד — אין בה PII. מסרבת למי שאינו/ה מנהל/ת פלטפורמה.';

-- הפונקציה עוקפת RLS בכוונה, ולכן ההרשאה מצומצמת: משתמש/ת מחובר/ת בלבד
-- (הבדיקה בגוף הפונקציה עושה את השאר), ואף פעם לא anon.
revoke all on function public.platform_lead_report(integer) from public;
revoke all on function public.platform_lead_report(integer) from anon;
grant execute on function public.platform_lead_report(integer) to authenticated;

-- שתי פונקציות העזר טהורות ואינן נוגעות בנתונים, אבל הן נחשפות דרך
-- ‏PostgREST כמו כל פונקציה, ואין סיבה שאנונימי/ת יקרא/תקרא להן.
revoke all on function public.lead_source_channel(text) from public;
revoke all on function public.lead_source_channel(text) from anon;
grant execute on function public.lead_source_channel(text) to authenticated;

revoke all on function public.lead_temperature(numeric, numeric, numeric, numeric) from public;
revoke all on function public.lead_temperature(numeric, numeric, numeric, numeric) from anon;
grant execute on function public.lead_temperature(numeric, numeric, numeric, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. אינדקסים לחלון
--
-- הדוח סורק כל טבלת ליד לפי created_at ומצטרף ל-lead_routing_log לפי
-- ‏(lead_table, lead_id) — שעליו כבר יש unique index. מה שחסר הוא ה-created_at
-- של הטבלאות שטרם קיבלו אחד, ושל טבלאות הרכישה שהדוח מסנן לפיהן.
--
-- היום הטבלאות קטנות וכל סריקה זולה; זה כדי שהדוח לא יהפוך לבעיה כשהן
-- יגדלו — לא כדי לפתור בעיה קיימת.
-- ---------------------------------------------------------------------------
create index if not exists saved_searches_created_at_idx        on public.saved_searches (created_at);
create index if not exists mortgage_leads_created_at_idx        on public.mortgage_leads (created_at);
create index if not exists project_leads_created_at_idx         on public.project_leads (created_at);
create index if not exists rss_lead_purchases_created_idx       on public.rss_lead_purchases (created_at);
create index if not exists mortgage_lead_purchases_created_idx  on public.mortgage_lead_purchases (created_at);
create index if not exists saved_search_purchases_created_idx   on public.saved_search_lead_purchases (created_at);
create index if not exists project_lead_purchases_created_idx   on public.project_lead_purchases (created_at);

-- לידים שטרם נגעו בהם — זה בדיוק התור הפתוח, והוא נסרק בכל טעינה של הדוח
create index if not exists leads_untouched_idx
  on public.leads (created_at)
  where unlocked_at is null;
