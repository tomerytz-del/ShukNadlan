-- ============================================================================
-- ניהול כרטיסיות בעלי מקצוע מדף ניהול הפלטפורמה
--
-- בעל/ת מקצוע קונה נוכחות באתר — כרטיסייה ברצועת "בעלי מקצוע נבחרים" ועמוד
-- פרופיל מלא (professional.html?slug=…). מי שנרשם/ה מקבל/ת קישור ניהול
-- לעריכת התוכן שלו/ה, אבל **אף אחד לא יכול היה להסיר כרטיסייה**: רישום
-- בדיקה, כפילות, או מי שביקש/ה לרדת מהאתר נשארו באוויר עד שמישהו ניגש
-- למסד ידנית. זה בדיוק מה שקרה עם רישום הבדיקה הראשון.
--
-- על ad_placements יש היום policy אחת בלבד — קריאה ציבורית של שורות
-- ‏status='active'. אין policy של DELETE, ולכן שום מפתח ציבורי לא יכול
-- למחוק; וה-SELECT הציבורי גם לא מראה כרטיסייה מושהית או שפג תוקפה, כלומר
-- דווקא מה שמנהל/ת הפלטפורמה צריך/ה לראות היה מוסתר ממנו/ה.
--
-- הפתרון כאן הוא זה של שאר כלי הפלטפורמה (‏platform_admin_monthly_report,
-- ‏admin_apply_tier_change): שתי פונקציות security definer שהשורה הראשונה
-- בהן היא current_is_platform_admin(). לא פותחים את ה-policies של הטבלה
-- "רק בשביל המסך" — פתיחה כזו הייתה חושפת contact_email, monthly_price
-- ו-test_mode של כל המפרסמים לכל גולש (ראו docs/professional-cards.md,
-- "מה ציבורי ומה לא").
--
--   ‏1. ‏admin_list_professional_cards() — כל הכרטיסיות, בכל סטטוס.
--   ‏2. ‏admin_delete_professional_card(p_id) — מחיקה, ומחזירה את נתיבי
--      המדיה כדי שהמסך ינקה גם את האחסון.
--   ‏3. ‏policy שמתירה למנהל/ת הפלטפורמה למחוק אובייקטים תחת
--      ‏professionals/ ב-property-images — בלעדיה התמונות היו נשארות יתומות.
--
-- אסימון הניהול ב-ad_placement_access יורד עם השורה מעצמו: ה-FK שם הוא
-- ‏on delete cascade.
--
-- הקובץ אידמפוטנטי — אפשר להריץ אותו שוב.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. הרשימה
--
-- מחזירה גם כרטיסיות שאינן active. זו כל הנקודה של המסך: כרטיסייה שפג
-- תוקפה או שהושהתה אינה מוצגת באתר, ולכן היא בדיוק זו שאי אפשר היה לראות
-- ולכן גם לא לטפל בה. השדות הרגישים (contact_email, monthly_price,
-- test_mode) יוצאים כאן ורק כאן — הם מה שמבדיל רישום בדיקה ממפרסם משלם.
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_professional_cards()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb)
    into v_rows
    from (
      select p.id,
             p.slug,
             p.advertiser_name,
             p.business_name,
             p.advertiser_type,
             p.target_region,
             p.status,
             p.test_mode,
             p.monthly_price,
             p.contact_email,
             p.starts_at,
             p.ends_at,
             p.created_at,
             p.creative_url,
             p.cover_url,
             p.click_url,
             p.phone_e164,
             coalesce(array_length(p.gallery_urls, 1), 0) as gallery_count,
             -- "מולא" = מישהו נכנס לקישור הניהול וכתב משהו. כרטיסייה שלא
             -- מולאה היא כמעט תמיד רישום שננטש, וזה השיקול המרכזי במחיקה.
             (p.description is not null or p.services is not null
              or p.headline is not null or p.cover_url is not null) as profile_filled
        from public.ad_placements p
       where p.placement_type = 'professional_card'
    ) r;

  return v_rows;
