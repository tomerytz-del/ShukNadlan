-- ============================================================================
-- תיקוני תזמון לתזכורות מדריך ההתחלה ליזמים (20271125090000, 20271127100000, 20271127110000)
--
-- 1. **ניסיון חוזר אחרי כישלון: יום, בשתי התזכורות** (גם בשנייה; קודם מועד הכישלון נרשם כמועד השליחה והשנייה
--    המתינה 7 ימים). עכשיו יש `onboarding_attempt_at` (כל ניסיון) נפרד מ-`onboarding_reminder_at` (שליחה
--    מוצלחת), והמרווח של שבוע נמדד מהשליחה בלבד.
-- 2. התזכורת השנייה לפחות שבוע אחרי הראשונה, ותזכורות רק ב-30 הימים הראשונים מהפתיחה.
-- 3. **ימים א'-ה' בלבד**: התזמון נרשם מחדש עם `0-4`, והפונקציה דוחה גם חגים (_shared/il-workday.ts).
-- אותו תיקון בתזכורות בעלי המקצוע (20271128090000).
--
-- אידמפוטנטית.
-- ============================================================================

alter table public.developers add column if not exists onboarding_attempt_at timestamptz;

comment on column public.developers.onboarding_attempt_at is
  'מועד הניסיון האחרון לשלוח תזכורת, הצליח או נכשל. ניסיון חוזר אחרי כישלון: יום. נקבע ב-mark_developer_onboarding_reminder.';
comment on column public.developers.onboarding_reminder_at is
  'מועד השליחה המוצלחת האחרונה (המרווח של שבוע בין התזכורות נמדד ממנו).';

create or replace function public.developer_onboarding_reminders_due(p_limit int default 20)
returns table (developer_id uuid, email text, contact_name text, company_name text, reminder_no int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  r      record;
  v_out  int := 0;
  v_max  int := greatest(1, least(coalesce(p_limit, 20), 100));
begin
  -- קודם הסינון הזול (זמן ומספר תזכורות), ורק אחריו חישוב המצב המלא לכל מועמד/ת
  for r in
    select d.id, d.email, d.contact_name, d.name, d.onboarding_reminders_sent
      from public.developers d
     where d.status = 'active' and d.closed_at is null
       and d.email is not null and btrim(d.email) <> ''
       and d.onboarding_reminders_sent < 2
       and d.created_at <= now() - case d.onboarding_reminders_sent when 0 then interval '3 days'
                                                                    else interval '10 days' end
       -- חלון של 30 יום מהפתיחה: כתובת שנכשלת תמיד אינה מנוסה לנצח (גם תנאי ה-cron נעצר איתה)
       and d.created_at > now() - interval '30 days'
       -- ניסיון חוזר אחרי כישלון: יום (בשתי התזכורות). והתזכורת השנייה לפחות שבוע אחרי **השליחה** הראשונה
       and coalesce(d.onboarding_attempt_at, 'epoch'::timestamptz) <= now() - interval '1 day'
       and (d.onboarding_reminders_sent = 0
            or coalesce(d.onboarding_reminder_at, 'epoch'::timestamptz) <= now() - interval '7 days')
     -- מי שהמייל שלו נכשל (onboarding_reminder_at עודכן בלי להעלות את המונה) יורד לסוף התור: אחרת 20 כתובות
     -- פגומות היו חוסמות כל יום את כל השאר
     order by coalesce(d.onboarding_attempt_at, d.created_at)
     limit 200
  loop
    exit when v_out >= v_max;

    -- מי שהשלים/ה את המדריך לפני התזכורת: אין מה לשלוח, ומסמנים כדי שלא ייבדק שוב בכל ריצה
    if coalesce((public.developer_onboarding_state(r.id)->>'complete')::boolean, false) then
      update public.developers set onboarding_reminders_sent = 2 where id = r.id;
      continue;
    end if;

    developer_id := r.id;
    email        := r.email;
    contact_name := r.contact_name;
    company_name := r.name;
    reminder_no  := r.onboarding_reminders_sent + 1;
    v_out := v_out + 1;
    return next;
  end loop;
end;
$$;

create or replace function public.mark_developer_onboarding_reminder(p_developer_id uuid, p_no int)
returns void
language sql
security definer
set search_path = ''
as $$
  -- רק קדימה. מועד השליחה (שממנו נמדד השבוע) נקבע רק כשהמונה עולה בפועל; ניסיון שנכשל (p_no לא גבוה מהמונה)
  -- מעדכן רק את מועד הניסיון. הערכים בצד ימין הם של לפני העדכון, ולכן ההשוואה נכונה
  update public.developers
     set onboarding_reminders_sent = greatest(onboarding_reminders_sent, p_no),
         onboarding_reminder_at = case when p_no > onboarding_reminders_sent then now() else onboarding_reminder_at end,
         onboarding_attempt_at = now()
   where id = p_developer_id;
$$;

revoke all on function public.mark_developer_onboarding_reminder(uuid, int) from public, anon, authenticated;
grant execute on function public.mark_developer_onboarding_reminder(uuid, int) to service_role;

revoke all on function public.developer_onboarding_reminders_due(int) from public, anon, authenticated;
grant execute on function public.developer_onboarding_reminders_due(int) to service_role;

-- התזמון: ימים א'-ה' בלבד (הפונקציה דוחה חגים). אותו תנאי של 20271127110000
do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/developer-onboarding-reminders';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - תזכורות מדריך ההתחלה ליזמים לא תוזמנו מחדש';
    return;
  end if;

  perform cron.unschedule('developer-onboarding-reminders')
    where exists (select 1 from cron.job where jobname = 'developer-onboarding-reminders');
  perform cron.schedule('developer-onboarding-reminders', '41 7 * * 0-4', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1))),
      timeout_milliseconds := 30000
    )
    where exists (select 1 from public.developer_onboarding_reminders_due(1));
  $cron$, v_url));
end;
$$;
