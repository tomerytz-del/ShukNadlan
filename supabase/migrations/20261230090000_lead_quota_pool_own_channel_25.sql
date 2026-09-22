-- ============================================================================
-- מכסת הפניות של Pay&GO: מכסה אחת לכל המקורות, ו-₪25 לפנייה מעבר לה
--
-- ## מה השתנה, ולמה
--
-- ההבטחה בדף המסלולים היא **10 פניות חינם בחודש, מכל המקורות יחד** — באנרים,
-- מחשבונים ולידי קונה/שוכר — ואחריהן ₪25 לפנייה שנכנסה בערוץ של הסוכן/ת
-- עצמו/ה: דף הנכס, דף המשרד או דף הסוכן/ת. עד היום האכיפה אמרה שני דברים
-- אחרים:
--
--   1. **המחיר היה ₪20** (‏pricing_config.ppl_price_buyer_renter).
--   2. **שני הכלים שבדף המשרד ובדף הסוכן/ת עקפו את המכסה לגמרי.** ליד
--      שנוצר שם נכנס `unlocked` לכל המסלולים (מיגרציה 20260911), כלומר
--      סוכן/ת Pay&GO קיבל/ה משם פניות ללא הגבלה וללא עלות. זו הייתה הבטחה
--      רחבה ממה שנמכר, והסוג השקט שלה: מי שמקבל יותר ממה ששילם עליו אינו
--      פותח קריאת תמיכה.
--
-- ## מה שנשאר בדיוק כפי שהיה
--
-- * **מסלולים בתשלום.** ל-`mid`/`premium` הפנייה נפתחת מיד, בלי מכסה ובלי
--   חיוב — ולכן הליד שלהם ממשיך להיכנס `unlocked` והפונקציה הזו כלל לא
--   נקראת עליו.
-- * **לידי בעל-נכס של הפלטפורמה.** הם עדיין ₪50, עדיין חסומים ל-Pay&GO,
--   ועדיין נשמרים בחלון הבלעדיות. השינוי כאן נוגע **רק** לליד שנוצר בערוץ
--   של הסוכן/ת עצמו/ה — כזה לא הוצע לאיש אחר, אין לו חלון בלעדיות ואין
--   טעם לחסום אותו: הוא הגיע לדף שלו/ה.
-- * **באנר מחפשי הנכס** (‏saved_searches) — משויך חינם ומחוץ למכסה, כפי
--   שהיה. אין לו מנגנון פתיחה לפי מכסה, וחיוב עליו היה שינוי אחר לגמרי.
--
-- ## הצורה של הכשל שנמנע כאן
--
-- **מחיר שמוצג ומחיר שנגבה שנפרדים זה מזה הם באג של אמון**, לא של קוד —
-- ולכן ₪25 מתעדכן באותו PR בכל חמשת המקומות שמציגים אותו: `assets/tiers.js`,
-- שתי שורות ב-`pricing.html`, ברירת המחדל ב-`assets/crm.js`
-- (`priceOf('ppl_price_buyer_renter', 25)` — היא נכנסת לתוקף בדיוק כשטעינת
-- המחירים נכשלת, כלומר ברגע שבו איש לא בודק), ו-`docs/pricing-and-tiers.md`.
--
-- ## למה `claim_lead` נכתבת כאן במלואה
--
-- היא נוצרה ב"מיגרציה 013", מסדרת מספור שקדמה לתיקייה הזו, ולכן חיה
-- בפרודקשן בלי קובץ מקומי (‏`LEGACY_GATES` ב-`scripts/check_tier_gates.py`).
-- הקובץ הזה הוא ההעתק המלא הראשון שלה בריפו, והיא יוצאת מהרשימה הזו.
--
-- אידמפוטנטית: `update`, `create or replace view` (עמודה חדשה **בסוף**
-- בלבד) ו-`create or replace function`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. המחיר
-- ---------------------------------------------------------------------------
-- שם המפתח היסטורי (`buyer_renter`) ומשמעותו היום רחבה יותר: הוא המחיר של
-- **כל** פנייה שנפתחת מעבר למכסה, מאיזה מקור שלא תהיה. החלפת השם הייתה
-- מיגרציה שנוגעת בקוד, בתצוגה ובדוחות, ואינה קונה דבר מלבד שם מדויק יותר.
update public.pricing_config set value = 25 where key = 'ppl_price_buyer_renter';

