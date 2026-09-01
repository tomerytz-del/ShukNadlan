-- ============================================================================
-- ניתוב הלידים של הפלטפורמה — ומה קורה כשאין למי להפנות
--
-- כל וידג'ט בדף הבית קולט לידים, וכל סוג ליד מיועד לקהל אחר: הערכת שווי
-- הולכת לסוכן/ת תיווך, מחשבון המשכנתא ליועצ/ת משכנתאות, וחיפוש שמור למי
-- שקונה לידי מחפשי דירה. עד היום כל אחד מהם ידע *לעצמו* אם מצא יעד, ואף
-- אחד לא ידע כשלא מצא:
--
--   ‏· ‏owner-lead-intake שלא מצא סוכן/ת מתאים/ה שמר את הליד עם agent_id
--     ריק והחזיר "לא נמצא סוכן Mid/Premium מתאים כרגע" — למי שקרא ל-API.
--     כלומר לדפדפן של הפונה, שאין לו מה לעשות עם המידע הזה.
--   ‏· ליד משכנתא נכנס למדף שרשאים לקנות ממנו רק חשבונות עם
--     ‏is_mortgage_advisor. כשאין אף אחד כזה — וכרגע אין — הליד יושב במדף
--     שאיש לא רואה, לנצח, בלי שאף אחד יודע.
--   ‏· חיפוש שמור נכנס למדף רק אם ניתן אישור ליצירת קשר *וגם* ציון
--     ההתעניינות עובר את הרף. חיפוש שלא עבר את הרף אינו מוצג לאיש.
--
-- המיגרציה הזו הופכת את השאלה "מה קרה לליד" לשורה בטבלה:
--
--   ‏1. ‏lead_routing_log — שורה אחת לכל ליד שנקלט, מכל וידג'ט: מאיפה הגיע,
--      לאיזה קהל הוא מיועד, כמה נמענים אפשריים נמצאו, ומה קרה לו בפועל.
--   ‏2. ‏lead_audience_size() — כמה נמענים יש היום לכל קהל. הגדרה אחת
--      שהפונקציות והדוחות חולקים, במקום ספירה משוכפלת בכל edge function.
--   ‏3. טריגר שמתריע למנהל/ת הפלטפורמה על כל ליד שאין לו יעד — אותה תבנית
--      בדיוק של alert_platform_admin_on_low_review מהביקורות.
--   ‏4. ‏lead_routing_open — התור של מנהל/ת הפלטפורמה: מה תקוע ולמה.
--
-- מה זה *לא* עושה: לא משנה את מנגנון ההתאמה, לא משנה מי רשאי לקנות מה, ולא
-- מזיז שקל. זו שכבת ראייה ואחריות מעל המנגנונים הקיימים.
--
-- הקובץ אידמפוטנטי — אפשר להריץ אותו שוב.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. סוג התראה חדש
--
-- ‏lead_unrouted מיועדת למנהל/ת הפלטפורמה בלבד, כמו review_alert. היא לא
-- אומרת "יש ליד חדש" (זה new_lead) אלא "יש ליד שאין לאן להפנות" — פעולה
-- נדרשת של הפלטפורמה, לא של סוכן/ת.
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('new_lead','system','review_request','review_alert',
                  'client_match','review_new','deal_closed','lead_unrouted'));

