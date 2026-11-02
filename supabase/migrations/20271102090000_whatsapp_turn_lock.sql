-- ============================================================================
-- נעילת תור לגבריאלה, ושמירת היסטוריה שלא דורסת תור מקביל
--
-- שתי הודעות טקסט מאותו/ה סוכן/ת, 4.67 שניות זו מזו, עברו את חלון הרצף
-- (1.5 שניות) ורצו שני תורים במקביל: כל POST הוא inBackground(handlePayload),
-- ואין נעילה לפי סוכן/ת. התור השני טען היסטוריה לפני שהראשון שמר, פעל על
-- השם שלפני התיקון, וה-upsert של המערך כולו (last-writer-wins) מחק את
-- ההודעה ואת התשובה של הראשון.
--
-- 1. whatsapp_turn_acquire / _release. נעילה בשורה. מי שלא תפס/ה משאיר/ה
--    את הטקסט ב-pending_texts (לא take). המחזיק/ה, ב-finally, רואה אם נשאר
--    טקסט ומרוקן/ת עוד תור. תור חי מחדש את החכירה כל 15 שניות. בלי דופק
--    תור אחר רשאי לתפוס אחרי 45 שניות (turn_started_at),
--    כדי שלא יינעל/תינעל הסוכן/ת. שחרור מנקה את הטוקן רק אם הוא עדיין שלו/ה.
-- 2. history_version. שמירה מלאה נכתבת רק אם הגרסה לא זזה. אם זזה, הקוד
--    טוען מחדש ומוסיף רק את רשומות התור הזה. כותבים אחרים (ops, צוות
--    ההטמעה, שיחה) מוסיפים אטומית ומקדמים את הגרסה, וסמן ההתאמות נשאר
--    הודעת assistant אחת בסוף.
--
-- הפונקציות INVOKER חוץ מ-whatsapp_ops_history_append שהייתה DEFINER.
-- כולן service_role בלבד. השורה נוצרת ב-acquire אם הרצף לא הספיק ליצור אותה,
-- אחרת UPDATE על שורה חסרה נראה כמו "תפוס" וההודעה לא נענית.
-- ============================================================================

alter table public.whatsapp_conversations
  add column if not exists turn_token uuid,
  add column if not exists turn_started_at timestamptz,
  add column if not exists history_version integer not null default 0;

comment on column public.whatsapp_conversations.turn_token is
  'הטוקן של התור שמחזיק/ה בסוכן/ת עכשיו. null = פנוי. נכתב רק מ-whatsapp_turn_acquire / _release.';
comment on column public.whatsapp_conversations.turn_started_at is
  'מתי חודשה החכירה לאחרונה. בלי דופק, אחרי 45 שניות תור אחר רשאי לתפוס.';
comment on column public.whatsapp_conversations.history_version is
  'עולה בכל כתיבה של history. שמירת תור נכשלת אם הגרסה השתנתה, ומוסיפה רק את הרשומות שלה.';

-- סמן ההתאמות ([[shown-matches-v1]]) יוצא מהאמצע וחוזר כהודעה אחרונה.
-- הודעות חדשות לא נדרסות. סמן אחרון מנצח אם היו כמה.
-- הגוף (בלי הסמן) נגזם ל-12 ההודעות האחרונות, כמו חלון ההיסטוריה של התור.
create or replace function public.whatsapp_history_merge_append(
  p_history jsonb,
  p_entries jsonb
) returns jsonb
language sql
immutable
set search_path to ''
as $$
  with elems as (
    select e.ordinality,
           e.value,
           (
             e.value->>'role' = 'assistant'
             and coalesce(e.value->>'content', '') like '[[shown-matches-v1]]%'
           ) as is_mark
      from jsonb_array_elements(coalesce(p_history, '[]'::jsonb))
           with ordinality as e(value, ordinality)
  ),
  marker as (
    select elems.value
      from elems
     where elems.is_mark
     order by elems.ordinality desc
     limit 1
  ),
  combined as (
    select row_number() over (order by src.ord) as ordinality, src.value
      from (
        select elems.ordinality as ord, elems.value
          from elems
         where not elems.is_mark
        union all
        select 1000000 + n.ordinality as ord, n.value
          from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb))
               with ordinality as n(value, ordinality)
         where not (
           n.value->>'role' = 'assistant'
           and coalesce(n.value->>'content', '') like '[[shown-matches-v1]]%'
         )
      ) src
  ),
  capped as (
    select combined.value, combined.ordinality
      from combined
     order by combined.ordinality desc
     limit 12
  )
  select coalesce(
           (select jsonb_agg(capped.value order by capped.ordinality) from capped),
           '[]'::jsonb
         )
         || coalesce((select jsonb_build_array(marker.value) from marker), '[]'::jsonb);
