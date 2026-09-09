-- ============================================================================
-- מצב ההדמיה נשמר על השורה
--
-- נכס למכירה מקבל הדמיית שיפוץ ונכס להשכרה מקבל הלבשת בית (ראו RenderMode
-- ב-supabase/functions/_shared/visualization.ts). עד כאן המצב היה נגזר בזמן
-- הבקשה ולא נשמר בשום מקום, ולכן **נכס שהוחלף בו `deal_type` המשיך להציג
-- את ההדמיות הישנות**: דירה שעברה ממכירה להשכרה הראתה לשוכר/ת מטבח משופץ
-- שלא יהיה שם. זו בדיוק ההטעיה שהמצב הזה נועד למנוע.
--
-- ‏`mode` על השורה הופך את זה לניתן לבדיקה. שלושה דברים נשענים עליו:
--
--   1. **מפתח הייחודיות** כולל אותו — הדמיית סלון-שיפוץ והדמיית סלון-הלבשה
--      הן שתי תמונות שונות של אותו חדר, ולא התנגשות.
--   2. **שני ה-view הפומביים** מציגים רק שורות שמצבן תואם ל-`deal_type`
--      הנוכחי של הנכס. שורה שהתיישנה אינה נמחקת — היא פשוט מפסיקה להיות
--      פומבית, וחוזרת מאליה אם העסקה תוחזר למה שהייתה.
--   3. **טריגר על `deal_type`** רושם את הנכס לתור המילוי הקיים, כדי
--      שההדמיות במצב החדש ייווצרו בלי שאיש יזכור לבקש.
--
-- שורות קיימות מקבלות 'renovation', וזה נכון עובדתית: כולן נוצרו בדוקטרינת
-- השיפוץ. נכס להשכרה שכבר יש לו הדמיות כאלה יפסיק להציג אותן ויקבל חדשות —
-- ראו חלק 6.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. הפונקציה שקובעת את המצב
--
-- מקור אמת אחד בצד ה-DB, מקביל ל-renderModeFor שב-TypeScript. שתי הגדרות
-- ל"מה זה נכס להשכרה" היו נפרדות ביום שבו אחת מהן משתנה.
-- ---------------------------------------------------------------------------
create or replace function public.visualization_render_mode(p_deal_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_deal_type = 'rent' then 'staging' else 'renovation' end;
$$;

comment on function public.visualization_render_mode(text) is
  'מצב ההדמיה לפי סוג העסקה: rent → staging (הלבשת בית), אחרת renovation (שיפוץ).';

grant execute on function public.visualization_render_mode(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. העמודה
-- ---------------------------------------------------------------------------
alter table public.property_visualizations
  add column if not exists mode text not null default 'renovation';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.property_visualizations'::regclass
      and conname  = 'property_visualizations_mode_check'
  ) then
    alter table public.property_visualizations
      add constraint property_visualizations_mode_check
      check (mode in ('renovation', 'staging'));
  end if;
end $$;

comment on column public.property_visualizations.mode is
  'renovation = הדמיית שיפוץ (נכס למכירה) · staging = הלבשת בית, ריהוט בלבד (נכס להשכרה). נגזר מ-deal_type בזמן היצירה.';

-- ---------------------------------------------------------------------------
-- 3. מפתח הייחודיות
--
-- אותו חדר באותו סגנון בשני מצבים הוא שתי תמונות שונות. בלי זה, נכס שהוחלף
-- בו deal_type היה מתנגש באינדקס במקום לייצר את הסט החדש.
-- ---------------------------------------------------------------------------
drop index if exists public.property_visualizations_private_key;

create unique index if not exists property_visualizations_private_key
  on public.property_visualizations (property_id, target, style_key, mode)
  where kind = 'private_room';

-- ---------------------------------------------------------------------------
-- 4. הסט הפומבי — רק מה שתואם לעסקה הנוכחית
--
-- ‏join ל-properties נוסף כאן רק בשביל deal_type; רשימת העמודות של ה-view
-- לא השתנתה, ולכן create or replace עובר.
--
-- הסינון חל על הדמיות פרטיות בלבד. להדמיה מסחרית אין "מצב" — היא נגזרת
-- מסוג העסק ולא מסוג העסקה — והיא נושאת 'renovation' כברירת מחדל; בלי
-- החריג הזה חנות **להשכרה** הייתה מאבדת את ההדמיות שלה בבת אחת.
-- ---------------------------------------------------------------------------
create or replace view public.property_visualizations_public as
select
  v.id,
  v.property_id,
  v.kind,
  v.target,
  v.style_key,
  v.source_image_url,
  v.result_url,
  v.created_at
from public.property_visualizations v
join public.properties p on p.id = v.property_id
where v.is_base = true
  and v.status = 'done'
  and v.result_url is not null
  and (v.kind <> 'private_room'
       or v.mode = public.visualization_render_mode(p.deal_type))
  and public.property_visualizations_enabled(v.property_id);

comment on view public.property_visualizations_public is
  'הדמיות הבסיס של נכסי Premium פעילים — מה שמוצג בגלריית דף הנכס. רק הדמיות שמצבן תואם ל-deal_type הנוכחי. ללא הדמיות לפי-דרישה של גולשים.';

grant select on public.property_visualizations_public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. גלריית "הופקו לאחרונה" — אותו סינון
--
-- זה גם ה-view שדף הנכס עצמו שולף ממנו את הרצועה, ולכן הסינון כאן הוא מה
-- שמונע מהדמיית שיפוץ ישנה להופיע בדף של נכס שעכשיו מושכר.
-- ---------------------------------------------------------------------------
create or replace view public.property_visualizations_recent as
select
  v.property_id,
  v.kind,
  v.target,
  v.style_key,
  v.source_image_url,
  v.result_url,
  v.is_base,
  v.created_at
from public.property_visualizations v
join public.properties p on p.id = v.property_id
where v.status = 'done'
  and v.result_url is not null
  and p.status = 'active'
  and (v.kind <> 'private_room'
       or v.mode = public.visualization_render_mode(p.deal_type))
  and public.property_visualizations_enabled(v.property_id);

comment on view public.property_visualizations_recent is
  'כל ההדמיות המוכנות של נכסים פעילים וזכאים, במצב שתואם ל-deal_type הנוכחי — כולל אלה שנוצרו לפי דרישה. מזין את גלריית "הופקו לאחרונה". ללא job_id וללא error_detail.';

grant select on public.property_visualizations_recent to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. שינוי deal_type מזמין סט חדש
--
-- אותה דוקטרינה של שדרוג ה-tier: הטריגר רק **רושם** לתור הקיים, ו-pg_cron
-- מרוקן אותו בקצב קבוע. כאן זה גם ויסות עלות — שינוי deal_type המוני
-- (ייבוא, תיקון נתונים) לא יפתח עשרות קריאות Gemini בבת אחת.
--
-- הטריגר לא יורה על נכס שאין לו הדמיות במצב הישן: אין שם מה להחליף, ואין
-- סיבה שהחלפת סוג עסקה תזמין הדמיות לנכס שממילא לא ביקש אותן.
-- ---------------------------------------------------------------------------
create or replace function public.properties_enqueue_visualization_mode_refresh()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deal_type is not distinct from old.deal_type then
    return null;
  end if;

  if new.category <> 'residential'
     or public.is_land_property_type(new.property_type)
     or coalesce(array_length(new.images, 1), 0) = 0
     or not public.property_visualizations_enabled(new.id) then
    return null;
  end if;

  -- יש בכלל מה להחליף?
  if not exists (
    select 1
    from public.property_visualizations v
    where v.property_id = new.id
      and v.kind = 'private_room'
      and v.mode <> public.visualization_render_mode(new.deal_type)
  ) then
    return null;
  end if;

  insert into public.visualization_backfill_queue (property_id, agent_id, reason)
  values (new.id, new.agent_id, 'deal_type_change')
  on conflict (property_id) do update
    set status       = 'pending',
        attempts     = 0,
        queued_at    = now(),
        processed_at = null,
        reason       = 'deal_type_change'
    where public.visualization_backfill_queue.status <> 'pending';

  return null;
exception when others then
  -- כמו בשני הטריגרים האחרים של המנגנון: תקלה בהדמיות היא תקלה בפיצ'ר
  -- שיווקי, ואסור לה למנוע מסוכן/ת לשנות נכס ממכירה להשכרה.
  raise warning 'properties_enqueue_visualization_mode_refresh נכשל לנכס %: %', new.id, sqlerrm;
  return null;
end;
$$;

comment on function public.properties_enqueue_visualization_mode_refresh() is
  'שינוי deal_type בנכס שיש לו הדמיות במצב הישן רושם אותו לתור מילוי ההדמיות.';

revoke all on function public.properties_enqueue_visualization_mode_refresh() from public;
revoke all on function public.properties_enqueue_visualization_mode_refresh() from anon, authenticated;

drop trigger if exists properties_enqueue_visualization_mode_refresh on public.properties;
create trigger properties_enqueue_visualization_mode_refresh
  after update of deal_type on public.properties
  for each row execute function public.properties_enqueue_visualization_mode_refresh();

comment on trigger properties_enqueue_visualization_mode_refresh on public.properties is
  'מעבר בין מכירה להשכרה מזמין סט הדמיות חדש במצב המתאים (מודול ההדמיות).';

-- ---------------------------------------------------------------------------
-- 7. הנכסים שכבר במצב הזה
--
-- נכסי השכרה שיש להם היום סט בסיס בדוקטרינת השיפוץ. מרגע המיגרציה הם לא
-- מוצגים (חלק 4–5), ולכן הם נרשמים לתור כדי שיקבלו סט בהלבשת בית. הרישום
-- לא עולה כלום בפני עצמו — ה-cron מרוקן חמישה כל חמש דקות, והזכאות נבדקת
-- שוב בזמן הריקון.
-- ---------------------------------------------------------------------------
insert into public.visualization_backfill_queue (property_id, agent_id, reason)
select distinct p.id, p.agent_id, 'deal_type_change'
from public.properties p
join public.property_visualizations v
  on v.property_id = p.id
 and v.kind = 'private_room'
 and v.mode <> public.visualization_render_mode(p.deal_type)
where p.category = 'residential'
  and coalesce(array_length(p.images, 1), 0) > 0
  and not public.is_land_property_type(p.property_type)
  and public.property_visualizations_enabled(p.id)
on conflict (property_id) do update
  set status       = 'pending',
      attempts     = 0,
      queued_at    = now(),
      processed_at = null,
      reason       = 'deal_type_change'
  where public.visualization_backfill_queue.status <> 'pending';
