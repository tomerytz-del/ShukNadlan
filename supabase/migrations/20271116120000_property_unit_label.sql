-- מספר משרד / יחידה בתוך בניין.
--
-- property_dedupe_key נשאר city|street|house|rooms|floor|deal. שינוי
-- הנוסחה היה מייתם בלעדיות חיה (ראו 20261224090000). המבחין החדש יושב
-- בשאילתת הכפילות, ליד מבחין הגודל:
--   * מספר משרד שונה אינו אותה יחידה, גם כשהשטח זהה.
--   * אותו מספר משרד הוא אותה יחידה, גם כשהשטח שונה.
--   * בלי מספר משרד ובלי קומה נשאר הכלל הישן (שטח, כשאין חדרים ואין קומה),
--     וההודעה מבקשת את המספר במקום לומר שאין דרך.
-- בלעדיות של משרד אחר על אותו מפתח נשארת חסימה. זו ההגנה מפני התחזות
-- לכתובת של משרד אחר.

alter table public.properties
  add column if not exists unit_label text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'properties_unit_label_length_check') then
    alter table public.properties
      add constraint properties_unit_label_length_check
      check (unit_label is null or char_length(unit_label) <= 40);
  end if;
end $$;

comment on column public.properties.unit_label is
  'מספר משרד, חנות או יחידה בתוך הבניין, כפי שנאמר. null = לא נמסר. לא ממלאים ברירת מחדל.';

-- true = אותה יחידה, אחרי שהמפתח (כולל קומה) כבר התאים.
create or replace function public.property_units_conflict(
  p_new_unit text,
  p_old_unit text,
  p_new_rooms numeric,
  p_new_floor integer,
  p_new_size numeric,
  p_old_size numeric
) returns boolean
language sql
immutable
set search_path to ''
as $$
  select case
    when public.property_text_key(p_new_unit) is not null
     and public.property_text_key(p_old_unit) is not null
    then public.property_text_key(p_new_unit) = public.property_text_key(p_old_unit)
    when public.property_text_key(p_new_unit) is not null
     and public.property_text_key(p_old_unit) is null
    then false
    when public.property_text_key(p_new_unit) is null
     and public.property_text_key(p_old_unit) is not null
    then true
    else p_new_rooms is not null
      or p_new_floor is not null
      or p_old_size is not distinct from p_new_size
  end;
$$;

comment on function public.property_units_conflict(text, text, numeric, integer, numeric, numeric) is
  'אחרי התאמת מפתח הכתובת: האם זו אותה יחידה. מספר משרד שונה מפריד. בלי מספר נשאר מבחין הגודל.';

