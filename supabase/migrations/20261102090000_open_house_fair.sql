-- ============================================================================
-- יריד הבתים הפתוחים
--
-- נכס שהמתווך/ת מסמן/ת ב-CRM כמשתתף ביריד מוצע **ללא עמלת תיווך לקונה**,
-- ורק בתוך חלון תאריכים שהוא/היא מגדיר/ה. זו הבטחה מסחרית עם תאריך תפוגה,
-- ולכן היא לא יכולה להיות דגל בודד: דגל בלי חלון היה נשאר דלוק לנצח, ונכס
-- היה ממשיך להיות מוצג כ"ללא עמלה" חודשים אחרי שהמבצע נגמר.
--
-- שלוש עמודות, וכולן חובה יחד (‏check למטה):
--   ‏open_house        — הסימון עצמו
--   ‏open_house_start  — מתי הנכס נכנס ליריד
--   ‏open_house_end    — מתי הוא יוצא ממנו
--
-- ועוד אחת שנכתבת לבד: ‏open_house_joined_at — הפעם הראשונה שהנכס נכנס
-- ליריד. היא לא נגזרת מ-start, כי start הוא תאריך *מוצהר* שאפשר לערוך
-- אחורה בעריכה; ‏joined_at הוא מה שקרה בפועל, והוא זה שקובע מי "חדש ביריד"
-- בתצוגה.
--
-- שני מנגנוני כיבוי, ובכוונה:
--   1. ‏expire_open_house() ב-cron כל רבע שעה — מכבה את הדגל עצמו.
--   2. **התצוגה בודקת תאריכים ולא את הדגל** (‏assets/open-house.js) — כי
--      רבע שעה של פיגור אחרי חצות היא רבע שעה שבה האתר מבטיח ללא עמלה
--      למי שכבר לא זכאי/ת לה.
-- ה-cron הוא מה שמנקה את המסד; ה-JS הוא מה ששומר על ההבטחה.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. העמודות
-- ---------------------------------------------------------------------------
alter table public.properties
  add column if not exists open_house           boolean not null default false,
  add column if not exists open_house_start     timestamptz,
  add column if not exists open_house_end       timestamptz,
  add column if not exists open_house_joined_at timestamptz;

comment on column public.properties.open_house is
  'הנכס משתתף ביריד הבתים הפתוחים — מוצע ללא עמלת תיווך לקונה בתוך החלון שבעמודות start/end.';
comment on column public.properties.open_house_start is
  'תחילת חלון היריד. חובה כש-open_house דלוק.';
comment on column public.properties.open_house_end is
  'סוף חלון היריד. חובה כש-open_house דלוק, וגדול מ-start. expire_open_house() מכבה את הדגל אחריו.';
comment on column public.properties.open_house_joined_at is
  'מתי הנכס נכנס ליריד בפועל (נכתב בטריגר). לא ניתן לעריכה מהטופס, בשונה מ-open_house_start.';

-- ---------------------------------------------------------------------------
-- 2. סימון בלי חלון אינו סימון
--
-- ה-check נכתב כ"או שהדגל כבוי, או ששני התאריכים קיימים והסוף אחרי
-- ההתחלה". נכס שיוצא מהיריד שומר את התאריכים (הם ההיסטוריה שלו, וה-CRM
-- מציג אותם) — ולכן אין כאן דרישה שהם יתרוקנו.
--
-- **מה שה-check *לא* אוכף הוא אורך החלון ותאריך בעבר.** האורך המרבי יושב
-- ב-pricing_config ונאכף בטופס: הוא כלל מוצר שישתנה (יריד קיץ ארוך יותר
-- מיריד של סוף שבוע), ו-check קשיח היה דורש מיגרציה בכל שינוי כזה. חלון
-- שנגמר בעבר נחסם בטופס ונסגר ממילא ב-cron בריצה הבאה.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'properties_open_house_window_chk') then
    alter table public.properties
      add constraint properties_open_house_window_chk check (
        open_house = false
        or (open_house_start is not null
            and open_house_end is not null
            and open_house_end > open_house_start)
      );
  end if;
