-- חיפוש של גבריאלה: שכונה ללקוח/ה, דירוג מהערות, ולוג חיפוש בלי תוצאות.
-- city_id_for_name כבר בפרודקשן. אין כאן מיפוי ערים נוסף.
-- client_property_match נשאר בלי search_path, כמו 20271027140000, כדי שהגוף יוטמע.
-- אין עדכון לשורות קיימות: שכונה ריקה ו-preferred_features ריק לא משנים ציון
-- ולא מוחקים התאמות. השוואת העיר הישנה נשארת, ו-city_id רק מוסיף.

alter table public.agent_clients
  add column if not exists neighborhood_id uuid;

comment on column public.agent_clients.neighborhood_id is
  'שכונה שהלקוח/ה מחפש/ת. ריק מתאים לכל שכונה. שכונה שלא שייכת לאף עיר של הלקוח/ה לא מסתירה התאמות, והסינון חל רק בעיר של השכונה. 20271029170000.';

alter table public.agent_clients
  add column if not exists preferred_features text[];

comment on column public.agent_clients.preferred_features is
  'מאפיינים מההערות, לדירוג בלבד. לא סינון קשיח. null וריק לא משנים ציון. 20271029170000.';

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'agent_clients_neighborhood_id_fkey'
  ) then
    alter table public.agent_clients
      add constraint agent_clients_neighborhood_id_fkey
      foreign key (neighborhood_id) references public.neighborhoods (id)
      on delete set null;
  end if;
end $$;

create index if not exists agent_clients_neighborhood_id_idx
  on public.agent_clients (neighborhood_id)
  where neighborhood_id is not null;

create table if not exists public.agent_search_misses (
  id bigint generated always as identity primary key,
  agent_id uuid not null references public.agency_members (id) on delete cascade,
  city text,
  area text,
  deal_type text,
  created_at timestamptz not null default now()
);

comment on table public.agent_search_misses is
  'חיפוש של סוכן/ת בלי תוצאות. רק עיר, אזור וסוג עסקה. רק service_role.';

alter table public.agent_search_misses enable row level security;

revoke all on table public.agent_search_misses from public, anon, authenticated;
grant select, insert, update, delete on table public.agent_search_misses to service_role;

