-- ===========================================================================
-- התראה אקטיבית על ממצא אבטחה חמור
--
-- הסוכן התפעולי (‏ops_scan.py, כל שש שעות) כותב ממצאים ל-ops_findings, ועד
-- היום הם רק ישבו בפאנל "בריאות המערכת". ממצא אבטחה בדרגה high או critical
-- (טבלה שנפתחה ל-anon, פונקציה שכותבת בלי בדיקת זהות, סוד בקוד) הוא דבר
-- שצריך לדעת עליו **היום**, לא בפעם הבאה שמישהו פותח את הדשבורד.
--
-- ‏**מתי:** כשממצא כזה **נפתח** - נוצר, נפתח מחדש אחרי שנסגר, או הוחמר
-- לדרגה הזו. לא בכל סריקה: ממצא פתוח מתעדכן כל שש שעות, והתראה בכל
-- עדכון הייתה הופכת לרעש שמפסיקים לקרוא. ממצא מושתק (‏muted_until) שקט.
--
-- ‏**לאן:** לכל מנהל/ת פלטפורמה פעיל/ה, בטבלת notifications. משם הפעמון
-- ב-CRM, ו-notification-push שולח בוואטסאפ - הסוג החדש דלוק שם מעצמו,
-- כי notification_known_types() קוראת את האילוץ. בלי related_*: ממצא אינו
-- נכס, לקוח/ה או ליד, והקישור מוביל לפאנל (‏adminOps, ראו
-- handleGotoParam ב-assets/crm.js). docs/ops-agent.md.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. סוג ההתראה - **נוסף** לאילוץ הקיים, ולא כותב אותו מחדש. ‏PR ‏#711
--    מוסיף באותו זמן את showcase_meeting, ורשימה קשיחה כאן הייתה מוחקת
--    אותו (או נמחקת על ידו) לפי סדר המיזוג. כשהוא כבר במסד יש
--    notification_types_add(); אחרת - אותו דבר כאן, בלי תלות בסדר.
-- ---------------------------------------------------------------------------
do $$
declare
  v_types text[] := public.notification_known_types();
begin
  if to_regprocedure('public.notification_types_add(text[])') is not null then
    perform public.notification_types_add(array['security_alert']);
    return;
  end if;
  if coalesce(array_length(v_types, 1), 0) < 10 then
    raise exception 'notifications_type_check: לא נמצאה רשימת הסוגים הקיימת (%), לא מחליפים', v_types;
  end if;
  if 'security_alert' = any(v_types) then
    return;
  end if;
  v_types := v_types || 'security_alert'::text;
  alter table public.notifications drop constraint if exists notifications_type_check;
  execute format('alter table public.notifications add constraint notifications_type_check check (type in (%s))',
                 (select string_agg(quote_literal(t), ',' order by t) from unnest(v_types) t));
end $$;

-- ---------------------------------------------------------------------------
-- 2. הטריגר
-- ---------------------------------------------------------------------------
create or replace function public.alert_platform_admin_on_security_finding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_serious boolean := new.severity in ('critical', 'high');
  v_opened  boolean;
begin
  if new.area <> 'security' or not v_serious or new.resolved_at is not null then
    return new;
  end if;
  if new.muted_until is not null and new.muted_until > now() then
    return new;
  end if;

  v_opened := tg_op = 'INSERT'
           or old.resolved_at is not null
           or old.severity not in ('critical', 'high');
  if not v_opened then
    return new;
  end if;

  -- ‏translate: הטקסט של הממצאים נכתב עם מקף ארוך (הוא תיעוד פנימי), וכאן
  -- הוא יוצא לוואטסאפ - טקסט מוצג, שבו המקף הוא רגיל (CLAUDE.md).
  insert into public.notifications (agent_id, type, title, body)
  select m.id,
         'security_alert',
         translate(left('ממצא אבטחה: ' || new.title, 140), '—–', '--'),
         translate(left(new.detail, 400)
           || case when new.suggestion is not null
                   then ' מה לעשות: ' || left(new.suggestion, 300) else '' end, '—–', '--')
    from public.agency_members m
   where m.is_platform_admin = true
     and m.active = true;

  return new;
end;
$$;

-- פונקציית טריגר - PostgREST אינו חושף אותה, וההחלטה בכל זאת כתובה
revoke all on function public.alert_platform_admin_on_security_finding()
  from public, anon, authenticated;

drop trigger if exists ops_findings_security_alert on public.ops_findings;
create trigger ops_findings_security_alert
  after insert or update of severity, resolved_at on public.ops_findings
  for each row execute function public.alert_platform_admin_on_security_finding();
