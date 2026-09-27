-- ============================================================================
-- פרסום אוטומטי גם לחשבון האינסטגרם — ערוץ שני בתור property_publications
--
-- ‏`channel` קיים בטבלה מהיום הראשון בדיוק בשביל זה (‏20260906092000, §2),
-- וה-unique הוא (property_id, channel). לכן אינסטגרם נכנס כ**שורה נפרדת**
-- לכל נכס, ולא כעוד מודול בתרחיש הפייסבוק. זו ההחלטה המרכזית כאן:
--
--   אילו אינסטגרם היה יושב באותו תרחיש Make אחרי מודול הפייסבוק, כישלון שלו
--   (תמונה ביחס שאינסטגרם דוחה, טוקן שפג) היה מפיל את כל ההרצה אחרי
--   שהפוסט בפייסבוק כבר עלה — השרת היה רואה כישלון, מחזיר את השורה לתור,
--   ומפרסם בפייסבוק שוב. פוסט כפול הוא בדיוק מה שכל המנגנון בנוי למנוע.
--   שורה נפרדת פירושה ניסיונות, תקרה יומית ויומן נפרדים לכל ערוץ.
--
-- מה משתנה:
--   1. ‏pricing_config — מתג ותקרה לאינסטגרם. **המתג כבוי כברירת מחדל**: עד
--      שהחשבון מחובר, נכס חדש לא נכנס לתור של אינסטגרם בכלל.
--   2. ה-check על `channel` מתרחב ל-'instagram'.
--   3. ‏publication_channel_enabled — מתג הכיבוי לפי ערוץ, במקום אחד.
--   4. הטריגר מכניס נכס חדש לתור של כל ערוץ דלוק.
--   5. ‏pending_property_publications — מחזירה גם את הערוץ, מקבלת את רשימת
--      הערוצים שהשרת יודע לפרסם בהם, והתקרה היומית נספרת **לכל ערוץ לחוד**.
--   6. ה-view של פרסומים לא מאומתים מציג גם את הערוץ.
--
-- מה **לא** משתנה: ההשהיה, דרישת התמונה, מספר הניסיונות, דרישת ה-post_id
-- וה-cron (התנאי שלו כבר אינו תלוי בערוץ). הטריגר של התמונה הראשונה
-- (‏20261025090000) מעדכן את כל השורות של הנכס, ולכן מכסה את שני הערוצים.
--
-- ‏**הנכסים שכבר במערכת לא נכנסים לתור של אינסטגרם.** אותה החלטה כמו
-- בפייסבוק: עשרות פוסטים ברצף בחשבון חדש הם הצפה, לא שיווק. המנגנון מתחיל
-- מהנכס הבא שיעלה אחרי שהמתג יודלק.
--
-- ‏**סדר הפריסה בטוח לשני הכיוונים.** ‏p_channels נולד עם ברירת מחדל
-- ‏{facebook_page}, ולכן גרסת השרת הקודמת — שקוראת בלי הפרמטר — ממשיכה לקבל
-- שורות פייסבוק בלבד, גם אם המיגרציה רצה לפני פריסת הפונקציה.
--
-- הפרטים: docs/facebook-auto-publish.md, סעיף "אינסטגרם".
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. פרמטרים
-- ---------------------------------------------------------------------------
insert into public.pricing_config (key, value, description) values
  ('instagram_autopost_enabled', 0,
   'פרסום אוטומטי של נכס חדש לחשבון האינסטגרם של האתר (1=פעיל, 0=כבוי). להדליק רק אחרי שהחשבון מחובר ופוסט בדיקה אחד עלה'),
  ('instagram_autopost_daily_cap', 12,
   'תקרת פוסטים ליממה בחשבון האינסטגרם. עודף נשאר בתור ויוצא למחרת. אינסטגרם עצמה מגבילה ל-100 ביממה')
on conflict (key) do update
  set description = excluded.description;

