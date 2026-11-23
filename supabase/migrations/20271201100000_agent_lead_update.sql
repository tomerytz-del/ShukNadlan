-- ============================================================================
-- עריכת ליד שכבר נשמר ב"הלידים שלי", מגבריאלה (הכלי update_lead).
--
-- version 20271201100000: מעל 20271130120000 שב-main.
--
-- מה שבור היום: סוכן/ת שהזין/ה (או ייבא/ה) לידים בלי עיר, עם טלפון שגוי או עם שם חסר
-- ביקש/ה מגבריאלה לתקן, והיא ענתה "את העיר בליד שכבר נשמר אני לא יכולה לשנות מכאן".
-- יש `add_lead` ו-`list_leads`, ואין שום דבר שכותב לליד קיים.
--
-- agent_lead_update(p_agent_id, p_lead_id, p) - רק ל-service_role, נקראת מהכלי update_lead
-- ב-whatsapp-webhook שמעביר את ctx.agent.id. שלושה כללים שמגבילים אותה בכוונה:
--   1. **רק ליד של הסוכן/ת עצמו/ה** (agent_id), ובנעילת שורה.
--   2. **רק ליד שהסוכן/ת הזין/ה בעצמו/ה (source = 'agent_entered')**. לידים מהאתר, מיד2,
--      מהחנות ומשיחות נושאים את מה שהפונה מסר, ולידים מהחנות שולמו על פרטים מסוימים.
--      עריכה שלהם משנה ראיה ולא מתקנת טעות הקלדה.
--   3. **רק ליד פתוח (status = 'unlocked')**. ליד נעול מוסתר ב-leads_masked.
-- רק מפתחות שנשלחו משתנים. מחרוזת ריקה מנקה שדה, חוץ מהשם והטלפון: אחד מהם חייב להישאר.
-- שינוי טלפון שמתנגש בליד פתוח אחר של אותו/ה סוכן/ת, אותו סוג, ב-30 יום, מחזיר duplicate
-- ולא משנה (אותו כלל כמו agent_lead_add, אחרת הכפילות נכנסת דרך העריכה).
-- phone_e164 עמודה מחושבת מ-raw_phone, ואין טריגר שמגיב לעריכה (leads_first_response
-- נוגע רק בפתיחה של ליד ממוסך). לא נכתבת התראה: זו תוצאה של בקשה שהסוכן/ת עצמו/ה ביקש/ה.
--
-- אידמפוטנטית.
-- ============================================================================

