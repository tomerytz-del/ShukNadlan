-- ============================================================================
-- ליד שהסוכן/ת מזין/ה בעצמו/ה (מייל או גבריאלה בוואטסאפ) נכנס ל"לידים שלי"
--
-- version 20271117090000: מעל 20271116133000 שב-main.
--
-- מה שבור היום: "ליד חדש מוכרים / צבי חכמון / 052... / סביון 9" שסוכן/ת שולח/ת
-- לגבריאלה (בוואטסאפ או במייל) נשמר ב-create_client כלקוח/ה ב-agent_clients,
-- ולא נכנס ל-leads - כלומר לא מופיע ב"הלידים שלי", אין לו שלב, ארכיון או
-- מקום בדאשבורד. אין בגבריאלה שום כלי שכותב ל-leads.
--
-- מה נכנס:
--   1. agent_lead_add(p_agent_id, p) - ‏insert אחד ל-leads, רק ל-service_role
--      (נקרא מכלי add_lead ב-whatsapp-webhook, שמעביר את ctx.agent.id).
--      הליד הוא lead_type 'owner_inbound' (מוכר/משכיר) או 'seeker_inbound'
--      (מחפש/ת), source = 'agent_entered', נולד פתוח (status 'unlocked') ושל
--      הסוכן/ת בלבד. בלי חיוב ובלי מכסה: הוא הזין אותו בעצמו.
--      ‏first_response_at = created_at: מי שהזין/ה ליד כבר מכיר/ה את הפונה,
--      וליד שנולד "ללא מענה" היה מקפיץ באנר דחוף על אדם שאינו ממתין. אותו
--      כלל כמו שיחה שנענתה (docs/leads-unified.md).
--      כפילות: אותו טלפון אצל אותו/ה סוכן/ת, אותו סוג, ב-30 הימים האחרונים,
--      ליד שאינו בארכיון ולא נסגר - לא נוצר שני, והתשובה אומרת מי הקיים.
--   2. notify_agent_on_new_lead - על ליד שהסוכן/ת הזין/ה בעצמו/ה נכתבת
--      התראה בפעמון בלבד ("הליד נקלט", עם קישור לליד), עם suppress_push = true:
--      התשובה של גבריאלה כבר אישרה את זה בוואטסאפ, והודעה שנייה מיד אחריה
--      (בנוסח "ליד חדש: בעל נכס") נקראת כליד שהגיע מבחוץ. זה העתק מדויק של
--      הגוף שבפרודקשן (md5 1745fd22d26e883b738eb5f353e3b5b3) בתוספת ענף אחד.
--
-- ‏leads_lead_type_check אינו משתנה: שני הסוגים כבר ברשימה. ‏leads.source הוא
-- טקסט חופשי, בלי אילוץ.
--
-- אידמפוטנטית.
-- ============================================================================

-- 1. הגוף שבפרודקשן + תנאי אחד: ליד שהוזן ידנית אינו מתריע
create or replace function public.notify_agent_on_new_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_body  text;
  v_where text;
begin
  if new.agent_id is null then
    return new;
  end if;
  -- 20270712090000: על שיחה כבר יוצא סיכום בוואטסאפ, ורכישה נעשתה הרגע בלחיצה
  if new.lead_type in ('call', 'store') then
    return new;
  end if;
  -- 20271117090000: הסוכן/ת הזין/ה את הליד בעצמו/ה - אישור בפעמון בלבד, בלי
  -- דחיפה לוואטסאפ (גבריאלה כבר אישרה שם). הקישור פותח את הליד עצמו.
  if new.source = 'agent_entered' then
    insert into public.notifications (agent_id, type, title, body, related_lead_id, suppress_push)
    values (new.agent_id, 'new_lead', 'הליד נקלט',
            left(concat_ws(' · ', nullif(new.raw_name, ''), nullif(new.property_details, ''),
                           case new.deal_type when 'sale' then 'מכירה' when 'rent' then 'השכרה' end), 200),
            new.id, true);
    return new;
  end if;

  v_title := case new.lead_type
    when 'owner_inbound'         then 'ליד חדש: בעל נכס'
    when 'property_inquiry'      then 'ליד חדש: התעניינות בנכס'
    when 'agent_direct_inquiry'  then 'ליד חדש: פנייה ישירה אליך'
    -- 20270812090000: פוסט בפייסבוק של מי שמחפש/ת, אחרי שהסכים/ה שנחזור
    when 'seeker_inbound'        then 'ליד חדש: מחפש/ת נכס'
    else 'ליד חדש'
  end;

  v_where := coalesce(nullif(new.city, ''), 'עפולה');
  v_body := v_where
    || coalesce(' · ' || nullif(new.property_type, ''), '')
    || case new.deal_type when 'sale' then ' · מכירה' when 'rent' then ' · השכרה' else '' end
    || case when new.status = 'unlocked' then ' · פתוח' else ' · ממתין לפתיחה' end;

  -- suppress_push מפורש (false): ליד מבחוץ חייב להגיע לוואטסאפ, וזה מה
  -- ש-check_notification_backfill דורש מכל insert להצהיר עליו
  insert into public.notifications (agent_id, type, title, body, related_lead_id, suppress_push)
  values (new.agent_id, 'new_lead', v_title, v_body, new.id, false);

  return new;
