-- ============================================================================
-- המיניסייט האישי ללקוח/ה (client showcase)
--
-- ## מה חסר עד היום
--
-- פאנל ההתאמות ב-CRM מוצא ללקוח/ה נכסים משלושה מאגרים: שלי, של המשרד, ומה
-- שמשרדים אחרים שיתפו איתי (‏`client-matching.md`). מה שקרה אחר כך יצא
-- מהמערכת: הסוכן/ת העתיק/ה קישורים לוואטסאפ, הלקוח/ה ענה/תה "את השני לא",
-- וההיסטוריה של מה נשלח, מה אהב/ה ומה נפסל חיה בגלילה של צ'אט.
--
-- וגרוע מזה, בנכס בשת"פ: הקישור היחיד שהיה לשלוח הוא `/property?id=`, ודף
-- הנכס הציבורי מציג את **המשרד המפרסם**, את הסוכן/ת שלו ואת הטלפון. כלומר
-- הסוכן/ת שלח/ה ללקוח/ה בדיוק את הדרך לעקוף אותו/ה.
--
-- ## מה נכנס
--
-- ‏`client_showcases` — מיניסייט אחד פעיל לכל לקוח/ה, עם טוקן. הקישור
-- ‏`/showcase?t=<token>` הוא המפתח היחיד; אין חשבון ללקוח/ה.
-- ‏`client_showcase_items` — הנכסים שנשלחו, עם הערה של הסוכן/ת ותגובת
-- הלקוח/ה (‏liked / disliked, ולמה). נכס שלא אהב/ה יורד מהמיניסייט ונשאר
-- כאן, כי "למה לא" הוא המידע הכי שימושי לחיפוש הבא.
-- ‏`client_showcase_messages` — שאלות והודעות, כלליות או על נכס מסוים.
-- ‏`client_showcase_meetings` — בקשות לסיור, עם מועד ורשימת נכסים.
-- ‏`property_image_tags.has_branding` — האם בתמונה לוגו או סימן מים של משרד.
--
-- ## ארבע החלטות
--
-- **1. הלקוח/ה לעולם לא נוגע/ת בטבלאות.** אין לו/ה JWT. כל קריאה וכתיבה שלו/ה
-- עוברת ב-Edge Function `client-showcase` עם `service_role`, והיא שמסננת מה
-- יוצא (בלי משרד מפרסם, בלי מספר בית, בלי תמונה עם לוגו). לכן ל-`anon` אין
-- כאן שום הרשאה.
--
-- **2. ההוספה בפונקציה, לא ב-`insert`.** נכס נכנס למיניסייט רק אם הוא במאגר
-- של הסוכן/ת — אותו מאגר בדיוק של `match_properties_for_client`: נכסי המשרד,
-- ומה ששותף עם המשרד ב-`property_shares`. ‏`insert` ישיר דרך RLS היה מאפשר
-- לשלוח ללקוח/ה כל נכס במסד, כולל של משרד שלא שיתף.
--
-- **3. השת"פ נבדק גם בזמן הצפייה, לא רק בזמן השליחה.** משרד שביטל שת"פ
-- (‏`unshare_property`) מוחק את השורה ב-`property_shares`, והנכס חייב
-- להיעלם גם ממיניסייט שכבר נשלח. ה-Edge Function בודקת את זה בכל טעינה.
--
-- **4. הנכסים בלי מיתוג, כולם.** הדף ממותג במשרד ובסוכן/ת ששלח/ה אותו,
-- והנכסים נראים זהים - כך שגם השוואה בין נכס שלי לנכס בשת"פ אינה מסגירה
-- דבר. לוגו נבדק פעם אחת לכל תמונה (‏`property_image_tags.has_branding`)
-- ונכשל סגור: תמונה שלא נבדקה **אינה מוצגת**, גם בנכס של המשרד שלי.
--
-- **5. "אהבתי" על נכס בשת"פ הוא משימה לסוכן/ת**: ‏`coop_status = 'needed'`
-- והתראה עם פרטי המתווך/ת המקורי/ת - שם מתאמים את השת"פ והסיור.
--
-- תלויות: `agent_clients`, `properties`, `property_shares`, `agency_members`,
-- ‏`notifications`, ‏`agent_agenda_items`, ‏`agent_agenda_enabled()`,
-- ‏`current_agent_id()`, ‏`set_updated_at()`. הפרטים: docs/client-showcase.md.
--
-- הקובץ אידמפוטנטי.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. המיניסייט
-- ---------------------------------------------------------------------------
create table if not exists public.client_showcases (
  id             uuid primary key default gen_random_uuid(),
  agent_id       uuid not null references public.agency_members(id) on delete cascade,
  client_id      uuid not null references public.agent_clients(id)  on delete cascade,
  token          text not null unique default encode(gen_random_bytes(24), 'hex'),
  intro          text check (intro is null or char_length(intro) <= 1000),
  status         text not null default 'active' check (status in ('active','closed')),
  view_count     int  not null default 0,
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  closed_at      timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.client_showcases is
  'המיניסייט האישי בין סוכן/ת ללקוח/ה: /showcase?t=<token>. הלקוח/ה ניגש/ת רק דרך client-showcase. docs/client-showcase.md';

-- מיניסייט פעיל אחד ללקוח/ה: "שלח עוד שלושה נכסים" מוסיף לאותו קישור, ולא
-- פותח לקוח/ה מול חמישה קישורים שכל אחד מחזיק חלק מהתמונה.
create unique index if not exists client_showcases_one_active
  on public.client_showcases (client_id) where status = 'active';
create index if not exists client_showcases_agent
  on public.client_showcases (agent_id, status);

drop trigger if exists client_showcases_set_updated_at on public.client_showcases;
create trigger client_showcases_set_updated_at
  before update on public.client_showcases
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. הנכסים במיניסייט
-- ---------------------------------------------------------------------------
create table if not exists public.client_showcase_items (
  id              uuid primary key default gen_random_uuid(),
  showcase_id     uuid not null references public.client_showcases(id) on delete cascade,
  property_id     uuid not null references public.properties(id)       on delete cascade,
  -- המקור ברגע ההוספה: own / agency / shared. ‏shared הוא מה שמפעיל את
  -- ההסתרה (משרד, סוכן/ת, טלפון, לוגו) בעמוד הלקוח/ה.
  source          text not null check (source in ('own','agency','shared')),
  agent_note      text check (agent_note is null or char_length(agent_note) <= 600),
  reaction        text check (reaction in ('liked','disliked')),
  -- מפתחות סגורים, לא טקסט חופשי: הם מה שהסוכן/ת מסנן/ת לפיו את החיפוש הבא.
  reaction_reasons text[] not null default '{}',
  reacted_at      timestamptz,
  removed_at      timestamptz,
  -- נכס בשת"פ שהלקוח/ה אהב/ה: הסוכן/ת צריך/ה לתאם מול המתווך/ת המקורי/ת.
  -- ‏needed נקבע ב-client-showcase ברגע ה-liked; השאר - הסוכן/ת מה-CRM.
  coop_status     text check (coop_status in ('needed','contacted','agreed','declined')),
  coop_updated_at timestamptz,
  position        int not null default 0,
  created_at      timestamptz not null default now(),
  unique (showcase_id, property_id)
);

comment on table public.client_showcase_items is
  'נכס שנשלח במיניסייט. reaction=disliked מוריד אותו מעמוד הלקוח/ה ונשאר כאן עם הסיבות. removed_at = הסוכן/ת הסיר/ה.';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'client_showcase_items_reasons_check') then
    alter table public.client_showcase_items add constraint client_showcase_items_reasons_check
      check (reaction_reasons <@ array['price','location','size','condition','layout','floor','photos','other']::text[]);
  end if;
