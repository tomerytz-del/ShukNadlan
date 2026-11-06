-- ============================================================================
-- בלם הדמיות לגולש/ת: 10 בקשות שמייצרות הדמיה ב-24 שעות, לפי מכשיר או IP
-- (אישור תומר, 6.11.2026; ההצעה ישבה ב-docs/proposals/visualization_visitor_cap.sql
-- מ-PR 1010, חלק 2 §5.3)
--
-- ## למה
--
-- יצירת הדמיה מתוך דף ההחלקה (assets/swipe.js, VIZ_SWIPE_GENERATE) כבויה כי
-- כל הדמיה עולה כסף, וגולש/ת אנונימי/ת היה/תה יכול/ה לבקש בלי גבול. הקוד
-- שסופר בקשות לפי מכשיר ו-IP כבר בפונקציה (property-visualize, "בלם
-- לגולש/ת"): עד היום השאילתה שלו נכשלה על עמודה חסרה והבלם לא היה פעיל.
--
-- ## מה כאן
--
-- 1. שתי עמודות על visualization_jobs. ה-IP עצמו לעולם לא נשמר: רק גיבוב
--    sha256 של מפתח הקצב (IPv4 מלא, IPv6 לפי /64 - rateLimitKey ב-
--    _shared/fair-contact.ts) עם VIZ_IP_SALT. בלי הסוד הפונקציה משתמשת במלח
--    הקבוע של fair-contact, ולכן הבלם לפי IP פעיל גם לפניו; הסוד רק מקשה
--    על שחזור כתובת מהגיבוב, כי מרחב IPv4 קטן מספיק לעבור עליו כולו.
-- 2. שני אינדקסים חלקיים לבקשות ondemand, לפי מזהה ואז זמן: זו בדיוק
--    השאילתה (device_id = X or client_ip_hash = Y, created_at >= since),
--    וגם בדיקת "עבודה של אותו מכשיר עוד בעיבוד". האינדקס הקיים
--    (property_id, created_at) משרת את התקרה פר נכס ולא את זו.
-- 3. זמן שמירה: המזהים משרתים רק את חלון 24 השעות, ולכן data_retention_run
--    מאפסת אותם אחרי 30 יום (מדיניות visualization_visitor_ids, דולקת).
--    השורה עצמה - העבודה, הליד, החיוב - נשארת. גוף הפונקציה הועתק
--    מ-20271029200000 אחרי השוואת md5(prosrc) לפרודקשן (זהה), והענף החדש
--    נוסף לפני סוף ה-if (הסקיל new-migration, כלל 8).
--
-- ## הסדר
--
-- המיגרציה קודם, ב-PR משלה (אינה דיפלוי ב-Netlify). הדלקת VIZ_SWIPE_GENERATE
-- ב-swipe.js נכנסת ב-PR שאחריה, כשה-workflow ירוק (הסקיל deploy-path).
-- docs/property-visualizations.md, docs/swipe-mode.md, docs/data-retention.md.
-- ============================================================================

alter table public.visualization_jobs
  add column if not exists device_id text,
  add column if not exists client_ip_hash text;

comment on column public.visualization_jobs.device_id is
  'מזהה המכשיר של הגולש/ת (x-sk-device) לבלם ההדמיות היומי; null לבקשה מהשרת, ומאופס אחרי 30 יום';
comment on column public.visualization_jobs.client_ip_hash is
  'גיבוב של מפתח הקצב של ה-IP עם VIZ_IP_SALT לבלם ההדמיות היומי; ה-IP עצמו אינו נשמר, ומאופס אחרי 30 יום';

create index if not exists visualization_jobs_ondemand_device_idx
  on public.visualization_jobs (device_id, created_at)
  where trigger_source = 'ondemand';
create index if not exists visualization_jobs_ondemand_ip_idx
  on public.visualization_jobs (client_ip_hash, created_at)
  where trigger_source = 'ondemand';

-- ---------------------------------------------------------------------------
-- זמן שמירה למזהי הגולש/ת
-- ---------------------------------------------------------------------------

insert into public.data_retention_settings (policy, keep_for, enabled, description)
values (
  'visualization_visitor_ids',
  interval '30 days',
  true,
  'מזהה המכשיר וגיבוב ה-IP של בקשות הדמיה. משרתים רק את בלם 24 השעות; מאופסים אחרי 30 יום, השורה נשארת.'
)
on conflict (policy) do nothing;

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

    elsif s.policy = 'deeplink_timings' then
      select count(*) into v_n from public.deeplink_timings d
       where d.created_at < v_cut;
      v_parts := v_parts || jsonb_build_object('deeplink_timings', v_n);
      if s.enabled then
        delete from public.deeplink_timings
         where created_at < v_cut;
        delete from public.deeplink_timing_calls
         where called_at < v_cut;
      end if;

    elsif s.policy = 'visualization_visitor_ids' then
      -- נשמר מ-20271106140000. מזהה המכשיר וגיבוב ה-IP משרתים רק את בלם
      -- 24 השעות; אחרי 30 יום הם נמחקים מהשורה, והשורה (העבודה, הליד,
      -- החיוב) נשארת.
      select count(*) into v_n from public.visualization_jobs j
       where j.created_at < v_cut
         and (j.device_id is not null or j.client_ip_hash is not null);
      v_parts := v_parts || jsonb_build_object('visualization_jobs', v_n);
      if s.enabled then
        update public.visualization_jobs
           set device_id = null, client_ip_hash = null
         where created_at < v_cut
           and (device_id is not null or client_ip_hash is not null);
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
