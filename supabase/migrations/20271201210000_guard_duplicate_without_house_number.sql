-- ============================================================================
-- מודעה בלי מספר בית כבר אינה עוקפת את בדיקת הכפילות מול משרד אחר.
--
-- version 20271201210000: מעל 20271201200000 שב-main.
--
-- מה שבור: מפתח הכפילות (property_dedupe_key) מכיל מספר בית, ו"מפתח null = אי אפשר לקבוע זהות, אין
-- חסימה" (docs/property-status-exclusivity.md). ב-23.11.2026 סוכן ממשרד אחד נחסם על דירה שמשרד אחר
-- כבר מפרסם למכירה (תרשיש 7, 6 חדרים, קומה 6), השמיט את מספר הבית, והמודעה עברה: אותה דירה מפורסמת
-- פעמיים למכירה בשני משרדים, בלי בלעדיות.
--
-- התיקון בטריגר properties_guard_duplicate (פונקציה בלבד, בלי שינוי טבלה, אינדקס או מפתח שמור): כשאין
-- מספר בית אבל ידועים עיר, רחוב, חדרים, קומה וסוג עסקה, נבדקת מודעה פעילה של **משרד אחר** עם אותם ערכים
-- (ואותם בעלים, או בלי בעלים מזוהים, כמו במפתח המלא). נמצאה: נחסם בהודעה שמבקשת מספר בית ונשענת על
-- בלעדיות, באותו hint שכבר מטופל ב-CRM, בגבריאלה ובייבוא (duplicate_elsewhere).
--
-- **מה לא משתנה:** מכירה והשכרה על אותה יחידה אצל אותו משרד, גם בשני סוכנים (סוג העסקה במפתח, ומשרד
-- אחר בלבד נבדק כאן); מודעה פעילה קיימת שנערכת (נקטעת מוקדם ברוטינה); מודעות בלי חדרים או קומה (מסחרי,
-- קרקע). **המחיר:** מודעה תקינה של משרד שני בלי מספר בית, באותו רחוב ואותם חדרים וקומה, נחסמת עד שמזינים
-- מספר בית. מודעה 1495 הקיימת אינה נחסמת רטרואקטיבית.
--
-- אידמפוטנטית (create or replace).
-- ============================================================================

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
  v_other_id   uuid;
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
         is not distinct from public.property_text_key(new.unit_label)
     -- בלי מפתח (חסר מספר בית) "אותה זהות" אינה נגזרת מהמפתח: שינוי חדרים, קומה, סוג עסקה, עיר או רחוב על
     -- מודעה בלי מספר בית היא זהות חדשה, ועוברת את הבדיקה למטה. עריכת מחיר או תיאור עדיין נקטעת כאן.
     and (v_key is not null
          or (old.rooms is not distinct from new.rooms
              and old.floor is not distinct from new.floor
              and old.deal_type is not distinct from new.deal_type
              and public.property_text_key(old.city) is not distinct from public.property_text_key(new.city)
              and public.property_text_key(old.street) is not distinct from public.property_text_key(new.street))) then
    return new;
  end if;

  if v_key is null then
    /* בלי מספר בית אין מפתח, ולכן אין בדיקת כפילות: מודעה בלי מספר בית עקפה (23.11.2026) את מודעת המכירה
       של משרד אחר על אותה דירה. כאן נבדק רק משרד אחר, באותו רחוב, אותם חדרים וקומה ואותו סוג עסקה, ורק
       כשאפשר להשוות (עיר, רחוב, חדרים, קומה וסוג עסקה ידועים). אותו משרד לעולם לא נחסם כאן, כמו במפתח המלא.
       היציאה היא למלא מספר בית: אז חל המפתח המלא, ובניין אחר ברחוב עובר. */
    if public.property_text_key(new.city) is not null
       and public.property_text_key(new.street) is not null
       and public.property_text_key(new.house_number) is null
       and new.rooms is not null
       and new.floor is not null
       and coalesce(new.deal_type, '') <> '' then
      select public.property_owner_key(o.owner_phone) into v_owner_key
        from public.property_owners o
       where o.property_id = new.id;

      select p.id into v_other_id
        from public.properties p
        left join lateral (
          select public.property_owner_key(po.owner_phone) as owner_key
            from public.property_owners po where po.property_id = p.id
        ) o on true
       where p.status = 'active'
         and p.id <> new.id
         and p.agency_id is distinct from new.agency_id
         and public.property_text_key(p.city) = public.property_text_key(new.city)
         and public.property_text_key(p.street) = public.property_text_key(new.street)
         and coalesce(trim_scale(p.rooms)::text, '') = coalesce(trim_scale(new.rooms)::text, '')
         and p.floor = new.floor
         and coalesce(p.deal_type, '') = coalesce(new.deal_type, '')
         and (v_owner_key is null or o.owner_key is null or o.owner_key = v_owner_key)
         and public.property_units_conflict(
               new.unit_label, p.unit_label, new.rooms, new.floor, p.floor,
               new.size_sqm, p.size_sqm, false, new.category = 'commercial')
       limit 1;

      if found then
        raise exception 'במערכת כבר מפורסמת מודעה של משרד אחר באותו רחוב, עם אותו מספר חדרים וקומה ואותו סוג עסקה. כדי לפרסם יש להזין מספר בית. אם זו אותה דירה, אפשר לפרסם אותה רק על סמך הסכם בלעדיות חתום.'
          using hint = 'duplicate_elsewhere', errcode = 'P0001';
      end if;
    end if;
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
     and (v_owner_key is null or o.owner_key is null or o.owner_key = v_owner_key)
     and (
       public.property_dedupe_key(
         p.city, p.street, p.house_number, p.rooms, p.floor, p.deal_type) = v_key
       or (
         -- קומה שמולאה מול מודעה בלי קומה של משרד אחר אינה מפתח אחר.
         p.agency_id is distinct from new.agency_id
         and p.floor is null
         and new.floor is not null
         and public.property_text_key(p.city) = public.property_text_key(new.city)
         and public.property_text_key(p.street) = public.property_text_key(new.street)
         and public.property_text_key(p.house_number) = public.property_text_key(new.house_number)
         and coalesce(trim_scale(p.rooms)::text, '') = coalesce(trim_scale(new.rooms)::text, '')
         and coalesce(p.deal_type, '') = coalesce(new.deal_type, '')
       )
     )
     and public.property_units_conflict(
           new.unit_label, p.unit_label, new.rooms, new.floor, p.floor,
           new.size_sqm, p.size_sqm, p.agency_id = new.agency_id,
           new.category = 'commercial')
   order by p.created_at
   limit 1;

  if found then
    -- משרד אחר קודם: לא מציעים למלא מספר כדי לעקוף.
    if not v_other.same_agency then
      raise exception 'הנכס כבר מפורסם במערכת על ידי % ממשרד %. אפשר לפרסם אותו רק על סמך הסכם בלעדיות חתום.',
        v_other.agent_name, v_other.agency_name
        using hint = 'duplicate_elsewhere', errcode = 'P0001';
    end if;
    if public.property_text_key(new.unit_label) is null then
      raise exception 'כדי לפרסם יחידה נוספת באותו בניין צריך מספר קומה או מספר משרד. בלי המספר אי אפשר לפרסם.'
        using hint = 'unit_required', errcode = 'P0001';
    end if;
    raise exception 'הנכס כבר מפורסם במשרד שלכם על ידי % (מודעה #%). אין צורך במודעה שנייה.',
      v_other.agent_name, coalesce(v_other.listing_number::text, '-')
      using hint = 'duplicate_same_agency', errcode = 'P0001';
  end if;

  return new;
end;
$function$;