end $$;

-- טבלה שכבר נוצרה בהרצה קודמת של הקובץ
alter table public.client_showcase_items add column if not exists coop_status text;
alter table public.client_showcase_items add column if not exists coop_updated_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'client_showcase_items_coop_status_check') then
    alter table public.client_showcase_items add constraint client_showcase_items_coop_status_check
      check (coop_status in ('needed','contacted','agreed','declined'));
  end if;
end $$;

create index if not exists client_showcase_items_showcase
  on public.client_showcase_items (showcase_id);

-- ---------------------------------------------------------------------------
-- 3. הודעות
-- ---------------------------------------------------------------------------
create table if not exists public.client_showcase_messages (
  id           uuid primary key default gen_random_uuid(),
  showcase_id  uuid not null references public.client_showcases(id)      on delete cascade,
  item_id      uuid          references public.client_showcase_items(id) on delete set null,
  author       text not null check (author in ('client','agent')),
  body         text not null check (char_length(btrim(body)) between 1 and 1000),
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);

comment on table public.client_showcase_messages is
  'שאלות והודעות במיניסייט. item_id = על נכס מסוים, null = הודעה כללית. read_at נכתב כשהצד השני ראה.';

create index if not exists client_showcase_messages_showcase
  on public.client_showcase_messages (showcase_id, created_at);

