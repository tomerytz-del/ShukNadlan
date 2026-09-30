-- ============================================================================
-- יומן: בלי מקף ארוך בכותרת, בהערות ובמיקום של פריט
--
-- משימה אוטומטית של "בלעדיות מסתיימת" לוקחת את שורת הנכס מ-
-- ‏agreements.snapshot->>'property_line'. הסכמים שנחתמו לפני כלל המקף (ו-
-- ‏20261202090000_long_dash_backfill לא נוגע בהם בכוונה - זה המסמך שנחתם)
-- נושאים "דירה — עלייה 20", וזה מה שהוצג ב-CRM. הנרמול עובר לטריגר שלפני,
-- כך שהוא חל על כל מקור: משימות אוטומטיות, הבוט, והטופס.
--
-- ‏agenda_items בלבד - היומן הוא תוכן עבודה חי, לא רשומה היסטורית. ההסכם
-- עצמו נשאר כפי שנחתם.
-- ============================================================================

create or replace function public.agent_agenda_items_before()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- מקף ארוך למקף רגיל: הטקסט הזה מוצג ב-CRM, בפעמון ובוואטסאפ, והוא מגיע
  -- גם ממקורות שלא עברו את הניקוי — ‏snapshot של הסכם ישן, ונוסח של הבוט.
  new.title    := btrim(translate(new.title, chr(8212) || chr(8211), '--'));
  new.notes    := nullif(btrim(translate(coalesce(new.notes, ''), chr(8212) || chr(8211), '--')), '');
  new.location := nullif(btrim(translate(coalesce(new.location, ''), chr(8212) || chr(8211), '--')), '');

  if tg_op = 'INSERT' then
    if new.source <> 'system' and not public.agent_agenda_enabled(new.agent_id) then
      raise exception 'tier_required: היומן והמשימות זמינים במסלולים PROFESSIONAL ו-Elite'
        using errcode = 'P0001';
    end if;
  else
    new.agent_id   := old.agent_id;
    new.source     := old.source;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;

  if new.remind_before is not null then
    new.remind_before := (
      select coalesce(array_agg(distinct o order by o desc), '{}'::int[])
        from unnest(new.remind_before) o
       where o between -10080 and 20160);
    if cardinality(new.remind_before) > 5 then
      new.remind_before := new.remind_before[1:5];
    end if;
  end if;

  if new.status = 'done' and new.completed_at is null then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;

  if new.client_id is not null
     and (tg_op = 'INSERT' or new.client_id is distinct from old.client_id)
     and not exists (select 1 from public.agent_clients c
                      where c.id = new.client_id and c.agent_id = new.agent_id) then
    raise exception 'agenda: הלקוח/ה אינו/ה בקובץ שלך' using errcode = 'P0001';
  end if;

  if new.property_id is not null
     and (tg_op = 'INSERT' or new.property_id is distinct from old.property_id)
     and not exists (select 1 from public.properties p
                      where p.id = new.property_id and p.agent_id = new.agent_id) then
    raise exception 'agenda: הנכס אינו שלך' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function public.agent_agenda_items_before() from public, anon, authenticated;

-- הפריטים שכבר קיימים. העדכון עובר בטריגר שלפני (שמנרמל), ולא בטריגר
-- ההתראות (הוא מאזין ל-due_at, remind_before, status, kind, priority בלבד).
-- פריט שכבר ב-Google יסומן לסנכרון מחדש, וזה רצוי: גם שם הכותרת מתוקנת.
update public.agent_agenda_items
   set title = title
 where title ~ ('[' || chr(8212) || chr(8211) || ']') or notes ~ ('[' || chr(8212) || chr(8211) || ']') or location ~ ('[' || chr(8212) || chr(8211) || ']');