revoke all on function public.property_units_conflict(text, text, numeric, integer, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.property_units_conflict(text, text, numeric, integer, numeric, numeric)
  to service_role;

create or replace function public.properties_guard_duplicate()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_key        text;
  v_owner_key  text;
  v_holder     record;
  v_other      record;
begin
  v_key := public.property_dedupe_key(
    new.city, new.street, new.house_number, new.rooms, new.floor, new.deal_type);

  /* כתובת שהשתנתה על נכס שיש עליו בלעדיות חיה. הבלעדיות נוסעת איתו.
     בלעדיה היא הייתה נשארת תלויה על מפתח שלא קיים עוד, והנכס היה נחסם
     מול הבלעדיות של עצמו. */
  if tg_op = 'UPDATE' and v_key is not null then
    update public.property_exclusivities
       set dedupe_key = v_key
     where property_id = new.id
       and released_at is null
       and dedupe_key is distinct from v_key;
  end if;

  if new.status <> 'active' then
    return new;
  end if;

  -- מודעה שכבר באוויר על אותה זהות ואותו משרד, בלי שינוי מספר היחידה.
  if tg_op = 'UPDATE'
     and old.status = 'active'
     and old.agency_id = new.agency_id
     and public.property_dedupe_key(
           old.city, old.street, old.house_number, old.rooms, old.floor, old.deal_type)
         is not distinct from v_key
     and public.property_text_key(old.unit_label)
         is not distinct from public.property_text_key(new.unit_label) then
    return new;
  end if;

  if v_key is null then
    return new;
  end if;

  select e.agency_id,
         coalesce(m.display_name, 'מתווך/ת') as agent_name,
         coalesce(a.name, 'משרד אחר')        as agency_name
    into v_holder
    from public.property_exclusivities e
    join public.agency_members m on m.id = e.agent_id
    left join public.agencies   a on a.id = e.agency_id
   where e.dedupe_key = v_key
     and e.released_at is null
     and e.ends_on >= current_date
   limit 1;

  if found then
    if v_holder.agency_id = new.agency_id then
      return new;
    end if;
    raise exception 'הנכס נמצא בבלעדיות של % ממשרד %, ולכן אי אפשר לפרסם אותו.',
      v_holder.agent_name, v_holder.agency_name
      using hint = 'exclusive_elsewhere', errcode = 'P0001';
  end if;

  select public.property_owner_key(o.owner_phone) into v_owner_key
    from public.property_owners o
   where o.property_id = new.id;

  select p.listing_number,
         coalesce(m.display_name, 'מתווך/ת') as agent_name,
         coalesce(a.name, 'משרד אחר')        as agency_name,
         (p.agency_id = new.agency_id)       as same_agency,
         p.floor,
         p.unit_label
    into v_other
    from public.properties p
    join public.agency_members m on m.id = p.agent_id
    left join public.agencies   a on a.id = p.agency_id
    left join lateral (
      select public.property_owner_key(po.owner_phone) as owner_key
        from public.property_owners po where po.property_id = p.id
    ) o on true
   where p.status = 'active'
     and p.id <> new.id
     and public.property_dedupe_key(
           p.city, p.street, p.house_number, p.rooms, p.floor, p.deal_type) = v_key
     and (v_owner_key is null or o.owner_key is null or o.owner_key = v_owner_key)
     and public.property_units_conflict(
           new.unit_label, p.unit_label, new.rooms, new.floor, new.size_sqm, p.size_sqm)
   order by p.created_at
   limit 1;

  if found then
    if new.floor is null and public.property_text_key(new.unit_label) is null then
      raise exception 'כדי לפרסם יחידה נוספת באותו בניין צריך מספר קומה או מספר משרד. בלי המספר אי אפשר לפרסם.'
        using hint = 'unit_required', errcode = 'P0001';
    end if;
    if v_other.same_agency then
      raise exception 'הנכס כבר מפורסם במשרד שלכם על ידי % (מודעה #%). אין צורך במודעה שנייה.',
        v_other.agent_name, coalesce(v_other.listing_number::text, '-')
        using hint = 'duplicate_same_agency', errcode = 'P0001';
    end if;
    raise exception 'הנכס כבר מפורסם במערכת על ידי % ממשרד %. אפשר לפרסם אותו רק על סמך הסכם בלעדיות חתום.',
      v_other.agent_name, v_other.agency_name
      using hint = 'duplicate_elsewhere', errcode = 'P0001';
  end if;

  return new;
end;
$function$;

-- אזהרת טיוטה. החתימה הישנה (בלי p_unit) נשארת עד שהפונקציה שקוראת
-- עם p_unit עלתה. מספר שונה אינו אזהרה. בלי מספר נשארת האזהרה הישנה.
create or replace function public.gabriela_draft_elsewhere(
  p_agent_id uuid,
  p_agency_id uuid,
  p_city text,
  p_street text,
  p_house_number text,
  p_rooms numeric,
  p_floor integer,
  p_deal_type text,
  p_unit text
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_agency uuid;
  v_same boolean;
begin
  if p_agent_id is null or p_agency_id is null then
    return 'unknown';
  end if;
  v_key := public.property_dedupe_key(
    p_city, p_street, p_house_number, p_rooms, p_floor, p_deal_type);
  if v_key is null then
    return 'unknown';
  end if;

  select e.agency_id into v_agency
    from public.property_exclusivities e
   where e.dedupe_key = v_key
     and e.released_at is null
     and e.ends_on >= current_date
   limit 1;
  if found and v_agency is distinct from p_agency_id then
    return 'exclusive_elsewhere';
  end if;

  select (p.agency_id = p_agency_id) into v_same
    from public.properties p
   where p.status = 'active'
     and p.agent_id is distinct from p_agent_id
     and public.property_dedupe_key(
           p.city, p.street, p.house_number, p.rooms, p.floor, p.deal_type) = v_key
     and (
       case
         when public.property_text_key(p_unit) is not null
          and public.property_text_key(p.unit_label) is not null
         then public.property_text_key(p_unit) = public.property_text_key(p.unit_label)
         when public.property_text_key(p_unit) is not null
          and public.property_text_key(p.unit_label) is null
         then false
         else true
       end
     )
   order by p.created_at
   limit 1;
  if not found then
    return 'clear';
  end if;
  if v_same then
    return 'duplicate_same_agency';
  end if;
  return 'duplicate_elsewhere';
end;
$$;

comment on function public.gabriela_draft_elsewhere(uuid, uuid, text, text, text, numeric, integer, text, text) is
  'מצב פרסום לטיוטה, בלי שמות. p_unit מפריד יחידה באותו בניין. לא חוסם.';

revoke all on function public.gabriela_draft_elsewhere(uuid, uuid, text, text, text, numeric, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.gabriela_draft_elsewhere(uuid, uuid, text, text, text, numeric, integer, text, text)
  to service_role;
