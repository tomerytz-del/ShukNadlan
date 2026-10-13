-- ---------------------------------------------------------------------------
-- ארכיון לידים סופי, קיבוץ לידים לפי פונה, וניקוי התראות של לקוח/ה שנמחק/ה
--
-- שלוש בקשות של סוכן/ת, וכולן אותו כשל: משהו שהוצא מהעבודה ממשיך להציק.
--
-- 1. **ליד בארכיון הוא ליד שנסגר.** עד כאן אפשר היה לארכב ליד בשלב "חדש"
--    או "בתיאום פגישה", והמשימה האוטומטית "לחזור לליד חדש" (lead_followup)
--    וההתראה new_lead בפעמון נשארו חיות - תזכורות על ליד שכבר הורד מהמסך.
--    עכשיו הארכוב מעביר את הליד לשלב סופי (לא רלוונטי / נסגר בהצלחה),
--    מבטל את משימת המעקב האוטומטית ומסמן את ההתראות שלו כנקראו (ולכן גם
--    הדחיפה לוואטסאפ, שבוחרת רק `not n.read`, לא תשלח אותן).
--    ה-CRM שואל איזה שלב לפני הארכוב; הטריגר כאן הוא הרשת לכל פתח אחר.
--
-- 2. **‏lead_visitor_groups()** - אילו לידים של הסוכן/ת הגיעו מאותו טלפון.
--    גולש/ת שעשה/תה חמש הדמיות על חמישה נכסים הוא/היא חמש שורות זהות
--    ברשימה. הפונקציה מחזירה לכל ליד את מזהה הליד הראשון של אותו/ה פונה -
--    ולא את הטלפון: ליד נעול לא חושף כך דבר מלבד "זה אותו אדם", וזה בדיוק
--    מה שמוכר אותו.
--
-- 3. **מחיקת לקוח/ה מוחקת את כל מה שתלוי בו/ה.** ‏notifications.related_client_id
--    ו-agent_agenda_items.client_id הם `on delete set null`, כלומר ההתראה
--    נשארה בפעמון בלי קישור, והתזכורת המשיכה לצלצל על מי שכבר לא בקובץ.
--    טריגר לפני מחיקה מוחק את ההתראות ואת פריטי היומן של הלקוח/ה (המחיקה
--    גוררת גם את התזכורות ואת תור ההודעות ללקוח/ה ב-cascade - ובכוונה
--    מחיקה ולא ביטול: ביטול פגישה עם client_notify שולח ללקוח/ה הודעת ביטול).
--    לקוח/ה שנסגר/ה (סגר/ה עסקה) מאבד/ת את התראות ההתאמה שלו/ה בפעמון -
--    ההתאמות עצמן כבר נעצרות שם (`c.status = 'active'` במנוע).
--
-- הקובץ אידמפוטנטי.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1א. ארכוב ליד: שלב סופי, ביטול משימת המעקב, וההתראות כנקראו
-- ---------------------------------------------------------------------------
create or replace function public.lead_archive_finalize()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.lead_work (lead_id, agent_id, stage, updated_at)
  values (new.lead_id, new.agent_id, 'not_relevant', now())
  on conflict (lead_id, agent_id) do update
    set stage = 'not_relevant', updated_at = now()
    where public.lead_work.stage not in ('not_relevant', 'won');

  -- רק המשימה האוטומטית: פגישה שהסוכן/ת קבע/ה ידנית נשארת החלטה שלו/ה
  update public.agent_agenda_items
     set status = 'canceled', updated_at = now()
   where lead_id = new.lead_id
     and agent_id = new.agent_id
     and auto_kind = 'lead_followup'
     and status = 'open';

  update public.notifications
     set read = true
   where agent_id = new.agent_id
     and related_lead_id = new.lead_id
     and not read;

  return null;
end;
$$;

revoke all on function public.lead_archive_finalize() from public, anon, authenticated;

drop trigger if exists lead_archives_finalize on public.lead_archives;
create trigger lead_archives_finalize
  after insert on public.lead_archives
  for each row execute function public.lead_archive_finalize();

-- 1ב. ליד בארכיון לא חוזר לשלב פתוח בלי לצאת מהארכיון
create or replace function public.lead_work_guard_archived()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.stage not in ('not_relevant', 'won')
     and exists (select 1 from public.lead_archives a
                  where a.lead_id = new.lead_id and a.agent_id = new.agent_id) then
    raise exception 'ליד בארכיון נשאר בשלב "לא רלוונטי" או "נסגר בהצלחה". כדי להחזיר אותו לעבודה - החזרה מהארכיון.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.lead_work_guard_archived() from public, anon, authenticated;

drop trigger if exists lead_work_guard_archived on public.lead_work;
create trigger lead_work_guard_archived
  before insert or update of stage on public.lead_work
  for each row execute function public.lead_work_guard_archived();

