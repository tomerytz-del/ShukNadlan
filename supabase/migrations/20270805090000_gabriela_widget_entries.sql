-- ============================================================================
-- חלונית גבריאלה באתר - שלוש נקודות כניסה חדשות ל-public_entry
--
-- ‏assets/gabriela-widget.js מוסיפה להודעה המוקלדת תג מקור ("[site:property]"),
-- ו-siteEntryOf() ב-whatsapp-webhook/index.ts חותמת לפיו את ההודעה הפותחת.
-- דף הבית ממשיך להיחתם 'homepage' (כמו הכרטיס שב-hero); שלושה ערכים חדשים:
--   property - החלונית בדף נכס (ההודעה נושאת גם את מזהה הנכס)
--   agent    - החלונית בדף סוכן/ת
--   agency   - החלונית בדף משרד
-- שלושתם "מהאתר" בדוח. עד שהמיגרציה רצה הפונקציה חותמת 'site' (נפילה לאחור
-- ב-index.ts), ולכן הסדר בין הפריסות אינו שובר דבר.
-- ‏docs/gabriela-widget.md, docs/whatsapp-public-bot.md.
-- ============================================================================

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'whatsapp_messages_public_entry_check') then
    alter table public.whatsapp_messages drop constraint whatsapp_messages_public_entry_check;
  end if;
  alter table public.whatsapp_messages
    add constraint whatsapp_messages_public_entry_check
    check (public_entry is null
           or public_entry in ('homepage', 'search_empty', 'site', 'direct', 'ad',
                               'property', 'agent', 'agency'));
end;
$$;

-- הדוח: שלוש הכניסות החדשות נספרות "מהאתר". שאר הפונקציה כמו ב-20270411090000.
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
           public_entry in ('homepage', 'search_empty', 'site', 'property', 'agent', 'agency') as from_site,
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
