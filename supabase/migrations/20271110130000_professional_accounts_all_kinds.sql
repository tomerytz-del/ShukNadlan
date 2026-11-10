-- ============================================================================
-- חשבון כניסה לכל בעלי המקצוע, מדף המשכנתאות לחשבון בעל מקצוע, ושחזור קישור העריכה
--
-- ## הבעיה (10.11.2026)
-- שני בעלי מקצוע פנו באותו יום: יועץ משכנתאות ש"נכשל בהרשמה" (הכרטיסייה שלו ממתינה
-- לאישור מ-21.10, והוא נרשם שוב ב-5.11 ויצר כפילות), ויועץ משכנתאות ש"לא מצליח להיכנס
-- לחשבון" (אין לו חשבון: חשבון כניסה היה לעורכי דין בלבד, וכל השאר נכנסים לעריכה רק
-- מקישור עם אסימון, שאין שום דרך לשחזר בלי לכתוב לנו).
--
-- ## ההחלטה
-- 1. חשבון כניסה (professional_accounts) לכל תחום, לא רק לעו"ד. הטבלה כבר מכילה kind
--    לכל התחומים; מה שנפתח כאן הוא המדף השני, של יועצי המשכנתאות.
-- 2. מדף המשכנתאות (mortgage_leads) נמכר גם לחשבון בעל מקצוע, לא רק ל-agency_members
--    עם is_mortgage_advisor. שני המסלולים חיים יחד: היועצים שכבר סומנו ב-CRM ממשיכים
--    לקנות משם, ויועץ/ת שנרשם/ה בכרטיסייה קונה מהאזור האישי שלו/ה.
-- 3. אסימון העריכה נשלח מחדש למייל שבכרטיסייה (professional-manage, action recover_link),
--    עם בלם של עשר דקות שנרשם כאן (ad_placement_access.link_sent_at), ומנהל/ת הפלטפורמה
--    מקבל/ת אותו מהפאנל (admin_professional_card_manage_link).
-- 4. הכפילויות שכבר נוצרו: כרטיסייה ממתינה לאישור שיש לה אחות חדשה יותר באותו מייל
--    עוברת ל-ended, כדי שהפאנל לא יציג שתי בקשות על אותו אדם.
--
-- ## בטיחות
-- כל הפונקציות שעוברות על כסף נשארות service_role בלבד. המדף נשאר סגור ב-view
-- (current_is_mortgage_advisor, check_shelf_audience.py). mortgage_lead_purchases.agent_id
-- הופך ל-nullable כי לרכישה של חשבון בעל מקצוע אין agency_members; CHECK מבטיח קונה אחד.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. מי רואה את מדף המשכנתאות: גם חשבון בעל מקצוע מאושר
-- ---------------------------------------------------------------------------
create or replace function public.current_is_mortgage_advisor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from agency_members
     where user_id = auth.uid()
       and active = true
       and is_mortgage_advisor = true
  ) or exists (
    select 1 from professional_accounts
     where user_id = auth.uid()
       and active = true
       and shelf_enabled = true
       and kind = 'mortgage_advisor'
  ) or public.current_is_platform_admin();
$$;

comment on function public.current_is_mortgage_advisor() is
  'האם הקורא/ת רשאי/ת לראות את מדף ייעוץ המשכנתאות: יועץ/ת פעיל/ה ב-agency_members, חשבון בעל מקצוע (mortgage_advisor) עם shelf_enabled, או מנהל/ת פלטפורמה. הגדרה אחת, בשימוש ה-view mortgage_leads_public.';

revoke all on function public.current_is_mortgage_advisor() from public, anon;
grant execute on function public.current_is_mortgage_advisor() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. הקונה יכול/ה להיות חשבון בעל מקצוע
-- ---------------------------------------------------------------------------
alter table public.mortgage_leads
  add column if not exists sold_to_professional_id uuid references public.professional_accounts(id) on delete set null;
create index if not exists mortgage_leads_sold_to_professional_idx
  on public.mortgage_leads (sold_to_professional_id, sold_at desc) where sold_to_professional_id is not null;
comment on column public.mortgage_leads.sold_to_professional_id is
  'חשבון בעל המקצוע שרכש את הליד (professional_accounts). sold_to_agent_id = יועץ/ת דרך agency_members. לכל היותר אחד מהם.';

