-- ============================================================================
-- מדריך ההתחלה ליזמים, קבלנים ומשווקי פרויקטים (21.11.2026)
--
-- חשבון יזם נפתח ריק: בלי לוגו, בלי תמונת שער, בלי פרויקט ובלי תמונות. אף אחד מהמצבים
-- האלה אינו שגיאה, ולכן אף אחד לא מדווח על עצמו (אותה בעיה של מדריך הסוכנים,
-- docs/agent-onboarding.md). כאן: מצב אחד שמחושב במסד **מהמציאות בכל קריאה**, ולא צ'קליסט
-- שמסמנים. הדשבורד מציג אותו, ו-`developer-onboarding-reminders` שולחת עליו מייל.
--
-- **הצעדים (הרשימה שאושרה):** לוגו ותמונת שער · פרטי החברה (משפט תדמית, "על החברה" מ-20
-- תווים, אתר) · הפרויקט הראשון · תמונות לפרויקט (שער + 4 בגלריה, בכל פרויקט) · פרויקט באוויר ·
-- פרטי קשר לפרויקט (איש קשר + טלפון או וואטסאפ). רשות: שנת הקמה ופרויקטים שנמסרו.
-- "פרויקט" = לא בארכיון ולא בבקשת מחיקה (כמו הספירה של מסלול החשבון).
--
-- **תזכורות במייל: אחת אחרי 3 ימים ואחת אחרי 10, רק אם נשאר צעד פתוח.** חשבונות שנפתחו לפני
-- המיגרציה הזו מסומנים כמי שקיבלו את שתיהן: אנחנו לא כותבים אליהם יוזמה שלא ביקשו. הם
-- רואים את המדריך בדשבורד.
--
-- אידמפוטנטית.
-- ============================================================================

alter table public.developers
  add column if not exists onboarding_reminders_sent smallint not null default 0,
  add column if not exists onboarding_reminder_at    timestamptz;

comment on column public.developers.onboarding_reminders_sent is
  'כמה תזכורות מדריך התחלה במייל נשלחו (0-2). נקבע רק ב-mark_developer_onboarding_reminder.';

-- חשבונות קיימים: לא שולחים להם תזכורות רטרואקטיביות (תאריך קבוע, כדי שהרצה חוזרת לא תשנה חשבון חדש)
update public.developers
   set onboarding_reminders_sent = 2
 where onboarding_reminders_sent = 0
   and created_at < timestamptz '2026-11-25 00:00:00+02';

