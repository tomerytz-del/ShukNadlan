-- ---------------------------------------------------------------------------
-- "עם מי אני משתף/ת": כל המשרדים (כולל עתידיים) או רק מי שבחרתי
--
-- שלב 9 בעיצוב מחדש של ה-CRM (HANDOFF סעיף 3.17; docs/property-sharing.md).
-- עד היום נשמרה רק רשימת ההסרות (agent_share_exclusions): היעדר שורה = שת"פ.
-- כלומר משרד חדש שהצטרף נכנס אוטומטית לשת"פ של כולם - גם של מי שבחר/ה
-- משרדים אחד-אחד, ובכך "רק משרדים שבחרתי" לא היה נכון לגבי משרד שנפתח מחר.
--
-- עכשיו נשמר גם המצב עצמו, ב-agency_members.share_mode:
--   ‏· 'all'      - כל המשרדים במערכת, כולל עתידיים (ברירת המחדל - כמו היום)
--   ‏· 'selected' - רק מי שבחרתי. משרד חדש נכנס לרשימת ההסרות של הסוכן/ת
--                   מיד כשהוא נוצר (agencies_share_a_selected_mode)
--
-- **שם הטריגר מתחיל ב-a בכוונה.** טריגרי after באותו אירוע רצים לפי סדר
-- אלפביתי, ו-agencies_share_backfill (20270423090000) משתף למשרד החדש את כל
-- הנכסים הפתוחים לפי רשימת ההסרות. ההסרה צריכה לקרות **לפניו**, אחרת המשרד
-- החדש היה מקבל את הנכסים של מי שבחר/ה "רק מי שבחרתי".
--
-- המעבר ל-'all' מנקה את רשימת ההסרות (set_share_mode): "כל המשרדים" פירושו כולם.
-- המעבר ל-'selected' לא משנה דבר מיד - הבחירה היא הרשימה של היום.
--
-- אידמפוטנטית.
-- ---------------------------------------------------------------------------

alter table public.agency_members
  add column if not exists share_mode text not null default 'all';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'agency_members_share_mode_chk') then
    alter table public.agency_members
      add constraint agency_members_share_mode_chk check (share_mode in ('all', 'selected'));
  end if;
end $$;

comment on column public.agency_members.share_mode is
  'עם מי משתפים נכסים שנפתחו לשת"פ: all = כל המשרדים כולל עתידיים, selected = רק מי שלא ב-agent_share_exclusions, ומשרד חדש נכנס להסרות. docs/property-sharing.md';

-- ---------------------------------------------------------------------------
-- שינוי המצב - דרך פונקציה ולא update ישיר על agency_members
-- ---------------------------------------------------------------------------
create or replace function public.set_share_mode(p_mode text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent uuid := public.current_agent_id();
begin
  if v_agent is null then
    raise exception 'not_agent' using errcode = '42501';
  end if;
  if p_mode not in ('all', 'selected') then
    raise exception 'invalid_mode' using errcode = '22023';
  end if;
  update public.agency_members set share_mode = p_mode where id = v_agent;
  if p_mode = 'all' then
    delete from public.agent_share_exclusions where agent_id = v_agent;
  end if;
  return p_mode;
end;
$$;

revoke all on function public.set_share_mode(text) from public, anon, authenticated;
grant execute on function public.set_share_mode(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- משרד חדש: נכנס להסרות של מי שבחר/ה "רק מי שבחרתי"
-- ---------------------------------------------------------------------------
create or replace function public.agencies_share_a_selected_mode()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    insert into public.agent_share_exclusions (agent_id, agency_id)
    select m.id, new.id
      from public.agency_members m
     where m.share_mode = 'selected'
       and m.active = true
       and m.agency_id is distinct from new.id
    on conflict (agent_id, agency_id) do nothing;
  exception when others then
    -- כשל כאן לא יפיל הרשמה של משרד
    raise warning 'share mode exclusions failed for agency %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.agencies_share_a_selected_mode() from public, anon, authenticated;

drop trigger if exists agencies_share_a_selected_mode on public.agencies;
create trigger agencies_share_a_selected_mode
  after insert on public.agencies
  for each row
  execute function public.agencies_share_a_selected_mode();
