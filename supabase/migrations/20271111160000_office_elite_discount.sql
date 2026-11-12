-- ============================================================================
-- הנחת משרד במסלול Elite (תומר, 11.11.2026)
--
-- ההחלטה: במשרד עם **3 עד 5** סוכנים משלמים ב-Elite, כל סוכן/ת **נוסף/ת**
-- מעבר לראשון/ה מקבל/ת **15%** הנחה על המנוי החודשי; עם **6 ומעלה** - **25%**.
-- **Elite בלבד.** לא עוברים לשיטת נקודות. הסוכן/ת הראשון/ה משלם/ת מחיר מלא.
--
-- ## איך זה מוגדר
--
--   * "משלם/ת Elite" = `paid_tier = 'premium'` ו-`paid_tier_until` בתוקף (או שעבר לפני
--     פחות מ-3 ימים, חלון הניסיונות החוזרים של חיוב שנכשל), בנוסף
--     לסוכן/ת שהמחיר מחושב עבורו/ה (הוא/היא עומד/ת לשלם). מי שבהטבת ההשקה בלי
--     תשלום אינו נספר: הוא לא משלם, וספירתו הייתה מורידה מחיר למשלם הראשון.
--   * "הראשון/ה" = הוותיק/ה ביותר במשרד מבין המשלמים (`created_at`, ואז `id`).
--     הוא/היא משלם/ת מחיר מלא תמיד.
--   * הגודל נקבע **ברגע החיוב** (הזמנה או חידוש חודשי), ולכן המחיר של סוכן/ת
--     יכול להשתנות מחודש לחודש עם גודל הצוות. זה מה שהתקנון אומר (סעיף 6).
--   * הספים והאחוזים ב-pricing_config, לא בקוד. מתחת ל-3 משלמים אין הנחה.
--
-- ‏**חודשי בלבד:** subscription-purchase קובע `months = 1`, והחידוש הוא חודש אחד, ולכן ההנחה
-- נקבעת פעם בחודש. עומס-היתר מחיל אותה גם על `p_months > 1` (על כל התקופה), אבל אין נתיב שמגיע לשם.
-- מי שיפתח רכישה לכמה חודשים צריך להחליט אם ההנחה קפואה לכל התקופה.
--
-- ## מה השתנה
--
--   * `office_elite_discount(agent)` - החישוב. service_role בלבד.
--   * `subscription_price(tier, months, agent)` - עומס-יתר שמפעיל את ההנחה על
--     הגרסה של שני הפרמטרים (שנשארת כמו שהייתה). service_role בלבד.
--   * `subscription_quote(tier)` - לדפדפן (checkout, CRM): המחיר **של הסוכן/ת
--     המחובר/ת**, כדי שמה שמוצג יהיה מה שנגבה. authenticated.
--   * `start_subscription_order` ו-`claim_due_tier_renewals` - הועתקו כלשונן מהפרודקשן
--     (md5 של הגוף נבדק מול ה-prosrc החי ב-11.11.2026) ושונתה בהן שורה אחת בכל אחת:
--     הקריאה ל-subscription_price מקבלת את הסוכן/ת.
--
-- אידמפוטנטית.
-- ============================================================================

insert into public.pricing_config (key, value, description) values
  ('office_discount_min_agents',     3,  'מספר סוכנים משלמים Elite במשרד שמתחיל ממנו הנחת משרד (כל סוכן נוסף מעבר לראשון)'),
  ('office_discount_pct_small',      15, 'אחוז הנחת משרד על Elite לכל סוכן נוסף, מ-office_discount_min_agents ועד לפני office_discount_big_min_agents'),
  ('office_discount_big_min_agents', 6,  'מספר סוכנים משלמים Elite במשרד שממנו חל אחוז ההנחה הגבוה'),
  ('office_discount_pct_big',        25, 'אחוז הנחת משרד על Elite לכל סוכן נוסף, מ-office_discount_big_min_agents ומעלה')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 1. החישוב
