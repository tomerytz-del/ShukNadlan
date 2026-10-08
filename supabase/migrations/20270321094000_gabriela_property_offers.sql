-- ============================================================================
-- גבריאלה מציעה על נכס חדש: לפתוח לשת"פ, ולהפיק סרטון לנכס שראוי לו
-- ============================================================================
--
-- סוכן/ת שהכניס/ה נכס - מה-CRM או מגבריאלה - מקבל/ת בוואטסאפ, אחרי שיש לנכס
-- פרטים, תיאור ותמונות, הודעה עם כפתורי כן/לא:
--
--   ‏· **שת"פ** - לכל נכס פעיל שעוד לא נפתח למשרדים השותפים.
--   ‏· **סרטון** - לפנטהאוז/גג, בית פרטי/קוטג', דו משפחתי ודירת גן שאין להם
--     סרטון או סיור, ויש להם מספיק תמונות להפקה (‏property_video_min_clips).
--
-- ההודעה נשלחת מ-`whatsapp-webhook?task=property-offers` (‏property-offers.ts);
-- כאן רק הבחירה, הרישום והתזמון.
--
-- ## שלוש החלטות
--
-- 1. **רק בתוך חלון 24 השעות של Meta** (‏whatsapp_conversations.last_message_at,
--    ‏23 שעות כמו ב-notification_push_due_agents). הודעת כפתורים מחוצה לו
--    נדחית, ואין לנו תבנית מאושרת עם כן/לא. ההצעה ממתינה לפעם הבאה שהסוכן/ת
--    כותב/ת לגבריאלה.
-- 2. **רק נכסים מ-14 הימים האחרונים**, ורק אחרי 10 דקות מהיצירה. בלי הראשון,
--    ההפעלה הייתה מציפה כל סוכן/ת בהצעות על כל המלאי הקיים; בלי השני, הנכס
--    עוד לא קיבל את התמונות ואת התיאור שנכתב אוטומטית.
-- 3. **הצעה אחת לכל נכס ולכל סוג, לתמיד** (‏unique). "לא, תודה" אינו חוזר.
--    ותקרה של ארבע הצעות לסוכן/ת ב-24 שעות, ושתיים בסבב: מי שהכניס/ה עשרה
--    נכסים בבוקר לא מקבל/ת עשרים הודעות.
--
-- הרישום קודם לשליחה (כמו notification_push_claim): נפילה באמצע משאירה
-- הצעה ב-`pending`, ולא שולחת אותה פעמיים.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. הטבלה
-- ---------------------------------------------------------------------------
create table if not exists public.agent_property_offers (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references public.properties(id) on delete cascade,
  agent_id      uuid not null references public.agency_members(id) on delete cascade,
  kind          text not null check (kind in ('share', 'video')),
  status        text not null default 'pending'
                check (status in ('pending', 'sent', 'failed', 'yes', 'no')),
  wa_message_id text,
  created_at    timestamptz not null default now(),
  answered_at   timestamptz,
  unique (property_id, kind)
);

create index if not exists agent_property_offers_agent_created_idx
  on public.agent_property_offers (agent_id, created_at desc);

comment on table public.agent_property_offers is
  'הצעות של גבריאלה על נכס חדש (שת"פ, סרטון): אחת לכל נכס ולכל סוג. נכתבת ב-property_offers_claim לפני השליחה, ומתעדכנת בלחיצה.';

-- טבלה פנימית: נכתבת ונקראת רק מהשרת (service_role עוקף RLS).
alter table public.agent_property_offers enable row level security;

-- ---------------------------------------------------------------------------
-- 2. הבחירה והרישום
-- ---------------------------------------------------------------------------
create or replace function public.property_offers_claim(p_limit int default 20)
returns table (
  offer_id      uuid,
  agent_id      uuid,
  wa_phone      text,
  display_name  text,
  property_id   uuid,
  title         text,
  property_type text,
  kind          text
)
language plpgsql
security definer
set search_path = ''
as $$
-- עמודות ההחזרה (agent_id, kind...) הן גם שמות עמודות בטבלאות שבשאילתה
#variable_conflict use_column
declare
  v_cap      int := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_min_clips int := coalesce((select value::int from public.pricing_config
                                where key = 'property_video_min_clips'), 2);
