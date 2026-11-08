-- ============================================================================
-- קליטת "שאלה לעו"ד" מדף הנכס, עם אימות טלפון בהודעה נכנסת בוואטסאפ
--
-- עד כאן המדף (lawyer_leads_public) והרכישה (בארנק ובכרטיס) היו מוכנים, אבל לא הייתה דרך להכניס לו ליד.
-- המיגרציה הזו מוסיפה את שני החצאים שחסרים ב-SQL, וה-Edge Functions והדף נכנסים באותו PR:
--
--   lawyer_lead_submit()     הקליטה. ליד נכנס `pending` ואינו במדף, ומקבל nonce של שש ספרות.
--   lawyer_lead_wa_verify()  האימות. הפונה שולח/ת לנו "אימות שאלה 482193" בוואטסאפ, ו-Meta מוסרת את המספר שממנו
--                            נשלחה ההודעה (from). רק כשהוא הנייד שבליד, הליד עולה למדף (`new`).
--
-- **למה הודעה נכנסת ולא קוד יוצא:** כמו בחתימה על הסכם (docs/client-agreements.md). קוד יוצא ללקוח שמעולם לא כתב לנו
-- דורש תבנית AUTHENTICATION, ואילו הודעה שהוא שולח אלינו אינה דורשת כלום, והיא גם חזקה יותר: Meta מעידה על המספר.
-- כרטיס המדף כבר אומר "טלפון מאומת בוואטסאפ" לעו"ד שמשלם, והקליטה חייבת לעמוד בזה.
--
-- ומה שקורה ברגע האימות, באותה טרנזקציה:
--   1. הליד עולה למדף.
--   2. נרשם ב-lead_routing_log (lead_kind 'lawyer'): במדף של עיר שיש בה עו"ד מאושר, או 'unrouted' עם התראה למנהל/ת
--      הפלטפורמה כשאין. בלי הרישום ליד בעיר בלי עו"ד יושב במדף שאיש אינו רואה, והכשל שקט.
--   3. הסוכן/ת של הנכס מקבל/ת התראה (סוג system, עם related_property_id, הסקיל agent-notifications) שהלקוח ביקש
--      ייעוץ משפטי. **ההתראה אינה נושאת שם, טלפון או שאלה:** אלה המוצר שנמכר לעו"ד. המתווך לא נעקף ולא מקבל את הליד.
--
-- פרטיות: ליד שלא אומת נמחק אחרי 7 ימים (ניקוי בתוך lawyer_lead_submit, בלי cron), ו-data_retention_run מכסה את
-- lawyer_leads במדיניות leads_pii (סעיף 9).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. עמודות האימות
-- ---------------------------------------------------------------------------
alter table public.lawyer_leads
  add column if not exists wa_verify_nonce text,
  add column if not exists wa_verify_requested_at timestamptz,
  add column if not exists client_ip_hash text;

comment on column public.lawyer_leads.wa_verify_nonce is
  'שש ספרות שהפונה שולח/ת בוואטסאפ ("אימות שאלה 482193"). מתאפס באימות. המספר שממנו נשלחה ההודעה הוא ההוכחה, לא הקוד.';
comment on column public.lawyer_leads.client_ip_hash is
  'גיבוב (עם מלח) של כתובת הגולש/ת, לבלם הצפה בלבד. מאופס במדיניות leads_pii.';

create index if not exists lawyer_leads_pending_idx
  on public.lawyer_leads (created_at) where status = 'pending';
create index if not exists lawyer_leads_ip_idx
  on public.lawyer_leads (client_ip_hash, created_at) where client_ip_hash is not null;

