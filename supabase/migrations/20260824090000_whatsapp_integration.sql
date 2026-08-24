-- ============================================================================
-- אינטגרציית וואטסאפ (Meta WhatsApp Cloud API)
--
-- הסוכן/ת שולח/ת הודעה בוואטסאפ למספר העסקי -> Meta שולחת Webhook ל-Edge
-- Function ‏whatsapp-webhook -> הפונקציה מזהה את הסוכן/ת לפי מספר הטלפון,
-- מפעילה LLM עם כלים (יצירה/עדכון/ארכוב נכס) ומשיבה חזרה בוואטסאפ.
--
-- המיגרציה הזו מוסיפה שלושה דברים:
--   1. normalize_msisdn() + agency_members.phone_e164 — זיהוי הסוכן/ת לפי הטלפון.
--   2. whatsapp_conversations — מצב שיחה מתמשך לכל סוכן/ת (היסטוריה + תמונות ממתינות).
--   3. whatsapp_messages — יומן הודעות נכנסות/יוצאות, שמשמש גם כמנגנון de-dup.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. נרמול מספרי טלפון ל-E.164 ללא הפלוס (הפורמט ש-Meta שולחת ב-`from`)
--
-- ‏Meta מזהה את השולח כ-"972501234567". במסד הנתונים הסוכנים שמורים בפורמט
-- ישראלי מקומי ("052-333-4444"), ולכן צריך פונקציית נרמול דו-כיוונית: אותו
-- ביטוי מופעל גם על העמודה השמורה וגם על המספר שמגיע מהוובהוק, וההשוואה
-- נעשית על התוצאה. IMMUTABLE כי היא משמשת בעמודה מחושבת (generated column).
-- ---------------------------------------------------------------------------
create or replace function public.normalize_msisdn(p_phone text)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  d text;
begin
  d := regexp_replace(p_phone, '\D', '', 'g');
  if d = '' then
    return null;
  end if;

  -- חיוג בינלאומי בסגנון 00972… -> 972…
  if left(d, 2) = '00' then
    d := substr(d, 3);
  end if;

  if left(d, 3) = '972' then
    -- 972-05… (טעות נפוצה) -> 9725…; אפס מוביל אחרי קידומת המדינה תמיד מיותר
    d := '972' || ltrim(substr(d, 4), '0');
  elsif left(d, 1) = '0' then
    -- 0521112222 -> 972521112222
    d := '972' || substr(d, 2);
  elsif left(d, 1) = '5' and length(d) = 9 then
    -- 521112222 (סלולרי ישראלי בלי אפס מוביל) -> 972521112222
    d := '972' || d;
  end if;
  -- כל השאר נחשב מספר בינלאומי שכבר מנורמל ועובר כמו שהוא

  -- קצר מדי מכדי להיות מספר אמיתי — עדיף null מאשר התאמה שגויה לסוכן/ת אחר/ת
  if length(d) < 10 then
    return null;
  end if;

  return d;
end;
$$;

comment on function public.normalize_msisdn(text) is
  'מנרמל מספר טלפון לפורמט E.164 בלי הפלוס (972521112222) לצורך התאמה מול השולח בוואטסאפ. מחזירה null אם אין מספיק ספרות.';

-- עמודה מחושבת: מאפשרת ל-Edge Function לחפש את הסוכן/ת בשאילתה אחת
-- (‏.eq('phone_e164', from)) במקום למשוך את כל הסוכנים ולנרמל בצד השרת.
alter table public.agency_members
  add column if not exists phone_e164 text
  generated always as (public.normalize_msisdn(phone)) stored;

comment on column public.agency_members.phone_e164 is
  'הטלפון של הסוכן/ת בפורמט E.164 ללא פלוס — נגזר אוטומטית מ-phone. זהו המפתח לזיהוי הסוכן/ת בוובהוק של וואטסאפ.';

-- ייחודיות: שני סוכנים לא יכולים לחלוק מספר וואטסאפ, אחרת לא ניתן לדעת
-- בשם מי לפעול. שורות בלי טלפון לא מושפעות.
create unique index if not exists agency_members_phone_e164_key
  on public.agency_members (phone_e164)
  where phone_e164 is not null;

-- ---------------------------------------------------------------------------
-- 2. מצב השיחה — אחת לכל סוכן/ת
--
-- שומר את היסטוריית ההודעות בפורמט של Anthropic Messages API כדי שהבוט יזכור
-- הקשר בין הודעות ("תוסיף לזה מרפסת"), את התמונות שהגיעו וטרם שויכו לנכס,
-- ואת הנכס האחרון שנגענו בו (כדי שתמונה בודדת שתגיע אחריו תשויך אליו).
-- ---------------------------------------------------------------------------
create table if not exists public.whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null unique references public.agency_members(id) on delete cascade,
  wa_phone text not null,
  history jsonb not null default '[]'::jsonb,
  pending_images text[] not null default '{}',
  last_property_id uuid references public.properties(id) on delete set null,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.whatsapp_conversations is
  'מצב שיחת וואטסאפ פר סוכן/ת. נכתב אך ורק על ידי ה-Edge Function ‏(service_role).';
comment on column public.whatsapp_conversations.history is
  'מערך messages בפורמט Anthropic Messages API, נגזם לחלון הודעות אחרון כדי לא לתפוח.';
comment on column public.whatsapp_conversations.pending_images is
  'כתובות תמונות שהועלו ל-Storage וטרם שויכו לנכס — משויכות אוטומטית לנכס הבא שייווצר.';

create index if not exists whatsapp_conversations_last_message_idx
  on public.whatsapp_conversations (last_message_at desc);

alter table public.whatsapp_conversations enable row level security;

-- קריאה בלבד לסוכן/ת עצמו/ה. אין policy של INSERT/UPDATE ללקוח: הכתיבה
-- נעשית רק דרך service_role בתוך ה-Edge Function (אותה תבנית כמו notifications).
create policy "agent reads own whatsapp conversation"
  on public.whatsapp_conversations for select
  using (agent_id = public.current_agent_id());

-- ---------------------------------------------------------------------------
-- 3. יומן הודעות
--
-- ‏Meta שולחת מחדש כל וובהוק שלא ענה 200 מהר מספיק, ולפעמים משכפלת גם כשכן.
-- ‏wa_message_id ייחודי הופך את היומן למנגנון de-dup: INSERT מוצלח = ההודעה
-- חדשה וצריך לטפל בה; התנגשות = כבר טופלה, מדלגים.
-- ---------------------------------------------------------------------------
create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  wa_message_id text unique,
  agent_id uuid references public.agency_members(id) on delete set null,
  direction text not null check (direction in ('in', 'out')),
  wa_phone text not null,
  msg_type text not null default 'text',
  body text,
  media_url text,
  error text,
  created_at timestamptz not null default now()
);

comment on table public.whatsapp_messages is
  'יומן הודעות וואטסאפ נכנסות/יוצאות. wa_message_id הייחודי משמש גם לזיהוי משלוחים חוזרים של Meta.';

create index if not exists whatsapp_messages_agent_created_idx
  on public.whatsapp_messages (agent_id, created_at desc);

alter table public.whatsapp_messages enable row level security;

create policy "agent reads own whatsapp messages"
  on public.whatsapp_messages for select
  using (agent_id = public.current_agent_id());