begin
  return query
  with cand as (
    select p.id as pid, p.title, p.property_type, p.created_at,
           m.id as aid, m.display_name, c.wa_phone, k.kind
      from public.properties p
      join public.agency_members m
        on m.id = p.agent_id and m.active = true
      join public.whatsapp_conversations c
        on c.agent_id = m.id
       and c.last_message_at > now() - interval '23 hours'
      cross join (values ('share'), ('video')) as k(kind)
     where p.status = 'active'
       and p.created_at > now() - interval '14 days'
       and p.created_at < now() - interval '10 minutes'
       -- "אחרי שיש את כל הפרטים, התיאור והתמונות"
       and coalesce(array_length(p.images, 1), 0) >= 1
       and coalesce(nullif(btrim(p.marketing_description), ''),
                    nullif(btrim(p.description), '')) is not null
       and not exists (select 1 from public.agent_property_offers o
                        where o.property_id = p.id and o.kind = k.kind)
       and (
         (k.kind = 'share'
          and not coalesce(p.shared_with_partners, false)
          and m.agency_id is not null)
         or
         (k.kind = 'video'
          and p.property_type ~ '(פנטהאוז|גג|בית פרטי|קוטג|דו.?משפחתי|דירת גן)'
          and nullif(btrim(coalesce(p.video_url, '')), '') is null
          and nullif(btrim(coalesce(p.tour_3d_url, '')), '') is null
          and not coalesce(p.has_virtual_tour, false)
          and coalesce(array_length(p.images, 1), 0) >= v_min_clips)
       )
  ),
  ranked as (
    select cand.*,
           row_number() over (partition by cand.aid
                              order by cand.created_at desc, cand.kind) as rn,
           (select count(*) from public.agent_property_offers o
             where o.agent_id = cand.aid
               and o.created_at > now() - interval '24 hours') as sent_24h
      from cand
  ),
  ins as (
    insert into public.agent_property_offers (property_id, agent_id, kind)
    select r.pid, r.aid, r.kind
      from ranked r
     where r.rn <= 2
       and r.sent_24h + r.rn <= 4
     order by r.created_at
     limit v_cap
    on conflict (property_id, kind) do nothing
    returning id, agent_property_offers.property_id, agent_property_offers.agent_id,
              agent_property_offers.kind
  )
  select ins.id, ins.agent_id, r.wa_phone, r.display_name, ins.property_id,
         r.title, r.property_type, ins.kind
    from ins
    join ranked r on r.pid = ins.property_id and r.kind = ins.kind
   -- שת"פ לפני סרטון לאותו/ה סוכן/ת
   order by ins.agent_id, ins.kind;
end;
$$;

comment on function public.property_offers_claim(int) is
  'בוחרת נכסים חדשים להצעת שת"פ/סרטון של גבריאלה, רושמת את ההצעות ומחזירה מה לשלוח. רק סוכנים בתוך חלון 24 השעות של Meta.';

revoke all on function public.property_offers_claim(int) from public, anon, authenticated;
grant execute on function public.property_offers_claim(int) to service_role;

-- ---------------------------------------------------------------------------
-- 3. התזמון - כל עשר דקות, ורק כשיש סוכן/ת בתוך החלון
-- ---------------------------------------------------------------------------
do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/whatsapp-webhook?task=property-offers';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - הצעות הנכס לא תוזמנו';
    return;
  end if;

  perform cron.unschedule('property-offers')
    where exists (select 1 from cron.job where jobname = 'property-offers');

  perform cron.schedule('property-offers', '*/10 * * * *', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1))),
      timeout_milliseconds := 5000
    )
    where exists (select 1 from public.whatsapp_conversations
                   where agent_id is not null
                     and last_message_at > now() - interval '23 hours');
  $cron$, v_url));
end;
$$;