-- ---------------------------------------------------------------------------
-- 2. רישום הניתוב מכיר ליד עו"ד
--
-- lead_kind ו-lead_table הם CHECK על העמודה. מרחיבים בכתיבה מחדש של הרשימה בכל מקום שמכיר אותה:
-- האילוצים, lead_audience_size() והתווית בהתראת "ליד שאין למי להפנות".
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_constraint
              where conrelid = 'public.lead_routing_log'::regclass
                and conname = 'lead_routing_log_lead_kind_check') then
    alter table public.lead_routing_log drop constraint lead_routing_log_lead_kind_check;
  end if;
  alter table public.lead_routing_log
    add constraint lead_routing_log_lead_kind_check
    check (lead_kind in ('agent_owner','agent_buyer','mortgage_advisor','lawyer'));

  if exists (select 1 from pg_constraint
              where conrelid = 'public.lead_routing_log'::regclass
                and conname = 'lead_routing_log_lead_table_check') then
    alter table public.lead_routing_log drop constraint lead_routing_log_lead_table_check;
  end if;
  alter table public.lead_routing_log
    add constraint lead_routing_log_lead_table_check
    check (lead_table in ('leads','saved_searches','mortgage_leads','lawyer_leads'));
end $$;

comment on column public.lead_routing_log.lead_kind is
  'קהל היעד: agent_owner = ליד בעל/ת נכס · agent_buyer = ליד מחפש/ת דירה · mortgage_advisor = ליד ייעוץ משכנתאות · lawyer = שאלה לעו"ד.';

-- הגוף של שתי הפונקציות מועתק מהגרסה היחידה שלהן (20260913090000) והשינוי היחיד הוא ענף 'lawyer'
create or replace function public.lead_audience_size(p_kind text)
returns integer
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
    when 'lawyer' then (
      select count(*)::int from professional_accounts
       where active = true and shelf_enabled = true and kind = 'real_estate_lawyer')
    else 0
  end;
$$;

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
    when 'lawyer'           then 'שאלה לעו"ד'
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

-- ---------------------------------------------------------------------------
-- 3א. ניקוי ליד שלא אומת: אחרי 7 ימים
--
-- שם, טלפון ומייל של מי שלא שלח/ה את הודעת האימות אינם נשמרים. מופעל מכל קליטה וגם מ-cron יומי (סעיף 8): מי שנשען על
-- הקליטה בלבד הבטיח מחיקה שתלויה בכך שמישהו ימלא טופס.
-- ---------------------------------------------------------------------------
create or replace function public.lawyer_lead_purge_unverified()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  with gone as (
    delete from public.lawyer_leads
     where status = 'pending' and created_at < now() - interval '7 days'
    returning 1
  )
  select count(*) into v_n from gone;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. הקליטה
