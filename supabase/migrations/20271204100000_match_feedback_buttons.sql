-- =============================================================================
-- כפתורי "רלוונטי / לא רלוונטי" על ריכוז ההתאמות בוואטסאפ (docs/client-matching.md,
-- "משוב מהוואטסאפ").
--
-- ‏למה: באבחון גבריאלה (27.10-22.11.2026) 0% מהתראות ההתאמה טופלו, ובבדיקה
-- ב-27.11.2026 כל 757 השורות של 30 הימים האחרונים ב-client_match_alerts היו
-- 'new'. הסיכום (match_digest) יוצא בלי כפתור, והדרך היחידה לסמן התאמה היא
-- ה-CRM. בלי סימון אין גם שום משוב למנוע ההתאמות.
--
-- ‏מה כאן:
--   1. feedback / feedback_at על client_match_alerts. "לא רלוונטי" הוא גם
--      status = 'dismissed' (הסמנטיקה הקיימת: לא מוצג שוב, ונשמר בטריגרי
--      הניקוי), ו"רלוונטי" הוא status = 'seen'. feedback נפרד מ-status כי
--      'seen' נכתב גם מצפייה ב-CRM ולא אומר שהסוכן/ת שפט/ה את ההתאמה.
--   2. notifications.match_alert_ids: הסיכום רושם בעצמו אילו התאמות (הצד של
--      הלקוחות שלי) הוא מכסה. לא משחזרים את החלון מהסיכום הקודם: סוכן/ת יכול/ה
--      למחוק התראה מהפעמון, וחלון משוחזר היה מתרחב בשקט. סיכום ישן (null) -
--      בלי כפתורים.
--   3. client_match_digest_run: העתק מלא מ-20271202120000 (md5 של הגוף זהה
--      לפרודקשן, 118f5df7..., נבדק 28.11.2026), ושלושה שינויים: המשתנה
--      v_alert_ids, ה-array_agg בשאילתה הראשונה, והעמודה ב-insert.
--   4. match_digest_alerts (קריאה) ו-match_feedback_set (כתיבה), service_role
--      בלבד, שתיהן מסננות לפי הסוכן/ת.
--   5. הדגל match_feedback_buttons_enabled, כבוי. notification-push מוסיף את
--      הכפתורים רק כשהוא 1. הלחיצה נקלטת בוובהוק גם כשהדגל כבוי, כדי שכפתור
--      שכבר יצא לא ייפול למודל.
-- =============================================================================

alter table public.client_match_alerts
  add column if not exists feedback    text,
  add column if not exists feedback_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'client_match_alerts_feedback_check'
       and conrelid = 'public.client_match_alerts'::regclass
  ) then
    alter table public.client_match_alerts
      add constraint client_match_alerts_feedback_check
      check (feedback is null or feedback in ('relevant', 'not_relevant'));
  end if;
end $$;

comment on column public.client_match_alerts.feedback is
  'משוב של הסוכן/ת על ההתאמה: relevant / not_relevant. null = לא נשפטה. נכתב רק ב-match_feedback_set.';
comment on column public.client_match_alerts.feedback_at is
  'מתי נכתב feedback.';

alter table public.notifications
  add column if not exists match_alert_ids uuid[];

comment on column public.notifications.match_alert_ids is
  'match_digest בלבד: ההתאמות (client_match_alerts) של הלקוחות שלי שהסיכום מכסה, לפי ציון. נכתב ב-client_match_digest_run.';

insert into public.pricing_config (key, value, description) values
  ('match_feedback_buttons_enabled', 0,
   'כפתורי רלוונטי / לא רלוונטי על ריכוז ההתאמות בוואטסאפ (בתוך חלון 24 השעות). 0 = כבוי.')
on conflict (key) do nothing;

create or replace function public.client_match_digest_run()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hours   int;
  v_il_min  int;
  v_greet   text;
  v_sent    int := 0;
  r         record;
  v_from    timestamptz;
  v_now     timestamptz := now();
  v_props   int;
  v_clients int;
  v_top     text;
  v_top_np  text;
  v_title   text;
  v_names   text;
  v_lst_n   int;
  v_lst_p   int;
  v_lst_who text;
  v_lst_k   int;
  v_one_c   uuid;
  v_one_p   uuid;
  v_body    text;
  v_alert_ids uuid[];
