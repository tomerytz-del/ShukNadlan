-- ============================================================================
-- מדריך ההתחלה לבעלי מקצוע (21.11.2026)
--
-- כרטיסיית בעל/ת מקצוע נפתחת עם מינימום: שם וטלפון. בלי תמונה, בלי משפט פתיחה ובלי שירותים הדף ציבורי
-- וריק, ושום דבר בו אינו שגיאה, ולכן שום דבר לא מדווח על עצמו (אותה בעיה של docs/agent-onboarding.md
-- ושל מדריך היזמים ב-docs/new-projects.md). אותו עיקרון: **מצב אחד שמחושב במסד מהמציאות בכל קריאה**.
--
-- **הצעדים (הרשימה שאושרה):** תמונת פרופיל · משפט פתיחה ותיאור (40 תווים) · שירותים ואזורי פעילות · טלפון.
-- רשות: תמונת נושא, גלריה (3 תמונות), שנות ניסיון, קישור לאתר, סרטון.
--
-- **תזכורות במייל: אחת אחרי 3 ימים ואחת אחרי 10, רק אם נשאר צעד חובה פתוח,** עם הקישור האישי לעריכה.
-- כרטיסיות שנפתחו לפני המיגרציה מסומנות כמי שקיבלו את שתיהן (פעם אחת, כשהעמודה נוצרת): לא כותבים
-- להן יוזמה שלא ביקשו. הפונקציה ששולחת והתזמון מגיעים בשלב 2, יחד.
--
-- אידמפוטנטית.
-- ============================================================================

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'ad_placements'
                    and column_name = 'onboarding_reminders_sent') then
    alter table public.ad_placements
      add column onboarding_reminders_sent smallint not null default 0,
      add column onboarding_reminder_at    timestamptz,
      add column onboarding_attempt_at     timestamptz;
    update public.ad_placements set onboarding_reminders_sent = 2;
  end if;
end $$;

comment on column public.ad_placements.onboarding_attempt_at is
  'מועד הניסיון האחרון לשלוח תזכורת, הצליח או נכשל. ניסיון חוזר אחרי כישלון: יום. נקבע ב-mark_professional_onboarding_reminder.';
comment on column public.ad_placements.onboarding_reminder_at is
  'מועד השליחה המוצלחת האחרונה (המרווח של שבוע בין התזכורות נמדד ממנו).';

comment on column public.ad_placements.onboarding_reminders_sent is
  'כמה תזכורות מדריך התחלה במייל נשלחו (0-2); 2 גם למי שהשלים את המדריך לפני התזכורת. נקבע רק ב-mark_professional_onboarding_reminder וב-professional_onboarding_reminders_due.';