--
-- service_role בלבד, מ-lawyer-lead-intake (ציבורית). הדפדפן שולח טקסט, וכל הכללים כאן:
--   * הנכס חייב להיות פעיל. העיר נגזרת ממנו, לא ממה שהדפדפן טוען.
--   * ליד פתוח אחד לכל טלפון (lawyer_leads_open_phone_key). pending קיים מתעדכן (שאלה חדשה, nonce חדש, לא לפני דקה);
--     new קיים אינו נוצר שוב: הפונה כבר במדף, וזו הצלחה מבחינתו.
--   * בלם הצפה: 5 לשעה לכתובת, 20 לשעה לנכס, 200 לשעה לאתר. ליד pending אינו במדף ואינו נמכר, ולכן העלות
--     היא טבלה מתנפחת וחסימת פונים אמיתיים, לא כסף.
--   * ניקוי: ליד pending מעל 7 ימים נמחק כאן, בלי cron. פרטים של מי שלא אימת/ה אינם נשמרים.
-- ---------------------------------------------------------------------------
create or replace function public.lawyer_lead_submit(
  p_property_id uuid,
  p_full_name   text,
  p_phone       text,
  p_email       text,
  p_question    text,
  p_ip_hash     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name     text := btrim(coalesce(p_full_name, ''));
  v_question text := btrim(coalesce(p_question, ''));
  v_email    text := nullif(btrim(coalesce(p_email, '')), '');
  v_phone    text := btrim(coalesce(p_phone, ''));
  v_e164     text;
  v_prop     record;
  v_existing public.lawyer_leads%rowtype;
  v_nonce    text;
  v_id       uuid;
  v_n        int;
begin
  if length(v_name) < 2 or length(v_name) > 100 then
    return jsonb_build_object('error', 'invalid_name');
  end if;
  if length(v_question) < 10 or length(v_question) > 2000 then
    return jsonb_build_object('error', 'invalid_question');
  end if;
  v_e164 := public.normalize_msisdn(v_phone);
  -- נייד ישראלי בלבד: אימות וואטסאפ עובד רק מול מספר נייד, וקו נייח לא היה עובר אותו לעולם
  if v_e164 is null or v_e164 !~ '^9725[0-9]{8}$' then
    return jsonb_build_object('error', 'invalid_phone');
  end if;
  if v_email is not null and (length(v_email) > 200 or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$') then
    return jsonb_build_object('error', 'invalid_email');
  end if;

  -- ניקוי מי שלא אימת: גם כאן (כל קליטה מנקה) וגם ב-cron היומי, כדי שההבטחה לא תלויה בתנועה
  perform public.lawyer_lead_purge_unverified();

  select p.id, p.city_id into v_prop
    from public.properties p
   where p.id = p_property_id and p.status = 'active';
  if not found then
    return jsonb_build_object('error', 'property_not_found');
  end if;

  -- בלם הצפה
  if p_ip_hash is not null and p_ip_hash !~ '^0+$' then
    select count(*) into v_n from public.lawyer_leads
     where client_ip_hash = p_ip_hash and created_at > now() - interval '1 hour';
    if v_n >= 5 then
      return jsonb_build_object('error', 'rate_limited');
    end if;
  end if;
  select count(*) into v_n from public.lawyer_leads
   where property_id = p_property_id and created_at > now() - interval '1 hour';
  if v_n >= 20 then
    return jsonb_build_object('error', 'rate_limited');
  end if;
  select count(*) into v_n from public.lawyer_leads
   where created_at > now() - interval '1 hour';
  if v_n >= 200 then
    return jsonb_build_object('error', 'rate_limited');
  end if;

  v_nonce := lpad((floor(random() * 1000000))::int::text, 6, '0');

  select * into v_existing from public.lawyer_leads
   where phone_e164 = v_e164 and status in ('pending', 'new')
   for update;

  if found then
    if v_existing.status = 'new' then
      -- כבר במדף: הפנייה שלו/ה במערכת
      return jsonb_build_object('success', true, 'duplicate', true, 'verified', true, 'lead_id', v_existing.id);
    end if;
    if v_existing.wa_verify_requested_at is not null
       and v_existing.wa_verify_requested_at > now() - interval '1 minute' then
      -- לחיצה כפולה או תיקון מהיר של השאלה: אותו nonce, כדי שהודעה ששלח/ה כבר לא תיפסל, אבל **התוכן מתעדכן**:
      -- השאלה היא מה שעורך הדין משלם עליו, ואסור שגרסה ישנה שלה תיקלט בשקט
      update public.lawyer_leads
         set full_name = v_name, email = v_email, question = v_question,
             property_id = p_property_id, city_id = v_prop.city_id
       where id = v_existing.id;
      return jsonb_build_object('success', true, 'lead_id', v_existing.id, 'nonce', v_existing.wa_verify_nonce,
                                'verified', false);
    end if;
    update public.lawyer_leads
       set full_name = v_name, email = v_email, question = v_question,
           property_id = p_property_id, city_id = v_prop.city_id,
           wa_verify_nonce = v_nonce, wa_verify_requested_at = now(),
           client_ip_hash = coalesce(p_ip_hash, client_ip_hash)
     where id = v_existing.id;
    return jsonb_build_object('success', true, 'lead_id', v_existing.id, 'nonce', v_nonce, 'verified', false);
  end if;

  insert into public.lawyer_leads
    (full_name, phone, email, question, property_id, city_id, status,
     wa_verify_nonce, wa_verify_requested_at, client_ip_hash, source)
  values
    (v_name, v_phone, v_email, v_question, p_property_id, v_prop.city_id, 'pending',
     v_nonce, now(), p_ip_hash, 'property_page')
  returning id into v_id;

  return jsonb_build_object('success', true, 'lead_id', v_id, 'nonce', v_nonce, 'verified', false);
exception when unique_violation then
  -- שתי קליטות במקביל מאותו טלפון: השנייה מצטרפת לראשונה ומקבלת את אותו nonce (או "כבר במדף")
  select * into v_existing from public.lawyer_leads
   where phone_e164 = v_e164 and status in ('pending', 'new') limit 1;
  if not found then
    return jsonb_build_object('error', 'try_again');
  end if;
  if v_existing.status = 'new' then
    return jsonb_build_object('success', true, 'duplicate', true, 'verified', true, 'lead_id', v_existing.id);
  end if;
  return jsonb_build_object('success', true, 'duplicate', true, 'verified', false,
                            'lead_id', v_existing.id, 'nonce', v_existing.wa_verify_nonce);
end;
$$;

comment on function public.lawyer_lead_submit(uuid, text, text, text, text, text) is
  'קליטת שאלה לעו"ד מדף נכס: ליד pending עם nonce לאימות בוואטסאפ. service_role בלבד, דרך lawyer-lead-intake.';

-- ---------------------------------------------------------------------------
-- 4. האימות: ההודעה הנכנסת ("אימות שאלה 482193")
-- ---------------------------------------------------------------------------
create or replace function public.lawyer_lead_wa_verify(p_nonce text, p_from text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead   public.lawyer_leads%rowtype;
  v_title  text;
  v_agent  uuid;
  v_market int;
  v_summary text;
begin
  -- המספר שממנו נשלחה ההודעה הוא ההוכחה, לא הקוד: שש ספרות יכולות לחזור אצל שני פונים
  select * into v_lead from public.lawyer_leads
   where status = 'pending' and wa_verify_nonce = p_nonce
     and wa_verify_requested_at > now() - interval '30 minutes'
     and phone_e164 = p_from
   order by wa_verify_requested_at desc
   limit 1
   for update;

  if not found then
    -- שלחו פעמיים: הליד כבר אומת לפני רגע
    if exists (select 1 from public.lawyer_leads
                where phone_e164 = p_from and status in ('new', 'sold')
                  and phone_verified_at > now() - interval '30 minutes') then
      return jsonb_build_object('verified', true, 'already', true,
        'reply', 'השאלה שלך כבר אומתה ✅ עורך דין שירכוש אותה ייצור איתך קשר בטלפון.');
    end if;
    if exists (select 1 from public.lawyer_leads
                where status = 'pending' and wa_verify_nonce = p_nonce
                  and wa_verify_requested_at > now() - interval '30 minutes') then
      return jsonb_build_object('verified', false,
        'reply', 'ההודעה נשלחה ממספר שאינו המספר שהוזן בטופס. שלחו אותה מהנייד שהזנתם, או מלאו את הטופס מחדש.');
    end if;
    return jsonb_build_object('verified', false,
      'reply', 'הקוד פג או שאינו מוכר. חזרו לדף הנכס ולחצו שוב על "שליחה ואימות בוואטסאפ".');
  end if;

  update public.lawyer_leads
     set status = 'new', phone_verified_at = now(), wa_verify_nonce = null
   where id = v_lead.id;

  select p.title, p.agent_id into v_title, v_agent
    from public.properties p where p.id = v_lead.property_id;

  -- רישום הניתוב: האם יש עו"ד מאושר בעיר (או באותו שוק)
  select count(*)::int into v_market
    from public.professional_accounts pa
    left join public.cities pc on pc.id = pa.city_id
    left join public.cities lc on lc.id = v_lead.city_id
   where pa.active and pa.shelf_enabled and pa.kind = 'real_estate_lawyer'
     and (v_lead.city_id is null
          or pa.city_id = v_lead.city_id
          or (pc.market_slug is not null and pc.market_slug = lc.market_slug));

  v_summary := left(coalesce(nullif(btrim(v_title), ''), 'שאלה כללית'), 120);

  insert into public.lead_routing_log
    (source, lead_kind, lead_table, lead_id, routing, recipients, reason, summary)
  values
    ('property_page_lawyer_question', 'lawyer', 'lawyer_leads', v_lead.id,
     case when v_market > 0 then 'shelf' else 'unrouted' end,
     v_market,
     case when v_market > 0 then null else 'no_lawyer_in_city' end,
     v_summary)
  on conflict (lead_table, lead_id) do nothing;

  -- התראה לסוכן/ת של הנכס. בלי שם, טלפון ושאלה: הם המוצר שנמכר לעו"ד
  if v_agent is not null then
    insert into public.notifications (agent_id, type, title, body, related_property_id)
    values (
      v_agent, 'system',
      'מבקר/ת ביקש/ה ייעוץ משפטי על הנכס שלך',
      'מבקר/ת בנכס "' || coalesce(nullif(btrim(v_title), ''), 'הנכס') || '" השאיר/ה באתר שאלה לעורך דין. '
        || 'פרטי הפונה נמסרים רק לעורך דין שרוכש את השאלה, ואינם עוברים אליך. הנכס והפניות שלך אינם מושפעים.',
      v_lead.property_id
    );
  end if;

  return jsonb_build_object('verified', true, 'lead_id', v_lead.id, 'routing_recipients', v_market,
    'reply', 'אומת ✅ השאלה שלך נקלטה. עורך דין באזור שירכוש אותה ייצור איתך קשר בטלפון. ' ||
             'השאלה אינה יוצרת יחסי עורך דין-לקוח, ואל תשלחו סיסמאות, פרטי תשלום או מסמכי זהות.');
end;
$$;

comment on function public.lawyer_lead_wa_verify(text, text) is
  'אימות ליד "שאלה לעו"ד" בהודעה נכנסת בוואטסאפ. pending ← new, רישום ניתוב והתראה לסוכן/ת הנכס. service_role בלבד, מ-whatsapp-webhook.';

-- ---------------------------------------------------------------------------
-- 5. מצב האימות לדף (בלי לחשוף דבר מעבר ל"אומת או לא")
-- ---------------------------------------------------------------------------
create or replace function public.lawyer_lead_verified(p_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.lawyer_leads
                  where id = p_lead_id and status in ('new', 'sold') and phone_verified_at is not null);
$$;

-- ---------------------------------------------------------------------------
-- 6. הרשאות: הכל service_role בלבד
-- ---------------------------------------------------------------------------
revoke all on function public.lawyer_lead_submit(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.lawyer_lead_submit(uuid, text, text, text, text, text) to service_role;

revoke all on function public.lawyer_lead_wa_verify(text, text) from public, anon, authenticated;
grant execute on function public.lawyer_lead_wa_verify(text, text) to service_role;

revoke all on function public.lawyer_lead_verified(uuid) from public, anon, authenticated;
grant execute on function public.lawyer_lead_verified(uuid) to service_role;

revoke all on function public.lawyer_lead_purge_unverified() from public, anon, authenticated;
grant execute on function public.lawyer_lead_purge_unverified() to service_role;

-- ---------------------------------------------------------------------------
-- 8. התור של מנהל/ת הפלטפורמה: "קהל עכשיו" לליד עו"ד נספר לפי העיר של הליד
--
-- lead_audience_size('lawyer') סופרת עו"ד מאושרים בכל הארץ, ולכן "יש קהל עכשיו" היה נדלק על ליד שאף אחד מהם לא רואה
-- במדף (העיר שלו אחרת). בשאר הסוגים אין ממד עיר, והם נשארים על הפונקציה. התצוגה security_invoker: מנהל/ת הפלטפורמה
-- קורא/ת את professional_accounts דרך ה-policy שלו/ה, ושאר המשתמשים ממילא אינם רואים שורות.
-- עמודות בלי שינוי, באותו סדר.
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
  case when l.lead_kind = 'lawyer' then (
    select count(*)::int
      from public.professional_accounts pa
      left join public.cities pc on pc.id = pa.city_id
      join public.lawyer_leads ll on ll.id = l.lead_id
      left join public.cities lc on lc.id = ll.city_id
     where pa.active and pa.shelf_enabled and pa.kind = 'real_estate_lawyer'
       and (ll.city_id is null
            or pa.city_id = ll.city_id
            or (pc.market_slug is not null and pc.market_slug = lc.market_slug)))
  else public.lead_audience_size(l.lead_kind) end as audience_now
  from public.lead_routing_log l
 where l.routing = 'unrouted'
   and l.resolved_at is null
 order by l.created_at desc;

-- ניקוי יומי של ליד שלא אומת (סעיף 3א), 03:57 UTC
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'lawyer-leads-purge-unverified') then
      perform cron.unschedule('lawyer-leads-purge-unverified');
    end if;
    perform cron.schedule(
      'lawyer-leads-purge-unverified',
      '57 3 * * *',
      $cron$select public.lawyer_lead_purge_unverified();$cron$
    );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. data_retention_run מכסה את lawyer_leads (מדיניות leads_pii, שנתיים)
-- ---------------------------------------------------------------------------
create or replace function public.data_retention_run()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s         record;
  v_cut     timestamptz;
  v_n       integer;
  v_parts   jsonb;
  v_out     jsonb := '{}'::jsonb;
  v_warn    integer;
begin
  for s in select * from public.data_retention_settings order by policy loop
    v_cut := now() - s.keep_for;
    v_parts := '{}'::jsonb;

    if s.policy = 'leads_pii' then
      -- ליד שקשור לחוזה נשאר כמו שהוא: החוזה הוא רשומה של עסקה, והסוכן/ת
      -- צריך/ה לדעת מול מי.
      select count(*) into v_n from public.leads l
       where l.created_at < v_cut
         and (l.raw_name is not null or l.raw_phone is not null
              or l.raw_message is not null or l.property_details is not null)
         and not exists (select 1 from public.contracts k where k.lead_id = l.id);
      v_parts := v_parts || jsonb_build_object('leads', v_n);
      select count(*) into v_n from public.mortgage_leads m
       where m.created_at < v_cut and m.full_name <> 'נמחק';
      v_parts := v_parts || jsonb_build_object('mortgage_leads', v_n);
      select count(*) into v_n from public.project_leads p
       where p.created_at < v_cut and p.full_name <> 'נמחק';
      v_parts := v_parts || jsonb_build_object('project_leads', v_n);
      select count(*) into v_n from public.ads_leads a
       where a.received_at < v_cut and a.field_data <> '{}'::jsonb;
      v_parts := v_parts || jsonb_build_object('ads_leads', v_n);
      select count(*) into v_n from public.rss_leads r
       where r.created_at < v_cut and r.raw_content is not null;
      v_parts := v_parts || jsonb_build_object('rss_leads', v_n);
      -- שאלות לעו"ד (שם, טלפון, מייל, השאלה וגיבוב הכתובת). ליד שלא אומת נמחק כבר אחרי 7 ימים ב-lawyer_lead_submit
      select count(*) into v_n from public.lawyer_leads w
       where w.created_at < v_cut and w.full_name <> 'נמחק';
      v_parts := v_parts || jsonb_build_object('lawyer_leads', v_n);
      select count(*) into v_n from public.lead_routing_log g
       where g.created_at < v_cut and g.summary is not null;
      v_parts := v_parts || jsonb_build_object('lead_routing_log', v_n);

      if s.enabled then
        update public.leads l
           set raw_name = null, raw_phone = null, raw_message = null, property_details = null
         where l.created_at < v_cut
           and (l.raw_name is not null or l.raw_phone is not null
                or l.raw_message is not null or l.property_details is not null)
           and not exists (select 1 from public.contracts k where k.lead_id = l.id);
        -- ‏full_name ו-phone הם not null (ו-full_name באורך 2 לפחות)
        update public.mortgage_leads
           set full_name = 'נמחק', phone = '', email = null
         where created_at < v_cut and full_name <> 'נמחק';
        update public.project_leads
           set full_name = 'נמחק', phone = '', phone_e164 = null, email = null, message = null
         where created_at < v_cut and full_name <> 'נמחק';
        update public.ads_leads set field_data = '{}'::jsonb
         where received_at < v_cut and field_data <> '{}'::jsonb;
        update public.rss_leads set raw_content = null, raw_title = null
         where created_at < v_cut and raw_content is not null;
        -- ‏phone_e164 מחושבת (generated), ולכן לא נכתבת: phone = '' מחשב אותה מחדש ל-null.
        -- ‏question מוחלפת בטקסט ולא ב-null: יש עליה CHECK של 10 תווים לפחות.
        -- ליד פתוח (pending או new) שנמחק הופך ל-archived באותה פקודה: lawyer_leads_public מסנן רק לפי status = 'new',
        -- וליד מרוקן שנשאר במדף היה נמכר ב-₪59 בלי טלפון ובלי שאלה.
        update public.lawyer_leads
           set full_name = 'נמחק', phone = '', email = null,
               question = 'תוכן השאלה נמחק לפי מדיניות שמירת מידע',
               client_ip_hash = null, wa_verify_nonce = null,
               status = case when status in ('pending', 'new') then 'archived' else status end
         where created_at < v_cut and full_name <> 'נמחק';
        update public.lead_routing_log set summary = null
         where created_at < v_cut and summary is not null;
      end if;

    elsif s.policy = 'whatsapp_bodies' then
      select count(*) into v_n from public.whatsapp_messages w
       where w.created_at < v_cut and (w.body is not null or w.media_url is not null);
      v_parts := v_parts || jsonb_build_object('whatsapp_messages', v_n);
      select count(*) into v_n from public.whatsapp_conversations c
       where c.last_message_at < v_cut and c.history <> '[]'::jsonb;
      v_parts := v_parts || jsonb_build_object('whatsapp_conversations', v_n);
      select count(*) into v_n from public.whatsapp_public_conversations c
       where c.last_message_at < v_cut and c.history <> '[]'::jsonb;
      v_parts := v_parts || jsonb_build_object('whatsapp_public_conversations', v_n);

      if s.enabled then
        update public.whatsapp_messages set body = null, media_url = null
         where created_at < v_cut and (body is not null or media_url is not null);
        update public.whatsapp_conversations set history = '[]'::jsonb
         where last_message_at < v_cut and history <> '[]'::jsonb;
        update public.whatsapp_public_conversations set history = '[]'::jsonb
         where last_message_at < v_cut and history <> '[]'::jsonb;
      end if;

    elsif s.policy = 'call_transcripts' then
      select count(*) into v_n from public.agent_calls k
       where k.created_at < v_cut
         and (k.transcript is not null or k.summary is not null or k.extracted is not null);
      v_parts := v_parts || jsonb_build_object('agent_calls', v_n);
      if s.enabled then
        update public.agent_calls set transcript = null, summary = null, extracted = null
         where created_at < v_cut
           and (transcript is not null or summary is not null or extracted is not null);
      end if;

    elsif s.policy = 'clients_inactive' then
      -- שני שלבים: התראה כשנשאר שבוע, ומחיקה רק אם ההתראה יצאה לפני שבוע
      -- לפחות **ואין פעילות מאז**. כל עדכון בכרטיס אחרי ההתראה מאפס.
      create temp table _ret_clients on commit drop as
        select c.id, c.agent_id, c.full_name, public._client_last_activity(c.id) as last_at
          from public.agent_clients c;

      select count(*) into v_warn from _ret_clients r
       where r.last_at < v_cut + interval '7 days'
         and not exists (select 1 from public.data_retention_client_warnings w
                          where w.client_id = r.id and w.warned_at > r.last_at);
      select count(*) into v_n from _ret_clients r
        join public.data_retention_client_warnings w on w.client_id = r.id
       where r.last_at < v_cut
         and w.warned_at > r.last_at
         and w.warned_at < now() - interval '7 days';
      -- בהרצת יבש עוד לא יצאה אף התראה, ולכן "היה נמחק" = כרטיסים שכבר
      -- עברו את הסף. זה המספר שיימחק שבוע אחרי ההדלקה.
      if not s.enabled then
        select count(*) into v_n from _ret_clients r where r.last_at < v_cut;
      end if;
      v_parts := v_parts || jsonb_build_object('agent_clients', v_n, 'warnings', v_warn);

      if s.enabled then
        delete from public.agent_clients c
         using _ret_clients r, public.data_retention_client_warnings w
         where c.id = r.id and w.client_id = r.id
           and r.last_at < v_cut
           and w.warned_at > r.last_at
           and w.warned_at < now() - interval '7 days';

        -- suppress_push בעמודות: זו התראה חיה (שבוע לפני מחיקה), לא מילוי
        -- היסטוריה. false משאיר אותה לדחיפה. בלי העמודה הבדיקה חוסמת
        -- את הקובץ, כי הוא אחרי 20271029140000.
        insert into public.notifications (agent_id, type, title, body, related_client_id, suppress_push)
        select r.agent_id, 'retention_warning',
               'כרטיס לקוח/ה יימחק בעוד שבוע',
               'הכרטיס של ' || coalesce(nullif(r.full_name, ''), 'לקוח/ה') ||
               ' לא היה פעיל שנתיים, ולכן יימחק בעוד שבוע לפי מדיניות השמירה. '
               || 'כל עדכון בכרטיס משאיר אותו.',
               r.id,
               false
          from _ret_clients r
         where r.agent_id is not null
           and r.last_at < v_cut + interval '7 days'
           and not exists (select 1 from public.data_retention_client_warnings w
                            where w.client_id = r.id and w.warned_at > r.last_at);

        -- אותו תנאי כמו ההתראה שלמעלה: רק מי שאין לו/ה התראה מאז הפעילות
        -- האחרונה. ‏(הכרטיסים שנמחקו כבר אינם - ה-FK היה נכשל עליהם.)
        insert into public.data_retention_client_warnings (client_id, warned_at)
        select r.id, now() from _ret_clients r
         where r.last_at < v_cut + interval '7 days'
           and exists (select 1 from public.agent_clients c where c.id = r.id)
           and not exists (select 1 from public.data_retention_client_warnings w
                            where w.client_id = r.id and w.warned_at > r.last_at)
        on conflict (client_id) do update set warned_at = excluded.warned_at;
      end if;
      drop table if exists _ret_clients;

    elsif s.policy = 'whatsapp_pending_actions' then
      -- נשמר מ-20271029165000. בלי הענף הזה ההחלפה של הפונקציה מוחקת את הניקוי.
      select count(*) into v_n from public.whatsapp_pending_actions a
       where (a.executed_at is not null and a.executed_at < v_cut)
          or (a.executed_at is null and a.expires_at < v_cut);
      v_parts := v_parts || jsonb_build_object('whatsapp_pending_actions', v_n);
      if s.enabled then
        delete from public.whatsapp_pending_actions a
         where (a.executed_at is not null and a.executed_at < v_cut)
            or (a.executed_at is null and a.expires_at < v_cut);
      end if;

    elsif s.policy = 'search_misses' then
      select count(*) into v_n from public.agent_search_misses m
       where m.created_at < v_cut;
      v_parts := v_parts || jsonb_build_object('agent_search_misses', v_n);
      if s.enabled then
        delete from public.agent_search_misses
         where created_at < v_cut;
      end if;

    elsif s.policy = 'deeplink_timings' then
      select count(*) into v_n from public.deeplink_timings d
       where d.created_at < v_cut;
      v_parts := v_parts || jsonb_build_object('deeplink_timings', v_n);
      if s.enabled then
        delete from public.deeplink_timings
         where created_at < v_cut;
        delete from public.deeplink_timing_calls
         where called_at < v_cut;
      end if;

    elsif s.policy = 'visualization_visitor_ids' then
      -- נשמר מ-20271106160000. מזהה המכשיר וגיבוב ה-IP משרתים רק את בלם
      -- 24 השעות; אחרי 30 יום הם נמחקים מהשורה, והשורה (העבודה, הליד,
      -- החיוב) נשארת.
      select count(*) into v_n from public.visualization_jobs j
       where j.created_at < v_cut
         and (j.device_id is not null or j.client_ip_hash is not null);
      v_parts := v_parts || jsonb_build_object('visualization_jobs', v_n);
      if s.enabled then
        update public.visualization_jobs
           set device_id = null, client_ip_hash = null
         where created_at < v_cut
           and (device_id is not null or client_ip_hash is not null);
      end if;
    end if;

    v_n := (select coalesce(sum(value::int), 0) from jsonb_each_text(v_parts)
             where key <> 'warnings');
    insert into public.data_retention_runs (policy, dry_run, affected, details)
    values (s.policy, not s.enabled, v_n, v_parts);
    v_out := v_out || jsonb_build_object(s.policy, v_parts || jsonb_build_object('dry_run', not s.enabled));
  end loop;
  return v_out;
end $$;

revoke all on function public.data_retention_run() from public, anon, authenticated;
