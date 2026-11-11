-- ============================================================================
-- דוח שבועי לבעל הנכס - הסוכן/ת מפיק/ה ושולח/ת בעצמו/ה (/owner-report?k=)
--
-- ההחלטה (תומר, 11.11.2026): **המתווך/ת שולח/ת את הדוח, והמערכת אינה פונה
-- לבעלים בעצמה.** בעל נכס לא נתן לפלטפורמה הסכמה לקבל הודעות, והדוח יוצא
-- בשם המתווך/ת ובערוץ שלו/ה (וואטסאפ אישי, מייל). לכן אין כאן cron, אין
-- תבנית וואטסאפ ואין שליחה: רק הפקה של קישור.
--
-- ‏**הדוח נשמר כמו שהוא ברגע ההפקה** (תמונת מצב), כמו cma_links: מה שהבעלים
-- ראו הוא מה שנאמר להם, גם אם הם חוזרים לקישור כעבור שבועיים. הקישור הוא
-- ההרשאה - 32 תווים אקראיים, 30 יום - והדוח כולל **מספרים בלבד**: צפיות,
-- פניות והשוואה לשוק. בלי שם, טלפון או זהות של גולש/ת ובלי פרטי נכס אחר.
--
-- יצירה: ‏authenticated (הסוכן/ת של הנכס או מנהל/ת המשרד - נבדק בפונקציה).
-- פתיחה: ‏service_role בלבד, דרך Edge Function ‏owner-report-link.
-- ============================================================================

create table if not exists public.owner_report_links (
  id          text        primary key default encode(extensions.gen_random_bytes(16), 'hex'),
  agent_id    uuid        not null references public.agency_members(id) on delete cascade,
  property_id uuid        not null references public.properties(id) on delete cascade,
  report      jsonb       not null,
  note        text,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '30 days',
  opened_at   timestamptz,
  open_count  integer     not null default 0,
  constraint owner_report_links_note_len check (note is null or char_length(note) <= 600)
);

create index if not exists owner_report_links_agent_idx
  on public.owner_report_links (agent_id, created_at desc);
create index if not exists owner_report_links_property_idx
  on public.owner_report_links (property_id, created_at desc);

comment on table public.owner_report_links is
  'דוח שבועי לבעל הנכס (/owner-report?k=). הסוכן/ת מפיק/ה ושולח/ת; הדוח נשמר כמו שהוא. docs/owner-report.md.';

alter table public.owner_report_links enable row level security;
revoke all on table public.owner_report_links from public, anon, authenticated;
grant select, insert, update, delete on table public.owner_report_links to service_role;

