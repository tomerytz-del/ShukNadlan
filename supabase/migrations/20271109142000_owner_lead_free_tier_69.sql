-- ---------------------------------------------------------------------------
-- ליד בעל-נכס של הפלטפורמה: ₪69 ל-Pay&GO, ₪50 ל-PROFESSIONAL ול-Elite
-- (docs/pricing-and-tiers.md, "מכסת הפניות של Pay&GO")
--
-- ## מה השתנה, ולמה
--
-- עד היום ליד בעלים של הפלטפורמה היה חסום לגמרי ל-free (free_tier_not_eligible_owner_lead),
-- ₪50 ל-mid, וחינם ל-premium ('premium_free'). הנתון שמאחורי השינוי (9.11.2026):
-- ב-6 החודשים האחרונים נכנסו 9 לידי בעלים בסך הכול ל-53 סוכני Elite, כלומר
-- "כל לידי הבעלים כלולים" מכר הבטחה שאין מאחוריה דבר - ובמקביל 80% מהסוכנים
-- שלעולם לא יעשו מנוי לא יכלו לשלם על הדבר היחיד שרק לנו יש. מעכשיו:
--
--   Pay&GO          - ₪69 לליד (pricing_config.ppl_price_owner_free), quota_source 'paid_69'
--   PROFESSIONAL    - ₪50 לליד (ppl_price_owner_mid), 'paid_50' - כמו קודם
--   Elite           - ₪50 לליד, 'paid_50' - **כבר לא חינם**
--
-- ## מה לא השתנה, ובכוונה
--
-- * **חלון הבלעדיות** (owner_lead_exclusivity_hours, 12): מי שהליד נותב אליו/ה
--   פותח/ת אותו/ה ראשון/ה. הניתוב עצמו (owner-lead-intake) מעדיף סוכנים
--   בתשלום, ו-free נכנס/ת רק כשאין סוכן/ת בתשלום שמתאים/ה לסוג הנכס ולעסקה -
--   זו המשמעות המעשית של "המנויים רואים קודם": אין כאן מאגר משותף, כל ליד
--   מנותב לסוכן/ת אחד/ת. ליד שנותב ל-free ולא נפתח אינו מנותב מחדש לאחרים
--   (זה גם מה שקורה היום לליד של mid שלא נפתח).
-- * 'premium_free' נשאר ברשימה המותרת: לידים שכבר נפתחו כך לא משוכתבים.
-- * הערוץ של הסוכן/ת עצמו/ה (agency_page / agent_page), המכסה החודשית ו-₪25
--   לפנייה - בדיוק כפי שהיו.
--
-- הגוף הועתק מ-20261230090000 (md5 של prosrc בפרודקשן 29ff9437... זהה לקובץ,
-- נבדק 9.11.2026) ושונו רק שני הענפים של owner_inbound. אידמפוטנטית.
-- ---------------------------------------------------------------------------

-- 1. 'paid_69' נכנס לרשימה הסגורה - מוסיפים למה שקיים, לא כותבים מחדש (כלל 8)
do $$
declare
  v_def  text;
  v_vals text[];
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint where conname = 'leads_quota_source_check' and conrelid = 'public.leads'::regclass;
  select coalesce(array_agg(m[1]), '{}') into v_vals
    from regexp_matches(coalesce(v_def, ''), '''([a-z_0-9]+)''', 'g') as m;
  v_vals := array(select distinct unnest(v_vals || array['free_quota', 'paid_10', 'paid_50', 'paid_69', 'premium_free',
                                                         'subscription_unlimited', 'launch_free']) order by 1);
  alter table public.leads drop constraint if exists leads_quota_source_check;
  execute format('alter table public.leads add constraint leads_quota_source_check check (quota_source = any (%L::text[]))', v_vals);
end $$;

-- 2. claim_lead
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
  v_price_owner_free numeric;
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
  select value into v_price_owner_free  from pricing_config where key='ppl_price_owner_free';
  select value into v_price_own_channel from pricing_config where key='ppl_price_buyer_renter';
  select value into v_quota_limit       from pricing_config where key='free_lead_quota_monthly';
  v_exclusivity_hours := coalesce(v_exclusivity_hours, 12);
  v_price_owner_mid   := coalesce(v_price_owner_mid, 50);
  v_price_owner_free  := coalesce(v_price_owner_free, 69);

  -- הערוץ של הסוכן/ת עצמו/ה: הערכת שווי או מחשבון תשואה שנמסרו **בדף שלו/ה**
  -- או בדף המשרד. ליד כזה לא הוצע לאיש אחר, אין לו חלון בלעדיות, והוא מגיע
  -- למכסה המשותפת במקום למסלול הפלטפורמה — גם כשה-lead_type הוא owner_inbound.
  -- פנייה מדף הנכס (property_inquiry / visualization) ומדף הסוכן/ת
  -- (agent_direct_inquiry) נופלות ממילא לענף הזה לפי סוג הליד.
  v_own_channel := (v_lead.source in ('agency_page','agent_page')
                    and v_lead.agent_id is not distinct from p_agent_id);

  -- זכאות: ליד בעלים של הפלטפורמה פתוח לכל המסלולים (9.11.2026), עם חלון
  -- הבלעדיות למי שהליד נותב אליו/ה; property_inquiry תמיד שייך לסוכן/ת המקורי/ת.
  if v_lead.lead_type = 'owner_inbound' and not v_own_channel then
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

  -- תפיסה אטומית: masked -> pending_charge (rowCount=0 = מישהו כבר תפס)
  update leads set status = 'pending_charge' where id = p_lead_id and status = 'masked';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return jsonb_build_object('error','lead_already_claimed_by_someone_else');
  end if;

  -- תמחור לפי סוג-ליד + tier
  if v_lead.lead_type = 'owner_inbound' and not v_own_channel then
    -- ליד בעלים של הפלטפורמה: מחיר ליחידה בכל מסלול. Pay&GO משלם/ת יותר -
    -- זה גם ההכנסה מהמסלול החינמי וגם הסיבה לשדרג.
    if v_agent.tier = 'free' then
      v_price := v_price_owner_free; v_quota_source := 'paid_69';
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
        -- כפי שהוא: שינוי שלו היה מחייב backfill של כל הלידים שכבר נפתחו בעבר.
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
  'פתיחת ליד: זכאות, מכסה חודשית אחת לכל המקורות, חיוב מהארנק ויומן חיובים - טרנזקציה אחת. ליד בעל-נכס של הפלטפורמה: ₪69 ל-Pay&GO (ppl_price_owner_free), ₪50 ל-PROFESSIONAL ול-Elite (ppl_price_owner_mid), עם חלון הבלעדיות למי שנותב אליו/ה; ליד שנוצר בדף המשרד או בדף הסוכן/ת נספר במכסה, ומעבר לה במחיר ppl_price_buyer_renter.';

-- ההרשאות: הפונקציה מזיזה כסף ומקבלת מזהה סוכן/ת מפורש, ולכן היא נשארת
-- ל-service_role בלבד — כלומר דרך `lead-claim`, שגוזרת את הסוכן/ת מה-JWT.
revoke all on function public.claim_lead(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_lead(uuid, uuid) to service_role;
