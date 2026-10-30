-- ============================================================================
-- יריד הבתים הפתוחים: רישום שרת של כל פנייה על נכס ביריד
--
-- ההבטחה: מי שפנה דרך האתר או האפליקציה לפני סוף חלון היריד לא משלם/ת
-- עמלת תיווך, גם אם ההסכם נחתם אחר כך. במחלוקת ("הפנייה הגיעה אחרי היריד")
-- צריך להכריע מנתונים, ועד היום לא היו כאלה: וואטסאפ וחיוג השאירו רק אירוע
-- אנונימי ב-GTM, והטופס שמר ליד בלי לדעת שהנכס היה ביריד ובלי החלון כפי
-- שהיה ברגע הפנייה (החלון ניתן לעריכה אחר כך).
--
-- שלושה חלקים:
--   1. ‏fair_inquiries - רשומת הוכחה. הזמן הוא זמן השרת, ‏in_window מחושב
--      בשרת מהנכס, והחלון נשמר כצילום. אין update ואין delete לאף אחד.
--   2. ‏log_fair_inquiry() - נקודת הרישום לדפדפן (וואטסאפ וחיוג).
--      ‏fair_inquiry_record() - הליבה, גם לטופס (‏property-inquiry-intake).
--   3. ‏leads.is_fair / leads.fair_in_window - הליד מהטופס זוכר בעצמו.
--
-- **הרישום אינו שולח שום התראה** - לא וואטסאפ, לא מייל ולא push. אין כאן
-- טריגר על notifications, ואסור להוסיף אחד בלי אישור.
--
-- התיעוד: docs/open-house-fair.md, "רישום הפניות ביריד".
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. הטבלה
--
-- ‏property_id ו-lead_id הם ‏on delete set null ולא cascade: מחיקת נכס או
-- ליד (‏data_retention_run) אינה מוחקת את ההוכחה. הטריגר שבסעיף 2 מתיר
-- בדיוק את העדכון הזה ולא שום עדכון אחר.
-- ---------------------------------------------------------------------------
create table if not exists public.fair_inquiries (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid references public.properties(id) on delete set null,
  channel       text not null check (channel in ('form', 'whatsapp', 'call')),
  source        text not null check (source in ('property_page', 'swipe', 'open_house_page', 'app')),
  created_at    timestamptz not null default now(),
  in_window     boolean not null,
  window_start  timestamptz,
  window_end    timestamptz,
  lead_id       uuid references public.leads(id) on delete set null,
  user_id       uuid references auth.users(id) on delete set null,
  visitor_id    text,
  user_agent    text,
  ip_hash       text
);

comment on table public.fair_inquiries is
  'רשומת הוכחה לפנייה על נכס ביריד הבתים הפתוחים. נכתבת רק דרך fair_inquiry_record(); אין update ואין delete.';
comment on column public.fair_inquiries.created_at is 'זמן השרת ברגע הרישום. הדפדפן אינו שולח זמן.';
comment on column public.fair_inquiries.in_window is
  'הנכס היה ביריד ברגע הרישום: open_house דלוק ו-open_house_start <= created_at < open_house_end. מחושב בשרת.';
comment on column public.fair_inquiries.window_start is 'צילום של open_house_start ברגע הפנייה (החלון ניתן לעריכה אחר כך).';
comment on column public.fair_inquiries.window_end is 'צילום של open_house_end ברגע הפנייה.';
comment on column public.fair_inquiries.lead_id is 'הליד שנוצר מהטופס (channel = form). בוואטסאפ ובחיוג אין ליד.';
comment on column public.fair_inquiries.visitor_id is 'מזהה אנונימי מה-localStorage של הדפדפן (sk_vid).';
comment on column public.fair_inquiries.ip_hash is
  'sha256 של כתובת ה-IP עם מלח סודי (fair_inquiry_salt), להגבלת קצב בלבד. הכתובת עצמה אינה נשמרת.';

create index if not exists fair_inquiries_property_created_idx
  on public.fair_inquiries (property_id, created_at);
create index if not exists fair_inquiries_visitor_property_idx
  on public.fair_inquiries (visitor_id, property_id);
create index if not exists fair_inquiries_lead_idx
  on public.fair_inquiries (lead_id) where lead_id is not null;
