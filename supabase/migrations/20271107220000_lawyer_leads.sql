-- ============================================================================
-- מדף הלידים של עורכי הדין: דגל, טבלה, מדף סגור לקהל, ורכישה ב-₪50 מהארנק
--
-- "שאלה לעו״ד" מדף נכס היא אותו מוצר כמו לידי המשכנתאות (20260826120000), על קהל
-- אחר: השאלה והטלפון נכנסים, הליד מוצג לעורכי הדין **בעיר של הנכס** בלי פרטי קשר,
-- ומי שרוכש/ת רואה אותם. המיגרציה הזו היא התשתית בלבד: **אין בה נקודת קליטה**. הטופס
-- בדף הנכס, אימות הטלפון בוואטסאפ וההתראה לסוכן/ת באים ב-PR נפרד, וכל עוד אין קליטה
-- הטבלה ריקה.
--
-- ## העיקרון: מדף ממוקד למי שביקש (7.11.2026, ‏docs/lead-routing.md)
-- ליד של עורך/ת דין לא מוצג למתווכים ולא ליועצי משכנתאות, ולהפך. ההפרדה ב-view עצמו
-- (‏current_is_lawyer), ולא ב-JS: מסך שמסתיר מגירה אינו הרשאה. ‏check_shelf_audience.py
-- דורש זאת.
--
-- ## ‏"בעיר" - גם ב-view
-- ליד עם נכס מקבל ‏city_id, ועורך/ת דין רואה אותו רק אם הוא/היא עובד/ת באותה עיר
-- (‏agent_works_city, אותה הגדרה כמו לידים שנסרקו מקבוצות). ליד בלי עיר, ומנהל/ת
-- פלטפורמה, נראים לכולם. ‏agent_works_city סגורה ל-service_role, ולכן העטיפה
-- ‏current_agent_works_city היא מה שה-view קורא.
--
-- ## החלקים
--   1. ‏lawyer_lead_price - ₪50 (‏pricing_config).
--   2. ‏agency_members.is_lawyer - מי רואה ורשאי/ת לקנות. נעול למנהל/ת הפלטפורמה.
--   3. ‏lawyer_leads + lawyer_lead_purchases.
--   4. ‏current_is_lawyer(), current_agent_works_city().
--   5. ‏lawyer_leads_public - המדף.
--   6. ‏purchase_lawyer_lead() - הרכישה האטומית, ל-service_role בלבד.
--
-- ## ‏protect_sensitive_agency_member_fields
-- הדגל נעול כמו is_mortgage_advisor: בלי השורה, כל סוכן/ת היה/הייתה מעניק/ה לעצמו/ה
-- ‏is_lawyer=true ורוכש/ת שאלות של לקוחות. הגוף כולו הועתק מ-20271029150000 ונבדק ב-
-- ‏md5 מול פרודקשן (9f308f5bac9b1210da73809e1f3b37a1) לפני הכתיבה; משתנה רק השורה
-- החדשה.
--
-- ## שמירת פרטים אישיים - בהמשך, עם הקליטה
-- ‏lawyer_leads נושאת שם, טלפון ואימייל של אדם פרטי. ‏data_retention_run מתחילה
-- לכסות אותה ב-PR של הקליטה, **לפני** ששורה ראשונה נכנסת (‏docs/data-retention.md).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. מחיר
-- ---------------------------------------------------------------------------
insert into public.pricing_config (key, value, description)
values ('lawyer_lead_price', 50, '₪ לרכישת ליד שאלה לעו"ד מדף נכס')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. מי קונה
-- ---------------------------------------------------------------------------
alter table public.agency_members
  add column if not exists is_lawyer boolean not null default false;

comment on column public.agency_members.is_lawyer is
  'true = החשבון רשאי לראות ולרכוש לידים ממדף עורכי הדין. נקבע על ידי מנהל/ת הפלטפורמה בלבד (נעול ב-protect_sensitive_agency_member_fields).';

