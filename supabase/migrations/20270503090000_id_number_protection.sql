-- ===========================================================================
-- ת.ז. במערכת: מוצפנת למתווכים, לא נשמרת ללקוחות
--
-- ‏ISO 27001 (‏8.24) ותקנות אבטחת מידע: ת.ז. היא המידע הרגיש ביותר שהמערכת
-- מחזיקה, והיא ישבה כטקסט גלוי בחמישה מקומות. ההחלטה (13.10.2026):
--
--   * **מתווכים** (`agency_members.id_number`) - מוצפנת. המפתח ב-Vault,
--     הפענוח רק במסד, ורק לבעל/ת הת.ז. עצמו/ה (‏my_id_number) או לשרת
--     (‏member_id_number). ב-CRM מוצגות 4 הספרות האחרונות.
--   * **לקוחות** (‏agent_clients, ‏property_owners) - לא נשמרת בכלל. הלקוח/ה
--     מקליד/ה אותה בעצמו/ה בדף החתימה, לפני החתימה (‏self_fill).
--   * **ההסכם החתום** - נשאר עם הת.ז., כי הזמנה בכתב חייבת לשאת אותה (תקנות
--     המתווכים, לאישור מול עו"ד). ופתיחה שלו נרשמת ביומן הביקורת
--     (‏agreement_open).
--
-- **הכלל נאכף במסד ולא רק במסך.** טריגרים מצפינים או מאפסים כל ערך שנכתב,
-- מכל מקור: CRM ישן במטמון, הבוט, פונקציית Edge או SQL ישיר. docs/id-numbers.md.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. המפתח. נוצר פעם אחת ב-Vault. **אובדן שלו = אובדן כל הת.ז. של
--    המתווכים** - הוא נכלל בגיבוי של Supabase יחד עם המסד, ואסור למחוק
--    אותו. ‏_id_key() סגורה לכולם: רק פונקציות definer כאן קוראות לה.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'id_number_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'base64'),
      'id_number_key',
      'מפתח ההצפנה של ת.ז. מתווכים (agency_members.id_number_enc). אסור למחוק - docs/id-numbers.md');
  end if;
end $$;

create or replace function public._id_key()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'id_number_key' limit 1;
$$;

revoke all on function public._id_key() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. ‏agency_members: הצפנה בכתיבה
--
-- הטריגר רץ ראשון (‏a_ בשם - טריגרים באותו שלב רצים לפי סדר אלפביתי), כך
-- ששום טריגר אחר לא רואה את הטקסט הגלוי. ‏id_number נשאר עמודה, כדי שכל
-- מי שכותב אליה היום (פתיחת משרד, הפרופיל, האשף) ימשיך לעבוד - אבל היא
-- תמיד ריקה אחרי הכתיבה.
--
-- ‏id_number_enc ו-id_number_last4 נכתבים **רק** מכאן: ערך שהגיע אליהם
-- ישירות (‏update מהדפדפן) נדרס בערך הקודם.
-- ---------------------------------------------------------------------------
alter table public.agency_members add column if not exists id_number_enc bytea;
alter table public.agency_members add column if not exists id_number_last4 text;

comment on column public.agency_members.id_number is
  'נכתבת ולא נקראת: הטריגר מצפין ל-id_number_enc ומאפס. docs/id-numbers.md';
comment on column public.agency_members.id_number_enc is
  'ת.ז. מוצפנת (pgp_sym_encrypt, המפתח ב-Vault: id_number_key). פענוח: my_id_number / member_id_number';

create or replace function public.agency_members_encrypt_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text := nullif(btrim(coalesce(new.id_number, '')), '');
begin
  if v_id is not null then
    new.id_number_enc   := extensions.pgp_sym_encrypt(v_id, public._id_key());
    new.id_number_last4 := right(regexp_replace(v_id, '\D', '', 'g'), 4);
  elsif tg_op = 'UPDATE' then
    new.id_number_enc   := old.id_number_enc;
    new.id_number_last4 := old.id_number_last4;
  else
    new.id_number_enc   := null;
    new.id_number_last4 := null;
  end if;
  new.id_number := null;
  return new;
end;
$$;

revoke all on function public.agency_members_encrypt_id() from public, anon, authenticated;

drop trigger if exists a_agency_members_encrypt_id on public.agency_members;
create trigger a_agency_members_encrypt_id
  before insert or update on public.agency_members
  for each row execute function public.agency_members_encrypt_id();

-- 33 הקיימות. ‏update של id_number לעצמה מפעיל את הטריגר, שמצפין ומאפס.
update public.agency_members
   set id_number = id_number
 where nullif(btrim(coalesce(id_number, '')), '') is not null;

-- ---------------------------------------------------------------------------
-- 3. פענוח: רק לבעל/ת הת.ז., ולשרת
-- ---------------------------------------------------------------------------
create or replace function public.my_id_number()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select extensions.pgp_sym_decrypt(m.id_number_enc, public._id_key())
    from public.agency_members m
   where m.user_id = auth.uid() and m.id_number_enc is not null
   order by m.active desc
   limit 1;
$$;

revoke all on function public.my_id_number() from public, anon, authenticated;
grant execute on function public.my_id_number() to authenticated;