create or replace function public.client_property_match(
  p_client         public.agent_clients,
  p_property       public.properties,
  p_waive_features text[]
)
returns table (score int, reasons text[], missing_features text[])
language sql
stable
as $$
  with feats as (
    -- מה שיש בנכס. ממ״ד מסחרי יושב ב-mamad_location ולא במערך
    select coalesce(p_property.features, '{}'::text[])
           || case when p_property.mamad_location = 'unit' then array['mamad'] else '{}'::text[] end
           -- מרפסת שמש היא מרפסת: 13 מודעות פעילות מסמנות רק sun_balcony (14.10.2026)
           || case when 'sun_balcony' = any(coalesce(p_property.features, '{}'::text[]))
                   then array['balcony'] else '{}'::text[] end
           as have
  ),
  miss as (
    -- מה שהלקוח/ה ביקש/ה ולא קיים בנכס
    select array(select unnest(p_client.required_features)
                 except
                 select unnest(feats.have)) as feats
      from feats
  ),
  -- city_id_for_name פעם אחת לנכס ופעם אחת לכל עיר של הלקוח/ה, לא בכל תנאי.
  prop_city as materialized (
    select public.city_id_for_name(p_property.city) as id
  ),
  client_cities as materialized (
    select c.name, public.city_id_for_name(c.name) as id
      from unnest(coalesce(p_client.cities, '{}'::text[])) c(name)
  ),
  hood as materialized (
    select hn.city, hn.city_id, public.city_id_for_name(hn.city) as city_name_id
      from public.neighborhoods hn
     where hn.id = p_client.neighborhood_id
  ),
  gate as (
    select (p_client.client_kind = 'seeker'
        and p_property.status    = 'active'
        -- נכס פרטי: רק הלקוחות של מי שמחזיק/ה בו
        and (p_property.share_level is distinct from 'private'
             or p_property.agent_id = p_client.agent_id)
        and p_property.deal_type = p_client.deal_type
        and p_property.category  = p_client.category
        and (cardinality(p_client.cities) = 0
             or exists (
               select 1 from client_cities c
                where c.name = p_property.city
                   or (p_property.city_id is not null and p_property.city_id = c.id)
                   or (c.id is not null and (select id from prop_city) is not null
                       and c.id = (select id from prop_city))
             ))
        and (cardinality(p_client.property_types) = 0 or p_property.property_type = any(p_client.property_types))
        -- שכונה: ריקה, חסרה, או שלא שייכת לאף עיר - לא מסתירה. שייכת - רק בעיר שלה.
        -- שכונה ריקה במודעה היא "לא ידוע" ועוברת, עם הורדת ציון למטה.
        and (
          p_client.neighborhood_id is null
          or not exists (select 1 from hood)
          or (
            cardinality(p_client.cities) > 0
            and not exists (
              select 1 from hood hn, client_cities c
               where c.name = hn.city
                  or (hn.city_id is not null and hn.city_id = c.id)
                  or (c.id is not null and hn.city_name_id is not null and c.id = hn.city_name_id)
            )
          )
          or exists (
            select 1 from hood hn
             where not (
               (p_property.city_id is not null and hn.city_id is not null
                and p_property.city_id = hn.city_id)
               or p_property.city = hn.city
               or ((select id from prop_city) is not null
                   and hn.city_name_id is not null
                   and (select id from prop_city) = hn.city_name_id)
             )
          )
          or p_property.neighborhood_id = p_client.neighborhood_id
          or p_property.neighborhood_id is null
        )
        and (p_client.max_price is null or coalesce(p_property.price_total, p_property.price) <= p_client.max_price * 1.10)
        and (p_client.min_price is null or coalesce(p_property.price_total, p_property.price) >= p_client.min_price * 0.85)
        and (p_client.min_rooms is null or p_property.rooms is null or p_property.rooms >= p_client.min_rooms)
        and (p_client.max_rooms is null or p_property.rooms is null or p_property.rooms <= p_client.max_rooms)
        and (p_client.max_size_sqm is null or p_property.size_sqm is null or p_property.size_sqm <= p_client.max_size_sqm)
        -- מאפייני חובה: כל מה שחסר חייב להיות ברשימת הוויתור של הקריאה
        and miss.feats <@ coalesce(p_waive_features, '{}'::text[])
           ) as passes
      from miss
  )
  select
    least(100, greatest(0, 100
      - case when p_client.max_price is not null and coalesce(p_property.price_total, p_property.price) > p_client.max_price then 15 else 0 end
      - case when p_client.min_price is not null and coalesce(p_property.price_total, p_property.price) < p_client.min_price then 5  else 0 end
      - case when p_client.min_size_sqm is not null
              and (p_property.size_sqm is null or p_property.size_sqm < p_client.min_size_sqm) then 10 else 0 end
      - case when p_client.max_size_sqm is not null and p_client.min_size_sqm is null
              and p_property.size_sqm is null then 10 else 0 end
      - case when p_client.max_floor is not null
              and p_property.floor is not null and p_property.floor > p_client.max_floor then 10 else 0 end
      - case when p_property.rooms is null and (p_client.min_rooms is not null or p_client.max_rooms is not null)
             then 5 else 0 end
      - case when p_client.neighborhood_id is not null
              and p_property.neighborhood_id is null
              and exists (
                select 1 from hood hn
                 where (p_property.city_id is not null and hn.city_id is not null
                        and p_property.city_id = hn.city_id)
                    or p_property.city = hn.city
                    or ((select id from prop_city) is not null
                        and hn.city_name_id is not null
                        and (select id from prop_city) = hn.city_name_id)
              )
             then 8 else 0 end
      - least(24, 8 * cardinality(miss.feats))
      + least(12, 4 * (
          select count(*)::int
            from unnest(coalesce(p_client.preferred_features, '{}'::text[])) pf
           where pf = any(feats.have)
        ))
    ))::int,
    array_remove(array[
      case when p_client.max_price is not null and coalesce(p_property.price_total, p_property.price) > p_client.max_price
           then 'מעל התקציב ב-' || round((coalesce(p_property.price_total, p_property.price) / p_client.max_price - 1) * 100) || '%' end,
      case when p_client.min_price is not null and coalesce(p_property.price_total, p_property.price) < p_client.min_price
           then 'מתחת לטווח המחירים שהוגדר' end,
      case when (p_client.min_size_sqm is not null or p_client.max_size_sqm is not null)
            and p_property.size_sqm is null
           then 'גודל הנכס לא מולא במודעה' end,
      case when p_client.min_size_sqm is not null and p_property.size_sqm is not null
            and p_property.size_sqm < p_client.min_size_sqm
           then 'קטן מהמבוקש ב-' || round(p_client.min_size_sqm - p_property.size_sqm) || ' מ״ר' end,
      case when p_client.max_floor is not null and p_property.floor is not null
            and p_property.floor > p_client.max_floor
           then 'קומה ' || p_property.floor || ' - גבוה מהמבוקש' end,
      case when p_property.rooms is null and (p_client.min_rooms is not null or p_client.max_rooms is not null)
           then 'מספר החדרים לא מולא במודעה' end,
      case when p_client.neighborhood_id is not null
            and p_property.neighborhood_id is null
            and exists (
              select 1 from hood hn
               where (p_property.city_id is not null and hn.city_id is not null
                      and p_property.city_id = hn.city_id)
                  or p_property.city = hn.city
                  or ((select id from prop_city) is not null
                      and hn.city_name_id is not null
                      and (select id from prop_city) = hn.city_name_id)
            )
           then 'שכונה לא מולאה במודעה' end
    ], null),
    miss.feats
  from gate, miss, feats
  where gate.passes;
