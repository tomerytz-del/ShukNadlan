-- בקשות אישור מוואטסאפ: אינדקס, שמירה, והחלפת בלעדיות רק בחתימה.
--
-- whatsapp_pending_actions (20271028160000) נשארת בלי אינדקס על agent_id,
-- ובלי מחיקה של שורות שכבר בוצעו או שפגו. המדיניות נולדת כבויה, כמו
-- השאר: הריצה סופרת, ומוחקת רק אחרי enabled.
--
-- הנפקה מחדש של בלעדיות חתומה אינה מבטלת אותה מיד. השורה החדשה מצביעה
-- ב-replaces_agreement_id, והטריגר מבטל את החתומה רק כשהחדשה נחתמת.
-- agreements_bundle_status כבר מבטל איתה את טופס ההסכמה.
--
-- data_retention_run זהה ל-20270905090000, עם שתי תוספות: הענף של
-- הבקשות, ו-suppress_push=false על התראת השמירה (התראה חיה, לא מילוי).

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
      -- בוצעה, או שפגה, לפני החלון. בקשה פתוחה שעוד לא פגה נשארת.
      select count(*) into v_n from public.whatsapp_pending_actions a
       where (a.executed_at is not null and a.executed_at < v_cut)
          or (a.executed_at is null and a.expires_at < v_cut);
      v_parts := v_parts || jsonb_build_object('whatsapp_pending_actions', v_n);
      if s.enabled then
        delete from public.whatsapp_pending_actions a
         where (a.executed_at is not null and a.executed_at < v_cut)
            or (a.executed_at is null and a.expires_at < v_cut);
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


create index if not exists whatsapp_pending_actions_agent_created_idx
  on public.whatsapp_pending_actions (agent_id, created_at desc);

-- בקשה פתוחה אחת לסוכן/ת, פעולה ונושא. שורה שכבר בוצעה אינה תופסת את המקום.
create unique index if not exists whatsapp_pending_actions_open_subject_idx
  on public.whatsapp_pending_actions (agent_id, action, subject_id)
  where executed_at is null and new_subject_id is null;

insert into public.data_retention_settings (policy, keep_for, description) values
  ('whatsapp_pending_actions', interval '30 days',
   'בקשות אישור מוואטסאפ שכבר בוצעו, או שפגו. בקשה פתוחה נשארת. המדיניות כבויה עד אישור.')
on conflict (policy) do nothing;

alter table public.agreements
  add column if not exists replaces_agreement_id uuid
  references public.agreements (id) on delete set null;

create index if not exists agreements_replaces_idx
  on public.agreements (replaces_agreement_id)
  where replaces_agreement_id is not null;

comment on column public.agreements.replaces_agreement_id is
  'ההסכם החתום שהשורה הזו מחליפה. הוא נשאר בתוקף עד שהשורה הזו נחתמת.';

create or replace function public.agreements_supersede_on_sign()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.replaces_agreement_id is null or new.replaces_agreement_id = new.id then
    return new;
  end if;
  update public.agreements
     set status = 'cancelled',
         cancelled_at = coalesce(cancelled_at, now())
   where id = new.replaces_agreement_id
     and agent_id = new.agent_id
     and status = 'signed';
  return new;
end $$;

revoke all on function public.agreements_supersede_on_sign() from public, anon, authenticated;
grant execute on function public.agreements_supersede_on_sign() to service_role;

drop trigger if exists agreements_supersede_on_sign on public.agreements;
create trigger agreements_supersede_on_sign
  after update of status on public.agreements
  for each row
  when (new.status = 'signed' and old.status is distinct from 'signed')
  execute function public.agreements_supersede_on_sign();
