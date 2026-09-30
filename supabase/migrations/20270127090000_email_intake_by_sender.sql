-- ============================================================================
-- קליטה מהמייל: גם ישר לכתובת הרגילה, בלי טוקן.
--
-- עד כאן מייל נקלט רק כשנשלח ל-shuknadlan+<token>@gmail.com. מעכשיו גם
-- מייל שנשלח ישר ל-shuknadlan@gmail.com נקלט — כשהשולח הוא הכתובת הרשומה
-- של סוכן/ת (‏agency_members.email או מייל ההתחברות), **וגם** Gmail אימת
-- אותו (‏dmarc=pass או dkim=pass על הדומיין של ה-From). בלי האימות ה-From
-- הוא טקסט שכל אחד כותב, והמייל נשאר בתיבה כמו כל מייל אחר.
--
-- הטוקן נשאר, ולא רק כגיבוי: העברה אוטומטית (לידים מאתר) משאירה את הפונה
-- כשולח, ושם רק הכתובת האישית מזהה בשם מי המייל.
--
-- ‏docs/email-intake.md
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. איך זוהה/תה הסוכן/ת — ליומן ולתחקור
-- ---------------------------------------------------------------------------
alter table public.email_intake_messages
  add column if not exists via text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'email_intake_messages_via_check') then
    alter table public.email_intake_messages
      add constraint email_intake_messages_via_check check (via in ('token', 'sender'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. נרמול כתובת להשוואה
--
-- ‏Gmail מתעלם מנקודות ומסיומת + בחלק המקומי: ‏Tomer.Y+x@gmail.com היא אותה
-- תיבה כמו tomery@gmail.com. בדומיינים אחרים זה אינו נכון, ושם רק אותיות.
-- ---------------------------------------------------------------------------
create or replace function public.email_intake_norm(p_email text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when split_part(lower(trim(p_email)), '@', 2) in ('gmail.com', 'googlemail.com')
      then replace(split_part(split_part(lower(trim(p_email)), '@', 1), '+', 1), '.', '')
           || '@gmail.com'
    else lower(trim(p_email))
  end;
$$;

revoke all on function public.email_intake_norm(text) from public, anon, authenticated;
grant execute on function public.email_intake_norm(text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. מי הסוכן/ת מאחורי כל כתובת
--
-- ‏security definer כי מייל ההתחברות יושב ב-auth.users. כתובת שמתאימה ליותר
-- מסוכן/ת אחד/ת **אינה מוחזרת**: אין דרך לדעת בשם מי לפעול, וניחוש היה
-- מכניס לקוח לקובץ של מישהו אחר.
-- ---------------------------------------------------------------------------
create or replace function public.email_intake_agents_by_email(p_emails text[])
returns table (email text, agent_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  with wanted as (
    select distinct lower(e) as email, public.email_intake_norm(e) as norm
      from unnest(p_emails) e
     where e is not null and e like '%@%'
  ),
  known as (
    select m.id as agent_id, public.email_intake_norm(m.email) as norm
      from public.agency_members m
     where m.email is not null
    union
    select m.id, public.email_intake_norm(u.email)
      from public.agency_members m
      join auth.users u on u.id = m.user_id
     where u.email is not null
  ),
  hits as (
    select w.email, k.agent_id
      from wanted w
      join known k on k.norm = w.norm
  )
  select h.email, min(h.agent_id::text)::uuid
    from hits h
   group by h.email
  having count(distinct h.agent_id) = 1;
$$;

comment on function public.email_intake_agents_by_email(text[]) is
  'קליטה מהמייל: הסוכן/ת שהכתובת הרשומה שלו/ה (agency_members.email או מייל ההתחברות) היא השולח. כתובת של יותר מסוכן/ת אחד/ת אינה מוחזרת.';

revoke all on function public.email_intake_agents_by_email(text[]) from public, anon, authenticated;
grant execute on function public.email_intake_agents_by_email(text[]) to service_role;

-- ---------------------------------------------------------------------------
-- 4. התזמון — בלי התנאי על agent_email_intake
--
-- התנאי שם אמר "אין מה לקרוא עד שמישהו ביקש כתובת". מעכשיו כל סוכן/ת יכול/ה
-- לשלוח ישר, בלי לבקש דבר, ולכן הסבב רץ תמיד. הוא זול: כניסה אחת ל-IMAP
-- וכותרות של מה שחדש מאז הסבב הקודם.
-- ---------------------------------------------------------------------------
do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/whatsapp-webhook?task=email-intake';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן — קליטת המייל לא תוזמנה';
    return;
  end if;

  perform cron.unschedule('email-intake')
    where exists (select 1 from cron.job where jobname = 'email-intake');

  perform cron.schedule('email-intake', '*/2 * * * *', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1))),
      timeout_milliseconds := 5000
    );
  $cron$, v_url));
end;
$$;