begin
  -- ה-cron רץ כל דקה; שולחים רק בעשר הדקות שמתחילות באחת משעות הסיכום
  -- בשעון ישראל. בתוך החלון, מי שכבר קיבל/ה נעצר/ת ב-match_digest_min_hours
  -- למטה, ולכן ההרצות הבאות באותו חלון לא שולחות שוב.
  v_il_min := extract(hour   from (v_now at time zone 'Asia/Jerusalem'))::int * 60
            + extract(minute from (v_now at time zone 'Asia/Jerusalem'))::int;
  if not exists (
    select 1
      from (values ('match_digest_time_1', 830), ('match_digest_time_2', 1207),
                   ('match_digest_time_3', 1607)) d(key, fallback)
      left join public.pricing_config c on c.key = d.key
      cross join lateral (select coalesce(c.value::int, d.fallback) as hhmm) t
     where v_il_min >= (t.hhmm / 100) * 60 + t.hhmm % 100
       and v_il_min <  (t.hhmm / 100) * 60 + t.hhmm % 100 + 10
  ) then
    return 0;
  end if;

  v_hours := greatest(0, coalesce(
    (select value::int from public.pricing_config where key = 'match_digest_min_hours'), 2));

  -- סוכן/ת חדש/ה: הסיכום הראשון בסבב הבא, ולא על כל מה שהצטבר לפני ההצטרפות
  insert into public.agent_match_digest (agent_id, last_sent_at)
  select m.id, v_now
    from public.agency_members m
   where m.active = true
  on conflict (agent_id) do nothing;

  for r in
    select m.id, m.agency_id, d.last_sent_at,
           -- השם הפרטי לברכה ("בוקר טוב דני")
           nullif(split_part(btrim(coalesce(m.display_name, '')), ' ', 1), '') as first_name
      from public.agency_members m
      join public.agent_match_digest d on d.agent_id = m.id
      left join public.agent_reminder_preferences rp on rp.agent_id = m.id
     where m.active = true
       and d.last_sent_at <= v_now - make_interval(hours => v_hours)
       -- שעות וימים שקטים - אותן ברירות מחדל כמו notification_push_due_agents.
       -- הסיכום מחכה (last_sent_at לא זז), ולכן אחרי סוף השבוע יוצא אחד ולא שישה.
       and not public.agent_reminder_quiet_now(
             coalesce(rp.quiet_from_hour, 21),
             coalesce(rp.quiet_to_hour, 8),
             coalesce(rp.quiet_days, '{5,6}'::smallint[]))
  loop
    v_from := r.last_sent_at;

    -- הצד של הלקוחות שלי: נכסים חדשים שהתאימו
    select count(distinct a.property_id), count(distinct a.client_id),
           case when count(distinct a.client_id) = 1 then (array_agg(a.client_id))[1] end,
           -- ‏20271204100000: ההתאמות שהסיכום הזה מכסה, לכפתורי המשוב (match_digest_alerts)
           array_agg(a.id order by a.score desc, a.created_at desc)
      into v_props, v_clients, v_one_c, v_alert_ids
      from public.client_match_alerts a
      join public.agent_clients c on c.id = a.client_id and c.status = 'active'
      join public.properties p    on p.id = a.property_id and p.status = 'active'
     where a.agent_id = r.id
       and a.created_at > v_from
       and a.status <> 'dismissed';

    -- הבולטים: שתי שורות "שם - "נכס" ציון" כשיש כמה נכסים; ובנכס אחד - רק
    -- השמות (שלושה ראשונים), כי הנכס כבר נאמר פעם אחת ולא צריך לחזור על
    -- הכותרת שלו לכל לקוח/ה. ‏20270509090000: ההודעה הגיעה ל-270 תווים.
    -- ‏20270513090000: שורה לכל נכס ולא לכל התאמה - שני נכסים שונים, ולכל
    -- אחד שני הלקוחות החזקים ו"ועוד N". לפי התאמה, שתי השורות יכלו להיות
    -- אותו נכס. ‏unique(client_id, property_id) - כל לקוח/ה פעם אחת בנכס.
    select string_agg(t.line, ' · ' order by t.score desc, t.created_at desc)
      into v_top
      from (select '"' || max(p.title) || '" ל' ||
                   array_to_string((array_agg(c.full_name order by a.score desc, a.created_at desc))[1:2], ', ') ||
                   case when count(*) > 2 then ' ועוד ' || (count(*) - 2) else '' end as line,
                   max(a.score) as score, max(a.created_at) as created_at
              from public.client_match_alerts a
              join public.agent_clients c on c.id = a.client_id and c.status = 'active'
              join public.properties p    on p.id = a.property_id and p.status = 'active'
             where a.agent_id = r.id
               and a.created_at > v_from
               and a.status <> 'dismissed'
             group by p.id
             order by max(a.score) desc, max(a.created_at) desc
             limit 2) t;

    -- ‏20270511090000: אותן שתי שורות בלי שם הלקוח/ה, למקרה של לקוח/ה אחד/ת
    -- וכמה נכסים - השם נאמר פעם אחת לפני הרשימה ולא חוזר בכל שורה.
    select string_agg(t.line, ' · ' order by t.score desc)
      into v_top_np
      from (select '"' || p.title || '" ' || a.score || '%' as line, a.score
              from public.client_match_alerts a
              join public.agent_clients c on c.id = a.client_id and c.status = 'active'
              join public.properties p    on p.id = a.property_id and p.status = 'active'
             where a.agent_id = r.id
               and a.created_at > v_from
               and a.status <> 'dismissed'
             order by a.score desc, a.created_at desc
             limit 2) t;

    -- שם לכל לקוח/ה פעם אחת (‏20270511090000): עם נכס אחד כל התאמה היא
    -- לקוח/ה אחר/ת, אבל עם לקוח/ה אחד/ת וכמה נכסים השורות היו חוזרות על השם.
    select max(t.title), string_agg(t.full_name, ', ' order by t.score desc, t.created_at desc)
      into v_title, v_names
      from (select max(p.title) as title, c.full_name, max(a.score) as score, max(a.created_at) as created_at
              from public.client_match_alerts a
              join public.agent_clients c on c.id = a.client_id and c.status = 'active'
              join public.properties p    on p.id = a.property_id and p.status = 'active'
             where a.agent_id = r.id
               and a.created_at > v_from
               and a.status <> 'dismissed'
             group by c.id, c.full_name
             order by max(a.score) desc, max(a.created_at) desc
             limit 3) t;

    -- הצד של הנכסים שלי: לקוחות של סוכנים אחרים - רק כשרמת השיתוף של
    -- הלקוח/ה מתירה (office - אותו משרד, network - כולם).
    with lst as (
      select a.property_id, a.agent_id as other_id
        from public.client_match_alerts a
        join public.properties p     on p.id = a.property_id and p.status = 'active'
        join public.agent_clients c  on c.id = a.client_id and c.status = 'active'
        join public.agency_members o on o.id = a.agent_id and o.active = true
       where p.agent_id = r.id
         and a.agent_id <> r.id
         and a.created_at > v_from
         and (c.share_level = 'network'
              or (c.share_level = 'office' and o.agency_id = r.agency_id))
         -- לקוח/ה של משרד הדגמה: רק מפרסם/ת ממשרד הדגמה שומע/ת
         and (not public.agent_is_demo(a.agent_id) or public.agent_is_demo(r.id))
    ),
    who as (
      select l.other_id, count(*) as n
        from lst l
       group by l.other_id
    )
    -- שני הסוכנים עם הכי הרבה לקוחות מתאימים: שם וטלפון בלבד (בלי שם המשרד,
    -- ובלי +972 - כך המספר קצר ועדיין לחיץ בוואטסאפ). השאר - "ועוד N".
    select (select count(*) from lst),
           (select count(distinct property_id) from lst),
           (select case when count(distinct property_id) = 1 then (array_agg(property_id))[1] end from lst),
           (select count(*) from who),
           (select string_agg(coalesce(m.display_name, 'סוכן/ת') ||
                              coalesce(' ' || regexp_replace(btrim(m.phone), '^\+972-?', '0'), ''),
                              ', ' order by w.n desc)
              from (select * from who order by n desc limit 2) w
              join public.agency_members m on m.id = w.other_id)
      into v_lst_n, v_lst_p, v_one_p, v_lst_k, v_lst_who;

    if coalesce(v_props, 0) > 0 or coalesce(v_lst_n, 0) > 0 then
      -- ברכה לפי השעה בישראל ולא לפי מספר הסבב, כדי שתישאר נכונה גם כשמשנים
      -- את match_digest_time_*: ‏8:30 בוקר, ‏12:07 צהריים, ‏16:07 אחר הצהריים.
      v_greet := case
                   when v_il_min < 12 * 60 then 'בוקר טוב'
                   when v_il_min < 15 * 60 then 'צהריים טובים'
                   when v_il_min < 18 * 60 then 'אחר צהריים טובים'
                   else 'ערב טוב'
                 end || coalesce(' ' || r.first_name, '') || ', להלן ריכוז התאמות ללקוחות:';
      -- שורה אחת, בלי ירידות שורה: בתבנית של וואטסאפ Meta דוחה \n בפרמטר.
      -- קצר בכוונה (‏20270509090000): הנכס פעם אחת, שמות בלי כפילות, ובצד
      -- המפרסם/ת שני סוכנים עם טלפון ו"ועוד N" - הרשימה המלאה ב"התראות התאמה".
      v_body := v_greet;
      if v_props = 1 then
        v_body := v_body || ' "' || coalesce(v_title, 'נכס חדש') || '" מתאים ' ||
                  case when v_clients = 1 then 'ל' || coalesce(v_names, 'לקוח/ה') || coalesce(' (' || (
                         select max(a.score) from public.client_match_alerts a
                          where a.agent_id = r.id and a.created_at > v_from and a.status <> 'dismissed') || '%)', '')
                       else 'ל-' || v_clients || ' לקוחות: ' || coalesce(v_names, '') ||
                            case when v_clients > 3 then ' ועוד ' || (v_clients - 3) else '' end
                  end || '.';
      elsif v_props > 1 and v_clients = 1 then
        -- "2 נכסים חדשים מתאימים לאירה: ..." - ולא "ל-1 לקוחות" עם השם בכל שורה
        v_body := v_body || ' ' || v_props || ' נכסים חדשים מתאימים ל' || coalesce(v_names, 'לקוח/ה') || ': ' ||
                  coalesce(v_top_np, '') ||
                  case when v_props > 2 then ' ועוד ' || (v_props - 2) else '' end || '.';
      elsif v_props > 1 then
        v_body := v_body || ' ' || v_props || ' נכסים חדשים ל-' || v_clients || ' לקוחות: ' ||
                  coalesce(v_top, '') ||
                  case when v_props = 3 then ' ועוד נכס'
                       when v_props > 3 then ' ועוד ' || (v_props - 2) || ' נכסים' else '' end || '.';
      end if;
      if v_lst_n > 0 then
        v_body := v_body || ' ' ||
                  case when v_lst_p = 1 then 'נכס שלך מתאים' else v_lst_p || ' נכסים שלך מתאימים' end ||
                  case when v_lst_n = 1 then ' ללקוח/ה של ' else ' ללקוחות של ' end ||
                  coalesce(v_lst_who, 'סוכנים אחרים') ||
                  case when v_lst_k > 2 then ' ועוד ' || (v_lst_k - 2) else '' end || '.';
      end if;

      -- יעד אחד רק כשיש רק צד אחד ופריט אחד בו (הסקיל agent-notifications)
      -- suppress_push מפורש (false) הוא ברירת המחדל של העמודה, כלומר אין שינוי:
      -- הסיכום חייב להגיע לוואטסאפ, וכך check_notification_backfill מזהה שזו
      -- החלטה ולא מילוי.
      insert into public.notifications (agent_id, type, title, body,
                                        related_client_id, related_property_id, suppress_push,
                                        match_alert_ids)
      values (r.id, 'match_digest',
              'ריכוז התאמות ללקוחות' || case when v_now - r.last_sent_at > interval '20 hours'
                                               then ' - מאז הסיכום הקודם' else '' end,
              v_body,
              case when coalesce(v_lst_n, 0) = 0 then v_one_c end,
              case when coalesce(v_props, 0) = 0 then v_one_p end,
              false,
              v_alert_ids);
      v_sent := v_sent + 1;
    end if;

    insert into public.agent_match_digest (agent_id, last_sent_at, last_items)
    values (r.id, v_now, coalesce(v_props, 0) + coalesce(v_lst_n, 0))
    on conflict (agent_id) do update
      set last_sent_at = excluded.last_sent_at,
          last_items   = excluded.last_items;
  end loop;

  return v_sent;
