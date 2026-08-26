-- ============================================================================
-- לידים ליועצי משכנתאות — איסוף ממחשבון המשכנתא ומכירה ב-₪50
--
-- מקבילה מדויקת של מנגנון rss_lead_purchase (מיגרציה 20260824120000), עם
-- הבדל אחד: המוצר הנמכר כאן אינו קישור לפוסט אלא פרטי הקשר של הפונה — שם,
-- טלפון ואימייל. לכן ההפרדה בין הטבלה ל-view השיווקי חדה עוד יותר: הטבלה
-- עצמה סגורה ל-anon לחלוטין, וה-view מציג רק את נתוני המחשבון (סכומים,
-- אחוז מימון, האם יש דירה) בלי שום פרט מזהה.
--
-- חמישה חלקים:
--   1. mortgage_lead_price ב-pricing_config — ₪50, לא מקודד בקוד.
--   2. agency_members.is_mortgage_advisor — מי רואה את המדף הזה ורשאי לקנות.
--   3. mortgage_leads + mortgage_leads_public — הליד והתקציר השיווקי.
--   4. mortgage_lead_purchases — יומן החיובים, unique(lead_id) מונע מכירה כפולה.
--   5. purchase_mortgage_lead() — הרכישה האטומית, ל-service_role בלבד.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. מחיר
-- ---------------------------------------------------------------------------
insert into public.pricing_config (key, value, description)
values ('mortgage_lead_price', 50, '₪ לרכישת ליד ייעוץ משכנתאות ממחשבון המשכנתא')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. מי קונה
--
-- יועצ/ת משכנתאות היא בעל/ת מקצוע, אבל מנגנון הרכישה כולו (ארנק
-- credit_balance, ‏current_agent_id(), הטריגר שנועל שדות רגישים) בנוי סביב
-- agency_members. במקום לשכפל ארנק שני, יועצ/ת נרשמ/ת כרגיל ומנהל/ת
-- הפלטפורמה מסמנ/ת את השורה. הדגל הוא גם ה-gating של המדף ב-CRM וגם תנאי
-- הרכישה ב-purchase_mortgage_lead — סוכן/ת תיווך רגיל/ה לא יכול/ה לקנות
-- לידים שנמכרו כייעוץ משכנתאות.
-- ---------------------------------------------------------------------------
alter table public.agency_members
  add column if not exists is_mortgage_advisor boolean not null default false;

comment on column public.agency_members.is_mortgage_advisor is
  'true = החשבון רשאי לראות ולרכוש לידים ממדף ייעוץ המשכנתאות. נקבע על ידי מנהל/ת הפלטפורמה.';

create index if not exists agency_members_mortgage_advisor_idx
  on public.agency_members (is_mortgage_advisor)
  where is_mortgage_advisor = true;

