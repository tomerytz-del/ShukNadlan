-- הרילס היומי לא נשמר בדף הנכס: attach_daily_reel נכשלת על webhook_token.
--
-- ‏property_video_jobs.webhook_token הוא not null (20261004090000), וה-insert
-- של שורת התיעוד ב-attach_daily_reel (20270809090000) לא מילא אותו. ה-insert
-- נכשל, והפונקציה כולה מתגלגלת אחורה - כולל ה-update של video_url - ולכן
-- ‏reel-producer?action=daily_attach החזירה 500 ‏(db_error) על כל רילס יומי:
-- הוא עלה לפייסבוק ולאינסטגרם, לא נשמר בדף הנכס, והסוכן/ת לא קיבל/ה התראה.
--
-- התיקון: טוקן אקראי של 64 תווים, כמו בשאר השורות (property-video-create).
-- לשורה הזו אין callback, אבל ערך קבוע היה הופך לסיסמה ידועה של
-- ‏property-video-callback לשורה. שאר הגוף זהה לגרסה שרצה בפרודקשן
-- ‏(md5 של prosrc נבדק מול 20270809090000 לפני השינוי).

create or replace function public.attach_daily_reel(
  p_property_id uuid,
  p_result_url  text,
  p_cover_url   text,
  p_published   jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prop        public.properties%rowtype;
  v_agent_reel  boolean;
  v_job_id      uuid;
  v_links       text := '';
  v_item        record;
begin
  select * into v_prop from public.properties where id = p_property_id for update;
  if not found then
    return jsonb_build_object('error', 'property_not_found');
  end if;
  if v_prop.agent_id is null then
    return jsonb_build_object('error', 'no_agent');
  end if;

  if exists (
    select 1 from public.property_video_jobs
     where property_id = p_property_id
       and status in ('pending_reel', 'rendering', 'generating_clips', 'merging', 'uploading')
  ) then
    return jsonb_build_object('attached', false, 'reason', 'job_in_progress');
  end if;

  if v_prop.video_url is not null then
    v_agent_reel :=
      (v_prop.video_url ~ '/marketing-reel-[^/?]*(\?.*)?$' and v_prop.video_url !~ '/marketing-reel-daily-[^/?]*(\?.*)?$')
      or exists (
        select 1 from public.property_video_jobs
         where status = 'done' and result_url = v_prop.video_url
           and producer in ('grok_reel', 'site_reel')
      );
    if v_agent_reel or not public.property_video_is_system(v_prop.video_url) then
      return jsonb_build_object('attached', false, 'reason', 'agent_video_exists');
    end if;
  end if;

  update public.properties
     set video_url = p_result_url, video_poster_url = p_cover_url
   where id = p_property_id;

  insert into public.property_video_jobs (
    property_id, agent_id, status, tier_at_request, amount_charged, clip_seconds,
    aspect_ratio, webhook_token, previous_video_url, replaced_existing, producer, template,
    claimed_by, result_url, cover_url, published_urls
  ) values (
    p_property_id, v_prop.agent_id, 'done', 'daily', 0, 0,
    -- ‏webhook_token הוא not null. לרילס היומי אין callback, אבל הערך חייב
    -- להיות אקראי ולא קבוע: הוא עדיין הסיסמה של property-video-callback לשורה.
    '9:16', encode(extensions.gen_random_bytes(32), 'hex'),
    v_prop.video_url, v_prop.video_url is not null, 'grok_daily', 'D',
    'grok_daily', p_result_url, p_cover_url, p_published
  )
  returning id into v_job_id;

  -- הקישורים לפרסומים, אחד בשורה. רק http(s), ורק מחרוזות.
  if jsonb_typeof(p_published) = 'object' then
    for v_item in select key, value from jsonb_each(p_published) loop
      if jsonb_typeof(v_item.value) = 'string' and (v_item.value #>> '{}') ~ '^https?://' then
        v_links := v_links || E'\n' || v_item.key || ': ' || (v_item.value #>> '{}');
      end if;
    end loop;
  elsif jsonb_typeof(p_published) = 'array' then
    for v_item in select value from jsonb_array_elements(p_published) loop
      if jsonb_typeof(v_item.value) = 'string' and (v_item.value #>> '{}') ~ '^https?://' then
        v_links := v_links || E'\n' || (v_item.value #>> '{}');
      end if;
    end loop;
  end if;

  insert into public.notifications (agent_id, type, title, body, related_property_id)
  values (
    v_prop.agent_id,
    'marketing_copy',
    'רילס חדש לנכס: ' || coalesce(v_prop.title, 'נכס'),
    'הכנו לנכס שלך רילס שיווקי ופרסמנו אותו בעמודי שוק הנדל״ן. הוא שמור עכשיו בדף הנכס.' || v_links,
    p_property_id
  );

  return jsonb_build_object(
    'attached', true,
    'job_id', v_job_id,
    'previous_video_url', v_prop.video_url,
    'previous_poster_url', v_prop.video_poster_url
  );
end;
$$;
revoke execute on function public.attach_daily_reel(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.attach_daily_reel(uuid, text, text, jsonb) to service_role;