-- ---------------------------------------------------------------------------
-- 2. יומן הניתוב
--
-- שורה אחת לכל ליד, בכל אחת משלוש הטבלאות שבהן לידים חיים. המפתח הייחודי
-- הוא (lead_table, lead_id) ולא id בלבד: ‏edge function שנקרא פעמיים על אותו
-- ליד (רשת, ריטריי) לא ייצור שתי שורות ולא ישלח שתי התראות.
--
-- ‏lead_id אינו FK: הוא מצביע לשלוש טבלאות שונות, ומפתח זר יכול להצביע רק
-- לאחת. המחיקה מטופלת בטריגרים למטה — לא בהצהרה.
-- ---------------------------------------------------------------------------
create table if not exists public.lead_routing_log (
  id          uuid primary key default gen_random_uuid(),

  -- מאיפה הגיע: מזהה הווידג'ט, לא "דף הבית". ההבחנה הזו היא כל הערך של
  -- היומן כשמנהל/ת הפלטפורמה שואל/ת איזה כלי מייצר לידים ואיזה לא.
  source      text not null check (length(btrim(source)) between 2 and 60),

  -- לאיזה קהל הליד מיועד. זו ה"מיון" של הליד: לפיה נקבע מי בכלל יכול לקבלו.
  lead_kind   text not null check (lead_kind in
                ('agent_owner','agent_buyer','mortgage_advisor')),

  -- היכן יושב הליד עצמו
  lead_table  text not null check (lead_table in ('leads','saved_searches','mortgage_leads')),
  lead_id     uuid not null,

  -- מה קרה לו בפועל
  --   assigned    = שויך לסוכן/ת ספציפי/ת (ליד בעל/ת נכס אחרי ההתאמה)
  --   shelf       = פורסם למדף שקהל היעד רואה וקונה ממנו
  --   unrouted    = אין למי להפנות — זה המצב שמפעיל את ההתראה
  --   no_consent  = הפונה ביקש/ה התראות בלבד ולא אישר/ה יצירת קשר, ולכן
  --                 אין כאן ליד למכירה. נרשם כדי שהיומן יהיה מלא, ולא
  --                 כתקלה: זו בחירה של הפונה ולא כשל של הפלטפורמה.
  routing     text not null check (routing in ('assigned','shelf','unrouted','no_consent')),

  -- כמה נמענים אפשריים נמצאו ברגע הקליטה. ‏0 עם routing='unrouted' הוא
  -- המקרה הקלאסי; מספר גדול מאפס עם unrouted פירושו שהחסם אינו הקהל אלא
  -- הליד עצמו (למשל ציון התעניינות מתחת לרף) — ולכן שני השדות נשמרים.
  recipients  int not null default 0 check (recipients >= 0),
  reason      text,

  -- שורה אחת בעברית שמנהל/ת הפלטפורמה יכול/ה לפעול לפיה בלי לפתוח את הליד
  summary     text,

  -- הקשר לחיתוך ולדוחות
  city            text,
  neighborhood_id uuid references public.neighborhoods(id) on delete set null,
  deal_type       text,
  property_type   text,
  assigned_agent_id uuid references public.agency_members(id) on delete set null,

  -- הטיפול של מנהל/ת הפלטפורמה
  resolved_at  timestamptz,
  resolved_by  uuid references public.agency_members(id) on delete set null,
  resolution   text,

  created_at   timestamptz not null default now()
);

create unique index if not exists lead_routing_log_lead_key
  on public.lead_routing_log (lead_table, lead_id);
create index if not exists lead_routing_log_created_idx
  on public.lead_routing_log (created_at desc);
create index if not exists lead_routing_log_open_idx
  on public.lead_routing_log (created_at desc)
  where routing = 'unrouted' and resolved_at is null;
create index if not exists lead_routing_log_kind_idx
  on public.lead_routing_log (lead_kind, routing);

comment on table public.lead_routing_log is
  'יומן ניתוב הלידים: שורה לכל ליד שנקלט מווידג''ט כלשהו — לאיזה קהל הוא מיועד, כמה נמענים נמצאו ומה קרה לו. אין בו PII.';
comment on column public.lead_routing_log.source is
  'מזהה הווידג''ט ששלח את הליד (למשל homepage_owner_wizard, homepage_mortgage_calc).';
comment on column public.lead_routing_log.lead_kind is
  'קהל היעד: agent_owner = ליד בעל/ת נכס · agent_buyer = ליד מחפש/ת דירה · mortgage_advisor = ליד ייעוץ משכנתאות.';
