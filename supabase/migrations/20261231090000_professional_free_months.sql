-- ============================================================================
-- הטבת הצטרפות לבעלי מקצוע: 6 חודשי פרסום חינם, פעם אחת לכל בעל/ת מקצוע
-- ----------------------------------------------------------------------------
-- אותו רעיון של הטבת ההשקה לסוכנים (‏20261012090000_launch_promo_tiers.sql),
-- על מוצר שבנוי אחרת לגמרי: לבעל/ת מקצוע **אין חשבון באתר** ואין לו/ה שורה
-- ב-agency_members. הזהות היחידה שיש לנו היא האימייל שבטופס ההצטרפות, ולכן
-- "פעם אחת לכל משתמש/ת" פירושו כאן פעם אחת לכל אימייל מנורמל.
--
-- שלוש החלטות שמסבירות את המבנה:
--
-- 1. **הזכאות נרשמת בטבלה נפרדת, ולא נגזרת מ-ad_placements.** כרטיסייה
--    נמחקת מדף ניהול הפלטפורמה (‏admin_delete_professional_card), ואם הזכאות
--    הייתה נגזרת משורות הכרטיסיות — מחיקה הייתה מחזירה את ההטבה, ומי שביקש/ה
--    לרדת מהאתר היה יכול/ה להירשם שוב לעוד חצי שנה. ה-FK הוא
--    ‏`on delete set null` בדיוק מהסיבה הזו: הכרטיסייה יורדת, הרישום נשאר.
--
-- 2. **מי ששילם/ה פעם אינו/ה "מצטרף/ת".** כרטיסייה קודמת עם `paid_at` על
--    אותו אימייל פוסלת את ההטבה — היא נועדה למי שמגיע/ה לראשונה, לא למי
--    שכבר מפרסם/ת ויפתח/תפתח כרטיסייה שנייה כדי לדלג על התשלום.
--
-- 3. **ההטבה אינה עוברת בסולק ואינה יוצרת ad_orders.** שורת הזמנה מייצגת
--    כסף שעבר; ‏paid_at נשאר ריק, והתקופה החינמית מתועדת כאן. הארכה בתשלום
--    אחר כך עוברת ב-complete_ad_order כרגיל, והתקופה מצטברת מסוף החינמית.
--
-- האורך יושב ב-pricing_config (‏professional_card_free_months) ולא בקוד:
-- ‏0 מכבה את ההטבה בלי פריסה, וההרשמה חוזרת למסלול התשלום הרגיל.
--
-- אידמפוטנטית: ‏if not exists, ‏create or replace, ‏on conflict do nothing.
-- ============================================================================

