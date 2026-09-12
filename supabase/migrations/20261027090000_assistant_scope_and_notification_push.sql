-- ============================================================================
-- העוזר האישי בוואטסאפ: לקוחות, התאמות — והתראות שיוצאות חזרה בוואטסאפ
--
-- עד כאן הבוט בוואטסאפ ידע נכסים בלבד. זה מה שהסוכן/ת קיבל/ה כשביקש/ה
-- משהו אחר:
--
--   ‏> כמה לקוחות יש לי במאגר
--   ‏> אין לי גישה למאגר לקוחות — אני מטפל רק בנכסים.
--
-- והכלים לכל השאר כבר קיימים במסד: קובץ הלקוחות, מנוע ההתאמות, ההסכמים
-- והלידים. מה שחסר היה **דרך להגיע אליהם מהשרת** — כלומר עם מזהה סוכן/ת
-- מפורש ולא מתוך JWT.
--
-- ## למה צריך פונקציות חדשות ולא לקרוא לקיימות
--
-- ‏`match_properties_for_client`, ‏`client_match_counts` ו-`client_match_top`
-- כולן גוזרות את זהות הסוכן/ת מ-`auth.uid()`. זו החלטה נכונה לדפדפן וחסרת
-- תחליף שם — אבל ה-Edge Function של הוואטסאפ מזהה את הסוכן/ת לפי **מספר
-- הטלפון** (‏`agency_members.phone_e164`) ורצה עם `service_role`, ולכן
-- ‏`auth.uid()` שלה הוא `null` והן מחזירות אפס שורות.
--
-- לכן שלוש הפונקציות כאן מקבלות `p_agent_id` מפורש, ולכן גם **אסור** להן
-- להיות זמינות ל-`authenticated`: פונקציה שמקבלת מזהה סוכן/ת בפרמטר ומריצה
-- ‏`security definer` היא דלת עקיפה ל-RLS אם היא פתוחה לדפדפן. הן מוענקות
-- ל-`service_role` בלבד — אותה תבנית כמו `agent_reminders_claim`.
--
-- **מקור האמת לניקוד נשאר אחד.** שלושתן קוראות ל-`client_property_match`
-- (‏מיגרציה 20260829200000), בדיוק כמו הפאנל בדשבורד וכמו התראות ההתאמה.
-- נוסחה שמחושבת פעם שנייה הייתה מתפצלת מהראשונה תוך חודש, והסוכן/ת היה
-- מקבל/ת בוואטסאפ ציון אחר מזה שבמסך.
--
-- ## הכיוון ההפוך: התראות שיוצאות בוואטסאפ
--
-- הפעמון ב-CRM מדווח על אירועים בזמן אמת — ליד נכנס, נכס התאים ללקוח/ה,
-- הסכם נחתם מרחוק — אבל רק למי שהדשבורד פתוח מולו/ה. ‏`agent-reminders`
-- (‏20261026090000) כבר פתחה ערוץ וואטסאפ, אבל **לתזכורות בלבד**: היא נשענת
-- על `agent_reminder_findings`, שמחשבת מצב ולא אירועים, ורצה פעם בשעה.
-- אירוע הוא הדבר ההפוך: הוא קורה ברגע מסוים, והערך שלו נשחק בשעה.
--
-- לכן נוספים כאן:
--
--   ‏· `agent_notification_preferences.whatsapp_types` — **רשימת מאושרים**
--     ולא מושתקים. זה החריג המכוון לתבנית שחוזרת בכל הפרויקט, והסיבה
--     ספציפית: ערוץ יוצא שעולה כסף ושחסימה אחת בו פוגעת בכל הנמענים
--     העתידיים (דירוג האיכות של Meta) לא נדלק לאיש בלי בקשה מפורשת. סוג
--     התראה חדש שייכנס בעתיד יגיע לפעמון של כולם — וללא וואטסאפ, עד
--     שמישהו/י יסמן/תסמן אותו.
--   ‏· `notification_push_log` + `notification_push_claim/mark` — אותה תבנית
--     בדיוק של יומן התזכורות: השורה נכתבת **לפני** השליחה, ולכן נפילה
--     באמצע משאירה "יצא, לא ידוע אם הגיע" ולא הודעה כפולה.
--   ‏· ‏cron מותנה כל חמש דקות.
--
-- ### שלוש החלטות בערוץ הזה
--
-- **1. הודעה אחת מקבצת את כל ההתראות הפתוחות**, כמו בתזכורות. שלוש התראות
-- ברצף בוואטסאפ הן הדרך המהירה ביותר לחסימה.
--
-- **2. התראה שנקראה בדשבורד אינה נשלחת.** ‏`notifications.read` הוא התנאי,
-- ולכן סוכן/ת שעבד/ה בדשבורד בדקות שחלפו לא מקבל/ת בוואטסאפ תקציר של מה
-- שהרגע ראה/תה. זה מה שהופך את הערוץ מ"עוד עותק" ל"מה שפספסת".
--
-- **3. חלון מבט לאחור של 12 שעות.** התראה שיושבת לא־נקראה שלושה ימים אינה
-- "מה שפספסת" אלא הצטברות, והיא בדיוק מה שהתזכורות עושות טוב יותר. בלי
-- החלון הזה, סוכן/ת שמדליק/ה את הערוץ היום היה מקבל/ת בהודעה הראשונה את כל
-- מה שלא קרא/ה מאז ומתמיד.
--
-- ## תלויות קיימות
--
-- ‏`agent_clients`, ‏`client_property_match`, ‏`properties`, ‏`property_shares`,
-- ‏`agency_members`, ‏`notifications`, ‏`agent_notification_preferences`,
-- ‏`agent_reminder_preferences` (שעות השקט), ‏`agent_reminder_quiet_now`,
-- ‏`whatsapp_conversations` (חלון 24 השעות), ‏`pricing_config`,
-- ‏`current_agent_id()`, ‏pg_cron + pg_net + vault (‏`alert_cron_secret`).
--
-- הקובץ אידמפוטנטי — אפשר להריץ אותו שוב.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. המספרים העסקיים
-- ---------------------------------------------------------------------------
insert into public.pricing_config (key, value, description) values
  ('notif_push_gap_minutes', 10,
   'מרווח מינימלי בדקות בין שתי הודעות וואטסאפ של התראות לאותו/ה סוכן/ת — זה גם חלון הקיבוץ'),
  ('notif_push_max_per_day', 12,
   'תקרת הודעות וואטסאפ של התראות ל-24 שעות מתגלגלות, לסוכן/ת'),
  ('notif_push_lookback_hours', 12,
   'עד כמה אחורה נחשבת התראה שלא נקראה כ"מה שפספסת". מעבר לזה זו הצטברות, ושם התזכורות עושות עבודה טובה יותר')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. קובץ הלקוחות וההתאמות — עם מזהה סוכן/ת מפורש
