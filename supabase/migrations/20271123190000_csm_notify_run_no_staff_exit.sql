-- csm_notify_run: יציאה מוקדמת כשאין אף חבר/ת צוות הטמעה פעיל/ה.
--
-- הממצא: cost:heavy_query:query_0f4de31cb4a8 (18.11.2026) - 281 שניות מסד
-- ליום, 1,443 קריאות, ממוצע 195ms. ב-csm_staff אין כרגע אף שורה פעילה
-- (שורה אחת, active = false), ולכן הפונקציה לא יכלה לכתוב התראה אחת - אבל
-- כל 5 דקות היא הריצה את _csm_risk_agents() (60 סוכנים, lateral על
-- whatsapp_messages) ורק אז גילתה שלולאת הצוות ריקה. ב-cron.job_run_details,
-- 48 שעות: 166ms בממוצע בדקה רגילה, 719ms בדקה שמתחלקת ב-5.
--
-- הגוף הוא הגוף שבפרודקשן (md5(prosrc) = 21ad93e5881fab0c436913de5331d213,
-- זהה ל-20270816090000), והשינוי היחיד הוא ה-if שבראשו.
-- כשהצוות יחזור להיות פעיל העלות תחזור; זה מתועד ב-docs/csm-adoption.md.

create or replace function public.csm_notify_run()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n      int := 0;
  v_now    timestamptz := now();
  v_local  timestamp := now() at time zone 'Asia/Jerusalem';
  v_today  date := (now() at time zone 'Asia/Jerusalem')::date;
  e        record;
  s        record;
  r        record;
  v_lines  text;
  v_cnt    int;
  v_body   text;
