-- supabase/migrations/20271031180100_agent_reminder_findings_definer.sql
-- 20271029190000 made agent_reminder_findings read unpublished_reminder_snooze / unpublished_nudge_log
-- (service_role-only, RLS without policies) while staying SECURITY INVOKER -> 42501 for every CRM caller.
-- The function gates p_agent_id itself (target CTE: own agent / service_role / platform admin), so run it as owner.
alter function public.agent_reminder_findings(uuid) security definer;
alter function public.agent_reminder_findings(uuid) set search_path = '';
revoke all on function public.agent_reminder_findings(uuid) from public, anon;
grant execute on function public.agent_reminder_findings(uuid) to authenticated, service_role;
