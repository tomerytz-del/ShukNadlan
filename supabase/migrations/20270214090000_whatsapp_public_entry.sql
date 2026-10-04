-- ============================================================================
-- פניות לגבריאלה מהאתר - ספירה יומית לתצוגת מנהל/ת הפלטפורמה
--
-- השאלה: כמה אנשים שאינם סוכנים פתחו שיחה עם גבריאלה בכל יום, וכמה מהם
-- הגיעו מכפתור באתר. עד היום התשובה הייתה רק ב-GA4 (‏contact_bot), כלומר
-- **לחיצה** על הכפתור - לא הודעה שנשלחה בפועל, ובלי מי שיש לו/ה חוסם
-- פרסומות.
--
-- למה עמודה ביומן ולא ספירה מגוף ההודעה בזמן הדוח: ‏purge_whatsapp_public_conversations
-- מאפסת את `body` של הודעות ציבוריות אחרי 30 יום. דוח שמסווג לפי הטקסט
-- היה מאבד את ההיסטוריה שלו בשקט, חודש אחרי חודש. לכן הסיווג נחתם ברגע
-- הקליטה, ב-Edge Function, והטקסט יכול להימחק אחריו.
--
--   ‏public_entry - רק על ההודעה **הפותחת** שיחה ציבורית (היסטוריה ריקה, או
--   ‏12 שעות שקט - ‏PUBLIC_IDLE_RESET_HOURS ב-index.ts). שורה אחת = פנייה
--   אחת. הערכים:
--     homepage      - כרטיס גבריאלה בדף הבית ("הגעתי מדף הבית")
--     search_empty  - מסך אפס התוצאות ("חיפשתי באתר ... ולא מצאתי")
--     site          - הודעת ברירת המחדל של bot-link.js ("הגעתי מהאתר")
--     direct        - כל פתיחה אחרת: מי ששמר/ה את המספר, כרטיס איש הקשר,
--                     או מי שמחק/ה את ההודעה המוכנה וכתב/ה משהו משלו/ה.
--   הזיהוי והסיבות: siteEntryOf() ב-whatsapp-webhook/index.ts.
--
-- אין כאן PII: ערך אחד מתוך ארבעה. הדוח מחזיר ספירות בלבד.
-- ============================================================================

alter table public.whatsapp_messages
  add column if not exists public_entry text;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'whatsapp_messages_public_entry_check') then
    alter table public.whatsapp_messages
      add constraint whatsapp_messages_public_entry_check
      check (public_entry is null
             or public_entry in ('homepage', 'search_empty', 'site', 'direct'));
  end if;
end;
$$;

comment on column public.whatsapp_messages.public_entry is
  'על הודעה נכנסת שפותחת שיחה ציבורית (מי שאינו סוכן/ת): מאיפה הגיע/ה הפונה - homepage / search_empty / site / direct. נחתם בקליטה, כי body נמחק אחרי 30 יום. ‏docs/whatsapp-public-bot.md.';

create index if not exists whatsapp_messages_public_entry_idx
  on public.whatsapp_messages (created_at desc)
  where public_entry is not null;

-- ---------------------------------------------------------------------------
-- מילוי למפרע
--
-- הכפתורים באתר נדלקו ב-3.10.2026, ו-body נמחק רק אחרי 30 יום - כלומר כל
-- פנייה מהאתר עדיין נושאת את הטקסט שלה. פנייה ישנה יותר שה-body שלה כבר
-- נמחק אינה יכולה להיות מהאתר, ולכן `direct` נכון גם לה.
--
-- ‏"פותחת שיחה" כאן = אין הודעה נכנסת קודמת מאותו מספר ב-12 השעות שלפניה,
-- אותו כלל כמו בפונקציה. סוכנים מוחרגים גם כשהשורה שלהם נשארה בלי
-- ‏agent_id (סוכן/ת לא פעיל/ה מקבל/ת תשובה בלי עדכון השורה), וכך גם הודעות
-- "אימות חתימה" - חותם/ת על הסכם אינו/ה פנייה לגבריאלה.
-- ---------------------------------------------------------------------------
with pub as (
  select m.id, m.body, m.created_at,
         lag(m.created_at) over (partition by m.wa_phone order by m.created_at) as prev_at
    from public.whatsapp_messages m
   where m.direction = 'in'
     and m.agent_id is null
     and not exists (select 1 from public.agency_members a
                      where a.phone_e164 = m.wa_phone)
)
update public.whatsapp_messages w
   set public_entry = case
         when p.body like '%מדף הבית%'    then 'homepage'
         when p.body like '%חיפשתי באתר%' then 'search_empty'
         when p.body like '%הגעתי מהאתר%' then 'site'
         else 'direct'
       end
  from pub p
 where w.id = p.id
   and w.public_entry is null
   and (p.prev_at is null or p.created_at - p.prev_at > interval '12 hours')
   and coalesce(p.body, '') not like 'אימות חתימה%';

