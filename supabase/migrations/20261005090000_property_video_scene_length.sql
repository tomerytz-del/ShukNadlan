-- ============================================================================
-- סרטון שיווקי: סצנה קצרה יותר, יותר תמונות בסרטון
--
-- שלושה שינויים לבקשת השטח, אחרי הסרטון הראשון שהופק בפועל:
--
--   1. **כל סצנה 2.5 שניות במקום 5.** חמש שניות על תמונה אחת הן ארוכות
--      למודעה — העין מספיקה לקלוט את החדר הרבה לפני שהשוט נגמר.
--   2. **עד שמונה סצנות במקום ארבע.** ‏8 × 2.5 = 20 שניות, אותה תקרה
--      כמו קודם — אבל במקום ארבעה חדרים בסרטון, הצופה רואה שמונה.
--   3. **שום תמונה לא מפוספסת.** ‏`pickScenes` מקבלת תקרה של שמונה ולוקחת
--      ‎min(מספר התמונות, 8)‎, ולכן נכס עם חמש תמונות מקבל חמש סצנות —
--      ולא ארבע כמו עד היום, שהשאירו תמונה אחת בחוץ בלי שאיש ביקש.
--
-- ---------------------------------------------------------------------------
-- ‏2.5 שניות אינן בהכרח מה שהמודל יודע לייצר
-- ---------------------------------------------------------------------------
-- רוב מודלי ה-image-to-video מקבלים ‎duration‎ כרשימה סגורה — אצל Kling זה
-- ‎"5"‎ או ‎"10"‎ בלבד. לכן יש כאן **שני** אורכים ולא אחד:
--
--   ‏property_video_source_seconds  — מה שמבקשים מ-fal לייצר (5)
--   ‏property_video_clip_seconds    — מה שנכנס לסרטון הסופי (2.5)
--
-- הקוד מנסה קודם לבקש 2.5 ישירות. אם המודל דוחה את הערך (שגיאת ולידציה),
-- אותו קליף נשלח מחדש באורך המקור, והבקשה מסומנת ב-‎trim_to_seconds‎ —
-- ואז שלב המיזוג חותך כל קליף ל-2.5 שניות במקום להדביק אותם כמו שהם.
-- כך אותה בקשה מגיעה לסרטון תקין בלי קשר לאיזה מהשניים המודל תומך בו,
-- ובלי סבב פריסה נוסף.
--
-- ---------------------------------------------------------------------------
-- מה זה עושה לעלות
-- ---------------------------------------------------------------------------
-- העלות היא **פר קליפ ולא פר שנייה**: הסרטון הראשון עלה 1.05$ לשלושה קליפים,
-- כלומר ‎0.35$‎ לקליפ. שמונה סצנות הן שמונה קריאות — כ-‎2.8$‎ לסרטון מלא, גם
-- אם כל קליף מקוצר ל-2.5 שניות (כשהמודל מייצר 5 וחותכים, משלמים על ה-5).
--
-- זו הסיבה ש-‎property_video_clip_count‎ נשאר ב-pricing_config ולא בקוד:
-- ירידה לשש סצנות (15 שניות, ‎~2.1$‎) היא ‎update‎ אחד. המספר הזה גם מה
-- שקובע אם ‎property_video_price_mid‎ (₪20) נשאר מרווח סביר.
--
-- הקובץ אידמפוטנטי.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. אורך שאינו שלם
--
-- ‏clip_seconds הוגדרה integer כשכל קליף היה 5 שניות עגולות. ‏2.5 לא נכנס
-- לשם, ולכן העמודה עוברת ל-numeric. ‏using לא נדרש להמרה מרחיבה, אבל הוא
-- כתוב במפורש כדי שהכוונה תהיה ברורה בקריאה.
-- ---------------------------------------------------------------------------
alter table public.property_video_jobs
  alter column clip_seconds type numeric(4,2) using clip_seconds::numeric,
  alter column clip_seconds set default 2.5;

-- אורך המקור שנשלח ל-fal, ו"לכמה לחתוך" כשהמודל לא ידע לייצר את האורך
-- המבוקש. ‏trim_to_seconds ריק = אין מה לחתוך, המיזוג מדביק כמו שהוא.
alter table public.property_video_jobs
  add column if not exists source_seconds  numeric(4,2),
  add column if not exists trim_to_seconds numeric(4,2);

comment on column public.property_video_jobs.source_seconds is
  'האורך שנשלח ל-fal לייצור. שונה מ-clip_seconds כשהמודל לא תומך באורך המבוקש.';
comment on column public.property_video_jobs.trim_to_seconds is
  'כשמלא — שלב המיזוג חותך כל קליף לאורך הזה. מתמלא רק כשהמודל דחה את האורך המבוקש.';

-- ---------------------------------------------------------------------------
-- 2. התמחור והאורכים
-- ---------------------------------------------------------------------------
update public.pricing_config set value = 8,
  description = 'תקרת הסצנות בסרטון. הסרטון לוקח min(מספר התמונות, הערך הזה) — 8 × 2.5 שניות = 20 שניות. כל סצנה היא קריאה בתשלום ל-fal (~0.35$), ולכן זה גם הבלם התקציבי.'
 where key = 'property_video_clip_count';