drop policy if exists "professional buyer reads purchased mortgage lead" on public.mortgage_leads;
create policy "professional buyer reads purchased mortgage lead"
  on public.mortgage_leads for select to authenticated
  using (sold_to_professional_id is not null
         and sold_to_professional_id in (select id from public.professional_accounts where user_id = (select auth.uid())));

-- יומן הרכישות: agent_id היה not null. רכישה של חשבון בעל מקצוע אינה נושאת agent_id
alter table public.mortgage_lead_purchases alter column agent_id drop not null;
alter table public.mortgage_lead_purchases
  add column if not exists professional_id uuid references public.professional_accounts(id) on delete set null;
create index if not exists mortgage_lead_purchases_professional_idx
  on public.mortgage_lead_purchases (professional_id, created_at desc) where professional_id is not null;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.mortgage_lead_purchases'::regclass
                    and conname = 'mortgage_lead_purchases_buyer_check') then
    alter table public.mortgage_lead_purchases
      add constraint mortgage_lead_purchases_buyer_check
      check (agent_id is not null or professional_id is not null);
  end if;
end $$;

comment on column public.mortgage_lead_purchases.professional_id is
  'חשבון בעל המקצוע שקנה (set null במחיקת חשבון: רשומת החיוב שורדת). agent_id או professional_id, אחד מהם.';

drop policy if exists "professional reads own mortgage lead purchases" on public.mortgage_lead_purchases;
create policy "professional reads own mortgage lead purchases"
  on public.mortgage_lead_purchases for select to authenticated
  using (professional_id is not null
         and professional_id in (select id from public.professional_accounts where user_id = (select auth.uid())));

