-- ===========================================================================
-- שם בעל/ת הנכס לא יושב בטקסט הציבורי
--
-- ‏property_owners נבנתה בדיוק בשביל זה (מיגרציה 20260827140000): "properties
-- גלויה ל-anon לכל נכס פעיל, ולכן שם וטלפון של המוכר/ת לא יכולים לשבת שם".
-- הכלל הזה נשמר בכל השדות המובנים — ויש בו חור אחד: `description` הוא טקסט
-- חופשי, והסוכן/ת כותב/ת בו מה שנוח.
--
-- כך זה נראה בפועל בדף נכס חי:
--
--     חנות 40 מ״ר עם גלריה 15 מ״ר, ממוזגת, חניה גדולה בחזית. בעלים: דינה.
--
-- ‏"בעלים: דינה" עבר את כל השכבות בלי לעורר דבר: הוא לא שדה, לא הפר check,
-- ולא נראה חריג בטופס. בדף הנכס הוא מוצג כלשונו, ומשם הוא ממשיך לתיאור
-- השיווקי (‏`factsText` מזין את תיאור הסוכן/ת ל-Claude), לפוסט בפייסבוק
-- ולתגיות השיתוף. **שורה אחת שהוקלדה בשדה הלא נכון הופכת לפרסום של שם
-- פרטי בכל ערוץ שיש לפלטפורמה, ולאינדקס של גוגל.**
--
-- הכתיבה ל-`properties` מגיעה היום מארבעה מקומות — טופס ה-CRM, אשף הייבוא,
-- ‏`property-description` ו-`property-marketing-publish` — ומחר יהיה חמישי.
-- בדיקה בצד הלקוח מכסה את הראשון בלבד, ולכן ההסרה יושבת במסד: **טריגר אחד
-- על `properties` שכל כותב עובר דרכו.**
--
-- מה נכנס כאן:
--   ‏1. `redact_owner_details(text, owner_name)` — מוחקת קטע שנפתח בתווית
--      בעלות ("בעלים:", "המוכר —") עד סוף המשפט, ואת שמו/ה של בעל/ת הנכס
--      כשהוא ידוע.
--   ‏2. טריגר BEFORE על `properties` — על `description`, `marketing_description`
--      ו-`post_text`, בכל insert ו-update.
--   ‏3. טריגר על `property_owners` — פרטי הבעלים נשמרים **אחרי** הנכס (גם
--      בטופס וגם בייבוא), ולכן ברגע ההוא עוד לא היה שם להשוות אליו.
--   ‏4. ניקוי חד-פעמי של מה שכבר שמור — כולל הנכס שבדוגמה.
--
-- מה **לא** נכנס: חסימה. שמירה שנופלת על שגיאת פוסטגרס באמצע ייבוא של 60
-- נכסים עולה יותר ממה שהיא מונעת, והסוכן/ת ממילא מקבל/ת הודעה ב-CRM על מה
-- שהוסר (‏`reportOwnerRedaction`). התיעוד: `docs/owner-privacy.md`.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. ההסרה עצמה
--
-- שני מנגנונים נפרדים, ובכוונה לא יותר:
--
--   א. **תווית ומפריד.** ‏"בעלים: דינה" — תווית בעלות, מפריד מפורש, ואחריו
--      כל מה שנכתב עד סוף המשפט. המפריד הוא התנאי שמבדיל בין הודעה פנימית
--      לבין עברית רגילה: "הבעלים מעוניינים במכירה מהירה" הוא משפט שיווקי
--      תקין ואינו נוגע בו, ו-"הבעלים: דינה" הוא דליפה.
--   ב. **השם הידוע.** ‏`property_owners.owner_name` הוא מחרוזת שאנחנו כבר
--      מחזיקים — לא ניחוש — ולכן מותר למחוק אותה גם בלי תווית ("לתיאום מול
--      דינה"). הגבולות כאן הדוקים: מילה שלמה בלבד ולפחות שלושה תווים, כדי
--      ש-"דינה" לא ייחתך מתוך "מדינה" ושם בן שתי אותיות לא ימחק חצי משפט.
--
-- הטקסט חוזר **כפי שהוא** כשאין מה למחוק. הניקוי (רווחים כפולים, נקודה
-- יתומה שנשארה אחרי הקטע שהוסר) רץ אך ורק על טקסט שבאמת נחתך, כדי ששמירה
-- רגילה לא תעצב מחדש פסקה שאיש לא ביקש לגעת בה.
-- ---------------------------------------------------------------------------
create or replace function public.redact_owner_details(p_text text, p_owner_name text default null)
returns text
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  -- תוויות שאחריהן, בעברית של מודעות, מגיע שם או טלפון של בעל/ת הנכס.
  c_label constant text :=
    '(שם ה?בעלים|ה?בעלים|בעל(ת|י)? (הנכס|הדירה|הבית)|ה?מוכר(ת|ים)?|ה?משכיר(ה|ים)?|owner|seller)';
  -- סוף המשפט: סימן פיסוק מסיים, מעבר שורה, או מפריד ויזואלי שנהוג במודעות.
  -- ‏‎'!'‎ פותח את הסוגר ולא '.', כי הצמד "‎[.‎" הוא סימן מיוחד בביטויי פוסטגרס.
  c_stop  constant text := '[^!?.' || chr(10) || chr(13) || '|·;]*';
  v_out   text := p_text;
  v_name  text;
  v_token text;
begin
  if v_out is null or btrim(v_out) = '' then
    return p_text;
  end if;

  -- א. תווית בעלות ומפריד — עד סוף המשפט. המקף הוא התו הראשון בסוגר כדי
  --    שלא ייקרא כטווח, ו-':' אינו ראשון כדי שלא ייקרא כמחלקת תווים.
  v_out := regexp_replace(
    v_out,
    '(^|[^[:alpha:]])' || c_label || '[ ' || chr(9) || ']*[' || chr(45) || ':=–—]' || c_stop,
    '\1', 'gi');

  -- ב. השם הידוע — המחרוזת המלאה קודם, ואז כל מילה בת שלושה תווים ומעלה.
  --    הסדר חשוב: "דן כהן" יימחק כמחרוזת, ואילו מילה-מילה היה נשאר "דן".
  v_name := btrim(regexp_replace(coalesce(p_owner_name, ''), '[[:space:]]+', ' ', 'g'));
  if v_name <> '' then
    for v_token in
      select v_name
      union all
      select t
        from unnest(string_to_array(v_name, ' ')) as t
       where char_length(t) >= 3
    loop
      v_out := regexp_replace(
        v_out,
        '(^|[^[:alpha:]])' ||
          -- שם עשוי להכיל תו שהוא מטא-תו בביטוי רגולרי (גרשיים, סוגריים).
          regexp_replace(v_token, '([^[:alnum:] ])', '\\\1', 'g') ||
          '($|[^[:alpha:]])',
        '\1\2', 'g');
    end loop;
  end if;

  -- לא נחתך דבר: הטקסט חוזר בלי שנגענו בו, כולל הרווחים שלו.
  if v_out = p_text then
    return p_text;
  end if;

  -- ניקוי העקבות: רווח כפול, נקודה שנשארה בלי משפט, מפריד שאין לו שני צדדים,
  -- ושורה שכל תוכנה היה פרטי הבעלים.
  v_out := regexp_replace(v_out, '[ ' || chr(9) || ']+', ' ', 'g');
  v_out := regexp_replace(v_out, ' ([,.;:!?])', '\1', 'g');
  v_out := regexp_replace(v_out, '([,.;:!?])[ ]*([,.;:!?])+', '\1', 'g');
  v_out := regexp_replace(v_out, '([,.;:!?])[ ]*[|·]+', '\1', 'g');
  v_out := regexp_replace(v_out, '([|·])[ ]*([|·][ ]*)+', '\1 ', 'g');
  v_out := regexp_replace(v_out, '[ ]*' || chr(10) || '[ ]*', chr(10), 'g');
  v_out := regexp_replace(v_out, chr(10) || '{2,}', chr(10), 'g');
  v_out := regexp_replace(v_out, '^[ ,.;:|·–—' || chr(45) || ']+', '');
  v_out := regexp_replace(v_out, '[ ,;:|·–—' || chr(45) || ']+$', '');

  return nullif(btrim(v_out), '');
end;
$fn$;

comment on function public.redact_owner_details(text, text) is
  'מסירה פרטי בעל/ת נכס מטקסט ציבורי: קטע שנפתח בתווית בעלות ומפריד, ואת השם הידוע מ-property_owners. טקסט נקי חוזר כלשונו.';

revoke all on function public.redact_owner_details(text, text) from public;
revoke all on function public.redact_owner_details(text, text) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. הטריגר על properties
--
-- ‏BEFORE, ובשם שממיין לפני `properties_track_marketing_copy`: טריגרי BEFORE
-- רצים בסדר אלפביתי, ומי שמחזיק את מקור התיאור השיווקי ואת טביעת האצבע שלו
-- חייב לראות את הטקסט **אחרי** ההסרה — אחרת הוא רושם טביעת אצבע של טקסט
-- שלא נשמר.
--
-- ‏SECURITY DEFINER כדי לקרוא את `property_owners`, שחסומה ל-anon ומוגבלת
-- ב-RLS: הבעלים של הנכס אינו בהכרח מי שכותב את השורה (‏cron, service role).
-- ---------------------------------------------------------------------------
create or replace function public.properties_redact_owner_details()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner text;
begin
  if new.description is null and new.marketing_description is null and new.post_text is null then
    return new;
  end if;

  select o.owner_name into v_owner
    from public.property_owners o
   where o.property_id = new.id;

  new.description           := public.redact_owner_details(new.description, v_owner);
  new.marketing_description := public.redact_owner_details(new.marketing_description, v_owner);
  new.post_text             := public.redact_owner_details(new.post_text, v_owner);
  return new;
end;
$$;

comment on function public.properties_redact_owner_details() is
  'מנקה פרטי בעל/ת הנכס משלושת שדות הטקסט הציבוריים של properties, בכל כתיבה ומכל מקור.';

revoke all on function public.properties_redact_owner_details() from public;
revoke all on function public.properties_redact_owner_details() from anon, authenticated;

drop trigger if exists properties_redact_owner_details on public.properties;
create trigger properties_redact_owner_details
  before insert or update on public.properties
  for each row execute function public.properties_redact_owner_details();

-- ---------------------------------------------------------------------------
-- 3. הטריגר על property_owners
--
-- הסדר בשני מסלולי הכתיבה זהה: קודם נשמר הנכס, ורק אחריו פרטי הבעלים —
-- ‏`property_id` הוא מפתח זר, והוא קיים רק אחרי ה-insert. כלומר ברגע שבו
-- ‏§2 רץ על נכס חדש, השם עוד לא היה במסד ולא היה מה להשוות אליו.
--
-- הטריגר הזה סוגר בדיוק את החלון הזה: ברגע שהשם נכנס (או משתנה), הטקסט
-- הציבורי של הנכס נבדק מולו שוב.
--
-- מטא-הדאטה של התיאור השיווקי נשמרת דרך `app.marketing_copy_writer` ושחזור
-- של `marketing_description_at` וטביעת האצבע: מחיקת שם היא לא כתיבה מחדש של
-- הנוסח, ולא נכון שהיא תעביר נוסח של Claude לחשבונו של הסוכן/ת או תאפס
-- סימון "מיושן" שהיה שם בצדק.
-- ---------------------------------------------------------------------------
create or replace function public.property_owners_redact_property_text()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  p record;
begin
  select pr.id, pr.description, pr.marketing_description, pr.post_text,
         pr.marketing_description_source, pr.marketing_description_at,
         pr.marketing_description_fingerprint
    into p
    from public.properties pr
   where pr.id = new.property_id;
  if not found then
    return null;
  end if;

  if public.redact_owner_details(p.description, new.owner_name) is not distinct from p.description
     and public.redact_owner_details(p.marketing_description, new.owner_name)
         is not distinct from p.marketing_description
     and public.redact_owner_details(p.post_text, new.owner_name) is not distinct from p.post_text then
    return null;
  end if;

  perform set_config('app.marketing_copy_writer',
                     case when p.marketing_description_source = 'ai' then 'ai' else 'agent' end,
                     true);

  update public.properties
     set description           = public.redact_owner_details(description, new.owner_name),
         marketing_description = public.redact_owner_details(marketing_description, new.owner_name),
         post_text             = public.redact_owner_details(post_text, new.owner_name)
   where id = p.id;

  -- הנוסח נשאר של מי שכתב אותו, ובמועד שבו נכתב.
  update public.properties
     set marketing_description_at          = p.marketing_description_at,
         marketing_description_fingerprint = p.marketing_description_fingerprint
   where id = p.id
     and marketing_description is not null;

  return null;
end;
$$;

comment on function public.property_owners_redact_property_text() is
  'ברגע ששם בעל/ת הנכס נשמר, מנקה אותו מהטקסט הציבורי של הנכס — החלון שנפתח כי פרטי הבעלים נשמרים אחרי הנכס.';

revoke all on function public.property_owners_redact_property_text() from public;
revoke all on function public.property_owners_redact_property_text() from anon, authenticated;

drop trigger if exists property_owners_redact_property_text on public.property_owners;
create trigger property_owners_redact_property_text
  after insert or update of owner_name on public.property_owners
  for each row
  when (nullif(btrim(coalesce(new.owner_name, '')), '') is not null)
  execute function public.property_owners_redact_property_text();

-- ---------------------------------------------------------------------------
-- 4. מה שכבר שמור
--
-- הטריגרים שומרים על מה שייכתב מכאן והלאה; השורות שכבר במסד הן בדיוק מה
-- שהתלונה הצביעה עליו. שורה-שורה ולא `update` אחד גדול, מאותה סיבה שב-§3:
-- לשמור את מקור התיאור השיווקי, מועדו וטביעת האצבע שלו. מספר הנכסים
-- בפלטפורמה נמדד במאות, והמעבר הזה רץ פעם אחת.
--
-- אידמפוטנטי: הסבב השני לא ימצא מה למחוק ולא יגע באף שורה.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_desc text;
  v_mkt  text;
  v_post text;
  v_rows int := 0;
begin
  for r in
    select p.id, p.description, p.marketing_description, p.post_text,
           p.marketing_description_source, p.marketing_description_at,
           p.marketing_description_fingerprint, o.owner_name
      from public.properties p
      left join public.property_owners o on o.property_id = p.id
     where p.description is not null
        or p.marketing_description is not null
        or p.post_text is not null
  loop
    v_desc := public.redact_owner_details(r.description, r.owner_name);
    v_mkt  := public.redact_owner_details(r.marketing_description, r.owner_name);
    v_post := public.redact_owner_details(r.post_text, r.owner_name);

    if v_desc is distinct from r.description
       or v_mkt is distinct from r.marketing_description
       or v_post is distinct from r.post_text then
      perform set_config('app.marketing_copy_writer',
                         case when r.marketing_description_source = 'ai' then 'ai' else 'agent' end,
                         true);
      update public.properties
         set description = v_desc, marketing_description = v_mkt, post_text = v_post
       where id = r.id;
      update public.properties
         set marketing_description_at          = r.marketing_description_at,
             marketing_description_fingerprint = r.marketing_description_fingerprint
       where id = r.id
         and marketing_description is not null;
      v_rows := v_rows + 1;
    end if;
  end loop;

  raise notice 'redact_owner_details: נוקו % נכסים', v_rows;
end $$;
