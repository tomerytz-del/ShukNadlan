-- ===========================================================================
-- מחיר משרד ב-Elite: מחיר לסוכן/ת לפי גודל המשרד, בשקלים, בלי אחוזים (12.11.2026)
--
-- מחליף את הנחת האחוזים של 20271111160000 (15% ו-25% לכל סוכן/ת נוסף/ת). החלטת תומר:
--   1-2 סוכנים ב-Elite   399 (מחיר המחירון)
--   3 עד 5               359 לכל סוכן/ת
--   6 עד 10              339 לכל סוכן/ת
--   11 ומעלה             299 לכל סוכן/ת
-- **כל** הסוכנים במשרד משלמים את אותו מחיר, גם הוותיק/ה: אין יותר "סוכן ראשון במחיר
-- מלא". לכן גם אין צורך בחישוב או בדוגמה בדף.
--
-- מה לא השתנה: מי נספר כ"משלם/ת Elite" (paid_tier = 'premium' ובתוקף, או שפג לפני פחות מ-3
-- ימים, בנוסף לסוכן/ת שהמחיר מחושב עבורו/ה), הגודל נקבע ברגע החיוב, החיוב נשאר פר-סוכן/ת,
-- ו-subscription_price(tier, months) ללא סוכן/ת נשארת מחיר המחירון. start_subscription_order,
-- claim_due_tier_renewals ו-subscription_quote קוראות ל-subscription_price(.., agent), והמבנה של
-- התשובה (monthly, amount_before_vat, amount, list_monthly, paying_elite) נשמר.
--
-- discount_pct יצא מהתשובה: אין יותר אחוז לא בדף ולא בדף התשלום.
-- ===========================================================================

insert into public.pricing_config (key, value, description) values
  ('office_price_tier1_min_agents', 3,   'מספר סוכנים משלמים Elite במשרד שממנו חל office_price_tier1 לכל סוכן/ת'),
  ('office_price_tier1',            359, 'מחיר Elite לחודש לסוכן/ת (לפני מע״מ) במשרד עם office_price_tier1_min_agents עד לפני office_price_tier2_min_agents סוכנים'),
  ('office_price_tier2_min_agents', 6,   'מספר סוכנים משלמים Elite במשרד שממנו חל office_price_tier2 לכל סוכן/ת'),
  ('office_price_tier2',            339, 'מחיר Elite לחודש לסוכן/ת (לפני מע״מ) במשרד עם office_price_tier2_min_agents עד לפני office_price_tier3_min_agents סוכנים'),
  ('office_price_tier3_min_agents', 11,  'מספר סוכנים משלמים Elite במשרד שממנו חל office_price_tier3 לכל סוכן/ת'),
  ('office_price_tier3',            299, 'מחיר Elite לחודש לסוכן/ת (לפני מע״מ) במשרד עם office_price_tier3_min_agents סוכנים ומעלה')
on conflict (key) do nothing;

-- כמה סוכנים משלמים Elite במשרד של הסוכן/ת, ואיזה מחיר חל. price = null: אין מחיר משרד.
create or replace function public.office_elite_price(p_agent uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_agency uuid;
  v_n      int;
  v_min1   numeric; v_p1 numeric;
  v_min2   numeric; v_p2 numeric;
  v_min3   numeric; v_p3 numeric;
  v_price  numeric;
begin
  select agency_id into v_agency from public.agency_members where id = p_agent;
  if v_agency is null then
    return jsonb_build_object('price', null, 'paying_elite', 1);
  end if;

  select value into v_min1 from public.pricing_config where key = 'office_price_tier1_min_agents';
  select value into v_p1   from public.pricing_config where key = 'office_price_tier1';
  select value into v_min2 from public.pricing_config where key = 'office_price_tier2_min_agents';
  select value into v_p2   from public.pricing_config where key = 'office_price_tier2';
  select value into v_min3 from public.pricing_config where key = 'office_price_tier3_min_agents';
  select value into v_p3   from public.pricing_config where key = 'office_price_tier3';
  v_min1 := coalesce(v_min1, 3);  v_p1 := coalesce(v_p1, 359);
  v_min2 := coalesce(v_min2, 6);  v_p2 := coalesce(v_p2, 339);
  v_min3 := coalesce(v_min3, 11); v_p3 := coalesce(v_p3, 299);

  select count(*)::int into v_n
    from public.agency_members m
   where m.agency_id = v_agency
     and m.active and m.released_at is null
     and (m.id = p_agent
          -- 3 ימי חסד: חיוב שנכשל מנוסה שוב אחרי יום ואחרי שלושה ימים (terms §6), ובינתיים
          -- paid_tier_until כבר עבר. בלי החסד, סדר החידושים באותו יום קובע מי נספר.
          or (m.paid_tier = 'premium' and m.paid_tier_until > now() - interval '3 days'));

  if    v_n >= v_min3 then v_price := v_p3;
  elsif v_n >= v_min2 then v_price := v_p2;
  elsif v_n >= v_min1 then v_price := v_p1;
  end if;

  return jsonb_build_object('price', v_price, 'paying_elite', v_n);
end;
$$;

revoke all on function public.office_elite_price(uuid) from public, anon, authenticated;
grant execute on function public.office_elite_price(uuid) to service_role;

create or replace function public.subscription_price(p_tier text, p_months int, p_agent uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base    jsonb := public.subscription_price(p_tier, p_months);
  v_off     jsonb;
  v_price   numeric;
  v_before  numeric;
  v_vat     numeric;
begin
  if v_base ? 'error' then return v_base; end if;
  v_base := v_base || jsonb_build_object('list_monthly', v_base->'monthly');
  if p_tier <> 'premium' or p_agent is null then return v_base; end if;

  v_off := public.office_elite_price(p_agent);
  v_base := v_base || jsonb_build_object('paying_elite', v_off->'paying_elite');
  v_price := (v_off->>'price')::numeric;
  -- אין מחיר משרד, או שהוא לא נמוך מהמחירון: המחירון
  if v_price is null or v_price >= (v_base->>'monthly')::numeric then return v_base; end if;

  v_vat    := (v_base->>'vat_rate')::numeric;
  v_before := v_price * p_months;
  return v_base || jsonb_build_object(
    'monthly', v_price,
    'amount_before_vat', v_before,
    'amount', round(v_before * (1 + v_vat), 2));
end;
$$;

revoke all on function public.subscription_price(text, int, uuid) from public, anon, authenticated;
grant execute on function public.subscription_price(text, int, uuid) to service_role;

-- הפונקציה הישנה (אחוזים) וההגדרות שלה: אף קורא אחר לא נשאר (הפונקציה החדשה למעלה כבר אינה קוראת לה)
drop function if exists public.office_elite_discount(uuid);

delete from public.pricing_config
 where key in ('office_discount_min_agents', 'office_discount_pct_small',
               'office_discount_big_min_agents', 'office_discount_pct_big');