insert into public.pricing_config (key, value)
values ('ppl_price_buyer_renter', 25)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. ‏leads_masked נושא את המקור
--
-- ה-CRM מציג את המחיר לפני האישור, ומעכשיו המחיר תלוי גם במקור: ליד בעל-נכס
-- מהפלטפורמה הוא ₪50 וחסום ל-Pay&GO, ואותו lead_type מדף הסוכן/ת הוא פנייה
-- במכסה. בלי העמודה הזו בדיאלוג היה מוצג סכום אחד ונגבה אחר.
--
-- ‏security_invoker נשמר: ה-view הזה נשען על RLS של הקורא/ת, ובלעדיו כל
-- הסוכנים היו רואים את הלידים של כולם.
-- ---------------------------------------------------------------------------
create or replace view public.leads_masked
with (security_invoker = true) as
  select
    l.id,
    l.lead_type,
    l.deal_type,
    l.property_id,
    l.agency_id,
    l.agent_id,
    l.status,
    l.quota_source,
    case
      when l.status = 'unlocked' then l.raw_name
      when l.raw_name is null then null::text
      else (left(split_part(l.raw_name, ' ', 1), 1)
            || repeat('*', greatest(length(split_part(l.raw_name, ' ', 1)) - 1, 0)))
           || case
                when position(' ' in l.raw_name) > 0
                  then (' ' || left(split_part(l.raw_name, ' ', 2), 1))
                       || repeat('*', greatest(length(split_part(l.raw_name, ' ', 2)) - 1, 0))
                else ''
              end
    end as display_name,
    case
      when l.status = 'unlocked' then l.raw_phone
      when l.raw_phone is null then null::text
      else ((left(regexp_replace(l.raw_phone, '[^0-9]', '', 'g'), 2) || '-')
            || repeat('*', greatest(length(regexp_replace(l.raw_phone, '[^0-9]', '', 'g')) - 3, 0)))
           || right(regexp_replace(l.raw_phone, '[^0-9]', '', 'g'), 1)
    end as display_phone,
    l.city,
    l.neighborhood_id,
    l.property_type,
    l.unlocked_at,
    l.unlocked_by,
    l.created_at,
    l.property_details,
    case when l.status = 'unlocked' then l.raw_message else null::text end as display_message,
    -- העמודה החדשה, בסוף בלבד: `create or replace view` מסרב לכל מיקום אחר.
    l.source
  from public.leads l;

