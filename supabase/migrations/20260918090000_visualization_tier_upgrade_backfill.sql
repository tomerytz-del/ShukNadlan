-- ============================================================================
-- מילוי לאחור אוטומטי של הדמיות עם שדרוג סוכן/ת ל-Premium
--
-- הפער שזה סוגר: הזכאות להדמיות תלויה בשני צדדים — הנכס (פעיל, פרטי, עם
-- תמונות) והסוכן/ת (Premium פעיל/ה) — אבל הטריגר מ-20260827190000 יושב על
-- ‏properties בלבד. כששדרגו סוכן/ת, השורות שהשתנו הן ב-agency_members;
-- ‏properties לא נגעה, אף טריגר לא ירה, והנכסים שלו/ה הפכו זכאים ונשארו
-- בלי הדמיות עד שמישהו זכר להריץ סקריפט ידני.
--
-- זה קרה בפועל: שני סוכנים שודרגו ל-Premium וארבעה נכסים פרטיים עם תמונות
-- נשארו ריקים, בלי שום סימן שמשהו לא קרה.
--
-- ---------------------------------------------------------------------------
-- למה תור ולא קריאה ישירה מהטריגר
--
-- טריגר שיורה net.http_post בלולאה על כל נכסי הסוכן/ת נראה פשוט יותר, והוא
-- הפתרון הלא נכון כאן: לסוכן/ת אחד/ת בפרויקט הזה כבר יש 54 נכסים. שדרוג
-- אחד היה מייצר עשרות קריאות במקביל, כל אחת 2–3 קריאות Gemini בתשלום, בלי
-- שום ויסות ובלי דרך לעצור באמצע. פרסום נכס בודד הוא אירוע יחיד ולכן שם
-- קריאה ישירה מתאימה; שדרוג הוא אירוע שמייצר N עבודות בבת אחת.
--
-- לכן: הטריגר רק *רושם* שורות (זול, טרנזקציוני, בלי רשת), ו-pg_cron מרוקן
-- אותן בקצב קבוע. זו אותה דוקטרינה של property_publications.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. התור
--
-- מפתח ראשי על property_id ולא מזהה רץ: נכס יכול להמתין בתור פעם אחת בלבד.
-- שדרוג, הורדה ושדרוג חוזר מעדכנים את אותה שורה במקום לצבור כפילויות, והתור
-- אינו גדל בלי גבול.
-- ---------------------------------------------------------------------------
create table if not exists public.visualization_backfill_queue (
  property_id  uuid primary key references public.properties(id) on delete cascade,
  agent_id     uuid references public.agency_members(id) on delete set null,

  -- למה הנכס נכנס לתור. כרגע רק tier_upgrade, אבל השדה קיים כדי שמקור
  -- כניסה נוסף לא ידרוש מיגרציה
  reason       text not null default 'tier_upgrade',

  status       text not null default 'pending'
               check (status in ('pending','sent','skipped')),
  attempts     smallint not null default 0,

  queued_at    timestamptz not null default now(),
  processed_at timestamptz
);

comment on table public.visualization_backfill_queue is
  'נכסים שהפכו זכאים להדמיות בעקבות שינוי בסוכן/ת ולא דרך אירוע פרסום. מתרוקן ב-pg_cron.';

comment on column public.visualization_backfill_queue.status is
  'pending=ממתין, sent=נשלחה בקשה ל-property-visualize-base, skipped=כבר לא זכאי בזמן הריקון';

create index if not exists visualization_backfill_queue_pending_idx
  on public.visualization_backfill_queue (queued_at)
  where status = 'pending';

alter table public.visualization_backfill_queue enable row level security;
revoke all on public.visualization_backfill_queue from anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. גודל המנה
-- ---------------------------------------------------------------------------
insert into public.pricing_config (key, value, description) values
  ('visualization_backfill_batch_size', 5,
   'כמה נכסים מתרוקנים מתור מילוי ההדמיות בכל הרצת cron (כל נכס = 2–3 קריאות Gemini)')
on conflict (key) do update
  set value = excluded.value, description = excluded.description;