-- ---------------------------------------------------------------------------
-- המצב
-- ---------------------------------------------------------------------------
create or replace function public.developer_onboarding_state(p_developer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d            public.developers;
  v_projects   int;
  v_live       int;
  v_no_photos  text[];
  v_no_contact text[];
  v_company    text[] := '{}';
  v_steps      jsonb;
  v_done       int;
  v_required   int := 6;
  v_next       text;
begin
  select * into d from public.developers where id = p_developer_id;
  if not found then
    return jsonb_build_object('error', 'developer_not_found');
  end if;

  select count(*) into v_projects from public.projects
   where developer_id = p_developer_id and status <> 'archived' and delete_requested_at is null;

  select count(*) into v_live from public.projects
   where developer_id = p_developer_id and status = 'active' and delete_requested_at is null
     and (subscription_expires_at is null or subscription_expires_at > now());

  -- פרויקטים בלי תמונת שער או בלי ארבע תמונות בגלריה
  select coalesce(array_agg(p.name order by p.created_at), '{}') into v_no_photos
    from public.projects p
   where p.developer_id = p_developer_id and p.status <> 'archived' and p.delete_requested_at is null
     and (coalesce(btrim(p.cover_url), '') = ''
          or (select count(*) from public.project_media m
               where m.project_id = p.id and m.kind = 'image') < 4);

  -- פרויקטים בלי איש קשר, או בלי טלפון ובלי וואטסאפ
  select coalesce(array_agg(p.name order by p.created_at), '{}') into v_no_contact
    from public.projects p
   where p.developer_id = p_developer_id and p.status <> 'archived' and p.delete_requested_at is null
     and (coalesce(btrim(p.contact_name), '') = ''
          or (coalesce(btrim(p.contact_phone), '') = '' and coalesce(btrim(p.whatsapp_e164), '') = ''));

  if coalesce(btrim(d.tagline), '') = '' then v_company := v_company || 'משפט תדמית'; end if;
  if char_length(coalesce(btrim(d.description), '')) < 20 then v_company := v_company || '"על החברה"'; end if;
  if coalesce(btrim(d.website), '') = '' then v_company := v_company || 'אתר'; end if;

  v_steps := jsonb_build_array(
    jsonb_build_object('id', 'brand', 'optional', false,
      'done', coalesce(btrim(d.logo_url), '') <> '' and coalesce(btrim(d.cover_url), '') <> '',
      'detail', to_jsonb(array_remove(array[
        case when coalesce(btrim(d.logo_url), '') = '' then 'לוגו' end,
        case when coalesce(btrim(d.cover_url), '') = '' then 'תמונת שער' end], null))),
    jsonb_build_object('id', 'company', 'optional', false,
      'done', cardinality(v_company) = 0, 'detail', to_jsonb(v_company)),
    jsonb_build_object('id', 'first_project', 'optional', false,
      'done', v_projects >= 1, 'detail', '[]'::jsonb),
    jsonb_build_object('id', 'photos', 'optional', false, 'blocked', v_projects = 0,
      'done', v_projects >= 1 and cardinality(v_no_photos) = 0, 'detail', to_jsonb(v_no_photos[1:5])),
    jsonb_build_object('id', 'live', 'optional', false, 'blocked', v_projects = 0,
      'done', v_live >= 1, 'detail', '[]'::jsonb),
    jsonb_build_object('id', 'contact', 'optional', false, 'blocked', v_projects = 0,
      'done', v_projects >= 1 and cardinality(v_no_contact) = 0, 'detail', to_jsonb(v_no_contact[1:5])),
    jsonb_build_object('id', 'record', 'optional', true,
      'done', d.founded_year is not null and d.projects_delivered is not null, 'detail', '[]'::jsonb));

  select count(*) filter (where (s->>'done')::boolean and not (s->>'optional')::boolean),
         (select s2->>'id' from jsonb_array_elements(v_steps) s2
           where not (s2->>'done')::boolean and not (s2->>'optional')::boolean
             and not coalesce((s2->>'blocked')::boolean, false)
           limit 1)
    into v_done, v_next
    from jsonb_array_elements(v_steps) s;

  return jsonb_build_object('steps', v_steps, 'done_count', v_done, 'total', v_required,
                            'next', v_next, 'complete', v_done = v_required);
end;
$$;

-- ---------------------------------------------------------------------------
-- תזכורות: מי זכאי עכשיו, וסימון אחרי שהמייל יצא
-- ---------------------------------------------------------------------------
create or replace function public.developer_onboarding_reminders_due(p_limit int default 20)
returns table (developer_id uuid, email text, contact_name text, company_name text, reminder_no int)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.email, d.contact_name, d.name, d.onboarding_reminders_sent + 1
    from public.developers d
   where d.status = 'active' and d.closed_at is null
     and d.email is not null and btrim(d.email) <> ''
     and d.onboarding_reminders_sent < 2
     and d.created_at <= now() - case d.onboarding_reminders_sent when 0 then interval '3 days'
                                                                  else interval '10 days' end
     -- התזכורת השנייה אחרי העשירית, ורק אם הראשונה כבר יצאה
     and (d.onboarding_reminder_at is null or d.onboarding_reminder_at <= now() - interval '1 day')
     and not coalesce((public.developer_onboarding_state(d.id)->>'complete')::boolean, false)
   order by d.created_at
   limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;

create or replace function public.mark_developer_onboarding_reminder(p_developer_id uuid, p_no int)
returns void
language sql
security definer
set search_path = ''
as $$
  -- רק קדימה: סימון חוזר של אותו מספר אינו מחזיר אחורה ואינו מכפיל
  update public.developers
     set onboarding_reminders_sent = greatest(onboarding_reminders_sent, p_no),
         onboarding_reminder_at = now()
   where id = p_developer_id;
$$;

revoke all on function public.developer_onboarding_state(uuid) from public, anon, authenticated;
grant execute on function public.developer_onboarding_state(uuid) to service_role;

revoke all on function public.developer_onboarding_reminders_due(int) from public, anon, authenticated;
grant execute on function public.developer_onboarding_reminders_due(int) to service_role;

revoke all on function public.mark_developer_onboarding_reminder(uuid, int) from public, anon, authenticated;
grant execute on function public.mark_developer_onboarding_reminder(uuid, int) to service_role;

-- ---------------------------------------------------------------------------
-- התזמון: פעם ביום, רק כשיש חשבון שמחכה לתזכורת
-- ---------------------------------------------------------------------------
do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/developer-onboarding-reminders';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - תזכורות מדריך ההתחלה ליזמים לא תוזמנו';
    return;
  end if;

  perform cron.unschedule('developer-onboarding-reminders')
    where exists (select 1 from cron.job where jobname = 'developer-onboarding-reminders');
  -- 07:41 UTC = 09:41 בחורף, אחרי שעות השקט של הלילה
  perform cron.schedule('developer-onboarding-reminders', '41 7 * * *', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1)))
    )
    where exists (select 1 from public.developers
                   where status = 'active' and closed_at is null
                     and onboarding_reminders_sent < 2
                     and created_at <= now() - interval '3 days');
  $cron$, v_url));
end;
$$;
