-- ============================================================================
-- השלמת קואורדינטות אוטומטית לנכסים שיש להם כתובת מדויקת
--
-- ## מה שבור היום
--
-- נכס בלי `lat`/`lng` פשוט **נעלם מכל מפה** — מפת החיפוש בדף הבית, המפה
-- בדף הנכס, והמפה של יריד הבתים הפתוחים. הוא נטען, הוא נראה תקין ברשימה,
-- והוא חסר בדיוק במקום שבו מחפשים אותו לפי אזור.
--
-- הקואורדינטות נכתבות היום בנקודה **אחת**: טופס הנכס ב-CRM, שקורא ל-
-- ‏geocode-address בזמן שמירה כשיש רחוב+מספר בית בעפולה ואין קואורדינטות.
-- כל דרך אחרת שבה נכס נכנס למסד — ובראשה אשף הייבוא המרוכז — לא עוברת שם.
-- בפועל: 15 נכסים פעילים בלי קואורדינטות, 14 מהם עם כתובת עפולאית מלאה
-- שהשכבה של העירייה יודעת לתרגם. אין שום סיבה שהם יהיו מחוץ למפה.
--
-- ## למה cron ולא "לתקן את אשף הייבוא"
--
-- גם צריך, אבל זה לא מספיק ולא זה העיקר: תיקון באשף לא נוגע ב-15 שכבר
-- במסד, ולא עוזר לנכס שנשמר בדיוק בדקה שבה ה-WFS של העירייה היה למטה
-- (זה קורה, והקריאה בטופס מוותרת בשקט ביודעין כדי לא לחסום שמירה). סורק
-- תקופתי הוא המקום היחיד שבו "יש כתובת ואין פין" נסגר ללא תלות במסלול
-- שדרכו הנכס נוצר.
--
-- ## המצב שנשמר כאן
--
-- שלוש עמודות על properties, כדי שהסורק לא ינסה את אותו נכס בלולאה:
--   geocode_attempted_at — מתי ניסינו לאחרונה (חלון ההמתנה)
--   geocode_attempts     — כמה פעמים השכבה אמרה "אין כזו כתובת"
--   geocode_error        — מה קרה בפעם האחרונה, לאבחון
--
-- ‏geocode_attempts עולה **רק** על תשובה סופית ("לא נמצא"), לא על תקלת
-- תקשורת. ‏WFS שנפל ליומיים אינו ראיה על הכתובת, ואם נספור אותו נשרוף את
-- שלושת הניסיונות של כל הנכסים בדיוק ביום שבו השירות למטה — ואז הם לא
-- ייבדקו שוב לעולם. תקלה חוזרת מותירה את הנכס בתור בקצב של פעם ביום, וזו
-- עלות זניחה שנסגרת מעצמה כשהשכבה חוזרת.
--
-- ## מה העדכון נוגע
--
-- ‏lat/lng בלבד. אף טריגר על properties לא מגיב לשתי העמודות האלה:
-- ‏saved_search / client_match מפורטים בעמודות ספציפיות שלא כוללות אותן,
-- ו-property_marketing_fingerprint לא כולל אותן. הדבר היחיד שכן זז הוא
-- `updated_at` (טריגר set_updated_at), וזה מקפיץ נכס פעם אחת בראש רשימת
-- הנכסים ב-CRM שממוינת לפיו. זה המחיר, והוא חד-פעמי לנכס.
-- ============================================================================

alter table public.properties
  add column if not exists geocode_attempted_at timestamptz,
  add column if not exists geocode_attempts     smallint not null default 0,
  add column if not exists geocode_error        text;

comment on column public.properties.geocode_attempted_at is
  'מתי geocode-backfill ניסה לאחרונה להשלים lat/lng לנכס הזה.';
comment on column public.properties.geocode_attempts is
  'כמה פעמים שכבת הכתובות של העירייה החזירה "לא נמצא". תקלות תקשורת אינן נספרות.';
comment on column public.properties.geocode_error is
  'תוצאת הניסיון האחרון: address_not_found / הודעת התקלה. null = הצליח או טרם נוסה.';

