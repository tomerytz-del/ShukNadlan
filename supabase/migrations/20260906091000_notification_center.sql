-- ============================================================================
-- מרכז ההתראות
--
-- שלוש הרחבות לפעמון, שכולן נשענות על אותה טבלת notifications הקיימת:
--
--   1. **ביקורת חדשה** — עד היום ביקורת שנכנסה למערכת לא צלצלה לאיש. הסוכן/ת
--      גילה/תה אותה רק כשנכנס/ה לדף הציבורי, והמנהל/ת רק כשפתח/ה במקרה את
--      "ביקורות ממתינות לאישור". שתי ההתראות נוצרות עכשיו ב-INSERT על reviews.
--
--   2. **עסקה שנסגרה בצוות** — נכס שסומן כנמכר/הושכר מייצר היום שורת עסקה
--      ‏(market_deals) ובקשת חוות דעת לסוכן/ת, אבל מנהל/ת המשרד — מי שאמור/ה
--      לדעת ראשון/ה שנסגרה עסקה במשרד — לא קיבל/ה כלום. ההתראה כוללת את שם
--      הסוכן/ת ואת פרטי הנכס, כי בלעדיהם היא לא שווה כלום למי שמנהל/ת עשרה
--      סוכנים.
--
--   3. **ניהול לפי סוג** — טבלת העדפות שמאפשרת לכבות סוג התראה מסוים.
--      ההעדפה נשמרת כרשימת *מושתקים* ולא כרשימת מאושרים, וזה העיקר: היעדר
--      שורה = קבלת הכול, וסוג התראה חדש שייכנס בעתיד יגיע לכולם כברירת מחדל
--      בלי מיגרציית backfill.
--
-- הסינון עצמו יושב בטריגר BEFORE INSERT על notifications ולא באתרי היצירה:
-- ההתראות נוצרות היום בשישה מקומות שונים (טריגר לידים, שיתוף נכסים, התאמות
-- לקוחות, בקשות חוות דעת, הסלמת 1★, ומעכשיו גם השניים כאן), וסינון בכל אחד
-- מהם בנפרד היה נשבר בפעם הראשונה שמישהו מוסיף סוג חדש ושוכח.
--
-- הקובץ אידמפוטנטי — אפשר להריץ אותו שוב.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. סוגי התראה חדשים
--
-- ‏review_new שונה מ-review_request (תזכורת לסוכן/ת *לבקש* חוות דעת) ומ-
-- ‏review_alert (הסלמת 1★ למנהל/ת הפלטפורמה): היא אומרת שביקורת כבר התקבלה.
-- ‏deal_closed מיועדת למנהל/ת המשרד בלבד.
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('new_lead','system','review_request','review_alert',
                  'client_match','review_new','deal_closed'));

-- ---------------------------------------------------------------------------
-- 2. העדפות ההתראות
--
-- ‏muted_types הוא רשימת הסוגים שהסוכן/ת ביקש/ה *לא* לקבל. אין שורה = אין
-- מושתקים = הכול נכנס, וזו בדיוק ברירת המחדל שהוגדרה למוצר.
-- ---------------------------------------------------------------------------
create table if not exists public.agent_notification_preferences (
  agent_id    uuid primary key references public.agency_members(id) on delete cascade,
  muted_types text[] not null default '{}',
  updated_at  timestamptz not null default now()
);

comment on table public.agent_notification_preferences is
  'סוגי ההתראות שסוכן/ת ביקש/ה להשתיק. היעדר שורה = קבלת כל ההתראות (ברירת המחדל).';
comment on column public.agent_notification_preferences.muted_types is
  'ערכים מתוך notifications.type. סוג שאינו ברשימה — מתקבל.';

alter table public.agent_notification_preferences enable row level security;

-- הסוכן/ת מנהל/ת אך ורק את השורה של עצמו/ה. אין policy למחיקה: הכיבוי
-- והדלקה נעשים דרך muted_types, ומחיקת השורה שקולה להדלקת הכול — מה שאפשר
-- לעשות ממילא בעדכון למערך ריק.
drop policy if exists "agent reads own notification preferences" on public.agent_notification_preferences;
create policy "agent reads own notification preferences"
  on public.agent_notification_preferences for select
  using (agent_id = public.current_agent_id());

