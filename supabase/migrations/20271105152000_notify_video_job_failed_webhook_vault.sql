-- ============================================================================
-- הקובץ המקביל לרשומה 20261105181505 (notify_video_job_failed_webhook_vault)
--
-- webhook כשסרטון שיווקי לנכס נכשל (property_video_jobs.status = 'failed').
-- הגוף **כמו שהוא בפרודקשן** (pg_get_functiondef, 5.11.2026 18:26 UTC):
-- הכתובת והמפתח נקראים מה-Vault (video_fail_webhook_url, video_fail_webhook_key)
-- ולא כתובים בקוד; בלי כתובת - לא נשלח כלום; כשל בשליחה הוא warning ולא מפיל
-- את העדכון של המשימה.
--
-- אידמפוטנטי: create or replace, ו-drop trigger if exists לפני create trigger.
-- הרקע (DDL שהוחל מחוץ לצינור, ולמה שלושה קבצים):
-- 20271105150000_notify_video_job_failed_webhook.sql.
-- ============================================================================

create or replace function public.notify_video_job_failed()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare v_url text; v_key text;
begin
  if TG_OP = 'UPDATE' and OLD.status is not distinct from NEW.status then return NEW; end if;
  begin
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'video_fail_webhook_url';
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'video_fail_webhook_key';
    if v_url is not null then
      perform net.http_post(
        url := v_url,
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || coalesce(v_key,'')),
        body := jsonb_build_object('type', TG_OP, 'table', TG_TABLE_NAME, 'record', to_jsonb(NEW), 'old_record', case when TG_OP='UPDATE' then to_jsonb(OLD) else null end)
      );
    end if;
  exception when others then
    raise warning 'notify_video_job_failed: %', sqlerrm;
  end;
  return NEW;
end $function$;

comment on function public.notify_video_job_failed() is
  'טריגר: webhook כשמשימת סרטון לנכס נכשלת. כתובת ומפתח מה-Vault (video_fail_webhook_url / video_fail_webhook_key). הוחל מחוץ לצינור ב-5.11.2026 ונכנס לריפו ב-20271105152000.';

-- פונקציית טריגר - אף תפקיד לא קורא לה ישירות
revoke all on function public.notify_video_job_failed() from public, anon, authenticated;

drop trigger if exists trg_notify_video_job_failed on public.property_video_jobs;
create trigger trg_notify_video_job_failed
  after insert or update of status on public.property_video_jobs
  for each row when (new.status = 'failed')
  execute function public.notify_video_job_failed();
