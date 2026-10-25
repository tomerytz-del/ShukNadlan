-- ===========================================================================
-- אזור ההטמעה: מספר וירטואלי לאשת הצוות (docs/csm-adoption.md, "מספר וירטואלי")
-- ---------------------------------------------------------------------------
-- סוכן/ת שמתקשר/ת למספר של מנהלת ההטמעה מגיע/ה לנייד שלה, השיחה מוקלטת, ובסופה
-- היא מקבלת בוואטסאפ את הסיכום וההקלטה - באותו ניתוח של "הקלטות" באזור
-- (processCsmCall: תמלול, סיכום לפי CSM_PLAYBOOK, שלב ומועד קשר מוצעים). הצינור
-- הטלפוני הוא של twilio-voice, ומפוצל שם לפני המספרים של הסוכנים.
--
-- **לא שורה ב-agent_phone_lines.** שם המפתח הוא agency_members, ועליו נשענים
-- המסלול, הארנק, 150 הדקות, החידוש וסבב הירידה (הסקיל call-tracking). מספר של
-- אשת צוות הוא של הפלטפורמה - לא מחויב, לא מתחדש ולא נספר בתקרה - ולכן טבלה
-- משלו, כמו csm_calendar_*.
--
-- מה בקובץ:
--   1. ‏csm_phone_lines: המספר, לאיזו אשת צוות, ולאן לנתב (ריק = הנייד שלה).
--   2. ‏csm_calls: source = 'phone', ועמודות השיחה (SID, מי התקשר, משך, הודעה
--      קולית). הסוכן/ת מזוהה/ה לפי הטלפון של המתקשר/ת.
--   3. ‏csm_calls_notify: גם שיחה מהמספר כותבת התראה (call_ready), כמו העלאה.
--   4. השיוך בידי מנהל/ת הפלטפורמה: מספר שנקנה (twilio-voice?task=csm-line-order)
--      או מספר קיים של הפלטפורמה (כמו הפיילוט) שעובר אליה.
--
-- המיגרציה אידמפוטנטית.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. המספר
-- ---------------------------------------------------------------------------
create table if not exists public.csm_phone_lines (
  id             uuid primary key default gen_random_uuid(),
  staff_id       uuid not null references public.csm_staff(id) on delete cascade,
  -- ‏E.164 עם פלוס (‏+9724…), כמו שהוא מגיע ב-To של Twilio
  twilio_number  text not null unique check (twilio_number ~ '^\+972[1-9]\d{7,8}$'),
  -- ‏null = הנייד שלה ב-csm_staff
  forward_to     text check (forward_to is null or forward_to ~ '^\+972[1-9]\d{7,8}$'),
  -- ‏null = מספר שלא נקנה מכאן (הועבר מהפלטפורמה) - לא משתחרר ב-Twilio מכאן
  twilio_sid     text,
  -- המספר של הסוכנים שממנו הועבר, אם הועבר (כדי שאפשר יהיה להחזיר)
  moved_from_line uuid references public.agent_phone_lines(id) on delete set null,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

create index if not exists csm_phone_lines_staff_idx on public.csm_phone_lines (staff_id);

comment on table public.csm_phone_lines is
  'מספר וירטואלי של אשת צוות ההטמעה: שיחה נכנסת מנותבת לנייד שלה, מוקלטת ומנותחת (twilio-voice → csm_calls). של הפלטפורמה, לא מחויב. docs/csm-adoption.md';

alter table public.csm_phone_lines enable row level security;
revoke all on table public.csm_phone_lines from anon;
revoke insert, update, delete on table public.csm_phone_lines from authenticated;
grant select on table public.csm_phone_lines to authenticated;
grant select, insert, update, delete on table public.csm_phone_lines to service_role;
drop policy if exists "csm staff reads own phone line" on public.csm_phone_lines;
create policy "csm staff reads own phone line" on public.csm_phone_lines for select to authenticated
  using (staff_id = public.current_csm_id() or public.current_is_platform_admin());

-- ---------------------------------------------------------------------------
-- 2. השיחה ב-csm_calls
-- ---------------------------------------------------------------------------
alter table public.csm_calls add column if not exists twilio_call_sid text;
alter table public.csm_calls add column if not exists from_number text;
alter table public.csm_calls add column if not exists duration_sec int;
alter table public.csm_calls add column if not exists voicemail boolean not null default false;
alter table public.csm_calls add column if not exists line_id uuid references public.csm_phone_lines(id) on delete set null;

create unique index if not exists csm_calls_twilio_sid_key on public.csm_calls (twilio_call_sid) where twilio_call_sid is not null;

do $$ begin
  if exists (select 1 from pg_constraint where conname = 'csm_calls_source_check'
              and pg_get_constraintdef(oid) not like '%phone%') then
    alter table public.csm_calls drop constraint csm_calls_source_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'csm_calls_source_check') then
    alter table public.csm_calls add constraint csm_calls_source_check
      check (source in ('upload', 'whatsapp', 'phone'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. ההתראה: גם שיחה מהמספר. מגבריאלה (whatsapp) - לא: שם התשובה בשיחה.
-- ---------------------------------------------------------------------------
create or replace function public.csm_calls_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source in ('upload', 'phone') and new.staff_id is not null
     and new.status in ('done','failed') and new.status is distinct from old.status then
    perform public._csm_notify(
      new.staff_id, 'call_ready',
      case when new.status = 'done' then
             case when new.source = 'phone' then 'סיכום: ' else 'ההקלטה מוכנה: ' end
           else 'ההקלטה נכשלה: ' end || coalesce(new.title, 'שיחה'),
      case when new.status = 'done' then left(coalesce(new.analysis->>'summary', ''), 600)
           else coalesce(new.error, '') || ' אפשר לנסות שוב בלשונית "הקלטות".' end,
      new.agent_id, new.id, null, 'call:' || new.id || ':' || new.status);
  end if;
  return null;
end;
$$;

revoke all on function public.csm_calls_notify() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. השיוך - מנהל/ת הפלטפורמה
-- ---------------------------------------------------------------------------
-- ‏04-1234567 / 972… / +972… → +9724…; לא ישראלי → null
create or replace function public._csm_e164(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when public.normalize_msisdn(p) ~ '^972[1-9]\d{7,8}$' then '+' || public.normalize_msisdn(p) end;
$$;

revoke all on function public._csm_e164(text) from public, anon, authenticated;
grant execute on function public._csm_e164(text) to service_role;

-- הליבה (גם ל-twilio-voice אחרי קנייה). מספר של הסוכנים שהוא של הפלטפורמה
-- (‏monthly_price is null) עובר אליה ונכבה שם; מספר שסוכן/ת משלם/ת עליו - לא.
create or replace function public._csm_phone_line_assign(
  p_staff_id uuid, p_number text, p_forward_to text default null, p_twilio_sid text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_num   text := public._csm_e164(p_number);
  v_fwd   text := nullif(btrim(coalesce(p_forward_to, '')), '');
  v_agent public.agent_phone_lines%rowtype;
  v_id    uuid;
begin
  if v_num is null then
    return jsonb_build_object('error', 'bad_number');
  end if;
  if v_fwd is not null then
    v_fwd := public._csm_e164(v_fwd);
    if v_fwd is null then
      return jsonb_build_object('error', 'bad_forward_to');
    end if;
  end if;
  if not exists (select 1 from public.csm_staff where id = p_staff_id and active) then
    return jsonb_build_object('error', 'staff_not_found');
  end if;
  if v_fwd is null and not exists (select 1 from public.csm_staff where id = p_staff_id and phone_e164 is not null) then
    return jsonb_build_object('error', 'no_phone');
  end if;

  select * into v_agent from public.agent_phone_lines
   where twilio_number = v_num and active and coalesce(status, 'active') <> 'released'
   for update;
  if found and v_agent.monthly_price is not null then
    return jsonb_build_object('error', 'number_in_use');
  end if;
  if found then
    update public.agent_phone_lines set active = false where id = v_agent.id;
  end if;

  insert into public.csm_phone_lines (staff_id, twilio_number, forward_to, twilio_sid, moved_from_line, active)
  values (p_staff_id, v_num, v_fwd, p_twilio_sid, v_agent.id, true)
  on conflict (twilio_number) do update
     set staff_id = excluded.staff_id, forward_to = excluded.forward_to, active = true,
         twilio_sid = coalesce(excluded.twilio_sid, public.csm_phone_lines.twilio_sid),
         moved_from_line = coalesce(excluded.moved_from_line, public.csm_phone_lines.moved_from_line)
  returning id into v_id;
  return jsonb_build_object('success', true, 'id', v_id, 'number', v_num, 'moved_from_agent_line', v_agent.id is not null);
end;
$$;

revoke all on function public._csm_phone_line_assign(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public._csm_phone_line_assign(uuid, text, text, text) to service_role;

create or replace function public.csm_phone_line_assign(p_staff_id uuid, p_number text, p_forward_to text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return public._csm_phone_line_assign(p_staff_id, p_number, p_forward_to, null);
end;
$$;

revoke all on function public.csm_phone_line_assign(uuid, text, text) from public, anon, authenticated;
grant execute on function public.csm_phone_line_assign(uuid, text, text) to authenticated;

-- כיבוי (או הדלקה). מספר שהועבר מהסוכנים חוזר לשם כשהוא נכבה כאן. שחרור
-- מספר שנקנה ב-Twilio - twilio-voice?task=csm-line-release.
create or replace function public.csm_phone_line_set_active(p_id uuid, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.csm_phone_lines%rowtype;
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.csm_phone_lines set active = p_active where id = p_id returning * into v;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;
  if v.moved_from_line is not null then
    update public.agent_phone_lines set active = not p_active where id = v.moved_from_line;
  end if;
  return jsonb_build_object('success', true, 'returned_to_agent_line', v.moved_from_line is not null and not p_active);
end;
$$;

revoke all on function public.csm_phone_line_set_active(uuid, boolean) from public, anon, authenticated;
grant execute on function public.csm_phone_line_set_active(uuid, boolean) to authenticated;

-- רשימת ההעברה: המספרים של הפלטפורמה שאפשר להעביר אליה (בלי מספר שסוכן/ת משלם/ת עליו)
create or replace function public.csm_phone_line_candidates()
returns table (line_id uuid, twilio_number text, label text, agent_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return query
    select l.id, l.twilio_number, l.label, m.display_name
      from public.agent_phone_lines l
      left join public.agency_members m on m.id = l.agent_id
     where l.active and l.monthly_price is null and coalesce(l.status, 'active') <> 'released'
       and l.twilio_number ~ '^\+972'
       and not exists (select 1 from public.csm_phone_lines c where c.twilio_number = l.twilio_number and c.active)
     order by l.created_at;
end;
$$;

revoke all on function public.csm_phone_line_candidates() from public, anon, authenticated;
grant execute on function public.csm_phone_line_candidates() to authenticated;