--
-- ה-`pool` כאן זהה לזה של `match_properties_for_client`: הנכסים שלי, נכסי
-- המשרד, ומה שמשרדים אחרים שיתפו עם המשרד שלי. סוכן/ת שאין לו/ה משרד
-- מקבל/ת אפס שורות, בדיוק כמו בדשבורד.
-- ---------------------------------------------------------------------------
create or replace function public.agent_client_matches(
  p_agent_id  uuid,
  p_client_id uuid,
  p_limit     int default 10
)
returns table (
  property_id        uuid,
  source             text,
  score              int,
  reasons            text[],
  missing_features   text[],
  title              text,
  price              numeric,
  deal_type          text,
  property_type      text,
  rooms              numeric,
  floor              int,
  size_sqm           numeric,
  city               text,
  street             text,
  house_number       text,
  listing_agent_name text,
  listing_agent_phone text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_agent  public.agency_members%rowtype;
  v_client public.agent_clients%rowtype;
  v_cap    int := least(greatest(coalesce(p_limit, 10), 1), 30);
begin
  select * into v_agent from public.agency_members
   where id = p_agent_id and active = true;
  if not found or v_agent.agency_id is null then
    return;
  end if;

  -- הלקוח/ה חייב/ת להיות של הסוכן/ת. זה השער שמחליף כאן את ה-RLS: הפונקציה
  -- ‏definer ומקבלת שני מזהים, ובלי הבדיקה הזו היה אפשר להצליב לקוח/ה של
  -- אחד/ת מול המאגר של אחר/ת.
  select * into v_client from public.agent_clients
   where id = p_client_id and agent_id = v_agent.id;
  if not found then
    return;
  end if;

  return query
  with pool as (
    select p.id as pid,
           case when p.agent_id = v_agent.id then 'own' else 'agency' end as src
      from public.properties p
     where p.agency_id = v_agent.agency_id
    union all
    select ps.property_id, 'shared'
      from public.property_shares ps
     where ps.shared_with_agency_id = v_agent.agency_id
  )
  select
    p.id, pool.src, m.score, m.reasons, m.missing_features,
    p.title, p.price, p.deal_type, p.property_type,
    p.rooms::numeric, p.floor::int, p.size_sqm::numeric,
    p.city, p.street, p.house_number,
    case when p.agent_id = v_agent.id then null else mem.display_name end,
    case when p.agent_id = v_agent.id then null else mem.phone end
    from pool
    join public.properties p on p.id = pool.pid
    cross join lateral public.client_property_match(v_client, p) m
    left join public.agency_members mem on mem.id = p.agent_id
   where m.score >= 50
   order by m.score desc, p.is_promoted desc, p.created_at desc
   limit v_cap;
end;
$$;

comment on function public.agent_client_matches(uuid, uuid, int) is
  'התאמות נכס ללקוח/ה לפי מזהה סוכן/ת מפורש — הגרסה של match_properties_for_client לשרת (הבוט בוואטסאפ), שאין לו JWT. ניקוד מ-client_property_match, כמו בדשבורד.';

revoke all on function public.agent_client_matches(uuid, uuid, int) from public;
revoke all on function public.agent_client_matches(uuid, uuid, int) from anon, authenticated;
grant execute on function public.agent_client_matches(uuid, uuid, int) to service_role;

-- ---------------------------------------------------------------------------
-- 3. ספירת ההתאמות לכל לקוח/ה
--
-- ‏"לכמה מהלקוחות שלי יש משהו עכשיו" בקריאה אחת, ולא שאילתה לכל שורה. אותו
-- ‏`count(*) over ()` בתוך ה-lateral כמו ב-`client_match_top`: פונקציות חלון
-- מחושבות לפני LIMIT, ולכן הספירה מלאה גם כשלוקחים שורה אחת.
-- ---------------------------------------------------------------------------
create or replace function public.agent_client_match_counts(p_agent_id uuid)
returns table (
  client_id    uuid,
  client_name  text,
  client_phone text,
  status       text,
  match_count  int,
  top_score    int,
  top_title    text,
  top_city     text,
  top_street   text,
  top_price    numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.full_name, c.phone, c.status,
         coalesce(t.match_count, 0), t.score, t.title, t.city, t.street, t.price
    from public.agent_clients c
    left join lateral (
      select count(*) over ()::int as match_count,
             m.score, m.title, m.city, m.street, m.price
        from public.agent_client_matches(p_agent_id, c.id, 30) m
       limit 1
    ) t on true
   where c.agent_id = p_agent_id
     -- פעילים בלבד, כמו `client_match_counts()` בדשבורד: הצלבה מול המאגר
     -- לכל לקוח/ה סגור/ה היא עבודה על שאלה שאיש לא שאל.
     and c.status = 'active'
   order by coalesce(t.match_count, 0) desc, c.created_at desc;
$$;

comment on function public.agent_client_match_counts(uuid) is
  'לכל לקוח/ה **פעיל/ה** של הסוכן/ת: ספירת ההתאמות וההתאמה החזקה ביותר. קריאה אחת לכל הקובץ, לשאלה "מי מהלקוחות שלי ממתין/ה למשהו".';

revoke all on function public.agent_client_match_counts(uuid) from public;
revoke all on function public.agent_client_match_counts(uuid) from anon, authenticated;
grant execute on function public.agent_client_match_counts(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. הכיוון ההפוך — למי מהלקוחות מתאים הנכס הזה
--
-- זו השאלה שנשאלת בוואטסאפ ולא בדשבורד: הסוכן/ת יוצא/ת מפגישה עם נכס חדש
-- ביד ורוצה לדעת למי להתקשר. הכיוון הזה לא היה קיים כפונקציה — פאנל
-- ההתאמות הוא לקוח/ה→נכסים, והתראות ההתאמה הן נכס→לקוחות אבל רק בזמן
-- שהנכס נכנס ורק מעל רף 70.
--
-- **הנכס נבדק מול אותו pool** ולא רק מול הנכסים של הסוכן/ת: שווה לדעת שנכס
-- של עמית/ה במשרד מתאים ללקוח/ה שלך. נכס שאינו בתחום הראייה מחזיר אפס
-- שורות, בלי לגלות שהוא קיים.
-- ---------------------------------------------------------------------------
create or replace function public.agent_property_client_matches(
  p_agent_id    uuid,
  p_property_id uuid,
  p_limit       int default 10
)
returns table (
  client_id        uuid,
  client_name      text,
  client_phone     text,
  score            int,
  reasons          text[],
  missing_features text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_agent    public.agency_members%rowtype;
  v_property public.properties%rowtype;
  v_cap      int := least(greatest(coalesce(p_limit, 10), 1), 30);
begin
  select * into v_agent from public.agency_members
   where id = p_agent_id and active = true;
  if not found or v_agent.agency_id is null then
    return;
  end if;

  select p.* into v_property
    from public.properties p
   where p.id = p_property_id
     and (p.agency_id = v_agent.agency_id
          or exists (select 1 from public.property_shares ps
                      where ps.property_id = p.id
                        and ps.shared_with_agency_id = v_agent.agency_id));
  if not found then
    return;
  end if;

  return query
  select c.id, c.full_name, c.phone, m.score, m.reasons, m.missing_features
    from public.agent_clients c
    cross join lateral public.client_property_match(c, v_property) m
   where c.agent_id = v_agent.id
     and c.status = 'active'
     and m.score >= 50
   order by m.score desc, c.created_at desc
   limit v_cap;
end;
$$;

comment on function public.agent_property_client_matches(uuid, uuid, int) is
  'למי מלקוחות הסוכן/ת מתאים נכס מסוים — הכיוון ההפוך לפאנל ההתאמות, לשאלה "למי להתקשר על הנכס הזה". רק לקוחות פעילים.';

revoke all on function public.agent_property_client_matches(uuid, uuid, int) from public;
revoke all on function public.agent_property_client_matches(uuid, uuid, int) from anon, authenticated;
grant execute on function public.agent_property_client_matches(uuid, uuid, int) to service_role;

-- ---------------------------------------------------------------------------
-- 5. ספירת הנכסים — במסד, במעבר אחד
--
-- הכלי הזה נולד מכשל אמיתי בפרודקשן. לשאלה "כמה נכסים מסחריים יש לי" הבוט
-- קרא לרשימת הנכסים, קיבל 50 שורות (התקרה של הכלי), וענה:
--
--   ‏> מתוך 50 הנכסים האחרונים שלך, כ-42 מסחריים
--
-- התשובה נשמעה מוסמכת, והייתה שגויה בשורש: אין דרך לספור קובץ מתוך מדגם,
-- וה"כ-" הוא הודאה בזה. ספירה היא שאילתה, לא קריאה של רשימה.
--
-- ‏jsonb אחד ולא תשע שורות: כל התשובות באות מאותו מעבר על הנכסים של
-- הסוכן/ת, וזה גם מה שמונע תשע קריאות HTTP מה-Edge Function.
-- ---------------------------------------------------------------------------
create or replace function public.agent_property_stats(p_agent_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'total',    count(*),
    'by_status', jsonb_build_object(
      'active',   count(*) filter (where p.status = 'active'),
      'sold',     count(*) filter (where p.status = 'sold'),
      'rented',   count(*) filter (where p.status = 'rented'),
      'archived', count(*) filter (where p.status = 'archived')),
    'by_category', jsonb_build_object(
      'residential', count(*) filter (where p.category = 'residential'),
      'commercial',  count(*) filter (where p.category = 'commercial')),
    'by_deal_type', jsonb_build_object(
      'sale', count(*) filter (where p.deal_type = 'sale'),
      'rent', count(*) filter (where p.deal_type = 'rent')),
    -- נכס פעיל בלי תמונה אחת כמעט לא נפתח, וזו הספירה שהסוכן/ת רוצה לשמוע
    -- יחד עם כל השאר ולא בשאילתה נפרדת.
    'active_without_images',
      count(*) filter (where p.status = 'active'
                         and coalesce(array_length(p.images, 1), 0) = 0)
  )
  from public.properties p
 where p.agent_id = p_agent_id;
$$;

comment on function public.agent_property_stats(uuid) is
  'ספירות מדויקות של הנכסים של סוכן/ת: סטטוס, קטגוריה, סוג עסקה ופעילים בלי תמונות. קיימת כדי שהבוט בוואטסאפ לא ישיב על "כמה" מתוך מדגם של 50 שורות.';

revoke all on function public.agent_property_stats(uuid) from public;
revoke all on function public.agent_property_stats(uuid) from anon, authenticated;
grant execute on function public.agent_property_stats(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. זיכרון השיחה: הלקוח/ה האחרון/ה
--
-- ‏`last_property_id` כבר קיים, והוא מה שמאפשר "תוסיף לזה מרפסת" לעבוד. עם
-- קובץ הלקוחות נדרשת אותה עוגן גם לצד השני, כדי ש"תעדכן לו את התקציב
-- ל-1.9" ייפול על מי שדובר עליו/ה — ולא ייגמר בשאלה "על מי מדובר?" אחרי
-- שהשם נאמר במשפט הקודם.
-- ---------------------------------------------------------------------------
alter table public.whatsapp_conversations
  add column if not exists last_client_id uuid
    references public.agent_clients(id) on delete set null;

comment on column public.whatsapp_conversations.last_client_id is
  'הלקוח/ה שהבוט נגע/ה בו/בה לאחרונה בשיחה — העוגן להתייחסות "תעדכן לו/לה" בלי שם. on delete set null: מחיקת לקוח/ה לא תפיל שמירת שיחה.';

-- ---------------------------------------------------------------------------
-- 7. הערוץ: אילו סוגי התראה יוצאים גם בוואטסאפ
--
-- רשימת **מאושרים**, בניגוד ל-`muted_types` שלידה. ראו ההסבר בראש הקובץ:
-- ערוץ יוצא בתשלום, שחסימה אחת בו מייקרת את כל הנמענים העתידיים, לא נדלק
-- בלי בקשה מפורשת.
--
-- ובלי `check` על הערכים, בדיוק כמו `muted_types`: סוג התראה חדש נכנס
-- ב-`notifications_type_check` בלבד, ואילוץ שני כאן היה מחייב מיגרציה שלישית
-- בכל פעם.
-- ---------------------------------------------------------------------------
alter table public.agent_notification_preferences
  add column if not exists whatsapp_types text[] not null default '{}';

comment on column public.agent_notification_preferences.whatsapp_types is
  'סוגי התראה שיישלחו לסוכן/ת גם בוואטסאפ. רשימת מאושרים (ולא מושתקים) — ערוץ יוצא לא נדלק בלי בקשה. דורש מספר ב-agency_members.phone.';

-- ---------------------------------------------------------------------------
-- 8. יומן המשלוח
--
-- ‏notification_ids הוא מה שמונע שליחה כפולה, ולכן יש עליו GIN: השאילתה
-- החמה היא "האם ההתראה הזו כבר יצאה לסוכן/ת הזה/הזו".
-- ---------------------------------------------------------------------------
create table if not exists public.notification_push_log (
  id               uuid primary key default gen_random_uuid(),
  agent_id         uuid not null references public.agency_members(id) on delete cascade,
  notification_ids uuid[] not null,
  types            text[] not null,
  -- ‏template כשההודעה יצאה כתבנית מאושרת, text כשהיא יצאה כטקסט חופשי בתוך
  -- חלון 24 השעות. נשמר כי זה ההבדל בין הודעה שעולה כסף לאחת שלא, וכי כשל
  -- של "מחוץ לחלון" נראה אחרת בכל אחד מהם.
  channel_mode     text not null default 'text',
  whatsapp_status  text not null default 'pending',
  last_error       text,
  created_at       timestamptz not null default now(),
  sent_at          timestamptz,

  constraint notification_push_log_status_chk
    check (whatsapp_status in ('pending','sent','failed')),
  constraint notification_push_log_mode_chk
    check (channel_mode in ('text','template'))
);

comment on table public.notification_push_log is
  'יומן הודעות הוואטסאפ של התראות הפעמון. שורה לכל הודעה מקובצת, ומקור האמת לקצב ולמנגנון "לא לשלוח פעמיים".';

create index if not exists notification_push_log_agent_idx
  on public.notification_push_log (agent_id, created_at desc);
create index if not exists notification_push_log_ids_idx
  on public.notification_push_log using gin (notification_ids);

alter table public.notification_push_log enable row level security;

-- קריאה בלבד לסוכן/ת עצמו/ה; הכתיבה היא רק דרך service_role בתוך ה-Edge
-- Function — אותה תבנית כמו notifications, whatsapp_messages ו-
-- agent_reminder_log.
drop policy if exists "agent reads own notification push log" on public.notification_push_log;
create policy "agent reads own notification push log"
  on public.notification_push_log for select
  using (agent_id = public.current_agent_id());

-- ---------------------------------------------------------------------------
-- 9. למי מותר לשלוח עכשיו
--
-- **המסלול הוא התנאי הראשון.** העוזר האישי הוא יכולת של PROFESSIONAL ו-Elite,
-- והערוץ הזה הוא אותו עוזר בכיוון ההפוך — אותו מספר, אותה זהות. אלה שלושת
-- התנאים שכל יכולת בתשלום בפרויקט נשענת עליהם, בדיוק כמו
-- ‏`property_description_tier_ok`: מסלול, פעילות ומצב חיוב. ‏`billing_status`
-- אינו קישוט: חשבון בחוב הוא חשבון שלא שילם על היכולת הזו.
--
-- מה שקורה לסוכן/ת ב-Pay&GO שסימן/ה סוגים וירד/ה מהמסלול: הסימון נשאר
-- בשורת ההעדפות ואינו נמחק, וההודעות פשוט מפסיקות לצאת. שדרוג מחזיר אותן
-- בלי שצריך לסמן שוב — אותה החלטה שנפלה בערוץ התזכורות, ומאותה סיבה:
-- מחיקת בחירה בגלל שינוי מסלול היא איבוד מידע שאיש לא ביקש.
--
-- שעות השקט נלקחות מ-`agent_reminder_preferences` ולא מעמודה חדשה, ובכוונה:
-- "מתי לא לצלצל אליי" היא תכונה של האדם ולא של סוג ההודעה. סוכן/ת שקבע/ה
-- שקט עד 8:00 לא התכוון/ה שזה חל על התזכורות בלבד. ובהיעדר שורה — אותן
-- ברירות מחדל בדיוק (21→8), כדי שהיעדר העדפות לא יתפרש כ"מותר תמיד".
-- ---------------------------------------------------------------------------
create or replace function public.notification_push_due_agents()
returns table (
  agent_id       uuid,
  display_name   text,
  phone_e164     text,
  whatsapp_types text[],
  in_service_window boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with cfg as (
    select coalesce((select value::int from public.pricing_config
                      where key = 'notif_push_gap_minutes'), 10)  as gap_min,
           coalesce((select value::int from public.pricing_config
                      where key = 'notif_push_max_per_day'), 12)  as cap
  ),
  agents as (
    select m.id, m.display_name,
           nullif(btrim(coalesce(m.phone_e164, '')), '') as phone_e164,
           coalesce(np.whatsapp_types, '{}'::text[])     as whatsapp_types,
           coalesce(rp.quiet_from_hour, 21)              as quiet_from,
           coalesce(rp.quiet_to_hour,   8)               as quiet_to
      from public.agency_members m
      left join public.agent_notification_preferences np on np.agent_id = m.id
      left join public.agent_reminder_preferences     rp on rp.agent_id = m.id
     where m.active
       and m.closed_at is null
       and m.closure_requested_at is null
       -- העוזר האישי הוא יכולת של PROFESSIONAL ו-Elite. אותו גייט שב-
       -- ‏`TIER_ALLOWED` ב-whatsapp-webhook, ואותם שלושה תנאים של כל יכולת
       -- בתשלום כאן.
       and m.tier in ('mid', 'premium')
       and m.billing_status = 'active'
  ),
  recent as (
    select l.agent_id,
           max(l.created_at) as last_at,
           count(*) filter (where l.created_at > now() - interval '24 hours') as n24
      from public.notification_push_log l
     group by l.agent_id
  )
  select a.id, a.display_name, a.phone_e164, a.whatsapp_types,
         -- חלון 24 השעות של Meta נמדד מההודעה האחרונה ש**הסוכן/ת** שלח/ה
         -- לבוט. בתוכו מותר טקסט חופשי, שהוא גם זול יותר וגם נושא קישורים
         -- אמיתיים; מחוצה לו נדרשת תבנית מאושרת. ‏23 ולא 24 — שוליים לזמן
         -- שלוקח לסבב לצאת.
         coalesce(
           (select c.last_message_at > now() - interval '23 hours'
              from public.whatsapp_conversations c
             where c.agent_id = a.id),
           false)
    from agents a
    cross join cfg
    left join recent r on r.agent_id = a.id
   where coalesce(array_length(a.whatsapp_types, 1), 0) > 0
     -- ערוץ בלי מספר אינו ערוץ
     and a.phone_e164 is not null
     and not public.agent_reminder_quiet_now(a.quiet_from, a.quiet_to)
     and coalesce(r.n24, 0) < cfg.cap
     and (r.last_at is null
          or r.last_at < now() - make_interval(mins => cfg.gap_min));
$$;

comment on function public.notification_push_due_agents() is
  'הסוכנים שמותר לשלוח להם/ן עכשיו הודעת וואטסאפ על התראות: מסלול mid/premium בחיוב פעיל, ערוץ דלוק עם מספר, מחוץ לשעות השקט, בתוך התקרה היומית ואחרי מרווח הקיבוץ. אינה בודקת אם יש התראה — זה החלק היקר ונשאר ב-claim.';

revoke all on function public.notification_push_due_agents() from public;
revoke all on function public.notification_push_due_agents() from anon, authenticated;
grant execute on function public.notification_push_due_agents() to service_role;

-- ---------------------------------------------------------------------------
-- 10. השאלה הזולה של ה-cron
--
-- כאן, בשונה מ-`agent_reminders_ready`, התנאי הוא **superset** ולא זהות:
-- הוא בודק גם שיש בכלל התראה פתוחה, כי זו שאילתה זולה (אינדקס על
-- ‏notifications) וה-cron רץ כל חמש דקות. בלעדיה היינו מעירים את ה-Edge
-- Function 288 פעמים ביום כדי לשמוע "אין כלום".
-- ---------------------------------------------------------------------------
create or replace function public.notification_push_ready()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.notification_push_due_agents() a
     where exists (
       select 1
         from public.notifications n
        where n.agent_id = a.agent_id
          and not n.read
          and n.type = any(a.whatsapp_types)
          and n.created_at > now() - make_interval(hours =>
                coalesce((select value::int from public.pricing_config
                           where key = 'notif_push_lookback_hours'), 12))
          and not exists (
            select 1 from public.notification_push_log l
             where l.agent_id = n.agent_id
               and n.id = any(l.notification_ids))
     )
  );
$$;

comment on function public.notification_push_ready() is
  'האם יש בכלל התראה שממתינה לשליחה בוואטסאפ. נקראת מה-cron לפני net.http_post.';

revoke all on function public.notification_push_ready() from public;
revoke all on function public.notification_push_ready() from anon, authenticated;
grant execute on function public.notification_push_ready() to service_role;

-- ---------------------------------------------------------------------------
-- 11. התפיסה
--
-- רושמת את שורת היומן **לפני** שהשרת שולח, ומחזירה אותה. ארבעה תנאים על
-- ההתראות שנכנסות להודעה:
--
--   ‏· `not read`        — מה שנקרא בדשבורד אינו "מה שפספסת"
--   ‏· הסוג ברשימת המאושרים של הסוכן/ת
--   ‏· בתוך חלון המבט לאחור
--   ‏· לא יצאה כבר בהודעה קודמת (‏notification_ids)
-- ---------------------------------------------------------------------------
create or replace function public.notification_push_claim(p_limit int default 20)
returns table (
  log_id       uuid,
  agent_id     uuid,
  display_name text,
  phone_e164   text,
  channel_mode text,
  items        jsonb,
  item_count   int
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  a         record;
  v_items   jsonb;
  v_ids     uuid[];
  v_types   text[];
  v_log     uuid;
  v_mode    text;
  v_taken   int := 0;
  v_cap     int := least(greatest(coalesce(p_limit, 20), 1), 200);
  v_look    int := coalesce((select value::int from public.pricing_config
                              where key = 'notif_push_lookback_hours'), 12);
begin
  for a in select * from public.notification_push_due_agents() loop
    exit when v_taken >= v_cap;

    select jsonb_agg(jsonb_build_object(
             'type',  n.type,
             'title', n.title,
             'body',  n.body
           ) order by n.created_at desc),
           array_agg(n.id order by n.created_at desc),
           array_agg(distinct n.type)
      into v_items, v_ids, v_types
      from public.notifications n
     where n.agent_id = a.agent_id
       and not n.read
       and n.type = any(a.whatsapp_types)
       and n.created_at > now() - make_interval(hours => v_look)
       and not exists (
         select 1 from public.notification_push_log l
          where l.agent_id = n.agent_id
            and n.id = any(l.notification_ids));

    continue when v_items is null;

    v_mode := case when a.in_service_window then 'text' else 'template' end;

    insert into public.notification_push_log
      (agent_id, notification_ids, types, channel_mode, whatsapp_status)
    values (a.agent_id, v_ids, v_types, v_mode, 'pending')
    returning id into v_log;

    v_taken := v_taken + 1;

    return query select v_log, a.agent_id, a.display_name, a.phone_e164,
                        v_mode, v_items, jsonb_array_length(v_items);
  end loop;
end;
$$;

comment on function public.notification_push_claim(int) is
  'רושמת שורת יומן לכל סוכן/ת שיש לו/ה התראות פתוחות שטרם נשלחו, ומחזירה אותן לשליחה. הרישום קודם לשליחה — כך נפילה באמצע לא מייצרת הודעה כפולה.';

revoke all on function public.notification_push_claim(int) from public;
revoke all on function public.notification_push_claim(int) from anon, authenticated;
grant execute on function public.notification_push_claim(int) to service_role;

-- ---------------------------------------------------------------------------
-- 12. הסימון
-- ---------------------------------------------------------------------------
create or replace function public.notification_push_mark(
  p_log_id uuid,
  p_status text,
  p_error  text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('pending','sent','failed') then
    raise exception 'notification_push_mark: סטטוס לא מוכר';
  end if;

  update public.notification_push_log
     set whatsapp_status = p_status,
         last_error      = left(nullif(btrim(coalesce(p_error, '')), ''), 500),
         sent_at         = case when p_status = 'sent' then coalesce(sent_at, now())
                                else sent_at end
   where id = p_log_id;
end;
$$;

comment on function public.notification_push_mark(uuid, text, text) is
  'מעדכנת את תוצאת השליחה על שורת יומן. sent_at נקבע רק כשההודעה באמת יצאה.';

revoke all on function public.notification_push_mark(uuid, text, text) from public;
revoke all on function public.notification_push_mark(uuid, text, text) from anon, authenticated;
grant execute on function public.notification_push_mark(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 13. כיבוי הערוץ אחרי ביטול מול Meta
--
-- שגיאה 131050 פירושה שהנמען/ת ביקש/ה מ-Meta להפסיק לקבל הודעות מהעסק. זה
-- ביטול לכל דבר, גם אם לא נעשה דרך הדשבורד שלנו, ולכן הוא מנקה את
-- ‏`whatsapp_types` — ולא נוגע ב-`muted_types`: הפעמון בדשבורד ממשיך בדיוק
-- כפי שהיה. ‏update ולא upsert, כי הערוץ יכול להיות דלוק רק כשיש שורה.
-- ---------------------------------------------------------------------------
create or replace function public.notification_push_opt_out(p_agent_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.agent_notification_preferences
     set whatsapp_types = '{}'::text[],
         updated_at     = now()
   where agent_id = p_agent_id;
$$;

comment on function public.notification_push_opt_out(uuid) is
  'מכבה את ערוץ הוואטסאפ של ההתראות לסוכן/ת אחד/ת, אחרי שגיאת 131050 מ-Meta. הפעמון בדשבורד אינו נוגע בזה.';

revoke all on function public.notification_push_opt_out(uuid) from public;
revoke all on function public.notification_push_opt_out(uuid) from anon, authenticated;
grant execute on function public.notification_push_opt_out(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 14. התזמון
--
-- כל חמש דקות, ורק כשיש מה לשלוח. למה לא בטריגר על `notifications`: טריגר
-- אינו יכול לחכות לקיבוץ, ולכן ליד שנכנס עם התאמת לקוח/ה באותה שנייה היה
-- מייצר שתי הודעות וואטסאפ. חמש דקות הן גם חלון הקיבוץ וגם התשובה לשאלה
-- "כמה מהר צריך לדעת".
--
-- אידמפוטנטי: unschedule לפני schedule.
-- ---------------------------------------------------------------------------
do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/notification-push';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן — דחיפת ההתראות לא תוזמנה';
    return;
  end if;

  perform cron.unschedule('notification-push')
    where exists (select 1 from cron.job where jobname = 'notification-push');

  perform cron.schedule('notification-push', '*/5 * * * *', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1)))
    )
    where public.notification_push_ready();
  $cron$, v_url));
end;
$$;