$$;


alter function public.client_property_match(public.agent_clients, public.properties, text[])
  reset search_path;

revoke all on function public.client_property_match(public.agent_clients, public.properties, text[])
  from public, anon, authenticated;

comment on function public.client_property_match(public.agent_clients, public.properties, text[]) is
  'ציון ההתאמה בין לקוח/ה לנכס יחיד, עם הסיבות לכל פער. אפס שורות = נפילה בסינון קשיח. שכונה ריקה אצל הלקוח/ה מתאימה לכל נכס. שכונה ריקה במודעה באותה עיר עדיין מתאימה, עם הורדת ציון. שכונה מעיר אחרת לא חוסמת. preferred_features הוא דירוג, לא שער. עיר גם לפי city_id. stable כי הגוף קורא טבלאות. בלי search_path בכוונה, כמו 20271027140000.';


-- שכונה ומאפייני דירוג מריצים מחדש התאמות, בשתי הרשימות (הוספה וניקוי).
drop trigger if exists agent_clients_match_alerts_upd on public.agent_clients;
create trigger agent_clients_match_alerts_upd
  after update on public.agent_clients
  for each row
  when (new.status = 'active' and (
        old.status            is distinct from new.status
     or old.client_kind       is distinct from new.client_kind
     or old.deal_type         is distinct from new.deal_type
     or old.category          is distinct from new.category
     or old.cities            is distinct from new.cities
     or old.property_types    is distinct from new.property_types
     or old.min_price         is distinct from new.min_price
     or old.max_price         is distinct from new.max_price
     or old.min_rooms         is distinct from new.min_rooms
     or old.max_rooms         is distinct from new.max_rooms
     or old.min_size_sqm      is distinct from new.min_size_sqm
     or old.max_size_sqm      is distinct from new.max_size_sqm
     or old.max_floor         is distinct from new.max_floor
     or old.required_features is distinct from new.required_features
     or old.neighborhood_id   is distinct from new.neighborhood_id
     or old.preferred_features is distinct from new.preferred_features))
  execute function public.agent_clients_match_alerts();

