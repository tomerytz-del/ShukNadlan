-- ===========================================================================
-- שני כשלים שקטים שנמצאו ב-21.10.2026
--
-- 1. ממצא חמור של הסוכן התפעולי שאינו אבטחה ישב בפאנל בלי שאיש ראה.
--    ‏access_log_stale ו-workflow_failing על יומן הגישה היו critical מ-13.10
--    ועד 21.10 - שמונה ימים, ובהם יומני 13-14.10 נמחקו אצל Supabase לפני
--    שהועתקו (תקנה 10). ‏ads_token_invalid ישב כך שבוע. ההתראה האקטיבית
--    (‏20270421100000) כיסתה רק area = 'security'.
--
-- 2. אין לנו דרך לדעת אם הודעת תבנית לסוכן/ת הגיעה. ‏notification-push לא
--    שמרה את מזהה ההודעה של Meta, ולכן עדכוני הסטטוס שה-webhook כבר רושם
--    (‏record_whatsapp_status) לא מצאו שורה. ‏"sent" ביומן פירושו "Meta
--    קיבלה", לא "הגיע". ובפרט: סוכן/ת שבחר/ה בוואטסאפ "הפסק לקבל הודעות
--    קידום מכירות" חוסם/ת את התבנית (שהיא Marketing - ‏docs/whatsapp-setup.md),
--    ו-Meta מודיעה על כך (‏131050) **בעדכון סטטוס**, לא בתשובה לשליחה.
--    ‏notification-push בדקה 131050 רק בתשובה, ולכן לא ראתה אף אחד.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. התראה על ממצא חמור בכל תחום
--
-- ‏**מתי:** כשהממצא **נפתח** - נוצר, נפתח מחדש אחרי שנסגר, או הוחמר ל-
-- critical. אותו כלל של ops_findings_security_alert: ממצא פתוח מתעדכן בכל
-- סריקה, והתראה בכל עדכון הייתה רעש. ממצא מושתק (‏muted_until) שקט.
--
-- ‏**מה לא:** אבטחה (יש לה התראה משלה, גם על high), ושלושת ממצאי השוק (יש
-- להם market_alert). ‏high לא נשלח: כ-4 בחודש, וחלקם רעש (‏workflow_failing
-- על הרצה בודדת). ‏critical היו 10 ב-30 ימים, מתוכם 6 באירוע אחד (25.9).
-- ---------------------------------------------------------------------------
select public.notification_types_add(array['ops_alert']);

create or replace function public.alert_platform_admin_on_critical_finding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_opened boolean;
begin
  if new.severity <> 'critical' or new.resolved_at is not null
     or new.area = 'security'
     or new.code in ('market_near', 'market_ready', 'market_below_gate') then
    return new;
  end if;
  if new.muted_until is not null and new.muted_until > now() then
    return new;
  end if;

  v_opened := tg_op = 'INSERT'
           or old.resolved_at is not null
           or old.severity <> 'critical';
  if not v_opened then
    return new;
  end if;

  -- ‏translate: הממצאים נכתבים כתיעוד פנימי, וכאן הם יוצאים לוואטסאפ - טקסט
  -- מוצג, שבו המקף הוא רגיל (CLAUDE.md).
  insert into public.notifications (agent_id, type, title, body)
  select m.id,
         'ops_alert',
         translate(left('ממצא חמור: ' || new.title, 140), '—–', '--'),
         translate(left(coalesce(new.detail, ''), 400)
           || case when new.suggestion is not null
                   then ' מה לעשות: ' || left(new.suggestion, 300) else '' end, '—–', '--')
    from public.agency_members m
   where m.is_platform_admin = true
     and m.active = true;

  return new;
end;
$$;

-- פונקציית טריגר - PostgREST אינו חושף אותה, וההחלטה בכל זאת כתובה
revoke all on function public.alert_platform_admin_on_critical_finding()
  from public, anon, authenticated;

drop trigger if exists ops_findings_critical_alert on public.ops_findings;
create trigger ops_findings_critical_alert
  after insert or update of severity, resolved_at on public.ops_findings
  for each row execute function public.alert_platform_admin_on_critical_finding();

-- ‏מה שכבר פתוח לא "ייפתח" שוב, ולכן הטריגר לא היה שולח עליו לעולם. פעם
-- אחת, עכשיו. ‏not exists: הרצה חוזרת של המיגרציה לא שולחת שוב.
insert into public.notifications (agent_id, type, title, body)
select m.id,
       'ops_alert',
       translate(left('ממצא חמור: ' || f.title, 140), '—–', '--'),
       translate(left(coalesce(f.detail, ''), 400)
         || case when f.suggestion is not null
                 then ' מה לעשות: ' || left(f.suggestion, 300) else '' end, '—–', '--')
  from public.ops_findings f
  cross join public.agency_members m
 where f.severity = 'critical'
   and f.resolved_at is null
   and f.area <> 'security'
   and f.code not in ('market_near', 'market_ready', 'market_below_gate')
   and (f.muted_until is null or f.muted_until <= now())
   and m.is_platform_admin = true
   and m.active = true
   and not exists (
     select 1 from public.notifications n
      where n.agent_id = m.id
        and n.type = 'ops_alert'
        and n.title = translate(left('ממצא חמור: ' || f.title, 140), '—–', '--'));

