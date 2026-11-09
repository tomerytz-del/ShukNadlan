-- ============================================================================
-- חשבון בעל/ת מקצוע: כניסה וארנק לעורכי דין (ובהמשך לכל תחום), בלי רישיון תיווך
--
-- ## הבעיה
-- מדף עורכי הדין (20271107220000) נבנה על `agency_members.is_lawyer` וארנק הסוכן/ת. אבל
-- לבעלי מקצוע אין חשבון: הם נרשמים בכרטיסייה (`professional-signup`), נכנסים לעריכה בקישור
-- עם אסימון (`professional-manage`), ואין להם התחברות או ארנק. ופתיחת חשבון CRM
-- (`create-own-agency`, `join-agency`) דורשת מספר רישיון תיווך שלעו"ד אין. עו"ד אלדד סורק,
-- הראשון, נרשם בכרטיסייה לפני שהמדף קיים ולא יכול היה להיכנס אליו.
--
-- ## ההחלטה: טבלה נפרדת, כמו היזמים
-- ‏`agency_members` הוא יחידת המנוי, החיוב והמכסה של עולם התיווך: רישיון, קוד אתי, דירוג,
-- מדפי לידים של סוכנים ורוטציית הפצה (`docs/new-projects.md`, "יזם אינו סוכן"). בעל מקצוע
-- אין לו אף אחד מאלה. חשבון תיווך שאינו מתווך היה מקבל התראות "ביקוש פתוח" לכל סוכן בעיר,
-- נכנס לספירות המשרדים, ורואה את מדפי הסוכנים: בדיוק מה שהעיקרון "מדף ממוקד למי שביקש"
-- (docs/lead-routing.md) אוסר. לכן `professional_accounts`: חשבון כניסה (user_id), ארנק
-- משלו, ושיוך לכרטיסייה.
--
-- ## מה נכנס
--   1. ‏professional_accounts + professional_credit_log, והפונקציה professional_credit_add.
--   2. מדף עורכי הדין עובר לחשבון הזה: ‏current_is_lawyer, current_professional_works_city,
--      lawyer_leads_public, purchase_lawyer_lead, ועמודות הקונה בלידים וברכישות.
--   3. ‏agency_members.is_lawyer והנעילה שלו נמחקים. הם נכנסו ב-#1186 ולא שימשו אף פעם
--      (0 לידים, 0 סומנו), ושני מקורות אמת לאותה הרשאה היו מתפצלים.
--
-- ## בטיחות
-- הטבלאות lawyer_leads ו-lawyer_lead_purchases ריקות, ולכן שינוי העמודות בטוח. DO בסוף
-- החלק הראשון עוצר את כל המיגרציה אם מישהו הכניס שורה בינתיים, במקום למחוק נתונים.
-- ‏protect_sensitive_agency_member_fields חוזרת לגוף של 20271029150000 (md5
-- 9f308f5bac9b1210da73809e1f3b37a1 בפרודקשן לפני #1186), בלי השורה של is_lawyer.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. עצירה אם יש נתונים
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.lawyer_leads) or exists (select 1 from public.lawyer_lead_purchases) then
    raise exception 'lawyer_leads או lawyer_lead_purchases אינן ריקות - נדרשת הגירה ידנית, לא מחיקת עמודות';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. חשבון בעל/ת מקצוע