-- ---------------------------------------------------------------------------
-- 2. הערוץ החדש
--
-- ה-check נוצר inline ב-20260906092000, ולכן שמו נקבע אוטומטית. במקום להניח
-- את השם, מוחקים כל check על הטבלה שמזכיר את `channel` ויוצרים אחד בשם
-- מפורש — כך ההרצה השנייה מוצאת את השם שלנו ומחליפה אותו באותו אחד.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select conname
      from pg_constraint
     where conrelid = 'public.property_publications'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%channel%'
  loop
    execute format('alter table public.property_publications drop constraint %I', r.conname);
  end loop;

  alter table public.property_publications
    add constraint property_publications_channel_check
    check (channel in ('facebook_page', 'instagram'));
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. מתג הכיבוי לפי ערוץ
--
-- ברירות המחדל הפוכות בכוונה: פייסבוק דלוק (כך היה עד היום, ומתג שנמחק לא
-- אמור לעצור ערוץ חי), אינסטגרם כבוי (ערוץ שלא חובר לא אמור לצבור תור).
-- ---------------------------------------------------------------------------
create or replace function public.publication_channel_enabled(p_channel text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case p_channel
    when 'facebook_page' then
      coalesce((select value::int from public.pricing_config
                 where key = 'facebook_autopost_enabled'), 1) = 1
    when 'instagram' then
      coalesce((select value::int from public.pricing_config
                 where key = 'instagram_autopost_enabled'), 0) = 1
    else false
  end;
$$;

comment on function public.publication_channel_enabled(text) is
  'האם הפרסום האוטומטי לערוץ דלוק. facebook_page דלוק כברירת מחדל, instagram כבוי עד שמדליקים אותו ב-pricing_config.';

revoke all on function public.publication_channel_enabled(text) from public, anon, authenticated;
grant execute on function public.publication_channel_enabled(text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. הטריגר — שורה לכל ערוץ דלוק
--
-- כל ערוץ נבדק ונכנס לחוד, כך שמתג פייסבוק כבוי אינו עוצר את אינסטגרם
-- ולהפך. ה-exception נשאר עוטף את הכול: שמירת נכס לעולם אינה נופלת בגלל
-- התור.
-- ---------------------------------------------------------------------------
create or replace function public.properties_queue_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.publication_channel_enabled('facebook_page') then
    perform public.queue_property_publication(new.id, 'facebook_page');
  end if;
  if public.publication_channel_enabled('instagram') then
    perform public.queue_property_publication(new.id, 'instagram');
  end if;
  return null;
exception when others then
  raise warning 'properties_queue_publication נכשל לנכס %: %', new.id, sqlerrm;
  return null;
end;
$$;

comment on function public.properties_queue_publication() is
  'מכניסה נכס שנעשה active לתור הפרסום של כל ערוץ דלוק (פייסבוק, אינסטגרם). no-op שקט לערוץ שהמתג שלו כבוי.';

revoke all on function public.properties_queue_publication() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. המשיכה מהתור
--
-- סוג ההחזרה משתנה (עמודת `channel` בסוף), ולכן drop ולא create or replace.
-- ‏p_channels הוא מה שהשרת יודע לפרסם בו כרגע — ערוץ שאין לו סודות אינו
-- נמשך, ולכן גם אינו נתפס ואינו שורף ניסיונות.
-- ---------------------------------------------------------------------------
drop function if exists public.pending_property_publications(int, uuid);

create or replace function public.pending_property_publications(
  p_limit       int default 10,
  p_property_id uuid default null,
  p_channels    text[] default array['facebook_page']
)
returns table (
  publication_id  uuid,
  property_id     uuid,
  listing_number  bigint,
  title           text,
  description     text,
  marketing_description text,
  post_text       text,
  property_type   text,
  deal_type       text,
  category        text,
  price           numeric,
  rooms           numeric,
  size_sqm        numeric,
  garden_sqm      numeric,
  floor           int,
  total_floors    smallint,
  city            text,
  neighborhood    text,
  street          text,
  features        text[],
  condition       text,
  move_in_date    date,
  furniture_details text,
  images          text[],
  marketing_image text,
  agent_name      text,
  agent_phone     text,
  agency_name     text,
  channel         text
)
language sql
security definer
set search_path = ''
as $$
  with posted_today as (
    select pp.channel, count(*) as n
      from public.property_publications pp
     where pp.status = 'posted' and pp.posted_at > now() - interval '24 hours'
     group by pp.channel
  )
  select
    pub.id, p.id, p.listing_number, p.title, p.description,
    p.marketing_description, p.post_text,
    p.property_type, p.deal_type, p.category,
    p.price, p.rooms::numeric,
    coalesce(p.size_sqm, p.area_sqm)::numeric, p.garden_sqm,
    p.floor::int, p.total_floors,
    p.city, n.name, p.street,
    p.features, p.condition, p.move_in_date, p.furniture_details,
    p.images, p.marketing_image,
    m.display_name, coalesce(m.phone_e164, m.phone), a.name,
    pub.channel
    from public.property_publications pub
    join public.properties p on p.id = pub.property_id
    left join public.neighborhoods  n on n.id = p.neighborhood_id
    left join public.agency_members m on m.id = p.agent_id
    left join public.agencies       a on a.id = p.agency_id
    left join posted_today          t on t.channel = pub.channel
   where pub.status = 'pending'
     and p.status = 'active'
     and pub.channel = any(coalesce(p_channels, array['facebook_page']))
     and public.property_has_publishable_image(p.images, p.marketing_image)
     and (p_property_id is null or p.id = p_property_id)
     and (p_property_id is not null or pub.publish_after <= now())
     and (p_property_id is not null
          or coalesce(t.n, 0) < case pub.channel
               when 'instagram' then
                 coalesce((select value::int from public.pricing_config
                            where key = 'instagram_autopost_daily_cap'), 12)
               else
                 coalesce((select value::int from public.pricing_config
                            where key = 'facebook_autopost_daily_cap'), 12)
             end)
     and (p_property_id is not null
          or public.publication_channel_enabled(pub.channel))
   order by pub.publish_after, pub.channel
   limit least(greatest(coalesce(p_limit, 10), 1), 25);
$$;

comment on function public.pending_property_publications(int, uuid, text[]) is
  'השורות שמותר לפרסם עכשיו, בערוצים שהשרת מחובר אליהם, עם כל מה שדרוש לתיאור ולפוסט. מסננת נכסים לא פעילים, נכסים בלי תמונה, השהיה, מתג כיבוי ותקרה יומית לכל ערוץ — למעט בקשה ידנית לנכס מסוים, שעוקפת את שלושת האחרונים בלבד.';

revoke all on function public.pending_property_publications(int, uuid, text[]) from public, anon, authenticated;
grant execute on function public.pending_property_publications(int, uuid, text[]) to service_role;

-- ---------------------------------------------------------------------------
-- 6. פרסומים לא מאומתים — עם הערוץ, בסוף
-- ---------------------------------------------------------------------------
create or replace view public.property_publications_unconfirmed as
  select pub.id            as publication_id,
         pub.property_id,
         p.listing_number,
         p.title,
         pub.posted_at,
         pub.attempts,
         pub.message,
         pub.channel
    from public.property_publications pub
    join public.properties p on p.id = pub.property_id
   where pub.status = 'posted'
     and pub.post_id is null
   order by pub.posted_at desc;

comment on view public.property_publications_unconfirmed is
  'פרסומים שסומנו posted בלי שהערוץ החזיר post_id — כלומר לא אומתו מול הדף או החשבון.';

revoke all on public.property_publications_unconfirmed from public, anon, authenticated;
grant select on public.property_publications_unconfirmed to service_role;
