-- ============================================================================
-- מסירת כמה לקוחות בבת אחת
--
-- ‏refer_to_agent() (‏20270128090000) מוסר שורה אחת. מנהל/ת שמחלק/ת עשרים
-- לקוחות לסוכן/ת היה/הייתה קורא/ת לה עשרים פעם - ועשרים התראות היו נוחתות
-- בפעמון של הסוכן/ת. כאן: קריאה אחת, התראה אחת, ואותן בדיקות בדיוק.
--
-- לקוח/ה שאינו/ה של המנהל/ת (ולא הופנה/תה על ידו/ה) פשוט מדולג/ת ונספר/ת
-- ב-skipped, ולא מפיל/ה את כל השאר: בחירה מרובה מתוך רשימה שנטענה לפני
-- דקה יכולה לכלול לקוח/ה שכבר נמחק/ה.
--
-- הקובץ אידמפוטנטי. ‏docs/office-referrals.md
-- ============================================================================

create or replace function public.refer_clients_to_agent(p_ids uuid[], p_agent_id uuid)
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
    return jsonb_build_object('ok', false, 'error', 'לא נבחרו לקוחות.');
  end if;
  if v_total > 500 then
    return jsonb_build_object('ok', false, 'error', 'אפשר למסור עד 500 לקוחות בפעם אחת.');
  end if;

  select * into v_target from public.agency_members
   where id = p_agent_id and agency_id = v_me.agency_id and active = true;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'הסוכן/ת שנבחר/ה אינו/ה פעיל/ה במשרד.');
  end if;
  v_back := v_target.id = v_me.id;

  update public.agent_clients c
     set agent_id    = v_target.id,
         agency_id   = v_me.agency_id,
         referred_by = case when v_back then null else v_me.id end,
         referred_at = case when v_back then null else now() end
   where c.id = any(p_ids)
     and (c.agent_id = v_me.id or c.referred_by = v_me.id)
     and c.agent_id <> v_target.id;
  get diagnostics v_moved = row_count;

  if v_moved > 0 and not v_back then
    insert into public.notifications (agent_id, type, title, body)
    values (v_target.id, 'system',
            case when v_moved = 1 then 'לקוח/ה נמסר/ה אליך בהפנייה'
                 else v_moved || ' לקוחות נמסרו אליך בהפנייה' end,
            coalesce(v_me.display_name, 'מנהל/ת המשרד') || ' מסר/ה לטיפולך '
              || case when v_moved = 1 then 'לקוח/ה אחד/ת' else v_moved || ' לקוחות' end
              || '. הם מסומנים "הפנייה" בקובץ הלקוחות שלך.');
  end if;

  return jsonb_build_object('ok', true, 'moved', v_moved, 'skipped', v_total - v_moved,
                            'agent_name', v_target.display_name, 'returned', v_back);
end;
$$;

comment on function public.refer_clients_to_agent(uuid[], uuid) is
  'מנהל/ת משרד מוסר/ת כמה לקוחות לסוכן/ת בבת אחת, כהפנייה משותפת. התראה אחת לסוכן/ת.';

revoke all on function public.refer_clients_to_agent(uuid[], uuid) from public, anon, authenticated;
grant execute on function public.refer_clients_to_agent(uuid[], uuid) to authenticated;