-- ---------------------------------------------------------------------------
-- בניית הדוח. ‏service_role בלבד - הפונקציה אינה בודקת הרשאה, ולכן רק
-- owner_report_create (שבודקת) קוראת לה.
--
-- חלון של 7 ימים **לפי תאריך בישראל** (היום ו-6 שלפניו), והשבוע שלפניו: אותם
-- ימים בגרף ובסכום, כך שבעלים שמחברים את העמודות מקבלים את המספר שבכותרת.
-- לא "שבוע קלנדרי": הסוכן/ת מפיק/ה בכל יום.
-- ‏"מבקרים" = visitor_session_id ייחודי (סוכן/ת שרענן/ה את הדף 20 פעם לא
-- מנפח אותם); ‏"צפיות" = שורות.
--
-- ההשוואה לשוק: כמה מהנכסים הפעילים באותה עיר ובאותו סוג עסקה קיבלו
-- **פחות** צפיות ב-7 הימים. ‏null מתחת ל-5 נכסים להשוואה - מדגם כזה אינו
-- אומר כלום. היא מוצגת תמיד כשיש מדגם, גם כשהיא אינה מחמיאה: דוח שמציג רק
-- את מה שנוח הוא דוח שבעלים מפסיקים לסמוך עליו.
-- ---------------------------------------------------------------------------
create or replace function public._owner_report_build(p_property uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_p        record;
  v_now      timestamptz := now();
  v_today    date := (now() at time zone 'Asia/Jerusalem')::date;
  v_w_start  timestamptz := ((now() at time zone 'Asia/Jerusalem')::date - 6)::timestamp at time zone 'Asia/Jerusalem';
  v_pw_start timestamptz := ((now() at time zone 'Asia/Jerusalem')::date - 13)::timestamp at time zone 'Asia/Jerusalem';
  v_views_w  integer;
  v_views_pw integer;
  v_views_t  integer;
  v_uniq_w   integer;
  v_leads_w  integer;
  v_leads_pw integer;
  v_leads_t  integer;
  v_daily    jsonb;
  v_sample   integer;
  v_below    integer;
  v_market   jsonb := null;
begin
  select id, title, city, deal_type, price, rooms, area_sqm, created_at, status
    into v_p
    from public.properties where id = p_property;
  if not found then return null; end if;

  select count(*) filter (where viewed_at >= v_w_start),
         count(*) filter (where viewed_at >= v_pw_start and viewed_at < v_w_start),
         count(*),
         count(distinct visitor_session_id) filter (where viewed_at >= v_w_start)
    into v_views_w, v_views_pw, v_views_t, v_uniq_w
    from public.property_views where property_id = p_property;

  select count(*) filter (where created_at >= v_w_start),
         count(*) filter (where created_at >= v_pw_start and created_at < v_w_start),
         count(*)
    into v_leads_w, v_leads_pw, v_leads_t
    from public.leads where property_id = p_property;

  select coalesce(jsonb_agg(jsonb_build_object('d', to_char(d.day, 'YYYY-MM-DD'), 'n', coalesce(c.n, 0))
                            order by d.day), '[]'::jsonb)
    into v_daily
    from generate_series(v_today - 6, v_today, interval '1 day') as d(day)
    left join (
      select (viewed_at at time zone 'Asia/Jerusalem')::date as day, count(*)::int as n
        from public.property_views
       where property_id = p_property and viewed_at >= v_w_start
       group by 1
    ) c on c.day = d.day::date;

  if v_p.city is not null and v_p.deal_type is not null then
    with pool as (
      select pr.id, count(v.id) as n
        from public.properties pr
        left join public.property_views v
               on v.property_id = pr.id and v.viewed_at >= v_w_start
       where pr.status = 'active' and pr.city = v_p.city and pr.deal_type = v_p.deal_type
         and pr.id <> p_property
       group by pr.id
    )
    select count(*), count(*) filter (where n < v_views_w) into v_sample, v_below from pool;
    if v_sample >= 5 then
      v_market := jsonb_build_object(
        'sample', v_sample,
        'beat_pct', round(100.0 * v_below / v_sample)::int);
    end if;
  end if;

  return jsonb_build_object(
    'generated_at', v_now,
    'property', jsonb_build_object(
      'title', v_p.title, 'city', v_p.city, 'deal_type', v_p.deal_type,
      'price', v_p.price, 'rooms', v_p.rooms, 'area_sqm', v_p.area_sqm,
      'days_listed', greatest(0, (v_today - (v_p.created_at at time zone 'Asia/Jerusalem')::date)),
      'status', v_p.status),
    'views', jsonb_build_object(
      'week', v_views_w, 'prev_week', v_views_pw, 'total', v_views_t,
      'unique_week', v_uniq_w, 'daily', v_daily),
    'inquiries', jsonb_build_object(
      'week', v_leads_w, 'prev_week', v_leads_pw, 'total', v_leads_t),
    'market', v_market);
end;
$$;

revoke all on function public._owner_report_build(uuid) from public, anon, authenticated;
grant execute on function public._owner_report_build(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- יצירה - הסוכן/ת מה-CRM (JWT). מחזירה {id, expires_at} או {error}.
-- ההרשאה: הסוכן/ת של הנכס, או מנהל/ת המשרד שהנכס שלו - אותו כלל כמו
-- ה-policy של properties. תקרה של 40 דוחות ביום לסוכן/ת.
-- ---------------------------------------------------------------------------
create or replace function public.owner_report_create(p_property uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_agent  uuid := public.current_agent_id();
  v_prop   record;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_report jsonb;
  v_id     text;
  v_exp    timestamptz;
begin
  if v_agent is null then return jsonb_build_object('error', 'not_agent'); end if;
  if p_property is null then return jsonb_build_object('error', 'no_property'); end if;

  select id, agent_id, agency_id into v_prop from public.properties where id = p_property;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if not (v_prop.agent_id = v_agent
          or (v_prop.agency_id is not null
              and v_prop.agency_id = public.current_agency_id()
              and public.current_member_role() = 'manager')) then
    return jsonb_build_object('error', 'forbidden');
  end if;

  if v_note is not null and char_length(v_note) > 600 then
    return jsonb_build_object('error', 'note_too_long');
  end if;
  if (select count(*) from public.owner_report_links
       where agent_id = v_agent and created_at > now() - interval '1 day') >= 40 then
    return jsonb_build_object('error', 'daily_limit');
  end if;

  v_report := public._owner_report_build(p_property);
  if v_report is null then return jsonb_build_object('error', 'not_found'); end if;

  insert into public.owner_report_links (agent_id, property_id, report, note)
  values (v_agent, p_property, v_report, v_note)
  returning id, expires_at into v_id, v_exp;

  return jsonb_build_object('id', v_id, 'expires_at', v_exp);
end;
$$;

revoke all on function public.owner_report_create(uuid, text) from public, anon, authenticated;
grant execute on function public.owner_report_create(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- פתיחה - הדף, דרך owner-report-link. ‏null = אין קישור כזה, או שפג.
-- ---------------------------------------------------------------------------
create or replace function public.owner_report_open(p_id text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_row public.owner_report_links%rowtype;
begin
  update public.owner_report_links
     set opened_at = coalesce(opened_at, now()), open_count = open_count + 1
   where id = p_id and expires_at > now()
   returning * into v_row;
  if not found then return null; end if;
  return jsonb_build_object(
    'agent_id', v_row.agent_id, 'report', v_row.report, 'note', v_row.note,
    'created_at', v_row.created_at, 'expires_at', v_row.expires_at);
end;
$$;

revoke all on function public.owner_report_open(text) from public, anon, authenticated;
grant execute on function public.owner_report_open(text) to service_role;
