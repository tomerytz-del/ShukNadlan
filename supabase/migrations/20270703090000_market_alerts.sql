-- ===========================================================================
-- התראה על שוק מקומי שמתקרב לסף, עובר אותו, או יורד מתחתיו
--
-- הסוכן התפעולי (‏_market_gate ב-ops_agent/probes/behavior.py, כל שש שעות)
-- כותב שלושה ממצאים על שווקים: ‏market_near (שוק סגור עם 7 נכסים ומעלה),
-- ‏market_ready (שוק סגור שעבר את הסף - משרד ו-10 נכסים) ו-market_below_gate
-- (שוק חי שירד מתחת לסף). עד היום הם ישבו רק בפאנל "בריאות המערכת", ושוק
-- שעבר את הסף המשיך להגיש "נפתחים בקרוב" עד שמישהו פתח את הדשבורד.
--
-- ‏**מתי:** כשהממצא **נפתח** - נוצר, או נפתח מחדש אחרי שנסגר. אותו כלל של
-- ‏ops_findings_security_alert (‏20270421100000): ממצא פתוח מתעדכן בכל סריקה,
-- והתראה בכל עדכון הייתה רעש. בדרך לסף יוצאות שתיים: "מתקרב" ו"עבר"
-- (כשהשוק עובר את הסף market_near נסגר ו-market_ready נפתח).
--
-- ‏**לאן:** לכל מנהל/ת פלטפורמה פעיל/ה, בסוג market_alert. הפעמון והוואטסאפ
-- מובילים לפאנל "שווקים מקומיים" (‏dashPanelMarkets). בלי related_*: שוק אינו
-- נכס, לקוח/ה או ליד. docs/regional-pages.md, הסקיל market-go-live.
-- ===========================================================================

select public.notification_types_add(array['market_alert']);

create or replace function public.alert_platform_admin_on_market_finding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.code not in ('market_near', 'market_ready', 'market_below_gate')
     or new.resolved_at is not null then
    return new;
  end if;
  if new.muted_until is not null and new.muted_until > now() then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.resolved_at is null then
    return new;
  end if;

  -- ‏translate: הממצאים נכתבים כתיעוד פנימי, וכאן הם יוצאים לוואטסאפ - טקסט
  -- מוצג, שבו המקף הוא רגיל (CLAUDE.md).
  insert into public.notifications (agent_id, type, title, body)
  select m.id,
         'market_alert',
         translate(left(new.title, 140), '—–', '--'),
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
revoke all on function public.alert_platform_admin_on_market_finding()
  from public, anon, authenticated;

drop trigger if exists ops_findings_market_alert on public.ops_findings;
create trigger ops_findings_market_alert
  after insert or update of resolved_at on public.ops_findings
  for each row execute function public.alert_platform_admin_on_market_finding();
