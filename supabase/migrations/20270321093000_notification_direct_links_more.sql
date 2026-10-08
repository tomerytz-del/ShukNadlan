-- ============================================================================
-- קישור ישיר, המשך: נכס ששותף איתך, ביקורת, הסכם שנחתם, ותזכורת מהיומן
-- ============================================================================
--
-- ‏20270320093000 נתן קישור ישיר להתראות על נכס, לקוח/ה וליד. ארבעה סוגים
-- נשארו מחוץ לו, וביניהם הנפוץ ביותר בפלטפורמה:
--
--   ‏· "נכס חדש שותף איתך" - כ-75% מכל ההתראות (1,080 ב-60 יום), בלי מזהה נכס.
--   ‏· "ביקורת חדשה" - בלי מזהה ביקורת.
--   ‏· "הסכם שנחתם" - בלי מזהה הסכם.
--   ‏· תזכורת מהיומן - המזהה היה (related_agenda_item_id) והפעמון השתמש בו,
--     אבל ה-claim לא החזיר אותו לוואטסאפ.
--
-- המיגרציה מוסיפה related_review_id ו-related_agreement_id, מחליפה את שלוש
-- הפונקציות שכותבות את ההתראות האלה (**מהגרסה האחרונה שלהן, ורק ה-insert
-- השתנה**, ועוד מקף ארוך אחד בכותרת שמוצגת), ומרחיבה את notification_push_claim.
--
-- ‏notify_on_new_review בפרודקשן זהה לגרסה שבריפו פרט להערות (הוחלה בלעדיהן);
-- ההחלפה מחזירה את ההערות ואינה משנה התנהגות.
--
-- הפרטים: docs/notifications-center.md, "קישור ישיר".
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. העמודות
-- ---------------------------------------------------------------------------
alter table public.notifications
  add column if not exists related_review_id uuid;
alter table public.notifications
  add column if not exists related_agreement_id uuid;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'notifications_related_review_id_fkey') then
    alter table public.notifications
      add constraint notifications_related_review_id_fkey
      foreign key (related_review_id) references public.reviews(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'notifications_related_agreement_id_fkey') then
    alter table public.notifications
      add constraint notifications_related_agreement_id_fkey
      foreign key (related_agreement_id) references public.agreements(id) on delete set null;
  end if;
end $$;

create index if not exists notifications_related_review_id_idx
  on public.notifications (related_review_id) where related_review_id is not null;
create index if not exists notifications_related_agreement_id_idx
  on public.notifications (related_agreement_id) where related_agreement_id is not null;

comment on column public.notifications.related_review_id is
  'הביקורת שההתראה עוסקת בה. ממנה נבנה הקישור - לתור האישור או לדף הסוכן/ת.';
comment on column public.notifications.related_agreement_id is
  'ההסכם שההתראה עוסקת בו. ממנו נבנה הקישור לכרטיס ההסכם ב-CRM.';