-- ---------------------------------------------------------------------------
-- 4. בקשות לסיור
-- ---------------------------------------------------------------------------
create table if not exists public.client_showcase_meetings (
  id              uuid primary key default gen_random_uuid(),
  showcase_id     uuid not null references public.client_showcases(id) on delete cascade,
  property_ids    uuid[] not null default '{}',
  starts_at       timestamptz not null,
  note            text check (note is null or char_length(note) <= 600),
  status          text not null default 'requested'
                  check (status in ('requested','confirmed','declined','canceled')),
  agent_note      text check (agent_note is null or char_length(agent_note) <= 600),
  agenda_item_id  uuid references public.agent_agenda_items(id) on delete set null,
  decided_at      timestamptz,
  created_at      timestamptz not null default now()
);

comment on table public.client_showcase_meetings is
  'בקשת סיור מהמיניסייט: מועד ונכסים. אישור ב-showcase_decide_meeting, שגם רושם ביומן כשהיומן זמין.';

create index if not exists client_showcase_meetings_showcase
  on public.client_showcase_meetings (showcase_id, status);

-- ---------------------------------------------------------------------------
-- 5. לוגו בתמונה
--
-- ‏null = לא נבדק. ‏classify-property-images אינה נוגעת בעמודות האלה; הן
-- נכתבות רק מ-client-showcase, לתמונות של נכסים שנשלחו במיניסייט.
-- ---------------------------------------------------------------------------
alter table public.property_image_tags add column if not exists has_branding boolean;
alter table public.property_image_tags add column if not exists branding_checked_at timestamptz;

comment on column public.property_image_tags.has_branding is
  'לוגו, סימן מים או פרטי קשר של משרד בתמונה. null = לא נבדק, ואז התמונה אינה מוצגת במיניסייט.';

-- ---------------------------------------------------------------------------
-- 6. הרשאות
--
-- הסוכן/ת רואה ומנהל/ת את שלו/ה. ההוספה (מאגר) וההחלטה על סיור (יומן)
-- עוברות בפונקציות למטה; השאר — הערה לנכס, הסרה, תשובה, סגירה — ב-RLS.
-- ---------------------------------------------------------------------------
alter table public.client_showcases         enable row level security;
alter table public.client_showcase_items    enable row level security;
alter table public.client_showcase_messages enable row level security;
alter table public.client_showcase_meetings enable row level security;

