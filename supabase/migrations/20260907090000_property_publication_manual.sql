-- ============================================================================
-- פרסום חוזר יזום — כפתור "פרסם בפייסבוק" בכרטיס הנכס
--
-- משלים את 20260906090000: שם כל נכס מקבל פרסום אוטומטי אחד עם כניסתו
-- למערכת, וכאן נפתחת הדרך לפרסם אותו שוב — פעם בחודש, ביוזמת הסוכן/ת.
--
-- שלוש החלטות:
--
--   א. **‏origin, ולא טבלה שנייה.** פרסום ידני הוא אותו אירוע בדיוק — אותו
--      נכס, אותו ערוץ, אותו יומן — ורק מי שיזם אותו שונה. לכן נוספת עמודה
--      ולא מנגנון מקביל, וכל הפוסטים על נכס יושבים באותה טבלה לפי סדר זמן.
--   ב. **ה-unique הופך לחלקי.** האילוץ המקורי (נכס×ערוץ) הוא מה שמבטיח
--      שהפרסום האוטומטי יקרה בדיוק פעם אחת בחיי הנכס, וזה נשאר — אבל רק על
--      שורות `auto`. פרסום ידני הוא שורה חדשה בכל פעם, עם post_id משלו.
--   ג. **החסם החודשי במסד ולא בדפדפן.** הכפתור ב-CRM רק מציג את המצב;
--      ‏request_manual_publication היא זו שמחליטה, ולכן גם קריאה ישירה
--      ל-API לא תעקוף אותה.
--
-- הקובץ אידמפוטנטי.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. פרמטר עסקי
-- ---------------------------------------------------------------------------
insert into public.pricing_config (key, value, description) values
  ('facebook_republish_min_days', 30,
   'כמה ימים חייבים לעבור מהפוסט האחרון על נכס לפני שאפשר לפרסם אותו שוב')
on conflict (key) do update
  set description = excluded.description;

-- ---------------------------------------------------------------------------
-- 1. מי יזם את הפרסום
-- ---------------------------------------------------------------------------
alter table public.property_publications
  add column if not exists origin text not null default 'auto'
    check (origin in ('auto','manual'));

comment on column public.property_publications.origin is
  'auto = הפרסום האחד שנוצר עם כניסת הנכס למערכת · manual = פרסום חוזר שהסוכן/ת יזם/ה מהכרטיס ב-CRM.';

-- האילוץ המקורי חסם שורה שנייה לכל נכס. עכשיו הוא חוסם רק פרסום אוטומטי
-- שני — וזו בדיוק המשמעות שהתכוונו אליה מלכתחילה.
alter table public.property_publications
  drop constraint if exists property_publications_unique;

create unique index if not exists property_publications_auto_key
  on public.property_publications (property_id, channel)
  where origin = 'auto';

-- ‏"מתי פורסם לאחרונה" היא השאלה שנשאלת בכל לחיצה על הכפתור ובכל טעינה של
-- רשימת הנכסים, ולכן היא מקבלת אינדקס משלה.
create index if not exists property_publications_property_posted_idx
  on public.property_publications (property_id, posted_at desc)
  where status = 'posted';

-- ---------------------------------------------------------------------------
-- 2. הכניסה לתור — התאמה ל-unique החלקי
--
-- זהה לגרסה הקודמת, פרט ליעד ה-on conflict: אינדקס חלקי נדרש להצהיר את
-- הפרדיקט שלו. הפונקציה נשארת נתיב הפרסום ה*אוטומטי* בלבד.
-- ---------------------------------------------------------------------------
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

  insert into public.property_publications (property_id, channel, origin, publish_after)
  values (p_property_id, p_channel, 'auto',
          now() + make_interval(mins => greatest(v_delay, 0)))
  on conflict (property_id, channel) where origin = 'auto' do update
    set status        = case when p_force then 'pending' else public.property_publications.status end,
        attempts      = case when p_force then 0 else public.property_publications.attempts end,
        last_error    = case when p_force then null else public.property_publications.last_error end,
        publish_after = case when p_force then now() else public.property_publications.publish_after end
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.queue_property_publication(uuid, text, boolean, int) is
  'מכניסה נכס לתור הפרסום האוטומטי. בלי p_force לא נוגעת בשורה קיימת. פרסום חוזר יזום עובר ב-request_manual_publication.';

