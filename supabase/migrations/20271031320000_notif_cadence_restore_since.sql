-- supabase/migrations/20271031320000_notif_cadence_restore_since.sql
-- כשלון שמירה לא קורא שוב ל-choose: choose מזיז את since לעכשיו,
-- ופריטים שלא נקראו מלפני השינוי יוצאים מהסיכום.
-- השחזור כותב את הבחירה ואת since הקודמים.

create or replace function public.notif_cadence_restore(
  p_agent uuid,
  p_type text,
  p_choice text,
  p_since text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := '';
  v_raw text;
  v_type text;
  v_choice text;
  v_since text;
begin
  begin
    v_raw := nullif(current_setting('request.jwt.claims', true), '');
    if v_raw is not null then
      v_role := coalesce(v_raw::jsonb ->> 'role', '');
    end if;
  exception when others then
    v_role := '';
  end;
  if v_role = '' then
    begin
      v_role := coalesce(auth.role(), '');
    exception when others then
      v_role := '';
    end;
  end if;
  if v_role is distinct from 'service_role'
     and p_agent is distinct from public.current_agent_id() then
    return;
  end if;
  if not exists (
    select 1 from public.agency_members m
     where m.id = p_agent
       and m.active
       and m.closed_at is null
       and m.closure_requested_at is null
       and m.tier in ('mid', 'premium')
       and m.billing_status = 'active'
  ) then
    return;
  end if;

  v_type := nullif(btrim(coalesce(p_type, '')), '');
  if v_type is null or v_type not in (
    'new_leads', 'meetings', 'open_demand', 'matches', 'system_mentor'
  ) then
    return;
  end if;
  v_choice := case
    when p_choice in ('each', 'daily', 'thrice', 'off', 'digest') then p_choice
    else null
  end;
  if v_type = 'system_mentor' and v_choice in ('each', 'daily', 'thrice') then
    v_choice := 'digest';
  end if;
  if v_type = 'meetings' then
    v_choice := 'each';
  end if;
  if v_type in ('new_leads', 'open_demand', 'matches') and v_choice = 'digest' then
    v_choice := 'each';
  end if;
  if v_choice is null then
    return;
  end if;

  v_since := nullif(btrim(coalesce(p_since, '')), '');
  if v_since is not null and public.notif_cadence_ts(v_since) is null then
    return;
  end if;

  insert into public.agent_notification_preferences (
    agent_id, whatsapp_cadence, whatsapp_cadence_since
  ) values (
    p_agent,
    jsonb_build_object(v_type, v_choice),
    case when v_since is null then '{}'::jsonb
         else jsonb_build_object(v_type, v_since) end
  )
  on conflict (agent_id) do update
    set whatsapp_cadence = public.agent_notification_preferences.whatsapp_cadence
          || jsonb_build_object(v_type, v_choice),
        whatsapp_cadence_since = case
          when v_since is null then public.agent_notification_preferences.whatsapp_cadence_since - v_type
          else public.agent_notification_preferences.whatsapp_cadence_since
               || jsonb_build_object(v_type, v_since)
        end,
        updated_at = now();
end;
$$;

comment on function public.notif_cadence_restore(uuid, text, text, text) is
  'מחזיר קצב ו-since אחרי שמירה שנכשלה. since חוזר לערך הקודם, לא לעכשיו, כדי שפריטים ישנים יישארו בסיכום.';

revoke all on function public.notif_cadence_restore(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.notif_cadence_restore(uuid, text, text, text) to authenticated, service_role;

comment on column public.agent_notification_preferences.whatsapp_cadence_since is
  'לכל סוג, מרגע השינוי. התראות מלפניו לא נשפכות לוואטסאפ. נכתב ב-notif_cadence_apply, ומשוחזר ב-notif_cadence_restore בלי להזיז את השעה.';
