-- ============================================================================
-- עלויות הפלטפורמה — כמה עולה להחזיק את המערכת, לפי שירות ולפי חודש
--
-- ## מה היה חסר
--
-- הפלטפורמה משלמת לשנים-עשר ספקים לפחות: אחסון (Netlify, Supabase,
-- דומיינים), מודלים (Claude API, Gemini, Whisper, fal.ai), הודעות (Meta,
-- Twilio), אוטומציה (Make), סליקה (morning) — ועוד המנוי של Claude Code.
-- כל אחד מחייב בכרטיס בנפרד, ומשאיר קבלה במייל אחר. השאלה "כמה עלה
-- ספטמבר" לא הייתה נגישות משום מסך, והתשובה הראשונה שנאספה ביד הפתיעה:
-- ‏Netlify לבדו קפץ מ-‏$40 באוגוסט ל-‏$443 בספטמבר — 29 טעינות אוטומטיות של
-- ‏$10, כמעט פעמיים ביום, בלי שאיש שם לב.
--
-- ## מה נכנס כאן
--
--   1. ‏`platform_costs` — שורה לכל חיוב: שירות, תאריך, סכום, מטבע, מספר
--      חשבונית, ומאיפה הגיע (מייל, הזנה ידנית, ייבוא ראשוני).
--   2. ‏`platform_costs_list()` — מה שהפאנל "עלויות" ב-CRM קורא.
--   3. ‏`platform_cost_save()` / ‏`platform_cost_delete()` — הזנה ידנית,
--      תיקון, אישור או דחייה של חיוב שממתין.
--   4. ‏`email_intake_messages.via = 'costs'` — קבלה שהועברה ל-
--      ‏shuknadlan+costs@gmail.com נקלטת מאותו סבב IMAP של הקליטה מהמייל.
--   5. נתוני פתיחה: הקבלות מיולי עד ספטמבר 2026, כפי שנמצאו בתיבה.
--
-- ## שתי החלטות שכדאי להכיר
--
--   * ‏**סכום שלא זוהה בוודאות אינו נספר.** קבלה בלי סכום (‏Meta שולחת את
--     הסכום ב-PDF) נכנסת כ-`pending` עם `amount` ריק, ומחכה בפאנל לאישור.
--     דוח עלויות שמנחש הוא דוח שאי אפשר לסמוך על אף שורה בו.
--   * ‏**מספר החשבונית הוא המפתח נגד כפילות**, לכל שירות בנפרד. אותה קבלה
--     שהועברה פעמיים, או חשבונית של Supabase שמגיעה פעם כ"חשבונית חדשה"
--     ופעם כ"התשלום התקבל", נספרות פעם אחת.
--
-- הפרטים: ‏docs/platform-costs.md. הקובץ אידמפוטנטי — אפשר להריץ אותו שוב.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. הטבלה
-- ---------------------------------------------------------------------------
create table if not exists public.platform_costs (
  id              bigint generated always as identity primary key,
  -- מפתח השירות (‏netlify, anthropic_api, …). הרשימה והשמות בעברית יושבים
  -- ב-`assets/crm.js` וב-`_shared/cost-mail.ts`; כאן רק הצורה, כדי ששירות
  -- חדש לא יחייב מיגרציה.
  service         text        not null,
  charged_on      date        not null,
  -- ריק = עוד לא ידוע (‏pending). שלילי = החזר.
  amount          numeric(12, 2),
  currency        text        not null default 'USD',
  invoice_no      text,
  description     text,
  status          text        not null default 'confirmed',
  source          text        not null default 'manual',
  mail_message_id text,
  mail_from       text,
  mail_subject    text,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'platform_costs_service_check') then
    alter table public.platform_costs
      add constraint platform_costs_service_check check (service ~ '^[a-z0-9_]{2,40}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'platform_costs_currency_check') then
    alter table public.platform_costs
      add constraint platform_costs_currency_check check (currency in ('USD', 'ILS', 'EUR'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'platform_costs_status_check') then
    alter table public.platform_costs
      add constraint platform_costs_status_check check (status in ('confirmed', 'pending', 'rejected'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'platform_costs_source_check') then
    alter table public.platform_costs
      add constraint platform_costs_source_check check (source in ('mail', 'manual', 'backfill'));
  end if;
  -- חיוב מאושר בלי סכום הוא בדיוק הניחוש שהטבלה הזו נועדה למנוע.
  if not exists (select 1 from pg_constraint where conname = 'platform_costs_confirmed_amount_check') then
    alter table public.platform_costs
      add constraint platform_costs_confirmed_amount_check
      check (status <> 'confirmed' or amount is not null);
  end if;
end $$;

create unique index if not exists platform_costs_invoice_uq
  on public.platform_costs (service, invoice_no)
  where invoice_no is not null;

create unique index if not exists platform_costs_mail_uq
  on public.platform_costs (mail_message_id)
  where mail_message_id is not null;

create index if not exists platform_costs_charged_idx
  on public.platform_costs (charged_on desc);

comment on table public.platform_costs is
  'חיוב אחד של ספק שהפלטפורמה משלמת לו. נקרא ונכתב דרך platform_costs_* (מנהל/ת פלטפורמה) ומקליטת המייל (service_role). docs/platform-costs.md';

-- אין policy בכלל: הגישה רק דרך הפונקציות שלמטה, שבודקות מנהל/ת פלטפורמה.
alter table public.platform_costs enable row level security;
revoke all on table public.platform_costs from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. קליטה מהמייל: ערך שלישי ל-`via`
-- ---------------------------------------------------------------------------
alter table public.email_intake_messages
  drop constraint if exists email_intake_messages_via_check;
alter table public.email_intake_messages
  add constraint email_intake_messages_via_check check (via in ('token', 'sender', 'costs'));

-- ---------------------------------------------------------------------------
-- 3. ‏platform_costs_list — מה שהפאנל קורא
--
-- מחזיר את כל השורות בטווח (כולל ממתינות ונדחות — הפאנל מחליט מה להציג),
-- ובנוסף את **כל** הממתינות בלי קשר לתאריך: קבלה מיולי שמחכה לאישור לא
-- אמורה להיעלם רק כי הטווח שנבחר הוא החודש הנוכחי.
-- ---------------------------------------------------------------------------
create or replace function public.platform_costs_list(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_from date := coalesce(p_from, (date_trunc('month', now()) - interval '5 months')::date);
  v_to   date := coalesce(p_to, now()::date);
begin
  if not current_is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'from', v_from,
    'to', v_to,
    'rows', coalesce((
      select jsonb_agg(to_jsonb(c) - 'created_by' order by c.charged_on desc, c.id desc)
        from platform_costs c
       where c.charged_on between v_from and v_to
    ), '[]'::jsonb),
    'pending', coalesce((
      select jsonb_agg(to_jsonb(c) - 'created_by' order by c.charged_on desc, c.id desc)
        from platform_costs c
       where c.status = 'pending'
    ), '[]'::jsonb),
    'last_mail_at', (select max(created_at) from platform_costs where source = 'mail')
  );
end;
$$;

comment on function public.platform_costs_list(date, date) is
  'עלויות הפלטפורמה בטווח תאריכים, וכל מה שממתין לאישור. למנהל/ת פלטפורמה בלבד.';

revoke all on function public.platform_costs_list(date, date) from public, anon, authenticated;
grant execute on function public.platform_costs_list(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. ‏platform_cost_save — הזנה ידנית, תיקון, אישור ודחייה
--
-- ‏p_id ריק = חיוב חדש (‏source = 'manual'). אחרת עדכון של שורה קיימת —
-- כולל שורה שהגיעה מהמייל: תיקון הסכום שם אינו הופך אותה ל"ידנית", כי
-- המקור הוא עדיין הקבלה.
-- ---------------------------------------------------------------------------
create or replace function public.platform_cost_save(
  p_id          bigint,
  p_service     text,
  p_charged_on  date,
  p_amount      numeric,
  p_currency    text,
  p_invoice_no  text,
  p_description text,
  p_status      text default 'confirmed'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_service text := lower(btrim(coalesce(p_service, '')));
  v_status  text := coalesce(nullif(btrim(p_status), ''), 'confirmed');
  v_inv     text := nullif(btrim(coalesce(p_invoice_no, '')), '');
  v_desc    text := nullif(btrim(coalesce(p_description, '')), '');
  v_row     platform_costs;
begin
  if not current_is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;
  if v_service !~ '^[a-z0-9_]{2,40}$' then
    raise exception 'שירות לא תקין' using errcode = '22023';
  end if;
  if p_charged_on is null then
    raise exception 'חסר תאריך חיוב' using errcode = '22023';
  end if;
  if v_status = 'confirmed' and p_amount is null then
    raise exception 'חיוב מאושר חייב סכום' using errcode = '22023';
  end if;

  if p_id is null then
    insert into platform_costs
      (service, charged_on, amount, currency, invoice_no, description, status, source, created_by)
    values
      (v_service, p_charged_on, p_amount, coalesce(p_currency, 'USD'), v_inv, left(v_desc, 500),
       v_status, 'manual', auth.uid())
    returning * into v_row;
  else
    update platform_costs
       set service     = v_service,
           charged_on  = p_charged_on,
           amount      = p_amount,
           currency    = coalesce(p_currency, currency),
           invoice_no  = v_inv,
           description = left(v_desc, 500),
           status      = v_status,
           updated_at  = now()
     where id = p_id
    returning * into v_row;
    if not found then
      raise exception 'החיוב לא נמצא' using errcode = 'P0002';
    end if;
  end if;

  return to_jsonb(v_row) - 'created_by';
exception
  when unique_violation then
    raise exception 'חשבונית עם המספר הזה כבר רשומה לשירות הזה' using errcode = '23505';
end;
$$;

comment on function public.platform_cost_save(bigint, text, date, numeric, text, text, text, text) is
  'הוספה או עדכון של חיוב בעלויות הפלטפורמה. למנהל/ת פלטפורמה בלבד.';

revoke all on function public.platform_cost_save(bigint, text, date, numeric, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.platform_cost_save(bigint, text, date, numeric, text, text, text, text)
  to authenticated;

create or replace function public.platform_cost_delete(p_id bigint)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not current_is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;
  delete from platform_costs where id = p_id;
end;
$$;

comment on function public.platform_cost_delete(bigint) is
  'מחיקת חיוב מעלויות הפלטפורמה. למנהל/ת פלטפורמה בלבד.';

revoke all on function public.platform_cost_delete(bigint) from public, anon, authenticated;
grant execute on function public.platform_cost_delete(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. נתוני פתיחה — יולי עד ספטמבר 2026
--
-- נאספו מהתיבה tomerytz@gmail.com ב-1.10.2026, קבלה-קבלה. התאריך הוא
-- התאריך שבגוף הקבלה, כמו שהקליטה מהמייל קוראת אותו (`cost-mail.ts`).
-- שלוש שורות של Netlify אין להן קבלה במייל ונלקחו מרשימת
-- החיובים במסך החיוב של Netlify; הן בלי מספר חשבונית.
--
-- ‏**מה לא נכנס, ולמה:** ‏Google Cloud (‏Gemini) — יש רק התראות על חוב, לא
-- קבלות; ‏Twilio — לא נמצאה קבלה. שניהם מוזנים ידנית מהפאנל. ‏Meta —
-- הסכום ב-PDF, ולכן השורות נכנסות כממתינות בלי סכום.
--
-- ‏`on conflict do nothing` על מספר החשבונית: הרצה חוזרת, או קבלה שכבר
-- נקלטה מהמייל, אינן מכפילות.
-- ---------------------------------------------------------------------------
insert into public.platform_costs
  (service, charged_on, amount, currency, invoice_no, description, status, source)
values
  -- Netlify: טעינות קרדיטים אוטומטיות ($10) והמסלול ($20 לחודש)
  ('netlify', '2026-08-09',  10.00, 'USD', 'NWIXDA-00006', 'Credit purchase', 'confirmed', 'backfill'),
  ('netlify', '2026-08-10',  10.00, 'USD', 'NWIXDA-00007', 'Credit purchase', 'confirmed', 'backfill'),
  ('netlify', '2026-09-06',  20.00, 'USD', 'NWIXDA-00008', '3000 credits per month', 'confirmed', 'backfill'),
  ('netlify', '2026-09-06',  10.00, 'USD', 'NWIXDA-00009', 'Credit purchase', 'confirmed', 'backfill'),
  ('netlify', '2026-09-07',  10.00, 'USD', 'NWIXDA-00010', 'Credit purchase', 'confirmed', 'backfill'),
  ('netlify', '2026-09-10',  10.00, 'USD', 'NWIXDA-00013', 'Credit purchase', 'confirmed', 'backfill'),
  ('netlify', '2026-09-11',  10.00, 'USD', 'NWIXDA-00014', 'Auto top-up', 'confirmed', 'backfill'),
  ('netlify', '2026-09-11',  10.00, 'USD', 'NWIXDA-00015', 'Auto top-up', 'confirmed', 'backfill'),
  ('netlify', '2026-09-12',  10.00, 'USD', 'NWIXDA-00016', 'Auto top-up', 'confirmed', 'backfill'),
  ('netlify', '2026-09-12',  10.00, 'USD', 'NWIXDA-00017', 'Auto top-up', 'confirmed', 'backfill'),
  ('netlify', '2026-09-13',  10.00, 'USD', 'NWIXDA-00018', 'Auto top-up', 'confirmed', 'backfill'),
  ('netlify', '2026-09-13',  10.00, 'USD', 'NWIXDA-00019', 'Auto top-up', 'confirmed', 'backfill'),
  ('netlify', '2026-09-14',  10.00, 'USD', 'NWIXDA-00020', 'Auto top-up', 'confirmed', 'backfill'),
  ('netlify', '2026-09-14',  10.00, 'USD', 'NWIXDA-00021', 'Auto top-up', 'confirmed', 'backfill'),
  ('netlify', '2026-09-15',  10.00, 'USD', 'NWIXDA-00022', 'Auto top-up', 'confirmed', 'backfill'),
  ('netlify', '2026-09-15',  10.00, 'USD', 'NWIXDA-00023', 'Auto top-up', 'confirmed', 'backfill'),
  ('netlify', '2026-09-16',  10.00, 'USD', 'NWIXDA-00024', 'Auto top-up', 'confirmed', 'backfill'),
  ('netlify', '2026-09-17',  10.00, 'USD', 'NWIXDA-00025', 'Auto top-up', 'confirmed', 'backfill'),
  ('netlify', '2026-09-17',  10.00, 'USD', 'NWIXDA-00026', 'Auto top-up', 'confirmed', 'backfill'),
  ('netlify', '2026-09-18',  10.00, 'USD', 'NWIXDA-00027', 'Auto top-up', 'confirmed', 'backfill'),
  ('netlify', '2026-09-18',  10.00, 'USD', 'NWIXDA-00028', 'Auto top-up', 'confirmed', 'backfill'),
  ('netlify', '2026-09-19',  10.00, 'USD', 'NWIXDA-00029', 'Auto top-up', 'confirmed', 'backfill'),
  ('netlify', '2026-09-20',  10.00, 'USD', 'NWIXDA-00030', 'Auto top-up', 'confirmed', 'backfill'),
  ('netlify', '2026-09-20',  10.00, 'USD', 'NWIXDA-00031', 'Auto top-up', 'confirmed', 'backfill'),
  ('netlify', '2026-09-21',  10.00, 'USD', 'NWIXDA-00032', 'Auto top-up', 'confirmed', 'backfill'),
  ('netlify', '2026-09-21',  10.00, 'USD', 'NWIXDA-00033', 'Auto top-up', 'confirmed', 'backfill'),
  ('netlify', '2026-09-22',  10.00, 'USD', 'NWIXDA-00034', 'Auto top-up', 'confirmed', 'backfill'),
  ('netlify', '2026-09-22',  10.00, 'USD', 'NWIXDA-00035', 'Auto top-up', 'confirmed', 'backfill'),
  ('netlify', '2026-09-23',  10.00, 'USD', 'NWIXDA-00036', 'Auto top-up', 'confirmed', 'backfill'),
  ('netlify', '2026-09-23',  10.00, 'USD', 'NWIXDA-00037', 'Auto top-up', 'confirmed', 'backfill'),
  ('netlify', '2026-09-24',  10.00, 'USD', 'NWIXDA-00038', 'Auto top-up', 'confirmed', 'backfill'),
  ('netlify', '2026-09-25', 100.05, 'USD', 'NWIXDA-00040', 'Credit purchase', 'confirmed', 'backfill'),
  ('netlify', '2026-09-28',  10.00, 'USD', 'NWIXDA-00039', 'Auto top-up', 'confirmed', 'backfill'),
  -- fal.ai: קרדיטים לסרטוני נכסים
  ('fal_ai', '2026-09-07',  25.00, 'USD', 'HPNZTQ-00001', 'Credits', 'confirmed', 'backfill'),
  ('fal_ai', '2026-09-09', 100.00, 'USD', 'HPNZTQ-00002', 'Credits', 'confirmed', 'backfill'),
  -- Supabase: מסלול Pro
  ('supabase', '2026-09-16', 25.00, 'USD', 'PJNNHH-00004', 'Pro plan', 'confirmed', 'backfill'),
  -- Claude API: קרדיטים חד-פעמיים
  ('anthropic_api', '2026-08-14',  20.00, 'USD', 'QEKGK6A2-0002', 'One-time credit purchase', 'confirmed', 'backfill'),
  ('anthropic_api', '2026-09-22', 100.00, 'USD', 'QEKGK6A2-0003', 'One-time credit purchase', 'confirmed', 'backfill'),
  -- Make.com: המסלול וקרדיטים נוספים
  ('make', '2026-09-03', 10.59, 'USD', 'PS9XONZU-0001', 'Core plan (10,000 credits / month)', 'confirmed', 'backfill'),
  ('make', '2026-09-11', 13.25, 'USD', 'PS9XONZU-0002', '10,000 extra credits', 'confirmed', 'backfill'),
  -- OpenAI: טעינת קרדיט (Whisper). אין מספר חשבונית במייל.
  ('openai', '2026-08-17', 20.00, 'USD', 'openai-2026-08-17', 'API credit balance', 'confirmed', 'backfill'),
  -- מנוי Claude (Claude Code) דרך Google Play
  ('claude_subscription', '2026-07-09',  88.00, 'ILS', 'GPA-2026-07-09', 'Claude Pro', 'confirmed', 'backfill'),
  ('claude_subscription', '2026-08-09',  88.00, 'ILS', 'GPA.3309-0629-0926-75028..0', 'Claude Pro', 'confirmed', 'backfill'),
  ('claude_subscription', '2026-08-26', 550.00, 'ILS', 'GPA.3374-1699-0672-36815', 'Claude Max (שדרוג)', 'confirmed', 'backfill'),
  ('claude_subscription', '2026-09-28', 370.00, 'ILS', 'GPA.3374-1699-0672-36815..0', 'Claude Max', 'confirmed', 'backfill'),
  -- דומיינים (box.co.il)
  ('domain', '2026-07-23', 267.00, 'ILS', 'box-nadlan-afula.co.il-2026', 'nadlan-afula.co.il', 'confirmed', 'backfill'),
  ('domain', '2026-08-19', 267.00, 'ILS', 'box-shuknadlan.co.il-2026', 'shuknadlan.co.il', 'confirmed', 'backfill'),
  -- Meta: הסכום ב-PDF המצורף — ממתין להשלמה
  ('meta', '2026-07-10', null, 'USD', '331612122', 'Meta Invoice - הסכום ב-PDF', 'pending', 'backfill'),
  ('meta', '2026-08-10', null, 'USD', '345421216', 'Meta Invoice - הסכום ב-PDF', 'pending', 'backfill'),
  ('meta', '2026-09-10', null, 'USD', '359329913', 'Meta Invoice - הסכום ב-PDF', 'pending', 'backfill')
on conflict do nothing;

-- שלושה חיובים של Netlify שאין להם קבלה במייל — בלי מספר חשבונית, ולכן
-- ההגנה מכפילות היא בדיקה מפורשת ולא `on conflict`.
insert into public.platform_costs
  (service, charged_on, amount, currency, description, status, source)
select v.service, v.charged_on::date, v.amount, 'USD', v.description, 'confirmed', 'backfill'
  from (values
    ('netlify', '2026-07-28',  9.00, 'מרשימת החיובים של Netlify (אין קבלה במייל)'),
    ('netlify', '2026-08-05', 20.00, 'מרשימת החיובים של Netlify (אין קבלה במייל)'),
    ('netlify', '2026-09-08', 33.00, 'מרשימת החיובים של Netlify (אין קבלה במייל)')
  ) as v(service, charged_on, amount, description)
 where not exists (
   select 1 from public.platform_costs c
    where c.service = v.service
      and c.charged_on = v.charged_on::date
      and c.amount = v.amount
      and c.invoice_no is null
 );
