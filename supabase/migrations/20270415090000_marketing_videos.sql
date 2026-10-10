-- ===========================================================================
-- ספריית סרטוני השיווק — קונסולת השיווק, שלב 8 (docs/marketing-videos.md)
-- ===========================================================================
--
-- ‏**מה חסר היום.** הקונסולה יוצרת קמפיין מתמונה או מקרוסלה בלבד
-- (‏ads_campaigns_format_check), וסרטון שיווקי שהופק (למשל "מהשיחה לפגישה",
-- סרטון גיוס למתווכים) נשאר כקובץ בטלפון. אין מקום אחד שבו רואים מה כבר
-- הופק, לאיזה קהל, באיזה יחס מסך - ואין דרך לדעת איזה סרטון הביא לידים.
--
-- ‏**מה נכנס כאן:**
--   1. הדלי `marketing-videos` - ציבורי לקריאה (מטא מושכת את הסרטון לפי
--      כתובת, ‏file_url), וכתיבה למנהל/ת הפלטפורמה בלבד. סרטון ותמונת שער
--      (JPEG, נוצרת בדפדפן מהפריים של השנייה הראשונה - מטא דורשת תמונה
--      למודעת וידאו).
--   2. הטבלה `marketing_videos` - הקטלוג: קהל, מטרה (שיווק / הדרכה), יחס
--      מסך, אורך, ההוק והתסריט, ו**רעיון + גרסה** - שתי גרסאות של אותו רעיון
--      (הוק שונה, אורך שונה) הן ניסוי A/B. ‏RLS: קריאה למנהל/ת הפלטפורמה,
--      ובלי policy כתיבה - כמו כל טבלאות ads_*, הכתיבה עוברת ב-ads-admin.
--   3. ‏`ads_campaigns.format` מקבל `video`, ו-`ads_actions_log.object_type`
--      מקבל `video` (ההעלאה ל-advideos נרשמת ביומן כמו כל כתיבה למטא).
--   4. ‏`marketing_video_stats(p_days)` - הוצאה, חשיפות, קליקים ולידים לכל
--      סרטון, מ-ads_insights_daily ברמת המודעה. המיפוי מודעה ← סרטון יושב
--      ב-ads_campaigns.objects: ‏campaign.ts רושם `video_id` על כל מודעה.
--      ‏INVOKER: ה-RLS של שלוש הטבלאות הוא שסוגר אותה למנהל/ת.
--
-- הקובץ אידמפוטנטי.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. הדלי
--
-- ‏50MB - התקרה של הפרויקט כולו (‏20260903130000_property_video_upload.sql).
-- סרטון שיווקי של חצי דקה ב-1080p שוקל 5-10MB.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'marketing-videos', 'marketing-videos', true, 52428800,
  array['video/mp4', 'video/webm', 'video/quicktime', 'image/jpeg', 'image/png']
)
on conflict (id) do update
  set public             = true,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "marketing videos are publicly readable" on storage.objects;
create policy "marketing videos are publicly readable"
  on storage.objects for select
  using (bucket_id = 'marketing-videos');

drop policy if exists "platform admin uploads marketing videos" on storage.objects;
create policy "platform admin uploads marketing videos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'marketing-videos' and public.current_is_platform_admin());

drop policy if exists "platform admin updates marketing videos" on storage.objects;
create policy "platform admin updates marketing videos"
  on storage.objects for update to authenticated
  using (bucket_id = 'marketing-videos' and public.current_is_platform_admin())
  with check (bucket_id = 'marketing-videos' and public.current_is_platform_admin());

drop policy if exists "platform admin deletes marketing videos" on storage.objects;
create policy "platform admin deletes marketing videos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'marketing-videos' and public.current_is_platform_admin());

