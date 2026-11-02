-- ============================================================================
-- כרטיסיית בעל מקצוע לא עולה לאוויר בלי טלפון
--
-- ‏phone_e164 הוא כל כפתורי הקשר בעמוד הפרופיל (‏renderContact ב-
-- ‏professional.html): וואטסאפ, חיוג, הכרטיס הצדדי והסרגל הקבוע. בלעדיו העמוד
-- נטען ונראה תקין, ואין בו שום דרך לפנות. כך עלתה ב-21.10.2026 כרטיסייה
-- שנרשמה בלי טלפון ולא השלימה את מסך העריכה.
--
-- ההרשמה (‏professional-signup) ומסך העריכה (‏professional-manage) דוחים כבר
-- בקשה בלי טלפון. כאן נסגר הפתח השלישי: אישור ידני של מנהל/ת הפלטפורמה מה-CRM.
--
-- **לא** אילוץ על הטבלה ולא סינון ב-view, בכוונה: שניהם היו מורידים מהאתר
-- מיד כרטיסייה שכבר באוויר בלי טלפון, בלי שאיש דיבר עם בעל/ת המקצוע. היא
-- מסומנת ב-CRM ("אין טלפון") ומטופלת ביד.
--
-- זהה לגרסה שב-20270701090000_professional_free_publishing.sql, ועוד בדיקה
-- אחת לפני האישור.
-- ============================================================================

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
    -- אותו פורמט ש-PHONE_RE בעמוד הפרופיל דורש; מספר אחר לא מייצר כפתור
    if coalesce(v_p.phone_e164, '') !~ '^\d{9,15}$' then
      return jsonb_build_object('error', 'phone_required');
    end if;

    update public.ad_placements
       set status    = 'active',
           test_mode = false,
           -- תאריך התחלה בעתיד או ריק - מהיום. קיים ועבר - נשאר.
           starts_at = least(coalesce(starts_at, current_date), current_date),
           -- כרטיסייה ששולמה ועוד בתוקף שומרת על התקופה ששולמה; כל השאר
           -- בלי תאריך סיום.
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
