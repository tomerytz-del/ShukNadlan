-- ============================================================================
-- "שליחת קישור" לדוח CMA מה-CRM
--
-- ## מה היה
--
-- הקישור לדף הדוח (‏/cma?k=, ‏cma_links, 20270820090000) נוצר רק בגבריאלה:
-- ‏cma_link_create פתוחה ל-service_role בלבד. סוכן/ת שהפיק/ה דוח ב-CRM יכול/ה
-- היה/הייתה רק להדפיס אותו ל-PDF ולשלוח קובץ.
--
-- ## מה כאן
--
-- ‏cma_link_share - לסוכן/ת המחובר/ת. **הדוח מחושב כאן מחדש ולא מתקבל
-- מהדפדפן**: הדף מציג אותו בשם המשרד ועם פרטי הסוכן/ת, ולכן מה שנשמר הוא
-- מה שהמסד הפיק - אותן פונקציות ואותו גייט מסלול כמו cma_report (נכס,
-- ‏PROFESSIONAL ומעלה) ו-cma_report_address (כתובת, Elite). הסוכן/ת שמזהה
-- את עצמו/ה הוא current_agent_id(), כמו בשתיהן.
--
-- מהדפדפן מגיעים רק שמות המאפיינים (‏p_feature_labels), כמו ש-cmaButton
-- בגבריאלה שומרת אותם: בדף אין את הרשימות של ה-CRM. נשמרים רק שמות של
-- מאפיינים שבדוח עצמו (‏subject.features), כמחרוזת של עד 60 תווים.
--
-- התקרה היומית (40) והגודל - של cma_link_create, משותפים לגבריאלה.
-- ============================================================================

create or replace function public.cma_link_share(
  p_property_id    uuid  default null,
  p_address        jsonb default null,
  p_feature_labels jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_agent  uuid := public.current_agent_id();
  v_rep    jsonb;
  v_labels jsonb;
  v_id     text;
  v_exp    timestamptz;
  v_feats  text[];
begin
  if v_agent is null then
    return jsonb_build_object('error', 'no_matching_agent_profile');
  end if;

  if p_property_id is not null then
    v_rep := public.agent_cma_report_full(v_agent, p_property_id);
  elsif jsonb_typeof(p_address) = 'object' then
    if jsonb_typeof(p_address->'features') = 'array' then
      select array_agg(x) into v_feats from jsonb_array_elements_text(p_address->'features') x;
    end if;
    v_rep := public.agent_cma_report_address(v_agent,
      p_address->>'city', p_address->>'street', nullif(p_address->>'house_number', ''),
      coalesce(nullif(p_address->>'property_type', ''), 'דירה'),
      nullif(p_address->>'rooms', '')::numeric,
      nullif(p_address->>'size_sqm', '')::numeric,
      nullif(p_address->>'floor', '')::integer,
      nullif(p_address->>'price', '')::numeric,
      v_feats,
      nullif(p_address->>'lat', '')::double precision,
      nullif(p_address->>'lng', '')::double precision);
  else
    return jsonb_build_object('error', 'bad_request');
  end if;

  if v_rep is null or jsonb_typeof(v_rep) <> 'object' then
    return jsonb_build_object('error', 'report_failed');
  end if;
  if v_rep ? 'error' then
    return v_rep;
  end if;

  if jsonb_typeof(v_rep->'subject') = 'object' then
    select coalesce(jsonb_object_agg(f, p_feature_labels->>f), '{}'::jsonb)
      into v_labels
      from jsonb_array_elements_text(
             case when jsonb_typeof(v_rep#>'{subject,features}') = 'array'
                  then v_rep#>'{subject,features}' else '[]'::jsonb end) f
     where jsonb_typeof(p_feature_labels->f) = 'string'
       and char_length(p_feature_labels->>f) between 1 and 60;
    v_rep := jsonb_set(v_rep, '{subject,feature_labels}', v_labels, true);
  end if;

  v_id := public.cma_link_create(v_agent, v_rep, p_property_id);
  if v_id is null then
    return jsonb_build_object('error', 'link_limit',
      'detail', 'לא ניתן ליצור קישור כרגע - אפשר עד 40 קישורים לדוח ביום. בינתיים אפשר לשמור את הדוח כ-PDF.');
  end if;
  select expires_at into v_exp from public.cma_links where id = v_id;
  return jsonb_build_object('id', v_id, 'expires_at', v_exp);
end;
$$;

comment on function public.cma_link_share(uuid, jsonb, jsonb) is
  'קישור לדוח CMA מה-CRM (/cma?k=). הדוח מחושב מחדש במסד (cma_report / cma_report_address), לא מתקבל מהדפדפן. docs/cma.md.';

revoke all on function public.cma_link_share(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.cma_link_share(uuid, jsonb, jsonb) to authenticated, service_role;
