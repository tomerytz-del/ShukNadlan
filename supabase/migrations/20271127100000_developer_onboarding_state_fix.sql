-- ============================================================================
-- תיקון: `developer_onboarding_state` נפלה בזמן ריצה (20271125090000)
--
-- `v_company := v_company || '"על החברה"'` - מחרוזת בלי טיפוס מצורפת למערך מפורשת כמערך, והמרכאות
-- הפכו אותה ל"array literal פגום" (22P02). ה-CI מריץ את המיגרציה אבל אינו קורא לפונקציה, ולכן
-- זה התגלה רק בקריאה הראשונה מול המסד החי. התיקון: `array_append(..., '...'::text)`, בלי הסתמכות על
-- הכרעת טיפוס. נבדקה אחרי הפריסה בקריאה אמיתית (read-only).
--
-- אידמפוטנטית.
-- ============================================================================

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

  if coalesce(btrim(d.tagline), '') = '' then v_company := array_append(v_company, 'משפט תדמית'::text); end if;
  if char_length(coalesce(btrim(d.description), '')) < 20 then v_company := array_append(v_company, '"על החברה"'::text); end if;
  if coalesce(btrim(d.website), '') = '' then v_company := array_append(v_company, 'אתר'::text); end if;

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

revoke all on function public.developer_onboarding_state(uuid) from public, anon, authenticated;
grant execute on function public.developer_onboarding_state(uuid) to service_role;

-- סדר התור בתזכורות: כישלון אינו חוסם את שאר החשבונות (ראו ההערה בפונקציה)
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