--
-- ‏shelf_enabled: מי רשאי/ת לראות ולרכוש לידים. נקבע על ידי מנהל/ת הפלטפורמה בלבד: אין
-- policy של כתיבה ל-authenticated, ולכן אין גם טריגר נעילה (ההפך מ-agency_members, שיש
-- בו policy של עדכון עצמי). ‏credit_balance ו-shelf_enabled משתנים רק מ-service_role.
-- ‏city_id: העיר שהוא/היא עובד/ת בה, מ-target_region של הכרטיסייה (אפשר לתקן בידי מנהל/ת).
-- ---------------------------------------------------------------------------
create table if not exists public.professional_accounts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null unique references auth.users(id) on delete cascade,
  card_id        uuid unique references public.ad_placements(id) on delete set null,
  kind           text not null
                 check (kind in ('mortgage_advisor','appraiser','architect','interior_designer',
                                 'real_estate_lawyer','cleaning','general')),
  display_name   text not null check (length(btrim(display_name)) >= 2),
  phone          text,
  city_id        uuid references public.cities(id) on delete set null,
  active         boolean not null default true,
  shelf_enabled  boolean not null default false,
  credit_balance numeric(12,2) not null default 0 check (credit_balance >= 0),
  terms_accepted_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.professional_accounts is
  'חשבון כניסה וארנק לבעל/ת מקצוע (עו"ד, יועץ משכנתאות...), בלי רישיון תיווך. נפרד מ-agency_members בכוונה (docs/professional-accounts.md).';
comment on column public.professional_accounts.shelf_enabled is
  'מי רשאי/ת לראות ולרכוש לידים. נקבע על ידי מנהל/ת הפלטפורמה בלבד (service_role).';
comment on column public.professional_accounts.credit_balance is
  'ארנק לפני מע"מ, כמו agency_members.credit_balance. משתנה רק מ-service_role (professional_credit_add, purchase_lawyer_lead).';

create index if not exists professional_accounts_kind_idx
  on public.professional_accounts (kind) where active;

drop trigger if exists professional_accounts_set_updated_at on public.professional_accounts;
create trigger professional_accounts_set_updated_at
  before update on public.professional_accounts
  for each row execute function public.rss_set_updated_at();

alter table public.professional_accounts enable row level security;

revoke all on table public.professional_accounts from public, anon, authenticated;
grant select on table public.professional_accounts to authenticated;
grant select, insert, update, delete on table public.professional_accounts to service_role;

drop policy if exists "professional reads own account" on public.professional_accounts;
create policy "professional reads own account"
  on public.professional_accounts for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "platform admin reads professional accounts" on public.professional_accounts;
create policy "platform admin reads professional accounts"
  on public.professional_accounts for select to authenticated
  using (public.current_is_platform_admin());

-- יומן זיכויים: כל כסף שנכנס לארנק בלי סליקה (טעינה ידנית של מנהל/ת, עד שתהיה סליקה לבעלי מקצוע)
create table if not exists public.professional_credit_log (
  id         uuid primary key default gen_random_uuid(),
  -- ‏set null ולא cascade: מחיקת חשבון (account-erasure, מחיקת משתמש) אינה מוחקת את יומן הכסף
  account_id uuid references public.professional_accounts(id) on delete set null,
  amount     numeric(12,2) not null check (amount <> 0),
  reason     text not null check (length(btrim(reason)) >= 3),
  balance_after numeric(12,2) not null,
  created_at timestamptz not null default now()
);

comment on table public.professional_credit_log is
  'זיכוי או חיוב ידני בארנק בעל/ת מקצוע (professional_credit_add). רכישות לידים נרשמות ב-lawyer_lead_purchases.';

revoke all on table public.professional_credit_log from public, anon, authenticated;
grant select on table public.professional_credit_log to authenticated;
grant select, insert, update, delete on table public.professional_credit_log to service_role;

alter table public.professional_credit_log enable row level security;

drop policy if exists "professional reads own credit log" on public.professional_credit_log;
create policy "professional reads own credit log"
  on public.professional_credit_log for select to authenticated
  using (account_id in (select id from public.professional_accounts where user_id = (select auth.uid())));

drop policy if exists "platform admin reads professional credit log" on public.professional_credit_log;
create policy "platform admin reads professional credit log"
  on public.professional_credit_log for select to authenticated
  using (public.current_is_platform_admin());

