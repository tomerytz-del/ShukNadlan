-- ============================================================================
-- רכישת ליד ממדף הלידים האוטומטי — ₪50 מיתרת הארנק
--
-- מנוע ה-RSS ‏(schema.sql) יוצר לידים ב-rss_leads ומציג תקציר שיווקי בלבד
-- ב-view ‏rss_leads_public. המיגרציה הזו מוסיפה את צד המסחר: סוכן/ת לוחצ/ת
-- "רכישה" במדף, ‏₪50 יורדים מהארנק, הליד עובר ל-status='sold' ומשויך אליו/ה,
-- ורק אז source_url (הקישור לפוסט המקורי — המוצר עצמו) נחשף.
--
-- שלושה חלקים:
--   1. rss_lead_price ב-pricing_config — המחיר לא מקודד בקוד.
--   2. rss_lead_purchases — יומן החיובים, מקביל ל-lead_charges של הלידים
--      הפנימיים. ‏unique(lead_id) הוא רשת הביטחון מפני מכירה כפולה.
--   3. purchase_rss_lead() — הפונקציה האטומית. כמו claim_lead, היא נעולה
--      ל-service_role בלבד ונקראת רק דרך Edge Function ‏(rss-lead-purchase),
--      כי הטריגר protect_sensitive_agency_member_fields מתעלם משינוי
--      ‏credit_balance שלא הגיע מ-service_role — חיוב ישירות מהדפדפן היה
--      נבלע בשקט והליד היה נמכר בחינם.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. מחיר
-- ---------------------------------------------------------------------------
insert into public.pricing_config (key, value, description)
values ('rss_lead_price', 50, '₪ לרכישת ליד ממדף הלידים האוטומטי (RSS)')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. יומן רכישות
--
-- שורה אחת לכל ליד שנמכר. ‏amount נשמר כפי שחויב בפועל ולא נגזר מחדש
-- מ-pricing_config, כדי ששינוי מחיר עתידי לא ישכתב היסטוריית חיובים.
-- ---------------------------------------------------------------------------
create table if not exists public.rss_lead_purchases (
  id             uuid primary key default gen_random_uuid(),
  lead_id        uuid not null unique references public.rss_leads(id) on delete cascade,
  agent_id       uuid not null references public.agency_members(id) on delete cascade,
  agency_id      uuid references public.agencies(id) on delete set null,
  amount         numeric(10,2) not null check (amount >= 0),
  status         text not null default 'success' check (status in ('success','refunded')),
  payment_method text not null default 'balance',
  created_at     timestamptz not null default now()
);

comment on table public.rss_lead_purchases is
  'רכישות לידים ממדף ה-RSS. שורה אחת לכל ליד — unique(lead_id) מונע מכירה כפולה גם אם שתי בקשות רצות במקביל.';
comment on column public.rss_lead_purchases.amount is
  'הסכום שחויב בפועל בזמן הרכישה. לא נגזר מחדש מ-pricing_config כדי שהיסטוריית החיובים תישאר נאמנה.';

create index if not exists rss_lead_purchases_agent_created_idx
  on public.rss_lead_purchases (agent_id, created_at desc);

alter table public.rss_lead_purchases enable row level security;

-- כמו ב-rss_leads: מבקר לא מזוהה לא נוגע בטבלה בכלל.
revoke select on public.rss_lead_purchases from anon;

-- אין policy של כתיבה — הכתיבה היחידה היא מתוך purchase_rss_lead
-- שרצה ב-service_role (עוקף RLS), בדיוק כמו lead_charges.
drop policy if exists "agent reads own rss lead purchases" on public.rss_lead_purchases;
create policy "agent reads own rss lead purchases"
  on public.rss_lead_purchases for select
  using (agent_id = public.current_agent_id());

drop policy if exists "platform admin reads rss lead purchases" on public.rss_lead_purchases;
create policy "platform admin reads rss lead purchases"
  on public.rss_lead_purchases for select
  using (exists (
    select 1 from public.agency_members
    where agency_members.user_id = (select auth.uid())
      and agency_members.is_platform_admin = true));

