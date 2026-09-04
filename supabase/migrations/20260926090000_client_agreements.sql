-- ============================================================================
-- החתמת לקוחות על הזמנת שירותי תיווך — ידנית ומרחוק
--
-- ‏המנגנון כולו נשען על שתי טבלאות ועל עיקרון אחד: **המסמך קופא ברגע
-- שהוא יוצא לחתימה.** מה שהחותם/ת ראה/תה הוא מה שנשמר, ואף אחד — גם לא
-- הסוכן/ת שיצר/ה אותו — אינו יכול לשנות אותו אחר כך. בלי זה חתימה
-- אלקטרונית אינה שווה דבר: תמיד אפשר יהיה לטעון שהטקסט הוחלף אחרי החתימה.
--
--   1. ‏agreements — ההסכם עצמו: סוגו, הצדדים, העמלה, וה-HTML הקפוא של
--      גוף המסמך (‏document_html). הטריגר בסעיף 3 חוסם כתיבה מחדש של הגוף
--      ברגע שההסכם עזב את מצב 'draft'.
--   2. ‏agreement_signers — שורה לכל חותם/ת. לכל אחד/ת אסימון חתימה משלו/ה,
--      כי בני זוג לא תמיד יושבים באותו חדר: מי שחותם/ת מרחוק מקבל/ת קישור
--      אישי, ומי שחותם/ת מול הסוכן/ת חותם/ת על אותו מכשיר בזה אחר זה.
--   3. הסטטוס של ההסכם **נגזר** ממצב החותמים ואינו נכתב ידנית — הסכם הוא
--      'signed' כשכל החותמים חתמו, ולא כשמישהו החליט לסמן אותו ככזה.
--
-- ‏מה שנשאר בכוונה מחוץ לכאן: טבלת contracts הישנה (עטיפה ל-GetSign,
-- אפס שורות מאז שנוצרה) אינה נוגעת בזה ואינה נמחקת — ההחתמה כאן היא
-- מנגנון עצמאי, בלי ספק חיצוני ובלי עלות לכל חתימה.
--
-- הקובץ אידמפוטנטי — אפשר להריץ אותו שוב ושוב.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. שדות זיהוי שהטופס דורש ולא היו במסד
--
-- ‏תקנות המתווכים במקרקעין (פרטי הזמנה בכתב), התשנ״ז-1997 מחייבות שההזמנה
-- תכלול את **מספרי הזיהוי** של הלקוח/ה ושל המתווך/ת. בלעדיהם ההזמנה עלולה
-- לא להיחשב הזמנה בכתב כדין, וזו בדיוק הטענה שמפילה תביעות דמי תיווך.
--
-- ‏id_number על agency_members בטוח: ‏agency_members_public מונה את
-- העמודות שהיא חושפת אחת-אחת, ולכן עמודה חדשה אינה נכנסת אליה מעצמה.
-- ---------------------------------------------------------------------------
alter table public.agency_members
  add column if not exists id_number text;

comment on column public.agency_members.id_number is
  'ת״ז/ח״פ של הסוכן/ת — נדרש בהזמנת שירותי תיווך בכתב. אינו נחשף ב-agency_members_public.';

alter table public.agent_clients
  add column if not exists id_number text,
  add column if not exists address   text;

comment on column public.agent_clients.id_number is
  'ת״ז/ח״פ של הלקוח/ה — נדרש בהזמנת שירותי תיווך בכתב.';

alter table public.property_owners
  add column if not exists owner_id_number text,
  add column if not exists owner_address   text;

comment on column public.property_owners.owner_id_number is
  'ת״ז/ח״פ של בעל/ת הנכס — נדרש בהזמנת שירותי תיווך בכתב.';