$$;

comment on function public.whatsapp_history_merge_append(jsonb, jsonb) is
  'מוסיף הודעות, גוזר ל-12 האחרונות בלי הסמן, ומשאיר סמן התאמות אחד בסוף.';

revoke all on function public.whatsapp_history_merge_append(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.whatsapp_history_merge_append(jsonb, jsonb) to service_role;

create or replace function public.whatsapp_turn_acquire(
  p_agent_id uuid,
  p_token uuid,
  p_stale interval default '45 seconds'
) returns boolean
language plpgsql
set search_path to ''
as $$
declare
  v_phone text;
  v_ok boolean;
  v_stale interval;
begin
  if p_agent_id is null or p_token is null then
    return false;
  end if;
  v_stale := coalesce(p_stale, interval '45 seconds');

  select m.phone_e164 into v_phone
    from public.agency_members m
   where m.id = p_agent_id;
  if v_phone is null or btrim(v_phone) = '' then
    v_phone := 'unknown';
  end if;

  -- אין שורה: יוצרים ונועלים. יש שורה: נועלים רק אם פנוי או שהנעילה התיישנה.
  insert into public.whatsapp_conversations as c
    (agent_id, wa_phone, turn_token, turn_started_at)
  values (p_agent_id, v_phone, p_token, pg_catalog.now())
  on conflict (agent_id) do update
     set turn_token = excluded.turn_token,
         turn_started_at = excluded.turn_started_at
   where c.turn_token is null
      or c.turn_started_at < pg_catalog.now() - v_stale
  returning true into v_ok;

  return coalesce(v_ok, false);
end;
$$;

comment on function public.whatsapp_turn_acquire(uuid, uuid, interval) is
  'נועל/ת את תור גבריאלה לסוכן/ת. false = תור אחר מחזיק והטקסט נשאר ב-pending_texts.';

revoke all on function public.whatsapp_turn_acquire(uuid, uuid, interval) from public, anon, authenticated;
grant execute on function public.whatsapp_turn_acquire(uuid, uuid, interval) to service_role;

create or replace function public.whatsapp_turn_release(
  p_agent_id uuid,
  p_token uuid
) returns boolean
language plpgsql
set search_path to ''
as $$
declare
  v_pending boolean;
  v_n integer;
begin
  update public.whatsapp_conversations c
     set turn_token = null,
         turn_started_at = null
   where c.agent_id = p_agent_id
     and c.turn_token = p_token
  -- רק טקסט. תמונות ממתינות (גם ישנות) נשארות לזרימה הקיימת, לא לריקון.
  returning (cardinality(coalesce(c.pending_texts, '{}'::text[])) > 0)
  into v_pending;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    return false;
  end if;
  return coalesce(v_pending, false);
end;
$$;

comment on function public.whatsapp_turn_release(uuid, uuid) is
  'משחרר/ת את הנעילה רק אם הטוקן תואם. true = נשאר טקסט ב-pending_texts. תמונות לא מפעילות ריקון.';

revoke all on function public.whatsapp_turn_release(uuid, uuid) from public, anon, authenticated;
grant execute on function public.whatsapp_turn_release(uuid, uuid) to service_role;

-- דופק: תור חי מאריך את החכירה. תור שנתקע לא מחדש, ומשתחרר אחרי 45 שניות.
create or replace function public.whatsapp_turn_renew(
  p_agent_id uuid,
  p_token uuid
) returns boolean
language plpgsql
set search_path to ''
as $$
declare
  v_ok boolean;
begin
  update public.whatsapp_conversations c
     set turn_started_at = pg_catalog.now()
   where c.agent_id = p_agent_id
     and c.turn_token = p_token
  returning true into v_ok;
  return coalesce(v_ok, false);
end;
$$;

comment on function public.whatsapp_turn_renew(uuid, uuid) is
  'מאריך/ה את חכירת התור רק אם הטוקן עדיין שלו/ה. false = מישהו אחר תפס.';

revoke all on function public.whatsapp_turn_renew(uuid, uuid) from public, anon, authenticated;
grant execute on function public.whatsapp_turn_renew(uuid, uuid) to service_role;

-- כתיבה ששינתה history או last_client_id ולא קידםה את history_version
-- (ניקוי retention, נתיב ישן, סימון לקוח/ה משיחה) מבטלת compare-and-set.
-- לא מוסיפים 1 אם הכתיבה כבר קידםה.
create or replace function public.whatsapp_history_touch_version()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if new.history_version is not distinct from old.history_version
     and (
       new.history is distinct from old.history
       or new.last_client_id is distinct from old.last_client_id
     ) then
    new.history_version := coalesce(old.history_version, 0) + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists whatsapp_conversations_history_version on public.whatsapp_conversations;
create trigger whatsapp_conversations_history_version
  before update on public.whatsapp_conversations
  for each row
  execute function public.whatsapp_history_touch_version();

revoke all on function public.whatsapp_history_touch_version() from public, anon, authenticated;

-- compare-and-set. מחזיר את הגרסה החדשה, או 0 אם מישהו כתב באמצע.
create or replace function public.whatsapp_history_cas(
  p_agent_id uuid,
  p_phone text,
  p_expected integer,
  p_history jsonb,
  p_last_property_id uuid,
  p_last_client_id uuid
) returns integer
language plpgsql
set search_path to ''
as $$
declare
  v_version integer;
begin
  update public.whatsapp_conversations c
     set history = coalesce(p_history, '[]'::jsonb),
         history_version = c.history_version + 1,
         last_property_id = p_last_property_id,
         last_client_id = p_last_client_id,
         last_message_at = pg_catalog.now(),
         updated_at = pg_catalog.now()
   where c.agent_id = p_agent_id
     and c.history_version = p_expected
  returning c.history_version into v_version;

  if found then
    return v_version;
  end if;

  if coalesce(p_expected, 0) = 0
     and not exists (
       select 1 from public.whatsapp_conversations c
        where c.agent_id = p_agent_id
     ) then
    begin
      insert into public.whatsapp_conversations (
        agent_id, wa_phone, history, history_version,
        last_property_id, last_client_id, last_message_at, updated_at
      ) values (
        p_agent_id,
        coalesce(nullif(btrim(p_phone), ''), 'unknown'),
        coalesce(p_history, '[]'::jsonb),
        1,
        p_last_property_id,
        p_last_client_id,
        pg_catalog.now(),
        pg_catalog.now()
      )
      returning history_version into v_version;
      return v_version;
    exception when unique_violation then
      return 0;
    end;
  end if;

  return 0;
end;
$$;

comment on function public.whatsapp_history_cas(uuid, text, integer, jsonb, uuid, uuid) is
  'כותב/ת היסטוריה רק אם history_version לא זז. 0 = התנגשות, והקורא/ת מוסיף/ה רק את הרשומות שלו/ה.';

revoke all on function public.whatsapp_history_cas(uuid, text, integer, jsonb, uuid, uuid) from public, anon, authenticated;
grant execute on function public.whatsapp_history_cas(uuid, text, integer, jsonb, uuid, uuid) to service_role;

-- הוספה אטומית (צוות הטמעה, שיחת טלפון). לא מזיזה את last_message_at.
create or replace function public.whatsapp_history_append(
  p_agent_id uuid,
  p_entries jsonb
) returns void
language plpgsql
set search_path to ''
as $$
begin
  update public.whatsapp_conversations c
     set history = public.whatsapp_history_merge_append(c.history, p_entries),
         history_version = c.history_version + 1,
         updated_at = pg_catalog.now()
   where c.agent_id = p_agent_id;
end;
$$;

comment on function public.whatsapp_history_append(uuid, jsonb) is
  'מוסיף/ה הודעות להיסטוריית הסוכן/ת בלי לקרוא-ולכתוב, גוזר/ת ל-12, ומקדם/ת history_version.';

revoke all on function public.whatsapp_history_append(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.whatsapp_history_append(uuid, jsonb) to service_role;

-- אותה הצמדה כמו 20271031100000, ועכשיו גם גרסה וסמן בסוף.
create or replace function public.whatsapp_ops_history_append(
  p_agent uuid,
  p_phone text,
  p_last_inbound timestamptz,
  p_entries jsonb
) returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  insert into public.whatsapp_conversations (
    agent_id, wa_phone, history, history_version, last_message_at
  ) values (
    p_agent,
    p_phone,
    coalesce(p_entries, '[]'::jsonb),
    1,
    coalesce(p_last_inbound, pg_catalog.now())
  )
  on conflict (agent_id) do update
     set history = public.whatsapp_history_merge_append(
           public.whatsapp_conversations.history,
           coalesce(excluded.history, '[]'::jsonb)
         ),
         history_version = public.whatsapp_conversations.history_version + 1;
end;
$$;

comment on function public.whatsapp_ops_history_append(uuid, text, timestamptz, jsonb) is
  'מוסיף/ה זוג הודעות של שאלה תפעולית. עדכון אטומי, בלי לשנות את last_message_at, עם קידום history_version.';

revoke all on function public.whatsapp_ops_history_append(uuid, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.whatsapp_ops_history_append(uuid, text, timestamptz, jsonb) to service_role;