create or replace function public.professional_onboarding_state(p_placement_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c        public.ad_placements;
  v_intro  text[] := '{}';
  v_offer  text[] := '{}';
  v_steps  jsonb;
  v_done   int;
  v_next   text;
begin
  select * into c from public.ad_placements where id = p_placement_id and placement_type = 'professional_card';
  if not found then
    return jsonb_build_object('error', 'placement_not_found');
  end if;

  if coalesce(btrim(c.headline), '') = '' then v_intro := array_append(v_intro, 'משפט פתיחה'::text); end if;
  if char_length(coalesce(btrim(c.description), '')) < 40 then v_intro := array_append(v_intro, 'תיאור'::text); end if;
  if coalesce(cardinality(c.services), 0) = 0 then v_offer := array_append(v_offer, 'שירותים'::text); end if;
  if coalesce(cardinality(c.service_areas), 0) = 0 then v_offer := array_append(v_offer, 'אזורי פעילות'::text); end if;

  v_steps := jsonb_build_array(
    jsonb_build_object('id', 'photo', 'optional', false,
      'done', coalesce(btrim(c.creative_url), '') <> '', 'detail', '[]'::jsonb),
    jsonb_build_object('id', 'intro', 'optional', false,
      'done', cardinality(v_intro) = 0, 'detail', to_jsonb(v_intro)),
    jsonb_build_object('id', 'offer', 'optional', false,
      'done', cardinality(v_offer) = 0, 'detail', to_jsonb(v_offer)),
    jsonb_build_object('id', 'phone', 'optional', false,
      'done', coalesce(btrim(c.phone_e164), '') <> '', 'detail', '[]'::jsonb),
    jsonb_build_object('id', 'cover', 'optional', true,
      'done', coalesce(btrim(c.cover_url), '') <> '', 'detail', '[]'::jsonb),
    jsonb_build_object('id', 'gallery', 'optional', true,
      'done', coalesce(cardinality(c.gallery_urls), 0) >= 3, 'detail', '[]'::jsonb),
    jsonb_build_object('id', 'years', 'optional', true,
      'done', c.years_experience is not null, 'detail', '[]'::jsonb),
    jsonb_build_object('id', 'website', 'optional', true,
      'done', coalesce(btrim(c.click_url), '') <> '', 'detail', '[]'::jsonb),
    jsonb_build_object('id', 'video', 'optional', true,
      'done', coalesce(btrim(c.video_url), '') <> '', 'detail', '[]'::jsonb));

  select count(*) filter (where (s->>'done')::boolean and not (s->>'optional')::boolean),
         (select s2->>'id' from jsonb_array_elements(v_steps) s2
           where not (s2->>'done')::boolean and not (s2->>'optional')::boolean limit 1)
    into v_done, v_next
    from jsonb_array_elements(v_steps) s;

  return jsonb_build_object('steps', v_steps, 'done_count', v_done, 'total', 4,
                            'next', v_next, 'complete', v_done = 4);
end;
$$;

create or replace function public.professional_onboarding_reminders_due(p_limit int default 20)
returns table (placement_id uuid, email text, advertiser_name text, manage_token uuid, card_status text, reminder_no int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  r      record;
  v_out  int := 0;
  v_max  int := greatest(1, least(coalesce(p_limit, 20), 100));
begin
  -- קודם הסינון הזול, ורק אחריו חישוב המצב. כרטיסייה פעילה או שממתינה לאישור, לא בדיקה, עם מייל וקישור עריכה
  for r in
    select p.id, p.contact_email, p.advertiser_name, a.manage_token, p.status, p.onboarding_reminders_sent
      from public.ad_placements p
      join public.ad_placement_access a on a.placement_id = p.id
     where p.placement_type = 'professional_card'
       and p.status in ('active', 'pending_approval')
       and coalesce(p.test_mode, false) = false
       and p.contact_email is not null and btrim(p.contact_email) <> ''
       and p.onboarding_reminders_sent < 2
       and p.created_at <= now() - case p.onboarding_reminders_sent when 0 then interval '3 days'
                                                                    else interval '10 days' end
       -- חלון של 30 יום מהפתיחה: כתובת שנכשלת תמיד אינה מנוסה לנצח (גם תנאי ה-cron נעצר איתה)
       and p.created_at > now() - interval '30 days'
       -- ניסיון חוזר אחרי כישלון: יום (בשתי התזכורות). והתזכורת השנייה לפחות שבוע אחרי **השליחה**
       -- הראשונה, גם אם הראשונה התעכבה בגלל כשלי מייל
       and coalesce(p.onboarding_attempt_at, 'epoch'::timestamptz) <= now() - interval '1 day'
       and (p.onboarding_reminders_sent = 0
            or coalesce(p.onboarding_reminder_at, 'epoch'::timestamptz) <= now() - interval '7 days')
     -- מי שהמייל שלו נכשל יורד לסוף התור, אחרת כתובות פגומות חוסמות את כולם
     order by coalesce(p.onboarding_attempt_at, p.created_at)
     limit 200
  loop
    exit when v_out >= v_max;

    if coalesce((public.professional_onboarding_state(r.id)->>'complete')::boolean, false) then
      update public.ad_placements set onboarding_reminders_sent = 2 where id = r.id;
      continue;
    end if;

    placement_id    := r.id;
    card_status     := r.status;
    email           := r.contact_email;
    advertiser_name := r.advertiser_name;
    manage_token    := r.manage_token;
    reminder_no     := r.onboarding_reminders_sent + 1;
    v_out := v_out + 1;
    return next;
  end loop;
end;
$$;

create or replace function public.mark_professional_onboarding_reminder(p_placement_id uuid, p_no int)
returns void
language sql
security definer
set search_path = ''
as $$
  -- רק קדימה: סימון חוזר אינו מחזיר אחורה ואינו מכפיל. מועד השליחה (שממנו נמדד השבוע) נקבע רק כשהמונה
  -- עולה בפועל; p_no נמוך או שווה למונה (ניסיון שנכשל) מעדכן רק את מועד הניסיון. הערכים בצד ימין הם
  -- של לפני העדכון, ולכן ההשוואה נכונה
  update public.ad_placements
     set onboarding_reminders_sent = greatest(onboarding_reminders_sent, p_no),
         onboarding_reminder_at = case when p_no > onboarding_reminders_sent then now() else onboarding_reminder_at end,
         onboarding_attempt_at = now()
   where id = p_placement_id;
$$;

revoke all on function public.professional_onboarding_state(uuid) from public, anon, authenticated;
grant execute on function public.professional_onboarding_state(uuid) to service_role;

revoke all on function public.professional_onboarding_reminders_due(int) from public, anon, authenticated;
grant execute on function public.professional_onboarding_reminders_due(int) to service_role;

revoke all on function public.mark_professional_onboarding_reminder(uuid, int) from public, anon, authenticated;
grant execute on function public.mark_professional_onboarding_reminder(uuid, int) to service_role;