-- ---------------------------------------------------------------------------
-- מי בתור
--
-- הגדרה אחת שמשרתת גם את השרת (שבוחר שורות) וגם את ה-cron (שמחליט אם
-- לדלוק) — פונקציה שמחזירה שורות, ולא תנאי שכתוב פעמיים ויתפצל.
--
-- ‏city = 'עפולה' כי זו השכבה היחידה שיש לנו. יום שבו תתווסף עיר נוספת,
-- התנאי כאן הוא המקום שמשתנה.
-- ---------------------------------------------------------------------------
create or replace function public.geocode_backfill_queue(
  p_limit         integer  default 25,
  p_max_attempts  smallint default 3,
  p_retry_after   interval default interval '20 hours'
)
returns table (id uuid, street text, house_number text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.street, p.house_number
    from public.properties p
   where p.status = 'active'
     and p.city = 'עפולה'
     and (p.lat is null or p.lng is null)
     and nullif(btrim(coalesce(p.street, '')), '')       is not null
     and nullif(btrim(coalesce(p.house_number, '')), '') is not null
     and p.geocode_attempts < p_max_attempts
     and (p.geocode_attempted_at is null
          or p.geocode_attempted_at < now() - p_retry_after)
   order by p.geocode_attempted_at asc nulls first, p.created_at desc
   limit greatest(p_limit, 0);
$$;

comment on function public.geocode_backfill_queue(integer, smallint, interval) is
  'נכסים פעילים בעפולה עם כתובת מלאה ובלי קואורדינטות, שעוד לא מיצו ניסיונות. התור של geocode-backfill.';

revoke all on function public.geocode_backfill_queue(integer, smallint, interval) from public, anon, authenticated;
-- ‏grant מפורש: ה-revoke מ-public מסיר את ההרשאה גם מ-service_role שקיבל
-- אותה דרכו, והפונקציה נקראת בדיוק במפתח הזה.
grant execute on function public.geocode_backfill_queue(integer, smallint, interval) to service_role;

-- ---------------------------------------------------------------------------
-- תנאי הדליקה של ה-cron
--
-- ‏superset ולא subset, כמו שאר תנאי ה-cron בפרויקט (ראו
-- 20261021090000_cron_conditional_dispatch.sql): "יש לפחות שורה אחת בתור".
-- גודל האצווה וההגבלות המדויקות נשארים בשרת.
-- ---------------------------------------------------------------------------
create or replace function public.geocode_backfill_pending()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.geocode_backfill_queue(1));
$$;

comment on function public.geocode_backfill_pending() is
  'האם יש נכס שממתין להשלמת קואורדינטות. תנאי הדליקה של ה-cron geocode-backfill.';

revoke all on function public.geocode_backfill_pending() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- רישום תוצאה
--
-- פקודה אחת ולא update מ-PostgREST: ‏`geocode_attempts = geocode_attempts + 1`
-- אינו ניתן לביטוי שם בלי לקרוא קודם את הערך, וקריאה-ואז-כתיבה היא מרוץ מול
-- הסבב הבא. שלוש התוצאות עוברות דרך כאן:
--   הצליח           -> p_lat/p_lng, p_error = null   (המונה לא זז, השגיאה נמחקת)
--   לא נמצא         -> p_error = 'address_not_found' (המונה עולה)
--   תקלה            -> p_error = <ההודעה>            (המונה לא זז, ננסה מחר)
-- ---------------------------------------------------------------------------
create or replace function public.geocode_record_result(
  p_id    uuid,
  p_lat   double precision,
  p_lng   double precision,
  p_error text
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.properties
     set lat                  = coalesce(p_lat, lat),
         lng                  = coalesce(p_lng, lng),
         geocode_attempted_at = now(),
         geocode_attempts     = case when p_error = 'address_not_found'
                                     then geocode_attempts + 1
                                     else geocode_attempts end,
         geocode_error        = p_error
   where id = p_id;
$$;

comment on function public.geocode_record_result(uuid, double precision, double precision, text) is
  'רושם את תוצאת הניסיון של geocode-backfill לנכס אחד. ל-service_role בלבד.';

revoke all on function public.geocode_record_result(uuid, double precision, double precision, text) from public, anon, authenticated;
grant execute on function public.geocode_record_result(uuid, double precision, double precision, text) to service_role;

-- ---------------------------------------------------------------------------
-- התזמון
--
-- פעם בשעה, ורק כשיש עבודה: ‏select … where <תנאי> בלי from מייצר אפס שורות
-- כשהתנאי שקרי, ואז net.http_post כלל אינו מוערך. ברוב השעות אין מה להשלים,
-- ולכן זה no-op בעלות של בדיקת אינדקס.
--
-- הדקה 41: הדקות העגולות (expire-promotions), 7 (expire-open-house) ו-11
-- (open-house-notify) כבר תפוסות, ומשימות שנוגעות ב-properties באותו רגע
-- נועלות זו את זו ללא צורך.
--
-- ‏timeout_milliseconds := 30000 ולא ברירת המחדל של pg_net (5 שניות): אצווה
-- של 25 נכסים היא 25 קריאות WFS סדרתיות, וזה חוצה חמש שניות בוודאות. ראו
-- 20261030090000_cron_http_timeout.sql — שם זה התגלה כ-"500 EDGE_FUNCTION_ERROR"
-- שהוא בכלל ניתוק מצד הקורא.
-- ---------------------------------------------------------------------------
do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/geocode-backfill';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן — אין מה לתזמן';
    return;
  end if;

  perform cron.unschedule('geocode-backfill')
    where exists (select 1 from cron.job where jobname = 'geocode-backfill');

  perform cron.schedule('geocode-backfill', '41 * * * *', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1))),
      timeout_milliseconds := 30000
    )
    where public.geocode_backfill_pending()
  $cron$, v_url));
end $$;
