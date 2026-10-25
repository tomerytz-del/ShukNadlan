-- ===========================================================================
-- השקה מושהית של חבילת הקמפיינים במטא (24.10.2026)
--
-- ‏create_campaign רושם קמפיין אחד וסט אחד ב-ads_campaigns, והסט והמודעות
-- נוצרים ACTIVE בכוונה. חבילת ההשקה היא כמה קמפיינים, והכל חייב להיוולד
-- PAUSED. הטבלה כאן היא מפתח האידמפוטנטיות: (launch_key, object_key) →
-- המזהה שכבר נוצר במטא. הרצה שנייה מדלגת, ולא נפתח קמפיין כפול.
--
-- למה לא ads_actions_log לבד: היומן הוא append-only. שורה שנכשלה ושורת
-- הצלחה יושבות זו ליד זו, ואין מפתח שאפשר לעדכן. למה לא ads_campaigns:
-- השורה שם היא קמפיין אחד עם סט אחד.
--
-- הדלי marketing-creatives פרטי. ads-admin קוראת ממנו עם service_role,
-- בודקת sha256, ורק אז מעלה ל-adimages. הקבצים עצמם בריפו תחת
-- marketing/meta-creatives/ (לא נגישים מהאתר).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. מה כבר נוצר במטא
-- ---------------------------------------------------------------------------
create table if not exists public.ads_launch_objects (
  launch_key  text not null,
  object_key  text not null,
  kind        text not null,
  meta_id     text,
  image_hash  text,
  name        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (launch_key, object_key)
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ads_launch_objects_kind_check') then
    alter table public.ads_launch_objects add constraint ads_launch_objects_kind_check
      check (kind in ('image', 'audience', 'campaign', 'adset', 'creative', 'ad'));
  end if;
end $$;

comment on table public.ads_launch_objects is
  'מזהים שנוצרו בהשקת הקמפיינים המושהים. המפתח הוא launch_key ו-object_key, והרצה חוזרת מדלגת על שורה שכבר יש לה meta_id או image_hash. הכתיבה רק מ-ads-admin.';

alter table public.ads_launch_objects enable row level security;

drop policy if exists "platform admin reads launch objects" on public.ads_launch_objects;
create policy "platform admin reads launch objects" on public.ads_launch_objects
  for select to authenticated using (public.current_is_platform_admin());

revoke all on table public.ads_launch_objects from anon;
grant select on table public.ads_launch_objects to authenticated;
grant select, insert, update, delete on table public.ads_launch_objects to service_role;

-- ---------------------------------------------------------------------------
-- 2. יומן: סוגי האובייקטים של ההשקה
--
-- ‏launch הוא שורת הסיכום (גם dry-run). image ו-audience הם מה שההשקה
-- יוצרת ו-create_campaign לא יצרה.
-- ---------------------------------------------------------------------------
alter table public.ads_actions_log drop constraint if exists ads_actions_log_object_type_check;
alter table public.ads_actions_log add constraint ads_actions_log_object_type_check
  check (object_type is null or object_type in (
    'account', 'campaign', 'adset', 'ad', 'creative', 'lead_form', 'post', 'video',
    'launch', 'audience', 'image'
  ));

-- ---------------------------------------------------------------------------
-- 3. דלי הקריאייטיב
--
-- פרטי: מטא מקבלת את הבייטים מ-ads-admin, לא כתובת ציבורית. 8MB מספיק
-- לתמונות החבילה (הכבדה שבהן היא כ-1.5MB).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'marketing-creatives', 'marketing-creatives', false, 8388608,
  array['image/png', 'image/jpeg']
)
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "platform admin reads marketing creatives" on storage.objects;
create policy "platform admin reads marketing creatives"
  on storage.objects for select to authenticated
  using (bucket_id = 'marketing-creatives' and public.current_is_platform_admin());

drop policy if exists "platform admin uploads marketing creatives" on storage.objects;
create policy "platform admin uploads marketing creatives"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'marketing-creatives' and public.current_is_platform_admin());

drop policy if exists "platform admin updates marketing creatives" on storage.objects;
create policy "platform admin updates marketing creatives"
  on storage.objects for update to authenticated
  using (bucket_id = 'marketing-creatives' and public.current_is_platform_admin())
  with check (bucket_id = 'marketing-creatives' and public.current_is_platform_admin());

drop policy if exists "platform admin deletes marketing creatives" on storage.objects;
create policy "platform admin deletes marketing creatives"
  on storage.objects for delete to authenticated
  using (bucket_id = 'marketing-creatives' and public.current_is_platform_admin());
