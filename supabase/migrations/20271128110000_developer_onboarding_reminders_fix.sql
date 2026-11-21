-- ============================================================================
-- תיקוני סקירה לתזכורות מדריך ההתחלה ליזמים (20271125090000, 20271127100000)
--
-- 1. התזכורת השנייה יצאה יום אחרי הראשונה כשהראשונה התעכבה בגלל כשלי מייל: עכשיו לפחות שבוע ביניהן.
-- 2. כתובת שנכשלת תמיד נוסתה לנצח, והפעילה את ה-cron כל יום: עכשיו רק ב-30 הימים הראשונים מהפתיחה.
-- אותו תיקון בתזכורות בעלי המקצוע (20271128090000).
--
-- אידמפוטנטית.
-- ============================================================================

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
       -- התזכורת השנייה לפחות שבוע אחרי הראשונה, גם אם הראשונה התעכבה בגלל כשלי מייל; ניסיון חוזר אחרי כישלון: יום
       and coalesce(d.onboarding_reminder_at, 'epoch'::timestamptz)
             <= now() - case d.onboarding_reminders_sent when 0 then interval '1 day' else interval '7 days' end
     -- מי שהמייל שלו נכשל (onboarding_reminder_at עודכן בלי להעלות את המונה) יורד לסוף התור: אחרת 20 כתובות
     -- פגומות היו חוסמות כל יום את כל השאר
     order by coalesce(d.onboarding_reminder_at, d.created_at)
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

revoke all on function public.developer_onboarding_reminders_due(int) from public, anon, authenticated;
grant execute on function public.developer_onboarding_reminders_due(int) to service_role;