update public.pricing_config set value = 2.5,
  description = 'אורך כל סצנה בסרטון הסופי, בשניות. כשהמודל לא יודע לייצר את האורך הזה — מייצרים ב-property_video_source_seconds וחותכים במיזוג.'
 where key = 'property_video_clip_seconds';

insert into public.pricing_config (key, value, description) values
  ('property_video_source_seconds', 5,
   'האורך שמבקשים מ-fal לייצר כשהאורך המבוקש נדחה. אצל Kling הערכים החוקיים הם 5 ו-10 בלבד.')
on conflict (key) do update
  set value = excluded.value, description = excluded.description;

-- ‏min_clips נשאר 2, אבל המשמעות השתנתה: שתי סצנות הן היום 5 שניות ולא 10.
update public.pricing_config set value = 3,
  description = 'מתחת למספר הזה של תמונות מתאימות הבקשה נדחית. שלוש סצנות × 2.5 = 7.5 שניות, הרצף הקצר ביותר שעוד נראה כמו סרטון.'
 where key = 'property_video_min_clips';

-- ---------------------------------------------------------------------------
-- 3. ‏p_clip_seconds הופך ל-numeric
--
-- החתימה הקודמת קיבלה ‎integer‎, ולכן 2.5 היה נחתך ל-2 **בשקט** — הבקשה
-- הייתה נפתחת, הסרטון יוצא באורך אחר מהמבוקש, ואף שגיאה לא נזרקת. שינוי
-- טיפוס של פרמטר אינו נתמך ב-‎create or replace‎ (הוא יוצר עומס-יתר נוסף
-- במקום להחליף), ולכן הישנה נמחקת קודם.
-- ---------------------------------------------------------------------------
drop function if exists public.start_property_video_job(uuid, uuid, text, integer, text, boolean);

create or replace function public.start_property_video_job(
  p_property_id      uuid,
  p_agent_id         uuid,
  p_webhook_token    text,
  p_clip_seconds     numeric,
  p_aspect_ratio     text,
  p_replace_existing boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tier      text;
  v_price     numeric;
  v_cap       numeric;
  v_used      integer;
  v_video     text;
  v_charged   numeric := 0;
  v_rows      int;
  v_job_id    uuid;
begin
  v_tier := public.property_video_tier(p_property_id, p_agent_id);
  if v_tier is null then
    return jsonb_build_object('error', 'not_eligible');
  end if;

  if exists (
    select 1 from public.property_video_jobs
    where property_id = p_property_id
      and status in ('generating_clips','merging','uploading')
  ) then
    return jsonb_build_object('error', 'job_in_progress');
  end if;

  select video_url into v_video from public.properties where id = p_property_id;
  if v_video is not null and not p_replace_existing then
    return jsonb_build_object('error', 'video_exists', 'video_url', v_video);
  end if;

  if v_tier = 'premium' then
    select coalesce(value, 8) into v_cap
    from public.pricing_config where key = 'property_video_premium_monthly_cap';
    v_cap := coalesce(v_cap, 8);

    select count(*) into v_used
    from public.property_video_jobs
    where agent_id = p_agent_id
      and status <> 'failed'
      and created_at >= date_trunc('month', now());

    if v_used >= v_cap then
      return jsonb_build_object('error', 'monthly_cap_reached', 'cap', v_cap, 'used', v_used);
    end if;
  else
    select coalesce(value, 20) into v_price
    from public.pricing_config where key = 'property_video_price_mid';
    v_price := coalesce(v_price, 20);

    update public.agency_members
       set credit_balance = credit_balance - v_price
     where id = p_agent_id and credit_balance >= v_price;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      return jsonb_build_object('error', 'insufficient_balance', 'required', v_price);
    end if;
    v_charged := v_price;
  end if;

  insert into public.property_video_jobs (
    property_id, agent_id, status, tier_at_request, amount_charged,
    clip_seconds, aspect_ratio, webhook_token, previous_video_url, replaced_existing
  ) values (
    p_property_id, p_agent_id, 'generating_clips', v_tier, v_charged,
    coalesce(p_clip_seconds, 2.5), coalesce(p_aspect_ratio, '16:9'),
    p_webhook_token, v_video, (v_video is not null)
  )
  returning id into v_job_id;

  if v_charged > 0 then
    insert into public.property_video_charges (job_id, property_id, agent_id, amount, status)
    values (v_job_id, p_property_id, p_agent_id, v_charged, 'charged');
  end if;

  return jsonb_build_object(
    'success', true,
    'job_id', v_job_id,
    'tier', v_tier,
    'amount_charged', v_charged,
    'previous_video_url', v_video
  );
end;
$$;

comment on function public.start_property_video_job(uuid, uuid, text, numeric, text, boolean) is
  'פותחת בקשת הפקת סרטון וגובה את התשלום באותה טרנזקציה. ל-service_role בלבד, דרך property-video-create.';

revoke all on function public.start_property_video_job(uuid, uuid, text, numeric, text, boolean) from public;
revoke all on function public.start_property_video_job(uuid, uuid, text, numeric, text, boolean) from anon;
revoke all on function public.start_property_video_job(uuid, uuid, text, numeric, text, boolean) from authenticated;
grant execute on function public.start_property_video_job(uuid, uuid, text, numeric, text, boolean) to service_role;
