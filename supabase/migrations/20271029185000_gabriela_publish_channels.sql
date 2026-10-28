-- יעד פרסום לכל נכס שגבריאלה קלטה. NULL = לא נשאלה שאלה (CRM, אתר, ייבוא):
-- הטריגר הקיים ממשיך להכניס לתור הרשתות כשהנכס נעשה active.
-- מערך מפורש הוא הבחירה מוואטסאפ, ואפשר לשנות אותה אחר כך מהכרטיס.
-- 'save' לבד = מאגר בלבד, והנכס נשאר unpublished (התזכורת השבועית).
--
-- רשתות: לא פרסום ישיר. queue_property_publication, עם ההשהיה והתקרה
-- היומית שכבר בתור. הדגל gabriela_social_publish_enabled נולד 0: הבחירה
-- נשמרת, והתור מחכה. לכל נכס לכל היותר שורה אחת לפייסבוק ואחת
-- לאינסטגרם (unique). בלי התראה ובלי רילס. החתימה בפוסט היא של
-- הסוכן/ת של הנכס, לא שם או רישיון של משרד אחר.
--
-- מתווכים: share_with_brokers הוא הרישום. ההפצה היא unpublished_collab_fanout
-- (PR התזכורת): עד תקרה של משרדים לנכס, פעמון, בלי טלפון, דגל כבוי.
--
-- מילוי publish_channels על נכסים קיימים אינו כאן. עדכון כזה בזמן שהדגל
-- דלוק היה מכניס גל לתור. check_notification_backfill.py חוסם אותו.

alter table public.properties
  add column if not exists publish_channels text[];

alter table public.properties
  add column if not exists share_with_brokers boolean not null default false;

comment on column public.properties.publish_channels is
  'יעד שגבריאלה שאלה. NULL = לא נשאל (התור האוטומטי נשאר). site / social / brokers, או save לבד.';

comment on column public.properties.share_with_brokers is
  'הסוכן/ת ביקש/ה הפצה למשרדים אחרים. ההפצה עצמה מוגבלת ובדגל נפרד. לא shared_with_partners.';

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'properties_publish_channels_chk'
  ) then
    alter table public.properties
      add constraint properties_publish_channels_chk
      check (
        publish_channels is null
        or publish_channels = array['site']::text[]
        or publish_channels = array['site','social']::text[]
        or publish_channels = array['site','brokers']::text[]
        or publish_channels = array['site','social','brokers']::text[]
        or publish_channels = array['save']::text[]
      );
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'properties_share_with_brokers_chk'
  ) then
    alter table public.properties
      add constraint properties_share_with_brokers_chk
      check (
        share_with_brokers = coalesce(publish_channels @> array['brokers']::text[], false)
      );
  end if;
end $$;

create index if not exists properties_gabriela_social_idx
  on public.properties (created_at)
  where status = 'active' and publish_channels @> array['social']::text[];

create index if not exists properties_share_with_brokers_idx
  on public.properties (created_at)
  where share_with_brokers and status = 'active';

-- הדגל והמערך נשארים מסונכרנים גם כשהכרטיס שולח רק את המערך.
create or replace function public.properties_publish_channels_sync()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.publish_channels is null then
    new.share_with_brokers := false;
  else
    new.share_with_brokers := 'brokers' = any (new.publish_channels);
  end if;
  return new;
end;
$$;

comment on function public.properties_publish_channels_sync() is
  'share_with_brokers נגזר מ-publish_channels לפני הבדיקה.';

revoke all on function public.properties_publish_channels_sync() from public, anon, authenticated;

drop trigger if exists properties_b_publish_channels_sync on public.properties;
create trigger properties_b_publish_channels_sync
  before insert or update on public.properties
  for each row
  execute function public.properties_publish_channels_sync();

insert into public.pricing_config (key, value, description) values
  ('gabriela_social_publish_enabled', 0,
   '1: נכס שגבריאלה סימנה לו רשתות נכנס לתור property_publications. 0: רק הסימון על הנכס. לא מפרסם לבד.')
on conflict (key) do nothing;

-- הטריגר של 20270116090000, עם שער לבחירה מפורשת.
-- NULL ממשיך לכל ערוץ דלוק. מערך בלי social לא נכנס לתור.
-- מערך עם social מחכה לדגל. התקרה וההשהיה נשארות במשיכה מהתור.
create or replace function public.properties_queue_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.publish_channels is not null then
    if not ('social' = any (new.publish_channels)) then
      return null;
    end if;
    if coalesce((select value::int from public.pricing_config
                  where key = 'gabriela_social_publish_enabled'), 0) <> 1 then
      return null;
    end if;
  end if;
  if public.publication_channel_enabled('facebook_page') then
    perform public.queue_property_publication(new.id, 'facebook_page');
  end if;
  if public.publication_channel_enabled('instagram') then
    perform public.queue_property_publication(new.id, 'instagram');
  end if;
  return null;
exception when others then
  raise warning 'properties_queue_publication נכשל לנכס %: %', new.id, sqlerrm;
  return null;
end;
$$;

comment on function public.properties_queue_publication() is
  'נכס שנעשה active נכנס לתור של כל ערוץ דלוק. בחירה מפורשת בלי social מדלגת. עם social, רק כש-gabriela_social_publish_enabled=1. לכל נכס עד שתי שורות תור, לא התראות.';

revoke all on function public.properties_queue_publication() from public, anon, authenticated;

-- בקשות שנרשמו כשהדגל כבוי. הסבב של פרסום הרשתות קורא לכאן, עד 10 נכסים.
-- שורה שכבר בתור לא נוצרת שוב (בלי p_force).
create or replace function public.gabriela_social_drain(p_limit int default 10)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_on int;
  v_n int := 0;
  v_cap int;
  r record;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role'
     and not public.current_is_platform_admin() then
    return 0;
  end if;
  select coalesce(value::int, 0) into v_on
    from public.pricing_config where key = 'gabriela_social_publish_enabled';
  if coalesce(v_on, 0) <> 1 then
    return 0;
  end if;
  perform pg_advisory_xact_lock(281850001);
  v_cap := least(greatest(coalesce(p_limit, 10), 1), 10);
  for r in
    select p.id
      from public.properties p
     where p.status = 'active'
       and p.publish_channels @> array['social']::text[]
       and (
         (public.publication_channel_enabled('facebook_page')
          and not exists (
            select 1 from public.property_publications pub
             where pub.property_id = p.id and pub.channel = 'facebook_page'
          ))
         or
         (public.publication_channel_enabled('instagram')
          and not exists (
            select 1 from public.property_publications pub
             where pub.property_id = p.id and pub.channel = 'instagram'
          ))
       )
     order by p.created_at
     limit v_cap
  loop
    if public.publication_channel_enabled('facebook_page') then
      perform public.queue_property_publication(r.id, 'facebook_page');
    end if;
    if public.publication_channel_enabled('instagram') then
      perform public.queue_property_publication(r.id, 'instagram');
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

comment on function public.gabriela_social_drain(int) is
  'מכניס לתור עד 10 נכסים פעילים שסומנו לרשתות ועוד אין להם שורה. דגל כבוי: 0. לא מפרסם. לכל נכס עד שני ערוצים.';

revoke all on function public.gabriela_social_drain(int) from public, anon, authenticated;
grant execute on function public.gabriela_social_drain(int) to service_role;