create or replace function public.agent_lead_update(p_agent_id uuid, p_lead_id uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l          record;
  v_changed  text[];
  v_name     text;
  v_phone    text;
  v_e164     text;
  v_rooms    numeric;
  v_dup      record;
  v_active   boolean;
  v_details  text;
begin
  select m.active into v_active from public.agency_members m where m.id = p_agent_id;
  if v_active is not true then
    return jsonb_build_object('success', false, 'error', 'agent_not_found');
  end if;

  select * into l from public.leads where id = p_lead_id for update;
  if not found or l.agent_id is distinct from p_agent_id then
    return jsonb_build_object('success', false, 'error', 'lead_not_found');
  end if;
  if l.source is distinct from 'agent_entered' then
    return jsonb_build_object('success', false, 'error', 'not_editable', 'source', l.source);
  end if;
  if l.status <> 'unlocked' then
    return jsonb_build_object('success', false, 'error', 'locked');
  end if;
  -- ארכיון הוא שלב סופי (docs/lead-card.md): ליד שהוצא מהעבודה אינו נערך
  if exists (select 1 from public.lead_archives a where a.lead_id = l.id) then
    return jsonb_build_object('success', false, 'error', 'archived');
  end if;

  v_name  := l.raw_name;
  v_phone := l.raw_phone;

  if p ? 'full_name' then
    v_name := left(nullif(btrim(p ->> 'full_name'), ''), 80);
  end if;
  if p ? 'phone' then
    v_phone := left(nullif(btrim(p ->> 'phone'), ''), 40);
  end if;
  if v_name is null and v_phone is null then
    return jsonb_build_object('success', false, 'error', 'name_or_phone_required');
  end if;
  -- טלפון שאינו מספר (קצר מדי, או בלי ספרות) לא נשמר: הוא לא ייתפס בכפילות ולא יישלח אליו כלום
  if p ? 'phone' and v_phone is not null and public.normalize_msisdn(v_phone) is null then
    return jsonb_build_object('success', false, 'error', 'bad_phone');
  end if;

  if p ? 'rooms' then
    begin
      v_rooms := nullif(btrim(p ->> 'rooms'), '')::numeric;
    exception when others then
      return jsonb_build_object('success', false, 'error', 'bad_rooms');
    end;
    if v_rooms is not null and (v_rooms <= 0 or v_rooms > 50) then
      return jsonb_build_object('success', false, 'error', 'bad_rooms');
    end if;
  else
    v_rooms := l.rooms;
  end if;

  if p ? 'deal_type' and nullif(btrim(p ->> 'deal_type'), '') is not null
     and (p ->> 'deal_type') not in ('sale', 'rent') then
    return jsonb_build_object('success', false, 'error', 'bad_deal_type');
  end if;

  if not (p ?| array['full_name', 'phone', 'city', 'deal_type', 'property_type', 'rooms', 'notes', 'details']) then
    return jsonb_build_object('success', false, 'error', 'nothing_to_update');
  end if;

  -- שורת פרטי הנכס: ‏`details` מחליפה אותה כולה. שינוי חדרים בלבד מעדכן רק את הקטע "N חדרים"
  -- שבה (agent_lead_add כתבה אותו), כדי שהכרטיס לא יסתור את עצמו.
  v_details := l.property_details;
  if p ? 'details' then
    v_details := left(nullif(btrim(p ->> 'details'), ''), 500);
  elsif p ? 'rooms' then
    if v_details ~ '(^| · )[0-9]+(\.[0-9]+)? חדרים( · |$)' then
      select nullif(string_agg(case when t.s ~ '^[0-9]+(\.[0-9]+)? חדרים$'
                                    then case when v_rooms is null then null else trim_scale(v_rooms)::text || ' חדרים' end
                                    else t.s end, ' · ' order by t.ord), '')
        into v_details
        from unnest(string_to_array(v_details, ' · ')) with ordinality as t(s, ord);
    elsif v_rooms is not null then
      v_details := concat_ws(' · ', v_details, trim_scale(v_rooms)::text || ' חדרים');
    end if;
  end if;

  -- כפילות: רק כשהטלפון באמת משתנה למספר אחר
  v_e164 := public.normalize_msisdn(v_phone);
  if p ? 'phone' and v_e164 is not null and v_e164 is distinct from public.normalize_msisdn(l.raw_phone) then
    perform pg_advisory_xact_lock(hashtext(p_agent_id::text || ':' || v_e164));
    select d.id, d.raw_name, d.created_at into v_dup
      from public.leads d
     where d.agent_id = p_agent_id
       and d.id <> l.id
       and d.phone_e164 = v_e164
       and d.lead_type = l.lead_type
       and d.created_at > now() - interval '30 days'
       and not exists (select 1 from public.lead_archives a where a.lead_id = d.id)
       and not exists (select 1 from public.lead_work w
                        where w.lead_id = d.id and w.agent_id = p_agent_id
                          and w.stage in ('not_relevant', 'won'))
     order by d.created_at desc
     limit 1;
    if found then
      return jsonb_build_object('success', false, 'duplicate', true,
                                'lead_id', v_dup.id, 'full_name', v_dup.raw_name,
                                'created_at', v_dup.created_at);
    end if;
  end if;

  update public.leads set
    raw_name         = v_name,
    raw_phone        = v_phone,
    rooms            = v_rooms,
    city             = case when p ? 'city' then left(nullif(btrim(p ->> 'city'), ''), 80) else city end,
    deal_type        = case when p ? 'deal_type' then nullif(btrim(p ->> 'deal_type'), '') else deal_type end,
    property_type    = case when p ? 'property_type' then left(nullif(btrim(p ->> 'property_type'), ''), 60) else property_type end,
    raw_message      = case when p ? 'notes' then left(nullif(btrim(p ->> 'notes'), ''), 4000) else raw_message end,
    property_details = v_details
   where id = l.id;

  select coalesce(array_agg(k order by k), '{}') into v_changed
    from unnest(array['full_name', 'phone', 'city', 'deal_type', 'property_type', 'rooms', 'notes', 'details']) k
   where p ? k;

  return jsonb_build_object('success', true, 'lead_id', l.id, 'changed', to_jsonb(v_changed));
end;
$$;

revoke all on function public.agent_lead_update(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.agent_lead_update(uuid, uuid, jsonb) to service_role;

comment on function public.agent_lead_update(uuid, uuid, jsonb) is
  'עריכת ליד שהסוכן/ת הזין/ה בעצמו/ה (source agent_entered), פתוח ושל הסוכן/ת בלבד. רק מפתחות שנשלחו משתנים. כפילות טלפון מחזירה duplicate. service_role בלבד. נקראת מ-update_lead ב-whatsapp-webhook. docs/leads-unified.md';
