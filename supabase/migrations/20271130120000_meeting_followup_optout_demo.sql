-- ============================================================================
-- פולואפ פגישה, המשך ל-#1397: חשבונות הדגמה, ועצירת ההודעות כשהנמען/ת מבקש/ת.
--
-- version 20271130120000. agenda_phone_e164 מוסיפה 972 רק למספר ישראלי (0 ואחריו 9 ספרות).
-- agent_agenda_client_claim ו-agent_agenda_contact נבנו מהגרסה האחרונה שלהן,
-- 20271130110000_meeting_followup_leads. אף מיגרציה מאוחרת יותר לא הגדירה אותן מחדש.
--
--   1. חשבון הדגמה (משרד "משרד הדגמה" cf863e10-c25d-41ed-8b22-d6899a56e95d, ו-
--      play.review@shuknadlan.co.il) אינו שולח פולואפ לאיש: לא לליד ולא ללקוח/ה.
--      claim מדלגת (skipped, error = demo_account), ו-agent_agenda_contact אינה
--      מחזירה איש קשר לסוכן/ת כזה/זו.
--   2. 131050 (הנמען/ת ביקש/ה מ-Meta להפסיק לקבל הודעות מהעסק): מבטלים את כל
--      ההודעות הממתינות לאותו מספר טלפון, לא רק את השורה שנדחתה.
--   2ב. מספר שקיבל 131050 נרשם ב-whatsapp_optouts ואינו מקבל שום פולואפ, גם על פגישה
--      חדשה, עד שהוא כותב לנו בעצמו (whatsapp_optout_clear).
--   3. תשובה חופשית "הסר" וכדומה: מבטלים את ההודעות הממתינות של הפגישות שאליהן
--      נשלחו הודעות לאותו מספר. הזיהוי של המילים נעשה ב-whatsapp-webhook.
--
-- שני המסלולים (2 ו-3) מסמנים את השורות הממתינות opted_out ומכבים client_notify
-- על הפריט: בלי הכיבוי, הזזת הפגישה בונה מחדש את התזכורות (agent_agenda_client_schedule)
-- ושולחת שוב למי שביקש/ה להפסיק. השורות מסומנות לפני הכיבוי, כי הטריגר מוחק רק
-- שורות pending, וכך הרישום נשאר.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. עזרים: נרמול טלפון (כמו phoneE164 בשולח) וחשבון הדגמה
-- ---------------------------------------------------------------------------
-- מספר ישראלי: 0 ואחריו 9 ספרות (נייד, 10 ספרות בסך הכול) או 972 ואחריו 9 ספרות. מספר
-- בינלאומי אחר מגיע עם קידומת מדינה (11-15 ספרות, לא מתחיל ב-0) ונשאר כמו שהוא. כל השאר
-- (9 ספרות או פחות, 10 ספרות שאינן 0 ואחריו 9, קו קווי) אינו מתאים לאיש: לא מוסיפים לו 972.
create or replace function public.agenda_phone_e164(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when d ~ '^0[0-9]{9}$'            then '972' || substr(d, 2)
    when d ~ '^972[0-9]{9}$'          then d
    when d ~ '^[1-9][0-9]{10,14}$'    then d
    else null
  end
  from (
    select case when raw like '00%' then substr(raw, 3) else raw end as d
    from (select regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') as raw) x
  ) y;
$$;

revoke all on function public.agenda_phone_e164(text) from public, anon, authenticated;
grant execute on function public.agenda_phone_e164(text) to service_role;

create or replace function public.agent_agenda_is_demo(p_agent_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.agency_members m
     where m.id = p_agent_id
       and (m.agency_id = 'cf863e10-c25d-41ed-8b22-d6899a56e95d'::uuid
            or lower(coalesce(m.email, '')) = 'play.review@shuknadlan.co.il')
  );
$$;

revoke all on function public.agent_agenda_is_demo(uuid) from public, anon, authenticated;
grant execute on function public.agent_agenda_is_demo(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. איש הקשר: אין איש קשר לסוכן/ת של חשבון הדגמה
-- ---------------------------------------------------------------------------
create or replace function public.agent_agenda_contact(
  p_agent_id  uuid,
  p_client_id uuid,
  p_lead_id   uuid
)
returns table (full_name text, phone text, source text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.full_name, c.phone, 'client'::text
    from public.agent_clients c
   where p_client_id is not null and c.id = p_client_id
     and not public.agent_agenda_is_demo(p_agent_id)
  union all
  select l.raw_name, l.raw_phone, 'lead'::text
    from public.leads l
   where p_client_id is null
     and p_lead_id is not null
     and l.id = p_lead_id
     and l.agent_id = p_agent_id
     and l.status = 'unlocked'
     and not public.agent_agenda_is_demo(p_agent_id)
  limit 1;
$$;

revoke all on function public.agent_agenda_contact(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.agent_agenda_contact(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2ב. מספרים שביקשו להפסיק לקבל הודעות מהעסק (131050)
--
-- מספר שבטבלה אינו מקבל שום הודעה יזומה, גם על פגישות שייקבעו אחר כך, עד שהוא כותב לנו
-- בעצמו (whatsapp_optout_clear, נקראת מהוובהוק בהודעה נכנסת מאותו מספר). נכתבת רק מ-131050,
-- לא מתשובה חופשית. כרגע רק פולואפ הפגישות קורא אותה; שולח אחר צריך לבדוק אותה בעצמו.
-- ---------------------------------------------------------------------------
create table if not exists public.whatsapp_optouts (
  phone_e164 text primary key,
  source     text not null default '131050',
  created_at timestamptz not null default now()
);

comment on table public.whatsapp_optouts is
  'מספרי טלפון (972...) שקיבלו 131050 מ-Meta: אינם מקבלים הודעה יזומה עד שהם כותבים לנו. נכתבת ב-agent_agenda_client_opt_out_phone, נמחקת ב-whatsapp_optout_clear. docs/meeting-client-followup.md';

alter table public.whatsapp_optouts enable row level security;
revoke all on public.whatsapp_optouts from anon;
revoke all on public.whatsapp_optouts from authenticated;
grant all on public.whatsapp_optouts to service_role;

create or replace function public.whatsapp_optout_clear(p_phone text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  delete from public.whatsapp_optouts where phone_e164 = public.agenda_phone_e164(p_phone);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.whatsapp_optout_clear(text) from public, anon, authenticated;
grant execute on function public.whatsapp_optout_clear(text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. claim: חשבון הדגמה מדולג
-- ---------------------------------------------------------------------------
create or replace function public.agent_agenda_client_claim(p_limit int default 30)
returns table (
  message_id    uuid,
  kind          text,
  item_id       uuid,
  item_kind     text,
  title         text,
  due_at        timestamptz,
  location      text,
  token         text,
  client_name   text,
  client_phone  text,
  agent_id      uuid,
  agent_name    text,
  agent_phone   text,
  agency_name   text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  r      record;
  v_skip boolean;
  v_demo boolean;
  v_blocked boolean;
begin
  for r in
    select m.id, m.kind, i.id as i_id, i.kind as i_kind, i.title, i.due_at,
           i.location, i.client_token, i.status, i.agent_id, i.client_response,
           c.full_name, c.phone, a.display_name, a.phone as a_phone, ag.name as agency_name
      from public.agent_agenda_client_messages m
      join public.agent_agenda_items i on i.id = m.item_id
      left join lateral public.agent_agenda_contact(i.agent_id, i.client_id, i.lead_id) c on true
      left join public.agency_members a on a.id = i.agent_id
      left join public.agencies ag on ag.id = a.agency_id
     where m.status = 'pending'
       and m.due_at <= now()
     order by m.due_at
     limit greatest(1, least(p_limit, 100))
     for update of m skip locked
  loop
    -- חשבון הדגמה אינו שולח דבר לאיש: לא ללידים ולא ללקוחות (גם בנתיב הלקוח)
    v_demo := public.agent_agenda_is_demo(r.agent_id);
    -- מספר שקיבל 131050 אינו מקבל שום הודעה יזומה, גם על פגישה חדשה, עד שיכתוב לנו בעצמו
    v_blocked := exists (select 1 from public.whatsapp_optouts o
                          where o.phone_e164 = public.agenda_phone_e164(r.phone));
    v_skip := v_demo or v_blocked
      or not public.agent_agenda_enabled(r.agent_id)
      or case r.kind
           when 'cancel'   then false
           when 'feedback' then r.status = 'canceled'
                             or r.client_response is not distinct from 'canceled'
                             or r.due_at < now() - interval '2 days'
           else r.status <> 'open' or r.due_at <= now()
         end
      or (r.kind <> 'noreply'
          and (select count(*) from public.agent_agenda_client_messages x
                where x.item_id = r.i_id and x.status = 'sent' and x.kind <> 'noreply') >= 10);

    if not v_skip and r.kind = 'noreply' then
      v_skip := r.client_response is not null
        or not exists (select 1 from public.agent_agenda_client_messages x
                        where x.item_id = r.i_id and x.status = 'sent'
                          and x.kind in ('reminder','reminder_day'));
      if not v_skip then
        insert into public.notifications (agent_id, type, title, body, related_agenda_item_id, suppress_push)
        values (
          r.agent_id,
          'agenda_reminder',
          left('⏳ ' || coalesce(r.full_name, 'הלקוח/ה') || ' עוד לא אישר/ה הגעה', 200),
          left(concat_ws(' · ', r.title, public.agent_agenda_when_text(r.due_at),
                         'התזכורת יצאה ולא נענתה - כדאי להתקשר'), 400),
          r.i_id,
          false);
        update public.agent_agenda_client_messages
           set status = 'sent', sent_at = now()
         where id = r.id;
      end if;
    end if;

    if v_skip then
      update public.agent_agenda_client_messages
         set status = 'skipped', sent_at = now(),
             error = case when v_demo then 'demo_account'
                          when v_blocked then 'number_blocked'
                          else error end
       where id = r.id;
      continue;
    end if;

    if r.kind <> 'noreply' then
      update public.agent_agenda_client_messages set status = 'sending' where id = r.id;
    end if;

    message_id   := r.id;
    kind         := r.kind;
    item_id      := r.i_id;
    item_kind    := r.i_kind;
    title        := r.title;
    due_at       := r.due_at;
    location     := r.location;
    token        := r.client_token;
    client_name  := r.full_name;
    client_phone := r.phone;
    agent_id     := r.agent_id;
    agent_name   := r.display_name;
    agent_phone  := r.a_phone;
    agency_name  := r.agency_name;
    return next;
  end loop;
end;
$$;

revoke all on function public.agent_agenda_client_claim(int) from public, anon, authenticated;
grant execute on function public.agent_agenda_client_claim(int) to service_role;

-- ---------------------------------------------------------------------------
-- 4. עצירה: ביטול ההודעות הממתינות למספר טלפון
--
-- p_require_sent = false (131050): כל פריט שאיש הקשר שלו הוא המספר.
-- p_require_sent = true (תשובה חופשית): רק פריט שנשלחה אליו הודעה למספר ב-7 הימים
-- האחרונים (לא noreply), כדי ש"לא רלוונטי" על דבר אחר לא יפיל פגישה שלא קשורה.
-- **כל** הודעה ממתינה נעצרת, כולל "איך היה הסיור" (feedback), גם אם הפגישה כבר התחילה או
-- סומנה "בוצע": מי שביקש/ה להפסיק אינו/ה רוצה גם את השאלה אחרי הסיור.
-- מחזירה שורה לכל פריט שנעצרה בו לפחות הודעה אחת, כדי שהוובהוק יעדכן את הסוכן/ת ויענה
-- לנמען/ת רק כשבאמת נעצר משהו. זה בכוונה על כל הסוכנים: מי שביקש/ה להפסיק קיבל/ה את
-- ההודעה מהמספר של שוק נדל״ן ולא מסוכן/ת.
-- ---------------------------------------------------------------------------
create or replace function public.agent_agenda_client_stop(p_phone text, p_require_sent boolean)
returns table (item_id uuid, agent_id uuid, title text, due_at timestamptz,
               contact_name text, cancelled int)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_e164 text := public.agenda_phone_e164(p_phone);
  r      record;
  v_n    int;
begin
  if v_e164 is null then
    return;
  end if;

  for r in
    select i.id as i_id, i.agent_id as a_id, i.title as i_title, i.due_at as i_due, c.full_name as c_name
      from public.agent_agenda_items i
      cross join lateral public.agent_agenda_contact(i.agent_id, i.client_id, i.lead_id) c
     where i.client_notify
       and i.kind in ('meeting','showing','signing')
       and public.agenda_phone_e164(c.phone) = v_e164
       and (not p_require_sent
            or exists (select 1 from public.agent_agenda_client_messages m
                        where m.item_id = i.id and m.status = 'sent' and m.kind <> 'noreply'
                          and m.sent_at > now() - interval '7 days'))
     for update of i
  loop
    -- קודם השורות (הטריגר מוחק רק pending), ואז הכיבוי
    update public.agent_agenda_client_messages
       set status = 'opted_out', error = 'recipient_opted_out', sent_at = now()
     where item_id = r.i_id and status = 'pending';
    get diagnostics v_n = row_count;

    update public.agent_agenda_items set client_notify = false where id = r.i_id;

    -- רק פריט שבאמת נעצרה בו הודעה מדווח: הוובהוק מתריע לסוכן/ת ועונה לנמען/ת רק עליו
    if v_n > 0 then
      item_id := r.i_id; agent_id := r.a_id; title := r.i_title; due_at := r.i_due;
      contact_name := r.c_name; cancelled := v_n;
      return next;
    end if;
  end loop;
end;
$$;

revoke all on function public.agent_agenda_client_stop(text, boolean) from public, anon, authenticated;
grant execute on function public.agent_agenda_client_stop(text, boolean) to service_role;

-- 131050 על הודעה: המספר נלקח מאיש הקשר של הפריט שלה. עוצרת את כל הממתין למספר, ורושמת
-- אותו בטבלת החסימות, כך שגם פגישה חדשה אליו לא תישלח עד שיכתוב לנו.
create or replace function public.agent_agenda_client_opt_out_phone(p_message_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text;
  v_n     int;
begin
  select c.phone into v_phone
    from public.agent_agenda_client_messages m
    join public.agent_agenda_items i on i.id = m.item_id
    cross join lateral public.agent_agenda_contact(i.agent_id, i.client_id, i.lead_id) c
   where m.id = p_message_id;

  if public.agenda_phone_e164(v_phone) is not null then
    insert into public.whatsapp_optouts (phone_e164) values (public.agenda_phone_e164(v_phone))
    on conflict (phone_e164) do nothing;
  end if;

  select coalesce(sum(s.cancelled), 0)::int into v_n
    from public.agent_agenda_client_stop(v_phone, false) s;
  return v_n;
end;
$$;

revoke all on function public.agent_agenda_client_opt_out_phone(uuid) from public, anon, authenticated;
grant execute on function public.agent_agenda_client_opt_out_phone(uuid) to service_role;
