-- ============================================================================
-- החזר יתרה שלא מומשה
--
-- המדיניות: סוכן/ת רשאי/ת לבקש בכל עת החזר על כסף שנטען ולא מומש. המימוש
-- הוא **בקשה + אישור ידני**: המערכת פותחת בקשה ונועלת את הסכום, ומנהל/ת
-- פלטפורמה מבצע/ת את ההחזר בממשק מורנינג ומסמן/ת שבוצע. אין כאן קריאת API
-- שמוציאה כסף מהחשבון בלי שאדם אישר.
--
-- **שלוש החלטות שקובעות את כל השאר:**
--
-- ‏1. הסכום יורד מהיתרה **ברגע הבקשה**, לא באישור.
--    השיטה החלופית — עמודת "מוחזק" שכל רכישה צריכה להתחשב בה — הייתה מחייבת
--    לגעת בכל אחת מפונקציות הרכישה (‏promote_property, ‏purchase_rss_lead,
--    המשכנתאות, החיפוש השמור, הסרטון). זה בלתי מתקבל על הדעת: חמישה נתיבי
--    כסף עובדים שנפתחים מחדש בשביל תכונה שישית. כאן היתרה פשוט יורדת, כמו
--    בכל משיכה, ואם הבקשה נדחית או מבוטלת היא חוזרת. **אף פונקציית רכישה
--    קיימת לא נגעה.**
--
-- ‏2. **כסף ממצב בדיקה אינו בר-החזר.**
--    ‏‎test_mode=true‎ פירושו שאיש לא שילם — הזיכוי נוצר יש מאין להדגמה.
--    החזר כנגדו היה מוציא כסף אמיתי מהחשבון כנגד כסף שמעולם לא נכנס. לכן
--    התקרה אינה היתרה, אלא ‎least(היתרה, סך הטעינות האמיתיות שטרם הוחזרו)‎.
--    בפרודקשן היום **כל** היתרות הן ממצב בדיקה, ולכן התקרה תהיה 0 עד
--    שתהיה טעינה אמיתית ראשונה. זו התנהגות נכונה, לא תקלה.
--
-- ‏3. היתרה פונגבילית, ולכן ההחזר מוקצה FIFO על הטעינות.
--    מי שטען/ה ₪500 בשלוש פעימות והוציא/ה ₪200 מבקש/ת ₪300 שאינם מתאימים
--    לאף חיוב בודד. ‏‎refunded_amount‎ על כל טעינה עוקב/ת אחרי מה שכבר הוחזר
--    כנגדה, וההקצאה נשמרת על שורת הבקשה — כדי שמי שמבצע/ת את ההחזר בפועל
--    ידע/תדע מול אילו עסקאות לזכות ואילו מסמכים מקוריים לציין.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. מעקב אחרי מה שכבר הוחזר מכל טעינה
-- ---------------------------------------------------------------------------
alter table public.wallet_topups
  add column if not exists refunded_amount numeric not null default 0;

comment on column public.wallet_topups.refunded_amount is
  'כמה מהטעינה הזו כבר הוקצה להחזר. נתפס בבקשה ומשוחרר בדחייה/ביטול.';

-- ---------------------------------------------------------------------------
-- 2. טבלת הבקשות
-- ---------------------------------------------------------------------------
create table if not exists public.wallet_refunds (
  id                      uuid primary key default gen_random_uuid(),
  agent_id                uuid not null references public.agency_members(id),
  amount                  numeric not null check (amount > 0),
  status                  text not null default 'requested'
                            check (status in ('requested','completed','rejected','cancelled')),
  -- מול אילו טעינות מקוריות ההחזר מוקצה. מערך של {topup_id, amount}.
  allocation              jsonb not null default '[]'::jsonb,
  agent_note              text,
  requested_at            timestamptz not null default now(),
  resolved_at             timestamptz,
  resolved_by             uuid references public.agency_members(id),
  resolution_note         text,
  provider_credit_note_id text
);

comment on table public.wallet_refunds is
  'בקשות החזר על יתרה שלא מומשה. הסכום יורד מהיתרה בבקשה וחוזר בדחייה/ביטול.';