revoke all on public.client_showcases         from anon;
revoke all on public.client_showcase_items    from anon;
revoke all on public.client_showcase_messages from anon;
revoke all on public.client_showcase_meetings from anon;

-- ‏insert רק דרך showcase_add_properties. הטוקן אינו ניתן לשינוי מהדפדפן.
revoke insert, delete on public.client_showcases from authenticated;
revoke update on public.client_showcases from authenticated;
grant update (status, closed_at, intro) on public.client_showcases to authenticated;

revoke insert on public.client_showcase_items from authenticated;
revoke update on public.client_showcase_items from authenticated;
grant update (agent_note, removed_at, position, coop_status, coop_updated_at) on public.client_showcase_items to authenticated;

revoke update, delete on public.client_showcase_messages from authenticated;
grant update (read_at) on public.client_showcase_messages to authenticated;

revoke insert, update, delete on public.client_showcase_meetings from authenticated;

drop policy if exists "agent reads own showcases" on public.client_showcases;
create policy "agent reads own showcases" on public.client_showcases
  for select to authenticated using (agent_id = public.current_agent_id());

drop policy if exists "agent updates own showcases" on public.client_showcases;
create policy "agent updates own showcases" on public.client_showcases
  for update to authenticated
  using (agent_id = public.current_agent_id())
  with check (agent_id = public.current_agent_id());

drop policy if exists "agent manages own showcase items" on public.client_showcase_items;
create policy "agent manages own showcase items" on public.client_showcase_items
  for all to authenticated
  using (exists (select 1 from public.client_showcases s
                  where s.id = showcase_id and s.agent_id = public.current_agent_id()))
  with check (exists (select 1 from public.client_showcases s
                  where s.id = showcase_id and s.agent_id = public.current_agent_id()));

drop policy if exists "agent reads own showcase messages" on public.client_showcase_messages;
create policy "agent reads own showcase messages" on public.client_showcase_messages
  for select to authenticated
  using (exists (select 1 from public.client_showcases s
                  where s.id = showcase_id and s.agent_id = public.current_agent_id()));

-- הסוכן/ת כותב/ת רק בשמו/ה: author='agent'. בלי התנאי הזה אפשר היה לשתול
-- "הודעה מהלקוח/ה" ביומן השיחה.
drop policy if exists "agent writes own showcase messages" on public.client_showcase_messages;
create policy "agent writes own showcase messages" on public.client_showcase_messages
  for insert to authenticated
  with check (author = 'agent'
              and exists (select 1 from public.client_showcases s
                           where s.id = showcase_id and s.agent_id = public.current_agent_id()));

drop policy if exists "agent marks own showcase messages read" on public.client_showcase_messages;
create policy "agent marks own showcase messages read" on public.client_showcase_messages
  for update to authenticated
  using (exists (select 1 from public.client_showcases s
                  where s.id = showcase_id and s.agent_id = public.current_agent_id()))
  with check (exists (select 1 from public.client_showcases s
                  where s.id = showcase_id and s.agent_id = public.current_agent_id()));

drop policy if exists "agent reads own showcase meetings" on public.client_showcase_meetings;
create policy "agent reads own showcase meetings" on public.client_showcase_meetings
  for select to authenticated
  using (exists (select 1 from public.client_showcases s
                  where s.id = showcase_id and s.agent_id = public.current_agent_id()));