-- ---------------------------------------------------------------------------
-- 3. הלידים
--
-- הליד נוצר מהטופס שנפתח מכפתור ה-CTA במחשבון המשכנתא בדף הבית, ולכן הוא
-- נושא איתו את הפרמטרים שהמשתמש/ת בחר/ה במחשבון. הם לא קישוט: הם מה
-- שהיועצ/ת רואה לפני הרכישה ולפיו מחליט/ה אם הליד שווה ₪50.
-- ---------------------------------------------------------------------------
create table if not exists public.mortgage_leads (
  id             uuid primary key default gen_random_uuid(),

  -- פרטי הפונה — המוצר שנמכר, נחשף לקונה בלבד
  full_name      text not null check (length(btrim(full_name)) >= 2),
  phone          text not null,
  email          text,
  owns_property  boolean not null default false,

  -- ההקשר מהמחשבון
  property_price  numeric(14,2) check (property_price is null or property_price >= 0),
  equity          numeric(14,2) check (equity is null or equity >= 0),
  loan_amount     numeric(14,2) check (loan_amount is null or loan_amount >= 0),
  interest_rate   numeric(5,2)  check (interest_rate is null or interest_rate >= 0),
  years           smallint      check (years is null or years between 1 and 40),
  monthly_payment numeric(12,2) check (monthly_payment is null or monthly_payment >= 0),
  ltv_pct         numeric(5,2)  check (ltv_pct is null or ltv_pct >= 0),

  -- מסחר — אותה מכונה כמו rss_leads
  status         text not null default 'new'
                 check (status in ('new','sold','archived')),
  sold_at        timestamptz,
  sold_to_agent_id uuid,   -- מפנה ל-agency_members.id כשהליד נמכר

  source         text not null default 'homepage_calculator',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ‏phone_e164 מנורמל דרך אותה פונקציה שמזהה סוכנים בוואטסאפ, כדי
-- ש-050-1234567 ו-‎+972501234567 ייחשבו לאותו אדם.
alter table public.mortgage_leads
  add column if not exists phone_e164 text
  generated always as (public.normalize_msisdn(phone)) stored;

comment on table public.mortgage_leads is
  'לידים לייעוץ משכנתאות מטופס המחשבון בדף הבית. full_name/phone/email רגישים — נחשפים לקונה הליד בלבד.';
comment on column public.mortgage_leads.owns_property is
  'סימון המשתמש/ת "יש ברשותי דירה" — מבחין בין דירה יחידה (עד 75% מימון) למשפרי דיור/משקיעים.';
comment on column public.mortgage_leads.ltv_pct is
  'אחוז המימון כפי שהוצג במחשבון בזמן השליחה. נשמר כפי שהיה ולא מחושב מחדש.';
comment on column public.mortgage_leads.status is
  'new = פנוי למכירה · sold = נמכר ליועצ/ת · archived = הוסר מהמדף.';

-- ליד פתוח אחד לכל מספר טלפון: מי ששולח/ת פעמיים לא נמכר/ת פעמיים. אחרי
-- שהליד נמכר האינדקס משחרר, כך שפנייה חדשה מאותו אדם בעוד חצי שנה תיקלט.
create unique index if not exists mortgage_leads_open_phone_key
  on public.mortgage_leads (phone_e164)
  where status = 'new' and phone_e164 is not null;

create index if not exists mortgage_leads_status_idx  on public.mortgage_leads (status);
create index if not exists mortgage_leads_created_idx on public.mortgage_leads (created_at desc);
create index if not exists mortgage_leads_shelf_idx
  on public.mortgage_leads (created_at desc)
  where status = 'new';
create index if not exists mortgage_leads_sold_to_idx
  on public.mortgage_leads (sold_to_agent_id, sold_at desc)
  where sold_to_agent_id is not null;

-- ‏rss_set_updated_at היא פונקציה גנרית (new.updated_at = now()) מ-schema.sql
drop trigger if exists mortgage_leads_set_updated_at on public.mortgage_leads;
create trigger mortgage_leads_set_updated_at
  before update on public.mortgage_leads
  for each row execute function public.rss_set_updated_at();

alter table public.mortgage_leads enable row level security;

-- אותו היגיון כמו ב-rss_leads: כאן יושבים שם, טלפון ואימייל של אדם פרטי,
-- ולכן ההרשאה מוסרת מ-anon לגמרי ולא נשענים על RLS בלבד. הכתיבה היחידה היא
-- מ-mortgage-lead-intake שרץ ב-service_role.
revoke select on public.mortgage_leads from anon;

drop policy if exists "platform admin manage mortgage leads" on public.mortgage_leads;
create policy "platform admin manage mortgage leads"
  on public.mortgage_leads for all
  using (exists (
    select 1 from public.agency_members
    where agency_members.user_id = (select auth.uid())
      and agency_members.is_platform_admin = true))
  with check (exists (
    select 1 from public.agency_members
    where agency_members.user_id = (select auth.uid())
      and agency_members.is_platform_admin = true));

-- מי שקנה את הליד רואה את השורה המלאה, כולל פרטי הקשר.
drop policy if exists "buyer reads purchased mortgage lead" on public.mortgage_leads;
create policy "buyer reads purchased mortgage lead"
  on public.mortgage_leads for select
  using (sold_to_agent_id is not null and sold_to_agent_id = public.current_agent_id());

-- ---------------------------------------------------------------------------
-- ה-view השיווקי
--
-- ללא security_invoker — אותה תבנית כמו rss_leads_public: ה-view רץ בהרשאות
-- הבעלים ולכן מצליח לקרוא את הטבלה שממנה anon נשלל. מה שהוא מחזיר הוא
-- בדיוק מה שמותר להראות לפני התשלום: סכומים, כן. אדם, לא.
--
-- ‏authenticated בלבד — בניגוד למדף ה-RSS, המדף הזה אינו ויטרינה פומבית
-- באתר אלא מלאי מקצועי בתוך ה-CRM.
-- ---------------------------------------------------------------------------
create or replace view public.mortgage_leads_public as
select
  id,
  owns_property,
  property_price,
  equity,
  loan_amount,
  interest_rate,
  years,
  monthly_payment,
  ltv_pct,
  (email is not null and btrim(email) <> '') as has_email,
  status,
  created_at
from public.mortgage_leads
where status in ('new','sold');

comment on view public.mortgage_leads_public is
  'מדף לידי המשכנתאות — נתוני המחשבון בלבד. ללא שם, ללא טלפון, ללא אימייל.';

revoke select on public.mortgage_leads_public from anon;
grant select on public.mortgage_leads_public to authenticated;

-- ---------------------------------------------------------------------------
-- 4. יומן רכישות
--
-- ‏amount נשמר כפי שחויב בפועל ולא נגזר מחדש מ-pricing_config, כדי ששינוי
-- מחיר עתידי לא ישכתב היסטוריית חיובים. זהה ל-rss_lead_purchases.
-- ---------------------------------------------------------------------------
create table if not exists public.mortgage_lead_purchases (
  id             uuid primary key default gen_random_uuid(),
  lead_id        uuid not null unique references public.mortgage_leads(id) on delete cascade,
  agent_id       uuid not null references public.agency_members(id) on delete cascade,
  agency_id      uuid references public.agencies(id) on delete set null,
  amount         numeric(10,2) not null check (amount >= 0),
  status         text not null default 'success' check (status in ('success','refunded')),
  payment_method text not null default 'balance',
  created_at     timestamptz not null default now()
);

comment on table public.mortgage_lead_purchases is
  'רכישות לידי ייעוץ משכנתאות. שורה אחת לכל ליד — unique(lead_id) מונע מכירה כפולה גם בשתי בקשות מקבילות.';

create index if not exists mortgage_lead_purchases_agent_created_idx
  on public.mortgage_lead_purchases (agent_id, created_at desc);

alter table public.mortgage_lead_purchases enable row level security;
revoke select on public.mortgage_lead_purchases from anon;

-- אין policy של כתיבה — הכתיבה היחידה היא מתוך purchase_mortgage_lead
-- שרצה ב-service_role (עוקף RLS), בדיוק כמו lead_charges ו-rss_lead_purchases.
drop policy if exists "advisor reads own mortgage lead purchases" on public.mortgage_lead_purchases;
create policy "advisor reads own mortgage lead purchases"
  on public.mortgage_lead_purchases for select
  using (agent_id = public.current_agent_id());

drop policy if exists "platform admin reads mortgage lead purchases" on public.mortgage_lead_purchases;
create policy "platform admin reads mortgage lead purchases"
  on public.mortgage_lead_purchases for select
  using (exists (
    select 1 from public.agency_members
    where agency_members.user_id = (select auth.uid())
      and agency_members.is_platform_admin = true));

-- ---------------------------------------------------------------------------
-- 5. הרכישה האטומית
--
-- העתק נאמן של purchase_rss_lead, עם בדיקת is_mortgage_advisor נוספת.
-- ‏for update על שורת הליד מסדר שתי רכישות מקבילות בטור: השנייה תמתין,
-- תראה status='sold' ותקבל שגיאה מסודרת במקום לחייב פעמיים.
--
-- ‏p_agent_id מגיע מה-Edge Function שכבר גזרה אותו מה-JWT המאומת. הפונקציה
-- לא נחשפת ל-authenticated ולכן אי אפשר לקרוא לה מהדפדפן עם מזהה של מישהו
-- אחר — וגם לא לעקוף את הטריגר protect_sensitive_agency_member_fields,
-- שמתעלם משינוי credit_balance שלא הגיע מ-service_role.
-- ---------------------------------------------------------------------------
create or replace function public.purchase_mortgage_lead(p_lead_id uuid, p_agent_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead  public.mortgage_leads%rowtype;
  v_agent public.agency_members%rowtype;
  v_price numeric;
  v_rows  int;
begin
  select * into v_lead from public.mortgage_leads where id = p_lead_id for update;
  if not found then
    return jsonb_build_object('error', 'lead_not_found');
  end if;

  -- רכישה חוזרת של אותו ליד על ידי הקונה עצמו מחזירה את הסחורה בלי לחייב שוב
  -- (למשל אם התשובה הראשונה אבדה ברשת והיועצ/ת לחצ/ה שוב).
  if v_lead.status = 'sold' then
    if v_lead.sold_to_agent_id = p_agent_id then
      return jsonb_build_object(
        'success', true,
        'already_purchased', true,
        'price_charged', 0,
        'full_name', v_lead.full_name,
        'phone', v_lead.phone,
        'email', v_lead.email
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

  if v_agent.is_mortgage_advisor is not true then
    return jsonb_build_object('error', 'not_a_mortgage_advisor');
  end if;

  select value into v_price from public.pricing_config where key = 'mortgage_lead_price';
  v_price := coalesce(v_price, 50);

  if v_price > 0 then
    update public.agency_members
       set credit_balance = credit_balance - v_price
     where id = p_agent_id and credit_balance >= v_price;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      return jsonb_build_object(
        'error', 'insufficient_balance',
        'required', v_price,
        'balance', v_agent.credit_balance
      );
    end if;
  end if;

  update public.mortgage_leads
     set status = 'sold', sold_at = now(), sold_to_agent_id = p_agent_id
   where id = p_lead_id and status = 'new';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    -- לא אמור לקרות — השורה נעולה מתחילת הפונקציה. אם בכל זאת, raise מגלגל
    -- אחורה גם את ניכוי הארנק, ולכן אסור להחזיר כאן jsonb של שגיאה.
    raise exception 'mortgage_lead_purchase_race' using errcode = '40001';
  end if;

  insert into public.mortgage_lead_purchases (lead_id, agent_id, agency_id, amount, status, payment_method)
  values (p_lead_id, p_agent_id, v_agent.agency_id, v_price, 'success', 'balance');

  return jsonb_build_object(
    'success', true,
    'price_charged', v_price,
    'balance', v_agent.credit_balance - v_price,
    'full_name', v_lead.full_name,
    'phone', v_lead.phone,
    'email', v_lead.email
  );
end;
$$;

comment on function public.purchase_mortgage_lead(uuid, uuid) is
  'רכישת ליד משכנתאות: ניכוי מהארנק, סימון הליד כנמכר ורישום ב-mortgage_lead_purchases — הכל בטרנזקציה אחת. ל-service_role בלבד, דרך ה-Edge Function mortgage-lead-purchase.';

revoke all on function public.purchase_mortgage_lead(uuid, uuid) from public;
revoke all on function public.purchase_mortgage_lead(uuid, uuid) from anon;
revoke all on function public.purchase_mortgage_lead(uuid, uuid) from authenticated;
grant execute on function public.purchase_mortgage_lead(uuid, uuid) to service_role;
