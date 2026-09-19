-- ============================================================================
-- מדיניות Pay&GO חלה רק על מי שבאמת נחת/ה ב-Pay&GO
--
-- ‏`tier` ב-`agency_members` יושב על ברירת מחדל `'free'::text`. כלומר כרטיס
-- שנוצר ב-`add-team-member` ועדיין לא נענה קורא "free" מהרגע הראשון — לא
-- כי מישהו בחר Pay&GO, אלא כי איש עוד לא בחר כלום. ההטבה (‏Elite לחצי שנה)
-- מוענקת ב-`grant_launch_promo`, שרצה ב-`join-agency` ברגע ה-bind — הכניסה
-- הראשונה של הסוכן/ת.
--
-- ‏**הפער:** בין יצירת הכרטיס לכניסה הראשונה, `20261120090000` היה קורא את
-- `tier` כלשונו ומחיל את כלל Pay&GO — כלומר מוחק מספרי טלפון מהביו של
-- הסוכן/ת ומהתיאורים של מודעות שהמנהל/ת העלה/תה בשמו/ה, בזמן שמייל ההזמנה
-- שנשלח באותו רגע מבטיח לו/ה מפורשות שישה חודשים ב-Elite. ומכיוון שהמחיקה
-- חד-כיוונית במכוון, הכניסה הראשונה — שמשדרגת ל-Elite — לא מחזירה את הטקסט.
--
-- ‏**הסגירה:** כלל הטלפונים נשאל על **החלטה** ולא על ערך העמודה. כרטיס
-- שיש עליו `tier_source`, או `tier_selected_at`, או `promo_started_at` —
-- עבר החלטה, ו-`free` אצלו הוא Pay&GO אמיתי. כרטיס ששלושתם ריקים בו יושב
-- על ברירת המחדל, וכלל הטלפונים אינו חל עליו.
--
-- ‏**למה לא `user_id is null`**, שהוא הסימן שה-CRM כבר משתמש בו כדי להציג
-- "מסלול — טרם נבחר": הוא מפספס את חלון ה-bind עצמו. ‏`join-agency` קושר
-- קודם את החשבון ורק אחר כך מעניק את ההטבה, ובין שתי הכתיבות `user_id`
-- כבר מלא בזמן ש-`tier` עדיין `free` — בדיוק הרגע שבו הטריגר על
-- `agency_members` היה רץ ומוחק. שלוש עמודות ההחלטה ריקות גם שם.
--
-- **כלל הקישורים לא נגע ולא זז.** הוא חל על כל המסלולים ממילא, ולכן אינו
-- תלוי בשאלה הזו כלל.
--
-- אידמפוטנטית: ‏`create or replace` בלבד, בלי DDL על טבלאות ובלי טריגרים
-- חדשים. אין כאן גם backfill: אין טקסט שנמחק בטעות שצריך לשחזר — וממילא
-- טקסט שנמחק איננו.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. השאלה עצמה, במקום אחד
--
-- שלושת הקוראים למטה שואלים את אותה שאלה. פונקציה משותפת ולא שלושה עותקים
-- של אותו `or`: ברגע שמישהו יוסיף מקור החלטה רביעי, הוא יתווסף כאן פעם
-- אחת — ולא ייזכר בשניים מתוך שלושה מקומות.
--
-- ‏`immutable`: תלויה בארגומנטים בלבד. זה מה שמתיר ל-planner לקפל אותה
-- בתוך ה-`update ... where` של §4 במקום לקרוא לה שורה-שורה.
-- ---------------------------------------------------------------------------
create or replace function public.paygo_text_rules_apply(
  p_tier             text,
  p_tier_source      text,
  p_tier_selected_at timestamptz,
  p_promo_started_at timestamptz
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_tier, 'free') = 'free'
     and (p_tier_source is not null
          or p_tier_selected_at is not null
          or p_promo_started_at is not null);
$$;

comment on function public.paygo_text_rules_apply(text, text, timestamptz, timestamptz) is
  'האם כלל הטלפונים של Pay&GO חל על הכרטיס. free בלי שום סימן להחלטה הוא ברירת המחדל של העמודה — כרטיס שטרם הצטרף — ולא בחירת מסלול.';