begin
  -- אין צוות פעיל - אין למי להתריע. כל שלושת החלקים שלמטה עוברים דרך
  -- csm_staff where active, ולכן התוצאה זהה (0) והיציאה כאן רק חוסכת את
  -- השאילתות: ‏_csm_risk_agents לבדה עלתה כ-110ms תכנון + 110ms ריצה כל
  -- 5 דקות בחיבור קר של pg_cron, בשביל לולאה פנימית ריקה.
  if not exists (select 1 from public.csm_staff where active) then
    return 0;
  end if;

  -- א. תזכורת לפני פגישה
  for e in
    select g.*, st.reminder_minutes as staff_reminder, m.display_name as agent_name,
           ag.name as agency_name, coalesce(m.phone, m.phone_e164) as agent_phone
      from public.csm_agenda g
      join public.csm_staff st on st.id = g.staff_id and st.active
      left join public.agency_members m on m.id = g.agent_id
      left join public.agencies ag on ag.id = m.agency_id
     where g.status = 'scheduled' and g.reminded_at is null
       and g.starts_at > v_now
       and coalesce(g.reminder_minutes, st.reminder_minutes) > 0
       and g.starts_at - make_interval(mins => coalesce(g.reminder_minutes, st.reminder_minutes)) <= v_now
     for update of g skip locked
  loop
    update public.csm_agenda set reminded_at = v_now where id = e.id;
    if public._csm_notify(
         e.staff_id, 'meeting_reminder',
         'ב-' || public._csm_hhmm(e.starts_at) || ': ' || coalesce(nullif(e.title, ''), e.agent_name, 'פגישה'),
         concat_ws(E'\n',
           case when e.agent_name is not null then 'עם ' || e.agent_name || coalesce(' (' || e.agency_name || ')', '') end,
           case when e.agent_phone is not null then 'טלפון: ' || e.agent_phone end,
           case when e.location is not null then 'איפה: ' || e.location end,
           case when e.meeting_url is not null then 'קישור: ' || e.meeting_url end,
           case when e.notes is not null then left(e.notes, 400) end),
         e.agent_id, null, e.id, 'mtg:' || e.id || ':' || extract(epoch from e.starts_at)::bigint) is not null then
      v_n := v_n + 1;
    end if;
  end loop;

  -- ב. סוכן/ת חדש/ה ומי שעבר/ה עכשיו את 5 הימים - כל 5 דקות, לכל הצוות.
  -- ‏"עכשיו" = בתוך היום שאחרי החצייה, כך שבהרצה הראשונה לא יוצף הפעמון
  -- בכל מי שכבר היה בסיכון לפני כן (הם בסיכום הבוקר).
  if extract(minute from v_now)::int % 5 = 0 then
    for r in
      select m.id, m.display_name, a.name as agency_name, coalesce(m.phone, m.phone_e164) as phone, m.role
        from public.agency_members m
        left join public.agencies a on a.id = m.agency_id
       where m.created_at > v_now - interval '1 day'
         and m.active = true and m.closed_at is null and coalesce(m.is_platform_admin, false) = false
    loop
      for s in select id from public.csm_staff where active loop
        if public._csm_notify(s.id, 'new_agent',
             'נרשם/ה: ' || coalesce(r.display_name, 'סוכן/ת חדש/ה'),
             concat_ws(E'\n',
               coalesce(r.agency_name, 'בלי משרד') || case when r.role = 'manager' then ' · מנהל/ת משרד' else '' end,
               case when r.phone is not null then 'טלפון: ' || r.phone end,
               'כדאי לקבוע פגישת הצלחה ראשונה בימים הקרובים.'),
             r.id, null, null, 'new:' || r.id) is not null then
          v_n := v_n + 1;
        end if;
      end loop;
    end loop;

    for r in
      select * from public._csm_risk_agents() k
       where coalesce(k.last_in, k.joined_at) > v_now - interval '6 days'
    loop
      for s in select id from public.csm_staff where active loop
        if public._csm_notify(s.id, 'at_risk',
             coalesce(r.display_name, 'סוכן/ת') || ': 5 ימים בלי גבריאלה',
             concat_ws(E'\n',
               r.agency_name,
               case when r.last_in is null then 'עוד לא כתב/ה לגבריאלה מאז ההרשמה.' end,
               case when r.phone is not null then 'טלפון: ' || r.phone end),
             r.agent_id, null, null, 'risk:' || r.agent_id || ':' || coalesce(r.last_in::date::text, 'never')) is not null then
          v_n := v_n + 1;
        end if;
      end loop;
    end loop;
  end if;

  -- ג. סיכום הבוקר: בשעה שבחרה, בימי העבודה שלה, פעם ביום, ועד שלוש שעות
  -- אחרי (פריסה בצהריים לא שולחת סיכום "בוקר" בערב)
  for s in
    select st.* from public.csm_staff st
     where st.active and not ('daily_digest' = any(st.notify_off))
       and st.last_digest_on is distinct from v_today
       and extract(dow from v_local)::smallint = any(st.work_days)
       and v_local >= v_today + st.digest_time
       and v_local <  v_today + st.digest_time + interval '3 hours'
     for update of st skip locked
  loop
    update public.csm_staff set last_digest_on = v_today where id = s.id;
    v_body := '';

    select count(*), string_agg(public._csm_hhmm(g.starts_at) || ' ' ||
             coalesce(nullif(g.title, ''), m.display_name, 'פגישה'), E'\n' order by g.starts_at)
      into v_cnt, v_lines
      from public.csm_agenda g
      left join public.agency_members m on m.id = g.agent_id
     where g.staff_id = s.id and g.status = 'scheduled'
       and (g.starts_at at time zone 'Asia/Jerusalem')::date = v_today;
    if v_cnt > 0 then
      v_body := v_body || 'פגישות היום (' || v_cnt || '):' || E'\n' || v_lines || E'\n\n';
    end if;

    select count(*), string_agg(coalesce(m.display_name, 'סוכן/ת'), ', ' order by st2.next_followup_at)
      into v_cnt, v_lines
      from public.csm_agent_stage st2
      join public.agency_members m on m.id = st2.agent_id and m.active and m.closed_at is null
     where (st2.next_followup_at at time zone 'Asia/Jerusalem')::date <= v_today
       and st2.stage <> 'champion'
       and not exists (select 1 from public.csm_agenda g2
                        where g2.agent_id = st2.agent_id and g2.status = 'scheduled'
                          and (g2.starts_at at time zone 'Asia/Jerusalem')::date = v_today);
    if v_cnt > 0 then
      v_body := v_body || 'לחזור היום (' || v_cnt || '): ' || left(v_lines, 500) || E'\n\n';
    end if;

    select count(*) into v_cnt from public._csm_risk_agents();
    if v_cnt > 0 then
      v_body := v_body || 'בסיכון - 5 ימים ומעלה בלי גבריאלה: ' || v_cnt || E'\n';
    end if;

    select count(*) into v_cnt from public.agency_members m
     where m.created_at > v_now - interval '1 day' and m.active and coalesce(m.is_platform_admin, false) = false;
    if v_cnt > 0 then
      v_body := v_body || 'נרשמו ב-24 השעות האחרונות: ' || v_cnt || E'\n';
    end if;

    if v_body <> '' then
      if public._csm_notify(s.id, 'daily_digest', 'הבוקר שלך באזור ההטמעה', btrim(v_body, E'\n'),
           null, null, null, 'digest:' || v_today) is not null then
        v_n := v_n + 1;
      end if;
    end if;
  end loop;

  return v_n;
end;
$$;

revoke all on function public.csm_notify_run() from public, anon, authenticated;
grant execute on function public.csm_notify_run() to service_role;
