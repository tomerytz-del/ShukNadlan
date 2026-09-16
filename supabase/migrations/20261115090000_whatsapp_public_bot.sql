-- ============================================================================
-- הבוט הציבורי בוואטסאפ — מי שאינו סוכן/ת
--
-- עד היום מספר שלא נמצא ב-agency_members קיבל משפט אחד ("איני מזהה את מספר
-- הטלפון שלך") והשיחה נגמרה. המיגרציה הזו פותחת לו מסלול משלו: הוא מדבר עם
-- בוט קריאה-בלבד שמחפש נכסים במאגר הציבורי וממליץ על משרדים לפי התמחות.
--
-- שלושה דברים נדרשים מהמסד, וכולם נובעים מאותו הבדל אחד: **הפונה הציבורי
-- אינו מזוהה**.
--
--   1. ‏whatsapp_public_conversations — מצב שיחה שממופתח בטלפון ולא בסוכן/ת.
--      ‏whatsapp_conversations הקיימת ממופתחת ב-agent_id שהוא not null עם
--      מפתח זר ל-agency_members, ולכן אין בה מקום לשורה של אלמוני. זו הסיבה
--      לטבלה נפרדת ולא לעמודה nullable: מפתח זר לסוכן/ת הוא בדיוק מה שמונע
--      מהענף הציבורי לגעת בשיחות של הסוכנים.
--
--   2. אינדקס על ‏whatsapp_messages (wa_phone, created_at) — הבלם של הבוט
--      הציבורי הוא ספירת ההודעות שהגיעו מאותו מספר בשעה/ביממה האחרונות.
--      האינדקס הקיים הוא על agent_id, ולפונה ציבורי אין agent_id.
--
--   3. פונקציית ניקוי + pg_cron — שיחות של אנשים שאינם לקוחות המערכת אינן
--      אמורות להישמר לנצח. הטקסט עצמו נמחק אחרי 30 יום; יומן ההודעות
--      ‏(whatsapp_messages) נשאר, כי הוא מנגנון ה-de-dup וגם התשתית לספירה.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. מצב השיחה של הפונה הציבורי
-- ---------------------------------------------------------------------------
create table if not exists public.whatsapp_public_conversations (
  id uuid primary key default gen_random_uuid(),
  wa_phone text not null unique,
  history jsonb not null default '[]'::jsonb,
  last_property_id uuid references public.properties(id) on delete set null,
  -- מונה הלידים והחלון שלו. הבוט יכול לפתוח ליד (חיפוש שמור או פניית בעל/ת
  -- נכס), וזו הפעולה היחידה שלו שמייצרת שורה שסוכן/ת משלם/ת עליה. בלי תקרה,
  -- מי שמשעמם לו יכול להזרים לידים מזויפים למדף. התקרה חיה כאן ולא בספירה
  -- מטבלת הלידים כי שם הטלפון שמור בפורמט חופשי, והשוואה אליו הייתה מחייבת
  -- לשכפל את normalize_msisdn בכל שאילתה.
  leads_created integer not null default 0,
  leads_window_start timestamptz,
  first_message_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- העמודות נוספות גם לטבלה שכבר קיימת: המיגרציה הזו עלולה לרוץ שוב, והטבלה
-- נוצרה בגרסה מוקדמת שלה בלי מונה הלידים.
alter table public.whatsapp_public_conversations
  add column if not exists leads_created integer not null default 0;
alter table public.whatsapp_public_conversations
  add column if not exists leads_window_start timestamptz;

comment on table public.whatsapp_public_conversations is
  'מצב שיחת וואטסאפ של פונה שאינו סוכן/ת, ממופתח לפי מספר הטלפון. נכתב אך ורק על ידי ה-Edge Function (service_role), ונמחק אחרי 30 יום של שקט.';
comment on column public.whatsapp_public_conversations.history is
  'מערך messages בפורמט Anthropic Messages API — טקסט בלבד, נגזם לחלון ההודעות האחרון.';
comment on column public.whatsapp_public_conversations.last_property_id is
  'הנכס האחרון שהוצג בשיחה, כדי ש"כמה חדרים יש בו?" יידע במי מדובר.';

create index if not exists whatsapp_public_conversations_last_message_idx
  on public.whatsapp_public_conversations (last_message_at desc);

alter table public.whatsapp_public_conversations enable row level security;

-- אין policy. ‏בכוונה: התוכן כאן הוא שיחה של אדם פרטי עם הפלטפורמה, ואין אף
-- תפקיד באתר שאמור לקרוא אותה מהדפדפן. הגישה היחידה היא service_role בתוך
-- ה-Edge Function. טבלה עם RLS ובלי policy אינה קריאה לאיש — וזה המצב הרצוי.

-- ---------------------------------------------------------------------------
-- 2. אינדקס לבלם הקצב
--
-- הבוט הציבורי פתוח לכל מי שיודע את המספר, וכל הודעה נכנסת עולה כסף (קריאת
-- ‏LLM, ולפעמים תמלול). הבלם סופר כמה הודעות הגיעו מאותו מספר, וזו שאילתה
-- שרצה **על כל הודעה נכנסת** — היא חייבת אינדקס.
-- ---------------------------------------------------------------------------
create index if not exists whatsapp_messages_phone_created_idx
  on public.whatsapp_messages (wa_phone, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. ניקוי
-- ---------------------------------------------------------------------------
-- הניקוי נוגע ב**שני** מקומות, ולא רק בטבלת השיחות.
--
-- ‏`privacy.html` מבטיח לגולש/ת שתוכן השיחה נמחק אחרי 30 יום. מחיקת
-- ‏`whatsapp_public_conversations` לבדה אינה מקיימת את ההבטחה: גוף כל הודעה
-- נכנסת נשמר גם ב-`whatsapp_messages.body` — כולל תמלול של הקלטות קוליות —
-- והוא היה נשאר שם לנצח. הבטחת פרטיות שאינה מדויקת גרועה מהיעדר הבטחה.
--
-- **השורה נשארת, התוכן יורד.** ‏`whatsapp_messages` היא גם מנגנון ה-de-dup
-- מול משלוחים חוזרים של Meta (‏`wa_message_id`), גם הבסיס לבלם הקצב וגם מה
-- שהבדיקה החודשית סופרת. מחיקת השורות הייתה שוברת את שלושתם; איפוס
-- ‏`body` ו-`media_url` משאיר את כולם שלמים ומשאיר מאחור רק את המטא-דאטה.
--
-- רק שורות של פונים ציבוריים (‏`agent_id is null`). שיחות של סוכנים הן
-- נתוני עבודה של המשרד ואינן בהבטחה הזו.
create or replace function public.purge_whatsapp_public_conversations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.whatsapp_public_conversations
   where last_message_at < now() - interval '30 days';
  get diagnostics v_deleted = row_count;

  update public.whatsapp_messages
     set body = null,
         media_url = null
   where agent_id is null
     and created_at < now() - interval '30 days'
     and (body is not null or media_url is not null);

  return v_deleted;
end;
$$;

comment on function public.purge_whatsapp_public_conversations() is
  'מוחקת שיחות ציבוריות ששקטו 30 יום, ומאפסת את גוף ההודעות הציבוריות הישנות ב-whatsapp_messages (השורה נשארת — היא ה-de-dup ובסיס הספירה). רצה ב-pg_cron פעם ביום.';

-- ההרשאות, במפורש. ‏ברירת המחדל של Postgres היא EXECUTE ל-PUBLIC,
-- ו-PostgREST חושף כל פונקציה ב-/rest/v1/rpc/<שם> — כלומר בלי השורות האלה
-- זוהי נקודת קצה **פתוחה לכל אנונימי/ת** שמוחקת שורות. הפונקציה נקראת רק
-- ממשימת pg_cron, ולכן אין לאיש צורך בהרשאה עליה.
-- התקדים טרי: 20261112090000_revoke_anon_tier_rpc.sql סגרה חמש כאלה.
revoke all on function public.purge_whatsapp_public_conversations()
  from public, anon, authenticated;
grant execute on function public.purge_whatsapp_public_conversations()
  to service_role;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן — יש לתזמן את purge-whatsapp-public בדרך אחרת';
    return;
  end if;

  perform cron.unschedule('purge-whatsapp-public')
    where exists (select 1 from cron.job where jobname = 'purge-whatsapp-public');

  perform cron.schedule('purge-whatsapp-public', '23 3 * * *',
                        'select public.purge_whatsapp_public_conversations()');
end;
$$;