-- זיכוי ידני. ‏service_role בלבד (מנהל/ת הפלטפורמה דרך SQL או Edge Function): הארנק אינו נכתב
-- מהדפדפן. נעילה על השורה, ויתרה שאינה יורדת מתחת לאפס.
create or replace function public.professional_credit_add(p_account uuid, p_amount numeric, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance numeric;
begin
  if p_amount is null or p_amount = 0 then
    return jsonb_build_object('error', 'invalid_amount');
  end if;
  update public.professional_accounts
     set credit_balance = credit_balance + p_amount
   where id = p_account and credit_balance + p_amount >= 0
  returning credit_balance into v_balance;
  if not found then
    return jsonb_build_object('error', 'account_not_found_or_insufficient');
  end if;
  insert into public.professional_credit_log (account_id, amount, reason, balance_after)
  values (p_account, p_amount, p_reason, v_balance);
  return jsonb_build_object('success', true, 'balance', v_balance);
end;
$$;

comment on function public.professional_credit_add(uuid, numeric, text) is
  'זיכוי (או חיוב) ידני בארנק בעל/ת מקצוע, עם רישום ביומן. service_role בלבד.';

revoke all on function public.professional_credit_add(uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.professional_credit_add(uuid, numeric, text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. מדף עורכי הדין עובר לחשבון הזה
-- ---------------------------------------------------------------------------
drop policy if exists "buyer reads purchased lawyer lead" on public.lawyer_leads;
drop policy if exists "lawyer reads own lead purchases" on public.lawyer_lead_purchases;

alter table public.lawyer_leads drop column if exists sold_to_agent_id;
alter table public.lawyer_leads
  add column if not exists sold_to_professional_id uuid references public.professional_accounts(id) on delete set null;
create index if not exists lawyer_leads_sold_to_idx
  on public.lawyer_leads (sold_to_professional_id, sold_at desc) where sold_to_professional_id is not null;

alter table public.lawyer_lead_purchases drop column if exists agent_id;
alter table public.lawyer_lead_purchases drop column if exists agency_id;
-- ‏set null ולא cascade: רשומת החיוב (מי שילם כמה, ולמי נחשפו פרטי הפונה) שורדת מחיקת חשבון
alter table public.lawyer_lead_purchases
  add column if not exists professional_id uuid references public.professional_accounts(id) on delete set null;
create index if not exists lawyer_lead_purchases_professional_idx
  on public.lawyer_lead_purchases (professional_id, created_at desc);

create policy "buyer reads purchased lawyer lead"
  on public.lawyer_leads for select to authenticated
  using (sold_to_professional_id is not null
         and sold_to_professional_id in (select id from public.professional_accounts where user_id = (select auth.uid())));

create policy "lawyer reads own lead purchases"
  on public.lawyer_lead_purchases for select to authenticated
  using (professional_id in (select id from public.professional_accounts where user_id = (select auth.uid())));

comment on column public.lawyer_leads.sold_to_professional_id is
  'חשבון בעל המקצוע שרכש את הליד (professional_accounts).';

-- מי הקורא/ת: עו"ד עם חשבון פעיל שהמנהל/ת אישר/ה לו/ה את המדף, או מנהל/ת פלטפורמה (לצפייה).
create or replace function public.current_is_lawyer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from professional_accounts
     where user_id = auth.uid()
       and active = true
       and shelf_enabled = true
       and kind = 'real_estate_lawyer'
  ) or public.current_is_platform_admin();
$$;

comment on function public.current_is_lawyer() is
  'האם הקורא/ת רשאי/ת לראות את מדף עורכי הדין: חשבון עו"ד פעיל עם shelf_enabled, או מנהל/ת פלטפורמה (לצפייה; רכישה רק לחשבון עו"ד). הגדרה אחת, בשימוש ה-view lawyer_leads_public.';

-- "בעיר": העיר של החשבון, או אותו שוק (cities.market_slug), כמו agent_works_city
create or replace function public.current_professional_works_city(p_city_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_city_id is not null and exists (
    select 1
      from public.professional_accounts pa
      left join public.cities pc on pc.id = pa.city_id
      left join public.cities c on c.id = p_city_id
     where pa.user_id = auth.uid() and pa.active
       and (pa.city_id = p_city_id
            or (pc.market_slug is not null and pc.market_slug = c.market_slug))
  );
$$;

comment on function public.current_professional_works_city(uuid) is
  'האם חשבון בעל המקצוע של הקורא/ת עובד בעיר (העיר שלו או אותו שוק). למדף עורכי הדין.';

revoke all on function public.current_professional_works_city(uuid) from public, anon;
grant execute on function public.current_professional_works_city(uuid) to authenticated, service_role;

create or replace view public.lawyer_leads_public as
select
  l.id,
  public.redact_contact_text(l.question, l.full_name) as question_text,
  l.property_id,
  l.city_id,
  (l.email is not null and btrim(l.email) <> '') as has_email,
  l.status,
  l.created_at
from public.lawyer_leads l
where l.status = 'new'
  and (select public.current_is_lawyer())
  and (public.current_is_platform_admin()
       or l.city_id is null
       or public.current_professional_works_city(l.city_id));

-- הפונקציה הישנה (לפי agency_members) כבר אינה בשימוש
drop function if exists public.current_agent_works_city(uuid);

-- הרכישה: אותה לוגיקה, על חשבון בעל המקצוע
drop function if exists public.purchase_lawyer_lead(uuid, uuid);
create function public.purchase_lawyer_lead(p_lead_id uuid, p_account_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead  public.lawyer_leads%rowtype;
  v_acct  public.professional_accounts%rowtype;
  v_price numeric;
  v_rows  int;
  v_balance numeric;
begin
  select * into v_lead from public.lawyer_leads where id = p_lead_id for update;
  if not found then
    return jsonb_build_object('error', 'lead_not_found');
  end if;

  -- רכישה חוזרת של אותו ליד על ידי הקונה עצמו מחזירה את הסחורה בלי חיוב נוסף
  if v_lead.status = 'sold' then
    if v_lead.sold_to_professional_id = p_account_id then
      return jsonb_build_object(
        'success', true, 'already_purchased', true, 'price_charged', 0,
        'full_name', v_lead.full_name, 'phone', v_lead.phone, 'email', v_lead.email,
        'question', v_lead.question
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
  if v_acct.kind <> 'real_estate_lawyer' then
    return jsonb_build_object('error', 'not_a_lawyer');
  end if;
  if v_acct.shelf_enabled is not true then
    return jsonb_build_object('error', 'shelf_not_approved');
  end if;

  -- אותו כלל של המדף, גם ברכישה: מי שאינו/ה עובד/ת בעיר הליד לא קונה אותו גם אם הגיע/ה למזהה.
  -- ליד בלי עיר פתוח לכל עו"ד מאושר.
  if v_lead.city_id is not null and not exists (
    select 1
      from public.cities lc
      left join public.cities ac on ac.id = v_acct.city_id
     where lc.id = v_lead.city_id
       and (v_acct.city_id = v_lead.city_id
            or (ac.market_slug is not null and ac.market_slug = lc.market_slug))
  ) then
    return jsonb_build_object('error', 'lead_not_available');
  end if;

  select value into v_price from public.pricing_config where key = 'lawyer_lead_price';
  v_price := coalesce(v_price, 50);

  v_balance := v_acct.credit_balance;
  if v_price > 0 then
    -- ‏returning: היתרה האמיתית אחרי הניכוי. הארנק לפני מע"מ: מורידים את המחיר הנקוב (wallet-charges)
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

  update public.lawyer_leads
     set status = 'sold', sold_at = now(), sold_to_professional_id = p_account_id
   where id = p_lead_id and status = 'new';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    -- לא אמור לקרות: השורה נעולה מתחילת הפונקציה. raise מגלגל אחורה גם את ניכוי הארנק
    raise exception 'lawyer_lead_purchase_race' using errcode = '40001';
  end if;

  insert into public.lawyer_lead_purchases (lead_id, professional_id, amount, status, payment_method)
  values (p_lead_id, p_account_id, v_price, 'success', 'balance');

  return jsonb_build_object(
    'success', true,
    'price_charged', v_price,
    'balance', v_balance,
    'full_name', v_lead.full_name,
    'phone', v_lead.phone,
    'email', v_lead.email,
    'question', v_lead.question
  );
end;
$$;

comment on function public.purchase_lawyer_lead(uuid, uuid) is
  'רכישת ליד עו"ד: ניכוי מארנק professional_accounts, סימון הליד כנמכר ורישום ב-lawyer_lead_purchases בטרנזקציה אחת. service_role בלבד, דרך lawyer-lead-purchase.';

revoke all on function public.purchase_lawyer_lead(uuid, uuid) from public, anon, authenticated;
grant execute on function public.purchase_lawyer_lead(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. is_lawyer על agency_members נמחק, והטריגר חוזר לגוף המקורי
-- ---------------------------------------------------------------------------
create or replace function public.protect_sensitive_agency_member_fields()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  -- ‏coalesce מבטיח true/false ולעולם לא NULL
  is_self boolean := coalesce(
    old.user_id is not null and old.user_id = (select auth.uid()),
    false
  );
  -- הקשר מנהלתי: מיגרציה, SQL Editor או Edge Function. נקבע לפי תפקיד ה-DB
  -- בפועל, שדפדפן לא יכול להתחזות אליו
  is_privileged boolean := current_user in ('postgres', 'supabase_admin', 'service_role')
                           or auth.role() = 'service_role';
begin
  if is_privileged then
    return new;
  end if;
  new.credit_balance := old.credit_balance;
  new.tier := old.tier;
  new.free_quota_used := old.free_quota_used;
  new.free_quota_cycle_start := old.free_quota_cycle_start;
  new.payment_token_id := old.payment_token_id;
  new.billing_status := old.billing_status;
  new.pending_tier_change := old.pending_tier_change;
  new.pending_tier_change_at := old.pending_tier_change_at;
  new.subscription_id := old.subscription_id;
  new.is_platform_admin := old.is_platform_admin; -- נעול לחלוטין, גם למנהל משרד רגיל
  new.is_mortgage_advisor := old.is_mortgage_advisor; -- נעול לחלוטין — מנהל/ת הפלטפורמה בלבד
  new.ethics_badge_revoked_at := old.ethics_badge_revoked_at; -- הסרת תו: הנהלת הפלטפורמה בלבד

  -- המנוי בתשלום — דרך complete_subscription_order בלבד. אלה שדות כסף
  -- במלוא מובן המילה: מי שכותב/ת אותם מהדפדפן מעניק/ה לעצמו/ה מסלול Elite.
  new.paid_tier := old.paid_tier;
  new.paid_tier_until := old.paid_tier_until;

  -- בחירת המסלול והטבת ההשקה — דרך join-agency ו-promo-lifecycle בלבד.
  -- אלה שדות כסף: מי שיכול/ה לכתוב אותם מהדפדפן יכול/ה להאריך לעצמו/ה
  -- חצי שנה חינם, או לסמן בחירה שלא נעשתה.
  new.tier_selected_at := old.tier_selected_at;
  new.tier_source := old.tier_source;
  new.promo_tier := old.promo_tier;
  new.promo_started_at := old.promo_started_at;
  new.promo_ends_at := old.promo_ends_at;
  new.promo_notice_1_at := old.promo_notice_1_at;
  new.promo_notice_2_at := old.promo_notice_2_at;
  new.promo_ended_at := old.promo_ended_at;

  -- ניתוק מהמשרד — דרך release-team-member בלבד
  new.released_at := old.released_at;
  new.released_from_agency_id := old.released_from_agency_id;
  new.released_by := old.released_by;

  -- סגירת חשבון — דרך close-account בלבד. אותו נימוק בדיוק: מי שיכול/ה
  -- לכתוב את closed_at מהדפדפן יכול/ה להוריד מהאוויר סוכן/ת אחר/ת, או
  -- לסמן את עצמו/ה כסגור/ה בלי שההחזר, האירכוב וההסרה מרשימת התפוצה קרו.
  new.closure_requested_at := old.closure_requested_at;
  new.closure_effective_at := old.closure_effective_at;
  new.closed_at := old.closed_at;
  new.closure_reason := old.closure_reason;

  -- אימות הרישיון — נקבע בשער בלבד (‏_shared/broker-license-gate.ts) ובאישור
  -- הידני של הנהלת הפלטפורמה. מי שיכול/ה לכתוב את license_status מהדפדפן
  -- יכול/ה לבטל את כל הבדיקה בשורה אחת.
  new.license_status := old.license_status;
  new.license_registry_name := old.license_registry_name;
  new.license_entity_status := old.license_entity_status;
  new.license_checked_at := old.license_checked_at;
  new.license_approved_at := old.license_approved_at;
  new.license_approved_by := old.license_approved_by;

  -- מספר הרישיון: עדכון עצמי בלבד, וגם זה רק **כל עוד לא אומת**. הבדיקה
  -- מול הרשם היא חד-פעמית בכניסה, ולכן החלפת המספר אחריה הייתה מרוקנת
  -- אותה מתוכן. מי שעדיין לא אומת/ה ממשיך/ה לתקן שגיאת הקלדה כרגיל.
  if not is_self
     or new.license_number is null
     or btrim(new.license_number) = ''
     or old.license_status in ('verified', 'manual') then
    new.license_number := old.license_number;
  end if;

  -- אישור הקוד האתי — אישי בלבד, והחותמת נקבעת בשרת
  if not is_self then
    new.ethics_code_accepted_at := old.ethics_code_accepted_at;
    new.ethics_code_version := old.ethics_code_version;
  elsif new.ethics_code_accepted_at is null then
    new.ethics_code_version := null;               -- ביטול אישור מנקה גם את הגרסה
  elsif old.ethics_code_accepted_at is null
        or new.ethics_code_version is distinct from old.ethics_code_version then
    new.ethics_code_accepted_at := now();          -- אישור חדש (או לגרסה חדשה) — עכשיו
  else
    new.ethics_code_accepted_at := old.ethics_code_accepted_at;
  end if;

  if is_self then
    new.role := old.role;
    new.active := old.active;
    new.agency_id := old.agency_id;
    -- צוות (20270601130000): השיוך לצוות נקבע בידי מנהל/ת המשרד בלבד. ה-RLS
    -- כבר מגביל עדכון של שורה אחרת למנהלים, ולכן כאן נחסם רק העדכון העצמי.
    new.team_id := old.team_id;
    -- "גם סוכן/ת פעיל/ה": סוכן/ת אינו/ה מוציא/ה את עצמו/ה מרוטציית הלידים.
    -- מנהל/ת כן קובע/ת את זה לעצמו/ה - אחרת במשרד עם מנהל/ת אחד/ת אין מי
    -- שיכול/ה לסמן את זה.
    if old.role is distinct from 'manager' then
      new.is_active_agent := old.is_active_agent;
    end if;
  end if;

  -- עיר קבועה לנכס חדש. אישית: מנהל/ת משרד לא מחליף/ה אותה לסוכן/ת אחר/ת.
  if not is_self then
    new.default_city_id := old.default_city_id;
  end if;
  return new;
end;
$function$;

drop index if exists public.agency_members_lawyer_idx;
alter table public.agency_members drop column if exists is_lawyer;