-- ---------------------------------------------------------------------------
-- 7. ‏showcase_add_properties — יצירה או הוספה
--
-- מחזירה `{ showcase_id, token, added, skipped }` או `{ error }`. נכס שאינו
-- במאגר, שאינו פעיל, או שכבר במיניסייט — מדולג ונספר, לא מפיל את השאר.
-- נכס שהלקוח/ה פסל/ה בעבר ונשלח שוב מקבל הזדמנות שנייה (התגובה מתאפסת):
-- הסוכן/ת בחר/ה לשלוח אותו שוב ביודעין, אולי אחרי שהמחיר ירד.
-- ---------------------------------------------------------------------------
create or replace function public.showcase_add_properties(
  p_client_id    uuid,
  p_property_ids uuid[],
  p_intro        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent    public.agency_members%rowtype;
  v_showcase public.client_showcases%rowtype;
  v_pid      uuid;
  v_src      text;
  v_pos      int;
  v_added    int := 0;
  v_skipped  int := 0;
begin
  select * into v_agent from public.agency_members
   where id = public.current_agent_id() and active = true;
  if not found then
    return jsonb_build_object('error', 'agent_not_found');
  end if;
  if v_agent.agency_id is null then
    return jsonb_build_object('error', 'agent_without_agency');
  end if;

  if not exists (select 1 from public.agent_clients
                  where id = p_client_id and agent_id = v_agent.id) then
    return jsonb_build_object('error', 'client_not_found');
  end if;

  if coalesce(cardinality(p_property_ids), 0) = 0 then
    return jsonb_build_object('error', 'no_properties');
  end if;
  if cardinality(p_property_ids) > 40 then
    return jsonb_build_object('error', 'too_many');
  end if;

  select * into v_showcase from public.client_showcases
   where client_id = p_client_id and status = 'active';
  if not found then
    insert into public.client_showcases (agent_id, client_id, intro)
    values (v_agent.id, p_client_id, nullif(btrim(coalesce(p_intro, '')), ''))
    returning * into v_showcase;
  elsif nullif(btrim(coalesce(p_intro, '')), '') is not null then
    update public.client_showcases set intro = btrim(p_intro)
     where id = v_showcase.id;
  end if;

  select coalesce(max(position), 0) into v_pos
    from public.client_showcase_items where showcase_id = v_showcase.id;

  foreach v_pid in array p_property_ids loop
    -- אותו מאגר כמו match_properties_for_client
    select case when p.agent_id = v_agent.id then 'own' else 'agency' end
      into v_src
      from public.properties p
     where p.id = v_pid and p.status = 'active' and p.agency_id = v_agent.agency_id;

    if v_src is null then
      select 'shared' into v_src
        from public.property_shares ps
        join public.properties p on p.id = ps.property_id and p.status = 'active'
       where ps.property_id = v_pid and ps.shared_with_agency_id = v_agent.agency_id
       limit 1;
    end if;

    if v_src is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_pos := v_pos + 1;
    insert into public.client_showcase_items (showcase_id, property_id, source, position)
    values (v_showcase.id, v_pid, v_src, v_pos)
    on conflict (showcase_id, property_id) do update
      set source = excluded.source,
          removed_at = null,
          reaction = case when public.client_showcase_items.reaction = 'disliked'
                          then null else public.client_showcase_items.reaction end,
          reaction_reasons = case when public.client_showcase_items.reaction = 'disliked'
                          then '{}'::text[] else public.client_showcase_items.reaction_reasons end,
          position = excluded.position
      where public.client_showcase_items.removed_at is not null
         or public.client_showcase_items.reaction = 'disliked';

    if found then v_added := v_added + 1; else v_skipped := v_skipped + 1; end if;
    v_src := null;
  end loop;

  return jsonb_build_object(
    'showcase_id', v_showcase.id,
    'token',       v_showcase.token,
    'added',       v_added,
    'skipped',     v_skipped
  );
end;
$$;

comment on function public.showcase_add_properties(uuid, uuid[], text) is
  'יוצר/ת או מוסיף/ה למיניסייט של לקוח/ה. רק נכסים פעילים מהמאגר של הסוכן/ת (המשרד + property_shares). הזהות מה-JWT.';

revoke all on function public.showcase_add_properties(uuid, uuid[], text) from public, anon, authenticated;
grant execute on function public.showcase_add_properties(uuid, uuid[], text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. ‏showcase_decide_meeting — אישור או דחייה של סיור
--
-- באישור, כשליומן יש גישה (‏agent_agenda_enabled), נרשם פריט `showing` עם
-- ‏source_key — לחיצה כפולה אינה יוצרת שתי פגישות. בלי יומן האישור עובר
-- כרגיל, ופשוט אינו נרשם שם.
-- ---------------------------------------------------------------------------
create or replace function public.showcase_decide_meeting(
  p_meeting_id uuid,
  p_confirm    boolean,
  p_note       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent_id uuid := public.current_agent_id();
  v_meet     public.client_showcase_meetings%rowtype;
  v_show     public.client_showcases%rowtype;
  v_client   text;
  v_item     uuid;
  v_titles   text;
begin
  select m.* into v_meet from public.client_showcase_meetings m
    join public.client_showcases s on s.id = m.showcase_id
   where m.id = p_meeting_id and s.agent_id = v_agent_id;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;
  if v_meet.status not in ('requested','confirmed') then
    return jsonb_build_object('error', 'already_decided');
  end if;

  select * into v_show from public.client_showcases where id = v_meet.showcase_id;
  select full_name into v_client from public.agent_clients where id = v_show.client_id;

  if p_confirm and public.agent_agenda_enabled(v_agent_id) then
    select string_agg(concat_ws(', ', nullif(concat_ws(' ', p.street, p.house_number), ''), p.city), ' · ')
      into v_titles
      from public.properties p where p.id = any (v_meet.property_ids);

    insert into public.agent_agenda_items
      (agent_id, kind, title, notes, location, due_at, ends_at, source, source_key, client_id, property_id)
    values (
      v_agent_id, 'showing',
      left('סיור עם ' || coalesce(v_client, 'לקוח/ה') || ' (מהמיניסייט)', 200),
      left(nullif(concat_ws(E'\n', v_meet.note, p_note), ''), 2000),
      left(v_titles, 300),
      v_meet.starts_at, v_meet.starts_at + interval '1 hour',
      'crm', 'showcase_meeting:' || v_meet.id::text,
      v_show.client_id, v_meet.property_ids[1]
    )
    on conflict (agent_id, source_key) where source_key is not null
      do update set due_at = excluded.due_at, ends_at = excluded.ends_at, status = 'open'
    returning id into v_item;
  end if;

  update public.client_showcase_meetings
     set status = case when p_confirm then 'confirmed' else 'declined' end,
         agent_note = nullif(btrim(coalesce(p_note, '')), ''),
         agenda_item_id = coalesce(v_item, agenda_item_id),
         decided_at = now()
   where id = v_meet.id;

  return jsonb_build_object('success', true, 'agenda_item_id', v_item);
end;
$$;

comment on function public.showcase_decide_meeting(uuid, boolean, text) is
  'אישור/דחייה של בקשת סיור מהמיניסייט. באישור נרשם פריט showing ביומן כשהיומן זמין. הזהות מה-JWT.';

revoke all on function public.showcase_decide_meeting(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.showcase_decide_meeting(uuid, boolean, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. ההתראה לסוכן/ת
--
-- סוג חדש בפעמון. הרשימה זהה לזו של 20270125090000, ועוד הסוג בסוף.
-- ‏related_showcase_id הוא מה שמאפשר לקבץ: עשר תגובות ברצף הן התראה אחת
-- שמתעדכנת, ולא עשר (ראו touchShowcaseNotification ב-client-showcase).
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('new_lead','system','review_request','review_alert','client_match',
                  'review_new','deal_closed','lead_unrouted','marketing_copy',
                  'agreement_signed','platform_signup','platform_upgrade',
                  'onboarding_property','onboarding_client','onboarding_agreement',
                  'onboarding_lead','exclusivity_taken','deal_data_gap',
                  'listing_match','agenda_reminder','showcase_activity'));

alter table public.notifications
  add column if not exists related_showcase_id uuid
    references public.client_showcases(id) on delete set null;
