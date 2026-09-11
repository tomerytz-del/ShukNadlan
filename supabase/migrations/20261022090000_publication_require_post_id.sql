-- ===========================================================================
-- פרסום בלי post_id אינו פרסום מאושר
--
-- ב-9.9.2026 ‏14 נכסים נרשמו אצלנו `posted` בלי שאף פוסט עלה לדף. הסיבה
-- אינה באג אלא הנחה שגויה: ‏Make מחזיר 200 כבר על **קבלת** ה-webhook — גם
-- כשהתרחיש כבוי והנתונים רק נכנסו לתור הפנימי שלו — ואנחנו סימנו הצלחה על
-- סמך התשובה הזו. התקלה התגלתה יומיים אחר כך, במקרה.
--
-- הסימן היחיד שמבדיל פרסום מאושר מפרסום משוער כבר קיים בטבלה: `post_id`.
-- הוא מגיע רק ממודול `Webhooks → Webhook response` בסוף התרחיש, כלומר רק
-- אחרי שמודול הפרסום באמת רץ והחזיר מזהה.
--
-- ## למה מתג ולא התנהגות קבועה
--
-- להפוך `post_id` לחובה באופן גורף היה מסוכן יותר מהתקלה עצמה: בתרחיש שאין
-- בו מודול Webhook response, **כל** פרסום מוצלח היה נספר ככישלון, חוזר
-- לתור, ומתפרסם שוב — חמישה פוסטים זהים על אותו נכס. פוסט כפול הוא הנזק
-- שכל המנגנון הזה בנוי למנוע (‏§"למה נכס לא יפורסם פעמיים").
--
-- לכן `facebook_autopost_require_post_id` נכנס כבוי. מדליקים אותו **רק
-- אחרי** שרואים `post_id` על שורה אמיתית בטבלה — כלומר אחרי שהוכח שהתרחיש
-- מחזיר אותו. מאותו רגע, פרסום שלא אושר מקבל ניסיון חוזר ככל כישלון אחר,
-- ובסוף `failed` עם הסבר, במקום `posted` שקרי.
--
-- ## למה ההחלטה כאן ולא בשרת
--
-- אותו נימוק שכתוב כבר ב-§6 של מיגרציה 20260906092000: "נכשל סופית" הוא
-- החלטה של מדיניות ולא של הקריאה הבודדת שנפלה. השרת מדווח מה קרה —
-- ‏`p_ok`, ‏`p_post_id` — והמסד קובע מה זה אומר. כך גם מסלול Graph, שמחזיר
-- מזהה תמיד, וגם כל ערוץ שיתווסף, נשפטים באותה אמת מידה בלי לגעת בקוד.
--
-- אידמפוטנטית.
-- ===========================================================================

insert into public.pricing_config (key, value, description) values
  ('facebook_autopost_require_post_id', 0,
   'פרסום ייחשב מוצלח רק אם הערוץ החזיר post_id (1=נדרש, 0=מסתפקים בתשובת 200). להדליק רק אחרי שמודול Webhook response מוגדר ומחזיר מזהה — אחרת כל פרסום מוצלח ייספר ככישלון ויפורסם שוב')
on conflict (key) do update
  set description = excluded.description;

-- ---------------------------------------------------------------------------
-- סימון התוצאה
--
-- זהה למקור (מיגרציה 20260906092000 §6) פרט ל-`v_ok`: הצלחה שדווחה מהשרת
-- יורדת ל"לא אושרה" כשחסר `post_id` והמתג דלוק. משם והלאה היא נוהגת בדיוק
-- ככישלון רגיל — מונה הניסיונות, ה-backoff של חצי שעה ומדיניות
-- ‏`facebook_autopost_max_attempts` כולם חלים עליה כמו שהם.
--
-- ‏`message` נשמר גם בשורה שלא אושרה, בכוונה: זה הטקסט שיצא בפועל, והוא מה
-- שמאפשר להשוות מול הדף ולהכריע אם הפוסט עלה או לא.
-- ---------------------------------------------------------------------------
create or replace function public.mark_property_publication(
  p_publication_id uuid,
  p_ok             boolean,
  p_message        text default null,
  p_post_id        text default null,
  p_post_url       text default null,
  p_error          text default null,
  p_description_generated boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max        int;
  v_require_id boolean;
  v_ok         boolean;
  v_error      text;
  v_status     text;
  v_attempts   smallint;
begin
  v_max := coalesce((select value::int from public.pricing_config
                      where key = 'facebook_autopost_max_attempts'), 5);

  v_require_id := coalesce((select value::int from public.pricing_config
                             where key = 'facebook_autopost_require_post_id'), 0) = 1;

  select attempts into v_attempts
    from public.property_publications where id = p_publication_id;
  if v_attempts is null then
    return null;
  end if;

  v_ok := p_ok and (not v_require_id or p_post_id is not null);

  v_error := case
    when p_ok and not v_ok
      then 'הערוץ לא החזיר post_id — הפרסום לא אושר. ודאו שמודול Webhook response מוגדר בתרחיש ומחזיר את מזהה הפוסט'
    else p_error
  end;

  v_status := case
    when v_ok then 'posted'
    when v_attempts >= v_max then 'failed'
    else 'pending'
  end;

  update public.property_publications
     set status     = v_status,
         message    = coalesce(p_message, message),
         post_id    = coalesce(p_post_id, post_id),
         post_url   = coalesce(p_post_url, post_url),
         last_error = case when v_ok then null else v_error end,
         posted_at  = case when v_ok then now() else posted_at end,
         description_generated = description_generated or coalesce(p_description_generated, false)
   where id = p_publication_id;

  return v_status;
end;
$$;

comment on function public.mark_property_publication(uuid, boolean, text, text, text, text, boolean) is
  'מסמנת את תוצאת הפרסום. failed נקבע לפי מדיניות הניסיונות ולא לפי הקריאה הבודדת; כישלון זמני נדחה בחצי שעה. כש-facebook_autopost_require_post_id דלוק, פרסום שחזר בלי post_id אינו נחשב מאושר.';

revoke all on function public.mark_property_publication(uuid, boolean, text, text, text, text, boolean) from public;
revoke all on function public.mark_property_publication(uuid, boolean, text, text, text, text, boolean) from anon, authenticated;
grant execute on function public.mark_property_publication(uuid, boolean, text, text, text, text, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- מעקב: מה פורסם בלי אישור
--
-- השאלה "האם הפוסט באמת עלה" נשאלה עד היום בשאילתה מאולתרת, ורק אחרי
-- שמישהו כבר חשד. ‏view קטן הופך אותה לשאלה שאפשר לשאול בשגרה.
--
-- שורה כאן אינה בהכרח תקלה כשהמתג כבוי — היא אומרת "לא נדע בלי להסתכל
-- בדף". כשהמתג דלוק, שורה כאן היא כבר ממצא.
-- ---------------------------------------------------------------------------
create or replace view public.property_publications_unconfirmed as
  select pub.id            as publication_id,
         pub.property_id,
         p.listing_number,
         p.title,
         pub.posted_at,
         pub.attempts,
         pub.message
    from public.property_publications pub
    join public.properties p on p.id = pub.property_id
   where pub.status = 'posted'
     and pub.post_id is null
   order by pub.posted_at desc;

comment on view public.property_publications_unconfirmed is
  'פרסומים שסומנו posted בלי שהערוץ החזיר post_id — כלומר לא אומתו מול הדף.';

revoke all on public.property_publications_unconfirmed from public;
revoke all on public.property_publications_unconfirmed from anon, authenticated;
grant select on public.property_publications_unconfirmed to service_role;
