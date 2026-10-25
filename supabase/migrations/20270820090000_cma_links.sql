-- ============================================================================
-- קישור לדוח CMA מגבריאלה - כפתור "📊 דוח CMA" ודף /cma?k=
--
-- ## מה היה
--
-- גבריאלה מסרה תקציר של הדוח בטקסט, והדוח עצמו - הממותג, עם השעונים,
-- הטבלאות והאפשרות להדפיס ל-PDF - היה רק ב-CRM. סוכן/ת שביקש/ה דוח בוואטסאפ
-- לפני פגישה היה/הייתה צריך/ה להיכנס למחשב כדי להראות אותו לבעלים.
--
-- ## מה כאן
--
-- אותו מנגנון כמו דף הבדיקה התכנונית (‏planning_links, 20270803090000):
-- גבריאלה יוצרת קישור, והכפתור יוצא אחרי התשובה. **הקישור הוא ההרשאה** -
-- 32 תווים אקראיים, בלי חשבון.
--
-- ‏**הדוח נשמר כמו שהוא (snapshot)**, ולא מחושב מחדש בפתיחה:
--   · מה שגבריאלה אמרה בוואטסאפ הוא מה שמוצג בדף - אותם מספרים;
--   · דוח לכתובת אינו נשען על שום שורה במסד, ואין ממה לחשב אותו מחדש;
--   · ופתיחה מהטלפון של לקוח/ה אינה מריצה את הדוח (שנייה וחצי במסד).
-- המיתוג (לוגו, צבעים, פרטי הסוכן/ת) **כן** נקרא בפתיחה, כמו ב-CRM
-- (‏loadCmaBrand): מנהל/ת שהחליף/ה לוגו מצפה/ה לראות אותו.
--
-- ‏30 יום ולא 7 כמו התכנוני: את הדוח הזה שולחים לבעלים, והם חוזרים אליו
-- כשמחליטים על מחיר. תקרה של 40 קישורים ביום לסוכן/ת, וגודל של עד 400KB.
-- ============================================================================

create table if not exists public.cma_links (
  id          text        primary key default encode(extensions.gen_random_bytes(16), 'hex'),
  agent_id    uuid        not null references public.agency_members(id) on delete cascade,
  -- הנכס, כשהדוח על נכס במערכת; null בדוח לכתובת
  property_id uuid        references public.properties(id) on delete set null,
  report      jsonb       not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '30 days',
  opened_at   timestamptz,
  open_count  integer     not null default 0
);

create index if not exists cma_links_agent_idx on public.cma_links (agent_id, created_at desc);

comment on table public.cma_links is
  'קישורים לדוח CMA (/cma?k=). גבריאלה יוצרת (cma_link_create), cma-link פותחת. הדוח נשמר כמו שהוא. docs/cma.md.';

alter table public.cma_links enable row level security;
revoke all on table public.cma_links from public, anon, authenticated;
grant select, insert, update, delete on table public.cma_links to service_role;

-- ---------------------------------------------------------------------------
-- יצירה - גבריאלה. ‏null = תקרה יומית, דוח ריק או גדול מדי.
-- ---------------------------------------------------------------------------
create or replace function public.cma_link_create(
  p_agent uuid, p_report jsonb, p_property uuid default null)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_id text;
begin
  if p_agent is null or p_report is null or jsonb_typeof(p_report) <> 'object'
     or p_report ? 'error' or octet_length(p_report::text) > 400000 then
    return null;
  end if;
  if (select count(*) from public.cma_links
       where agent_id = p_agent and created_at > now() - interval '1 day') >= 40 then
    return null;
  end if;
  insert into public.cma_links (agent_id, property_id, report)
  values (p_agent, p_property, p_report)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.cma_link_create(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.cma_link_create(uuid, jsonb, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- פתיחה - הדף, דרך cma-link. ‏null = אין קישור כזה, או שפג.
-- ---------------------------------------------------------------------------
create or replace function public.cma_link_open(p_id text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v public.cma_links;
begin
  if coalesce(p_id, '') !~ '^[0-9a-f]{32}$' then return null; end if;
  update public.cma_links
     set opened_at = coalesce(opened_at, now()), open_count = open_count + 1
   where id = p_id and expires_at > now()
  returning * into v;
  if not found then return null; end if;
  return jsonb_build_object(
    'agent_id',   v.agent_id,
    'report',     v.report,
    'created_at', v.created_at,
    'expires_at', v.expires_at);
end;
$$;

revoke all on function public.cma_link_open(text) from public, anon, authenticated;
grant execute on function public.cma_link_open(text) to service_role;
