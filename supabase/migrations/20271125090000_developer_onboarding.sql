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
-- **תזכורות במייל: אחת אחרי 3 ימים ואחת אחרי 10, רק אם נשאר צעד פתוח.** הפונקציה ששולחת אותן והתזמון
-- שלה מגיעים בשלב 2, יחד (תזמון בלי פונקציה היה קורא לכתובת שאין בה כלום). חשבונות שנפתחו לפני
-- המיגרציה הזו מסומנים כמי שקיבלו את שתיהן: אנחנו לא כותבים אליהם יוזמה שלא ביקשו. הם
-- רואים את המדריך בדשבורד.
--
-- אידמפוטנטית.
-- ============================================================================

-- **חשבונות קיימים לא מקבלים תזכורות רטרואקטיביות.** הסימון (שתיהן כאילו נשלחו) נעשה
-- פעם אחת בלבד, ברגע שהעמודה נוצרת: הרצה חוזרת (שחזור סכימה, ענף בדיקה) לא תחסום חשבון
-- חדש, כי אז העמודה כבר קיימת. תאריך קבוע בקוד היה עושה בדיוק את זה.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'developers'
                    and column_name = 'onboarding_reminders_sent') then
    alter table public.developers
      add column onboarding_reminders_sent smallint not null default 0,
      add column onboarding_reminder_at    timestamptz;
    update public.developers set onboarding_reminders_sent = 2;
  end if;
end $$;

comment on column public.developers.onboarding_reminders_sent is
  'כמה תזכורות מדריך התחלה במייל נשלחו (0-2); 2 גם למי שהשלים את המדריך לפני התזכורת. נקבע רק ב-mark_developer_onboarding_reminder וב-developer_onboarding_reminders_due.';

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
       and (d.onboarding_reminder_at is null or d.onboarding_reminder_at <= now() - interval '1 day')
     order by d.created_at
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
