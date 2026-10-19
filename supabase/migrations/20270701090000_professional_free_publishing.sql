-- ============================================================================
-- בעלי מקצוע: פרסום חינם, בכפוף לאישור מנהל/ת הפלטפורמה
-- ----------------------------------------------------------------------------
-- המטרה היא למלא את האתר בבעלי מקצוע, ולכן הפרסום אינו עולה כסף. במקום
-- הסולק יש שער אחר: **כל בעל/ת מקצוע חדש/ה ממתין/ה לאישור** בקטגוריית
-- "בעלי מקצוע" בתצוגת מנהל/ת הפלטפורמה ב-CRM, ורק האישור מעלה לאוויר.
-- הטופס פתוח לכל אחד, ובלי השער הזה כל רישום - בדיקה, ספאם או מי שאינו
-- בעל/ת מקצוע בכלל - היה עולה לדף הבית מיד.
--
-- שלוש החלטות:
--
-- 1. **מצב חדש, pending_approval**, ולא pending_payment. ‏pending_payment
--    יורד אחרי יממה ב-expire_unpaid_ad_placements, ורישום שממתין לאישור
--    חייב לחכות כמה שצריך. שניהם אינם active, ולכן ה-view הציבורי
--    (‏professional_cards_public) אינו מחזיר אותם בלי שום שינוי בו.
--
-- 2. **מתג ב-pricing_config** (‏professional_card_free_publishing), ולא
--    מחיקה של מסלול התשלום. הפרסום החינמי הוא הטבה זמנית (‏terms.html §15),
--    ו-0 מחזיר את ההרשמה למסלול הקודם (הטבת ההצטרפות ואז תשלום) בלי פריסה.
--    המחיר החודשי נשאר ב-professional_card_monthly_price מאותה סיבה.
--
-- 3. **כרטיסייה מאושרת היא בלי תאריך סיום** (‏ends_at null). אין תקופה
--    ששולמה, וכשההטבה תיגמר ההחלטה תהיה של הנהלת האתר ולא של תאריך שנקבע
--    מראש. מאותה סיבה גם הכרטיסיות החינמיות שכבר באוויר (הטבת ההצטרפות)
--    מאבדות את תאריך הסיום שלהן - אחרת הן היו יורדות במרץ 2027, בזמן
--    שהאתר אומר שהפרסום חינם.
--
-- ומעבר לכך: הכרטיסייה של אבירם כהן אדריכלות חוזרת לאוויר. היא נרשמה
-- לפני מסלול התשלום כ-test_mode עם חודש אחד, ופג תוקפה ב-10.10.2026.
--
-- אידמפוטנטית: בדיקת pg_constraint, ‏on conflict do nothing, ‏create or
-- replace, ועדכונים שתנאיהם אינם מתקיימים בהרצה שנייה.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. המצב החדש
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.ad_placements'::regclass
       and conname = 'ad_placements_status_check'
  ) then
    alter table public.ad_placements drop constraint ad_placements_status_check;
  end if;
end;
$$;

alter table public.ad_placements
  add constraint ad_placements_status_check
  check (status = any (array['pending_payment', 'pending_approval', 'active', 'paused', 'ended']));

create index if not exists ad_placements_pending_approval_idx
  on public.ad_placements (created_at)
  where status = 'pending_approval';

-- ---------------------------------------------------------------------------
-- 2. המתג
-- ---------------------------------------------------------------------------
insert into public.pricing_config (key, value, description)
values ('professional_card_free_publishing', 1,
        'פרסום חינם לבעלי מקצוע, בכפוף לאישור מנהל/ת הפלטפורמה. 0 מחזיר את מסלול התשלום (הטבת ההצטרפות ואז מחיר חודשי).')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. אישור / השהיה - מנהל/ת פלטפורמה בלבד
--
-- ‏approve מעלה לאוויר מכל מצב שאינו active: ממתין/ה לאישור, מושהית, או
-- שפג תוקפה (‏ended) - כך גם כרטיסייה שירדה חוזרת בלחיצה. ‏active שתאריך
-- הסיום שלו עבר נחשב גם הוא: הוא active בטבלה ואינו מוצג באתר.
-- ‏pause מוריד מהאתר בלי למחוק - הפרופיל, התמונות וקישור הניהול נשארים.
--
-- בדיקת placement_type מאותה סיבה שב-admin_delete_professional_card: הפונקציה
-- עוקפת RLS, ומזהה שגוי לא יגע בבאנר פרסום.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_professional_card_status(p_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.ad_placements;
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;
  if p_action not in ('approve', 'pause') then
    return jsonb_build_object('error', 'invalid_action');
  end if;

  select * into v_p from public.ad_placements where id = p_id for update;
  if not found or v_p.placement_type <> 'professional_card' then
    return jsonb_build_object('error', 'not_found');
  end if;

  if p_action = 'approve' then
    update public.ad_placements
       set status    = 'active',
           test_mode = false,
           -- תאריך התחלה בעתיד או ריק - מהיום. קיים ועבר - נשאר.
           starts_at = least(coalesce(starts_at, current_date), current_date),
           -- כרטיסייה ששולמה ועוד בתוקף שומרת על התקופה ששולמה; כל השאר
           -- בלי תאריך סיום (ראו 3 בראש הקובץ).
           ends_at   = case when paid_at is not null and ends_at >= current_date
                            then ends_at else null end
     where id = p_id;
  else
    update public.ad_placements set status = 'paused' where id = p_id;
  end if;

  return jsonb_build_object('success', true, 'id', p_id,
                            'status', case when p_action = 'approve' then 'active' else 'paused' end);
end;
$$;

revoke all on function public.admin_set_professional_card_status(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_set_professional_card_status(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. הכרטיסיות שכבר באוויר
-- ---------------------------------------------------------------------------

-- הטבת ההצטרפות: חינמיות (‏paid_at ריק) ופעילות - בלי תאריך סיום.
update public.ad_placements
   set ends_at = null
 where placement_type = 'professional_card'
   and status = 'active'
   and paid_at is null
   and ends_at is not null
   and ends_at >= current_date;

-- אבירם כהן אדריכלות - חוזר לפרסום.
update public.ad_placements
   set status    = 'active',
       test_mode = false,
       ends_at   = null
 where id = '22a54a21-07ea-4d3b-8a88-30ea2a5a1ed2'
   and placement_type = 'professional_card'
   and paid_at is null;