revoke all on function public.paygo_text_rules_apply(text, text, timestamptz, timestamptz) from public;
revoke all on function public.paygo_text_rules_apply(text, text, timestamptz, timestamptz) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. הטריגר על `properties`
--
-- זהה ל-`20261120090000` פרט לשליפה: שלוש עמודות ההחלטה מצטרפות ל-`tier`,
-- ו-`v_strip` נגזר מהן. השאר — צבירת `v_what`, שלושת השדות, וההתראה
-- החד-פעמית — כלשונו.
-- ---------------------------------------------------------------------------
create or replace function public.properties_apply_text_policy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_strip     boolean;
  v_what      text[] := '{}';
  v_had_link  boolean := false;
  v_had_phone boolean := false;
begin
  if new.description is null and new.marketing_description is null
     and new.post_text is null then
    return new;
  end if;

  -- כרטיס שלא נמצא (‏agent_id ריק, או מודעה יתומה) אינו "Pay&GO": ‏coalesce
  -- על `select ... into` שלא החזיר שורה משאיר null, ו-`paygo_text_rules_apply`
  -- על ארבעה null מחזירה false. זו גם ההתנהגות הנכונה — אין מי שהחליט.
  select public.paygo_text_rules_apply(
           m.tier, m.tier_source, m.tier_selected_at, m.promo_started_at)
    into v_strip
    from public.agency_members m where m.id = new.agent_id;
  v_strip := coalesce(v_strip, false);

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
  'מחילה את מדיניות התוכן על שלושת שדות הטקסט של properties ומודיעה לסוכן/ת מה הוסר. המסלול נקרא מהסוכן/ת של הנכס, וכלל הטלפונים רק אחרי שהתקבלה החלטת מסלול.';

revoke all on function public.properties_apply_text_policy() from public;
revoke all on function public.properties_apply_text_policy() from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. הטריגר על `agency_members`
--
-- כאן זה קריטי במיוחד, כי הטריגר הוא `before insert or update` על **כל**
-- עמודה: הכתיבה שקושרת את `user_id` ב-bind הייתה מפעילה אותו בזמן ש-`tier`
-- עדיין `free`, ומוחקת את הביו רגע לפני שההטבה משדרגת ל-Elite.
-- ---------------------------------------------------------------------------
create or replace function public.agency_members_apply_text_policy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.bio := public.apply_public_text_policy(
    new.bio,
    public.paygo_text_rules_apply(
      new.tier, new.tier_source, new.tier_selected_at, new.promo_started_at));
  return new;
end;
$$;

comment on function public.agency_members_apply_text_policy() is
  'קישורים מהביו תמיד; טלפונים רק מכרטיס שנחת ב-Pay&GO בפועל, ולא מכרטיס שיושב על ברירת המחדל עד הכניסה הראשונה.';

revoke all on function public.agency_members_apply_text_policy() from public;
revoke all on function public.agency_members_apply_text_policy() from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. ירידת מסלול
--
-- אותו כיוון אחד כמו קודם — **ירידה** ל-Pay&GO מנקה, עלייה אינה משחזרת —
-- אבל "ירידה" נמדדת עכשיו מול החלטה. כרטיס שטרם הצטרף אינו "יורד" כשההטבה
-- נרשמת עליו, ולכן לא ייסחב לכאן.
--
-- התנאי על `old` נשאר על `tier` בלבד: מה שמעניין הוא שהמסלול בפועל השתנה.
-- ---------------------------------------------------------------------------
create or replace function public.agency_members_tier_reapply_policy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.paygo_text_rules_apply(
           new.tier, new.tier_source, new.tier_selected_at, new.promo_started_at)
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
  'ירידה ל-Pay&GO מנקה טלפונים מהמודעות הקיימות של הסוכן/ת, דרך הטריגר של properties. עלייה למסלול בתשלום אינה משחזרת טקסט שנמחק, וכרטיס שטרם הצטרף אינו נחשב ירידה.';

revoke all on function public.agency_members_tier_reapply_policy() from public;
revoke all on function public.agency_members_tier_reapply_policy() from anon, authenticated;