create index if not exists fair_inquiries_ip_created_idx
  on public.fair_inquiries (ip_hash, created_at) where ip_hash is not null;

alter table public.fair_inquiries enable row level security;

-- ‏anon: כלום. ‏authenticated: קריאה בלבד, ו-RLS מצמצם לאדמין ולסוכן/ת
-- המטפל/ת. ‏service_role: קריאה והוספה - גם הוא אינו מעדכן ואינו מוחק.
revoke all on table public.fair_inquiries from public, anon, authenticated, service_role;
grant select on table public.fair_inquiries to authenticated;
grant select, insert on table public.fair_inquiries to service_role;

drop policy if exists fair_inquiries_read on public.fair_inquiries;
create policy fair_inquiries_read on public.fair_inquiries
  for select to authenticated
  using (
    public.current_is_platform_admin()
    or exists (
      select 1 from public.properties p
       where p.id = fair_inquiries.property_id
         and p.agent_id = public.current_agent_id()
    )
  );

-- ---------------------------------------------------------------------------
-- 2. אין עריכה ואין מחיקה - גם לא מ-service_role ולא מפונקציה
--
-- ההרשאות למעלה סוגרות את הדלת לתפקידי ה-API; הטריגר סוגר אותה גם למי
-- שעוקף הרשאות (‏postgres, פונקציית SECURITY DEFINER עתידית). החריג היחיד:
-- ‏property_id / lead_id / user_id שהופכים ל-null בגלל מחיקת השורה שהם
-- מפנים אליה (‏on delete set null), כשכל שאר העמודות לא זזו.
-- ---------------------------------------------------------------------------
create or replace function public.fair_inquiries_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'fair_inquiries היא רשומת הוכחה - אין מחיקה' using errcode = '42501';
  end if;
  if (new.id, new.channel, new.source, new.created_at, new.in_window, new.window_start,
      new.window_end, new.visitor_id, new.user_agent, new.ip_hash)
     is distinct from
     (old.id, old.channel, old.source, old.created_at, old.in_window, old.window_start,
      old.window_end, old.visitor_id, old.user_agent, old.ip_hash)
     or (new.property_id is distinct from old.property_id and new.property_id is not null)
     or (new.lead_id is distinct from old.lead_id and new.lead_id is not null)
     or (new.user_id is distinct from old.user_id and new.user_id is not null) then
    raise exception 'fair_inquiries היא רשומת הוכחה - אין עריכה' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.fair_inquiries_immutable() from public, anon, authenticated;

drop trigger if exists fair_inquiries_immutable on public.fair_inquiries;
create trigger fair_inquiries_immutable
  before update or delete on public.fair_inquiries
  for each row execute function public.fair_inquiries_immutable();

-- ---------------------------------------------------------------------------
-- 3. המלח של ה-hash
--
-- ‏sha256 של IPv4 בלי מלח הפיך בחיפוש של ארבעה מיליארד ערכים. המלח נוצר
-- פעם אחת, ואיש מתפקידי ה-API אינו קורא אותו.
-- ---------------------------------------------------------------------------
create table if not exists public.fair_inquiry_salt (
  id   int primary key default 1 check (id = 1),
  salt text not null default encode(extensions.gen_random_bytes(32), 'hex')
);
alter table public.fair_inquiry_salt enable row level security;
revoke all on table public.fair_inquiry_salt from public, anon, authenticated, service_role;
insert into public.fair_inquiry_salt (id) values (1) on conflict (id) do nothing;

comment on table public.fair_inquiry_salt is
  'מלח סודי ל-fair_inquiries.ip_hash. נקרא רק בתוך fair_inquiry_record().';

