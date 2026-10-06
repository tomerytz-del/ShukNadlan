-- ============================================================================
-- מנוע המדיה — שלב 0: התור, הדלי וה-cron
--
-- עד היום כל עיבוד הווידאו רץ אצל fal.ai, כי ל-Edge Function של Deno אין
-- ffmpeg. שלושה דברים חסרו בגלל זה: Reels עם מחיר ולוגו, חיתוך של קליפים
-- (נמדד: fal אינו יודע לחתוך), ותמונת פתיחה ודחיסה לסרטונים באתר. התכנית:
-- docs/media-worker-plan.md, והמנגנון: docs/media-worker.md.
--
-- מה נכנס כאן:
--   1. ‏media_renders — בקשת רינדור אחת. כל מקור (cron, Edge Function, טריגר
--      עתידי) רק מכניס שורה; את השאר עושה media-render.
--   2. ‏claim_media_render() — המנוע ב-GitHub Actions לוקח בקשה אחת בכל פעם,
--      בנעילה (skip locked), כך ששתי ריצות במקביל לא לוקחות את אותה בקשה.
--   3. דלי ציבורי media-renders לתוצרים.
--   4. ‏cron כל 2 דקות שקורא ל-media-render?mode=dispatch — **רק כשיש בקשה
--      פתוחה**, כמו ב-20261021090000. הספים (מתי בקשה נחשבת תקועה) נשארים
--      בשרת בלבד, מאותה סיבה שכתובה שם: קבוע בשני מקומות מתפצל.
--
-- **אין כאן אף טריגר שמכניס בקשות.** בשלב 0 בקשה נוצרת ידנית (‏SQL של
-- מנהל/ת), כדי להוכיח את הצינור לפני שמשהו בפרודקשן תלוי בו. שלב 1 מוסיף את
-- הטריגר על properties.video_url.
-- ============================================================================

create table if not exists public.media_renders (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null,
  property_id   uuid references public.properties(id) on delete cascade,
  -- בלי מפתח זר בכוונה: בקשה של קמפיין (שלב 5) אינה שייכת לסוכן/ת אחד/ת,
  -- והטבלה אינה נכנסת ל-embed של agency_members.
  agent_id      uuid,
  status        text not null default 'queued',
  -- מה המנוע צריך: כתובות מקור, ומחרוזות שכבר עוצבו בשרת (מחיר, מפרט).
  -- המנוע לא יודע מה זה מחיר — ראו "החלטה 2" ב-media-worker-plan.md.
  input         jsonb not null default '{}'::jsonb,
  output_path   text,
  output_url    text,
  -- מה ש-ffprobe מדד על התוצר: ממדים, אורך, משקל. התוצר נבדק ולא מונח.
  output_meta   jsonb,
  -- ל-Reel (שלב 2): טביעת האצבע של מה שצרוב בו, כדי לזהות שהוא התיישן.
  fingerprint   text,
  attempts      int not null default 0,
  last_error    text,
  dispatched_at timestamptz,
  started_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'media_renders_kind_check') then
    alter table public.media_renders add constraint media_renders_kind_check
      check (kind in ('poster', 'compress', 'reel', 'merge'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'media_renders_status_check') then
    alter table public.media_renders add constraint media_renders_status_check
      check (status in ('queued', 'rendering', 'done', 'failed'));
  end if;
end $$;

-- בקשה פתוחה אחת לכל נכס ולכל סוג: לחיצה כפולה או טריגר שנורה פעמיים לא
-- מרנדרים פעמיים.
create unique index if not exists media_renders_one_open
  on public.media_renders (property_id, kind)
  where status in ('queued', 'rendering') and property_id is not null;

create index if not exists media_renders_open_idx
  on public.media_renders (status, created_at)
  where status in ('queued', 'rendering');

create index if not exists media_renders_property_idx
  on public.media_renders (property_id, kind, created_at desc);

-- ‏RLS בלי מדיניות: רק service_role (‏Edge Functions) קורא וכותב. תצוגה
-- לסוכנים תגיע בשלב 2 דרך פונקציה עם בדיקת קורא/ת.
alter table public.media_renders enable row level security;

-- ---------------------------------------------------------------------------
-- לקיחת בקשה
--
-- ‏for update skip locked: שתי ריצות של Actions במקביל (cron שהעיר פעמיים,
-- או ריצה ידנית) מקבלות בקשות שונות ולא את אותה אחת. הבקשה עוברת ל-rendering
-- וה-attempts עולה באותה פקודה, כך שאין רגע שבו היא "נלקחה" ועדיין queued.
-- ---------------------------------------------------------------------------
create or replace function public.claim_media_render()
returns public.media_renders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.media_renders;
begin
  select * into v_row
    from public.media_renders
   where status = 'queued'
   order by created_at
   limit 1
   for update skip locked;

  if not found then
    return null;
  end if;

  update public.media_renders
     set status = 'rendering',
         attempts = attempts + 1,
         started_at = now(),
         updated_at = now()
   where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.claim_media_render() from public, anon, authenticated;
grant execute on function public.claim_media_render() to service_role;

-- ---------------------------------------------------------------------------
-- הדלי לתוצרים
--
-- דלי נפרד ולא property-videos: שם מותר וידאו בלבד, ותמונת פתיחה היא JPEG.
-- ציבורי, כי התוצרים מוצגים באתר ונשלחים לאינסטגרם בכתובת.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media-renders', 'media-renders', true, 104857600,
        array['image/jpeg', 'image/webp', 'image/png', 'video/mp4'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public read media renders" on storage.objects;
create policy "public read media renders"
  on storage.objects for select
  using (bucket_id = 'media-renders');

-- ---------------------------------------------------------------------------
-- ה-cron
--
-- ‏queued או rendering: יש מה לשגר, או שיש בקשה שאולי נתקעה. ההחלטה אם היא
-- כבר תקועה מספיק נשארת בשרת (‏STALE_* ב-media-render/index.ts).
-- ---------------------------------------------------------------------------
do $$
declare
  v_base text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן — אין מה לתזמן';
    return;
  end if;

  perform cron.unschedule('media-render-dispatch')
    where exists (select 1 from cron.job where jobname = 'media-render-dispatch');

  perform cron.schedule('media-render-dispatch', '*/2 * * * *', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1)))
    )
    where exists (
      select 1 from public.media_renders
       where status in ('queued', 'rendering')
    );
  $cron$, v_base || 'media-render?mode=dispatch'));
end $$;
