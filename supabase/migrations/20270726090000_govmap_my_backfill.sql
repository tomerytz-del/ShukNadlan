-- ============================================================================
-- השלמת GovMap אוטומטית, בדפדפן של הסוכן/ת, לנכסים של עצמו/ה
--
-- ## למה
--
-- המידע התכנוני מחוץ לעפולה, והתוכניות משכבות 203/14 בכל עיר, נשלפים
-- מ-GovMap בדפדפן בלבד (מפ"י מתירים צד לקוח בלבד, 12.10.2026). השליפה
-- קורית בשמירת נכס בטופס - ולכן נכס שנכנס מאשף הייבוא או מגבריאלה, או נכס
-- שנשמר לפני שהיכולת נבנתה, נשאר בלי מידע עד שמנהל/ת הפלטפורמה לוחץ/ת על
-- כפתור. כאן ה-CRM של הסוכן/ת עצמו/ה משלים, כשהוא נפתח, עד כמה נכסים
-- בפעם. ‏docs/govmap.md, "השלמה אוטומטית".
--
-- ## מה בתור
--
-- נכס פעיל **של הסוכן/ת**, במסלול mid/premium פעיל (אותו גייט של
-- govmap_save_planning), שחסר לו אחד מהשניים:
--   * מידע תכנוני - מחוץ לעפולה (בעפולה planning-backfill בשרת), שלא נשלף
--     מעולם, עם רחוב ומספר או עם גוש/חלקה, ולא נוסה ב-7 הימים האחרונים;
--   * תוכניות 203/14 - יש לו פין, ולא נבדק ב-90 הימים האחרונים.
--
-- "נוסה ולא נמצא" נרשם ב-govmap_backfill_attempts דרך govmap_my_attempt -
-- אותה טבלה של ההשלמה של מנהל/ת הפלטפורמה, כדי ששני המסלולים לא ינסו אותו
-- נכס פעמיים באותו שבוע. בלי הרישום, כתובת שאינה בשכבה הייתה נשאלת בכל
-- פתיחה של ה-CRM.
-- ============================================================================

create or replace function public.govmap_my_candidates(p_limit integer default 10)
returns table (
  id            uuid,
  city          text,
  street        text,
  house_number  text,
  gush          text,
  helka         text,
  lat           numeric,
  lng           numeric,
  need_planning boolean,
  need_plans    boolean
)
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_agent_id uuid := public.current_agent_id();
begin
  if v_agent_id is null then
    raise exception 'not_authenticated';
  end if;
  if not exists (select 1 from public.agency_members m
                  where m.id = v_agent_id
                    and m.active = true
                    and m.billing_status = 'active'
                    and m.tier in ('mid', 'premium')) then
    return;
  end if;

  return query
  with base as (
    select p.id, btrim(p.city) as city,
           nullif(btrim(coalesce(p.street, '')), '') as street,
           nullif(btrim(coalesce(p.house_number, '')), '') as house_number,
           i.gush, i.helka, p.lat::numeric as lat, p.lng::numeric as lng,
           (btrim(coalesce(p.city, '')) <> 'עפולה'
            and nullif(btrim(coalesce(p.city, '')), '') is not null
            -- לא נשלף מעולם: שורה שיש בה רק גוש/חלקה שהוקלדו בטופס נשארת בתור
            and i.looked_up_at is null
            and ((nullif(btrim(coalesce(p.street, '')), '') is not null
                  and nullif(btrim(coalesce(p.house_number, '')), '') is not null)
                 or (i.gush is not null and i.helka is not null))
            and not exists (select 1 from public.govmap_backfill_attempts a
                             where a.property_id = p.id
                               and a.attempted_at > now() - interval '7 days')) as need_planning,
           (p.lat is not null and p.lng is not null
            and (i.govmap_plans_at is null or i.govmap_plans_at < now() - interval '90 days')) as need_plans
      from public.properties p
      left join public.property_planning_info i on i.property_id = p.id
     where p.agent_id = v_agent_id
       and p.status = 'active'
  )
  select b.id, b.city, b.street, b.house_number, b.gush, b.helka, b.lat, b.lng, b.need_planning, b.need_plans
    from base b
   where b.need_planning or b.need_plans
   order by b.need_planning desc, b.id
   limit greatest(1, least(coalesce(p_limit, 10), 40));
end;
$$;

comment on function public.govmap_my_candidates(integer) is
  'נכסים של הסוכן/ת שחסר להם מידע תכנוני מ-GovMap או תוכניות 203/14. להשלמה האוטומטית בדפדפן. מסלול mid/premium פעיל. docs/govmap.md.';

revoke all on function public.govmap_my_candidates(integer) from public, anon, authenticated;
grant execute on function public.govmap_my_candidates(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- רישום ניסיון על נכס של הסוכן/ת - כדי שנכס שלא נמצא יצא מהתור לשבוע
-- ---------------------------------------------------------------------------
create or replace function public.govmap_my_attempt(p_property_id uuid, p_result text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_agent_id uuid := public.current_agent_id();
begin
  if v_agent_id is null then
    raise exception 'not_authenticated';
  end if;
  if p_result not in ('saved', 'not_found') then
    raise exception 'bad_result';
  end if;
  if not exists (select 1 from public.properties p
                  where p.id = p_property_id and p.agent_id = v_agent_id) then
    raise exception 'not_your_property';
  end if;
  insert into public.govmap_backfill_attempts as a (property_id, attempted_at, result)
  values (p_property_id, now(), p_result)
  on conflict (property_id) do update set attempted_at = excluded.attempted_at, result = excluded.result;
end;
$$;

comment on function public.govmap_my_attempt(uuid, text) is
  'רישום תוצאת ההשלמה האוטומטית (saved / not_found) לנכס של הסוכן/ת. תקלה זמנית אינה נרשמת.';

revoke all on function public.govmap_my_attempt(uuid, text) from public, anon, authenticated;
grant execute on function public.govmap_my_attempt(uuid, text) to authenticated;
