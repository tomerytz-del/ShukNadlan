-- ============================================================================
-- מאיזו מודעה הגיעה הפנייה לגבריאלה (docs/whatsapp-public-bot.md, "מאיזו מודעה")
--
-- ‏public_entry אומר מאיזה **כפתור** הגיע/ה הפונה. ‏public_entry_ref אומר
-- מאיזו **מודעה**: ‏"meta:<ad_id>" ממודעת click-to-WhatsApp (‏referral של Meta),
-- או "<מקור>:<קמפיין>[:<גרסה>]" מה-UTM של דף הנחיתה, שנוסף להודעת הפתיחה
-- ב-assets/bot-link.js. בלי זה, בדיקת A/B במודעות נמדדת בלחיצות - והשאלה
-- האמיתית היא איזו גרסה מביאה שיחות שהופכות לליד למתווך/ת.
--
-- ‏public_entry מקבל ערך חדש, 'ad': פנייה ישירה ממודעת וואטסאפ במטא, שלא
-- עברה באתר. ‏platform_gabriela_report סופר "מהאתר" מעכשיו כרשימה סגורה
-- של שלוש הכניסות מהאתר, ולא "כל מה שאינו direct" - אחרת כל פנייה ממודעה
-- הייתה נספרת כפנייה מהאתר.
-- ============================================================================

alter table public.whatsapp_messages
  add column if not exists public_entry_ref text;

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'whatsapp_messages_public_entry_check') then
    alter table public.whatsapp_messages drop constraint whatsapp_messages_public_entry_check;
  end if;
  alter table public.whatsapp_messages
    add constraint whatsapp_messages_public_entry_check
    check (public_entry is null
           or public_entry in ('homepage', 'search_empty', 'site', 'direct', 'ad'));

  -- שם קמפיין בלבד: אותיות לטיניות קטנות, ספרות ו-._-: - טקסט חופשי של פונה
  -- לא נכנס לעמודה הזו גם אם הקוד ישתנה.
  if not exists (select 1 from pg_constraint where conname = 'whatsapp_messages_public_entry_ref_check') then
    alter table public.whatsapp_messages
      add constraint whatsapp_messages_public_entry_ref_check
      check (public_entry_ref is null or public_entry_ref ~ '^[a-z0-9._:-]{3,100}$');
  end if;
end;
$$;

comment on column public.whatsapp_messages.public_entry_ref is
  'על הודעה שפותחת שיחה ציבורית: מאיזו מודעה - meta:<ad_id> (click-to-WhatsApp) או <מקור>:<קמפיין>[:<גרסה>] מה-UTM. ‏docs/whatsapp-public-bot.md.';

create index if not exists whatsapp_messages_public_entry_ref_idx
  on public.whatsapp_messages (created_at)
  where public_entry_ref is not null;

-- ---------------------------------------------------------------------------
-- הדוח הקיים: "מהאתר" = שלוש הכניסות מהאתר, בשם. ‏'ad' נספר בנפרד.
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
           public_entry in ('homepage', 'search_empty', 'site') as from_site,
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
      'site',            (select count(*) from win where from_site),
      'site_people',     (select count(distinct wa_phone) from win where from_site),
      'site_today',      (select count(*) from win where from_site and day = v_today),
      'site_yesterday',  (select count(*) from win where from_site and day = v_today - 1),
      'inquiries_today', (select count(*) from win where day = v_today),
      'ad',              (select count(*) from win where entry = 'ad')
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
                     count(w.entry) filter (where w.from_site) as site
                from generate_series(v_from, v_today, interval '1 day') as g(day)
                left join win w on w.day = g.day::date
               group by g.day) d
    )
  ) into v_out;

  return v_out;
end;
$$;

revoke all on function public.platform_gabriela_report(integer) from public, anon, authenticated;
grant execute on function public.platform_gabriela_report(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- המשפך לכל מודעה: פניות → אנשים → חיפוש שמור → הסכמה למתווך/ת → נמכר למתווך/ת.
--
-- החיפוש השמור מוצלב לפי הטלפון (‏saved_searches.phone_e164 = wa_phone,
-- שניהם 972…) ונספר רק אם נוצר בתוך 14 יום מהפנייה, ולכל טלפון נזקף לפנייה
-- **האחרונה** שקדמה לחיפוש (last touch) - כדי שמי שהגיע/ה משתי מודעות לא
-- ייספר/תיספר פעמיים. ספירות בלבד: בלי טלפון, שם או גוף הודעה בפלט.
-- ---------------------------------------------------------------------------
create or replace function public.platform_gabriela_ads_report(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer;
  v_from timestamptz;
  v_out  jsonb;
begin
  if not current_is_platform_admin() then
    raise exception 'הדוח פתוח למנהל/ת פלטפורמה בלבד' using errcode = '42501';
  end if;

  v_days := greatest(1, least(365, coalesce(p_days, 30)));
  v_from := now() - make_interval(days => v_days);

  with touch as (
    select public_entry_ref as ref, public_entry as entry, wa_phone, created_at
      from whatsapp_messages
     where public_entry_ref is not null
       and created_at >= v_from
  ),
  conv as (
    -- כל חיפוש שמור מהבוט, ולצידו הפנייה האחרונה מאותו טלפון שקדמה לו
    select distinct on (s.id)
           t.ref, s.id, s.consent_agent_contact, s.lead_status
      from saved_searches s
      join touch t on t.wa_phone = s.phone_e164
                  and s.created_at >= t.created_at
                  and s.created_at <  t.created_at + interval '14 days'
     order by s.id, t.created_at desc
  )
  select jsonb_build_object(
    'generated_at', now(),
    'window_days',  v_days,
    'rows', coalesce((
      select jsonb_agg(r order by r.inquiries desc, r.ref)
        from (
          select t.ref,
                 bool_or(t.entry = 'ad') as direct_from_ad,
                 count(*) as inquiries,
                 count(distinct t.wa_phone) as people,
                 (select count(*) from conv c where c.ref = t.ref) as saved_searches,
                 (select count(*) from conv c where c.ref = t.ref and c.consent_agent_contact) as agent_consent,
                 (select count(*) from conv c where c.ref = t.ref and c.lead_status = 'sold') as sold
            from touch t
           group by t.ref
        ) r
    ), '[]'::jsonb)
  ) into v_out;

  return v_out;
end;
$$;

comment on function public.platform_gabriela_ads_report(integer) is
  'לכל מודעה (whatsapp_messages.public_entry_ref): פניות לגבריאלה, אנשים, חיפושים שמורים, הסכמה למתווך/ת ונמכר. ספירות בלבד, למנהל/ת פלטפורמה בלבד.';

revoke all on function public.platform_gabriela_ads_report(integer) from public, anon, authenticated;
grant execute on function public.platform_gabriela_ads_report(integer) to authenticated;