-- ---------------------------------------------------------------------------
-- 3. הרכישה האטומית
--
-- ‏for update על שורת הליד מסדר שתי רכישות מקבילות בטור: השנייה תמתין,
-- תראה status='sold' ותקבל שגיאה מסודרת במקום לחייב פעמיים.
--
-- ‏p_agent_id מגיע מה-Edge Function שכבר גזרה אותו מה-JWT המאומת — אותה
-- תבנית כמו claim_lead. הפונקציה לא נחשפת ל-authenticated ולכן אי אפשר
-- לקרוא לה מהדפדפן עם מזהה סוכן/ת של מישהו אחר.
-- ---------------------------------------------------------------------------
create or replace function public.purchase_rss_lead(p_lead_id uuid, p_agent_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead  public.rss_leads%rowtype;
  v_agent public.agency_members%rowtype;
  v_price numeric;
  v_rows  int;
begin
  select * into v_lead from public.rss_leads where id = p_lead_id for update;
  if not found then
    return jsonb_build_object('error', 'lead_not_found');
  end if;

  -- רכישה חוזרת של אותו ליד על ידי הקונה עצמו מחזירה את הסחורה בלי לחייב שוב
  -- (למשל אם התשובה הראשונה אבדה ברשת והסוכן/ת לחצ/ה שוב).
  if v_lead.status = 'sold' then
    if v_lead.sold_to_agent_id = p_agent_id then
      return jsonb_build_object(
        'success', true,
        'already_purchased', true,
        'price_charged', 0,
        'source_url', v_lead.source_url,
        'source_name', v_lead.source_name,
        'raw_title', v_lead.raw_title,
        'raw_content', v_lead.raw_content,
        'published_at', v_lead.published_at
      );
    end if;
    return jsonb_build_object('error', 'lead_already_sold');
  end if;

  if v_lead.status <> 'new' or v_lead.is_lead = false then
    return jsonb_build_object('error', 'lead_not_available');
  end if;

  select * into v_agent from public.agency_members where id = p_agent_id and active = true;
  if not found then
    return jsonb_build_object('error', 'agent_not_found');
  end if;

  select value into v_price from public.pricing_config where key = 'rss_lead_price';
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

  update public.rss_leads
     set status = 'sold', sold_at = now(), sold_to_agent_id = p_agent_id
   where id = p_lead_id and status = 'new';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    -- לא אמור לקרות — השורה נעולה מתחילת הפונקציה. אם בכל זאת, raise מגלגל
    -- אחורה גם את ניכוי הארנק, ולכן אסור להחזיר כאן jsonb של שגיאה.
    raise exception 'rss_lead_purchase_race' using errcode = '40001';
  end if;

  insert into public.rss_lead_purchases (lead_id, agent_id, agency_id, amount, status, payment_method)
  values (p_lead_id, p_agent_id, v_agent.agency_id, v_price, 'success', 'balance');

  return jsonb_build_object(
    'success', true,
    'price_charged', v_price,
    'balance', v_agent.credit_balance - v_price,
    'source_url', v_lead.source_url,
    'source_name', v_lead.source_name,
    'raw_title', v_lead.raw_title,
    'raw_content', v_lead.raw_content,
    'published_at', v_lead.published_at
  );
end;
$$;

comment on function public.purchase_rss_lead(uuid, uuid) is
  'רכישת ליד RSS: ניכוי מהארנק, סימון הליד כנמכר ורישום ב-rss_lead_purchases — הכל בטרנזקציה אחת. ל-service_role בלבד, דרך ה-Edge Function rss-lead-purchase.';

-- נעילה: אותה תבנית כמו claim_lead (מיגרציה 013). הפונקציה מזיזה כסף,
-- ולכן היא לא נגישה לדפדפן — רק ל-service_role בתוך ה-Edge Function.
revoke all on function public.purchase_rss_lead(uuid, uuid) from public;
revoke all on function public.purchase_rss_lead(uuid, uuid) from anon;
revoke all on function public.purchase_rss_lead(uuid, uuid) from authenticated;
grant execute on function public.purchase_rss_lead(uuid, uuid) to service_role;