-- ---------------------------------------------------------------------------
-- 1. ההסכם
--
-- ‏snapshot הוא הנתונים שמהם נבנה המסמך (הצדדים, תיאור הנכס, המשאלון),
-- ו-document_html הוא התוצאה. שניהם נשמרים, ולא רק אחד מהם: ה-HTML הוא מה
-- שנחתם ומה שנשלח, וה-JSON הוא מה שמאפשר להציג את אותו הסכם בטבלה, לחפש
-- בו ולהבין מה נכנס לכל שדה בלי לפרסר HTML.
--
-- ‏document_html נכתב **בדפדפן של הסוכן/ת** בזמן היצירה, לא בזמן החתימה.
-- זה מכוון: החותם/ת לעולם אינו/ה שולח/ת טקסט לשרת, אלא תמונת חתימה בלבד,
-- ולכן אין דרך שחותם/ת יזריק/תזריק תוכן למסמך שנשלח אחר כך לכל הצדדים.
-- ---------------------------------------------------------------------------
create table if not exists public.agreements (
  id           uuid primary key default gen_random_uuid(),
  agent_id     uuid not null references public.agency_members(id) on delete cascade,
  agency_id    uuid          references public.agencies(id)       on delete set null,

  kind         text not null
               check (kind in ('buy','sell','tenant','landlord',
                               'exclusive_sell','exclusive_landlord')),
  status       text not null default 'draft'
               check (status in ('draft','sent','viewed','signed','cancelled')),

  title            text not null,
  template_version text not null default 'v1',

  -- העמלה: אחוזים או סכום קבוע. שניהם אופציונליים — יש הסכמים שבהם רק אחד
  -- מהם מולא, וסעיף העמלה במסמך מנוסח לפי מה שמולא בפועל.
  commission_pct     numeric(6,3) check (commission_pct is null or (commission_pct >= 0 and commission_pct <= 100)),
  commission_amount  numeric(14,2) check (commission_amount is null or commission_amount >= 0),
  commission_note    text,

  -- בלעדיות בלבד. ‏marketing_actions הוא רשימת פעולות השיווק שהמתווך/ת
  -- מתחייב/ת לבצע — תקנות המתווכים במקרקעין (פעולות שיווק), התשס״ה-2004
  -- דורשות לפחות שתיים מהן, וההסכם שאינו מקיים אותן אינו מזכה בבלעדיות.
  exclusive_from     date,
  exclusive_until    date,
  marketing_actions  text[] not null default '{}',

  language     text not null default 'he' check (language in ('he','en','ru','ar','fr')),
  notes        text,

  snapshot        jsonb not null default '{}'::jsonb,
  document_html   text,

  property_ids uuid[] not null default '{}',
  client_ids   uuid[] not null default '{}',

  -- אסימון הצפייה הקבוע: הקישור שנשלח במייל אחרי החתימה ומוביל לעותק
  -- החתום. נפרד מאסימוני החתימה — הוא לא מאפשר לחתום, רק לקרוא.
  view_token   text not null default encode(gen_random_bytes(24), 'hex'),
  -- קוד אימות קצר שמודפס על המסמך. מי שמחזיק/ה עותק מודפס יכול/ה להשוות
  -- אותו מול העותק שבמערכת.
  verify_code  text not null default upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8)),

  sent_at      timestamptz,
  viewed_at    timestamptz,
  signed_at    timestamptz,
  cancelled_at timestamptz,

  -- משלוח העותק החתום. נשמר גם כשהוא נכשל, עם הסיבה: מייל שלא יצא הוא
  -- מידע שהסוכן/ת צריך/ה לראות בכרטיס ההסכם, לא כישלון שנבלע בשקט.
  signed_copy_sent_at timestamptz,
  signed_copy_error   text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint agreements_exclusive_range
    check (exclusive_from is null or exclusive_until is null or exclusive_from <= exclusive_until)
);

create unique index if not exists agreements_view_token_key on public.agreements (view_token);
create index if not exists agreements_agent_idx  on public.agreements (agent_id, status, created_at desc);
create index if not exists agreements_props_idx  on public.agreements using gin (property_ids);
create index if not exists agreements_clients_idx on public.agreements using gin (client_ids);

comment on table public.agreements is
  'הזמנת שירותי תיווך שנשלחה ללקוח/ה לחתימה. ‏document_html הוא המסמך הקפוא — מה שנחתם הוא מה שנשמר.';
comment on column public.agreements.document_html is
  'גוף המסמך כפי שהוצג לחתימה. נכתב פעם אחת ביצירה ונחסם לשינוי ברגע שההסכם יצא מ-draft (טריגר agreements_freeze_body).';
