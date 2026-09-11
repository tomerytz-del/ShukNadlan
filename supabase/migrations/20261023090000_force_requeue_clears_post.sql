-- ===========================================================================
-- ‏force מנקה את זהות הפוסט הקודם
--
-- ‏`queue_property_publication(..., p_force := true)` מאפסת סטטוס, ניסיונות
-- ושגיאה — אבל משאירה את `post_id`, ‏`post_url` ו-`posted_at` של הפרסום
-- הקודם. ‏`mark_property_publication` כותבת אותם ב-`coalesce`, ולכן פרסום
-- חוזר שלא יחזיר מזהה משאיר על השורה את המזהה של פוסט אחר — לרוב כזה שכבר
-- נמחק מהדף.
--
-- זה סותר בדיוק את מה שמיגרציה 20261022090000 באה לקבוע: ש-`post_id` הוא
-- הראיה לפרסום. ראיה שנשארת משורה קודמת אינה ראיה.
--
-- **התגלה ב-11.9.2026**, בבדיקה חוזרת של אותו נכס: אחרי `force` השורה חזרה
-- ל-`pending` עם `attempts = 0` — ועם ה-`post_id` של הפוסט הקודם, שכבר נמחק
-- מהדף. אלמלא השוויתי מול הערך הישן, פרסום שלא היה מחזיר מזהה היה נראה
-- מאושר.
--
-- ## למה קובץ נפרד ולא תיקון במיגרציה 20261022090000
--
-- היא **כבר רצה בפרודקשן** (מוזגה ב-#233 ב-19:02 UTC). ‏`db push` מדלג על
-- version שכבר רשום ב-`supabase_migrations.schema_migrations`, ולכן שינוי
-- בתוך קובץ שכבר הוחל אינו מגיע למסד לעולם — הוא רק יוצר פער שקט בין מה
-- שכתוב בריפו למה שרץ. ‏version חדש הוא הדרך היחידה.
--
-- שאר הפונקציה זהה למקור (מיגרציה 20260906092000 §3).
--
-- אידמפוטנטית.
-- ===========================================================================

create or replace function public.queue_property_publication(
  p_property_id uuid,
  p_channel     text default 'facebook_page',
  p_force       boolean default false,
  p_delay_minutes int default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delay int;
  v_id    uuid;
begin
  if not exists (select 1 from public.properties where id = p_property_id) then
    return null;
  end if;

  v_delay := coalesce(
    p_delay_minutes,
    (select value::int from public.pricing_config
      where key = 'facebook_autopost_delay_minutes'),
    20);

  insert into public.property_publications (property_id, channel, publish_after)
  values (p_property_id, p_channel, now() + make_interval(mins => greatest(v_delay, 0)))
  on conflict (property_id, channel) do update
    set status        = case when p_force then 'pending' else public.property_publications.status end,
        attempts      = case when p_force then 0 else public.property_publications.attempts end,
        last_error    = case when p_force then null else public.property_publications.last_error end,
        publish_after = case when p_force then now() else public.property_publications.publish_after end,
        post_id       = case when p_force then null else public.property_publications.post_id end,
        post_url      = case when p_force then null else public.property_publications.post_url end,
        posted_at     = case when p_force then null else public.property_publications.posted_at end
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.queue_property_publication(uuid, text, boolean, int) is
  'מכניסה נכס לתור הפרסום. נקודת הכניסה היחידה — לטריגר ולפרסום ידני חוזר. בלי p_force לא נוגעת בשורה קיימת; עם p_force מנקה גם את זהות הפוסט הקודם, כדי ש-post_id יישאר ראיה לפרסום הנוכחי בלבד.';

revoke all on function public.queue_property_publication(uuid, text, boolean, int) from public;
revoke all on function public.queue_property_publication(uuid, text, boolean, int) from anon, authenticated;
grant execute on function public.queue_property_publication(uuid, text, boolean, int) to service_role;