end;
$$;

comment on function public.client_match_digest_run() is
  'סיכום ההתאמות: ב-8:30, ‏12:07 ו-16:07 שעון ישראל (match_digest_time_1/2/3), לכל סוכן/ת שאינו/ה בשקט - התראת match_digest אחת על מה שנכנס ל-client_match_alerts מאז הסיכום הקודם. במקום client_match / listing_match בזמן אמת. pg_cron כל דקה; מחוץ לעשר הדקות שאחרי כל שעת סיכום מחזירה 0.';

revoke all on function public.client_match_digest_run() from public, anon, authenticated;
grant execute on function public.client_match_digest_run() to service_role;

-- ---------------------------------------------------------------------------
-- ההתאמות שסיכום אחד כיסה, שעדיין פתוחות: לקוח/ה ונכס פעילים, בלי dismissed.
-- total הוא כמה יש (לפני החיתוך ל-p_limit; רשימה בוואטסאפ: עד 10).
-- ---------------------------------------------------------------------------
create or replace function public.match_digest_alerts(
  p_agent        uuid,
  p_notification uuid,
  p_limit        int default 10
)
returns table (
  alert_id       uuid,
  client_name    text,
  property_title text,
  score          int,
  feedback       text,
  total          int
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, c.full_name, p.title, a.score, a.feedback, (count(*) over ())::int
    from public.notifications n
    cross join lateral unnest(n.match_alert_ids) as x(id)
    join public.client_match_alerts a
      on a.id = x.id and a.agent_id = p_agent and a.status <> 'dismissed'
    join public.agent_clients c on c.id = a.client_id and c.status = 'active'
    join public.properties p    on p.id = a.property_id and p.status = 'active'
   where n.id = p_notification
     and n.agent_id = p_agent
     and n.type = 'match_digest'
   order by a.score desc, a.created_at desc
   limit greatest(1, least(coalesce(p_limit, 10), 30));
$$;

revoke all on function public.match_digest_alerts(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.match_digest_alerts(uuid, uuid, int) to service_role;

comment on function public.match_digest_alerts(uuid, uuid, int) is
  'ההתאמות הפתוחות שסיכום match_digest אחד כיסה (notifications.match_alert_ids). service_role בלבד: notification-push והוובהוק.';

-- ---------------------------------------------------------------------------
-- הכתיבה. רק התאמה של p_agent; התאמה של סוכן/ת אחר/ת מחזירה אפס שורות.
-- "לא רלוונטי" = dismissed. "רלוונטי" = seen, ומחזיר התאמה שסומנה בטעות
-- כלא רלוונטית (dismissed -> seen), כי זו בדיוק הלחיצה שמתקנת אותה.
-- ערך אחר נדחה באילוץ client_match_alerts_feedback_check.
-- ---------------------------------------------------------------------------
create or replace function public.match_feedback_set(
  p_agent    uuid,
  p_alert    uuid,
  p_feedback text
)
returns table (
  client_name    text,
  property_title text
)
language sql
security definer
set search_path = ''
as $$
  update public.client_match_alerts a
     set feedback    = p_feedback,
         feedback_at = now(),
         status      = case when p_feedback = 'not_relevant' then 'dismissed' else 'seen' end,
         seen_at     = coalesce(a.seen_at, now())
    from public.agent_clients c, public.properties p
   where a.id = p_alert
     and a.agent_id = p_agent
     and c.id = a.client_id
     and p.id = a.property_id
  returning c.full_name, p.title;
$$;

revoke all on function public.match_feedback_set(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.match_feedback_set(uuid, uuid, text) to service_role;

comment on function public.match_feedback_set(uuid, uuid, text) is
  'משוב רלוונטי / לא רלוונטי על התאמה, מכפתור בוואטסאפ. service_role בלבד; הסינון לפי סוכן/ת בפונקציה.';
