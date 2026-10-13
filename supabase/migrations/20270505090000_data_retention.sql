-- ===========================================================================
-- זמני שמירה של מידע אישי (data retention)
--
-- ‏ISO 27001 ‏(5.33, ‏8.10) ותקנות הגנת הפרטיות: מידע אישי נשמר רק כל עוד
-- צריך אותו. עד היום לא נמחק כאן כלום חוץ מהקלטות (90 יום). ההחלטות
-- (הבעלים, 13.10.2026):
--
--   | מדיניות           | מה                                      | אחרי    | איך                    |
--   | leads_pii         | פרטים אישיים בלידים מכל הסוגים          | שנתיים  | השורה נשארת, הפרטים נמחקים |
--   | clients_inactive  | כרטיס לקוח/ה בלי שום פעילות             | שנתיים  | מחיקה, אחרי התראה שבוע לפני |
--   | whatsapp_bodies   | תוכן הודעות וואטסאפ וזיכרון השיחה       | שנה     | התוכן נמחק, השורה נשארת  |
--   | call_transcripts  | תמלול וסיכום של שיחות במספר הווירטואלי  | שנה     | התמלול נמחק, השורה נשארת |
--
-- ‏**למה "השורה נשארת" ברוב המקרים:** הספירות בדשבורד המשרד, זמן התגובה,
-- החיוב בדקות ומדידת הפניות מהאתר נשענות על השורות. בלי שם, טלפון ותוכן
-- השורה אינה מידע אישי, ולכן זה שקול למחיקה מבחינת הפרטיות.
--
-- ‏**הרצת יבש קודם:** ‏data_retention_settings.enabled מתחיל false בכל
-- המדיניות. הריצה הלילית רק סופרת מה *היה* נמחק ורושמת ב-
-- ‏data_retention_runs. אחרי שבוע הבעלים מאשר/ת, ומיגרציה נפרדת מדליקה.
-- מחיקה אינה הפיכה, ולכן אין כאן כפתור.
--
-- ‏docs/data-retention.md
-- ===========================================================================

create table if not exists public.data_retention_settings (
  policy      text primary key,
  keep_for    interval not null,
  enabled     boolean not null default false,
  description text not null
);

insert into public.data_retention_settings (policy, keep_for, description) values
  ('leads_pii',        interval '2 years', 'פרטים אישיים בלידים (שם, טלפון, מייל, הודעה) - השורה נשארת'),
  ('clients_inactive', interval '2 years', 'כרטיס לקוח/ה בלי פעילות - נמחק אחרי התראה לסוכן/ת שבוע לפני'),
  ('whatsapp_bodies',  interval '1 year',  'תוכן הודעות וואטסאפ וזיכרון השיחה של הבוטים - השורה נשארת'),
  ('call_transcripts', interval '1 year',  'תמלול, סיכום ונתונים שחולצו משיחה - השורה נשארת')
on conflict (policy) do nothing;

alter table public.data_retention_settings enable row level security;
revoke all on table public.data_retention_settings from public, anon, authenticated;
grant select on table public.data_retention_settings to authenticated;
drop policy if exists "platform admin reads retention settings" on public.data_retention_settings;
create policy "platform admin reads retention settings"
  on public.data_retention_settings for select to authenticated
  using (public.current_is_platform_admin());

create table if not exists public.data_retention_runs (
  id        bigserial primary key,
  run_at    timestamptz not null default now(),
  policy    text not null,
  dry_run   boolean not null,
  affected  integer not null,
  details   jsonb not null default '{}'::jsonb
);

create index if not exists data_retention_runs_at_idx on public.data_retention_runs (run_at desc);

alter table public.data_retention_runs enable row level security;
revoke all on table public.data_retention_runs from public, anon, authenticated;
grant select on table public.data_retention_runs to authenticated;
revoke all on sequence public.data_retention_runs_id_seq from public, anon, authenticated;
drop policy if exists "platform admin reads retention runs" on public.data_retention_runs;
create policy "platform admin reads retention runs"
  on public.data_retention_runs for select to authenticated
  using (public.current_is_platform_admin());

-- מתי הסוכן/ת קיבל/ה התראה שהכרטיס עומד להימחק. נמחק עם הכרטיס.
create table if not exists public.data_retention_client_warnings (
  client_id  uuid primary key references public.agent_clients(id) on delete cascade,
  warned_at  timestamptz not null default now()
);

alter table public.data_retention_client_warnings enable row level security;
revoke all on table public.data_retention_client_warnings from public, anon, authenticated;

do $$ begin perform public.notification_types_add(array['retention_warning']); end $$;

-- ---------------------------------------------------------------------------
-- הפעילות האחרונה של כרטיס לקוח/ה. **כל דבר שסוכן/ת או הלקוח/ה עשו:**
-- עדכון בכרטיס, פריט ביומן, שיחה, מיניסייט (כולל צפייה של הלקוח/ה), והסכם
-- שנשלח או נחתם. ‏client_match_alerts **לא** נספר - הוא נכתב אוטומטית על כל
-- נכס חדש, וכרטיס נטוש היה נשאר "פעיל" לנצח.
-- ---------------------------------------------------------------------------
create or replace function public._client_last_activity(p_client uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    (select greatest(c.created_at, c.updated_at) from public.agent_clients c where c.id = p_client),
    (select max(greatest(a.created_at, a.updated_at, a.due_at, a.completed_at, a.client_responded_at))
       from public.agent_agenda_items a where a.client_id = p_client),
    (select max(k.created_at) from public.agent_calls k where k.client_id = p_client),
    (select max(greatest(s.created_at, s.updated_at, s.last_viewed_at))
       from public.client_showcases s where s.client_id = p_client),
    (select max(greatest(g.created_at, g.sent_at, g.signed_at))
       from public.agreements g where p_client = any(g.client_ids)),
    (select max(greatest(x.created_at, x.signed_at))
       from public.agreement_signers x where x.client_id = p_client)
  );
$$;

revoke all on function public._client_last_activity(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- הריצה הלילית. בכל מדיניות: סופרת, ואם enabled - מבצעת. תמיד רושמת שורה ב-
-- data_retention_runs, כך שבהרצת היבש רואים בדיוק מה היה קורה.
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
           set full_name = 'נמחק', phone = '', phone_e164 = null, email = null
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

        insert into public.notifications (agent_id, type, title, body, related_client_id)
        select r.agent_id, 'retention_warning',
               'כרטיס לקוח/ה יימחק בעוד שבוע',
               'הכרטיס של ' || coalesce(nullif(r.full_name, ''), 'לקוח/ה') ||
               ' לא היה פעיל שנתיים, ולכן יימחק בעוד שבוע לפי מדיניות השמירה. '
               || 'כל עדכון בכרטיס משאיר אותו.',
               r.id
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

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - data_retention_run לא תוזמנה';
    return;
  end if;
  perform cron.unschedule('data-retention-run')
    where exists (select 1 from cron.job where jobname = 'data-retention-run');
  -- ‏03:53 UTC = 06:53 בקיץ בישראל. ההתראה לסוכן/ת נכתבת לפעמון כאן,
  -- והדחיפה לוואטסאפ מכבדת את שעות השקט שלו/ה.
  perform cron.schedule('data-retention-run', '53 3 * * *',
                        'select public.data_retention_run()');
end $$;
