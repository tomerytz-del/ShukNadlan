-- הודעה ראשונה שיצאה והשנייה נכשלה אינה claimed.
-- claimed בלי סיום חוזר כ-in_progress, ו-retry היה שולח את הראשונה שוב
-- כי wa_message_ids עוד לא נשמרו. partial_sent הוא מצב סופי: גם
-- retry=true אינו תופס מחדש ואינו שולח את מה שכבר יצא.
-- כשל בלי שום הודעה נשאר failed, ושם retry עדיין מותר.

alter table public.whatsapp_ops_questions
  drop constraint if exists whatsapp_ops_questions_status_chk;

alter table public.whatsapp_ops_questions
  add constraint whatsapp_ops_questions_status_chk
  check (status in ('claimed', 'sent', 'failed', 'partial_sent'));

create or replace function public.whatsapp_ops_question_claim(
  p_agent uuid,
  p_purpose text,
  p_body text,
  p_button_ids text[],
  p_followup_body text,
  p_followup_button_ids text[],
  p_retry boolean
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_agent_n int;
  v_global_n int;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('whatsapp_ops_questions')::bigint);

  select q.status into v_status
    from public.whatsapp_ops_questions q
   where q.agent_id = p_agent and q.purpose = p_purpose
   for update;

  if found then
    if v_status = 'sent' then
      return 'already_sent';
    elsif v_status = 'partial_sent' then
      return 'partial_sent';
    elsif v_status in ('failed', 'claimed') and p_retry then
      update public.whatsapp_ops_questions
         set status = 'claimed',
             error = null,
             body = p_body,
             button_ids = p_button_ids,
             followup_body = p_followup_body,
             followup_button_ids = p_followup_button_ids
       where agent_id = p_agent and purpose = p_purpose;
      return 'reclaimed';
    elsif v_status = 'failed' then
      return 'failed';
    else
      return 'in_progress';
    end if;
  end if;

  select count(*) into v_agent_n
    from public.whatsapp_ops_questions q
   where q.agent_id = p_agent
     and q.status in ('sent', 'claimed', 'partial_sent')
     and q.created_at > pg_catalog.now() - interval '1 day';
  if v_agent_n >= 1 then
    return 'agent_cap';
  end if;

  select count(*) into v_global_n
    from public.whatsapp_ops_questions q
   where q.status in ('sent', 'claimed', 'partial_sent')
     and q.created_at > pg_catalog.now() - interval '1 day';
  if v_global_n >= 5 then
    return 'global_cap';
  end if;

  insert into public.whatsapp_ops_questions (
    agent_id, purpose, body, button_ids, followup_body, followup_button_ids, status
  ) values (
    p_agent, p_purpose, p_body, p_button_ids, p_followup_body, p_followup_button_ids, 'claimed'
  );
  return 'claimed';
end;
$$;

comment on function public.whatsapp_ops_question_claim(uuid, text, text, text[], text, text[], boolean) is
  'תופסת שאלה תפעולית. תקרה 1 לסוכן/ת ו-5 לכולם ביממה, על sent, claimed ו-partial_sent. failed בלי הודעה ו-claimed נתקע חוזרים רק עם p_retry. sent ו-partial_sent אינם נשלחים שוב.';

revoke all on function public.whatsapp_ops_question_claim(uuid, text, text, text[], text, text[], boolean) from public, anon, authenticated;
grant execute on function public.whatsapp_ops_question_claim(uuid, text, text, text[], text, text[], boolean) to service_role;
