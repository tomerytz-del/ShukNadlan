-- סיכום השיתופים אמר "אביה · גג/פנטהאוז" ומחיר בשורה מתחת.
-- השם הפרטי נקרא כמקום. הוואטסאפ והפעמון אומרים מה הנכס ואיפה,
-- ומי שיתף בשורה נפרדת, בלי מגדר ("שותף ע"י").
--
-- share_digest_lines מקבל עיר, סוג עסקה (sale/rent), חדרים ושם שכונה.
-- העמודות nullable: שורה שכבר נבנתה בלי העמודות האלה נשארת, והנוסח מדלג על מה שחסר.
-- אין מילוי לאחור של התראות שכבר נכתבו. אין רחוב, אין מספר בית, אין טלפון,
-- ואין שם מלא: split_part על המילה הראשונה, כמו קודם.
--
-- share_digest_describe הוא המשפט. אותו סדר ב-share-digest.ts
-- (shareDigestFacts). שינוי באחד בלי השני מפצל את הוואטסאפ ואת הפעמון.
-- הבסיס של share_digest_build הוא הגוף שרץ בפרודקשן
-- (md5 cf07c51142e6ce4725f81aae09015c96, זהה ל-20271112121000).
-- חתימת lines_for_log ו-preview משתנה, ולכן drop ואז create.

alter table public.share_digest_lines
  add column if not exists city text,
  add column if not exists deal_type text,
  add column if not exists rooms numeric,
  add column if not exists neighborhood text;

comment on column public.share_digest_lines.city is
  'עיר הנכס בזמן בניית הסיכום. ריק בשורה שנבנתה לפני העמודה.';
comment on column public.share_digest_lines.deal_type is
  'deal_type של הנכס, בדרך כלל sale או rent. ריק כשאין, או בשורה ישנה.';
comment on column public.share_digest_lines.rooms is
  'מספר החדרים. ריק כשאין, או כשהערך אינו חיובי, או בשורה ישנה.';
comment on column public.share_digest_lines.neighborhood is
  'שם השכונה מ-neighborhoods. ריק כשאין neighborhood_id, או בשורה ישנה. לא sales_area ולא רחוב.';

comment on table public.share_digest_lines is
  'שורה לכל נכס בסיכום: שם פרטי, סוג, מחיר, עיר, סוג עסקה, חדרים ושם שכונה. בלי טלפון, בלי שם מלא ובלי רחוב.';

create or replace function public.share_digest_describe(
  p_type text,
  p_deal text,
  p_city text,
  p_neighborhood text,
  p_rooms numeric,
  p_price text
) returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select concat_ws(', ',
    nullif(concat_ws(' ',
      coalesce(nullif(btrim(p_type), ''), 'נכס'),
      case lower(btrim(coalesce(p_deal, '')))
        when 'rent' then 'להשכרה'
        when 'sale' then 'למכירה'
        else null
      end,
      case
        when nullif(btrim(coalesce(p_city, '')), '') is not null
         and nullif(btrim(coalesce(p_neighborhood, '')), '') is not null
         and btrim(p_neighborhood) is distinct from btrim(p_city)
          then 'ב' || btrim(p_city) || ' (' || btrim(p_neighborhood) || ')'
        when nullif(btrim(coalesce(p_city, '')), '') is not null
          then 'ב' || btrim(p_city)
        when nullif(btrim(coalesce(p_neighborhood, '')), '') is not null
          then 'ב' || btrim(p_neighborhood)
        else null
      end
    ), ''),
    case
      when p_rooms is null or p_rooms <= 0 then null
      when p_rooms = 1 then '1 חדר'
      when p_rooms = trunc(p_rooms)
        then trim(to_char(p_rooms, 'FM999990')) || ' חדרים'
      else trim(to_char(p_rooms, 'FM999990.0')) || ' חדרים'
    end,
    case
      when nullif(btrim(coalesce(p_price, '')), '') is null
        or btrim(p_price) = 'מחיר לא צוין' then null
      else btrim(p_price)
    end
  );
$$;

comment on function public.share_digest_describe(text, text, text, text, numeric, text) is
  'משפט הנכס בסיכום השיתופים: סוג, למכירה או להשכרה, עיר ושכונה, חדרים, מחיר. חלק חסר יורד. בלי שם ובלי רחוב.';

revoke all on function public.share_digest_describe(text, text, text, text, numeric, text) from public, anon, authenticated;
grant execute on function public.share_digest_describe(text, text, text, text, numeric, text) to service_role;

drop function if exists public.share_digest_lines_for_log(uuid);

create or replace function public.share_digest_lines_for_log(p_log_id uuid)
returns table (
  sharer_first_name text,
  property_type text,
  price_label text,
  property_id uuid,
  city text,
  deal_type text,
  rooms numeric,
  neighborhood text
)
language sql
stable
security definer
set search_path = ''
as $$
  select l.sharer_first_name, l.property_type, l.price_label, l.property_id,
         l.city, l.deal_type, l.rooms, l.neighborhood
    from public.notification_push_log g
    join public.share_digest_lines l on l.notification_id = any (g.notification_ids)
   where g.id = p_log_id
   order by l.sharer_first_name, l.property_type, l.property_id;
$$;

comment on function public.share_digest_lines_for_log(uuid) is
  'שורות הסיכום שנכללו ביומן השליחה. עיר, סוג עסקה, חדרים ושכונה ריקים בשורה ישנה, והנוסח מדלג עליהם.';

revoke all on function public.share_digest_lines_for_log(uuid) from public, anon, authenticated;
grant execute on function public.share_digest_lines_for_log(uuid) to service_role;

drop function if exists public.share_digest_preview();

create or replace function public.share_digest_preview()
returns table (
  agent_first_name text,
  sharer_first_name text,
  property_type text,
  price text,
  property_id uuid,
  city text,
  deal_type text,
  rooms numeric,
  neighborhood text,
  summary text
)
language sql
stable
security definer
set search_path = ''
as $$
  with cut as (
    select s.enabled_at as since
      from public.share_digest_state s
     where s.id = 1
       and s.enabled_at is not null
  )
  select split_part(btrim(coalesce(m.display_name, '')), ' ', 1),
         coalesce(nullif(split_part(btrim(coalesce(sh.display_name, '')), ' ', 1), ''), 'משרד'),
         coalesce(nullif(btrim(p.property_type), ''), 'נכס'),
         case
           when p.price is null or p.price <= 0 then 'מחיר לא צוין'
           else trim(to_char(p.price, 'FM999,999,999')) || ' ₪'
         end,
         p.id,
         nullif(btrim(coalesce(p.city, '')), ''),
         nullif(btrim(coalesce(p.deal_type, '')), ''),
         case when p.rooms is null or p.rooms <= 0 then null else p.rooms end,
         nullif(btrim(coalesce(nb.name, '')), ''),
         public.share_digest_describe(
           coalesce(nullif(btrim(p.property_type), ''), 'נכס'),
           nullif(btrim(coalesce(p.deal_type, '')), ''),
           nullif(btrim(coalesce(p.city, '')), ''),
           nullif(btrim(coalesce(nb.name, '')), ''),
           case when p.rooms is null or p.rooms <= 0 then null else p.rooms end,
           case
             when p.price is null or p.price <= 0 then 'מחיר לא צוין'
             else trim(to_char(p.price, 'FM999,999,999')) || ' ₪'
           end
         ) || E'\nשותף ע"י ' || coalesce(nullif(split_part(btrim(coalesce(sh.display_name, '')), ' ', 1), ''), 'משרד')
    from public.notifications n
    join public.agency_members m on m.id = n.agent_id
    join public.properties p on p.id = n.related_property_id
    left join public.neighborhoods nb on nb.id = p.neighborhood_id
    left join lateral (
      select ps.owner_agent_id
        from public.property_shares ps
        join public.agency_members recv on recv.id = n.agent_id
       where ps.property_id = p.id
         and ps.shared_with_agency_id = recv.agency_id
       limit 1
    ) share on true
    left join public.agency_members sh on sh.id = share.owner_agent_id
    cross join cut
   where n.type = 'system'
     and n.title = 'נכס חדש שותף איתך'
     and n.related_property_id is not null
     and n.created_at > cut.since
     and n.created_at > coalesce((select max(r.ran_at) from public.share_digest_runs r
                                   where r.agent_id = n.agent_id), cut.since)
     and not exists (
       select 1 from public.notification_push_log l
        where n.id = any (l.notification_ids))
     and not exists (
       select 1 from public.share_digest_lines sl
        where sl.source_notification_id = n.id);
$$;


comment on function public.share_digest_preview() is
  'תצוגה יבשה של הסיכום הבא. שם פרטי, סוג, מחיר, עיר, עסקה, חדרים, שכונה, והמשפט. לא כותבת.';

revoke all on function public.share_digest_preview() from public, anon, authenticated;
grant execute on function public.share_digest_preview() to service_role;

create or replace function public.share_digest_build()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_on       int;
  v_since    timestamptz;
  v_local    timestamp;
  v_today    date;
  v_now_min  int;
  v_hhmm     int;
  v_tgt      int;
  v_delta    int;
  v_sent     int := 0;
  v_nid      uuid;
  v_n        int;
  v_lines    int;
  v_slot     int;
  v_quiet    boolean;
  v_dow      int;
  v_hour     int;
  v_suppress boolean;
  v_rows     jsonb;
  v_body     text;
  v_path     text;
  v_prop     uuid;
  ag         record;
begin
  v_on := coalesce((select value from public.pricing_config
                     where key = 'share_digest_enabled'), 0);
  if v_on <> 1 then
    return 0;
  end if;

  select s.enabled_at into v_since
    from public.share_digest_state s
   where s.id = 1
     and s.enabled_at is not null;
  if v_since is null then
    return 0;
  end if;

  v_local := pg_catalog.now() at time zone 'Asia/Jerusalem';
  v_today := v_local::date;
  v_now_min := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;
  v_hhmm := coalesce((select value from public.pricing_config
                       where key = 'share_digest_hhmm'), 1230);
  if v_hhmm < 0 or v_hhmm > 2359 or (v_hhmm % 100) > 59 then
    v_hhmm := 1230;
  end if;
  v_tgt := (v_hhmm / 100) * 60 + (v_hhmm % 100);
  v_delta := (v_now_min - v_tgt + 1440) % 1440;
  -- 12:30 עד 13:00. דקה שפוספסת נתפסת בהמשך החלון, לא הולכת לאיבוד.
  if v_delta >= 30 then
    return 0;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('share_digest_build')::bigint);

  for ag in
    select m.id,
           m.tier,
           nullif(btrim(coalesce(m.phone_e164, '')), '') as phone,
           coalesce(
             (select c.last_message_at > pg_catalog.now() - interval '23 hours'
                from public.whatsapp_conversations c
               where c.agent_id = m.id),
             false) as in_window,
           coalesce(rp.quiet_from_hour, 21) as quiet_from,
           coalesce(rp.quiet_to_hour, 8) as quiet_to,
           coalesce(rp.quiet_days, '{5,6}'::smallint[]) as quiet_days
      from public.agency_members m
      left join public.agent_reminder_preferences rp on rp.agent_id = m.id
     where m.active
       and m.closed_at is null
       and exists (
         select 1
           from public.notifications n
          where n.agent_id = m.id
            and n.type = 'system'
            and n.title = 'נכס חדש שותף איתך'
            and n.related_property_id is not null
            and n.created_at > v_since
            and n.created_at > coalesce((select max(r.ran_at) from public.share_digest_runs r
                                          where r.agent_id = m.id), v_since)
            and not exists (
              select 1 from public.notification_push_log l
               where n.id = any (l.notification_ids))
            and not exists (
              select 1 from public.share_digest_lines sl
               where sl.source_notification_id = n.id)
       )
  loop
    -- שש משבצות של 5 דקות. אחרי שהמשבצת נפתחה, כל דקה בחלון עדיין תופסת.
    v_slot := mod(pg_catalog.hashtext(ag.id::text)::bigint, 6);
    if v_slot < 0 then
      v_slot := v_slot + 6;
    end if;
    if v_delta < v_slot * 5 then
      continue;
    end if;

    -- שישי עד 13:00 פתוח גם כש-quiet_days כולל 5. שבת סגורה.
    -- חלון 1 קבוע: הדגל הגלובלי של #1049 לא חוסם את הסיכום של 12:30.
    v_quiet := false;
    if to_regprocedure('public.notification_agent_send_quiet(integer,integer,smallint[],timestamp with time zone,integer)') is not null then
      execute 'select public.notification_agent_send_quiet($1, $2, $3, $4, 1)'
        into v_quiet
        using ag.quiet_from, ag.quiet_to, ag.quiet_days, pg_catalog.now();
    else
      v_dow := extract(dow from v_local)::int;
      v_hour := extract(hour from v_local)::int;
      if v_dow = 6 or (v_dow = 5 and v_hour >= 13) or v_hour < 8 or v_hour >= 21 then
        v_quiet := true;
      else
        v_quiet := public.agent_reminder_quiet_now(
          ag.quiet_from,
          ag.quiet_to,
          array_remove(coalesce(ag.quiet_days, '{5,6}'::smallint[]), 5::smallint));
      end if;
    end if;
    if v_quiet then
      continue;
    end if;

    if exists (
      select 1 from public.share_digest_runs r
       where r.agent_id = ag.id
         and (r.ran_at at time zone 'Asia/Jerusalem')::date = v_today
    ) then
      continue;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
             'source_id', n.id,
             'property_id', p.id,
             'sharer', coalesce(nullif(split_part(btrim(coalesce(sh.display_name, '')), ' ', 1), ''), 'משרד'),
             'ptype', coalesce(nullif(btrim(p.property_type), ''), 'נכס'),
             'price', case
               when p.price is null or p.price <= 0 then 'מחיר לא צוין'
               else trim(to_char(p.price, 'FM999,999,999')) || ' ₪'
             end,
             'city', nullif(btrim(coalesce(p.city, '')), ''),
             'deal', nullif(btrim(coalesce(p.deal_type, '')), ''),
             'rooms', case when p.rooms is null or p.rooms <= 0 then null else p.rooms end,
             'neighborhood', nullif(btrim(coalesce(nb.name, '')), '')
           )), '[]'::jsonb)
      into v_rows
      from public.notifications n
      join public.properties p on p.id = n.related_property_id
      left join public.neighborhoods nb on nb.id = p.neighborhood_id
      left join lateral (
      select ps.owner_agent_id
        from public.property_shares ps
        join public.agency_members recv on recv.id = n.agent_id
       where ps.property_id = p.id
         and ps.shared_with_agency_id = recv.agency_id
       limit 1
    ) share on true
    left join public.agency_members sh on sh.id = share.owner_agent_id
     where n.agent_id = ag.id
       and n.type = 'system'
       and n.title = 'נכס חדש שותף איתך'
       and n.related_property_id is not null
       and n.created_at > v_since
       and n.created_at > coalesce((select max(r.ran_at) from public.share_digest_runs r
                                     where r.agent_id = ag.id), v_since)
       and not exists (
         select 1 from public.notification_push_log l
          where n.id = any (l.notification_ids))
       and not exists (
         select 1 from public.share_digest_lines sl
          where sl.source_notification_id = n.id);

    v_n := coalesce(jsonb_array_length(v_rows), 0);
    if v_n = 0 then
      continue;
    end if;

    select case when count(*) = 1 then (array_agg(x.property_id))[1] else null end
      into v_prop
      from jsonb_to_recordset(v_rows) as x(
        source_id uuid, property_id uuid, sharer text, ptype text, price text,
        city text, deal text, rooms numeric, neighborhood text
      );
    v_path := case
      when v_n = 1 then '/crm?goto=accSharedWithMe&property=' || v_prop::text
      else '/crm?goto=accSharedWithMe'
    end;
    select left(coalesce(string_agg(
             public.share_digest_describe(
               x.ptype, x.deal, x.city, x.neighborhood, x.rooms, x.price
             ) || E'\nשותף ע"י ' || x.sharer,
             E'\n\n' order by x.sharer, x.ptype, x.property_id::text
           ), 'נכס חדש שותף איתך'), 2000)
      into v_body
      from jsonb_to_recordset(v_rows) as x(
        source_id uuid, property_id uuid, sharer text, ptype text, price text,
        city text, deal text, rooms numeric, neighborhood text
      );

    -- מסלול free ומי שמחוץ לחלון 24 השעות: פעמון בלבד. בלי תבנית.
    v_suppress := ag.tier is distinct from 'mid' and ag.tier is distinct from 'premium'
      or ag.phone is null
      or not ag.in_window;

    insert into public.notifications (
      agent_id, type, title, body, suppress_push, action_path, related_property_id
    )
    values (
      ag.id,
      'share_digest',
      case
        when v_n = 1 then 'נכס חדש שותף איתך'
        else v_n::text || ' נכסים חדשים שותפו איתך'
      end,
      v_body,
      v_suppress,
      v_path,
      v_prop
    )
    returning id into v_nid;

    insert into public.share_digest_lines (
      notification_id, source_notification_id, property_id,
      sharer_first_name, property_type, price_label,
      city, deal_type, rooms, neighborhood
    )
    select v_nid, x.source_id, x.property_id, x.sharer, x.ptype, x.price,
           x.city, x.deal, x.rooms, x.neighborhood
      from jsonb_to_recordset(v_rows) as x(
        source_id uuid, property_id uuid, sharer text, ptype text, price text,
        city text, deal text, rooms numeric, neighborhood text
      );
    get diagnostics v_lines = row_count;
    if coalesce(v_lines, 0) <> v_n then
      raise exception 'share_digest lines missing for %', ag.id;
    end if;

    insert into public.share_digest_runs (agent_id, ran_at, notification_id)
    values (ag.id, pg_catalog.now(), v_nid);
    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end;
$$;


comment on function public.share_digest_build() is
  'סיכום שיתופים אחד לסוכן/ת, בחלון של 30 דקות אחרי share_digest_hhmm (ברירת מחדל 12:30 ישראל), מפוזר לשש משבצות. דגל כבוי: 0. בחלון 24 השעות טקסט עם כפתור. מחוץ לו פעמון, בלי תבנית. שישי עד 13:00 יוצא, שבת שקטה. מסלול שאינו mid או premium נשאר בפעמון. כותרת וגוף אומרים סוג, עיר, חדרים, מחיר, ומי שיתף בשם פרטי.';

revoke all on function public.share_digest_build() from public, anon, authenticated;
grant execute on function public.share_digest_build() to service_role;
