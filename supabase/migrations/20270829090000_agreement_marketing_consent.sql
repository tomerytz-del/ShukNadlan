-- ===========================================================================
-- בלעדיות = שני מסמכים: הסכמה לפעולות שיווק, ואחריה ההזמנה בבלעדיות
--
-- חוק המתווכים במקרקעין מחייב מתווך/ת שמחתים/ה בלעדיות לפרט את פעולות
-- השיווק **במסמך נפרד**. עד היום הן היו נספח בתוך טופס הבלעדיות - מסמך אחד,
-- חתימה אחת. מעכשיו כל בלעדיות נוצרת כשני הסכמים:
--
--   1. ‏marketing_sell / marketing_landlord - "הסכמה לביצוע פעולות שיווק"
--   2. ‏exclusive_sell / exclusive_landlord - ההזמנה בבלעדיות, עם
--      ‏marketing_consent_id שמצביע על הראשון
--
-- לשניהם אותם חותמים באותו סדר (ord), ולכל אחד verify_code, עותק חתום וגוף
-- נעול משלו. דף החתימה מעביר את החותם/ת מהראשון לשני בלי אימות נוסף
-- (agreement-sign: האימות של ההסכמה חל על הבלעדיות שאחריה).
--
-- מה שכאן מבטיח את הסדר גם מחוץ לדף החתימה (לוח החתימה ב-CRM, קריאה ישירה):
--   • חתימה על הבלעדיות נדחית כל עוד אותו/ה חותם/ת (אותו ord) לא חתם/ה על
--     ההסכמה שלה - agreement_signers_consent_first.
--   • שליחה וביטול עוברים מאחד לשני - agreements_bundle_status. הסכמה
--     שנשארה draft אינה נעולה (agreements_freeze_body), ולכן היא יוצאת לחתימה
--     יחד עם הבלעדיות; וביטול של אחד בלי השני משאיר מסמך יתום שנראה תקף.
--
-- הסכמי בלעדיות ישנים (בלי marketing_consent_id) אינם משתנים: הנספח נמצא
-- בתוך הגוף הנעול שלהם.
-- ===========================================================================

-- 1. שני סוגי ההסכם החדשים
alter table public.agreements drop constraint if exists agreements_kind_check;
alter table public.agreements add constraint agreements_kind_check
  check (kind in ('buy','sell','tenant','landlord',
                  'exclusive_sell','exclusive_landlord',
                  'marketing_sell','marketing_landlord'));

-- 2. הקישור. ‏on delete cascade: מחיקת טיוטת ההסכמה מוחקת גם את הבלעדיות
--    שתלויה בה - בלעדיות בלי המסמך הנפרד אינה מה שהחוק מכיר.
alter table public.agreements
  add column if not exists marketing_consent_id uuid
    references public.agreements(id) on delete cascade;

create unique index if not exists agreements_marketing_consent_key
  on public.agreements (marketing_consent_id)
  where marketing_consent_id is not null;

comment on column public.agreements.marketing_consent_id is
  'בהזמנה בבלעדיות: טופס ההסכמה לפעולות שיווק שנחתם לפניה, במסמך נפרד כנדרש בחוק המתווכים. אותם חותמים, אותו ord.';

-- 3. הסדר: הבלעדיות נחתמת רק אחרי ההסכמה, לכל חותם/ת בנפרד
create or replace function public.agreement_signers_consent_first()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_consent uuid;
  v_signed  timestamptz;
begin
  if new.signed_at is null or old.signed_at is not null then
    return new;
  end if;

  select a.marketing_consent_id into v_consent
    from public.agreements a where a.id = new.agreement_id;
  if v_consent is null then
    return new;
  end if;

  select s.signed_at into v_signed
    from public.agreement_signers s
   where s.agreement_id = v_consent and s.ord = new.ord;

  -- חותם/ת שאין לו/לה שורה בהסכמה (נוסף/ה אחרי היצירה) - אין מה לאכוף
  if found and v_signed is null then
    raise exception 'marketing_consent_first'
      using hint = 'יש לחתום קודם על טופס ההסכמה לפעולות שיווק, ורק אחריו על הבלעדיות.';
  end if;
  return new;
end;
$$;

revoke execute on function public.agreement_signers_consent_first() from public, anon, authenticated;

drop trigger if exists agreement_signers_consent_first on public.agreement_signers;
create trigger agreement_signers_consent_first
  before update on public.agreement_signers
  for each row execute function public.agreement_signers_consent_first();

-- 4. שליחה וביטול - לשני המסמכים יחד
create or replace function public.agreements_bundle_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'sent' then
    -- ההסכמה יוצאת לחתימה יחד עם הבלעדיות, ובאותו רגע ננעלת
    update public.agreements c
       set status = 'sent', sent_at = coalesce(c.sent_at, new.sent_at, now())
     where c.id = new.marketing_consent_id and c.status = 'draft';
    update public.agreements e
       set status = 'sent', sent_at = coalesce(e.sent_at, new.sent_at, now())
     where e.marketing_consent_id = new.id and e.status = 'draft';
  elsif new.status = 'cancelled' then
    update public.agreements c
       set status = 'cancelled', cancelled_at = coalesce(c.cancelled_at, now())
     where c.id = new.marketing_consent_id and c.status <> 'cancelled';
    update public.agreements e
       set status = 'cancelled', cancelled_at = coalesce(e.cancelled_at, now())
     where e.marketing_consent_id = new.id and e.status <> 'cancelled';
  end if;
  return new;
end;
$$;

revoke execute on function public.agreements_bundle_status() from public, anon, authenticated;

drop trigger if exists agreements_bundle_status on public.agreements;
create trigger agreements_bundle_status
  after update of status on public.agreements
  for each row execute function public.agreements_bundle_status();