drop policy if exists "agent creates own notification preferences" on public.agent_notification_preferences;
create policy "agent creates own notification preferences"
  on public.agent_notification_preferences for insert
  with check (agent_id = public.current_agent_id());

drop policy if exists "agent updates own notification preferences" on public.agent_notification_preferences;
create policy "agent updates own notification preferences"
  on public.agent_notification_preferences for update
  using (agent_id = public.current_agent_id())
  with check (agent_id = public.current_agent_id());

-- ---------------------------------------------------------------------------
-- 3. הסינון
--
-- ‏security definer כי הפונקציה נקראת מתוך טריגר שרץ בהקשר של מי שיצר את
-- ההתראה — לרוב סוכן/ת אחר/ת לגמרי, שאין לו/ה שום גישה לשורת ההעדפות של
-- הנמען/ת.
-- ---------------------------------------------------------------------------
create or replace function public.notification_type_enabled(p_agent_id uuid, p_type text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from agent_notification_preferences
     where agent_id = p_agent_id
       and p_type = any(muted_types)
  );
$$;

comment on function public.notification_type_enabled(uuid, text) is
  'האם סוכן/ת מקבל/ת סוג התראה מסוים. true גם כשאין לו/ה שורת העדפות — ברירת המחדל היא קבלת הכול.';

create or replace function public.notifications_apply_preferences()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- החזרת null ב-BEFORE INSERT מבטלת את השורה בשקט. זו ההתנהגות הרצויה:
  -- מי שכיבה/תה סוג התראה לא אמור/ה לראות אותו בפעמון, והפעולה שיצרה אותה
  -- (שמירת נכס, הכנסת ליד) חייבת להצליח בכל מקרה.
  if not public.notification_type_enabled(new.agent_id, new.type) then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists notifications_apply_preferences on public.notifications;
create trigger notifications_apply_preferences
  before insert on public.notifications
  for each row execute function public.notifications_apply_preferences();

-- ---------------------------------------------------------------------------
-- 4. ביקורת חדשה
--
-- שתי התראות נפרדות ולא אחת משותפת, כי המשמעות שונה: לסוכן/ת זו בשורה על
-- עצמו/ה, ולמנהל/ת זו משימה — ביקורת שממתינה להחלטה שלו/ה. מנהל/ת שהיא גם
-- הסוכן/ת שעליו/ה נכתבה הביקורת מקבל/ת התראה אחת בלבד.
--
-- הטריגר נפרד מ-reviews_alert_platform_admin ולא מוזג לתוכו: זו הסלמה למנהל/ת
-- הפלטפורמה על 1★ בלבד, וכאן מדובר בכל ביקורת.
-- ---------------------------------------------------------------------------
create or replace function public.notify_on_new_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent_name text;
  v_reviewer   text;
  v_stars      text;
  v_excerpt    text;
  v_mgr        uuid;
begin
  select display_name into v_agent_name from agency_members where id = new.agent_id;

  v_reviewer := coalesce(nullif(btrim(new.reviewer_display_name), ''), 'לקוח/ה מאומת/ת');
  v_stars    := repeat('★', greatest(coalesce(new.rating, 0), 0))
             || repeat('☆', greatest(5 - coalesce(new.rating, 0), 0));

  -- הציטוט נחתך: הפעמון הוא כותרת, לא מסך קריאה. הביקורת המלאה יושבת
  -- בקטגוריית הביקורות ובדף הסוכן/ת.
  v_excerpt := nullif(btrim(coalesce(new.text, '')), '');
  if v_excerpt is not null and length(v_excerpt) > 90 then
    v_excerpt := left(v_excerpt, 88) || '…';
  end if;

  if new.agent_id is not null then
    insert into notifications (agent_id, type, title, body, related_lead_id)
    values (
      new.agent_id,
      'review_new',
      'התקבלה עליך ביקורת חדשה',
      v_stars || ' · ' || v_reviewer
        || case new.status when 'published' then ' · פורסמה' else ' · ממתינה לאישור המשרד' end
        || coalesce(' · "' || v_excerpt || '"', ''),
      new.linked_lead_id
    );
  end if;

  -- ביקורת שכבר נולדה מפורסמת או דחויה אינה משימה לאיש
  if new.status = 'pending' then
    for v_mgr in
      select id from agency_members
       where agency_id = new.agency_id
         and role = 'manager'
         and active = true
         and id is distinct from new.agent_id
    loop
      insert into notifications (agent_id, type, title, body, related_lead_id)
      values (
        v_mgr,
        'review_new',
        'ביקורת חדשה ממתינה לאישור',
        coalesce(v_agent_name, 'סוכן/ת') || ' · ' || v_stars || ' · ' || v_reviewer
          || coalesce(' · "' || v_excerpt || '"', ''),
        new.linked_lead_id
      );
    end loop;
  end if;

  return new;
