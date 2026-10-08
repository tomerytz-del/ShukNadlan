-- ============================================================================
-- הארנק נטען לפני מע"מ: ₪100 בארנק נגבים ₪118
--
-- **ההחלטה (6.10.2026):** כל מחיר שמוצג באתר הוא לפני מע"מ. דף המסלולים
-- והתקנון (§ "המחירים ... אינם כוללים מע"מ, שיתווסף כדין") כבר אמרו את זה,
-- אבל הארנק עבד הפוך: טעינה של ₪100 גבתה ₪100 (מורנינג מפרקת מתוכם את
-- המע"מ) וזיכתה ₪100, וכל רכישה ירדה במחיר הנקוב. כלומר מספר וירטואלי
-- "₪89 + מע"מ" נגבה בפועל ₪89 כולל מע"מ - ‏₪75.4 לפניו.
--
-- **למה בטעינה ולא בכל רכישה:** שתים-עשרה פונקציות מורידות מהארנק
-- (‏claim_lead, ‏order_phone_line, ‏promote_property, ‏charge_call_minutes...).
-- הוספת מע"מ בכל אחת מהן היא שתים-עשרה נקודות לשכוח, ושתי שיטות במקביל
-- ברגע שאחת נשכחת. כאן יש נקודה אחת: היתרה בארנק היא קרדיט **לפני מע"מ**,
-- בדיוק כמו המחירים שיורדים ממנה, והמע"מ נגבה פעם אחת - בכסף שנכנס.
-- כך החשבונית של מורנינג (‏100 + 18 מע"מ = 118) מתארת בדיוק את מה שקרה.
--
-- ‏`amount` נשאר **הקרדיט** - מה שנזקף לארנק, ומה שכל ההחזרים והדוחות
-- כבר סופרים בו. העמודה החדשה ‏`charged_amount` היא מה שנגבה בכרטיס, והיא
-- מה שמושווה מול מורנינג. שורה ישנה (‏null) נגבתה ונזקפה באותו סכום, ולכן
-- ‏`coalesce(charged_amount, amount)` נכון לשתיהן.
--
-- ‏**יתרות קיימות לא הומרו.** בזמן ההחלטה הייתה טעינה אמיתית אחת (‏₪100)
-- ויתרה חיובית אחת (‏₪61). להקטין אותה ל-‏₪51.7 היה לקחת מסוכן/ת את מה
-- שכבר שילם/ה עליו; הפער של ₪9 נבלע אצלנו.
-- ============================================================================

alter table public.wallet_topups
  add column if not exists charged_amount numeric;
comment on column public.wallet_topups.charged_amount is
  'מה שנגבה בכרטיס, כולל מע"מ. amount הוא הקרדיט שנזקף לארנק (לפני מע"מ). null בשורות שלפני 20270304 - אז שניהם היו אותו סכום.';

alter table public.developer_topups
  add column if not exists charged_amount numeric;
comment on column public.developer_topups.charged_amount is
  'מה שנגבה בכרטיס, כולל מע"מ. amount הוא הקרדיט שנזקף לארנק היזם/ית (לפני מע"מ).';

alter table public.wallet_refunds
  add column if not exists money_amount numeric;
comment on column public.wallet_refunds.money_amount is
  'הכסף שמוחזר בפועל במורנינג: הקרדיט בתוספת המע"מ שנגבה עליו, לפי הטעינות שבהקצאה. amount הוא הקרדיט שירד מהיתרה.';

-- ---------------------------------------------------------------------------
-- 1. הסכום ברוטו - מקור אחד, משיעור המע"מ שב-pricing_config
-- ---------------------------------------------------------------------------
create or replace function public.vat_gross(p_amount numeric)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  -- עיגול לאגורות: אותו עיגול של subscription_price, ואותה סיבה - הפרש של
  -- אגורה בין מה שנשלח לסולק לבין מה שנשמר מפיל את השוואת הסכום.
  select round(p_amount * (1 + coalesce(
    (select value from public.pricing_config where key = 'vat_rate'), 0.18)), 2);
$$;

comment on function public.vat_gross(numeric) is
  'סכום לפני מע"מ -> הסכום לגבייה, לפי pricing_config.vat_rate. משמש את טעינת הארנק (סוכנים ויזמים).';

-- ---------------------------------------------------------------------------
-- 2. ארנק הסוכנים
-- ---------------------------------------------------------------------------
create or replace function public.start_wallet_topup(p_agent_id uuid, p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_topup_id uuid;
  v_open     int;
  v_charged  numeric;
begin
  if p_amount not in (100,200,300,400,500) then
    return jsonb_build_object('error', 'invalid_amount');
  end if;

  if not exists (select 1 from public.agency_members
                 where id = p_agent_id and active) then
    return jsonb_build_object('error', 'agent_inactive');
  end if;

  -- תקרה על ניסיונות פתוחים (‏20261007090000).
  select count(*) into v_open
    from public.wallet_topups
   where agent_id = p_agent_id
     and status = 'pending'
     and created_at > now() - interval '30 minutes';
  if v_open >= 5 then
    return jsonb_build_object('error', 'too_many_open_topups');
  end if;

  v_charged := public.vat_gross(p_amount);

  insert into public.wallet_topups (agent_id, amount, charged_amount, status, test_mode, provider)
  values (p_agent_id, p_amount, v_charged, 'pending', false, 'morning')
  returning id into v_topup_id;

  return jsonb_build_object('success', true, 'topup_id', v_topup_id,
                            'amount', p_amount, 'charged_amount', v_charged);
end;
$$;

comment on function public.start_wallet_topup(uuid, numeric) is
  'פאזה 1 של טעינת ארנק: פותחת שורת pending. amount הוא הקרדיט (לפני מע"מ), charged_amount מה שנשלח לסליקה. אינה נוגעת ביתרה. ל-service_role בלבד.';

create or replace function public.complete_wallet_topup(
  p_topup_id           uuid,
  p_verified_amount    numeric,
  p_provider_charge_id text default null,
  p_document_id        text default null,
  p_pdf_url            text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_topup   public.wallet_topups;
  v_charged numeric;
begin
  select * into v_topup
    from public.wallet_topups
   where id = p_topup_id
   for update;

  if not found then
    return jsonb_build_object('error', 'topup_not_found');
  end if;

  -- ה-webhook הגיע שוב - הצלחה, כדי שהספק יפסיק לנסות.
  if v_topup.status = 'success' then
    return jsonb_build_object('success', true, 'already_completed', true,
                              'amount', v_topup.amount);
  end if;

  if v_topup.status <> 'pending' then
    return jsonb_build_object('error', 'topup_not_pending', 'status', v_topup.status);
  end if;

  -- **מול מה שנגבה, לא מול מה שנזקף.** מורנינג מדווחת את הסכום ששולם,
  -- כולל מע"מ.
  --
  -- ‏**וגם הקרדיט עצמו מתקבל**, בכוונה: המיגרציה וה-Edge Functions נפרסות
  -- בשני workflows נפרדים. אם המסד מתעדכן לפני wallet-topup, הגרסה הישנה
  -- שולחת לסליקה ₪100 על שורה שמצפה ל-₪118 - והתשלום האמיתי היה נסגר
  -- כ-amount_mismatch אחרי שהכרטיס חויב. בחלון הזה הסוכן/ת משלם/ת ומקבל/ת
  -- בדיוק מה שקיבל/ה עד היום. אין כאן פתח: את הסכום שנשלח לסליקה קובע
  -- רק הקוד שלנו.
  v_charged := coalesce(v_topup.charged_amount, v_topup.amount);
  if p_verified_amount is not null and p_verified_amount not in (v_charged, v_topup.amount) then
    update public.wallet_topups
       set status = 'failed',
           failure_reason = format('amount_mismatch: expected %s, provider reported %s',
                                   v_charged, p_verified_amount)
     where id = p_topup_id;
    return jsonb_build_object('error', 'amount_mismatch',
                              'expected', v_charged, 'reported', p_verified_amount);
  end if;

  update public.wallet_topups
     set status             = 'success',
         provider_charge_id = coalesce(p_provider_charge_id, provider_charge_id),
         completed_at       = now(),
         failure_reason     = null
   where id = p_topup_id;

  -- הקרדיט, לפני מע"מ.
  update public.agency_members
     set credit_balance = credit_balance + v_topup.amount
   where id = v_topup.agent_id;

  insert into public.invoices (agent_id, related_charge_id, related_charge_type,
                               provider, provider_document_id, pdf_url, issued_at)
  values (v_topup.agent_id, p_topup_id, 'wallet_topup',
          coalesce(v_topup.provider, 'morning'), p_document_id, p_pdf_url, now());

  return jsonb_build_object('success', true, 'amount', v_topup.amount,
                            'charged_amount', v_charged, 'agent_id', v_topup.agent_id);
end;
$$;

comment on function public.complete_wallet_topup(uuid, numeric, text, text, text) is
  'פאזה 2 של טעינת ארנק: מאמתת את הסכום שנגבה (charged_amount) ומזכה את הקרדיט (amount, לפני מע"מ). אידמפוטנטית. ל-service_role בלבד.';

-- ---------------------------------------------------------------------------
-- 3. ארנק היזמים - אותו כלל
-- ---------------------------------------------------------------------------
create or replace function public.start_developer_topup(p_developer_id uuid, p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id      uuid;
  v_open    int;
  v_charged numeric;
begin
  if not exists (select 1 from public.developers where id = p_developer_id and status = 'active') then
    return jsonb_build_object('error', 'developer_inactive');
  end if;
  -- אותם סכומים שהמסך מציע; הבדיקה המדויקת היא ב-Edge Function, וכאן גבול.
  if p_amount is null or p_amount < 100 or p_amount > 5000 then
    return jsonb_build_object('error', 'invalid_amount');
  end if;

  select count(*) into v_open from public.developer_topups
   where developer_id = p_developer_id and status = 'pending'
     and created_at > now() - interval '30 minutes';
  if v_open >= 3 then
    return jsonb_build_object('error', 'too_many_open_topups');
  end if;

  v_charged := public.vat_gross(p_amount);

  insert into public.developer_topups (developer_id, amount, charged_amount, status, test_mode, provider)
  values (p_developer_id, p_amount, v_charged, 'pending', false, 'morning')
  returning id into v_id;

  return jsonb_build_object('success', true, 'topup_id', v_id,
                            'amount', p_amount, 'charged_amount', v_charged);
end;
$$;

create or replace function public.complete_developer_topup(
  p_topup_id           uuid,
  p_verified_amount    numeric,
  p_provider_charge_id text default null,
  p_document_id        text default null,
  p_pdf_url            text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row     public.developer_topups;
  v_balance numeric;
  v_charged numeric;
begin
  select * into v_row from public.developer_topups where id = p_topup_id for update;
  if not found then
    return jsonb_build_object('error', 'topup_not_found');
  end if;
  if v_row.status = 'paid' then
    return jsonb_build_object('success', true, 'already_completed', true);
  end if;
  if v_row.status <> 'pending' then
    return jsonb_build_object('error', 'topup_not_pending', 'status', v_row.status);
  end if;

  -- הקרדיט עצמו מתקבל מאותה סיבה כמו ב-complete_wallet_topup: חלון הפריסה.
  v_charged := coalesce(v_row.charged_amount, v_row.amount);
  if p_verified_amount is not null and p_verified_amount not in (v_charged, v_row.amount) then
    update public.developer_topups
       set status = 'failed',
           failure_reason = format('amount_mismatch: expected %s, provider reported %s',
                                   v_charged, p_verified_amount)
     where id = p_topup_id;
    return jsonb_build_object('error', 'amount_mismatch',
                              'expected', v_charged, 'reported', p_verified_amount);
  end if;

  update public.developer_topups
     set status               = 'paid',
         completed_at         = now(),
         provider_charge_id   = coalesce(p_provider_charge_id, provider_charge_id),
         provider_document_id = coalesce(p_document_id, provider_document_id),
         provider_pdf_url     = coalesce(p_pdf_url, provider_pdf_url),
         failure_reason       = null
   where id = p_topup_id;

  update public.developers
     set credit_balance = credit_balance + v_row.amount
   where id = v_row.developer_id
  returning credit_balance into v_balance;

  return jsonb_build_object('success', true, 'developer_id', v_row.developer_id,
                            'amount', v_row.amount, 'charged_amount', v_charged,
                            'credit_balance', v_balance);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. החזר: הכסף שחוזר הוא הקרדיט בתוספת המע"מ שנגבה עליו
--
-- ‏request_wallet_refund עובדת בקרדיט ואינה משתנה: היא מורידה מהיתרה
-- ומקצה מול טעינות. מה שחסר למי שמבצע/ת את ההחזר במורנינג הוא **כמה כסף
-- להחזיר**, וזה תלוי בטעינה: ‏₪100 קרדיט מטעינה חדשה הם ₪118, ומטעינה
-- ישנה (‏charged_amount null) ‏₪100. טריגר ולא שכתוב של הפונקציה: הוא
-- מחשב מתוך ההקצאה שהפונקציה כבר כותבת, ואינו נוגע בנתיב הכסף.
-- ---------------------------------------------------------------------------
create or replace function public.wallet_refunds_money_amount()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select coalesce(sum(round((a->>'amount')::numeric
                            * coalesce(t.charged_amount, t.amount) / t.amount, 2)), new.amount)
    into new.money_amount
    from jsonb_array_elements(coalesce(new.allocation, '[]'::jsonb)) a
    join public.wallet_topups t on t.id = (a->>'topup_id')::uuid;
  return new;
end;
$$;

drop trigger if exists wallet_refunds_money_amount on public.wallet_refunds;
create trigger wallet_refunds_money_amount
  before insert on public.wallet_refunds
  for each row execute function public.wallet_refunds_money_amount();

-- בקשות שכבר קיימות: כולן מטעינות ישנות, ולכן הכסף שווה לקרדיט.
update public.wallet_refunds set money_amount = amount where money_amount is null;

-- ---------------------------------------------------------------------------
-- הרשאות
-- ---------------------------------------------------------------------------
revoke all on function public.vat_gross(numeric) from public, anon, authenticated;
grant execute on function public.vat_gross(numeric) to service_role;

revoke all on function public.start_wallet_topup(uuid, numeric) from public, anon, authenticated;
grant execute on function public.start_wallet_topup(uuid, numeric) to service_role;

revoke all on function public.complete_wallet_topup(uuid, numeric, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_wallet_topup(uuid, numeric, text, text, text) to service_role;

revoke all on function public.start_developer_topup(uuid, numeric) from public, anon, authenticated;
grant execute on function public.start_developer_topup(uuid, numeric) to service_role;

revoke all on function public.complete_developer_topup(uuid, numeric, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_developer_topup(uuid, numeric, text, text, text) to service_role;

revoke all on function public.wallet_refunds_money_amount() from public, anon, authenticated;