comment on column public.agreements.status is
  'נגזר ולא נכתב ידנית: ‏signed נקבע בטריגר כשכל החותמים חתמו. ידנית משנים רק ל-sent ול-cancelled.';
comment on column public.agreements.marketing_actions is
  'פעולות השיווק שהמתווך/ת התחייב/ה לבצע בהסכם בלעדיות. תקנות פעולות שיווק התשס״ה-2004 דורשות לפחות שתיים.';
comment on column public.agreements.verify_code is
  'קוד אימות קצר שמודפס על המסמך ומאפשר להצליב עותק מודפס מול העותק שבמערכת.';

-- ---------------------------------------------------------------------------
-- 2. החותמים
--
-- שורה לכל מי שנדרש/ת לחתום: הלקוח/ה, בן/בת הזוג או השותף/ה, וכל בעלים
-- נוסף/ת. לכל אחד/ת אסימון משלו/ה — זה מה שמאפשר לשלוח לבני זוג שני
-- קישורים נפרדים במקום לדרוש מהם לשבת יחד מול אותו מסך.
--
-- ‏signature היא ‎data:image/png;base64,…‎ ולא קובץ ב-Storage: תמונת חתימה
-- היא כמה עשרות KB, היא חלק בלתי נפרד מהמסמך, ואחסון נפרד רק היה מוסיף
-- דלי שממנו אפשר למחוק חתימה בלי שההסכם יידע.
-- ---------------------------------------------------------------------------
create table if not exists public.agreement_signers (
  id            uuid primary key default gen_random_uuid(),
  agreement_id  uuid not null references public.agreements(id) on delete cascade,
  ord           smallint not null default 0,

  party         text not null default 'client'
                check (party in ('client','partner','agent')),
  full_name     text not null,
  id_number     text,
  phone         text,
  email         text,
  address       text,

  sign_token       text not null default encode(gen_random_bytes(24), 'hex'),
  token_expires_at timestamptz not null default now() + interval '45 days',

  signature   text,
  signed_at   timestamptz,
  signed_ip   text,
  signed_ua   text,
  method      text check (method in ('manual','remote')),
  viewed_at   timestamptz,

  mail_sent_at timestamptz,
  mail_error   text,

  created_at  timestamptz not null default now(),

  -- חתימה בלי חותמת זמן (או להפך) היא רשומה שבורה שאי אפשר להסתמך עליה
  constraint agreement_signers_signed_pair
    check ((signature is null and signed_at is null) or (signature is not null and signed_at is not null))
);

create unique index if not exists agreement_signers_token_key on public.agreement_signers (sign_token);
create unique index if not exists agreement_signers_ord_key   on public.agreement_signers (agreement_id, ord);
create index if not exists agreement_signers_agreement_idx    on public.agreement_signers (agreement_id);

comment on table public.agreement_signers is
  'החותמים על הסכם. אסימון אישי לכל אחד/ת — בני זוג מקבלים שני קישורים נפרדים.';
comment on column public.agreement_signers.method is
  'manual = חתם/ה על המכשיר של הסוכן/ת · remote = חתם/ה בקישור אישי.';

-- ---------------------------------------------------------------------------
-- 3. שני הטריגרים ששומרים על היושרה
-- ---------------------------------------------------------------------------

drop trigger if exists agreements_set_updated_at on public.agreements;
create trigger agreements_set_updated_at
  before update on public.agreements
  for each row execute function public.set_updated_at();

