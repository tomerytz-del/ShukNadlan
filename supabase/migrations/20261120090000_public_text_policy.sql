-- ============================================================================
-- מדיניות התוכן הציבורי: קישורים אסורים לכולם, טלפונים אסורים ב-Pay&GO
--
-- שני כללים שהיו עד היום הסכמה בעל פה, וכל אכיפה שלהם הייתה בקשה מהמודל או
-- מהסוכן/ת:
--
--   ‏1. **קישור לדף חיצוני אסור בכל התיאורים ובכל המסלולים** — נכסים, משרדים
--      ומתווכים. כולל פרופילי פייסבוק, אינסטגרם ומקצרי כתובות.
--   ‏2. **מספר טלפון בתיאור אסור במסלול Pay&GO בלבד.** ‏PROFESSIONAL ו-Elite
--      משלמים על הערוץ הזה, והם רשאים.
--
-- ## למה זה במסד ולא בדפדפן
--
-- אותה סיבה שמתועדת ב-`owner-privacy.md`: התיאור נכתב משלושה מקומות לפחות —
-- הטופס ב-CRM, העוזר בוואטסאפ (`update_property`), ו-`property-description`
-- שמייצרת נוסח שיווקי — ולפעמים גם מייבוא. בדיקה בדפדפן היא בדיקה במקום אחד
-- מתוך שלושה, והיא נשברת בפעם הראשונה שמישהו מוסיף מקור רביעי ושוכח.
--
-- טריגר `before insert or update` רואה את כולם, ואינו יכול להישכח.
--
-- ## למה מוחקים ולא דוחים
--
-- זו ההחלטה שנבחרה במפורש: **השמירה מצליחה, הטקסט נכנס נקי, ואחריה נשלחת
-- התראה שאומרת מה הוסר ולמה.** דחייה הייתה מפילה עריכה שלמה בגלל שורת
-- חתימה, ושתיקה הייתה משאירה סוכן/ת בטוח/ה שהטלפון שלו/ה מתפרסם. זהו בדיוק
-- ההפרש בין `redact_owner_details` (מוחקת בשקט — שם אין למי להודיע, זה לא
-- הטקסט של הסוכן/ת) לבין כאן.
--
-- ## מה **לא** כאן
--
-- **תמונות.** ‏"אסור להעלות מספרי טלפון בתמונות" הוא כלל שמופיע כאזהרה
-- בממשק, בלי אכיפה: איתור מספר שצרוב בתוך תצלום דורש קריאת ראייה לכל תמונה,
-- וזו עלות שלא נבחרה. האזהרה ב-`crm.html`, ובכוונה **לא** ב-`pricing.html`.
--
-- **שם בעל/ת הנכס.** ‏`redact_owner_details` כבר מטפלת בו, ובטריגר נפרד.
-- שני הטריגרים רצים זה אחר זה על אותה שורה ואינם מתנגשים: כל אחד נוגע
-- בתבנית אחרת.
--
-- **תיאור של משרד — קישורים בלבד.** למשרד אין מסלול משלו; המסלול הוא תכונה
-- של `agency_members`. כלל הטלפונים הוא לפי מסלול, ולכן אין לו כאן על מה
-- לחול.
--
-- הקובץ אידמפוטנטי.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. שני המנקים
--
-- הביטויים נבדקו מול המסד החי לפני שנכתבו לכאן (‏`select` רגיל, כפי
-- ש-`docs/supabase-migrations.md` ממליץ), על מקרים אמיתיים ועל מה שאסור
-- להיעלם:
--
--   נמחק: ‏facebook.com/x · https://… · www.… · bit.ly/x · instagram.com/x
--   נשאר: ‏dana@example.com · "1,850,000 ש״ח" · "120 מ״ר" · "קומה 3 מתוך 8"
--
-- ‏**ה-lookbehind על ‎@‎ הוא מה ששומר על כתובות מייל.** בלעדיו
-- ‏`dana@example.com` היה הופך ל-`dana@` — מחיקה חלקית שנראית כמו תקלת
-- הקלדה ולא כמו מדיניות. מייל אינו קישור לדף אחר, ולא התבקש להסירו.
-- ---------------------------------------------------------------------------
create or replace function public.strip_public_links(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_text is null then null else
    regexp_replace(
      p_text,
      '(?:https?://|www\.)[^\s,;)]+'
      || '|(?<![@\w.])[a-z0-9][a-z0-9-]*'
      || '\.(?:com|co\.il|org\.il|net|org|me|ly|io|il|info|biz|link|page|site|app|xyz|shop)'
      || '(?:\.[a-z]{2})?(?:/[^\s,;)]*)?',
      '', 'gi')
  end;
$$;

comment on function public.strip_public_links(text) is
  'מסירה קישורים לדפים חיצוניים מטקסט ציבורי, כולל פרופילי רשתות חברתיות ומקצרי כתובות. כתובות מייל נשמרות.';

create or replace function public.strip_public_phones(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_text is null then null else
    regexp_replace(
      p_text,
      '(?:\+?972[- .]?|0)(?:5[0-9]|7[2-9]|[23489])[- .]?[0-9]{3}[- .]?[0-9]{4}',
      '', 'g')
  end;
$$;

comment on function public.strip_public_phones(text) is
  'מסירה מספרי טלפון ישראליים (נייד, קווי ובפורמט בינלאומי) מטקסט ציבורי. מחירים, שטחים ושנים אינם נפגעים.';

-- ---------------------------------------------------------------------------
-- 2. ההפעלה, כולל ניקוי הסימנים היתומים
--
-- מחיקה באמצע משפט משאירה "דברו איתנו. ." או "לפרטים: , תודה". הניקוי כאן
-- זהה ברוחו לזה של `redact_owner_details`, ומאותה סיבה: טקסט שנראה שבור
-- מזמין את הסוכן/ת להקליד את מה שהוסר בחזרה.
-- ---------------------------------------------------------------------------
create or replace function public.apply_public_text_policy(
  p_text         text,
  p_strip_phones boolean
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text;
begin
  if p_text is null then return null; end if;

  v := public.strip_public_links(p_text);
  if p_strip_phones then
    v := public.strip_public_phones(v);
  end if;

  if v is not distinct from p_text then
    return p_text;
  end if;

  v := regexp_replace(v, '[ ' || chr(9) || ']+', ' ', 'g');
  v := regexp_replace(v, ' ([,.;:!?])', '\1', 'g');
  v := regexp_replace(v, '([,.;:!?])[ ]*([,.;:!?])+', '\1', 'g');
  v := regexp_replace(v, '([,.;:!?])[ ]*[|·]+', '\1', 'g');
  v := regexp_replace(v, '[ ]*' || chr(10) || '[ ]*', chr(10), 'g');
  v := regexp_replace(v, chr(10) || '{2,}', chr(10), 'g');
  v := regexp_replace(v, '^[ ,.;:|·–—' || chr(45) || ']+', '');
  v := regexp_replace(v, '[ ,;:|·–—' || chr(45) || ']+$', '');
  return v;
end;
$$;

comment on function public.apply_public_text_policy(text, boolean) is
  'מחילה את מדיניות התוכן הציבורי על שדה טקסט: קישורים תמיד, טלפונים לפי הדגל. טקסט שלא השתנה חוזר כלשונו.';

-- ---------------------------------------------------------------------------
-- 3. הטריגר על `properties`
--
-- **המסלול נקרא מהסוכן/ת של הנכס ולא מהכותב/ת.** מנהל/ת משרד ב-Elite
-- שעורך/ת מודעה של סוכן/ת ב-Pay&GO לא אמור/ה "לשחרר" בכך את הטלפון: הכלל
-- חל על מי שהמודעה שלו/ה ועל המסלול שהוא/היא משלם/ת עליו.
--
-- ‏`v_stripped` נצבר כדי שההתראה תצא **פעם אחת לשמירה** ותאמר מה הוסר,
-- ולא שלוש פעמים על שלושה שדות.
-- ---------------------------------------------------------------------------
create or replace function public.properties_apply_text_policy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tier      text;
  v_strip     boolean;
  v_what      text[] := '{}';
  v_had_link  boolean := false;
  v_had_phone boolean := false;
begin
  if new.description is null and new.marketing_description is null
     and new.post_text is null then
    return new;
  end if;

  select m.tier into v_tier
    from public.agency_members m where m.id = new.agent_id;
  v_strip := coalesce(v_tier, 'free') = 'free';

  -- מה היה שם, לפני שמוחקים — זה מה שההתראה מדווחת עליו.
  v_had_link := (
    public.strip_public_links(coalesce(new.description, '') || ' ' ||
                              coalesce(new.marketing_description, '') || ' ' ||
                              coalesce(new.post_text, ''))
    is distinct from (coalesce(new.description, '') || ' ' ||
                      coalesce(new.marketing_description, '') || ' ' ||
                      coalesce(new.post_text, ''))
  );
  if v_strip then
    v_had_phone := (
      public.strip_public_phones(coalesce(new.description, '') || ' ' ||
                                 coalesce(new.marketing_description, '') || ' ' ||
                                 coalesce(new.post_text, ''))
      is distinct from (coalesce(new.description, '') || ' ' ||
                        coalesce(new.marketing_description, '') || ' ' ||
                        coalesce(new.post_text, ''))
    );
  end if;

  new.description           := public.apply_public_text_policy(new.description, v_strip);
  new.marketing_description := public.apply_public_text_policy(new.marketing_description, v_strip);
  new.post_text             := public.apply_public_text_policy(new.post_text, v_strip);

  if v_had_link  then v_what := array_append(v_what, 'קישור לדף חיצוני'); end if;
  if v_had_phone then v_what := array_append(v_what, 'מספר טלפון'); end if;

  -- ההתראה: השמירה הצליחה, והסוכן/ת יודע/ת מה הוסר. שמירה חוזרת כבר לא
  -- תמצא מה להסיר ולכן לא תתריע שוב — המנגנון מגביל את עצמו.
  if array_length(v_what, 1) is not null and new.agent_id is not null then
    insert into public.notifications (agent_id, type, title, body)
    values (
      new.agent_id,
      'system',
      'הוסר מהמודעה: ' || array_to_string(v_what, ' ו'),
      coalesce(new.title, 'המודעה') || ' — '
        || case when v_had_phone
                then 'במסלול Pay&GO אין לפרסם מספר טלפון בתיאור או בתמונות; '
                     || 'הפונים מגיעים דרך כפתורי הקשר בדף הנכס. '
                else '' end
        || case when v_had_link
                then 'קישור לדף חיצוני אינו מותר באף מסלול. '
                else '' end
        || 'המודעה נשמרה, והטקסט פורסם בלי זה.'
    );
  end if;

  return new;
end;
$$;

comment on function public.properties_apply_text_policy() is
  'מחילה את מדיניות התוכן על שלושת שדות הטקסט של properties ומודיעה לסוכן/ת מה הוסר. המסלול נקרא מהסוכן/ת של הנכס.';

revoke all on function public.properties_apply_text_policy() from public;
revoke all on function public.properties_apply_text_policy() from anon, authenticated;

-- ‏`zz_` בשם: טריגרים על אותה טבלה רצים לפי סדר אלפביתי, וזה מבטיח שהניקוי
-- הזה יקרה **אחרי** `properties_redact_owner_details`. הסדר אינו קריטי
-- (התבניות אינן חופפות), אבל סדר מקרי הוא בדיוק מה שמפתיע בעוד חצי שנה.
drop trigger if exists zz_properties_apply_text_policy on public.properties;
create trigger zz_properties_apply_text_policy
  before insert or update on public.properties
  for each row execute function public.properties_apply_text_policy();

-- ---------------------------------------------------------------------------
-- 4. משרדים ומתווכים
--
-- למשרד אין מסלול משלו, ולכן אצלו זה קישורים בלבד. אצל מתווך/ת ה-`bio` הוא
-- התיאור שלו/ה, ולכן הוא כפוף לאותו כלל טלפונים לפי מסלול.
-- ---------------------------------------------------------------------------
create or replace function public.agencies_apply_text_policy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.description := public.apply_public_text_policy(new.description, false);
  new.tagline     := public.apply_public_text_policy(new.tagline, false);
  return new;
end;
$$;

revoke all on function public.agencies_apply_text_policy() from public;
revoke all on function public.agencies_apply_text_policy() from anon, authenticated;

drop trigger if exists zz_agencies_apply_text_policy on public.agencies;
create trigger zz_agencies_apply_text_policy
  before insert or update on public.agencies
  for each row execute function public.agencies_apply_text_policy();

create or replace function public.agency_members_apply_text_policy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.bio := public.apply_public_text_policy(
    new.bio, coalesce(new.tier, 'free') = 'free');
  return new;
end;
$$;

revoke all on function public.agency_members_apply_text_policy() from public;
revoke all on function public.agency_members_apply_text_policy() from anon, authenticated;

drop trigger if exists zz_agency_members_apply_text_policy on public.agency_members;
create trigger zz_agency_members_apply_text_policy
  before insert or update on public.agency_members
  for each row execute function public.agency_members_apply_text_policy();

-- ---------------------------------------------------------------------------
-- 5. החלון שנפתח בשינוי מסלול
--
-- סוכן/ת ב-Elite שכתב/ה טלפון בתיאור — כדין — ואז ירד/ה ל-Pay&GO, נשאר/ת עם
-- הטלפון מפורסם: הטריגר של §3 רץ על כתיבה לנכס, ומסלול משתנה בטבלה אחרת.
--
-- זה בדיוק המבנה של `property_owners_redact_property_text`, שסוגר את החלון
-- המקביל אצל בעלי הנכס. כאן הוא נסגר בכיוון אחד בלבד: **ירידה** ל-Pay&GO
-- מנקה. עלייה למסלול בתשלום אינה מחזירה טלפון שנמחק — טקסט שנמחק איננו,
-- והסוכן/ת מוזמן/ת לכתוב אותו מחדש.
--
-- ‏`update` על `properties` מפעיל ממילא את הטריגר של §3, ואיתו גם ההתראה.
-- ---------------------------------------------------------------------------
create or replace function public.agency_members_tier_reapply_policy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.tier, 'free') <> 'free'
     or coalesce(old.tier, 'free') = coalesce(new.tier, 'free') then
    return new;
  end if;

  -- רק שורות שיש בהן באמת טלפון, כדי שלא לגעת בכל המודעות של הסוכן/ת
  -- (וכדי שלא לייצר התראה על שורה שלא השתנתה).
  update public.properties p
     set updated_at = now()
   where p.agent_id = new.id
     and public.strip_public_phones(
           coalesce(p.description, '') || ' ' ||
           coalesce(p.marketing_description, '') || ' ' ||
           coalesce(p.post_text, ''))
         is distinct from
           (coalesce(p.description, '') || ' ' ||
            coalesce(p.marketing_description, '') || ' ' ||
            coalesce(p.post_text, ''));

  return new;
end;
$$;

comment on function public.agency_members_tier_reapply_policy() is
  'ירידה ל-Pay&GO מנקה טלפונים מהמודעות הקיימות של הסוכן/ת, דרך הטריגר של properties. עלייה למסלול בתשלום אינה משחזרת טקסט שנמחק.';

revoke all on function public.agency_members_tier_reapply_policy() from public;
revoke all on function public.agency_members_tier_reapply_policy() from anon, authenticated;

drop trigger if exists zzz_agency_members_tier_reapply_policy on public.agency_members;
create trigger zzz_agency_members_tier_reapply_policy
  after update of tier on public.agency_members
  for each row execute function public.agency_members_tier_reapply_policy();