-- בקשה פתוחה אחת לסוכן/ת. שתי בקשות במקביל הן דרך בטוחה לבלבל גם את
-- הסוכן/ת וגם את מי שמאשר/ת, בלי שום תועלת.
create unique index if not exists wallet_refunds_one_open_per_agent
  on public.wallet_refunds (agent_id) where status = 'requested';

create index if not exists wallet_refunds_open_idx
  on public.wallet_refunds (status, requested_at) where status = 'requested';

alter table public.wallet_refunds enable row level security;

-- קריאה בלבד, ולסוכן/ת רק את שלה/ו. כל כתיבה עוברת ב-service_role דרך
-- ה-Edge Function, בדיוק כמו wallet_topups.
drop policy if exists "agent read own refunds" on public.wallet_refunds;
create policy "agent read own refunds" on public.wallet_refunds
  for select using (
    agent_id = public.current_agent_id() or public.current_is_platform_admin()
  );

-- ---------------------------------------------------------------------------
-- 3. כמה בכלל ניתן להחזיר
--
-- שתי תקרות, והנמוכה מנצחת: היתרה בפועל, וסך הטעינות **האמיתיות** שטרם
-- הוחזרו. ראו החלטה 2 בראש הקובץ.
-- ---------------------------------------------------------------------------
create or replace function public.wallet_refundable_amount(p_agent_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(0, least(
    coalesce((select credit_balance from public.agency_members where id = p_agent_id), 0),
    coalesce((select sum(amount - refunded_amount)
                from public.wallet_topups
               where agent_id = p_agent_id
                 and status = 'success'
                 and test_mode = false), 0)
  ));
$$;

comment on function public.wallet_refundable_amount(uuid) is
  'התקרה להחזר: הנמוך מבין היתרה לבין סך הטעינות האמיתיות שטרם הוחזרו. כסף ממצב בדיקה אינו בר-החזר. פנימית — ל-service_role בלבד.';

-- הגרסה שהדפדפן קורא לה. **בלי פרמטר, וזו כל הנקודה:** הגרסה שמקבלת
-- ‏p_agent_id היא security definer, ולכן פתיחתה ל-authenticated הייתה
-- מאפשרת לכל סוכן/ת לשאול על היתרה של כל סוכן/ת אחר/ת. כאן הזהות נלקחת
-- מ-current_agent_id() ואי אפשר להצביע על מישהו אחר.
create or replace function public.my_wallet_refundable_amount()
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select public.wallet_refundable_amount(public.current_agent_id());
$$;

comment on function public.my_wallet_refundable_amount() is
  'התקרה להחזר של הסוכן/ת המחובר/ת. הזהות מהסשן ולא מפרמטר.';

-- ---------------------------------------------------------------------------
-- 4. פתיחת בקשה
--
-- שלוש פעולות באותה טרנזקציה: הורדת היתרה, תפיסת ההקצאה FIFO, ופתיחת
-- השורה. או שכולן קורות או שאף אחת.
-- ---------------------------------------------------------------------------
create or replace function public.request_wallet_refund(
  p_agent_id uuid,
  p_amount   numeric,
  p_note     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max       numeric;
  v_remaining numeric;
  v_take      numeric;
  v_alloc     jsonb := '[]'::jsonb;
  v_row       record;
  v_refund_id uuid;
  v_rows      int;
begin
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('error', 'invalid_amount');
  end if;

  if not exists (select 1 from public.agency_members where id = p_agent_id and active) then
    return jsonb_build_object('error', 'agent_inactive');
  end if;

  if exists (select 1 from public.wallet_refunds
             where agent_id = p_agent_id and status = 'requested') then
    return jsonb_build_object('error', 'refund_already_open');
  end if;

  v_max := public.wallet_refundable_amount(p_agent_id);
  if p_amount > v_max then
    return jsonb_build_object('error', 'amount_exceeds_refundable',
                              'refundable', v_max, 'requested', p_amount);
  end if;

  -- הורדת היתרה, מותנית בכיסוי. ‏row_count=0 פירושו שמישהו הספיק/ה לרכוש
  -- בין החישוב לבין העדכון — מרוץ אמיתי, ולכן הבדיקה היא ב-update עצמו
  -- ולא לפניו.
  update public.agency_members
     set credit_balance = credit_balance - p_amount
   where id = p_agent_id and credit_balance >= p_amount;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return jsonb_build_object('error', 'insufficient_balance');
  end if;

  -- הקצאה FIFO על הטעינות האמיתיות, מהישנה לחדשה. ‏for update נועל אותן
  -- כדי ששתי בקשות במקביל לא יקצו את אותו כסף פעמיים.
  v_remaining := p_amount;
  for v_row in
    select id, (amount - refunded_amount) as available
      from public.wallet_topups
     where agent_id = p_agent_id
       and status = 'success'
       and test_mode = false
       and (amount - refunded_amount) > 0
     order by created_at
     for update
  loop
    exit when v_remaining <= 0;
    v_take := least(v_row.available, v_remaining);
    update public.wallet_topups
       set refunded_amount = refunded_amount + v_take
     where id = v_row.id;
    v_alloc := v_alloc || jsonb_build_object('topup_id', v_row.id, 'amount', v_take);
    v_remaining := v_remaining - v_take;
  end loop;

  -- לא הצלחנו להקצות את הכול. ‏wallet_refundable_amount אמר/ה שיש כיסוי,
  -- ולכן הגענו לכאן רק אם משהו השתנה תחת הרגליים. ‏raise ולא return:
  -- ‏return היה מותיר את הורדת היתרה על כנה.
  if v_remaining > 0 then
    raise exception 'refund_allocation_failed: % of % unallocated', v_remaining, p_amount;
  end if;

  insert into public.wallet_refunds (agent_id, amount, status, allocation, agent_note)
  values (p_agent_id, p_amount, 'requested', v_alloc, left(coalesce(p_note, ''), 500))
  returning id into v_refund_id;

  return jsonb_build_object('success', true, 'refund_id', v_refund_id,
                            'amount', p_amount, 'allocation', v_alloc,
                            'balance', (select credit_balance from public.agency_members
                                         where id = p_agent_id));
end;
$$;

comment on function public.request_wallet_refund(uuid, numeric, text) is
  'פתיחת בקשת החזר: מורידה את הסכום מהיתרה ותופסת הקצאה FIFO על הטעינות האמיתיות. ל-service_role בלבד.';

-- ---------------------------------------------------------------------------
-- 5. שחרור בקשה — ביטול על ידי הסוכן/ת או דחייה על ידי מנהל/ת
--
-- פונקציה פנימית אחת לשתי הדרכים, כי הפעולה זהה: מחזירים את היתרה ומשחררים
-- את ההקצאה. ההבדל היחיד הוא מי ביקש/ה ואיזה סטטוס נרשם.
-- ---------------------------------------------------------------------------
create or replace function public.release_wallet_refund(
  p_refund_id  uuid,
  p_new_status text,
  p_actor_id   uuid,
  p_note       text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_refund public.wallet_refunds;
  v_item   jsonb;
begin
  select * into v_refund from public.wallet_refunds
   where id = p_refund_id for update;
  if not found then
    return jsonb_build_object('error', 'refund_not_found');
  end if;
  if v_refund.status <> 'requested' then
    return jsonb_build_object('error', 'refund_not_open', 'status', v_refund.status);
  end if;

  -- היתרה חוזרת. אין כאן סיכון לזיכוי כפול: הסטטוס נבדק תחת נעילה למעלה,
  -- וקריאה שנייה על אותה שורה תיפול על refund_not_open.
  update public.agency_members
     set credit_balance = credit_balance + v_refund.amount
   where id = v_refund.agent_id;

  for v_item in select * from jsonb_array_elements(v_refund.allocation)
  loop
    update public.wallet_topups
       set refunded_amount = greatest(0, refunded_amount - (v_item->>'amount')::numeric)
     where id = (v_item->>'topup_id')::uuid;
  end loop;

  update public.wallet_refunds
     set status = p_new_status,
         resolved_at = now(),
         resolved_by = p_actor_id,
         resolution_note = left(coalesce(p_note, ''), 500)
   where id = p_refund_id;

  return jsonb_build_object('success', true, 'status', p_new_status,
                            'balance', (select credit_balance from public.agency_members
                                         where id = v_refund.agent_id));
end;
$$;

create or replace function public.cancel_wallet_refund(p_refund_id uuid, p_agent_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- הבעלות נבדקת כאן ולא ב-Edge Function בלבד: זו הפונקציה שמחזירה כסף,
  -- והיא לא סומכת על כך שהקורא כבר בדק.
  if not exists (select 1 from public.wallet_refunds
                 where id = p_refund_id and agent_id = p_agent_id) then
    return jsonb_build_object('error', 'not_your_refund');
  end if;
  return public.release_wallet_refund(p_refund_id, 'cancelled', p_agent_id, 'בוטלה על ידי הסוכן/ת');
end;
$$;

create or replace function public.reject_wallet_refund(
  p_refund_id uuid, p_admin_id uuid, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.release_wallet_refund(p_refund_id, 'rejected', p_admin_id, p_reason);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. סימון שההחזר בוצע
--
-- **אינה נוגעת ביתרה** — היא ירדה כבר בבקשה. כאן רק נרשם שהכסף יצא בפועל
-- ומול איזה מסמך זיכוי, כדי שתהיה דרך להצליב מול מורנינג.
-- ---------------------------------------------------------------------------
create or replace function public.complete_wallet_refund(
  p_refund_id      uuid,
  p_admin_id       uuid,
  p_credit_note_id text default null,
  p_note           text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status from public.wallet_refunds
   where id = p_refund_id for update;
  if not found then
    return jsonb_build_object('error', 'refund_not_found');
  end if;
  if v_status = 'completed' then
    return jsonb_build_object('success', true, 'already_completed', true);
  end if;
  if v_status <> 'requested' then
    return jsonb_build_object('error', 'refund_not_open', 'status', v_status);
  end if;

  update public.wallet_refunds
     set status = 'completed',
         resolved_at = now(),
         resolved_by = p_admin_id,
         provider_credit_note_id = p_credit_note_id,
         resolution_note = left(coalesce(p_note, ''), 500)
   where id = p_refund_id;

  return jsonb_build_object('success', true, 'status', 'completed');
end;
$$;

comment on function public.complete_wallet_refund(uuid, uuid, text, text) is
  'סימון שההחזר בוצע במורנינג. אינה נוגעת ביתרה — היא ירדה כבר בבקשה. ל-service_role בלבד.';

-- ---------------------------------------------------------------------------
-- 7. הרשאות — הכול דרך Edge Function, כמו כל נתיב כסף אחר
-- ---------------------------------------------------------------------------
revoke all on function public.request_wallet_refund(uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.request_wallet_refund(uuid, numeric, text) to service_role;

revoke all on function public.release_wallet_refund(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.release_wallet_refund(uuid, text, uuid, text) to service_role;

revoke all on function public.cancel_wallet_refund(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cancel_wallet_refund(uuid, uuid) to service_role;

revoke all on function public.reject_wallet_refund(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.reject_wallet_refund(uuid, uuid, text) to service_role;

revoke all on function public.complete_wallet_refund(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.complete_wallet_refund(uuid, uuid, text, text) to service_role;

-- הגרסה עם הפרמטר נשארת פנימית. ראו ההערה ליד my_wallet_refundable_amount().
revoke all on function public.wallet_refundable_amount(uuid) from public, anon, authenticated;
grant execute on function public.wallet_refundable_amount(uuid) to service_role;

-- הגרסה חסרת הפרמטר קוראת בלבד ואינה יכולה להצביע על סוכן/ת אחר/ת, ולכן
-- מותרת ישירות לדפדפן: הממשק צריך להציג "ניתן להחזר: ₪X".
revoke all on function public.my_wallet_refundable_amount() from public, anon;
grant execute on function public.my_wallet_refundable_amount() to authenticated, service_role;