-- ---------------------------------------------------------------------------
-- 3. הרכישה מהארנק של חשבון בעל מקצוע
--
-- אותה לוגיקה של purchase_mortgage_lead (agency_members) ושל purchase_lawyer_lead
-- (professional_accounts): נעילה על הליד, ניכוי מהארנק לפני מע"מ (הסקיל wallet-charges),
-- סימון כנמכר ורישום ביומן, בטרנזקציה אחת. service_role בלבד, דרך mortgage-lead-purchase.
-- ---------------------------------------------------------------------------
create or replace function public.purchase_mortgage_lead_professional(p_lead_id uuid, p_account_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead  public.mortgage_leads%rowtype;
  v_acct  public.professional_accounts%rowtype;
  v_price numeric;
  v_rows  int;
  v_balance numeric;
begin
  select * into v_lead from public.mortgage_leads where id = p_lead_id for update;
  if not found then
    return jsonb_build_object('error', 'lead_not_found');
  end if;

  if v_lead.status = 'sold' then
    if v_lead.sold_to_professional_id = p_account_id then
      return jsonb_build_object(
        'success', true, 'already_purchased', true, 'price_charged', 0,
        'full_name', v_lead.full_name, 'phone', v_lead.phone, 'email', v_lead.email
      );
    end if;
    return jsonb_build_object('error', 'lead_already_sold');
  end if;

  if v_lead.status <> 'new' then
    return jsonb_build_object('error', 'lead_not_available');
  end if;

  select * into v_acct from public.professional_accounts where id = p_account_id and active = true;
  if not found then
    return jsonb_build_object('error', 'account_not_found');
  end if;
  if v_acct.kind <> 'mortgage_advisor' then
    return jsonb_build_object('error', 'not_a_mortgage_advisor');
  end if;
  if v_acct.shelf_enabled is not true then
    return jsonb_build_object('error', 'shelf_not_approved');
  end if;

  select value into v_price from public.pricing_config where key = 'mortgage_lead_price';
  v_price := coalesce(v_price, 50);

  v_balance := v_acct.credit_balance;
  if v_price > 0 then
    update public.professional_accounts
       set credit_balance = credit_balance - v_price
     where id = p_account_id and credit_balance >= v_price
    returning credit_balance into v_balance;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      return jsonb_build_object(
        'error', 'insufficient_balance', 'required', v_price, 'balance', v_acct.credit_balance
      );
    end if;
  end if;

  update public.mortgage_leads
     set status = 'sold', sold_at = now(), sold_to_professional_id = p_account_id
   where id = p_lead_id and status = 'new';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    -- לא אמור לקרות: השורה נעולה מתחילת הפונקציה. raise מגלגל אחורה גם את ניכוי הארנק
    raise exception 'mortgage_lead_purchase_race' using errcode = '40001';
  end if;

  insert into public.mortgage_lead_purchases (lead_id, professional_id, amount, status, payment_method)
  values (p_lead_id, p_account_id, v_price, 'success', 'balance');

  return jsonb_build_object(
    'success', true,
    'price_charged', v_price,
    'balance', v_balance,
    'full_name', v_lead.full_name,
    'phone', v_lead.phone,
    'email', v_lead.email
  );
end;
$$;

comment on function public.purchase_mortgage_lead_professional(uuid, uuid) is
  'רכישת ליד משכנתאות מארנק חשבון בעל מקצוע (professional_accounts): ניכוי, סימון כנמכר ורישום ב-mortgage_lead_purchases בטרנזקציה אחת. service_role בלבד, דרך mortgage-lead-purchase.';

revoke all on function public.purchase_mortgage_lead_professional(uuid, uuid) from public, anon, authenticated;
grant execute on function public.purchase_mortgage_lead_professional(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. גודל הקהל של ליד משכנתאות סופר גם חשבונות בעלי מקצוע מאושרים
--    (הגוף מועתק מ-20271108140000, והשינוי היחיד הוא ענף mortgage_advisor)
-- ---------------------------------------------------------------------------
create or replace function public.lead_audience_size(p_kind text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case p_kind
    when 'mortgage_advisor' then (
      (select count(*)::int from agency_members
        where active = true and is_mortgage_advisor = true)
      + (select count(*)::int from professional_accounts
          where active = true and shelf_enabled = true and kind = 'mortgage_advisor'))
    when 'agent_buyer' then (
      select count(*)::int from agency_members
       where active = true)
    when 'agent_owner' then (
      select count(*)::int from agency_members m
       join agent_lead_preferences p on p.agent_id = m.id and p.active = true
       where m.active = true and m.tier in ('mid','premium'))
    when 'lawyer' then (
      select count(*)::int from professional_accounts
       where active = true and shelf_enabled = true and kind = 'real_estate_lawyer')
    else 0
  end;
$$;

-- ---------------------------------------------------------------------------
-- 5. שחזור קישור העריכה: בלם לשליחה חוזרת, וקריאה של מנהל/ת הפלטפורמה
-- ---------------------------------------------------------------------------
alter table public.ad_placement_access
  add column if not exists link_sent_at timestamptz;
comment on column public.ad_placement_access.link_sent_at is
  'מתי נשלח קישור העריכה למייל בפעם האחרונה (professional-manage, recover_link). בלם של עשר דקות לכתובת.';

-- האסימון הוא המפתח לכרטיסייה, ולכן יוצא רק למנהל/ת פלטפורמה. הפאנל ב-CRM מציג אותו
-- כדי לשלוח לבעל/ת המקצוע שאיבד/ה את הקישור, במקום SQL ידני.
create or replace function public.admin_professional_card_manage_link(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_token uuid;
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;
  select a.manage_token into v_token
    from public.ad_placement_access a
    join public.ad_placements p on p.id = a.placement_id
   where a.placement_id = p_id and p.placement_type = 'professional_card';
  if v_token is null then
    return jsonb_build_object('error', 'not_found');
  end if;
  return jsonb_build_object('success', true, 'path', '/professional-manage?token=' || v_token::text);
end;
$$;

comment on function public.admin_professional_card_manage_link(uuid) is
  'קישור העריכה של כרטיסיית בעל מקצוע, למנהל/ת הפלטפורמה בלבד (הפאנל "בעלי מקצוע" ב-CRM).';

revoke all on function public.admin_professional_card_manage_link(uuid) from public, anon, authenticated;
grant execute on function public.admin_professional_card_manage_link(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. כפילויות קיימות: כרטיסייה ממתינה לאישור שיש לה אחות חדשה יותר באותו מייל
--    (אותו אדם נרשם פעמיים כי לא ראה את הראשונה עולה). הישנה יורדת ל-ended, בלי
--    מחיקה: הפרופיל והאסימון נשארים. אידמפוטנטית: בהרצה שנייה אין מה לעדכן.
-- ---------------------------------------------------------------------------
update public.ad_placements old
   set status = 'ended'
 where old.placement_type = 'professional_card'
   and old.status = 'pending_approval'
   and old.contact_email is not null
   and exists (
     select 1 from public.ad_placements newer
      where newer.placement_type = 'professional_card'
        and newer.id <> old.id
        and lower(btrim(newer.contact_email)) = lower(btrim(old.contact_email))
        and newer.status in ('pending_approval', 'active')
        and newer.created_at > old.created_at
   );