end;
$$;

revoke all on function public.notify_agent_on_new_lead() from public, anon, authenticated;

-- 2. ‏agent_lead_add
create or replace function public.agent_lead_add(p_agent_id uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agency   uuid;
  v_type     text;
  v_deal     text;
  v_name     text := left(nullif(btrim(p ->> 'full_name'), ''), 80);
  v_phone    text := left(nullif(btrim(p ->> 'phone'), ''), 40);
  v_e164     text := public.normalize_msisdn(nullif(btrim(p ->> 'phone'), ''));
  v_city     text := left(nullif(btrim(p ->> 'city'), ''), 80);
  v_ptype    text := left(nullif(btrim(p ->> 'property_type'), ''), 60);
  v_rooms    numeric;
  v_details  text;
  v_message  text := left(nullif(btrim(p ->> 'notes'), ''), 4000);
  v_dup      record;
  v_id       uuid;
begin
  select m.agency_id into v_agency
    from public.agency_members m
   where m.id = p_agent_id and m.active;
  if not found then
    return jsonb_build_object('success', false, 'error', 'agent_not_found');
  end if;

  v_type := case p ->> 'kind' when 'seeker' then 'seeker_inbound' else 'owner_inbound' end;
  v_deal := case when (p ->> 'deal_type') in ('sale', 'rent') then p ->> 'deal_type' end;

  if v_name is null and v_phone is null then
    return jsonb_build_object('success', false, 'error', 'name_or_phone_required');
  end if;

  begin
    v_rooms := nullif(btrim(p ->> 'rooms'), '')::numeric;
  exception when others then
    v_rooms := null;
  end;
  if v_rooms is not null and (v_rooms <= 0 or v_rooms > 50) then
    v_rooms := null;
  end if;

  -- כתובת, קומה, חדרים ורצינות - מה שמתאר את הצורך, בשורה אחת לכרטיס
  v_details := left(nullif(concat_ws(' · ',
      nullif(btrim(p ->> 'address'), ''),
      case when nullif(btrim(p ->> 'floor'), '') is not null then 'קומה: ' || btrim(p ->> 'floor') end,
      case when v_rooms is not null then trim_scale(v_rooms)::text || ' חדרים' end,
      case when nullif(btrim(p ->> 'seriousness'), '') is not null then 'רצינות: ' || btrim(p ->> 'seriousness') end
    ), ''), 500);

  -- כפילות: אותו טלפון, אותו סוג, 30 יום, לא בארכיון ולא נסגר
  if v_e164 is not null and coalesce((p ->> 'force_new')::boolean, false) is not true then
    select l.id, l.raw_name, l.created_at into v_dup
      from public.leads l
     where l.agent_id = p_agent_id
       and l.phone_e164 = v_e164
       and l.lead_type = v_type
       and l.created_at > now() - interval '30 days'
       and not exists (select 1 from public.lead_archives a where a.lead_id = l.id)
       and not exists (select 1 from public.lead_work w
                        where w.lead_id = l.id and w.agent_id = p_agent_id
                          and w.stage in ('not_relevant', 'won'))
     order by l.created_at desc
     limit 1;
    if found then
      return jsonb_build_object('success', false, 'duplicate', true,
                                'lead_id', v_dup.id, 'full_name', v_dup.raw_name,
                                'created_at', v_dup.created_at);
    end if;
  end if;

  insert into public.leads (
    lead_type, agent_id, agency_id, status, unlocked_at, unlocked_by, first_response_at,
    raw_name, raw_phone, raw_message, city, deal_type, property_type, rooms, property_details,
    source, source_detail
  )
  values (
    v_type, p_agent_id, v_agency, 'unlocked', now(), p_agent_id, now(),
    v_name, v_phone, v_message, v_city, v_deal, v_ptype, v_rooms, v_details,
    'agent_entered', 'הוזן על ידך'
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'lead_id', v_id, 'lead_type', v_type);
end;
$$;

revoke all on function public.agent_lead_add(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.agent_lead_add(uuid, jsonb) to service_role;

comment on function public.agent_lead_add(uuid, jsonb) is
  'ליד שהסוכן/ת הזין/ה בגבריאלה (וואטסאפ או מייל): שורה ב-leads, source agent_entered, פתוח ושל הסוכן/ת בלבד, בלי חיוב ובלי התראה. כפילות לפי טלפון ב-30 יום מחזירה duplicate. service_role בלבד. docs/leads-unified.md';
