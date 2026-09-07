-- ============================================================================
-- ניהול מנויים למנהל/ת הפלטפורמה
-- ----------------------------------------------------------------------------
-- ‏מיגרציית המסלולים (20261012090000) העבירה את בחירת המסלול לסוכן/ת, וקבעה
-- שמסלול בתשלום מחוץ לתקופת ההטבה נרשם כ**בקשה** ולא מוחל בלחיצה: ‏set_tier
-- כותבת ‎pending_tier_change‎ ושולחת מייל להנהלה. מה שלא היה שם הוא הצד השני
-- של אותה בקשה — לאשר אותה.
--
-- בפועל זה אומר שאישור שדרוג היה ‎update‎ ידני ב-SQL Editor. זה עובד לחמש
-- בקשות ולא לחמישים, וכל טעות הקלדה שם היא מסלול שגוי על שורה של אדם אמיתי:
-- ‏tier בלי ‎tier_source‎ הוא מסלול ש-‎expire_launch_promos‎ עלול/ה להוריד
-- בתום ההטבה, ו-‎pending_tier_change‎ שלא נוקה משאיר בקשה פתוחה לנצח.
--
-- ארבע הפונקציות כאן הן אותה פעולה, בשלמותה ובפעם אחת. כולן ‎security definer‎
-- ובודקות ‎current_is_platform_admin()‎ בעצמן, ולכן מותר לקרוא להן מהדפדפן:
-- הרשאת הקריאה ניתנת ל-‎authenticated‎, וההרשאה האמיתית נבדקת בתוכן.
--
-- ‏**למה RPC ולא Edge Function.** ‏tier נעול מול הדפדפן בטריגר
-- ‎protect_sensitive_agency_member_fields‎, שמכיר ‎service_role‎ ו-‎postgres‎
-- כהקשר מנהלתי. פונקציית ‎security definer‎ בבעלות ‎postgres‎ רצה בדיוק
-- בהקשר הזה, ולכן היא יכולה לכתוב את המסלול בלי Edge Function נוספת לפרוס
-- ולתחזק. ה-JWT של מנהל/ת הפלטפורמה נבדק ב-‎current_is_platform_admin()‎,
-- שקוראת את ‎auth.uid()‎ — ואותה אי אפשר לזייף מהדפדפן.
--
-- אידמפוטנטית: ‎create or replace‎ בלבד, בלי DDL על טבלאות.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. תור הבקשות
--
-- בדיקת ההרשאה יושבת ב-‎where‎ ולא ב-‎raise‎: לפונקציית קריאה, רשימה ריקה היא
-- התשובה הנכונה למי שאינו/ה מנהל/ת פלטפורמה. שגיאה הייתה מספרת לקורא/ת
-- שהפונקציה קיימת ומה שמה.
--
-- שמות עמודות ההחזרה נבחרו כך שלא יתנגשו בשמות עמודות בטבלאות — ב-plpgsql
-- זה מקור לשגיאת ambiguity בזמן ריצה, וכאן זו פונקציית sql שבה זה פחות
-- קריטי, אבל העקביות שומרת על שתי הפונקציות הבאות קריאות.
-- ---------------------------------------------------------------------------
create or replace function public.pending_tier_requests()
returns table (
  member         uuid,
  member_name    text,
  member_email   text,
  agency_name    text,
  now_tier       text,
  wanted_tier    text,
  asked_on       date,
  source_now     text,
  promo_ends     timestamptz,
  wallet_balance numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.display_name, m.email, a.name,
         m.tier, m.pending_tier_change, m.pending_tier_change_at,
         m.tier_source, m.promo_ends_at, m.credit_balance
    from public.agency_members m
    left join public.agencies a on a.id = m.agency_id
   where public.current_is_platform_admin()
     and m.pending_tier_change is not null
     and m.active = true
   order by m.pending_tier_change_at nulls last, m.display_name;
$$;

comment on function public.pending_tier_requests() is
  'בקשות שדרוג מסלול שממתינות לאישור. ריקה למי שאינו/ה מנהל/ת פלטפורמה.';

revoke all on function public.pending_tier_requests() from public;
revoke all on function public.pending_tier_requests() from anon;
grant execute on function public.pending_tier_requests() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. אישור הבקשה
--
-- שלושת הדברים שקורים כאן קורים יחד או בכלל לא: המסלול מוחל, הבקשה נוקתה,
-- והשינוי נרשם ביומן. ‏update ידני שעושה רק את הראשון משאיר בקשה פתוחה
-- שתופיע שוב בתור מחר.
--
-- ‏tier_source נכתב 'platform_admin' — וזה לא קישוט: ‎expire_launch_promos‎
-- מורידה ל-Pay&GO רק מקורות של הטבה (‏launch_promo / launch_promo_accepted).
-- מסלול שאושר ידנית שורד את תום התקופה, כפי שצריך.
-- ---------------------------------------------------------------------------
create or replace function public.admin_apply_tier_change(
  p_member_id uuid,
  p_tier      text default null,
  p_note      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.agency_members%rowtype;
  v_target text;
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  select * into v_member from public.agency_members where id = p_member_id for update;
  if not found then
    return jsonb_build_object('error', 'member_not_found');
  end if;

  -- ‏p_tier ריק = "אשר את מה שביקשו". מסלול מפורש גובר, כדי שאפשר יהיה
  -- לאשר מסלול אחר מזה שהתבקש בלי לעבור דרך המסד.
  v_target := coalesce(nullif(btrim(coalesce(p_tier, '')), ''), v_member.pending_tier_change);
  if v_target is null then
    return jsonb_build_object('error', 'no_pending_request');
  end if;
  if v_target not in ('free', 'mid', 'premium') then
    return jsonb_build_object('error', 'invalid_tier', 'tier', v_target);
  end if;

  update public.agency_members
     set tier                   = v_target,
         tier_selected_at       = now(),
         tier_source            = 'platform_admin',
         pending_tier_change    = null,
         pending_tier_change_at = null
   where id = p_member_id;

  insert into public.tier_changes (member_id, agency_id, from_tier, to_tier, source, note)
  values (p_member_id, v_member.agency_id, v_member.tier, v_target, 'platform_admin',
          coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'אישור בקשת שדרוג'));

  return jsonb_build_object(
    'success',   true,
    'member_id', p_member_id,
    'from_tier', v_member.tier,
    'to_tier',   v_target,
    'email',     v_member.email,
    'name',      v_member.display_name);
end;
$$;

comment on function public.admin_apply_tier_change(uuid, text, text) is
  'מנהל/ת פלטפורמה מאשר/ת בקשת שדרוג: מסלול, ניקוי הבקשה ורישום ביומן — יחד.';

revoke all on function public.admin_apply_tier_change(uuid, text, text) from public;
revoke all on function public.admin_apply_tier_change(uuid, text, text) from anon;
grant execute on function public.admin_apply_tier_change(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. דחיית הבקשה
--
-- הדחייה נרשמת ביומן ולא רק מוחקת את הבקשה: "ביקשתי שדרוג ולא קרה כלום" הוא
-- בדיוק סוג הדבר שנשאל עליו חודש אחר כך, ובלי שורה ביומן אין תשובה.
-- ‏to_tier הוא המסלול שהתבקש (הוא NOT NULL בטבלה), והמקור מבדיל בין השניים.
-- ---------------------------------------------------------------------------
create or replace function public.admin_reject_tier_change(
  p_member_id uuid,
  p_note      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.agency_members%rowtype;
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  select * into v_member from public.agency_members where id = p_member_id for update;
  if not found then
    return jsonb_build_object('error', 'member_not_found');
  end if;
  if v_member.pending_tier_change is null then
    return jsonb_build_object('error', 'no_pending_request');
  end if;

  update public.agency_members
     set pending_tier_change = null, pending_tier_change_at = null
   where id = p_member_id;

  insert into public.tier_changes (member_id, agency_id, from_tier, to_tier, source, note)
  values (p_member_id, v_member.agency_id, v_member.tier, v_member.pending_tier_change,
          'request_rejected',
          coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'הבקשה נדחתה'));

  return jsonb_build_object('success', true, 'member_id', p_member_id,
                            'rejected_tier', v_member.pending_tier_change);
end;
$$;

comment on function public.admin_reject_tier_change(uuid, text) is
  'דחיית בקשת שדרוג. מנקה את הבקשה ורושמת ביומן — הדחייה עצמה היא מידע.';

revoke all on function public.admin_reject_tier_change(uuid, text) from public;
revoke all on function public.admin_reject_tier_change(uuid, text) from anon;
grant execute on function public.admin_reject_tier_change(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. היומן, ותמונת המצב
--
-- ‏tier_changes נכתב מאז מיגרציית המסלולים ולא היה לו קורא. כאן הוא נקרא:
-- מי עבר לאן, מתי, ובאיזה מסלול הגיע לשם (הטבה / בחירה עצמית / אישור
-- ידני / תום הטבה / בקשה שנדחתה).
-- ---------------------------------------------------------------------------
create or replace function public.recent_tier_changes(p_limit int default 40)
returns table (
  changed_on  timestamptz,
  member_name text,
  agency_name text,
  was_tier    text,
  became_tier text,
  change_src  text,
  change_note text
)
language sql
stable
security definer
set search_path = public
as $$
  select c.created_at, m.display_name, a.name, c.from_tier, c.to_tier, c.source, c.note
    from public.tier_changes c
    join public.agency_members m on m.id = c.member_id
    left join public.agencies a on a.id = c.agency_id
   where public.current_is_platform_admin()
   order by c.created_at desc
   limit least(greatest(coalesce(p_limit, 40), 1), 200);
$$;

revoke all on function public.recent_tier_changes(int) from public;
revoke all on function public.recent_tier_changes(int) from anon;
grant execute on function public.recent_tier_changes(int) to authenticated, service_role;

-- תמונת המצב שמעל התור: כמה על כל מסלול, כמה בתוך ההטבה, וכמה מהם ייגמרו
-- בחודש הקרוב — המספר האחרון הוא זה שמנבא את גל הבקשות הבא.
create or replace function public.subscription_overview()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when public.current_is_platform_admin() then jsonb_build_object(
    'free',            count(*) filter (where tier = 'free'),
    'mid',             count(*) filter (where tier = 'mid'),
    'premium',         count(*) filter (where tier = 'premium'),
    'promo_active',    count(*) filter (where promo_ends_at > now() and promo_ended_at is null),
    'promo_ending_30', count(*) filter (where promo_ends_at > now()
                                          and promo_ends_at <= now() + interval '30 days'
                                          and promo_ended_at is null),
    'pending',         count(*) filter (where pending_tier_change is not null)
  ) else '{}'::jsonb end
    from public.agency_members
   where active = true;
$$;

revoke all on function public.subscription_overview() from public;
revoke all on function public.subscription_overview() from anon;
grant execute on function public.subscription_overview() to authenticated, service_role;