revoke all on function public.queue_property_publication(uuid, text, boolean, int) from public;
revoke all on function public.queue_property_publication(uuid, text, boolean, int) from anon, authenticated;
grant execute on function public.queue_property_publication(uuid, text, boolean, int) to service_role;

-- ---------------------------------------------------------------------------
-- 3. ‏origin חוזר גם לשרת
--
-- הוא זה שמבדיל בין פוסט ראשון לפוסט חוזר: על פוסט חוזר השרת מבקש
-- מ-Claude פתיח חדש, כדי שאותו נכס לא יופיע בדף פעמיים באותן מילים בדיוק.
--
-- ‏drop ולא רק create or replace: עמודה שנוספת לטבלת ההחזרה משנה את חתימת
-- הפונקציה, ו-PostgreSQL דוחה החלפה כזו ("cannot change return type").
-- ---------------------------------------------------------------------------
drop function if exists public.pending_property_publications(int, uuid);

create or replace function public.pending_property_publications(
  p_limit       int default 10,
  p_property_id uuid default null
)
returns table (
  publication_id  uuid,
  property_id     uuid,
  origin          text,
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
  agency_name     text
)
language sql
security definer
set search_path = ''
as $$
  with cap as (
    select coalesce((select value::int from public.pricing_config
                      where key = 'facebook_autopost_daily_cap'), 12) as daily_cap
  ),
  posted_today as (
    select count(*) as n
      from public.property_publications
     where status = 'posted' and posted_at > now() - interval '24 hours'
  )
  select
    pub.id, p.id, pub.origin, p.listing_number, p.title, p.description,
    p.marketing_description, p.post_text,
    p.property_type, p.deal_type, p.category,
    p.price, p.rooms::numeric,
    coalesce(p.size_sqm, p.area_sqm)::numeric, p.garden_sqm,
    p.floor::int, p.total_floors,
    p.city, n.name, p.street,
    p.features, p.condition, p.move_in_date, p.furniture_details,
    p.images, p.marketing_image,
    m.display_name, coalesce(m.phone_e164, m.phone), a.name
    from public.property_publications pub
    join public.properties p on p.id = pub.property_id
    left join public.neighborhoods  n on n.id = p.neighborhood_id
    left join public.agency_members m on m.id = p.agent_id
    left join public.agencies       a on a.id = p.agency_id
   cross join cap
   cross join posted_today
   where pub.status = 'pending'
     and p.status = 'active'
     -- שורה אחת לכל נכס בכל הרצה, גם אם הצטברו שתיים. עכשיו שיש יותר משורה
     -- אחת לנכס, בלי זה הרצה אחת הייתה יכולה להוציא שני פוסטים על אותו נכס
     -- בזה אחר זה. השנייה תמתין להרצה הבאה — או תיחסם ב-30 היום.
     and pub.id = (select q.id from public.property_publications q
                    where q.property_id = p.id and q.status = 'pending'
                    order by q.publish_after, q.created_at
                    limit 1)
     and (p_property_id is null or p.id = p_property_id)
     and (p_property_id is not null or pub.publish_after <= now())
     and (p_property_id is not null or posted_today.n < cap.daily_cap)
     and (p_property_id is not null
          or coalesce((select value::int from public.pricing_config
                        where key = 'facebook_autopost_enabled'), 1) = 1)
   order by pub.publish_after
   limit least(greatest(coalesce(p_limit, 10), 1), 25);
$$;

comment on function public.pending_property_publications(int, uuid) is
  'הנכסים שמותר לפרסם עכשיו, עם כל מה שדרוש לתיאור השיווקי ולפוסט. מסננת נכסים לא פעילים, השהיה, מתג כיבוי ותקרה יומית — למעט בקשה ידנית לנכס מסוים.';