-- ---------------------------------------------------------------------------
-- 2. נכס ששותף איתך (גרסה: 20261119090000)
-- ---------------------------------------------------------------------------
create or replace function public.share_property_for_agent(
  p_agent_id    uuid,
  p_property_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent       public.agency_members%rowtype;
  v_prop        public.properties%rowtype;
  v_agency_name text;
  v_added       int := 0;
  v_revoked     int := 0;
  v_total       int := 0;
begin
  select * into v_agent from public.agency_members
   where id = p_agent_id and active = true;
  if not found then
    return jsonb_build_object('error', 'agent_not_found');
  end if;
  if v_agent.agency_id is null then
    return jsonb_build_object('error', 'agent_without_agency');
  end if;

  -- ‏for update מסדר שתי בקשות מקבילות בטור, כך שהספירה המוחזרת לא תשקר
  select * into v_prop from public.properties where id = p_property_id for update;
  if not found then
    return jsonb_build_object('error', 'property_not_found');
  end if;
  if v_prop.agent_id <> v_agent.id then
    return jsonb_build_object('error', 'not_your_property');
  end if;
  if v_prop.status <> 'active' then
    return jsonb_build_object('error', 'property_not_active');
  end if;

  select name into v_agency_name from public.agencies where id = v_agent.agency_id;

  -- ביטול הפצות למשרדים שהוסרו מרשימת השת"פ מאז ההפצה הקודמת
  -- (וגם למשרד של הסוכן/ת עצמו/ה, אם השתנה שיוך המשרד מאז)
  delete from public.property_shares ps
   where ps.property_id = p_property_id
     and (ps.shared_with_agency_id = v_agent.agency_id
          or exists (select 1 from public.agent_share_exclusions ex
                      where ex.agent_id = v_agent.id
                        and ex.agency_id = ps.shared_with_agency_id));
  get diagnostics v_revoked = row_count;

  -- ההפצה עצמה + ההתראות, בהצהרה אחת. ה-CTE של ההתראות נשען על ה-returning
  -- של ההוספה, ולכן מי שכבר קיבל את הנכס בעבר (on conflict do nothing) לא
  -- מקבל התראה שנייה על אותו נכס.
  with targets as (
    select a.id
      from public.agencies a
     where a.id is distinct from v_agent.agency_id
       and not exists (select 1 from public.agent_share_exclusions ex
                        where ex.agent_id = v_agent.id and ex.agency_id = a.id)
  ),
  ins as (
    insert into public.property_shares
      (property_id, owner_agent_id, owner_agency_id, shared_with_agency_id)
    select p_property_id, v_agent.id, v_agent.agency_id, t.id from targets t
    on conflict (property_id, shared_with_agency_id) do nothing
    returning shared_with_agency_id
  ),
  notified as (
    insert into public.notifications (agent_id, type, title, body, related_property_id)
    select m.id,
           'system',
           'נכס חדש שותף איתך',
           coalesce(v_agency_name, 'משרד שותף') || ' שיתף/ה איתך נכס: ' || v_prop.title,
           p_property_id
      from ins
      join public.agency_members m
        on m.agency_id = ins.shared_with_agency_id
       and m.active = true
    returning 1
  )
  select count(*) into v_added from ins;

  select count(*) into v_total from public.property_shares where property_id = p_property_id;

  -- ‏0 משרדים = הוסרו כולם מרשימת השת"פ (או שאין עדיין משרד נוסף בפלטפורמה).
  -- במקרה כזה הדגל נשאר כבוי, כדי שלא תופיע תגית "משותף" על נכס שאיש לא קיבל.
  update public.properties
     set shared_with_partners = (v_total > 0),
         shared_at            = case when v_total > 0 then now() else null end,
         updated_at           = now()
   where id = p_property_id;

  return jsonb_build_object(
    'success',      true,
    'shared_count', v_total,
    'newly_shared', v_added,
    'revoked',      v_revoked,
    'title',        v_prop.title
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. ביקורת חדשה (גרסה: 20260906091000)
-- ---------------------------------------------------------------------------
create or replace function public.notify_on_new_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent_name text;
  v_reviewer   text;
  v_stars      text;
  v_excerpt    text;
  v_mgr        uuid;
begin
  select display_name into v_agent_name from agency_members where id = new.agent_id;

  v_reviewer := coalesce(nullif(btrim(new.reviewer_display_name), ''), 'לקוח/ה מאומת/ת');
  v_stars    := repeat('★', greatest(coalesce(new.rating, 0), 0))
             || repeat('☆', greatest(5 - coalesce(new.rating, 0), 0));

  -- הציטוט נחתך: הפעמון הוא כותרת, לא מסך קריאה. הביקורת המלאה יושבת
  -- בקטגוריית הביקורות ובדף הסוכן/ת.
  v_excerpt := nullif(btrim(coalesce(new.text, '')), '');
  if v_excerpt is not null and length(v_excerpt) > 90 then
    v_excerpt := left(v_excerpt, 88) || '…';
  end if;

  if new.agent_id is not null then
    insert into notifications (agent_id, type, title, body, related_lead_id, related_review_id)
    values (
      new.agent_id,
      'review_new',
      'התקבלה עליך ביקורת חדשה',
      v_stars || ' · ' || v_reviewer
        || case new.status when 'published' then ' · פורסמה' else ' · ממתינה לאישור המשרד' end
        || coalesce(' · "' || v_excerpt || '"', ''),
      new.linked_lead_id,
      new.id
    );
  end if;

  -- ביקורת שכבר נולדה מפורסמת או דחויה אינה משימה לאיש
  if new.status = 'pending' then
    for v_mgr in
      select id from agency_members
       where agency_id = new.agency_id
         and role = 'manager'
         and active = true
         and id is distinct from new.agent_id
    loop
      insert into notifications (agent_id, type, title, body, related_lead_id, related_review_id)
      values (
        v_mgr,
        'review_new',
        'ביקורת חדשה ממתינה לאישור',
        coalesce(v_agent_name, 'סוכן/ת') || ' · ' || v_stars || ' · ' || v_reviewer
          || coalesce(' · "' || v_excerpt || '"', ''),
        new.linked_lead_id,
        new.id
      );
    end loop;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. הסכם שנחתם מרחוק (גרסה: 20260930090000)
-- ---------------------------------------------------------------------------
create or replace function public.notify_agent_on_remote_signature()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agreement  record;
  v_total      int;
  v_signed     int;
  v_property   text;
  v_title      text;
  v_body       text;
begin
  -- רק המעבר מ"לא חתום" ל"חתום", ורק חתימה מרחוק
  if new.signed_at is null or old.signed_at is not null then
    return null;
  end if;
  if new.method is distinct from 'remote' then
    return null;
  end if;

  select id, agent_id, title, status, snapshot
    into v_agreement
    from agreements
   where id = new.agreement_id;

  if v_agreement.id is null or v_agreement.agent_id is null then
    return null;
  end if;
  -- הסכם שבוטל אחרי שהקישור יצא: החתימה כבר לא רלוונטית
  if v_agreement.status = 'cancelled' then
    return null;
  end if;

  select count(*), count(*) filter (where signed_at is not null)
    into v_total, v_signed
    from agreement_signers
   where agreement_id = new.agreement_id;

  v_property := nullif(btrim(coalesce(v_agreement.snapshot->>'property_line', '')), '');

  if v_total > 0 and v_signed = v_total then
    v_title := '✅ ההסכם נחתם - כל הצדדים חתמו';
  else
    v_title := '✍️ חתימה מרחוק התקבלה';
  end if;

  -- מי חתם/ה, על מה, ומה נשאר. בלי השלושה האלה ההתראה אינה אומרת דבר
  -- למי שיש לו/ה חמישה הסכמים פתוחים באותו שבוע.
  v_body := coalesce(nullif(btrim(new.full_name), ''), 'החותם/ת')
    || ' · ' || coalesce(v_agreement.title, 'הסכם')
    || coalesce(' · ' || v_property, '')
    || ' · ' || v_signed || '/' || v_total || ' חתמו'
    || case when v_total > 0 and v_signed = v_total
            then ' · העותק החתום נשלח לכל הצדדים'
            else '' end;

  insert into notifications (agent_id, type, title, body, related_agreement_id)
  values (v_agreement.agent_id, 'agreement_signed', v_title, v_body, v_agreement.id);

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. הדחיפה לוואטסאפ מחזירה את כל המזהים (גרסה: 20270320093000)
-- ---------------------------------------------------------------------------
create or replace function public.notification_push_claim(p_limit int default 20)
returns table (
  log_id       uuid,
  agent_id     uuid,
  display_name text,
  phone_e164   text,
  channel_mode text,
  items        jsonb,
  item_count   int
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  a         record;
  v_items   jsonb;
  v_ids     uuid[];
  v_types   text[];
  v_log     uuid;
  v_mode    text;
  v_taken   int := 0;
  v_cap     int := least(greatest(coalesce(p_limit, 20), 1), 200);
  v_look    int := coalesce((select value::int from public.pricing_config
                              where key = 'notif_push_lookback_hours'), 12);
begin
  -- רישום בלבד; החסימה כבר שוחררה על ידי הפרדיקט.
  perform public.notification_push_reconcile();

  for a in select * from public.notification_push_due_agents() loop
    exit when v_taken >= v_cap;

    -- המזהים נוסעים עם ההתראה: ‏notification-push בונה מהם את הקישור הישיר
    -- לפריט (itemPath), במקום קישור לקטגוריה.
    select jsonb_agg(jsonb_build_object(
             'type',        n.type,
             'title',       n.title,
             'body',        n.body,
             'property_id', n.related_property_id,
             'client_id',   coalesce(n.related_client_id,
                                     (select s.client_id from public.client_showcases s
                                       where s.id = n.related_showcase_id)),
             'lead_id',     n.related_lead_id,
             -- נכס של משרד אחר (שיתוף) נפתח ב"שותפו איתי", לא ב"הנכסים שלי"
             'property_mine', (select p.agent_id = n.agent_id or p.referred_by is not distinct from n.agent_id
                                 from public.properties p where p.id = n.related_property_id),
             'agenda_item_id', n.related_agenda_item_id,
             'agreement_id',  n.related_agreement_id,
             -- ביקורת ממתינה - למי שמאשר/ת אותה; מפורסמת - לדף הסוכן/ת. לסוכן/ת
             -- שהביקורת עליו/ה וממתינה אין מה לעשות איתה, ולכן אין לה יעד.
             'review_id', (select rv.id from public.reviews rv
                            where rv.id = n.related_review_id and rv.status = 'pending'
                              and rv.agent_id is distinct from n.agent_id),
             'review_agent_slug', (select m.slug from public.reviews rv
                                     join public.agency_members m on m.id = rv.agent_id
                                    where rv.id = n.related_review_id and rv.status = 'published')
           ) order by n.created_at desc),
           array_agg(n.id order by n.created_at desc),
           array_agg(distinct n.type)
      into v_items, v_ids, v_types
      from public.notifications n
     where n.agent_id = a.agent_id
       and not n.read
       and n.type = any(a.whatsapp_types)
       and n.created_at > now() - make_interval(hours => v_look)
       and not exists (
         select 1 from public.notification_push_log l
          where l.agent_id = n.agent_id
            and n.id = any(l.notification_ids)
            -- התראה שנכנסה לשורה שלא יצאה טרם נשלחה. בלי התנאי הזה היא
            -- הייתה נעלמת מכל הודעה עתידית, לנצח.
            and public.notification_push_log_holds(l.whatsapp_status, l.created_at));

    continue when v_items is null;

    v_mode := case when a.in_service_window then 'text' else 'template' end;

    insert into public.notification_push_log
      (agent_id, notification_ids, types, channel_mode, whatsapp_status)
    values (a.agent_id, v_ids, v_types, v_mode, 'pending')
    returning id into v_log;

    v_taken := v_taken + 1;

    return query select v_log, a.agent_id, a.display_name, a.phone_e164,
                        v_mode, v_items, jsonb_array_length(v_items);
  end loop;
end;
$$;
