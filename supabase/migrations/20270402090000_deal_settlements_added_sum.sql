-- ===========================================================================
-- "נוספו" במסך היישובים: סכום ההרצה, לא המנה האחרונה
-- ===========================================================================
--
-- ‏upsert_deals (‏20270401090000) כתבה ל-deal_settlements.deals_added את מה
-- שנוסף **בקריאה הנוכחית**. הסוכן שולח יישוב גדול בעשרות מנות של כ-10
-- שורות, ולכן בהרצה הראשונה (9.10.2026) חיפה הציגה "נוספו 11" אחרי שנוספו
-- לה כ-376. הסיכום של ההרצה (‏deal_sync_runs.items) סכם נכון כל הזמן.
--
-- מעכשיו מנה שאינה הראשונה של היישוב בהרצה הפתוחה מוסיפה לספירה. והערכים
-- שכבר נשמרו מתוקנים מ-items של ההרצה האחרונה שבה היישוב הופיע.
--
-- ‏docs/settlement-deals.md. אידמפוטנטית.
-- ===========================================================================

create or replace function public.upsert_deals(p_settlement text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- LRM, RLM, LRE..RLO, LRI..PDI
  c_bidi     constant text := chr(8206) || chr(8207) || chr(8234) || chr(8235)
                              || chr(8236) || chr(8237) || chr(8238) || chr(8294)
                              || chr(8295) || chr(8296) || chr(8297);
  v_set      public.deal_settlements%rowtype;
  v_run      uuid;
  v_sync     bigint;
  v_claimed  uuid[];
  v_raw      jsonb;
  v_row      jsonb;
  v_added    int := 0;
  v_updated  int := 0;
  v_same     int := 0;
  v_rejected jsonb := '[]'::jsonb;
  v_reason   text;
  v_addr     text;
  v_street   text;
  v_house    text;
  v_gh       text[];
  v_gush     text;
  v_helka    text;
  v_tat      text;
  v_date_t   text;
  v_sold     date;
  v_price    numeric;
  v_sqm      numeric;
  v_rooms    numeric;
  v_type     text;
  v_floor    text;
  v_hood     text;
  v_key      text;
  v_match    uuid;
  v_had      boolean;
begin
  if not public.deal_sync_caller_ok() then
    return jsonb_build_object('error', 'forbidden');
  end if;

  select * into v_set from public.deal_settlements where name = btrim(coalesce(p_settlement, ''));
  if not found then
    return jsonb_build_object('error', 'unknown_settlement', 'settlement', p_settlement);
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    return jsonb_build_object('error', 'invalid_payload');
  end if;

  -- ‏"עסקאות ראשונות" בסיכום: היו ליישוב עסקאות לפני ההרצה?
  v_had := exists (select 1 from public.market_deals_official o where o.city = v_set.name);

  -- ‏מה שכבר נספג ביישוב הזה בהרצה הפתוחה - גם במנות קודמות.
  v_sync := public.deal_sync_open_run();
  select coalesce(array(select jsonb_array_elements_text(r.claims -> v_set.name)::uuid), '{}')
    into v_claimed
    from public.deal_sync_runs r where r.id = v_sync;

  insert into public.market_deal_import_runs (city, status, rows_seen)
  values (v_set.name, 'running', jsonb_array_length(p_rows))
  returning id into v_run;

  for v_raw in select * from jsonb_array_elements(p_rows) loop
    v_reason := null;
    v_sold := null; v_price := null; v_sqm := null; v_rooms := null; v_match := null;

    -- ‏שורה כמערך - הפורמט הדחוס של הסוכן:
    -- ‏[gush, helka, tat, date, price, sqm, street, house, neighborhood, type, rooms, floor]
    if jsonb_typeof(v_raw) = 'array' then
      v_row := jsonb_build_object(
        'gush', v_raw->>0, 'helka', v_raw->>1, 'tat_helka', v_raw->>2,
        'deal_date', v_raw->>3, 'price', v_raw->>4, 'area_sqm', v_raw->>5,
        'street', v_raw->>6, 'house_number', v_raw->>7, 'neighborhood', v_raw->>8,
        'property_type', v_raw->>9, 'rooms', v_raw->>10, 'floor', v_raw->>11);
    else
      v_row := v_raw;
    end if;

    -- ‏ריק, "-" ו"אין מידע" הם null. תווי כיווניות נמחקים קודם. שמות השדות
    -- של המפרט (address, deal_date, price...) ושל הסקריפט של הסוכן (street,
    -- sold_at, sale_price...) מתקבלים שניהם.
    v_hood  := nullif(nullif(btrim(translate(coalesce(v_row->>'neighborhood', ''), c_bidi, '')), ''), '-');
    v_type  := nullif(nullif(btrim(translate(coalesce(v_row->>'property_type', ''), c_bidi, '')), ''), '-');
    v_floor := nullif(nullif(btrim(translate(coalesce(v_row->>'floor', ''), c_bidi, '')), ''), '-');

    if v_row ? 'street' or v_row ? 'house_number' then
      v_street := nullif(nullif(nullif(btrim(translate(coalesce(v_row->>'street', ''), c_bidi, '')), ''), '-'), 'אין מידע');
      v_house  := nullif(nullif(btrim(translate(coalesce(v_row->>'house_number', ''), c_bidi, '')), ''), '-');
    else
      v_addr := nullif(nullif(nullif(btrim(translate(coalesce(v_row->>'address', ''), c_bidi, '')), ''), '-'), 'אין מידע');
      v_street := v_addr; v_house := null;
      if v_addr ~ '^.*?\s+[0-9]+[א-ת]?$' then
        v_street := btrim(regexp_replace(v_addr, '\s+[0-9]+[א-ת]?$', ''));
        v_house  := substring(v_addr from '([0-9]+[א-ת]?)$');
      end if;
    end if;

    v_gush  := btrim(translate(coalesce(v_row->>'gush', ''), c_bidi, ''));
    v_helka := btrim(translate(coalesce(v_row->>'helka', ''), c_bidi, ''));
    v_tat   := btrim(translate(coalesce(v_row->>'tat_helka', v_row->>'tat', ''), c_bidi, ''));
    if v_gush = '' and v_row ? 'gush_helka' then
      v_gh := regexp_match(btrim(translate(v_row->>'gush_helka', c_bidi, '')), '^([0-9]+)-([0-9]+)(?:-([0-9]+))?$');
      if v_gh is not null then
        v_gush := v_gh[1]; v_helka := v_gh[2]; v_tat := coalesce(v_gh[3], '');
      end if;
    end if;

    v_date_t := btrim(translate(coalesce(v_row->>'deal_date', v_row->>'sold_at', ''), c_bidi, ''));

    begin
      v_sold := case
        when v_date_t ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then v_date_t::date
        when v_date_t ~ '^[0-9]{2}\.[0-9]{2}\.[0-9]{4}$' then to_date(v_date_t, 'DD.MM.YYYY')
        else null end;
      v_price := nullif(regexp_replace(translate(coalesce(v_row->>'price', v_row->>'sale_price', ''), c_bidi, ''), '[,₪\s]', '', 'g'), '')::numeric;
      v_sqm   := nullif(nullif(regexp_replace(translate(coalesce(v_row->>'area_sqm', v_row->>'size_sqm', ''), c_bidi, ''), '[,\s]', '', 'g'), ''), '-')::numeric;
      v_rooms := nullif(nullif(regexp_replace(translate(coalesce(v_row->>'rooms', ''), c_bidi, ''), '\s', '', 'g'), ''), '-')::numeric;
    exception when others then
      v_reason := 'ערך מספרי או תאריך לא תקין';
    end;

    if v_reason is null then
      v_reason := case
        when v_gush !~ '^[0-9]+$' or v_helka !~ '^[0-9]+$' then 'גוש או חלקה לא תקינים'
        when v_tat <> '' and v_tat !~ '^[0-9]+$'           then 'תת-חלקה לא תקינה'
        when v_sold  is null                  then 'חסר תאריך עסקה'
        when v_sold  > current_date           then 'תאריך עסקה בעתיד'
        when v_sold  < date '1990-01-01'      then 'תאריך עסקה מוקדם מדי'
        when v_price is null or v_price <= 0  then 'מחיר לא תקין'
        when v_price < 10000                  then 'מחיר נמוך באופן חשוד'
        when v_price > 500000000              then 'מחיר גבוה באופן חשוד'
        when v_sqm is not null and v_sqm <= 0 then 'שטח לא תקין'
        when v_rooms is not null and (v_rooms < 0 or v_rooms > 50) then 'מספר חדרים לא תקין'
        else null
      end;
    end if;

    if v_reason is not null then
      v_rejected := v_rejected || jsonb_build_object('row', v_raw, 'reason', v_reason);
      continue;
    end if;

    v_key := 'govmap:' || v_gush || '-' || v_helka || '-' || v_tat || ':'
          || to_char(v_sold, 'YYYY-MM-DD') || ':'
          || trim_scale(v_price)::text || ':'
          || coalesce(trim_scale(v_sqm)::text, '');

    -- ‏ההתאמה לפי ספירה: המפתח המדויק קודם, ואז אותו גוש-חלקה-מחיר-שטח
    -- בהפרש של עד יום - רק שורה שעוד לא ספגה שורה נכנסת בהרצה הזו.
    select o.id into v_match
      from public.market_deals_official o
     where not (o.id = any(v_claimed))
       and (o.external_key = v_key
            or (o.city = v_set.name and o.gush = v_gush and o.helka = v_helka
                and o.sale_price = v_price and o.size_sqm is not distinct from v_sqm
                and abs(o.sold_at - v_sold) <= 1))
     order by (o.external_key = v_key) desc,
              (coalesce(o.raw->>'tat_helka', '') = v_tat) desc,
              abs(o.sold_at - v_sold),
              o.imported_at
     limit 1;

    if v_match is not null then
      v_claimed := v_claimed || v_match;
      -- ‏משלימים שדות ריקים; ערך ריק מהסוכן אינו מוחק ערך קיים. המפתח,
      -- המחיר, השטח והתאריך של השורה הקיימת נשארים.
      update public.market_deals_official t
         set street        = coalesce(v_street, t.street),
             house_number  = coalesce(v_house, t.house_number),
             neighborhood  = coalesce(v_hood, t.neighborhood),
             property_type = coalesce(v_type, t.property_type),
             rooms         = coalesce(v_rooms, t.rooms),
             floor         = coalesce(v_floor, t.floor)
       where t.id = v_match
         and (t.street, t.house_number, t.neighborhood, t.property_type, t.rooms, t.floor)
             is distinct from
             (coalesce(v_street, t.street), coalesce(v_house, t.house_number),
              coalesce(v_hood, t.neighborhood), coalesce(v_type, t.property_type),
              coalesce(v_rooms, t.rooms), coalesce(v_floor, t.floor));
      if found then v_updated := v_updated + 1; else v_same := v_same + 1; end if;
      continue;
    end if;

    -- ‏המפתח המדויק קיים אבל כבר נספג: אותה שורה (כולל תת-חלקה) מופיעה
    -- פעמיים ב-GovMap. זו הצגה כפולה, לא עסקה נוספת.
    if exists (select 1 from public.market_deals_official where external_key = v_key) then
      v_same := v_same + 1;
      continue;
    end if;

    insert into public.market_deals_official
      (external_key, source, city, neighborhood, street, house_number,
       gush, helka, property_type, rooms, size_sqm, floor, sale_price, sold_at, raw)
    values (
      v_key, 'tax_authority', v_set.name, v_hood, v_street, v_house,
      v_gush, v_helka, v_type, v_rooms, v_sqm, v_floor, v_price, v_sold,
      jsonb_build_object('ingest', 'browser_agent', 'portal', 'govmap',
                         'at', now(), 'tat_helka', nullif(v_tat, '')))
    returning id into v_match;
    v_claimed := v_claimed || v_match;
    v_added := v_added + 1;
  end loop;

  update public.deal_sync_runs r
     set claims = r.claims || jsonb_build_object(v_set.name, to_jsonb(v_claimed)),
         updated_at = now()
   where r.id = v_sync;

  -- ‏יישוב גדול מגיע בכמה מנות. אם כבר יש לו מנה מוצלחת בהרצה הפתוחה
  -- (‏items נכתב ב-deal_sync_log אחרי העדכון הזה, ולכן משקף מנות קודמות),
  -- המנה הזו מוסיפה לספירה במקום להחליף אותה - אחרת המסך מציג רק את המנה
  -- האחרונה (חיפה: 11 במקום 376). יישוב שנכשל ונוסה שוב באותה הרצה מתחיל
  -- מאפס, ולא מוסיף על הספירה של ההרצה הקודמת.
  update public.deal_settlements s
     set last_synced_at  = now(),
         last_attempt_at = now(),
         last_status    = case when jsonb_array_length(v_rejected) > 0
                               then 'ok, ' || jsonb_array_length(v_rejected) || ' שורות נדחו'
                               else 'ok' end,
         deals_added    = case when coalesce((r.items -> v_set.name ->> 'ok')::boolean, false)
                               then coalesce(s.deals_added, 0) + v_added else v_added end,
         deals_updated  = case when coalesce((r.items -> v_set.name ->> 'ok')::boolean, false)
                               then coalesce(s.deals_updated, 0) + v_updated else v_updated end
    from public.deal_sync_runs r
   where s.id = v_set.id and r.id = v_sync;

  perform public.deal_sync_log(v_set.name, jsonb_build_object(
    'ok', true, 'added', v_added, 'updated', v_updated, 'unchanged', v_same,
    'rejected', jsonb_array_length(v_rejected),
    'first', (not v_had) and v_added > 0));

  update public.market_deal_import_runs
     set finished_at  = now(),
         status       = 'ok',
         rows_written = v_added + v_updated,
         rows_skipped = v_same + jsonb_array_length(v_rejected),
         error        = case when jsonb_array_length(v_rejected) > 0
                             then jsonb_array_length(v_rejected) || ' rejected (browser_agent)' end
   where id = v_run;

  return jsonb_build_object(
    'added',          v_added,
    'updated',        v_updated,
    'unchanged',      v_same,
    'rejected',       v_rejected,
    'rejected_count', jsonb_array_length(v_rejected));
end $$;

comment on function public.upsert_deals(text, jsonb) is
  'כתיבת עסקאות GovMap של יישוב אחד מסוכן הדפדפן אל market_deals_official, בהתאמה לפי ספירה: כל שורה קיימת סופגת שורה נכנסת אחת בהרצה (מפתח מדויק, או גוש-חלקה-מחיר-שטח ±יום), כי תת-החלקה ב-GovMap אינה יציבה. מנהל/ת, service_role או חיבור ישיר. docs/settlement-deals.md';

revoke all on function public.upsert_deals(text, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_deals(text, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- תיקון הערכים שכבר נשמרו: מההרצה האחרונה שבה כל יישוב מופיע
-- ---------------------------------------------------------------------------
update public.deal_settlements s
   set deals_added   = (x.v->>'added')::int,
       deals_updated = (x.v->>'updated')::int
  from (select distinct on (e.key) e.key, e.value as v
          from public.deal_sync_runs r, jsonb_each(r.items) e
         order by e.key, r.started_at desc) x
 where x.key = s.name
   and (x.v->>'ok')::boolean
   and (s.deals_added, s.deals_updated) is distinct from
       ((x.v->>'added')::int, (x.v->>'updated')::int);
