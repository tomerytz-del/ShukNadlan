-- תיקון בדיקת "האם הקובץ עוד בשימוש" לפני מחיקה מהאחסון, ועצירת ניסיונות מחיקה אינסופיים.
-- הפונקציה הישנה קיבלה כתובת אחת ולא ראתה את גלריית המשרד ושל הסוכן/ת
-- (jsonb), ולכן קובץ שעוד מוצג שם יכול היה להימחק. החדשה מקבלת את כל
-- צורות הכתובת (עם ובלי פרמטר גרסה, מקודדת ומפוענחת) בקריאה אחת.
-- מיגרציה חדשה: את הקובץ 20271031150000 לא משנים.
--
-- סדר פריסה: הקוד סובל את היעדר הפונקציה החדשה (שגיאה = "עוד בשימוש", כלומר
-- לא מוחקים), והעמודה cleanup_attempts נדרשת רק לסבב הניקוי.

alter table public.property_image_relocations
  add column if not exists cleanup_attempts smallint not null default 0;

comment on column public.property_image_relocations.cleanup_attempts is
  'כמה פעמים מחיקת קובץ המקור נכשלה. אחרי 5 לא מנסים שוב. cleaned_at נכתב רק כשהמחיקה הצליחה.';

-- נדרשת לפונקציה שלמטה. בפרודקשן העמודה קיימת, ובסביבה חדשה אין מי שיצר אותה.
alter table public.agencies
  add column if not exists gallery jsonb not null default '[]'::jsonb;

drop function if exists public.property_image_still_used(text, uuid);

create or replace function public.property_image_still_used(p_urls text[], p_except uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_urls is null or cardinality(p_urls) = 0 then true
    else (
    exists (
      select 1 from public.properties p
       where (
           (p_except is null or p.id is distinct from p_except)
           and p.images && p_urls
         )
          or p.marketing_image = any(p_urls)
          or p.video_url = any(p_urls)
          or p.video_poster_url = any(p_urls)
    )
    or exists (
      select 1 from public.whatsapp_conversations c
       where c.pending_images && p_urls
    )
    or exists (
      select 1 from public.property_visualizations v
       where v.source_image_url = any(p_urls) or v.result_url = any(p_urls)
    )
    or exists (
      select 1 from public.property_image_tags t
       where t.image_url = any(p_urls)
    )
    or exists (
      select 1 from public.property_video_clips c
       where c.source_image_url = any(p_urls)
    )
    or exists (
      select 1 from public.property_video_jobs j
       where j.cover_url = any(p_urls) or j.result_url = any(p_urls) or j.previous_video_url = any(p_urls)
    )
    or exists (
      select 1 from public.ad_placements a
       where a.creative_url = any(p_urls)
          or a.cover_url = any(p_urls)
          or a.gallery_urls && p_urls
    )
    or exists (
      select 1 from public.agency_members m
       where m.photo_url = any(p_urls)
          or m.cover_url = any(p_urls)
          or exists (
            select 1
              from jsonb_array_elements(
                case when jsonb_typeof(m.gallery) = 'array' then m.gallery else '[]'::jsonb end
              ) e
             where e->>'url' = any(p_urls)
          )
    )
    or exists (
      select 1 from public.agencies a
       where a.logo_url = any(p_urls)
          or a.cover_url = any(p_urls)
          or exists (
            select 1
              from jsonb_array_elements(
                case when jsonb_typeof(a.gallery) = 'array' then a.gallery else '[]'::jsonb end
              ) e
             where e->>'url' = any(p_urls)
          )
    )
    or exists (
      select 1 from public.articles a
       where a.cover_url = any(p_urls)
    )
    )
  end;
$$;

revoke all on function public.property_image_still_used(text[], uuid) from public, anon, authenticated;
grant execute on function public.property_image_still_used(text[], uuid) to service_role;