-- הבוט (‏prepare_agreement) בונה הסכם בשם הסוכן/ת, ב-service role.
create or replace function public.member_id_number(p_member uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select extensions.pgp_sym_decrypt(m.id_number_enc, public._id_key())
    from public.agency_members m
   where m.id = p_member and m.id_number_enc is not null;
$$;

revoke all on function public.member_id_number(uuid) from public, anon, authenticated;
grant execute on function public.member_id_number(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. יומן הביקורת: השוואה על הערך המוצפן, כי id_number תמיד ריקה עכשיו.
--    מהגרסה האחרונה (‏20270423095000), והשינוי היחיד הוא שורת הת.ז.
--    הצפנה מחדש של אותו ערך נותנת בתים שונים (IV אקראי), ולכן כל כתיבה של
--    ת.ז. נרשמת כ"שונתה" - גם כשהוקלד אותו מספר. זה המחיר של לא לפענח כאן.
-- ---------------------------------------------------------------------------
create or replace function public.audit_agency_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changes jsonb := '{}'::jsonb;
  v_field   text;
  v_old     jsonb;
  v_new     jsonb;
begin
  if tg_op = 'INSERT' then
    perform public._audit('member_created', new.user_id, new.id::text,
      jsonb_build_object('agency_id', new.agency_id, 'role', new.role,
                         'is_platform_admin', new.is_platform_admin));
    if new.is_platform_admin then
      perform public._alert_platform_admin_granted(new.id, new.display_name);
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform public._audit('member_deleted', old.user_id, old.id::text,
      jsonb_build_object('agency_id', old.agency_id, 'display_name', old.display_name));
    return old;
  end if;

  v_old := to_jsonb(old);
  v_new := to_jsonb(new);
  foreach v_field in array array['role','active','is_platform_admin','agency_id','phone',
                                 'email','license_number','license_status','released_at','closed_at']
  loop
    if v_old->v_field is distinct from v_new->v_field then
      v_changes := v_changes || jsonb_build_object(v_field,
        jsonb_build_object('from', v_old->v_field, 'to', v_new->v_field));
    end if;
  end loop;
  -- ת.ז.: רק שהשתנתה. היומן נקרא על ידי יותר אנשים מהשדה עצמו.
  if old.id_number_enc is distinct from new.id_number_enc then
    v_changes := v_changes || jsonb_build_object('id_number', 'changed');
  end if;

  if v_changes = '{}'::jsonb then return new; end if;

  perform public._audit('member_changed', new.user_id, new.id::text, v_changes);

  if new.is_platform_admin and not coalesce(old.is_platform_admin, false) then
    perform public._alert_platform_admin_granted(new.id, new.display_name);
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. לקוחות ובעלי נכסים: לא נשמרת. הטריגר מאפס כל ערך שמגיע, ואחריו ניקוי
--    של מה שכבר שמור (4 כרטיסי לקוח, 2 בעלי נכס). הת.ז. שלהם נשארת רק
--    בהסכמים שחתמו.
-- ---------------------------------------------------------------------------
create or replace function public.drop_client_id_number()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'property_owners' then
    new.owner_id_number := null;
  else
    new.id_number := null;
  end if;
  return new;
end;
$$;

revoke all on function public.drop_client_id_number() from public, anon, authenticated;

drop trigger if exists a_agent_clients_drop_id_number on public.agent_clients;
create trigger a_agent_clients_drop_id_number
  before insert or update of id_number on public.agent_clients
  for each row execute function public.drop_client_id_number();

drop trigger if exists a_property_owners_drop_id_number on public.property_owners;
create trigger a_property_owners_drop_id_number
  before insert or update of owner_id_number on public.property_owners
  for each row execute function public.drop_client_id_number();

update public.agent_clients set id_number = null where id_number is not null;
update public.property_owners set owner_id_number = null where owner_id_number is not null;

-- ---------------------------------------------------------------------------
-- 6. חותמים: כל חותם/ת משלים/ה ת.ז. בעצמו/ה. בהוספה הת.ז. מתאפסת והחותם/ת
--    מסומן/ת self_fill - הערך מגיע רק מדף החתימה (‏agreement-sign, ‏update
--    ב-service role). חותם/ת קיים/ת וחתום/ה לא נוגעים.
-- ---------------------------------------------------------------------------
create or replace function public.agreement_signers_self_fill()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.id_number := null;
  new.self_fill := true;
  return new;
end;
$$;

revoke all on function public.agreement_signers_self_fill() from public, anon, authenticated;

drop trigger if exists a_agreement_signers_self_fill on public.agreement_signers;
create trigger a_agreement_signers_self_fill
  before insert on public.agreement_signers
  for each row execute function public.agreement_signers_self_fill();

-- ---------------------------------------------------------------------------
-- 7. פתיחת הסכם ב-CRM: גוף המסמך והחותמים מגיעים מכאן, ופתיחה של הסכם
--    חתום נרשמת ביומן. רשימת ההסכמים כבר לא מורידה את גוף המסמך ואת הת.ז.
--    של החותמים (‏loadAgreements). אותה הרשאה כמו ה-RLS: בעל/ת ההסכם בלבד.
--    בלי otp_hash: גיבוב הקוד אינו מעניינו של הדפדפן.
-- ---------------------------------------------------------------------------
create or replace function public.agreement_open(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row     public.agreements%rowtype;
  v_signers jsonb;
begin
  select * into v_row from public.agreements
   where id = p_id and agent_id = public.current_agent_id();
  if v_row.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(to_jsonb(s) - 'otp_hash' order by s.ord), '[]'::jsonb)
    into v_signers
    from public.agreement_signers s
   where s.agreement_id = p_id;

  if v_row.status = 'signed' then
    perform public._audit('agreement_viewed', auth.uid(), p_id::text,
      jsonb_build_object('title', v_row.title));
  end if;

  return to_jsonb(v_row) || jsonb_build_object('signers', v_signers);
end;
$$;

revoke all on function public.agreement_open(uuid) from public, anon, authenticated;
grant execute on function public.agreement_open(uuid) to authenticated;
