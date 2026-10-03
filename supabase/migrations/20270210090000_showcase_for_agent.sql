-- ============================================================================
-- המיניסייט מהוואטסאפ: גבריאלה פותחת מיניסייט בשם הסוכן/ת
--
-- ## מה חסר
--
-- ‏`showcase_add_properties` (‏20270208090000) גוזרת את הזהות מ-
-- ‏`current_agent_id()` - נכון לדפדפן. אבל העוזרת בוואטסאפ מזהה את הסוכן/ת לפי
-- **מספר הטלפון** ורצה עם `service_role`, ולכן `auth.uid()` שלה `null` וכל
-- קריאה חוזרת `agent_not_found`. סוכן/ת ששאל/ה "מה יש לדנה" וקיבל/ה רשימת
-- התאמות לא יכול/ה היה לבקש "תפתחי לה מיניסייט".
--
-- ## מה נכנס
--
-- אותה תבנית של `share_property_for_agent` (‏20261119090000):
--
--   ‏· `agent_showcase_add_properties(p_agent_id, ...)` - **הגוף עבר לכאן כמו
--     שהוא**: הלקוח/ה של הסוכן/ת, המאגר (נכסי המשרד + `property_shares`),
--     מיניסייט פעיל אחד, והזדמנות שנייה לנכס שנפסל. ‏`service_role` בלבד.
--   ‏· `showcase_add_properties(...)` - אותה חתימה ואותה הרשאה, עטיפה דקה
--     שמזהה מה-JWT ומאצילה. ה-CRM לא משתנה.
--
-- **למה לא עותק של הלוגיקה בשרת:** בדיקת המאגר היא כל ההגנה מפני שליחת נכס
-- של משרד שלא שיתף. עותק שני היה מתפצל מהמקור בשינוי הראשון, ומיניסייט
-- מוואטסאפ היה מקבל נכסים שה-CRM דוחה. גוף אחד, שתי דלתות.
--
-- **למה service_role בלבד:** פונקציה `security definer` שמקבלת מזהה סוכן/ת
-- בפרמטר היא דלת עקיפה ל-RLS אם הדפדפן יכול לקרוא לה - כל אחד היה פותח
-- מיניסייט בשם כל סוכן/ת. אותה תבנית כמו `agent_client_matches`.
--
-- הקובץ אידמפוטנטי. הפרטים: docs/client-showcase.md.
-- ============================================================================

create or replace function public.agent_showcase_add_properties(
  p_agent_id     uuid,
  p_client_id    uuid,
  p_property_ids uuid[],
  p_intro        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent    public.agency_members%rowtype;
  v_showcase public.client_showcases%rowtype;
  v_pid      uuid;
  v_src      text;
  v_pos      int;
  v_added    int := 0;
  v_skipped  int := 0;
begin
  select * into v_agent from public.agency_members
   where id = p_agent_id and active = true;
  if not found then
    return jsonb_build_object('error', 'agent_not_found');
  end if;
  if v_agent.agency_id is null then
    return jsonb_build_object('error', 'agent_without_agency');
  end if;

  if not exists (select 1 from public.agent_clients
                  where id = p_client_id and agent_id = v_agent.id) then
    return jsonb_build_object('error', 'client_not_found');
  end if;

  if coalesce(cardinality(p_property_ids), 0) = 0 then
    return jsonb_build_object('error', 'no_properties');
  end if;
  if cardinality(p_property_ids) > 40 then
    return jsonb_build_object('error', 'too_many');
  end if;

  select * into v_showcase from public.client_showcases
   where client_id = p_client_id and status = 'active';
  if not found then
    insert into public.client_showcases (agent_id, client_id, intro)
    values (v_agent.id, p_client_id, nullif(btrim(coalesce(p_intro, '')), ''))
    returning * into v_showcase;
  elsif nullif(btrim(coalesce(p_intro, '')), '') is not null then
    update public.client_showcases set intro = btrim(p_intro)
     where id = v_showcase.id;
  end if;

  select coalesce(max(position), 0) into v_pos
    from public.client_showcase_items where showcase_id = v_showcase.id;

  foreach v_pid in array p_property_ids loop
    -- אותו מאגר כמו match_properties_for_client
    select case when p.agent_id = v_agent.id then 'own' else 'agency' end
      into v_src
      from public.properties p
     where p.id = v_pid and p.status = 'active' and p.agency_id = v_agent.agency_id;

    if v_src is null then
      select 'shared' into v_src
        from public.property_shares ps
        join public.properties p on p.id = ps.property_id and p.status = 'active'
       where ps.property_id = v_pid and ps.shared_with_agency_id = v_agent.agency_id
       limit 1;
    end if;

    if v_src is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_pos := v_pos + 1;
    insert into public.client_showcase_items (showcase_id, property_id, source, position)
    values (v_showcase.id, v_pid, v_src, v_pos)
    on conflict (showcase_id, property_id) do update
      set source = excluded.source,
          removed_at = null,
          reaction = case when public.client_showcase_items.reaction = 'disliked'
                          then null else public.client_showcase_items.reaction end,
          reaction_reasons = case when public.client_showcase_items.reaction = 'disliked'
                          then '{}'::text[] else public.client_showcase_items.reaction_reasons end,
          position = excluded.position
      where public.client_showcase_items.removed_at is not null
         or public.client_showcase_items.reaction = 'disliked';

    if found then v_added := v_added + 1; else v_skipped := v_skipped + 1; end if;
    v_src := null;
  end loop;

  return jsonb_build_object(
    'showcase_id', v_showcase.id,
    'token',       v_showcase.token,
    'added',       v_added,
    'skipped',     v_skipped
  );
end;
$$;

comment on function public.agent_showcase_add_properties(uuid, uuid, uuid[], text) is
  'יוצר/ת או מוסיף/ה למיניסייט של לקוח/ה בשם סוכן/ת מפורש/ת - הגרסה של showcase_add_properties לעוזרת בוואטסאפ, שאין לה JWT. service_role בלבד.';

revoke all on function public.agent_showcase_add_properties(uuid, uuid, uuid[], text) from public, anon, authenticated;
grant execute on function public.agent_showcase_add_properties(uuid, uuid, uuid[], text) to service_role;

-- ---------------------------------------------------------------------------
-- העטיפה מהדפדפן - אותה חתימה, אותה הרשאה
-- ---------------------------------------------------------------------------
create or replace function public.showcase_add_properties(
  p_client_id    uuid,
  p_property_ids uuid[],
  p_intro        text default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.agent_showcase_add_properties(public.current_agent_id(), p_client_id, p_property_ids, p_intro);
$$;

comment on function public.showcase_add_properties(uuid, uuid[], text) is
  'יוצר/ת או מוסיף/ה למיניסייט של לקוח/ה. הזהות מה-JWT; הגוף ב-agent_showcase_add_properties.';

revoke all on function public.showcase_add_properties(uuid, uuid[], text) from public, anon, authenticated;
grant execute on function public.showcase_add_properties(uuid, uuid[], text) to authenticated, service_role;