end;
$$;

comment on function public.admin_list_professional_cards() is
  'כל כרטיסיות בעלי המקצוע, בכל סטטוס, לדף ניהול הפלטפורמה. מסרבת למי שאינו/ה מנהל/ת פלטפורמה.';

revoke all on function public.admin_list_professional_cards() from public;
revoke all on function public.admin_list_professional_cards() from anon;
grant execute on function public.admin_list_professional_cards() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. המחיקה
--
-- מחזירה את נתיבי האחסון של המדיה *לפני* שהשורה יורדת, כי אחריה הכתובות
-- כבר לא קיימות בשום מקום — והקבצים כן. המסך מוחק אותם אחר כך ב-best
-- effort, כמו במחיקת כתבה.
--
-- שתי הגנות שנראות מיותרות ואינן:
--   • ‏placement_type — הפונקציה עוקפת RLS, ובלי הבדיקה הזו מזהה שגוי היה
--     מוחק באנר פרסום או כל שורת ad_placements אחרת.
--   • ‏like על הנתיב — הנתיבים חוזרים למסך ומשם ל-storage.remove(). כתובת
--     שנשמרה בשדה חופשי ומצביעה לתיקייה של מישהו אחר לא תצא מכאן.
-- ---------------------------------------------------------------------------
create or replace function public.admin_delete_professional_card(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row   public.ad_placements%rowtype;
  v_media text[];
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  select * into v_row from public.ad_placements where id = p_id for update;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;
  if v_row.placement_type is distinct from 'professional_card' then
    return jsonb_build_object('error', 'not_a_professional_card');
  end if;

  select coalesce(array_agg(path), '{}'::text[])
    into v_media
    from (
      select distinct split_part(split_part(u, '/property-images/', 2), '?', 1) as path
        from unnest(
               array[v_row.creative_url, v_row.cover_url]
               || coalesce(v_row.gallery_urls, '{}'::text[])
             ) as u
       where u like '%/property-images/professionals/' || p_id::text || '/%'
    ) s
   where path <> '';

  delete from public.ad_placements where id = p_id;

  return jsonb_build_object(
    'ok', true,
    'name', coalesce(nullif(btrim(coalesce(v_row.business_name, '')), ''), v_row.advertiser_name),
    'media', to_jsonb(v_media)
  );
end;
$$;

comment on function public.admin_delete_professional_card(uuid) is
  'מחיקת כרטיסיית בעל/ת מקצוע על ידי מנהל/ת פלטפורמה. אסימון הניהול יורד ב-cascade; מחזירה את נתיבי המדיה לניקוי האחסון.';

revoke all on function public.admin_delete_professional_card(uuid) from public;
revoke all on function public.admin_delete_professional_card(uuid) from anon;
grant execute on function public.admin_delete_professional_card(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. מחיקת המדיה מהאחסון
--
-- ה-policies הקיימות על storage.objects מתירות מחיקה רק בתיקייה של הסוכן/ת
-- או של היזם/ית (‏<agent_id>/… ,‏<developer_id>/…). תמונות בעלי מקצוע יושבות
-- תחת professionals/<placement_id>/ — תיקייה שאינה שייכת לאף חשבון, ולכן אף
-- אחד לא יכול היה למחוק אותה מהדפדפן. בלי ה-policy הזו כל מחיקת כרטיסייה
-- הייתה משאירה את התמונות באחסון לנצח (ראו docs/storage-audit.md §3,
-- "קבצים יתומים").
--
-- ‏delete בלבד, ולא update/insert: מנהל/ת הפלטפורמה מנקה אחרי מחיקה, לא
-- עורכת את התוכן של מפרסם.
-- ---------------------------------------------------------------------------
drop policy if exists "platform admin deletes professional media" on storage.objects;
create policy "platform admin deletes professional media"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'property-images'
    and (storage.foldername(name))[1] = 'professionals'
    and public.current_is_platform_admin()
  );
