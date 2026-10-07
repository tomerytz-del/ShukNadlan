-- ===========================================================================
-- קונסולת השיווק, שלב 5 — יצירת קמפיין מנוסח מאושר
-- ===========================================================================
--
-- ‏ads-admin (‏create_campaign) בונה במטא עץ שלם: קמפיין ← סט ← קריאייטיב
-- ומודעה לכל נוסח, מטיוטה מאושרת ב-ads_copy_drafts. הטבלה כאן היא מה שהסקיל
-- שומר כקובץ state: **כל אובייקט שנוצר נרשם מיד**, גם כשהיצירה נפלה באמצע,
-- כדי שעץ חלקי יוכל להימחק (‏discard_campaign) ולא להישאר יתום בחשבון.
--
-- ‏**הקמפיין נוצר מושהה; הסט והמודעות פעילים.** כך המתג היחיד הוא הקמפיין -
-- "הפעלה" בלשונית הביצועים (‏set_status, עם חלון אישור) - ושום דבר לא רץ עד
-- שתומר מדליק אותו. אילו כל העץ היה מושהה, הפעלת הקמפיין לבדה לא הייתה
-- מוציאה שקל, והפאנל היה מציג "פעיל" על קמפיין שאינו רץ.
--
-- ‏**תקרת תקציב.** ‏ads_settings.max_daily_budget (‏₪150 ליום) חלה על יצירה.
-- שינוי אחרי היצירה עובר ב-set_budget, שמוגבל לפי 2 בכל פעם.
-- ===========================================================================

create table if not exists public.ads_campaigns (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references public.agency_members(id) on delete set null,
  draft_id          uuid references public.ads_copy_drafts(id) on delete set null,
  audience          text not null,
  property_id       uuid references public.properties(id) on delete set null,
  name              text not null,
  destination       text not null,
  format            text not null,
  lead_form_id      text,
  daily_budget      numeric(10,2) not null,
  end_time          timestamptz,
  plan              jsonb not null default '{}'::jsonb,
  objects           jsonb not null default '[]'::jsonb,
  meta_campaign_id  text,
  status            text not null default 'creating',
  error             text
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ads_campaigns_audience_check') then
    alter table public.ads_campaigns add constraint ads_campaigns_audience_check
      check (audience in ('property', 'platform'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ads_campaigns_destination_check') then
    alter table public.ads_campaigns add constraint ads_campaigns_destination_check
      check (destination in ('lead_form', 'whatsapp', 'website'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ads_campaigns_format_check') then
    alter table public.ads_campaigns add constraint ads_campaigns_format_check
      check (format in ('image', 'carousel'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ads_campaigns_status_check') then
    alter table public.ads_campaigns add constraint ads_campaigns_status_check
      check (status in ('creating', 'created', 'failed', 'discarded'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ads_campaigns_budget_check') then
    alter table public.ads_campaigns add constraint ads_campaigns_budget_check
      check (daily_budget > 0);
  end if;
end $$;

create index if not exists ads_campaigns_created_idx on public.ads_campaigns (created_at desc);

comment on table public.ads_campaigns is
  'קמפיינים שנוצרו מהקונסולה (ads-admin create_campaign): התוכנית, וכל אובייקט שנוצר במטא - גם ביצירה שנפלה באמצע, כדי ש-discard_campaign ימחק עץ חלקי. docs/marketing-console.md';
comment on column public.ads_campaigns.objects is
  'מה שנוצר במטא, לפי הסדר: [{type: campaign|image|adset|creative|ad, id|hash, name}]';

alter table public.ads_campaigns enable row level security;
drop policy if exists "platform admin reads ads campaigns" on public.ads_campaigns;
create policy "platform admin reads ads campaigns" on public.ads_campaigns
  for select to authenticated using (public.current_is_platform_admin());
revoke all on public.ads_campaigns from anon;

insert into public.ads_settings (key, value, description) values
  ('max_daily_budget', '150'::jsonb,
   'תקרת התקציב היומי בשקלים לקמפיין שנוצר מהקונסולה. שינוי אחרי היצירה - set_budget, עד פי 2 בכל פעם'),
  ('platform_landing_path', '"/pricing"'::jsonb,
   'לאן מוביל קמפיין הפלטפורמה כשהיעד הוא האתר (נתיב באתר, בלי הדומיין)')
on conflict (key) do nothing;
