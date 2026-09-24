-- ============================================================================
-- עסקאות: חלקות בעפולה בהשלמת המיקום, והתראה על חור בנתונים
--
-- ## 1. עפולה בהשלמת המיקום - רק עסקאות בלי כתובת
--
-- ‏466 עסקאות בעפולה נשארו בלי מיקום: אין להן כתובת, רק גוש/חלקה, ולכן
-- הצינור העירוני (שמחפש לפי כתובת) לא יגיע אליהן לעולם.
-- ‏govmap_deal_locations דילגה על עפולה כולה. עכשיו היא מחזירה בעפולה
-- **רק עסקאות בלי רחוב ומספר**: עסקה עם כתובת נשארת של השכבה העירונית,
-- כי "עפולה נשארת על השכבה העירונית" חל על נקודות כתובת. מרכז חלקה אינו
-- נקודת כתובת, והחלקה מגיעה מהקדסטר של מפ"י (docs/govmap.md).
--
-- ## 2. חור בנתוני העסקאות -> התראה למנהל/ת הפלטפורמה
--
-- כשחיפוש עסקאות (ב-CRM או בעוזר בוואטסאפ) חוזר ריק, הסיבה היא לפעמים
-- הנתונים ולא השאלה: עיר שלא נטענה, רחוב שאין בו עסקאות במאגר, או מאגר
-- שלא עודכן חודשים. את זה אפשר לתקן רק בייבוא ידני מ-GovMap, ולכן:
--
--   ‏report_deal_gap(עיר, רחוב) -> מחשבת **בעצמה** את הסיבה מהמסד (הדפדפן
--   אינו מקור אמין), רושמת ב-market_deal_gaps, ומתריעה למנהלי הפלטפורמה.
--
-- | סיבה | מתי |
-- | --- | --- |
-- | `no_deals_in_city` | אין אף עסקה בעיר |
-- | `stale` | יש, אבל האחרונה ישנה מ-120 יום - המאגר לא עודכן |
-- | `no_deals_on_street` | יש בעיר, אין ברחוב (גם לא בהתאמה חלקית) |
--
-- **התראה אחת לחור, לא אחת לחיפוש:** חור פתוח שנשאל שוב מעלה מונה בלבד,
-- והתראה חוזרת רק אחרי 7 ימים. עשרה חיפושים על אותו רחוב הם חור אחד.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. govmap_deal_locations: עפולה, חלקות בלבד
-- ---------------------------------------------------------------------------
create or replace function public.govmap_deal_locations(p_limit integer default 150)
returns table (
  city         text,
  street       text,
  house_number text,
  gush         text,
  helka        text,
  deals        integer
)
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin';
  end if;

  return query
  select o.city, o.street, o.house_number, o.gush, o.helka, count(*)::integer
    from public.market_deals_official o
   where (o.lat is null or o.lng is null)
     and nullif(btrim(coalesce(o.city, '')), '') is not null
     and (
       -- מחוץ לעפולה: כתובת או חלקה
       (btrim(o.city) <> 'עפולה'
        and ((nullif(btrim(coalesce(o.street, '')), '') is not null
              and nullif(btrim(coalesce(o.house_number, '')), '') is not null)
             or (o.gush ~ '^\d+$' and o.helka ~ '^\d+$')))
       -- בעפולה: רק עסקה בלי כתובת, עם חלקה. כתובת נשארת של השכבה העירונית.
       or (btrim(o.city) = 'עפולה'
           and (nullif(btrim(coalesce(o.street, '')), '') is null
                or nullif(btrim(coalesce(o.house_number, '')), '') is null)
           and o.gush ~ '^\d+$' and o.helka ~ '^\d+$')
     )
     and (o.geocode_attempted_at is null
          or o.geocode_attempted_at < now() - interval '7 days')
   group by o.city, o.street, o.house_number, o.gush, o.helka
   order by count(*) desc, o.city, o.street, o.house_number
   limit greatest(1, least(coalesce(p_limit, 150), 500));
end;
$$;

comment on function public.govmap_deal_locations(integer) is
  'מיקומים של עסקאות רשמיות בלי קואורדינטות: מחוץ לעפולה - כתובת או חלקה; בעפולה - חלקה בלבד, לעסקה בלי כתובת. מנהל/ת פלטפורמה בלבד. docs/govmap.md.';

revoke all on function public.govmap_deal_locations(integer) from public, anon, authenticated;
grant execute on function public.govmap_deal_locations(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. חורים בנתונים
-- ---------------------------------------------------------------------------
create table if not exists public.market_deal_gaps (
  id           uuid primary key default gen_random_uuid(),
  city         text not null,
  city_key     text not null,
  street       text,
  street_key   text not null default '',
  reason       text not null,
  hits         integer not null default 1,
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  notified_at  timestamptz,
  resolved_at  timestamptz
);

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.market_deal_gaps'::regclass
                    and conname  = 'market_deal_gaps_reason_chk') then
    alter table public.market_deal_gaps add constraint market_deal_gaps_reason_chk
      check (reason in ('no_deals_in_city', 'stale', 'no_deals_on_street'));
  end if;
end $$;

-- חור פתוח אחד לכל עיר+רחוב
create unique index if not exists market_deal_gaps_open_uq
  on public.market_deal_gaps (city_key, street_key) where resolved_at is null;

comment on table public.market_deal_gaps is
  'חורים בנתוני העסקאות הרשמיות שעלו מחיפוש ריק. נפתרים בייבוא ידני. מיגרציה 20270110090000.';

alter table public.market_deal_gaps enable row level security;
revoke all on table public.market_deal_gaps from public, anon, authenticated;