end $$;

-- הדף הציבורי של היריד שולף בדיוק את השורות האלה: דגל דלוק, חלון שמכיל את
-- ‏now(). אינדקס חלקי — המשתתפים הם מיעוט קטן מתוך כלל הנכסים הפעילים.
create index if not exists properties_open_house_idx
  on public.properties(open_house_end desc)
  where open_house = true;

-- ---------------------------------------------------------------------------
-- 3. מתי הנכס נכנס ליריד בפועל
--
-- הטריגר כותב ‎joined_at‎ רק במעבר כבוי→דלוק, ולא בכל שמירה של נכס שכבר
-- ביריד: עריכת מחיר באמצע החלון אינה כניסה מחדש ליריד, ואם היא הייתה
-- מאפסת את השדה — "חדשים ביריד" היה מדרג לפי מי ערך אחרון.
-- ---------------------------------------------------------------------------
create or replace function public.touch_open_house_joined()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.open_house and (tg_op = 'INSERT' or coalesce(old.open_house, false) = false) then
    new.open_house_joined_at := coalesce(new.open_house_joined_at, now());
  end if;
  return new;
end;
$$;

comment on function public.touch_open_house_joined() is
  'מחתים open_house_joined_at ברגע שנכס נכנס ליריד הבתים הפתוחים. רץ לפני insert/update על properties.';

drop trigger if exists properties_open_house_joined on public.properties;
create trigger properties_open_house_joined
  before insert or update of open_house on public.properties
  for each row execute function public.touch_open_house_joined();

-- ---------------------------------------------------------------------------
-- 4. כיבוי בתום החלון
--
-- אותו דפוס בדיוק של expire_promotions(): דגל שנשאר דלוק אחרי שהחלון נגמר
-- הוא הבטחה שהאתר ממשיך להציג ואיש לא עומד מאחוריה. התאריכים עצמם נשארים.
-- ---------------------------------------------------------------------------
create or replace function public.expire_open_house()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows int;
begin
  update public.properties
     set open_house = false
   where open_house = true
     and open_house_end is not null
     and open_house_end <= now();
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

comment on function public.expire_open_house() is
  'מכבה את open_house לנכסים שחלון היריד שלהם נגמר. רצה ב-cron כל 15 דקות.';

revoke all on function public.expire_open_house() from public;
revoke all on function public.expire_open_house() from anon;
revoke all on function public.expire_open_house() from authenticated;

-- הדקה 7 ולא 0: ‏expire-promotions כבר יושבת על */15 בדקות העגולות, ושתי
-- משימות שנוגעות באותה טבלה באותו רגע נועלות זו את זו ללא צורך.
select cron.unschedule('expire-open-house')
where exists (select 1 from cron.job where jobname = 'expire-open-house');

select cron.schedule('expire-open-house', '7-59/15 * * * *', $$select public.expire_open_house()$$);

-- ---------------------------------------------------------------------------
-- 5. כללי המוצר, במקום שבו כל שאר הכללים יושבים
--
-- ‏open_house_max_days — התקרה שהטופס ב-CRM אוכף על אורך החלון. מתווך/ת
-- שמגדיר/ה "בית פתוח" לשנה שלמה אינו/ה משתתף/ת ביריד אלא מוריד/ה את
-- העמלה, וזה כבר מוצר אחר.
--
-- ההשתתפות עצמה **אינה בתשלום ואינה מותנית במסלול**: היריד הוא מבצע של
-- הפלטפורמה כולה, ומדף שמוצג בו רק למסלולים העליונים אינו יריד.
-- ---------------------------------------------------------------------------
insert into public.pricing_config (key, value, description)
values ('open_house_max_days', 30, 'מספר הימים המרבי שנכס יכול להיות ביריד הבתים הפתוחים בחלון אחד')
on conflict (key) do nothing;
