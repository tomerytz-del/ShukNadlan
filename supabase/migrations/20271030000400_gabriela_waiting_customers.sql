-- לקוחות של הבוט הציבורי שקיבלו מענה חלופי ולא תשובה אמיתית בשעתיים.
--
-- קריאה בלבד, ל-service_role. אין כאן שליחה, אין טלפון ואין גוף הודעה
-- בתוצאה. הטלפון משמש רק בתוך החיבור ליומן, כדי לדעת אם יצאה תשובה
-- ואם חלון 24 השעות של וואטסאפ עדיין פתוח.
--
-- "תשובה אמיתית" היא הודעה יוצאת של הבוט הציבורי (agent_id ריק, בלי
-- שגיאה, ולא status = failed) בחלון (זמן המענה, שעתיים]. השליחה של
-- המענה החלופי עצמו אינה תשובה: היא ההודעה היוצאת הראשונה בשתי הדקות
-- שאחרי כל שורת sent באותה שיחה. מענה חלופי נוסף בתוך השעתיים גם הוא
-- אינו סוגר את החלון.
--
-- שורה נכנסת רק אחרי שהשעתיים חלפו. אחרת עוד אי אפשר לדעת שהלקוח/ה חיכה.

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
  select
    f.conversation_id,
    f.created_at as fallback_at,
    coalesce((
      select max(inn.created_at)
        from public.whatsapp_messages inn
       where inn.wa_phone = c.wa_phone
         and inn.direction = 'in'
    ), '-infinity'::timestamptz) > now() - interval '24 hours' as window_open
  from public.gabriela_llm_fallbacks f
  join public.whatsapp_public_conversations c
    on c.id = f.conversation_id
  where f.channel = 'public'
    and f.sent
    and f.created_at <= now() - interval '2 hours'
    and not exists (
      select 1
        from public.whatsapp_messages m
       where m.wa_phone = c.wa_phone
         and m.direction = 'out'
         and m.agent_id is null
         and m.created_at > f.created_at
         and m.created_at <= f.created_at + interval '2 hours'
         and coalesce(m.error, '') = ''
         and coalesce(m.status, '') <> 'failed'
         and not exists (
           select 1
             from public.gabriela_llm_fallbacks fb
            where fb.conversation_id = f.conversation_id
              and fb.channel = 'public'
              and fb.sent
              and m.created_at >= fb.created_at
              and m.created_at < fb.created_at + interval '2 minutes'
              and m.id = (
                select m0.id
                  from public.whatsapp_messages m0
                 where m0.wa_phone = c.wa_phone
                   and m0.direction = 'out'
                   and m0.agent_id is null
                   and m0.created_at >= fb.created_at
                   and m0.created_at < fb.created_at + interval '2 minutes'
                 order by m0.created_at, m0.id
                 limit 1
              )
         )
    )
  order by f.created_at;
$$;

comment on function public.gabriela_waiting_customers() is
  'שיחות הבוט הציבורי שקיבלו מענה חלופי (sent) ולא תשובת בוט אמיתית בשעתיים. מזהה שיחה, זמן המענה, וחלון 24 השעות. בלי טלפון ובלי גוף. service_role בלבד.';

revoke all on function public.gabriela_waiting_customers() from public, anon, authenticated;
grant execute on function public.gabriela_waiting_customers() to service_role;