-- סוג ההתראה. הרשימה המלאה מ-20261126090000, ועוד אחד בסוף.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('new_lead','system','review_request','review_alert','client_match',
                  'review_new','deal_closed','lead_unrouted','marketing_copy',
                  'agreement_signed','platform_signup','platform_upgrade',
                  'onboarding_property','onboarding_client','onboarding_agreement',
                  'onboarding_lead','exclusivity_taken','deal_data_gap'));

create or replace function public.report_deal_gap(p_city text, p_street text default null)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_city     text := nullif(btrim(coalesce(p_city, '')), '');
  v_street   text := nullif(btrim(coalesce(p_street, '')), '');
  v_city_key text;
  v_st_key   text;
  v_in_city  integer;
  v_last     date;
  v_on_st    integer;
  v_reason   text;
  v_gap      public.market_deal_gaps;
  v_title    text;
  v_body     text;
  v_admin    uuid;
begin
  if v_city is null then return null; end if;
  v_city_key := public.property_text_key(v_city);
  v_st_key   := coalesce(public.property_text_key(v_street), '');

  select count(*), max(o.sold_at) into v_in_city, v_last
    from public.market_deals_official o
   where public.property_text_key(o.city) = v_city_key;

  if v_in_city = 0 then
    v_reason := 'no_deals_in_city';
  elsif v_last < current_date - 120 then
    v_reason := 'stale';
  elsif v_st_key <> '' then
    select count(*) into v_on_st
      from public.market_deals_official o
     where public.property_text_key(o.city) = v_city_key
       and length(coalesce(public.property_text_key(o.street), '')) >= 3
       and (public.property_text_key(o.street) = v_st_key
            or public.property_text_key(o.street) like '%' || v_st_key || '%'
            or v_st_key like '%' || public.property_text_key(o.street) || '%');
    if v_on_st = 0 then v_reason := 'no_deals_on_street'; end if;
  end if;

  -- אין חור בנתונים: החיפוש היה ריק מסיבה אחרת (חלון זמן, רדיוס, סוג נכס)
  if v_reason is null then return null; end if;

  -- חור ברמת עיר אינו תלוי ברחוב
  if v_reason in ('no_deals_in_city', 'stale') then
    v_street := null; v_st_key := '';
  end if;

  insert into public.market_deal_gaps (city, city_key, street, street_key, reason)
  values (v_city, v_city_key, v_street, v_st_key, v_reason)
  on conflict (city_key, street_key) where resolved_at is null
  do update set hits = public.market_deal_gaps.hits + 1,
                last_seen = now(),
                reason = excluded.reason
  returning * into v_gap;

  -- התראה: חור חדש, או תזכורת אחרי 7 ימים
  if v_gap.notified_at is null or v_gap.notified_at < now() - interval '7 days' then
    v_title := 'חסרות עסקאות: ' || v_city || coalesce(' - ' || v_street, '');
    v_body := case v_reason
      when 'no_deals_in_city' then 'אין במאגר אף עסקה ב' || v_city || '. סוכן/ת חיפש/ה ולא קיבל/ה תוצאה. ייבוא ידני מ-GovMap יפתור.'
      when 'stale' then 'העסקה האחרונה ב' || v_city || ' במאגר היא מ-' || to_char(v_last, 'DD/MM/YYYY') || '. כדאי לייבא עסקאות חדשות מ-GovMap.'
      else 'אין במאגר עסקאות ברחוב ' || v_street || ' ב' || v_city || ', גם לא בשם דומה. ייתכן שהרחוב רשום אחרת או שחסרות עסקאות.'
    end || ' (חיפושים: ' || v_gap.hits || ')';

    for v_admin in
      select m.id from public.agency_members m
       where m.is_platform_admin = true and m.active = true
    loop
      insert into public.notifications (agent_id, type, title, body)
      values (v_admin, 'deal_data_gap', v_title, v_body);
    end loop;

    update public.market_deal_gaps set notified_at = now() where id = v_gap.id;
  end if;

  return v_reason;
exception when others then
  -- דיווח אינו מפיל את החיפוש שביקש אותו
  raise warning 'report_deal_gap failed for %/%: %', p_city, p_street, sqlerrm;
  return null;
end;
$$;

comment on function public.report_deal_gap(text, text) is
  'נקרא כשחיפוש עסקאות חוזר ריק. מחשב מהמסד אם זה חור בנתונים (עיר ריקה, מאגר ישן, רחוב חסר), רושם ומתריע למנהלי הפלטפורמה. התראה אחת לחור ל-7 ימים.';

revoke all on function public.report_deal_gap(text, text) from public, anon, authenticated;
grant execute on function public.report_deal_gap(text, text) to authenticated, service_role;

-- הרשימה והסגירה, למסך הייבוא הידני
create or replace function public.deal_gaps_open()
returns table (id uuid, city text, street text, reason text, hits integer,
               first_seen timestamptz, last_seen timestamptz)
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin';
  end if;
  return query
  select g.id, g.city, g.street, g.reason, g.hits, g.first_seen, g.last_seen
    from public.market_deal_gaps g
   where g.resolved_at is null
   order by g.hits desc, g.last_seen desc;
end;
$$;

revoke all on function public.deal_gaps_open() from public, anon, authenticated;
grant execute on function public.deal_gaps_open() to authenticated;

create or replace function public.deal_gap_resolve(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin';
  end if;
  update public.market_deal_gaps set resolved_at = now()
   where id = p_id and resolved_at is null;
  return found;
end;
$$;

revoke all on function public.deal_gap_resolve(uuid) from public, anon, authenticated;
grant execute on function public.deal_gap_resolve(uuid) to authenticated;