drop trigger if exists agent_clients_prune_stale_alerts on public.agent_clients;
create trigger agent_clients_prune_stale_alerts
  after update on public.agent_clients
  for each row
  when (new.status = 'active' and (
        old.status            is distinct from new.status
     or old.client_kind       is distinct from new.client_kind
     or old.deal_type         is distinct from new.deal_type
     or old.category          is distinct from new.category
     or old.cities            is distinct from new.cities
     or old.property_types    is distinct from new.property_types
     or old.min_price         is distinct from new.min_price
     or old.max_price         is distinct from new.max_price
     or old.min_rooms         is distinct from new.min_rooms
     or old.max_rooms         is distinct from new.max_rooms
     or old.min_size_sqm      is distinct from new.min_size_sqm
     or old.max_size_sqm      is distinct from new.max_size_sqm
     or old.max_floor         is distinct from new.max_floor
     or old.required_features is distinct from new.required_features
     or old.neighborhood_id   is distinct from new.neighborhood_id
     or old.preferred_features is distinct from new.preferred_features))
  execute function public.agent_clients_prune_stale_alerts();

-- שכונת הנכס נכנסת עכשיו לשער. שתי הרשימות של צד הנכס נשארות זהות.
-- מילוי neighborhood_id על נכסים פעילים מפעיל את שני הטריגרים לכל שורה
-- ויוצר גל התאמות. עדכון כזה חייב select public.notification_push_suppress(true)
-- לפניו, או לרוץ במנות. check_notification_backfill.py חוסם בלי הסימון.
drop trigger if exists properties_client_match_alerts_upd on public.properties;
create trigger properties_client_match_alerts_upd
  after update on public.properties
  for each row
  when (new.status = 'active' and (
        old.status          is distinct from new.status
     or old.price           is distinct from new.price
     or old.rooms           is distinct from new.rooms
     or old.size_sqm        is distinct from new.size_sqm
     or old.floor           is distinct from new.floor
     or old.city            is distinct from new.city
     or old.property_type   is distinct from new.property_type
     or old.deal_type       is distinct from new.deal_type
     or old.category        is distinct from new.category
     or old.features        is distinct from new.features
     or old.neighborhood_id is distinct from new.neighborhood_id))
  execute function public.properties_client_match_alerts();

drop trigger if exists properties_prune_stale_alerts on public.properties;
create trigger properties_prune_stale_alerts
  after update on public.properties
  for each row
  when (new.status = 'active' and (
        old.status          is distinct from new.status
     or old.price           is distinct from new.price
     or old.rooms           is distinct from new.rooms
     or old.size_sqm        is distinct from new.size_sqm
     or old.floor           is distinct from new.floor
     or old.city            is distinct from new.city
     or old.property_type   is distinct from new.property_type
     or old.deal_type       is distinct from new.deal_type
     or old.category        is distinct from new.category
     or old.features        is distinct from new.features
     or old.neighborhood_id is distinct from new.neighborhood_id))
  execute function public.properties_prune_stale_alerts();

-- חיפושים בלי תוצאות. 90 יום, בלי טלפון, והמדיניות דולקת.
insert into public.data_retention_settings (policy, keep_for, enabled, description)
values ('search_misses', interval '90 days', true,
        'חיפושי סוכן/ת בלי תוצאות. בלי טלפון. נמחקים אחרי 90 יום.')
on conflict (policy) do update
  set enabled = true,
      keep_for = excluded.keep_for,
      description = excluded.description;

-- אותו גוף כמו 20271029165000: ענף whatsapp_pending_actions נשמר, וענף search_misses נוסף.
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