comment on column public.lead_routing_log.routing is
  'assigned = שויך לסוכן/ת · shelf = פורסם למדף · unrouted = אין למי להפנות · no_consent = הפונה לא אישר/ה יצירת קשר.';
comment on column public.lead_routing_log.recipients is
  'מספר הנמענים האפשריים ברגע הקליטה. 0 עם unrouted = אין קהל; מספר חיובי עם unrouted = החסם הוא הליד ולא הקהל.';

alter table public.lead_routing_log enable row level security;

-- אין כאן שם, טלפון או אימייל — ובכל זאת הטבלה סגורה: היא מתארת את המצב
-- העסקי של הפלטפורמה (כמה לידים נופלים, איפה אין כיסוי), וזה לא עניינו של
-- אף סוכן/ת. ‏anon אינו נוגע בה כלל.
revoke all on public.lead_routing_log from anon;

-- ההרשאה לטבלה ניתנת במפורש ולא נשענת על default privileges של הפרויקט:
-- ‏lead_routing_open הוא security_invoker view, כלומר נבדק מול ההרשאות של
-- הקורא/ת עצמו/ה — וטבלה בלי grant מחזירה "permission denied" גם למנהל/ת
-- הפלטפורמה שה-policy מתירה לו/ה. השער הוא ה-RLS, לא ה-grant.
grant select, update on public.lead_routing_log to authenticated;

drop policy if exists "platform admin reads lead routing" on public.lead_routing_log;
create policy "platform admin reads lead routing"
  on public.lead_routing_log for select
  using (exists (
    select 1 from public.agency_members
     where agency_members.user_id = auth.uid()
       and agency_members.is_platform_admin = true));

-- העדכון היחיד שמותר הוא סימון הטיפול. ההוספה נעשית ב-service_role בלבד
-- (‏log_lead_routing), ואין policy למחיקה: יומן שאפשר למחוק ממנו אינו יומן.
drop policy if exists "platform admin resolves lead routing" on public.lead_routing_log;
create policy "platform admin resolves lead routing"
  on public.lead_routing_log for update
  using (exists (
    select 1 from public.agency_members
     where agency_members.user_id = auth.uid()
       and agency_members.is_platform_admin = true))
  with check (exists (
    select 1 from public.agency_members
     where agency_members.user_id = auth.uid()
       and agency_members.is_platform_admin = true));

-- ---------------------------------------------------------------------------
-- 3. גודל הקהל
--
-- הגדרה אחת לשאלה "כמה נמענים יש לקהל הזה היום", שמשרתת גם את הקליטה וגם
-- את הדוחות. הספירה היא של *מי שיכול/ה לקבל את הליד*, לא של מי שקנה בפועל:
--
--   ‏agent_owner      — סוכני Mid/Premium פעילים עם העדפות לידים פעילות.
--                      אלה בדיוק התנאים שב-findCandidateAgentIds, ובלעדיהם
--                      ליד בעל/ת נכס לא ישויך לאיש.
--   ‏agent_buyer      — כל סוכן/ת פעיל/ה: מדף מחפשי הדירה פתוח לכולם
--                      ‏(saved_search_leads_public מוענק ל-authenticated).
--   ‏mortgage_advisor — רק חשבונות שמנהל/ת הפלטפורמה סימנ/ה.
-- ---------------------------------------------------------------------------
create or replace function public.lead_audience_size(p_kind text)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select case p_kind
    when 'mortgage_advisor' then (
      select count(*)::int from agency_members
       where active = true and is_mortgage_advisor = true)
    when 'agent_buyer' then (
      select count(*)::int from agency_members
       where active = true)
    when 'agent_owner' then (
      select count(*)::int from agency_members m
       join agent_lead_preferences p on p.agent_id = m.id and p.active = true
       where m.active = true and m.tier in ('mid','premium'))
    else 0
  end;
