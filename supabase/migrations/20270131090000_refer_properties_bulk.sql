-- ============================================================================
-- מסירת כמה נכסים בבת אחת
--
-- התאום של refer_clients_to_agent() (‏20270130090000) לנכסים: קריאה אחת,
-- התראה אחת לסוכן/ת, ואותן בדיקות של refer_to_agent() על נכס בודד
-- (‏20270128090000):
--
--   • הקורא/ת מנהל/ת פעיל/ה, והיעד חבר/ת צוות פעיל/ה באותו משרד.
--   • כל נכס **של המשרד** - לא רק של המנהל/ת. מנהל/ת ממילא רואה/ה את כל
--     נכסי המשרד (RLS על properties), וחלוקה מחדש של מלאי - למשל כשסוכן/ת
--     עוזב/ת - היא בדיוק המקרה שבשבילו יש מסירה מרובה.
--   • יעד = המנהל/ת עצמו/ה: הנכסים עוברים אליו/ה וההפנייה מתבטלת
--     (referred_by מתאפס).
--
-- נכס של משרד אחר, או שכבר אצל אותו/ה סוכן/ת, מדולג ונספר ב-skipped.
--
-- הטריגר properties_guard_duplicate רץ גם כאן (BEFORE UPDATE), אבל נכס
-- פעיל שנשאר באותו משרד ובאותה כתובת יוצא ממנו מיד - החלפת agent_id אינה
-- מפעילה את בדיקת הכפילות.
--
-- הקובץ אידמפוטנטי. ‏docs/office-referrals.md
-- ============================================================================

create or replace function public.refer_properties_to_agent(p_ids uuid[], p_agent_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     public.agency_members%rowtype;
  v_target public.agency_members%rowtype;
  v_back   boolean;
  v_moved  int := 0;
  v_total  int := coalesce(cardinality(p_ids), 0);
begin
  select * into v_me from public.agency_members
   where user_id = (select auth.uid()) and active = true;
  if not found or v_me.agency_id is null or v_me.role <> 'manager' then
    return jsonb_build_object('ok', false, 'error', 'רק מנהל/ת משרד יכול/ה למסור בהפנייה.');
  end if;

  if v_total = 0 then
    return jsonb_build_object('ok', false, 'error', 'לא נבחרו נכסים.');
  end if;
  if v_total > 500 then
    return jsonb_build_object('ok', false, 'error', 'אפשר למסור עד 500 נכסים בפעם אחת.');
  end if;

  select * into v_target from public.agency_members
   where id = p_agent_id and agency_id = v_me.agency_id and active = true;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'הסוכן/ת שנבחר/ה אינו/ה פעיל/ה במשרד.');
  end if;
  v_back := v_target.id = v_me.id;

  update public.properties p
     set agent_id    = v_target.id,
         referred_by = case when v_back then null else v_me.id end,
         referred_at = case when v_back then null else now() end
   where p.id = any(p_ids)
     and p.agency_id = v_me.agency_id
     and p.agent_id <> v_target.id;
  get diagnostics v_moved = row_count;

  if v_moved > 0 and not v_back then
    insert into public.notifications (agent_id, type, title, body)
    values (v_target.id, 'system',
            case when v_moved = 1 then 'נכס נמסר אליך בהפנייה'
                 else v_moved || ' נכסים נמסרו אליך בהפנייה' end,
            coalesce(v_me.display_name, 'מנהל/ת המשרד') || ' מסר/ה לטיפולך '
              || case when v_moved = 1 then 'נכס אחד' else v_moved || ' נכסים' end
              || '. הם מסומנים "הפנייה" ברשימת הנכסים שלך.');
  end if;

  return jsonb_build_object('ok', true, 'moved', v_moved, 'skipped', v_total - v_moved,
                            'agent_name', v_target.display_name, 'returned', v_back);
end;
$$;

comment on function public.refer_properties_to_agent(uuid[], uuid) is
  'מנהל/ת משרד מוסר/ת כמה נכסים של המשרד לסוכן/ת בבת אחת, כהפנייה משותפת. התראה אחת לסוכן/ת.';

revoke all on function public.refer_properties_to_agent(uuid[], uuid) from public, anon, authenticated;
grant execute on function public.refer_properties_to_agent(uuid[], uuid) to authenticated;