end;
$$;

comment on function public.notify_on_new_review() is
  'מצלצלת בפעמון על ביקורת חדשה: לסוכן/ת שעליו/ה נכתבה, ולמנהלי המשרד כשהיא ממתינה לאישור.';

drop trigger if exists reviews_notify_new on public.reviews;
create trigger reviews_notify_new
  after insert on public.reviews
  for each row execute function public.notify_on_new_review();

-- ---------------------------------------------------------------------------
-- 5. עסקה שנסגרה בצוות
--
-- ‏"אצל כל אחד מהסוכנים שלו" — ולכן החיפוש הוא לפי agency_id של הנכס ולא לפי
-- מי לחץ/ה על הכפתור: גם עדכון סטטוס שהגיע מייבוא קובץ, מהבוט בוואטסאפ או
-- מ-Edge Function מייצר את ההתראה.
--
-- הסוכן/ת עצמו/ה לא מקבל/ת עותק — הוא/היא זה/ו שסימן/ה. מנהל/ת שסימן/ה נכס
-- של עצמו/ה לא מקבל/ת התראה על פעולה שהרגע ביצע/ה (id is distinct from
-- agent_id), אבל כן מקבל/ת על נכס של כל סוכן/ת אחר/ת במשרד.
-- ---------------------------------------------------------------------------
create or replace function public.notify_managers_on_deal_closed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent_name text;
  v_hood       text;
  v_where      text;
  v_rooms      text;
  v_title      text;
  v_body       text;
  v_mgr        uuid;
begin
  if new.status not in ('sold','rented') or old.status is not distinct from new.status then
    return new;
  end if;
  if new.agency_id is null then
    return new;
  end if;

  select display_name into v_agent_name from agency_members where id = new.agent_id;
  select name         into v_hood       from neighborhoods  where id = new.neighborhood_id;

  -- הכתובת המדויקת קודמת, ואם אין — הרחוב, השכונה, ולבסוף העיר. משהו מזה
  -- תמיד קיים, ובלעדיו המנהל/ת לא יודע/ת על איזה נכס מדובר.
  v_where := coalesce(
    nullif(btrim(coalesce(new.address, '')), ''),
    nullif(btrim(coalesce(new.street, '') || ' ' || coalesce(new.house_number, '')), ''),
    v_hood,
    nullif(btrim(coalesce(new.city, '')), '')
  );

  -- ‏rooms הוא numeric: 3 יוצג "3" ו-3.5 יוצג "3.5", ולא "3.0"
  v_rooms := case
    when new.rooms is null then null
    when new.rooms = trunc(new.rooms) then trunc(new.rooms)::bigint::text
    else new.rooms::text
  end;

  v_title := case new.status when 'sold' then '🎉 נכס נמכר במשרד' else '🎉 נכס הושכר במשרד' end;

  v_body := coalesce(v_agent_name, 'סוכן/ת')
    || ' · ' || coalesce(nullif(btrim(coalesce(new.title, '')), ''), 'נכס')
    || coalesce(' · ' || v_where, '')
    || coalesce(' · ' || v_rooms || ' חד׳', '')
    || case when coalesce(new.price, 0) > 0
            then ' · ₪' || to_char(new.price, 'FM999,999,999,999')
            else '' end;

  for v_mgr in
    select id from agency_members
     where agency_id = new.agency_id
       and role = 'manager'
       and active = true
       and id is distinct from new.agent_id
  loop
    insert into notifications (agent_id, type, title, body)
    values (v_mgr, 'deal_closed', v_title, v_body);
  end loop;

  return new;
end;
$$;

comment on function public.notify_managers_on_deal_closed() is
  'מודיעה למנהלי המשרד על נכס שסומן כנמכר/הושכר, כולל שם הסוכן/ת ופרטי הנכס.';

drop trigger if exists properties_notify_deal_closed on public.properties;
create trigger properties_notify_deal_closed
  after update on public.properties
  for each row execute function public.notify_managers_on_deal_closed();
