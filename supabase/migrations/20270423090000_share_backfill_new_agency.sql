-- ============================================================================
-- משרד שהצטרף אחרי ההפצה מקבל את הנכסים שכבר שותפו
--
-- מה היה שבור: ‏property_shares נכתבת רק ברגע ההפצה, בתוך
-- share_property_for_agent, מול המשרדים שקיימים *באותו רגע*. רשימת השת"פ
-- (agent_share_exclusions) היא רשימת הסרות, ולכן משרד חדש "נמצא" ברשימה של
-- כולם - אבל ההפצה עצמה לא רצה שוב. משרד שהצטרף היום לא קיבל אף נכס שכבר
-- היה פתוח לשת"פ: "נכסים ששותפו איתי" ריקה, ומנוע ההתאמות (שהמאגר השלישי
-- שלו הוא property_shares) לא הציע ללקוחות שלו אף נכס של משרד אחר.
-- בבדיקה ב-12.10.2026 חסרו 821 הפצות ב-29 מתוך 30 המשרדים.
--
-- מה נכנס:
--   1. ‏share_backfill_for_agency(agency) - מוסיפה את המשרד לכל נכס פעיל
--      שפתוח לשת"פ, באותם כללים של המנוע: לא למשרד של הבעלים, ולא למשרד
--      שהבעלים הסיר/ה מרשימת השת"פ.
--   2. טריגר על הוספת משרד שמריץ אותה.
--   3. השלמה חד-פעמית לכל המשרדים הקיימים.
--
-- בלי התראות, בכוונה. המנוע שולח "נכס חדש שותף איתך" רק למי שקיבל את הנכס
-- עכשיו, והשלמה כזו הייתה מציפה עשרות התראות בבת אחת. וגם טריגר ההתאמות
-- על property_shares (property_shares_client_match_alerts) מושתק לאורך
-- ההשלמה בדגל מקומי לטרנזקציה: אחרת כל נכס היה מריץ את
-- generate_client_match_alerts, ששולחת client_match ו-listing_match. ההתאמות
-- עצמן מופיעות בפאנל, כי match_properties_for_client קוראת את property_shares
-- בזמן אמת.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. ההשלמה למשרד אחד
-- ---------------------------------------------------------------------------
create or replace function public.share_backfill_for_agency(p_agency_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_added int := 0;
begin
  -- local = true: הדגל חי עד סוף הטרנזקציה, ומאופס מיד אחרי ההוספה
  perform set_config('app.share_backfill', 'on', true);

  insert into public.property_shares
    (property_id, owner_agent_id, owner_agency_id, shared_with_agency_id)
  select p.id, m.id, m.agency_id, p_agency_id
    from public.properties p
    join public.agency_members m
      on m.id = p.agent_id
     and m.active = true
     and m.agency_id is not null
   where p.shared_with_partners = true
     and p.status = 'active'
     and m.agency_id <> p_agency_id
     and not exists (select 1 from public.agent_share_exclusions ex
                      where ex.agent_id = m.id and ex.agency_id = p_agency_id)
  on conflict (property_id, shared_with_agency_id) do nothing;
  get diagnostics v_added = row_count;

  perform set_config('app.share_backfill', '', true);
  return v_added;
end;
$$;

comment on function public.share_backfill_for_agency(uuid) is
  'מוסיפה משרד להפצה של כל נכס פעיל שפתוח לשת"פ (לפי רשימות ההסרה), בלי התראות. נקראת מהטריגר על agencies.';

revoke all on function public.share_backfill_for_agency(uuid) from public, anon, authenticated;
grant execute on function public.share_backfill_for_agency(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. טריגר ההתאמות על property_shares - מדלג בזמן ההשלמה
--    (גרסה קודמת: 20260829210000, זהה חוץ מהבדיקה בראש)
-- ---------------------------------------------------------------------------
create or replace function public.property_shares_client_match_alerts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if current_setting('app.share_backfill', true) = 'on' then
    return null;
  end if;

  for r in select distinct property_id from inserted loop
    begin
      perform public.generate_client_match_alerts(r.property_id);
    exception when others then
      raise warning 'client match alerts failed for shared property %: %', r.property_id, sqlerrm;
    end;
  end loop;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. משרד חדש
-- ---------------------------------------------------------------------------
create or replace function public.agencies_share_backfill()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform public.share_backfill_for_agency(new.id);
  exception when others then
    -- כשל כאן לא יפיל הרשמה של משרד
    raise warning 'share backfill failed for agency %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.agencies_share_backfill() from public, anon, authenticated;

drop trigger if exists agencies_share_backfill on public.agencies;
create trigger agencies_share_backfill
  after insert on public.agencies
  for each row
  execute function public.agencies_share_backfill();

-- ---------------------------------------------------------------------------
-- 4. השלמה חד-פעמית לכל המשרדים הקיימים (אידמפוטנטית: on conflict do nothing)
-- ---------------------------------------------------------------------------
select public.share_backfill_for_agency(a.id) from public.agencies a;