-- ---------------------------------------------------------------------------
create or replace function public.office_elite_discount(p_agent uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_agency uuid;
  v_min    numeric;
  v_small  numeric;
  v_bigmin numeric;
  v_big    numeric;
  v_n      int;
  v_anchor uuid;
  v_pct    numeric := 0;
begin
  select agency_id into v_agency from public.agency_members where id = p_agent;
  if v_agency is null then
    return jsonb_build_object('pct', 0, 'paying_elite', 1, 'is_anchor', true);
  end if;

  select value into v_min    from public.pricing_config where key = 'office_discount_min_agents';
  select value into v_small  from public.pricing_config where key = 'office_discount_pct_small';
  select value into v_bigmin from public.pricing_config where key = 'office_discount_big_min_agents';
  select value into v_big    from public.pricing_config where key = 'office_discount_pct_big';
  v_min    := coalesce(v_min, 3);
  v_small  := coalesce(v_small, 15);
  v_bigmin := coalesce(v_bigmin, 6);
  v_big    := coalesce(v_big, 25);

  with paying as (
    select m.id, m.created_at
      from public.agency_members m
     where m.agency_id = v_agency
       and m.active and m.released_at is null
       and (m.id = p_agent
            -- ‏3 ימי חסד: חיוב שנכשל מנוסה שוב אחרי יום ואחרי שלושה ימים (terms §6), ובינתיים
            -- paid_tier_until כבר עבר. בלי החסד, סדר החידושים באותו יום קובע מי נספר, והמחיר
            -- של אותו משרד משתנה לפי איזה סוכן/ת חויב/ה קודם.
            or (m.paid_tier = 'premium' and m.paid_tier_until > now() - interval '3 days'))
  )
  select count(*)::int,
         (select p.id from paying p order by p.created_at, p.id limit 1)
    into v_n, v_anchor
    from paying;

  if p_agent is distinct from v_anchor then
    if v_n >= v_bigmin then v_pct := v_big;
    elsif v_n >= v_min then v_pct := v_small;
    end if;
  end if;

  return jsonb_build_object('pct', v_pct, 'paying_elite', v_n, 'is_anchor', p_agent is not distinct from v_anchor);
end;
$$;

revoke all on function public.office_elite_discount(uuid) from public, anon, authenticated;
grant execute on function public.office_elite_discount(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. המחיר עם ההנחה. הגרסה של שני הפרמטרים נשארת בדיוק כפי שהייתה.
--    עיגול לאגורות על המחיר החודשי לפני הכפלה בחודשים ובמע"מ, כדי שהסכום
--    שהוצג יהיה הסכום שנשלח לסולק.
-- ---------------------------------------------------------------------------
create or replace function public.subscription_price(p_tier text, p_months int, p_agent uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base    jsonb := public.subscription_price(p_tier, p_months);
  v_disc    jsonb;
  v_pct     numeric;
  v_monthly numeric;
  v_before  numeric;
  v_vat     numeric;
begin
  if v_base ? 'error' then return v_base; end if;
  v_base := v_base || jsonb_build_object('list_monthly', v_base->'monthly', 'discount_pct', 0);
  if p_tier <> 'premium' or p_agent is null then return v_base; end if;

  v_disc := public.office_elite_discount(p_agent);
  v_pct := coalesce((v_disc->>'pct')::numeric, 0);
  v_base := v_base || jsonb_build_object('paying_elite', v_disc->'paying_elite');
  if v_pct <= 0 then return v_base; end if;

  v_vat     := (v_base->>'vat_rate')::numeric;
  v_monthly := round((v_base->>'monthly')::numeric * (1 - v_pct / 100), 2);
  v_before  := v_monthly * p_months;
  return v_base || jsonb_build_object(
    'monthly', v_monthly,
    'amount_before_vat', v_before,
    'amount', round(v_before * (1 + v_vat), 2),
    'discount_pct', v_pct);
end;
$$;

revoke all on function public.subscription_price(text, int, uuid) from public, anon, authenticated;
grant execute on function public.subscription_price(text, int, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. הצעת מחיר לדפדפן: המחיר של הסוכן/ת המחובר/ת, אותה פונקציה שגובה
-- ---------------------------------------------------------------------------
create or replace function public.subscription_quote(p_tier text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_agent uuid := public.current_agent_id();
begin
  if v_agent is null then return jsonb_build_object('error', 'not_agent'); end if;
  return public.subscription_price(p_tier, 1, v_agent);
end;
$$;

revoke all on function public.subscription_quote(text) from public, anon, authenticated;
grant execute on function public.subscription_quote(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. שתי פונקציות החיוב: אותו גוף, והקריאה מקבלת את הסוכן/ת
-- ---------------------------------------------------------------------------
create or replace function public.start_subscription_order(
  p_agent_id uuid, p_tier text, p_months int
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_price  jsonb;
  v_id     uuid;
  v_open   int;
  v_member public.agency_members;
begin
  select * into v_member from public.agency_members where id = p_agent_id and active;
  if not found then
    return jsonb_build_object('error', 'agent_inactive');
  end if;

  -- בתקופת ההטבה: רק בחודש האחרון, וכל מסלול - התקופה תתחיל בסוף ההטבה,
  -- ולכן גם PROFESSIONAL אינו "ירידה" עכשיו (complete_subscription_order).
  -- לפני כן אין מה לשלם עליו: Elite ניתן ממילא.
  if v_member.promo_ends_at is not null
     and v_member.promo_ended_at is null
     and v_member.promo_ends_at > now() + interval '30 days' then
    return jsonb_build_object('error', 'promo_active', 'promo_ends_at', v_member.promo_ends_at);
  end if;

  -- ירידה למסלול נמוך יותר בזמן שמסלול גבוה ששולם עדיין בתוקף: נכנסת לתוקף
  -- בסוף התקופה ששולמה (terms.html §6). אין כאן "מסלול עתידי" - מבטלים את
  -- החידוש, ובסוף התקופה רוכשים את הנמוך. שדרוג, לעומת זאת, מיידי.
  if v_member.tier_source = 'paid'
     and v_member.paid_tier_until > now()
     and public.tier_rank(p_tier) < public.tier_rank(v_member.tier) then
    return jsonb_build_object('error', 'downgrade_at_period_end', 'paid_until', v_member.paid_tier_until);
  end if;

  v_price := public.subscription_price(p_tier, p_months, p_agent_id);
  if v_price ? 'error' then return v_price; end if;

  select count(*) into v_open from public.subscription_orders
   where agent_id = p_agent_id and status = 'pending'
     and created_at > now() - interval '30 minutes';
  if v_open >= 3 then
    return jsonb_build_object('error', 'too_many_open_orders');
  end if;

  insert into public.subscription_orders
    (agent_id, tier, months, amount, amount_before_vat, vat_rate, status, provider)
  values
    (p_agent_id, p_tier, p_months,
     (v_price->>'amount')::numeric,
     (v_price->>'amount_before_vat')::numeric,
     (v_price->>'vat_rate')::numeric,
     'pending', 'morning')
  returning id into v_id;

  return jsonb_build_object('success', true, 'order_id', v_id,
                            'amount', (v_price->>'amount')::numeric,
                            'tier', p_tier, 'months', p_months);
end;
$$;

create or replace function public.claim_due_tier_renewals(p_limit int default 20)
returns table (
  subscription_id uuid,
  order_id        uuid,
  agent_id        uuid,
  tier            text,
  amount          numeric,
  card_token      text,
  contact_email   text,
  display_name    text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_on    numeric;
  v_price jsonb;
  r       record;
  v_order uuid;
begin
  select value into v_on from public.pricing_config where key = 'recurring_charging_enabled';
  if coalesce(v_on, 0) <> 1 then
    return;
  end if;

  -- ‏**מסלול שהשתנה מחוץ לרכישה מבטל את החידוש.** המסלול יורד בכמה דרכים
  -- (‏admin_apply_tier_change, ‏set_tier, סוף תקופה, סגירה) - ובדיקת מצב כאן
  -- תופסת את כולן, בלי לזכור לבטל בכל אחת. אותו נימוק של phone_line_tier_sweep.
  -- בתקופת ההטבה המסלול על השורה הוא של ההטבה, ולכן היא מחוץ לבדיקה.
  update public.billing_subscriptions s
     set status = 'cancelled', cancelled_at = now(), next_retry_at = null,
         last_error = 'tier_changed', updated_at = now()
    from public.agency_members m
   where s.kind = 'tier' and s.status = 'active' and s.charging_order_id is null
     and m.id = s.agent_id
     and m.tier is distinct from s.tier
     and not (m.promo_ends_at is not null and m.promo_ended_at is null and m.promo_ends_at > now());

  for r in
    select s.*, m.display_name as m_name
      from public.billing_subscriptions s
      join public.agency_members m on m.id = s.agent_id
     where s.kind = 'tier'
       and s.status = 'active'
       and s.charging_order_id is null
       and m.active                                   -- חשבון סגור: לא גובים
       -- ביקש/ה לסגור את החשבון: נשאר/ת עד סוף התקופה ששולמה, בלי חיוב נוסף
       -- (‏close-account). ביטול הבקשה מחזיר את החידוש מעצמו.
       and m.closure_requested_at is null
       and (
             (s.failed_attempts = 0 and s.next_charge_on <= current_date)
          or (s.failed_attempts > 0 and s.next_retry_at <= now())
           )
     order by s.next_charge_on
     limit greatest(1, least(coalesce(p_limit, 20), 100))
     for update of s skip locked
  loop
    v_price := public.subscription_price(r.tier, 1, r.agent_id);
    if v_price ? 'error' then
      continue;
    end if;

    insert into public.subscription_orders
      (agent_id, tier, months, amount, amount_before_vat, vat_rate, status,
       provider, auto_renew, subscription_id, contact_email)
    values
      (r.agent_id, r.tier, 1,
       (v_price->>'amount')::numeric,
       (v_price->>'amount_before_vat')::numeric,
       (v_price->>'vat_rate')::numeric,
       'pending', 'morning_token', true, r.id, r.contact_email)
    returning id into v_order;

    update public.billing_subscriptions
       set charging_order_id = v_order, notice_order_id = v_order, updated_at = now()
     where id = r.id;

    subscription_id := r.id;
    order_id        := v_order;
    agent_id        := r.agent_id;
    tier            := r.tier;
    amount          := (v_price->>'amount')::numeric;
    card_token      := r.card_token;
    contact_email   := r.contact_email;
    display_name    := r.m_name;
    return next;
  end loop;
end;
$$;

revoke all on function public.start_subscription_order(uuid, text, int) from public, anon, authenticated;
grant execute on function public.start_subscription_order(uuid, text, int) to service_role;

revoke all on function public.claim_due_tier_renewals(int) from public, anon, authenticated;
grant execute on function public.claim_due_tier_renewals(int) to service_role;