-- ---------------------------------------------------------------------------
-- 3. הכנסה לתור
--
-- נקודת כניסה אחת — גם לטריגר וגם להרצה ידנית אחרי תיקון נתונים.
-- ---------------------------------------------------------------------------
create or replace function public.queue_agent_visualization_backfill(
  p_agent_id uuid,
  p_force    boolean default false
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.visualization_backfill_queue (property_id, agent_id, reason)
  select p.id, p.agent_id, 'tier_upgrade'
  from public.properties p
  where p.agent_id = p_agent_id
    and p.category = 'residential'
    and coalesce(array_length(p.images, 1), 0) > 0
    and not public.is_land_property_type(p.property_type)
    -- מקור האמת היחיד לזכאות, בדיוק כמו ב-RLS וב-Edge Functions. הוא כולל
    -- כבר את status='active' של הנכס ואת Premium הפעיל של הסוכן/ת.
    and public.property_visualizations_enabled(p.id)
    -- נכס שכבר יש לו סט בסיס אינו צריך כלום. הפונקציה עצמה גם מדלגת על
    -- מטרה קיימת, אבל אין סיבה לשלוח אליה בקשה שכולה דילוג.
    and (p_force or not exists (
          select 1 from public.property_visualizations v
          where v.property_id = p.id and v.is_base))
  on conflict (property_id) do update
    set status       = 'pending',
        attempts     = 0,
        queued_at    = now(),
        processed_at = null
    -- שורה שכבר ממתינה נשארת במקומה; רק שורה שנסגרה נפתחת מחדש
    where public.visualization_backfill_queue.status <> 'pending';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.queue_agent_visualization_backfill(uuid, boolean) is
  'רושם לתור את הנכסים הפרטיים הזכאים של סוכן/ת שאין להם סט הדמיות בסיס.';

revoke all on function public.queue_agent_visualization_backfill(uuid, boolean) from public;
revoke all on function public.queue_agent_visualization_backfill(uuid, boolean) from anon, authenticated;
grant execute on function public.queue_agent_visualization_backfill(uuid, boolean) to service_role;


-- ---------------------------------------------------------------------------
-- 4. הטריגר על agency_members
--
-- יורה רק על *מעבר* לזכאות. עדכון שדה אחר בסוכן/ת Premium קיים/ת, או שינוי
-- בין שני מצבים לא-זכאים, לא מפעילים כלום.
--
-- ‏tier ו-billing_status מוגנים ב-protect_sensitive_agency_member_fields
-- ונכתבים רק בהרשאה מוגברת, ולכן הטריגר הזה ממילא רואה רק שינוי אמיתי
-- שהמערכת יזמה — לא ניסיון של סוכן/ת לשדרג את עצמו/ה בעדכון ישיר.
-- ---------------------------------------------------------------------------
create or replace function public.agency_members_enqueue_visualization_backfill()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was_eligible boolean := false;
  v_is_eligible  boolean;
begin
  v_is_eligible := new.tier = 'premium' and new.active and new.billing_status = 'active';
  if not v_is_eligible then
    return null;
  end if;

  if tg_op = 'UPDATE' then
    v_was_eligible := old.tier = 'premium' and old.active and old.billing_status = 'active';
  end if;

  if v_was_eligible then
    return null;   -- היה זכאי כבר קודם — לא קרה כאן מעבר
  end if;

  perform public.queue_agent_visualization_backfill(new.id);
  return null;
exception when others then
  -- אותה דוקטרינה כמו בטריגר הפרסום: הדמיות הן פיצ'ר שיווקי, ותקלה בהן
  -- לא תמנע שדרוג של סוכן/ת או עדכון חיוב.
  raise warning 'agency_members_enqueue_visualization_backfill נכשל לסוכן/ת %: %', new.id, sqlerrm;
  return null;
end;
$$;

comment on function public.agency_members_enqueue_visualization_backfill() is
  'רושם לתור מילוי הדמיות את נכסי הסוכן/ת ברגע שהוא/היא הופך/ת לזכאי/ת (שדרוג ל-Premium, חידוש חיוב, הפעלה מחדש).';

revoke all on function public.agency_members_enqueue_visualization_backfill() from public;
revoke all on function public.agency_members_enqueue_visualization_backfill() from anon, authenticated;

drop trigger if exists agency_members_enqueue_visualization_backfill on public.agency_members;
create trigger agency_members_enqueue_visualization_backfill
  after insert or update of tier, active, billing_status on public.agency_members
  for each row execute function public.agency_members_enqueue_visualization_backfill();

comment on trigger agency_members_enqueue_visualization_backfill on public.agency_members is
  'שדרוג ל-Premium מזמין סט הדמיות בסיס לנכסים הקיימים (מודול ההדמיות).';


-- ---------------------------------------------------------------------------
-- 5. ריקון התור
--
-- שלוש נקודות שקובעות את ההתנהגות:
--
--   • בלי סודות ה-Vault — no-op שקט, והשורות נשארות pending. אותה דוקטרינה
--     כמו בטריגר הפרסום: אפשר להריץ את המיגרציה לפני שהמנגנון הופעל, ומרגע
--     ההפעלה התור מתחיל לזוז מעצמו בלי שאיש יזכיר לו.
--   • הזכאות נבדקת *שוב* בזמן הריקון ולא רק בזמן ההכנסה. בין השניים עוברות
--     דקות שבהן הסוכן/ת יכול/ה לרדת מ-Premium או הנכס להימחק, ואסור שכסף
--     ייצא על שורה שהתיישנה. מי שכבר לא זכאי מסומן skipped ולא נמחק, כדי
--     שאפשר יהיה לראות מה קרה.
--   • ‏skip locked כדי ששתי הרצות חופפות לא ישלחו את אותו נכס פעמיים.
-- ---------------------------------------------------------------------------
create or replace function public.drain_visualization_backfill_queue(
  p_limit integer default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key   text;
  v_url   text;
  v_limit integer;
  v_sent  integer := 0;
  r       record;
begin
  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'visualization_service_key' limit 1;
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'edge_functions_base_url' limit 1;

  if v_key is null or v_url is null then
    return 0;   -- המנגנון עוד לא הופעל
  end if;

  v_limit := coalesce(
    p_limit,
    (select value::integer from public.pricing_config
      where key = 'visualization_backfill_batch_size'),
    5);

  for r in
    select q.property_id
    from public.visualization_backfill_queue q
    where q.status = 'pending'
    order by q.queued_at
    limit v_limit
    for update skip locked
  loop
    if not public.property_visualizations_enabled(r.property_id) then
      update public.visualization_backfill_queue
         set status = 'skipped', processed_at = now(), attempts = attempts + 1
       where property_id = r.property_id;
      continue;
    end if;

    perform net.http_post(
      url     := v_url || '/property-visualize-base',
      headers := jsonb_build_object(
                   'Content-Type',  'application/json',
                   'Authorization', 'Bearer ' || v_key),
      body    := jsonb_build_object('property_id', r.property_id),
      timeout_milliseconds := 5000
    );

    update public.visualization_backfill_queue
       set status = 'sent', processed_at = now(), attempts = attempts + 1
     where property_id = r.property_id;

    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end;
$$;

comment on function public.drain_visualization_backfill_queue(integer) is
  'שולח מנה אחת מתור מילוי ההדמיות ל-property-visualize-base. no-op שקט בלי סודות ה-Vault.';

revoke all on function public.drain_visualization_backfill_queue(integer) from public;
revoke all on function public.drain_visualization_backfill_queue(integer) from anon, authenticated;
grant execute on function public.drain_visualization_backfill_queue(integer) to service_role;


-- ---------------------------------------------------------------------------
-- 6. ה-cron
--
-- כל 5 דקות × 5 נכסים = עד 60 נכסים בשעה. מספיק מהר לשדרוג בודד, ואיטי
-- מספיק שגם שדרוג של סוכן/ת עם 54 נכסים לא ייצור פיק של קריאות בתשלום.
-- ---------------------------------------------------------------------------
select cron.unschedule('visualization-backfill-drain')
where exists (select 1 from cron.job where jobname = 'visualization-backfill-drain');

select cron.schedule(
  'visualization-backfill-drain',
  '*/5 * * * *',
  $cron$select public.drain_visualization_backfill_queue()$cron$
);