create index if not exists agency_members_lawyer_idx
  on public.agency_members (is_lawyer)
  where is_lawyer = true;

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
  new.is_lawyer := old.is_lawyer; -- נעול לחלוטין — מנהל/ת הפלטפורמה בלבד
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

-- ---------------------------------------------------------------------------
-- 3. הלידים והרכישות
--
-- ‏status: pending = נקלט ועוד לא אומת הטלפון (לא במדף) · new = אומת, פנוי למכירה ·
-- ‏sold = נמכר · archived = הוסר. רק ‏new נראה במדף: ליד שהטלפון שלו לא אומת היה
-- נמכר ב-₪50 עם מספר שאולי אינו של מי ששאל.
-- ---------------------------------------------------------------------------
create table if not exists public.lawyer_leads (
  id               uuid primary key default gen_random_uuid(),

  -- פרטי הפונה - המוצר שנמכר, נחשף לקונה בלבד
  full_name        text not null check (length(btrim(full_name)) >= 2),
  phone            text not null,
  email            text,

  question         text not null check (length(btrim(question)) between 10 and 4000),

  property_id      uuid references public.properties(id) on delete set null,
  city_id          uuid references public.cities(id) on delete set null,

  status           text not null default 'pending'
                   check (status in ('pending','new','sold','archived')),
  phone_verified_at timestamptz,
  sold_at          timestamptz,
  sold_to_agent_id uuid references public.agency_members(id) on delete set null,

  source           text not null default 'property_page',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.lawyer_leads
  add column if not exists phone_e164 text
  generated always as (public.normalize_msisdn(phone)) stored;

comment on table public.lawyer_leads is
  'שאלות לעו"ד מדף נכס. full_name/phone/email/question רגישים - נחשפים לקונה הליד בלבד. התשתית בלבד; הקליטה ב-PR נפרד.';
comment on column public.lawyer_leads.status is
  'pending = לפני אימות הטלפון (לא במדף) · new = במדף · sold = נמכר · archived = הוסר.';
comment on column public.lawyer_leads.city_id is
  'עיר הנכס. קובעת לאילו עורכי דין הליד מוצג (current_agent_works_city); null = לכולם.';

-- ליד פתוח אחד לכל טלפון, כמו במשכנתאות: מי ששולח/ת פעמיים לא נמכר/ת פעמיים
create unique index if not exists lawyer_leads_open_phone_key
  on public.lawyer_leads (phone_e164)
  where status in ('pending','new') and phone_e164 is not null;

create index if not exists lawyer_leads_shelf_idx
  on public.lawyer_leads (created_at desc) where status = 'new';
create index if not exists lawyer_leads_sold_to_idx
  on public.lawyer_leads (sold_to_agent_id, sold_at desc) where sold_to_agent_id is not null;
create index if not exists lawyer_leads_property_idx
  on public.lawyer_leads (property_id) where property_id is not null;

drop trigger if exists lawyer_leads_set_updated_at on public.lawyer_leads;
create trigger lawyer_leads_set_updated_at
  before update on public.lawyer_leads
  for each row execute function public.rss_set_updated_at();

alter table public.lawyer_leads enable row level security;

-- הכתיבה היחידה מ-service_role (הקליטה והרכישה). authenticated קורא רק את השורה
-- שרכש, ומנהל/ת פלטפורמה את כולן; anon בכלל לא.
revoke all on table public.lawyer_leads from public, anon, authenticated;
grant select on table public.lawyer_leads to authenticated;
grant select, insert, update, delete on table public.lawyer_leads to service_role;

drop policy if exists "buyer reads purchased lawyer lead" on public.lawyer_leads;
create policy "buyer reads purchased lawyer lead"
  on public.lawyer_leads for select to authenticated
  using (sold_to_agent_id is not null and sold_to_agent_id = public.current_agent_id());

drop policy if exists "platform admin reads lawyer leads" on public.lawyer_leads;
create policy "platform admin reads lawyer leads"
  on public.lawyer_leads for select to authenticated
  using (public.current_is_platform_admin());

create table if not exists public.lawyer_lead_purchases (
  id             uuid primary key default gen_random_uuid(),
  lead_id        uuid not null unique references public.lawyer_leads(id) on delete cascade,
  agent_id       uuid not null references public.agency_members(id) on delete cascade,
  agency_id      uuid references public.agencies(id) on delete set null,
  amount         numeric(10,2) not null check (amount >= 0),
  status         text not null default 'success' check (status in ('success','refunded')),
  payment_method text not null default 'balance',
  created_at     timestamptz not null default now()
);

comment on table public.lawyer_lead_purchases is
  'רכישות לידי עורכי דין. שורה אחת לכל ליד - unique(lead_id) מונע מכירה כפולה גם בשתי בקשות מקבילות. amount נשמר כפי שחויב.';

create index if not exists lawyer_lead_purchases_agent_created_idx
  on public.lawyer_lead_purchases (agent_id, created_at desc);

alter table public.lawyer_lead_purchases enable row level security;

revoke all on table public.lawyer_lead_purchases from public, anon, authenticated;
grant select on table public.lawyer_lead_purchases to authenticated;
grant select, insert, update, delete on table public.lawyer_lead_purchases to service_role;

drop policy if exists "lawyer reads own lead purchases" on public.lawyer_lead_purchases;
create policy "lawyer reads own lead purchases"
  on public.lawyer_lead_purchases for select to authenticated
  using (agent_id = public.current_agent_id());

drop policy if exists "platform admin reads lawyer lead purchases" on public.lawyer_lead_purchases;
create policy "platform admin reads lawyer lead purchases"
  on public.lawyer_lead_purchases for select to authenticated
  using (public.current_is_platform_admin());

-- ---------------------------------------------------------------------------
-- 4. מי הקורא/ת
--
-- שתי הפונקציות מחזירות רק את מצב הקורא/ת עצמו/ה, ולכן ניתנות ל-authenticated:
-- בפרודקשן נצפה ש-view של הבעלים נכשל עם permission denied על EXECUTE של פונקציה
-- שהקורא/ת אינו מחזיק/ה בה (‏saved_search_intent_score, 20260830090000).
-- ---------------------------------------------------------------------------
create or replace function public.current_is_lawyer()
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
       and is_lawyer = true
  ) or public.current_is_platform_admin();
