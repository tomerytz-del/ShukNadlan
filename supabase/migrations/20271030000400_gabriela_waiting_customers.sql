-- לקוחות של הבוט הציבורי שמחכים אחרי מענה חלופי.
--
-- קריאה בלבד, ל-service_role. אין כאן שליחה, אין טלפון ואין גוף הודעה
-- בתוצאה. הטלפון משמש רק בתוך החיבור ליומן.
--
-- שורה אחת לשיחה: המענה החלופי האחרון ב-48 השעות. הוא נכנס רק אם עברו
-- שעתיים מאז, ולא יצאה אחריו שום תשובה אמיתית. תשובה אחרי יותר משעתיים
-- מורידה את השיחה. מענה צעיר משעתיים עוד לא נספר.
--
-- תשובה אמיתית היא הודעה יוצאת של הבוט הציבורי (agent_id ריק, בלי שגיאה,
-- ולא status = failed) שאינה אחד משני הנוסחים המאושרים. מזהה ההודעה של
-- המענה נודע רק אחרי השליחה, אחרי ש-gabriela_llm_fallback_log כבר נרשם,
-- ולכן הזיהוי כאן הוא לפי הנוסח המדויק ולא לפי חלון של שתי דקות.

create or replace function public.gabriela_waiting_customers()
returns table (
  conversation_id uuid,
  fallback_at timestamptz,
  window_open boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with latest as (
    select distinct on (f.conversation_id)
           f.conversation_id,
           f.created_at as fallback_at
      from public.gabriela_llm_fallbacks f
     where f.channel = 'public'
       and f.sent
       and f.created_at > now() - interval '48 hours'
     order by f.conversation_id, f.created_at desc
  )
  select
    l.conversation_id,
    l.fallback_at,
    coalesce((
      select max(inn.created_at)
        from public.whatsapp_messages inn
       where inn.wa_phone = c.wa_phone
         and inn.direction = 'in'
    ), '-infinity'::timestamptz) > now() - interval '24 hours' as window_open
  from latest l
  join public.whatsapp_public_conversations c
    on c.id = l.conversation_id
  where l.fallback_at <= now() - interval '2 hours'
    and not exists (
      select 1
        from public.whatsapp_messages m
       where m.wa_phone = c.wa_phone
         and m.direction = 'out'
         and m.agent_id is null
         and m.created_at > l.fallback_at
         and coalesce(m.error, '') = ''
         and coalesce(m.status, '') <> 'failed'
         and coalesce(m.body, '') not in (
           'סליחה, משהו השתבש אצלי רגע לפני שעניתי. אפשר לשלוח לי את ההודעה שוב?',
           'סליחה, אני לא זמינה כרגע בגלל תקלה אצלי. אפשר לנסות שוב מאוחר יותר, או לחפש נכסים באתר בינתיים: https://shuknadlan.co.il'
         )
    )
  order by l.fallback_at;
$$;

comment on function public.gabriela_waiting_customers() is
  'שיחה אחת: המענה החלופי האחרון ב-48 שעות, אם עברו שעתיים ואין אחריו תשובת בוט. מזהה שיחה, זמן המענה, וחלון 24 השעות. בלי טלפון ובלי גוף. service_role בלבד.';

revoke all on function public.gabriela_waiting_customers() from public, anon, authenticated;
grant execute on function public.gabriela_waiting_customers() to service_role;