-- ---------------------------------------------------------------------------
-- 2. מסירה של הודעות ההתראות בוואטסאפ
--
-- ‏whatsapp_status נשאר "מה קרה בשליחה" (‏pending/sent/failed). ‏delivery_*
-- הוא מה ש-Meta דיווחה אחר כך, באותו דירוג של whatsapp_messages:
-- sent < delivered < read < failed. ‏delivery_detail הוא "קוד · כותרת ·
-- הודעה", ולכן split_part(delivery_detail, ' · ', 1) = '131050' הוא חסימה.
-- ---------------------------------------------------------------------------
alter table public.notification_push_log
  add column if not exists wa_message_id   text,
  add column if not exists delivery_status text,
  add column if not exists delivery_detail text,
  add column if not exists delivery_at     timestamptz;

comment on column public.notification_push_log.wa_message_id is
  'המזהה ש-Meta החזירה לשליחה (wamid). דרכו record_whatsapp_status מוצאת את השורה.';
comment on column public.notification_push_log.delivery_status is
  'מה ש-Meta דיווחה אחרי השליחה: sent / delivered / read / failed. ריק = לא דווח (או נשלח לפני 20270720090000).';
comment on column public.notification_push_log.delivery_detail is
  'בכישלון: "קוד · כותרת · הודעה" מ-Meta. 131050 = הנמען/ת חסם/ה הודעות שיווק; 131049 = Meta הגבילה הודעות שיווק לנמען/ת.';

create index if not exists notification_push_log_wa_message_id_idx
  on public.notification_push_log (wa_message_id)
  where wa_message_id is not null;

-- ‏record_whatsapp_status: הגוף של 20261117090000 כמו שהוא (‏md5 זהה לפרודקשן
-- ב-21.10.2026), ועוד עדכון מקביל ב-notification_push_log.
create or replace function public.record_whatsapp_status(
  p_wa_message_id text,
  p_status        text,
  p_at            timestamptz default null,
  p_detail        text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rank    int;
  v_updated int;
  v_push    int;
begin
  if p_wa_message_id is null or p_status is null then
    return false;
  end if;

  v_rank := case p_status
              when 'sent'      then 1
              when 'delivered' then 2
              when 'read'      then 3
              when 'failed'    then 9
              else 0
            end;
  -- סטטוס שאיננו מכירים (מטא מוסיפה סוגים מדי פעם) לא כותב כלום, כדי שלא
  -- ידרוס מצב אמיתי בערך שאיננו יודעים לדרג
  if v_rank = 0 then
    return false;
  end if;

  update public.whatsapp_messages m
     set status        = p_status,
         status_at     = coalesce(p_at, now()),
         status_detail = coalesce(p_detail, m.status_detail)
   where m.wa_message_id = p_wa_message_id
     and (
       m.status is null
       or case m.status
            when 'sent'      then 1
            when 'delivered' then 2
            when 'read'      then 3
            when 'failed'    then 9
            else 0
          end < v_rank
     );

  get diagnostics v_updated = row_count;

  -- הודעות ההתראות לסוכנים (‏notification-push) אינן ב-whatsapp_messages
  update public.notification_push_log l
     set delivery_status = p_status,
         delivery_at     = coalesce(p_at, now()),
         delivery_detail = coalesce(p_detail, l.delivery_detail)
   where l.wa_message_id = p_wa_message_id
     and (
       l.delivery_status is null
       or case l.delivery_status
            when 'sent'      then 1
            when 'delivered' then 2
            when 'read'      then 3
            when 'failed'    then 9
            else 0
          end < v_rank
     );

  get diagnostics v_push = row_count;
  return v_updated + v_push > 0;
end;
$$;

comment on function public.record_whatsapp_status(text, text, timestamptz, text) is
  'רושמת אירוע מסירה של Meta על הודעה יוצאת ביומן (whatsapp_messages, ומ-20270720090000 גם notification_push_log). מתקדמת רק קדימה בדירוג sent<delivered<read<failed, כי אירועי הסטטוס מגיעים בסדר לא מובטח.';

revoke all on function public.record_whatsapp_status(text, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.record_whatsapp_status(text, text, timestamptz, text)
  to service_role;
