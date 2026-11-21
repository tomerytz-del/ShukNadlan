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