-- 3א. גוף המסמך קופא כשהוא יוצא לחתימה.
--
-- זו לא הגנה מפני הסוכן/ת אלא הגנה **עבורו/ה**: הסכם שאפשר לערוך אחרי
-- החתימה הוא הסכם שאפשר לטעון נגדו שנערך אחרי החתימה, וכל הערך הראייתי
-- של החתימה האלקטרונית תלוי בזה. הדרך לתקן הסכם שנשלח היא לבטל אותו
-- ולהוציא חדש, בדיוק כמו בנייר.
create or replace function public.agreements_freeze_body()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'draft' then
    return new;
  end if;
  if new.document_html is distinct from old.document_html
     or new.snapshot     is distinct from old.snapshot
     or new.kind         is distinct from old.kind
     or new.title        is distinct from old.title
     or new.commission_pct    is distinct from old.commission_pct
     or new.commission_amount is distinct from old.commission_amount
     or new.exclusive_from    is distinct from old.exclusive_from
     or new.exclusive_until   is distinct from old.exclusive_until
     or new.verify_code       is distinct from old.verify_code
  then
    raise exception 'agreement_locked'
      using hint = 'הסכם שיצא לחתימה אינו ניתן לעריכה. בטלו אותו והוציאו הסכם חדש.';
  end if;
  return new;
end;
$$;

revoke execute on function public.agreements_freeze_body() from anon, authenticated;

drop trigger if exists agreements_freeze_body on public.agreements;
create trigger agreements_freeze_body
  before update on public.agreements
  for each row execute function public.agreements_freeze_body();

-- 3ב. הסטטוס נגזר ממצב החותמים.
--
-- ‏security definer כי הפונקציה מעדכנת את agreements בעקבות כתיבה
-- ל-agreement_signers שהגיעה מ-service_role (חתימה מרחוק) או מהסוכן/ת
-- (חתימה ידנית), ובשני המקרים אין טעם לדרוש הרשאת UPDATE נפרדת על ההסכם.
create or replace function public.agreement_signers_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agreement uuid;
  v_total     int;
  v_signed    int;
  v_last      timestamptz;
begin
  v_agreement := coalesce(new.agreement_id, old.agreement_id);

  select count(*), count(*) filter (where signed_at is not null), max(signed_at)
    into v_total, v_signed, v_last
    from public.agreement_signers
   where agreement_id = v_agreement;

  if v_total > 0 and v_signed = v_total then
    update public.agreements
       set status = 'signed', signed_at = coalesce(signed_at, v_last, now())
     where id = v_agreement and status <> 'cancelled';
  else
    -- נוסף/ה חותם/ת חדש/ה להסכם שכבר היה חתום, או שחתימה נמחקה
    update public.agreements
       set status = case when status = 'signed' then 'sent' else status end,
           signed_at = null
     where id = v_agreement and status = 'signed';
  end if;

  return null;
end;
$$;

revoke execute on function public.agreement_signers_sync() from anon, authenticated;

drop trigger if exists agreement_signers_sync on public.agreement_signers;
create trigger agreement_signers_sync
  after insert or update or delete on public.agreement_signers
  for each row execute function public.agreement_signers_sync();

-- ---------------------------------------------------------------------------
-- 4. ‏RLS
--
-- צר כמו agent_clients ולא כמו properties: הסכם הוא מסמך משפטי בין הלקוח/ה
-- לסוכן/ת, ומנהל/ת המשרד אינו/ה צד לו. ‏anon נשלל לגמרי — כל מה שקורה מול
-- חותם/ת מרחוק עובר ב-Edge Function ‏agreement-sign עם service_role, שרואה
-- שורה אחת לפי אסימון ולא את הטבלה.
-- ---------------------------------------------------------------------------
alter table public.agreements        enable row level security;
alter table public.agreement_signers enable row level security;

revoke all on table public.agreements        from anon;
revoke all on table public.agreement_signers from anon;
grant select, insert, update, delete on table public.agreements        to authenticated;
grant select, insert, update, delete on table public.agreement_signers to authenticated;

drop policy if exists "agent manages own agreements" on public.agreements;
create policy "agent manages own agreements"
  on public.agreements for all
  using (agent_id = public.current_agent_id())
  with check (agent_id = public.current_agent_id());

drop policy if exists "agent manages own agreement signers" on public.agreement_signers;
create policy "agent manages own agreement signers"
  on public.agreement_signers for all
  using (exists (
    select 1 from public.agreements a
     where a.id = public.agreement_signers.agreement_id
       and a.agent_id = public.current_agent_id()))
  with check (exists (
    select 1 from public.agreements a
     where a.id = public.agreement_signers.agreement_id
       and a.agent_id = public.current_agent_id()));
