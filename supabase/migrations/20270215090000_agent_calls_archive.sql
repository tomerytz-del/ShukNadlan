-- ---------------------------------------------------------------------------
-- יומן שיחות: ארכוב שיחה (docs/call-tracking.md)
--
-- ארכוב מסתיר שיחה מ"שיחות אחרונות" בלי למחוק אותה - ההקלטה, התמלול והסיכום
-- נשארים, ונמחקים אחרי 90 יום כמו כל שיחה. מחיקה מיידית היא twilio-voice?task=delete.
--
-- הכתיבה ל-agent_calls היא רק מהפונקציה (service_role), ולכן אין policy של
-- update לסוכן/ת: policy כזו הייתה מתירה לשנות גם את הסיכום או את client_id.
-- במקומה פונקציה שמשנה עמודה אחת, רק בשיחה של מי שקורא/ת לה.
-- ---------------------------------------------------------------------------

alter table public.agent_calls add column if not exists archived_at timestamptz;

create or replace function public.agent_call_set_archived(p_call_id uuid, p_archived boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_found boolean;
begin
  update public.agent_calls
     set archived_at = case when p_archived then now() else null end
   where id = p_call_id
     and agent_id = public.current_agent_id()
  returning true into v_found;
  return coalesce(v_found, false);
end;
$$;

revoke all on function public.agent_call_set_archived(uuid, boolean) from public, anon, authenticated;
grant execute on function public.agent_call_set_archived(uuid, boolean) to authenticated;
