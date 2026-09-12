-- ============================================================================
-- צלצול בפעמון על חתימה מרחוק
--
-- ‏עד היום חתימה מרחוק הייתה האירוע היחיד במערכת שהסוכן/ת גילה/תה רק
-- במקרה: המסמך נשלח בקישור אישי, הלקוח/ה חתם/ה בערב מהטלפון, והעותק
-- החתום יצא במייל — אבל שום דבר ב-CRM לא אמר שזה קרה. מי שלא פתח/ה את
-- קטגוריית ההסכמים לא ידע/ה שההסכם חתום.
--
-- ‏**החתימה הידנית אינה מצלצלת, ובכוונה.** מי שחתם/ה על המכשיר של הסוכן/ת
-- חתם/ה מולו/ה; התראה על פעולה שהרגע ראה/תה במו עיניו/ה היא רעש. הטריגר
-- מסנן לפי method = 'remote' בלבד.
--
-- ‏שתי כותרות ולא אחת: חתימה שסוגרת את המעגל ("כל הצדדים חתמו") היא בשורה
-- אחרת לגמרי מחתימה של אחד מבני זוג שממתין לשני. הספירה נעשית כאן ולא
-- נקראת מ-agreements.status, כי הטריגר agreement_signers_sync שמעדכן את
-- הסטטוס רץ **אחרי** הטריגר הזה (סדר אלפביתי של שמות הטריגרים), ועד
-- שהוא ירוץ ההסכם עדיין מסומן 'sent'.
--
-- הקובץ אידמפוטנטי — אפשר להריץ אותו שוב.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. סוג ההתראה החדש
--
-- הרשימה נכתבת במלואה בכל פעם (זו הצורה של האילוץ), ולכן היא כוללת גם את
-- כל הסוגים שנוספו במיגרציות הקודמות.
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('new_lead','system','review_request','review_alert',
                  'client_match','review_new','deal_closed','lead_unrouted',
                  'marketing_copy','agreement_signed'));

-- ---------------------------------------------------------------------------
-- 2. הטריגר
--
-- ‏security definer: החתימה מרחוק נכתבת ב-Edge Function עם service_role,
-- והקריאה ל-agreements ולטבלת ההתראות אינה אמורה להיות תלויה בהרשאות של מי
-- שביצע/ה את העדכון.
-- ---------------------------------------------------------------------------
create or replace function public.notify_agent_on_remote_signature()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agreement  record;
  v_total      int;
  v_signed     int;
  v_property   text;
  v_title      text;
  v_body       text;
begin
  -- רק המעבר מ"לא חתום" ל"חתום", ורק חתימה מרחוק
  if new.signed_at is null or old.signed_at is not null then
    return null;
  end if;
  if new.method is distinct from 'remote' then
    return null;
  end if;

  select id, agent_id, title, status, snapshot
    into v_agreement
    from agreements
   where id = new.agreement_id;

  if v_agreement.id is null or v_agreement.agent_id is null then
    return null;
  end if;
  -- הסכם שבוטל אחרי שהקישור יצא: החתימה כבר לא רלוונטית
  if v_agreement.status = 'cancelled' then
    return null;
  end if;

  select count(*), count(*) filter (where signed_at is not null)
    into v_total, v_signed
    from agreement_signers
   where agreement_id = new.agreement_id;

  v_property := nullif(btrim(coalesce(v_agreement.snapshot->>'property_line', '')), '');

  if v_total > 0 and v_signed = v_total then
    v_title := '✅ ההסכם נחתם — כל הצדדים חתמו';
  else
    v_title := '✍️ חתימה מרחוק התקבלה';
  end if;

  -- מי חתם/ה, על מה, ומה נשאר. בלי השלושה האלה ההתראה אינה אומרת דבר
  -- למי שיש לו/ה חמישה הסכמים פתוחים באותו שבוע.
  v_body := coalesce(nullif(btrim(new.full_name), ''), 'החותם/ת')
    || ' · ' || coalesce(v_agreement.title, 'הסכם')
    || coalesce(' · ' || v_property, '')
    || ' · ' || v_signed || '/' || v_total || ' חתמו'
    || case when v_total > 0 and v_signed = v_total
            then ' · העותק החתום נשלח לכל הצדדים'
            else '' end;

  insert into notifications (agent_id, type, title, body)
  values (v_agreement.agent_id, 'agreement_signed', v_title, v_body);

  return null;
end;
$$;

comment on function public.notify_agent_on_remote_signature() is
  'מצלצלת בפעמון של הסוכן/ת כשחותם/ת חתם/ה מרחוק על הסכם. חתימה ידנית מול הסוכן/ת אינה מצלצלת.';

revoke execute on function public.notify_agent_on_remote_signature() from anon, authenticated;

drop trigger if exists agreement_signers_notify_remote on public.agreement_signers;
create trigger agreement_signers_notify_remote
  after update on public.agreement_signers
  for each row execute function public.notify_agent_on_remote_signature();