$$;

comment on function public.current_is_lawyer() is
  'האם הקורא/ת רשאי/ת לראות את מדף עורכי הדין: עו"ד פעיל/ה או מנהל/ת פלטפורמה (שרואה כדי לתפעל; רכישה רק לחשבון עם is_lawyer). הגדרה אחת, בשימוש ה-view lawyer_leads_public.';

revoke all on function public.current_is_lawyer() from public, anon;
grant execute on function public.current_is_lawyer() to authenticated, service_role;

-- ‏agent_works_city סגורה ל-service_role. העטיפה בודקת את הסוכן/ת של הקורא/ת בלבד
-- (‏current_agent_id), ולכן אינה מאפשרת לשאול על אחר/ת.
create or replace function public.current_agent_works_city(p_city_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.agent_works_city(public.current_agent_id(), p_city_id);
$$;

comment on function public.current_agent_works_city(uuid) is
  'האם הסוכן/ת של הקורא/ת עובד/ת בעיר (agent_works_city). למדף עורכי הדין.';

revoke all on function public.current_agent_works_city(uuid) from public, anon;
grant execute on function public.current_agent_works_city(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. המדף
--
-- ‏View של הבעלים (בלי security_invoker), כמו שאר המדפים: הוא קורא את הטבלה שהקורא/ת
-- אינו/ה רשאי/ת לקרוא ישירות, ומציג רק מה שמותר לפני הרכישה. השאלה עוברת
-- ‏redact_contact_text: שם משתמש ברשת, קישור, טלפון, מייל ושם הפונה מוסתרים ("•••"),
-- אחרת עו"ד היה פונה לפונה ישירות בלי לרכוש.
--
-- ‏status = 'new' בלבד: ליד שנמכר יורד מהמדף, ומי שרכש/ה קורא/ת אותו מהטבלה (policy).
-- ‏(select ...) עוטף את שומר הקהל כדי שיחושב פעם אחת לשאילתה.
-- ---------------------------------------------------------------------------
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
       or public.current_agent_works_city(l.city_id));

comment on view public.lawyer_leads_public is
  'מדף לידי עורכי הדין: השאלה (בלי פרטים מזהים), העיר והנכס. רק לעו"ד מסומן/ת ולמנהל/ת פלטפורמה (current_is_lawyer), ורק לליד בעיר שהוא/היא עובד/ת בה. ללא שם, טלפון או אימייל.';

revoke all on public.lawyer_leads_public from public, anon, authenticated;
grant select on public.lawyer_leads_public to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. הרכישה האטומית
--
-- העתק של purchase_mortgage_lead עם בדיקת is_lawyer. ‏for update על שורת הליד מסדר שתי
-- רכישות מקבילות בטור. ‏p_agent_id מגיע מה-Edge Function שגזרה אותו מה-JWT; הפונקציה
-- סגורה ל-service_role. המחיר מ-pricing_config, לעולם לא מהדפדפן, והארנק לפני מע"מ:
-- הרכישה מורידה את המחיר הנקוב ואינה מוסיפה מע"מ (הסקיל wallet-charges).
--
-- הרכישה אינה מחזירה "הצלחה" על ליד שלא אומת: רק ‏status = 'new' נמכר.
-- ---------------------------------------------------------------------------
create or replace function public.purchase_lawyer_lead(p_lead_id uuid, p_agent_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead  public.lawyer_leads%rowtype;
  v_agent public.agency_members%rowtype;
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
    if v_lead.sold_to_agent_id = p_agent_id then
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

  select * into v_agent from public.agency_members where id = p_agent_id and active = true;
  if not found then
    return jsonb_build_object('error', 'agent_not_found');
  end if;

  if v_agent.is_lawyer is not true then
    return jsonb_build_object('error', 'not_a_lawyer');
  end if;

  -- אותו כלל של המדף, גם ברכישה: מי שאינו/ה עובד/ת בעיר הליד לא קונה אותו גם אם הגיע/ה
  -- למזהה (קישור שהועבר, התראה). ליד בלי עיר פתוח לכל עו"ד.
  if v_lead.city_id is not null and not public.agent_works_city(p_agent_id, v_lead.city_id) then
    return jsonb_build_object('error', 'lead_not_available');
  end if;

  select value into v_price from public.pricing_config where key = 'lawyer_lead_price';
  v_price := coalesce(v_price, 50);

  v_balance := v_agent.credit_balance;
  if v_price > 0 then
    -- ‏returning: היתרה האמיתית אחרי הניכוי, לא תצלום שנקרא לפני שנעלנו
    update public.agency_members
       set credit_balance = credit_balance - v_price
     where id = p_agent_id and credit_balance >= v_price
    returning credit_balance into v_balance;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      return jsonb_build_object(
        'error', 'insufficient_balance', 'required', v_price, 'balance', v_agent.credit_balance
      );
    end if;
  end if;

  update public.lawyer_leads
     set status = 'sold', sold_at = now(), sold_to_agent_id = p_agent_id
   where id = p_lead_id and status = 'new';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    -- לא אמור לקרות: השורה נעולה מתחילת הפונקציה. raise מגלגל אחורה גם את ניכוי הארנק
    raise exception 'lawyer_lead_purchase_race' using errcode = '40001';
  end if;

  insert into public.lawyer_lead_purchases (lead_id, agent_id, agency_id, amount, status, payment_method)
  values (p_lead_id, p_agent_id, v_agent.agency_id, v_price, 'success', 'balance');

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
  'רכישת ליד עו"ד: ניכוי מהארנק, סימון הליד כנמכר ורישום ב-lawyer_lead_purchases בטרנזקציה אחת. ל-service_role בלבד, דרך ה-Edge Function lawyer-lead-purchase.';

revoke all on function public.purchase_lawyer_lead(uuid, uuid) from public, anon, authenticated;
grant execute on function public.purchase_lawyer_lead(uuid, uuid) to service_role;