insert into public.pricing_config (key, value, description)
values ('professional_card_free_months', 6,
        'חודשי פרסום חינם להצטרפות ראשונה של בעל/ת מקצוע (פעם אחת לאימייל). 0 מכבה את ההטבה.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 1. נרמול האימייל
--
-- אותיות קטנות, בלי רווחים, ובלי סיומת `+משהו` בחלק המקומי — אחרת
-- ‏a+1@x.com, ‏a+2@x.com ו-A@X.com היו שלושה "משתמשים" עם שלוש הטבות.
-- ---------------------------------------------------------------------------
create or replace function public.professional_email_key(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when p_email is null or btrim(p_email) = '' then null
           else regexp_replace(lower(btrim(p_email)), '\+[^@]*@', '@')
         end;
$$;

-- ---------------------------------------------------------------------------
-- 2. יומן ההטבות — שורה אחת לכל אימייל, לתמיד
-- ---------------------------------------------------------------------------
create table if not exists public.professional_free_claims (
  email_key    text primary key,
  placement_id uuid references public.ad_placements(id) on delete set null,
  months       int  not null check (months between 1 and 24),
  starts_at    date not null,
  ends_at      date not null,
  claimed_at   timestamptz not null default now()
);

comment on table public.professional_free_claims is
  'הטבת ההצטרפות של בעלי מקצוע. המפתח הוא האימייל המנורמל, והשורה נשארת גם כשהכרטיסייה נמחקת - זה מה שהופך את ההטבה לחד-פעמית.';

-- אין לבעל/ת המקצוע חשבון, ולכן אין למי לתת קריאה. כמו ad_orders: סגורה,
-- ומנהל/ת הפלטפורמה בלבד רואה אותה.
alter table public.professional_free_claims enable row level security;

drop policy if exists "platform admin reads professional free claims"
  on public.professional_free_claims;
create policy "platform admin reads professional free claims"
  on public.professional_free_claims
  for select using (public.current_is_platform_admin());

-- ---------------------------------------------------------------------------
-- 3. זכאות — לשאלה "האם להציג לאדם הזה תשלום"
-- ---------------------------------------------------------------------------
create or replace function public.professional_free_months_available(p_email text)
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key    text := public.professional_email_key(p_email);
  v_months int;
begin
  if v_key is null then return 0; end if;

  select coalesce(value, 0)::int into v_months
    from public.pricing_config where key = 'professional_card_free_months';
  if coalesce(v_months, 0) <= 0 then return 0; end if;

  if exists (select 1 from public.professional_free_claims where email_key = v_key) then
    return 0;
  end if;

  if exists (
    select 1 from public.ad_placements
     where placement_type = 'professional_card'
       and paid_at is not null
       and public.professional_email_key(contact_email) = v_key
  ) then
    return 0;
  end if;

  return v_months;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. מימוש — מעלה את הכרטיסייה לאוויר לתקופת ההטבה
--
-- ‏insert על המפתח הראשי הוא הנעילה: שתי הרשמות מקבילות עם אותו אימייל —
-- רק אחת נכנסת, והשנייה מקבלת promo_already_used ונשארת pending_payment.
-- ---------------------------------------------------------------------------
create or replace function public.claim_professional_free_months(p_placement_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p      public.ad_placements;
  v_months int;
  v_key    text;
  v_end    date;
begin
  select * into v_p from public.ad_placements where id = p_placement_id for update;
  if not found or v_p.placement_type <> 'professional_card' then
    return jsonb_build_object('error', 'placement_not_found');
  end if;
  if v_p.status <> 'pending_payment' then
    return jsonb_build_object('error', 'placement_not_pending', 'status', v_p.status);
  end if;

  v_key := public.professional_email_key(v_p.contact_email);
  v_months := public.professional_free_months_available(v_p.contact_email);
  if v_months <= 0 then
    return jsonb_build_object('error', 'promo_already_used');
  end if;

  v_end := (current_date + (v_months || ' months')::interval)::date;

  insert into public.professional_free_claims (email_key, placement_id, months, starts_at, ends_at)
  values (v_key, p_placement_id, v_months, current_date, v_end)
  on conflict (email_key) do nothing;
  if not found then
    return jsonb_build_object('error', 'promo_already_used');
  end if;

  -- ‏paid_at נשאר ריק בכוונה: לא עבר כסף.
  update public.ad_placements
     set status    = 'active',
         test_mode = false,
         starts_at = current_date,
         ends_at   = v_end
   where id = p_placement_id;

  return jsonb_build_object('success', true, 'placement_id', p_placement_id,
                            'months', v_months, 'ends_at', v_end);
end;
$$;

revoke all on function public.professional_email_key(text) from public, anon, authenticated;
grant execute on function public.professional_email_key(text) to service_role;

revoke all on function public.professional_free_months_available(text) from public, anon, authenticated;
grant execute on function public.professional_free_months_available(text) to service_role;

revoke all on function public.claim_professional_free_months(uuid) from public, anon, authenticated;
grant execute on function public.claim_professional_free_months(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. דף ניהול הפלטפורמה — סימון כרטיסייה שעלתה בהטבה
--
-- זהה לגרסה שב-20261019090000_professional_card_admin.sql, ועוד שני שדות
-- בסוף הרשומה: ‏paid_at ו-free_until. הפלט הוא jsonb, ולכן שדה נוסף אינו
-- שובר את המסך הקיים.
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
             -- נוסף עם הטבת ההצטרפות: כרטיסייה חינמית נראית על המסך בדיוק
             -- כמו כרטיסייה ששולמה, ו-paid_at ריק הוא גם מה שיש לרישום ידני.
             p.paid_at,
             (select c.ends_at from public.professional_free_claims c
               where c.placement_id = p.id) as free_until,
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