-- 1ג. מה שכבר בארכיון: אותו טיפול למפרע
insert into public.lead_work (lead_id, agent_id, stage, updated_at)
select a.lead_id, a.agent_id, 'not_relevant', now()
  from public.lead_archives a
on conflict (lead_id, agent_id) do update
  set stage = 'not_relevant', updated_at = now()
  where public.lead_work.stage not in ('not_relevant', 'won');

update public.agent_agenda_items i
   set status = 'canceled', updated_at = now()
  from public.lead_archives a
 where i.lead_id = a.lead_id
   and i.agent_id = a.agent_id
   and i.auto_kind = 'lead_followup'
   and i.status = 'open';

update public.notifications n
   set read = true
  from public.lead_archives a
 where n.related_lead_id = a.lead_id
   and n.agent_id = a.agent_id
   and not n.read;

-- ---------------------------------------------------------------------------
-- 2. ‏lead_visitor_groups - לידים של אותו/ה פונה
--
-- מחזירה רק לידים שיש להם אח: ליד יחיד אינו קבוצה. ‏visitor_id הוא מזהה
-- הליד הראשון בקבוצה - יציב, ואינו חושף את הטלפון. הטלפון מנורמל: ספרות
-- בלבד, ו-972 בהתחלה הופך ל-0.
-- ---------------------------------------------------------------------------
create or replace function public.lead_visitor_groups()
returns table (lead_id uuid, visitor_id uuid, visitor_leads int)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select public.current_agent_id() as id
  ), mine as (
    select l.id, l.created_at,
           case when x.d like '972%' then '0' || substr(x.d, 4) else x.d end as phone
      from public.leads l
      cross join me
      cross join lateral (select regexp_replace(coalesce(l.raw_phone, ''), '[^0-9]', '', 'g') as d) x
     where me.id is not null
       and (l.agent_id = me.id or l.referred_by = me.id)
  ), g as (
    select m.id,
           first_value(m.id) over (partition by m.phone order by m.created_at, m.id) as visitor_id,
           count(*) over (partition by m.phone) as n
      from mine m
     where length(m.phone) >= 9
  )
  select g.id, g.visitor_id, g.n::int from g where g.n > 1;
$$;

revoke all on function public.lead_visitor_groups() from public, anon, authenticated;
grant execute on function public.lead_visitor_groups() to authenticated;

comment on function public.lead_visitor_groups() is
  'לידים של הסוכן/ת המחובר/ת שהגיעו מאותו טלפון: לכל ליד מזהה הליד הראשון של אותו/ה פונה. בלי הטלפון עצמו - ראו 20270428090000.';

-- ---------------------------------------------------------------------------
-- 3א. מחיקת לקוח/ה: ההתראות ופריטי היומן שלו/ה נמחקים איתו/ה
-- ---------------------------------------------------------------------------
create or replace function public.agent_client_delete_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.notifications n
   where n.related_client_id = old.id
      or n.related_agenda_item_id in
         (select i.id from public.agent_agenda_items i where i.client_id = old.id);

  delete from public.agent_agenda_items i where i.client_id = old.id;

  return old;
end;
$$;

revoke all on function public.agent_client_delete_cleanup() from public, anon, authenticated;

drop trigger if exists agent_clients_delete_cleanup on public.agent_clients;
create trigger agent_clients_delete_cleanup
  before delete on public.agent_clients
  for each row execute function public.agent_client_delete_cleanup();

-- 3ב. לקוח/ה שנסגר/ה: התראות ההתאמה שלו/ה יורדות מהפעמון
create or replace function public.agent_client_closed_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.notifications n
   where n.related_client_id = new.id
     and n.type = 'client_match';
  return null;
end;
$$;

revoke all on function public.agent_client_closed_cleanup() from public, anon, authenticated;

drop trigger if exists agent_clients_closed_cleanup on public.agent_clients;
create trigger agent_clients_closed_cleanup
  after update of status on public.agent_clients
  for each row
  when (new.status = 'closed' and old.status is distinct from 'closed')
  execute function public.agent_client_closed_cleanup();

-- 3ג. למפרע: התראות התאמה של לקוחות סגורים, והתראות התאמה ללקוח/ה אחד/ת
-- שנמחק/ה. האחרונות כבר אינן מצביעות על הלקוח/ה (set null), ולכן הזיהוי
-- לפי השם: התראה על לקוח/ה יחיד/ה (לא "ל-3 לקוחות") שאיש בקובץ של אותו/ה
-- סוכן/ת אינו נושא את השם שבה.
delete from public.notifications n
 using public.agent_clients c
 where n.related_client_id = c.id
   and c.status = 'closed'
   and n.type = 'client_match';

delete from public.notifications n
 where n.type = 'client_match'
   and n.related_client_id is null
   and n.body !~ '[0-9]+ לקוחות'
   and not exists (
     select 1 from public.agent_clients c
      where c.agent_id = n.agent_id
        and length(btrim(c.full_name)) > 1
        and position(btrim(c.full_name) in n.body) > 0);