-- ---------------------------------------------------------------------------
-- 4. הליבה: fair_inquiry_record()
--
-- נקראת משני מקומות: log_fair_inquiry() (הדפדפן, וואטסאפ וחיוג) ו-
-- ‏property-inquiry-intake (‏service_role, הטופס, עם lead_id).
--
-- מה נרשם: נכס שיש לו חלון יריד, עד 30 יום אחרי סוף החלון - גם כשהחלון
-- כבר נסגר (‏in_window = false), כדי שהתמונה תהיה מלאה. נכס שמעולם לא היה
-- ביריד, או שהיריד שלו נגמר לפני יותר מ-30 יום, אינו נרשם (‏not_fair):
-- אחרת כל אנונימי/ת היה/הייתה יכול/ה למלא את הטבלה על כל נכס באתר.
--
-- כפילות: אותו מבקר/ת (או אותו ip_hash כשאין מזהה), אותו נכס ואותו ערוץ
-- בתוך 10 דקות - השורה הראשונה נשארת והיא ההוכחה; מוחזר המזהה שלה. נעילה
-- מייעצת על המפתח, כדי ששתי לחיצות באותו רגע לא ייצרו שתי שורות.
--
-- הגבלת קצב: 20 שורות בשעה לכל מבקר/ת, ו-60 בשעה לכל ip_hash.
--
-- ‏p_lead_id: הליד מסומן is_fair = true ו-fair_in_window מאותו חישוב.
-- ---------------------------------------------------------------------------
create or replace function public.fair_inquiry_record(
  p_property_id uuid,
  p_channel     text,
  p_source      text,
  p_visitor_id  text,
  p_lead_id     uuid default null,
  p_user_id     uuid default null,
  p_user_agent  text default null,
  p_ip          text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now      timestamptz := now();
  v_prop     record;
  v_in       boolean;
  v_vid      text := nullif(left(btrim(coalesce(p_visitor_id, '')), 64), '');
  v_ip_hash  text;
  v_key      text;
  v_existing uuid;
  v_id       uuid;
begin
  if p_channel is null or p_channel not in ('form', 'whatsapp', 'call') then
    return jsonb_build_object('ok', false, 'reason', 'bad_channel');
  end if;
  if p_source is null or p_source not in ('property_page', 'swipe', 'open_house_page', 'app') then
    return jsonb_build_object('ok', false, 'reason', 'bad_source');
  end if;
  if v_vid is not null and v_vid !~ '^[A-Za-z0-9_-]{8,64}$' then
    v_vid := null;
  end if;

  select p.id, p.open_house, p.open_house_start, p.open_house_end
    into v_prop
    from public.properties p
   where p.id = p_property_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'property_not_found');
  end if;
  if v_prop.open_house_start is null or v_prop.open_house_end is null
     or v_now >= v_prop.open_house_end + interval '30 days' then
    return jsonb_build_object('ok', false, 'reason', 'not_fair');
  end if;

  -- אותו חלון של OpenHouse.live ושל expire_open_house(): הסוף אינו בתוך החלון
  v_in := coalesce(v_prop.open_house, false)
          and v_prop.open_house_start <= v_now
          and v_now < v_prop.open_house_end;

  if nullif(btrim(coalesce(p_ip, '')), '') is not null then
    select encode(extensions.digest(btrim(p_ip) || s.salt, 'sha256'), 'hex')
      into v_ip_hash
      from public.fair_inquiry_salt s where s.id = 1;
  end if;

  v_key := coalesce('v:' || v_vid, 'i:' || v_ip_hash);
  if v_key is not null then
    perform pg_advisory_xact_lock(hashtextextended('fair_inquiry:' || v_key || ':' || p_property_id || ':' || p_channel, 0));

    select f.id into v_existing
      from public.fair_inquiries f
     where f.property_id = p_property_id
       and f.channel = p_channel
       and f.created_at > v_now - interval '10 minutes'
       and (case when v_vid is not null then f.visitor_id = v_vid else f.ip_hash = v_ip_hash end)
     order by f.created_at
     limit 1;

    if v_existing is null then
      if v_vid is not null and (select count(*) from public.fair_inquiries f
                                 where f.visitor_id = v_vid
                                   and f.created_at > v_now - interval '1 hour') >= 20 then
        return jsonb_build_object('ok', false, 'reason', 'rate_limited');
      end if;
      if v_ip_hash is not null and (select count(*) from public.fair_inquiries f
                                     where f.ip_hash = v_ip_hash
                                       and f.created_at > v_now - interval '1 hour') >= 60 then
        return jsonb_build_object('ok', false, 'reason', 'rate_limited');
      end if;
    end if;
  end if;

  if v_existing is not null then
    v_id := v_existing;
    -- השורה הראשונה היא ההוכחה; החישוב שלה הוא מה שהליד מקבל
    select f.in_window into v_in from public.fair_inquiries f where f.id = v_id;
  else
    insert into public.fair_inquiries
      (property_id, channel, source, created_at, in_window, window_start, window_end,
       lead_id, user_id, visitor_id, user_agent, ip_hash)
    values
      (p_property_id, p_channel, p_source, v_now, v_in, v_prop.open_house_start, v_prop.open_house_end,
       p_lead_id, p_user_id, v_vid, left(p_user_agent, 400), v_ip_hash)
    returning id into v_id;
  end if;

  if p_lead_id is not null then
    update public.leads
       set is_fair = true, fair_in_window = v_in
     where id = p_lead_id and property_id = p_property_id;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id, 'in_window', v_in, 'duplicate', v_existing is not null);