revoke all on function public.pending_property_publications(int, uuid) from public;
revoke all on function public.pending_property_publications(int, uuid) from anon, authenticated;
grant execute on function public.pending_property_publications(int, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. הבקשה לפרסום חוזר
--
-- כל הכללים במקום אחד: מי רשאי/ת, האם הנכס פעיל, האם המנגנון דלוק, והאם
-- עברו 30 יום מהפוסט האחרון. מחזירה jsonb ולא זורקת שגיאה — הכפתור ב-CRM
-- צריך להציג הודעה מדויקת ("אפשר לפרסם שוב ב-12.10"), לא סתם "שגיאה".
--
-- ‏"פורסם לאחרונה" נספר על פני *כל* הפוסטים על הנכס, אוטומטי כידני: נכס
-- שנכנס למערכת אתמול וקיבל את הפוסט האוטומטי שלו לא יקבל פוסט שני היום.
-- ---------------------------------------------------------------------------
create or replace function public.request_manual_publication(p_property_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member   public.agency_members%rowtype;
  v_prop     public.properties%rowtype;
  v_min_days int;
  v_last     timestamptz;
  v_id       uuid;
begin
  select * into v_member
    from public.agency_members
   where user_id = (select auth.uid()) and active = true
   limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_agent');
  end if;

  select * into v_prop from public.properties where id = p_property_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- הנכס שלי, נכס במשרד שאני מנהל/ת, או מנהל/ת פלטפורמה
  if not (v_prop.agent_id = v_member.id
          or (v_member.role = 'manager' and v_prop.agency_id = v_member.agency_id)
          or v_member.is_platform_admin) then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;

  if v_prop.status is distinct from 'active' then
    return jsonb_build_object('ok', false, 'reason', 'not_active');
  end if;

  -- מתג הכיבוי חוסם גם פרסום יזום: אחרת השורה הייתה נכנסת לתור ויושבת שם
  -- בלי שאיש יבין למה הפוסט לא יצא.
  if coalesce((select value::int from public.pricing_config
                where key = 'facebook_autopost_enabled'), 1) <> 1 then
    return jsonb_build_object('ok', false, 'reason', 'disabled');
  end if;

  if exists (select 1 from public.property_publications
              where property_id = p_property_id and status = 'pending') then
    return jsonb_build_object('ok', false, 'reason', 'already_queued');
  end if;

  v_min_days := coalesce((select value::int from public.pricing_config
                           where key = 'facebook_republish_min_days'), 30);

  select max(posted_at) into v_last
    from public.property_publications
   where property_id = p_property_id and status = 'posted';

  if v_last is not null and v_last > now() - make_interval(days => v_min_days) then
    return jsonb_build_object(
      'ok', false, 'reason', 'too_soon',
      'last_posted_at',  v_last,
      'next_allowed_at', v_last + make_interval(days => v_min_days));
  end if;

  insert into public.property_publications
    (property_id, channel, origin, publish_after)
  values (p_property_id, 'facebook_page', 'manual', now())
  returning id into v_id;

  return jsonb_build_object('ok', true, 'publication_id', v_id);
end;
$$;

comment on function public.request_manual_publication(uuid) is
  'בקשת פרסום חוזר מכרטיס הנכס. אוכפת בעלות, נכס פעיל, מתג כיבוי וחסם של facebook_republish_min_days. מחזירה סיבה קריאה במקום לזרוק שגיאה.';

revoke all on function public.request_manual_publication(uuid) from public;
revoke all on function public.request_manual_publication(uuid) from anon;
grant execute on function public.request_manual_publication(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. מה הסוכן/ת רואה
--
-- עד כה היומן היה גלוי למנהל/ת הפלטפורמה בלבד. הכפתור צריך לדעת מתי הנכס
-- פורסם לאחרונה, ולכן נפתחת קריאה לשורות של הנכסים שלי (ושל המשרד למנהל/ת).
-- ‏select בלבד: הכתיבה נשארת בפונקציות.
-- ---------------------------------------------------------------------------
drop policy if exists "agent reads own property publications" on public.property_publications;
create policy "agent reads own property publications"
  on public.property_publications for select
  using (exists (
    select 1
      from public.properties p
      join public.agency_members m on m.user_id = (select auth.uid())
     where p.id = public.property_publications.property_id
       and m.active = true
       and (p.agent_id = m.id
            or (m.role = 'manager' and p.agency_id = m.agency_id))));