-- ---------------------------------------------------------------------------
-- 3. ‏claim_lead
-- ---------------------------------------------------------------------------
create or replace function public.claim_lead(p_lead_id uuid, p_agent_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_lead leads%rowtype;
  v_agent agency_members%rowtype;
  v_exclusivity_hours numeric;
  v_price_owner_mid numeric;
  -- המחיר של פנייה בערוץ של הסוכן/ת. שם המפתח במסד היסטורי.
  v_price_own_channel numeric;
  v_quota_limit numeric;
  v_price numeric := 0;
  v_quota_source text;
  v_within_exclusivity boolean;
  v_own_channel boolean;
  v_rows int;
begin
  select * into v_lead from leads where id = p_lead_id for update;
  if not found then
    return jsonb_build_object('error','lead_not_found');
  end if;
  if v_lead.status = 'unlocked' then
    return jsonb_build_object('error','already_unlocked');
  end if;
  if v_lead.status = 'pending_charge' then
    return jsonb_build_object('error','claim_in_progress');
  end if;

  select * into v_agent from agency_members where id = p_agent_id and active = true;
  if not found then
    return jsonb_build_object('error','agent_not_found');
  end if;

  select value into v_exclusivity_hours from pricing_config where key='owner_lead_exclusivity_hours';
  select value into v_price_owner_mid   from pricing_config where key='ppl_price_owner_mid';
  select value into v_price_own_channel from pricing_config where key='ppl_price_buyer_renter';
  select value into v_quota_limit       from pricing_config where key='free_lead_quota_monthly';

  -- הערוץ של הסוכן/ת עצמו/ה: הערכת שווי או מחשבון תשואה שנמסרו **בדף שלו/ה**
  -- או בדף המשרד. ליד כזה לא הוצע לאיש אחר, אין לו חלון בלעדיות, והוא מגיע
  -- למכסה המשותפת במקום למסלול הפלטפורמה — גם כשה-lead_type הוא owner_inbound.
  -- פנייה מדף הנכס (property_inquiry / visualization) ומדף הסוכן/ת
  -- (agent_direct_inquiry) נופלות ממילא לענף הזה לפי סוג הליד.
  v_own_channel := (v_lead.source in ('agency_page','agent_page')
                    and v_lead.agent_id is not distinct from p_agent_id);

  -- זכאות (מודול 2 §4.3: חלון בלעדיות 12h ואז בריכה רחבה; מודול 1: property_inquiry תמיד שייך לסוכן המקורי)
  if v_lead.lead_type = 'owner_inbound' and not v_own_channel then
    if v_agent.tier = 'free' then
      return jsonb_build_object('error','free_tier_not_eligible_owner_lead');
    end if;
    v_within_exclusivity := (now() < v_lead.created_at + make_interval(hours => v_exclusivity_hours::int));
    if v_within_exclusivity and v_lead.agent_id is distinct from p_agent_id then
      return jsonb_build_object('error','exclusive_to_another_agent',
        'exclusivity_ends_at', v_lead.created_at + make_interval(hours => v_exclusivity_hours::int));
    end if;
  else
    if v_lead.agent_id is distinct from p_agent_id then
      return jsonb_build_object('error','not_your_lead');
    end if;
  end if;

  -- תפיסה אטומית: masked -> pending_charge (אותה טכניקה שכבר תוכננה: rowCount=0 = מישהו כבר תפס)
  update leads set status = 'pending_charge' where id = p_lead_id and status = 'masked';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return jsonb_build_object('error','lead_already_claimed_by_someone_else');
  end if;

  -- תמחור לפי סוג-ליד + tier
  if v_lead.lead_type = 'owner_inbound' and not v_own_channel then
    if v_agent.tier = 'premium' then
      v_price := 0; v_quota_source := 'premium_free';
    else
      v_price := v_price_owner_mid; v_quota_source := 'paid_50';
    end if;
  else
    if v_agent.tier in ('mid','premium') then
      v_price := 0; v_quota_source := 'subscription_unlimited';
    else
      -- מונה אחד לכל המקורות. זו כל המשמעות של "10 פניות בחודש": לא עשר
      -- מדף הנכס ועוד עשר מדף הסוכן/ת, אלא עשר יחד.
      update agency_members
      set free_quota_used = case when free_quota_cycle_start < date_trunc('month', now())::date then 1 else free_quota_used + 1 end,
          free_quota_cycle_start = date_trunc('month', now())::date
      where id = p_agent_id
        and (free_quota_cycle_start < date_trunc('month', now())::date or free_quota_used < v_quota_limit);
      get diagnostics v_rows = row_count;
      if v_rows = 1 then
        v_price := 0; v_quota_source := 'free_quota';
      else
        -- ‏'paid_10' הוא שם היסטורי של "שולם לפי פנייה" ולא סכום. הוא נשאר
        -- כפי שהוא: leads_quota_source_check מכיר חמישה ערכים, ושינוי שלהם
        -- היה מחייב backfill של כל הלידים שכבר נפתחו בעבר.
        v_price := v_price_own_channel; v_quota_source := 'paid_10';
      end if;
    end if;
  end if;

  if v_price > 0 then
    update agency_members set credit_balance = credit_balance - v_price
    where id = p_agent_id and credit_balance >= v_price;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      update leads set status = 'masked' where id = p_lead_id; -- rollback הנעילה
      return jsonb_build_object('error','insufficient_balance', 'required', v_price);
    end if;
    insert into lead_charges (lead_id, agency_id, agent_id, amount, status, payment_method)
    values (p_lead_id, v_lead.agency_id, p_agent_id, v_price, 'success', 'balance');
  end if;

  update leads
  set status = 'unlocked', quota_source = v_quota_source, unlocked_at = now(), unlocked_by = p_agent_id,
      agent_id = coalesce(agent_id, p_agent_id)
  where id = p_lead_id;

  return jsonb_build_object(
    'success', true,
    'price_charged', v_price,
    'quota_source', v_quota_source,
    'raw_name', v_lead.raw_name,
    'raw_phone', v_lead.raw_phone,
    'raw_message', v_lead.raw_message
  );
end;
$function$;

comment on function public.claim_lead(uuid, uuid) is
  'פתיחת ליד: זכאות, מכסה חודשית אחת לכל המקורות, חיוב מהארנק ויומן חיובים - טרנזקציה אחת. ליד בעל-נכס של הפלטפורמה נשאר ₪50 ומגודר ל-mid/premium; ליד שנוצר בדף המשרד או בדף הסוכן/ת נספר במכסה, ומעבר לה במחיר ppl_price_buyer_renter.';

-- ההרשאות: הפונקציה מזיזה כסף ומקבלת מזהה סוכן/ת מפורש, ולכן היא נשארת
-- ל-service_role בלבד — כלומר דרך `lead-claim`, שגוזרת את הסוכן/ת מה-JWT.
-- ‏`from public` לבדו אינו מוציא את anon ואת authenticated: הרשאת ברירת
-- המחדל שלהם ב-Supabase ישירה ולא דרך PUBLIC.
revoke all on function public.claim_lead(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_lead(uuid, uuid) to service_role;