end;
$$;

comment on function public.fair_inquiry_record(uuid, text, text, text, uuid, uuid, text, text) is
  'הליבה של רישום פנייה ביריד: in_window מחושב כאן, צילום החלון, כפילות של 10 דקות והגבלת קצב. אינה שולחת התראה.';

revoke all on function public.fair_inquiry_record(uuid, text, text, text, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.fair_inquiry_record(uuid, text, text, text, uuid, uuid, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. נקודת הרישום לדפדפן: log_fair_inquiry()
--
-- וואטסאפ וחיוג בלבד - טופס נרשם בשרת, בתוך property-inquiry-intake, יחד
-- עם הליד. ‏user_agent וה-IP נלקחים מכותרות הבקשה של PostgREST ולא
-- מפרמטרים, ו-user_id מה-JWT (‏auth.uid(), ריק לאנונימי/ת).
-- ---------------------------------------------------------------------------
create or replace function public.log_fair_inquiry(
  p_property_id uuid,
  p_channel     text,
  p_source      text,
  p_visitor_id  text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_headers jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  v_ip      text;
begin
  if p_channel is null or p_channel not in ('whatsapp', 'call') then
    return jsonb_build_object('ok', false, 'reason', 'bad_channel');
  end if;
  v_ip := coalesce(
    nullif(btrim(split_part(v_headers ->> 'x-forwarded-for', ',', 1)), ''),
    nullif(btrim(v_headers ->> 'cf-connecting-ip'), ''),
    nullif(btrim(v_headers ->> 'x-real-ip'), ''));
  return public.fair_inquiry_record(
    p_property_id, p_channel, p_source, p_visitor_id,
    null, auth.uid(), v_headers ->> 'user-agent', v_ip);
end;
$$;

comment on function public.log_fair_inquiry(uuid, text, text, text) is
  'רישום לחיצה על וואטסאפ או חיוג בנכס ביריד, מהדפדפן. הזמן וה-in_window נקבעים בשרת. אינה שולחת התראה.';

revoke all on function public.log_fair_inquiry(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.log_fair_inquiry(uuid, text, text, text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. הליד זוכר בעצמו
--
-- ‏is_fair / fair_in_window נכתבים רק מ-fair_inquiry_record(). סוכן/ת
-- (‏authenticated, ה-policies "agent insert/update own leads") אינו/ה יכול/ה
-- לסמן ליד כזכאי או להוריד את הסימון: הטריגר מאפס ב-insert ושומר את הישן
-- ב-update, כל עוד current_user הוא תפקיד API של הדפדפן. אותו דפוס של
-- guard_ownership_columns() (‏20270323090000).
-- ---------------------------------------------------------------------------
alter table public.leads
  add column if not exists is_fair        boolean not null default false,
  add column if not exists fair_in_window boolean;

comment on column public.leads.is_fair is
  'הפנייה (טופס) הגיעה על נכס ביריד הבתים הפתוחים ונרשמה ב-fair_inquiries. נכתב רק מ-fair_inquiry_record().';
comment on column public.leads.fair_in_window is
  'הפנייה הגיעה בתוך חלון היריד (זמן שרת). null כש-is_fair = false.';

create or replace function public.leads_fair_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.is_fair := false;
      new.fair_in_window := null;
    else
      new.is_fair := old.is_fair;
      new.fair_in_window := old.fair_in_window;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.leads_fair_guard() from public, anon, authenticated;

drop trigger if exists leads_fair_guard on public.leads;
create trigger leads_fair_guard
  before insert or update of is_fair, fair_in_window on public.leads
  for each row execute function public.leads_fair_guard();