-- ---------------------------------------------------------------------------
-- הדוח
--
-- אותה תבנית כמו platform_search_report: ‏security definer, ספירות בלבד,
-- סירוב ב-42501 למי שאינו/ה מנהל/ת פלטפורמה. **היום נחתך לפי שעון ישראל**:
-- ‏date_trunc על timestamptz חותך ב-UTC, ופנייה ב-01:30 בלילה הייתה נספרת
-- ביום הקודם.
-- ---------------------------------------------------------------------------
create or replace function public.platform_gabriela_report(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days  integer;
  v_today date;
  v_from  date;
  v_out   jsonb;
begin
  if not current_is_platform_admin() then
    raise exception 'הדוח פתוח למנהל/ת פלטפורמה בלבד' using errcode = '42501';
  end if;

  v_days  := greatest(1, least(365, coalesce(p_days, 30)));
  v_today := (now() at time zone 'Asia/Jerusalem')::date;
  v_from  := v_today - (v_days - 1);

  with win as (
    select (created_at at time zone 'Asia/Jerusalem')::date as day,
           public_entry as entry,
           wa_phone
      from whatsapp_messages
     where public_entry is not null
       and created_at >= (v_from::timestamp at time zone 'Asia/Jerusalem')
  )
  select jsonb_build_object(
    'generated_at', now(),
    'window_days',  v_days,
    'today',        to_char(v_today, 'YYYY-MM-DD'),

    'totals', jsonb_build_object(
      'inquiries',       (select count(*) from win),
      'site',            (select count(*) from win where entry <> 'direct'),
      'site_people',     (select count(distinct wa_phone) from win where entry <> 'direct'),
      'site_today',      (select count(*) from win where entry <> 'direct' and day = v_today),
      'site_yesterday',  (select count(*) from win where entry <> 'direct' and day = v_today - 1),
      'inquiries_today', (select count(*) from win where day = v_today)
    ),

    'by_entry', (
      select coalesce(jsonb_agg(e order by e.n desc), '[]'::jsonb)
        from (select entry, count(*) as n from win group by entry) e
    ),

    -- כל יום בחלון, גם יום של אפס: רצף בלי חורים הוא מה שמראה שקט.
    'daily', (
      select coalesce(jsonb_agg(d order by d.day), '[]'::jsonb)
        from (select to_char(g.day, 'YYYY-MM-DD') as day,
                     count(w.entry) as inquiries,
                     count(w.entry) filter (where w.entry <> 'direct') as site
                from generate_series(v_from, v_today, interval '1 day') as g(day)
                left join win w on w.day = g.day::date
               group by g.day) d
    )
  ) into v_out;

  return v_out;
end;
$$;

comment on function public.platform_gabriela_report(integer) is
  'כמה פניות פתחו מי שאינם סוכנים מול גבריאלה בוואטסאפ, לפי יום (שעון ישראל), וכמה מהן מכפתור באתר. ספירות בלבד, למנהל/ת פלטפורמה בלבד.';

-- ‏revoke משלושתם בשם: ל-anon ול-authenticated יש הרשאה ישירה ולא דרך
-- ‏PUBLIC, ומי שמונה שניים מהשלושה משאיר את השלישי פתוח (ראו CLAUDE.md).
revoke all on function public.platform_gabriela_report(integer) from public, anon, authenticated;
grant execute on function public.platform_gabriela_report(integer) to authenticated;