$$;

comment on function public.lead_audience_size(text) is
  'כמה נמענים אפשריים יש היום לקהל לידים מסוים. נועד לזהות מראש ליד שאין למי להפנות.';

revoke all on function public.lead_audience_size(text) from public;
revoke all on function public.lead_audience_size(text) from anon;

-- ‏authenticated חייב את ה-EXECUTE הזה: ‏lead_routing_open קורא לפונקציה,
-- ו-PostgreSQL בודק הרשאת EXECUTE מול המשתמש/ת הקורא/ת ולא מול בעל ה-view.
-- בלעדיו כל פתיחה של "לידים ללא יעד" ב-CRM הייתה נופלת על
-- "permission denied for function lead_audience_size". אותו נימוק בדיוק
-- שבגללו saved_search_intent_score מוענקת ל-authenticated.
--
-- אין כאן דליפה: הפונקציה מחזירה מספר אחד — כמה נמענים יש לקהל — ואינה
-- מקבלת שום נתון של אדם.
grant execute on function public.lead_audience_size(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. ההתראה למנהל/ת הפלטפורמה
--
-- אותה תבנית של alert_platform_admin_on_low_review: לולאה על מנהלי
-- הפלטפורמה הפעילים והתראה לכל אחד/ת. שני הבדלים טכניים:
--
--   ‏· ‏related_lead_id מקבל ערך רק כשהליד יושב ב-leads — המפתח הזר של
--     ‏notifications מצביע לשם, וליד משכנתא או חיפוש שמור היו מפילים את
--     ההוספה. המזהה עצמו מופיע בגוף ההודעה, כדי שאפשר יהיה למצוא אותו.
--   ‏· ‏no_consent אינו מתריע: הפונה בחר/ה שלא להימכר, וזו אינה תקלה.
-- ---------------------------------------------------------------------------
create or replace function public.alert_platform_admin_on_unrouted_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_kind     text;
  v_body     text;
begin
  if new.routing <> 'unrouted' then
    return new;
  end if;

  v_kind := case new.lead_kind
    when 'mortgage_advisor' then 'ליד ייעוץ משכנתאות'
    when 'agent_buyer'      then 'ליד מחפש/ת דירה'
    else 'ליד בעל/ת נכס'
  end;

  v_body := v_kind
    || coalesce(' · ' || nullif(btrim(new.summary), ''), '')
    || ' · אין נמענים (' || new.recipients || ')'
    || coalesce(' · סיבה: ' || nullif(btrim(new.reason), ''), '')
    || ' · מקור: ' || new.source
    || ' · ' || new.lead_table || '/' || new.lead_id;

  for v_admin_id in
    select id from agency_members where is_platform_admin = true and active = true
  loop
    insert into notifications (agent_id, type, title, body, related_lead_id)
    values (
      v_admin_id,
      'lead_unrouted',
      'ליד חדש שאין למי להפנות',
      v_body,
      case when new.lead_table = 'leads' then new.lead_id else null end
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists lead_routing_alert_platform_admin on public.lead_routing_log;
create trigger lead_routing_alert_platform_admin
  after insert on public.lead_routing_log
  for each row execute function public.alert_platform_admin_on_unrouted_lead();

-- ---------------------------------------------------------------------------
-- 5. הרישום עצמו
--
-- נקראת מה-edge functions ב-service_role. ‏on conflict do nothing ולא upsert:
-- הקליטה עשויה לרוץ פעמיים על אותו ליד (ריטריי של הדפדפן), ועדכון היה מייצר
-- התראה שנייה על אותה בעיה בדיוק.
--
-- הפונקציה מחזירה גם את מספר מנהלי הפלטפורמה שקיבלו התראה ואת כתובות המייל
-- שלהם, כדי שהקורא יוכל להסלים גם למייל. היא לא שולחת מייל בעצמה — מסד
-- נתונים ששולח מיילים הוא מסד נתונים שנתקע כשספק המייל נתקע.
-- ---------------------------------------------------------------------------
create or replace function public.log_lead_routing(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row      lead_routing_log%rowtype;
  v_kind     text := nullif(btrim(p_payload->>'lead_kind'), '');
  v_routing  text := nullif(btrim(p_payload->>'routing'), '');
  v_admins   jsonb;
begin
  if v_kind is null or v_routing is null then
    return jsonb_build_object('error', 'missing_fields');
  end if;

  insert into lead_routing_log (
    source, lead_kind, lead_table, lead_id, routing, recipients, reason, summary,
    city, neighborhood_id, deal_type, property_type, assigned_agent_id
  )
  values (
    coalesce(nullif(btrim(p_payload->>'source'), ''), 'unknown'),
    v_kind,
    p_payload->>'lead_table',
    (p_payload->>'lead_id')::uuid,
    v_routing,
    coalesce((p_payload->>'recipients')::int, 0),
    nullif(btrim(p_payload->>'reason'), ''),
    left(nullif(btrim(p_payload->>'summary'), ''), 300),
    nullif(btrim(p_payload->>'city'), ''),
    nullif(p_payload->>'neighborhood_id', '')::uuid,
    nullif(btrim(p_payload->>'deal_type'), ''),
    nullif(btrim(p_payload->>'property_type'), ''),
    nullif(p_payload->>'assigned_agent_id', '')::uuid
  )
  on conflict (lead_table, lead_id) do nothing
  returning * into v_row;

  if v_row.id is null then
    return jsonb_build_object('success', true, 'duplicate', true);
  end if;

  if v_routing <> 'unrouted' then
    return jsonb_build_object('success', true, 'id', v_row.id, 'alerted', false);
  end if;

  select coalesce(jsonb_agg(email) filter (where email is not null), '[]'::jsonb)
    into v_admins
    from agency_members
   where is_platform_admin = true and active = true;

  return jsonb_build_object(
    'success', true, 'id', v_row.id, 'alerted', true, 'admin_emails', v_admins);
end;
$$;

comment on function public.log_lead_routing(jsonb) is
  'רישום ניתוב של ליד שנקלט. מחזירה admin_emails כשהליד לא נותב, כדי שהקורא יוכל להסלים גם למייל.';

-- ‏service_role בלבד: הפונקציה נקראת מ-edge functions, ולעולם לא מהדפדפן.
revoke all on function public.log_lead_routing(jsonb) from public;
revoke all on function public.log_lead_routing(jsonb) from anon;
revoke all on function public.log_lead_routing(jsonb) from authenticated;

-- ---------------------------------------------------------------------------
-- 6. התור של מנהל/ת הפלטפורמה
--
-- ‏security_invoker: ה-view נשען על ה-policy של הטבלה במקום לעקוף אותה, כך
-- שרק מנהל/ת פלטפורמה רואה אותו — גם אם מישהו יעניק עליו הרשאה בטעות.
-- ---------------------------------------------------------------------------
create or replace view public.lead_routing_open
with (security_invoker = true)
as
select
  l.id,
  l.created_at,
  l.source,
  l.lead_kind,
  l.lead_table,
  l.lead_id,
  l.recipients,
  l.reason,
  l.summary,
  l.city,
  l.deal_type,
  l.property_type,
  public.lead_audience_size(l.lead_kind) as audience_now
  from public.lead_routing_log l
 where l.routing = 'unrouted'
   and l.resolved_at is null
 order by l.created_at desc;

comment on view public.lead_routing_open is
  'הלידים שאין להם יעד וטרם טופלו. audience_now הוא גודל הקהל *עכשיו* — ליד שנפל כשלא היה אף יועץ משכנתאות יוצא מהתור ברגע שנרשם אחד.';

revoke all on public.lead_routing_open from anon;
grant select on public.lead_routing_open to authenticated;