-- ---------------------------------------------------------------------------
-- 2. הקטלוג
-- ---------------------------------------------------------------------------
create table if not exists public.marketing_videos (
  id                     uuid primary key default gen_random_uuid(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by             uuid references public.agency_members(id) on delete set null,
  title                  text not null,
  purpose                text not null default 'marketing',
  audience               text not null,
  language               text not null default 'he',
  aspect                 text not null,
  width                  integer,
  height                 integer,
  duration_sec           numeric(6,2),
  storage_path           text not null,
  poster_path            text,
  hook                   text,
  script                 text,
  notes                  text,
  concept                text,
  variant                text,
  tags                   text[] not null default '{}',
  status                 text not null default 'ready',
  source                 jsonb not null default '{}'::jsonb,
  meta_video_id          text,
  meta_video_uploaded_at timestamptz
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'marketing_videos_purpose_check') then
    alter table public.marketing_videos add constraint marketing_videos_purpose_check
      check (purpose in ('marketing', 'tutorial'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'marketing_videos_audience_check') then
    alter table public.marketing_videos add constraint marketing_videos_audience_check
      check (audience in ('agents', 'buyers', 'sellers', 'renters', 'developers', 'professionals', 'general'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'marketing_videos_aspect_check') then
    alter table public.marketing_videos add constraint marketing_videos_aspect_check
      check (aspect in ('9:16', '4:5', '1:1', '16:9'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'marketing_videos_status_check') then
    alter table public.marketing_videos add constraint marketing_videos_status_check
      check (status in ('ready', 'archived'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'marketing_videos_storage_path_key') then
    alter table public.marketing_videos add constraint marketing_videos_storage_path_key unique (storage_path);
  end if;
end $$;

create index if not exists marketing_videos_list_idx on public.marketing_videos (status, audience, created_at desc);
create index if not exists marketing_videos_concept_idx on public.marketing_videos (concept) where concept is not null;

comment on table public.marketing_videos is
  'ספריית סרטוני השיווק וההדרכה של הפלטפורמה. הקבצים בדלי marketing-videos; הכתיבה דרך ads-admin (save_video, archive_video). docs/marketing-videos.md';
comment on column public.marketing_videos.concept is
  'הרעיון שהסרטון מממש. כמה סרטונים עם אותו רעיון וגרסה שונה (variant) הם ניסוי A/B - הלשונית מציגה אותם זה לצד זה';
comment on column public.marketing_videos.meta_video_id is
  'הסרטון כפי שהועלה לספריית חשבון המודעות (advideos). נשמר כדי שקמפיין שני לא יעלה אותו שוב';

alter table public.marketing_videos enable row level security;
drop policy if exists "platform admin reads marketing videos" on public.marketing_videos;
create policy "platform admin reads marketing videos" on public.marketing_videos
  for select to authenticated using (public.current_is_platform_admin());
revoke all on public.marketing_videos from anon;

-- ---------------------------------------------------------------------------
-- 3. וידאו בקמפיין ובכתיבה למטא
-- ---------------------------------------------------------------------------
alter table public.ads_campaigns drop constraint if exists ads_campaigns_format_check;
alter table public.ads_campaigns add constraint ads_campaigns_format_check
  check (format in ('image', 'carousel', 'video'));

alter table public.ads_actions_log drop constraint if exists ads_actions_log_object_type_check;
alter table public.ads_actions_log add constraint ads_actions_log_object_type_check
  check (object_type is null or object_type in ('account', 'campaign', 'adset', 'ad', 'creative', 'lead_form', 'post', 'video'));

comment on column public.ads_campaigns.objects is
  'מה שנוצר במטא, לפי הסדר: [{type: campaign|image|video|adset|creative|ad, id|hash, name, video_id?}]. ‏video_id על מודעה = marketing_videos.id';

-- ---------------------------------------------------------------------------
-- 4. ביצועים לכל סרטון
--
-- ‏p_days: חלון ימים אחורה מהיום (ברירת מחדל 90, כמו תקרת הסנכרון). מודעה
-- נספרת לסרטון לפי video_id שנרשם עליה ב-objects; קמפיין שנמחק מכאן
-- (‏discarded) עדיין נספר - ההוצאה שלו הייתה אמיתית.
-- ---------------------------------------------------------------------------
create or replace function public.marketing_video_stats(p_days integer default 90)
returns table (
  video_id     uuid,
  campaigns    integer,
  ads          integer,
  spend        numeric,
  impressions  bigint,
  link_clicks  bigint,
  leads        bigint,
  conversations bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with ad_map as (
    select (o->>'video_id')::uuid as video_id, o->>'id' as ad_id, c.id as campaign_row
      from ads_campaigns c
      cross join lateral jsonb_array_elements(c.objects) o
     where o->>'type' = 'ad'
       and coalesce(o->>'video_id', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  per_ad as (
    select i.object_id as ad_id,
           sum(i.spend) as spend, sum(i.impressions) as impressions, sum(i.link_clicks) as link_clicks,
           sum(i.leads) as leads, sum(i.conversations) as conversations
      from ads_insights_daily i
     where i.level = 'ad'
       and i.day >= current_date - greatest(1, least(coalesce(p_days, 90), 365))
     group by i.object_id
  )
  select v.id,
         count(distinct m.campaign_row)::integer,
         count(distinct m.ad_id)::integer,
         coalesce(sum(p.spend), 0)::numeric,
         coalesce(sum(p.impressions), 0)::bigint,
         coalesce(sum(p.link_clicks), 0)::bigint,
         coalesce(sum(p.leads), 0)::bigint,
         coalesce(sum(p.conversations), 0)::bigint
    from marketing_videos v
    left join ad_map m on m.video_id = v.id
    left join per_ad p on p.ad_id = m.ad_id
   group by v.id;
$$;

comment on function public.marketing_video_stats(integer) is
  'הוצאה, חשיפות, קליקים, לידים ושיחות לכל סרטון בספרייה, לפי המודעות שנוצרו ממנו (ads_campaigns.objects). INVOKER - ה-RLS סוגר אותה למנהל/ת הפלטפורמה';

revoke all on function public.marketing_video_stats(integer) from public, anon, authenticated;
grant execute on function public.marketing_video_stats(integer) to authenticated, service_role;
