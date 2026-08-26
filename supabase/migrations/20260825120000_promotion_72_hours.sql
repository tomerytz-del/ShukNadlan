-- ============================================================================
-- קידום נכס: חלון של 72 שעות מרגע הרכישה (במקום 30 יום)
--
-- ארבעה שינויים:
--   1. ‏promoted_until הופך ל-timestamptz — חלון של שעות לא נכנס לעמודת date.
--   2. ‏pricing_config: promote_duration_hours=72, ו-promote_price_monthly
--      מוחלף ב-promote_price (השם "monthly" כבר לא נכון).
--   3. ‏promote_property() מקדם ל-now() + החלון, ובודק תפוגה מול now().
--   4. ‏expire_promotions() + cron כל 15 דקות — בלי זה is_promoted היה נשאר
--      true לנצח, והסרט "מקודם" באתר הציבורי (index.html, property.html
--      קוראים רק את is_promoted) היה נשאר גם אחרי שהקידום נגמר.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. דיוק של שעות
--
-- ערכים קיימים (תאריכים) הופכים לחצות של אותו יום ונשארים בתוקף עד אז —
-- קידום שנרכש לפי התנאים הישנים לא מתקצר רטרואקטיבית.
-- ---------------------------------------------------------------------------
alter table public.properties
  alter column promoted_until type timestamptz using promoted_until::timestamptz;

comment on column public.properties.promoted_until is
  'סוף חלון הקידום. מתמלא ב-promote_property לפי promote_duration_hours. ריק = קידום ידני/היסטורי ללא תפוגה.';

-- ---------------------------------------------------------------------------
-- 2. משך ומחיר
-- ---------------------------------------------------------------------------
insert into public.pricing_config (key, value, description)
values ('promote_duration_hours', 72, 'שעות שבהן הנכס מקודם, מרגע הרכישה')
on conflict (key) do nothing;

insert into public.pricing_config (key, value, description)
select 'promote_price',
       coalesce((select value from public.pricing_config where key = 'promote_price_monthly'), 20),
       '₪ לרכישת קידום נכס לחלון אחד של promote_duration_hours'
on conflict (key) do nothing;

delete from public.pricing_config where key = 'promote_price_monthly';

-- ---------------------------------------------------------------------------
-- 3. הקידום עצמו
--
-- ‏already_promoted נבדק מול now() ולא מול current_date, אחרת קידום שנגמר
-- לפני שעתיים עדיין נחשב פעיל עד חצות. בתום החלון הכפתור חוזר והסוכן/ת
-- יכול/ה לקדם שוב בתשלום נוסף.
-- ---------------------------------------------------------------------------
create or replace function public.promote_property(p_property_id uuid, p_agent_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_price    numeric;
  v_hours    numeric;
  v_until    timestamptz;
  v_rows     int;
  v_promoted boolean;
begin
  if not exists (select 1 from public.properties
                 where id = p_property_id and agent_id = p_agent_id) then
    return jsonb_build_object('error', 'not_your_property');
  end if;

  select (is_promoted and promoted_until is not null and promoted_until > now())
    into v_promoted
  from public.properties where id = p_property_id;
  if v_promoted then
    return jsonb_build_object('error', 'already_promoted');
  end if;

  select value into v_price from public.pricing_config where key = 'promote_price';
  v_price := coalesce(v_price, 20);
  select value into v_hours from public.pricing_config where key = 'promote_duration_hours';
  v_hours := coalesce(v_hours, 72);
  v_until := now() + make_interval(hours => v_hours::int);

  update public.agency_members set credit_balance = credit_balance - v_price
  where id = p_agent_id and credit_balance >= v_price;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return jsonb_build_object('error', 'insufficient_balance', 'required', v_price);
  end if;

  insert into public.promotion_charges (property_id, agent_id, amount, billing_period_start, status)
  values (p_property_id, p_agent_id, v_price, date_trunc('month', now())::date, 'active');

  update public.properties
  set is_promoted = true, promoted_until = v_until
  where id = p_property_id;

  return jsonb_build_object(
    'success', true,
    'price_charged', v_price,
    'duration_hours', v_hours,
    'promoted_until', v_until
  );
end;
$$;

comment on function public.promote_property(uuid, uuid) is
  'קידום נכס לחלון promote_duration_hours (72 שעות) מרגע הרכישה. ל-service_role בלבד, דרך ה-Edge Function promote-property.';

revoke all on function public.promote_property(uuid, uuid) from public;
revoke all on function public.promote_property(uuid, uuid) from anon;
revoke all on function public.promote_property(uuid, uuid) from authenticated;
grant execute on function public.promote_property(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. כיבוי אוטומטי בתום החלון
--
-- שורות עם promoted_until ריק לא נגעות: אלה קידומים ידניים/היסטוריים שלא
-- נרכשו דרך promote_property, ואין להן מועד סיום להשוות אליו.
-- ---------------------------------------------------------------------------
create or replace function public.expire_promotions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows int;
begin
  update public.properties
     set is_promoted = false
   where is_promoted = true
     and promoted_until is not null
     and promoted_until <= now();
  get diagnostics v_rows = row_count;

  -- החיוב עובר ל-expired כדי שהיסטוריית החיובים תשקף מה עדיין פעיל
  update public.promotion_charges pc
     set status = 'expired'
   where pc.status = 'active'
     and exists (select 1 from public.properties p
                 where p.id = pc.property_id
                   and p.is_promoted = false);

  return v_rows;
end;
$$;

comment on function public.expire_promotions() is
  'מכבה is_promoted לנכסים שחלון הקידום שלהם נגמר. רצה ב-cron כל 15 דקות.';

revoke all on function public.expire_promotions() from public;
revoke all on function public.expire_promotions() from anon;
revoke all on function public.expire_promotions() from authenticated;

select cron.unschedule('expire-promotions')
where exists (select 1 from cron.job where jobname = 'expire-promotions');

select cron.schedule('expire-promotions', '*/15 * * * *', $$select public.expire_promotions()$$);
