-- ============================================================================
-- ‏agencies.city_id — איפה יושב משרד התיווך
--
-- ## מה זה פותר
--
-- ל-`agencies` אין שום עמודה גאוגרפית. יש `address` טקסטואלי, ו-
-- `agency_members.service_area` שהוא טקסט חופשי לתצוגה. כלומר אי אפשר
-- לשאול **"אילו משרדים באזור שלי"** — וזו בדיוק השאלה שהיקף השת״פ נשען
-- עליה (‏`agency_in_share_scope`, מיגרציה עתידית).
--
-- ## ההיקף נמדד על העיר של המשרד **המקבל**
--
-- לא על העיר של הנכס. זה מה שהמתווך/ת בוחר/ת בפועל במסך ההגדרות: "עם מי
-- אני עובד/ת בשיתוף פעולה". שתי הקריאות מתלכדות כשהנכסים בעיר של המשרד,
-- ונפרדות בנכס מחוץ לעיר — ושם הכוונה ברורה: הוא/היא לא רוצה שהנכס שלו/ה
-- בכרמיאל יגיע למשרד באילת.
--
-- ## ‏null אינו מוציא משרד מהשיתוף
--
-- האסימטריה מוצהרת: המחיר של שיתוף-יתר הוא התראה אחת; המחיר של שיתוף-חסר
-- הוא חור בלתי-נראה בשוק שאיש לא יכול לאבחן. משרד בלי `city_id` נשאר
-- ביעדי ההפצה בכל היקף. אותו היגיון fail-open של `_shared/company-registry.ts`.
--
-- ## שלוש שכבות להשלמה, לפי סדר
--
--   1. פענוח `agencies.address` — הכתובת הרשומה היא מיקום המשרד, וזו
--      המשמעות של "האזור שלי".
--   2. העיר השכיחה בנכסים הפעילים של המשרד.
--   3. ‏null.
--
-- ## מה נבדק לפני הכתיבה
--
-- על `agencies` יושבים שלושה טריגרים בלבד, ושניהם שרצים על `update`
-- נבדקו: `protect_agency_ethics_fields` הוא `before` שרק משמר שדות ואינו
-- זורק (ובהרצת מיגרציה הוא מזהה `postgres`/`supabase_admin` ויוצא מיד),
-- ו-`agencies_onboarding_nudge` מגודר למנהל/ת באמצע אונבורדינג בלי נכסים —
-- **רדיוס הפגיעה כרגע הוא אפס שורות**. ה-backfill כאן שקט.
--
-- תיעוד: docs/cities-and-regions.md
-- ============================================================================

alter table public.agencies
  add column if not exists city_id uuid references public.cities(id) on delete set null;

comment on column public.agencies.city_id is
  'העיר שבה יושב המשרד, לצורך היקף השת״פ. null אינו מוציא משרד מהשיתוף - ראו מיגרציה 20261212090000.';

create index if not exists agencies_city_id_idx on public.agencies (city_id);

-- ---------------------------------------------------------------------------
-- פענוח עיר מכתובת חופשית
--
-- הכתובות במסד נראות כך: "חטיבה תשע 18 עפולה", "העלייה 3 עפולה". העיר היא
-- **הסיומת**, ומספר המילים בה אינו קבוע: "עפולה" אחת, "באר שבע" שתיים,
-- "תל אביב יפו" שלוש.
--
-- לכן: מנרמלים את הכתובת כולה במפתח הערים, מייצרים את הסיומות באורך 1 עד 4
-- מילים, ומתאימים מול הרישום כש**הארוכה ביותר גוברת**. בלי כלל האורך,
-- "רחוב הרצל 12 באר שבע" היה נפתר ל-"שבע" אם היישוב הזה היה קיים.
--
-- נבדק מול חמש הכתובות האמיתיות שבמסד ומול מקרי קצה רב-מיליים לפני הכתיבה.
-- ---------------------------------------------------------------------------
create or replace function public.city_id_from_address(p_address text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  with w as (
    select string_to_array(public.city_name_key(p_address), ' ') as parts
     where nullif(btrim(coalesce(p_address, '')), '') is not null
  ),
  suffix as (
    select s.n,
           array_to_string(w.parts[array_length(w.parts,1)-s.n+1 : array_length(w.parts,1)], ' ') as key
      from w, generate_series(1, 4) as s(n)
     where array_length(w.parts,1) >= s.n
  )
  select id from (
    select c.id, s.n
      from suffix s
      join public.cities c on c.active and c.name_key = s.key
     union all
    select a.city_id, s.n
      from suffix s
      join public.city_aliases a on a.alias_key = s.key
      join public.cities c on c.id = a.city_id and c.active
  ) m
  order by n desc   -- הסיומת הארוכה ביותר גוברת
  limit 1;
$$;

comment on function public.city_id_from_address(text) is
  'מחלץ עיר מסיומת של כתובת חופשית. הסיומת הארוכה ביותר גוברת, אחרת "באר שבע" היה נפתר ל-"שבע".';

revoke all on function public.city_id_from_address(text) from public;
grant execute on function public.city_id_from_address(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- הטריגר
--
-- ‏insert תמיד; ‏update רק כש-`city_id` **ריק**. משרד חדש מקבל שיוך מעצמו,
-- ושיוך שמנהל/ת פלטפורמה קבע/ה ידנית לא נדרס בעריכת כתובת. טריגר שמשכתב
-- בשקט החלטה אנושית גרוע מטריגר שאינו קיים.
-- ---------------------------------------------------------------------------
create or replace function public.agencies_set_city_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.city_id is null then
    new.city_id := public.city_id_from_address(new.address);
  end if;
  return new;
end $$;

drop trigger if exists agencies_set_city_id_trg on public.agencies;
create trigger agencies_set_city_id_trg
  before insert or update of address on public.agencies
  for each row execute function public.agencies_set_city_id();

-- ---------------------------------------------------------------------------
-- ההשלמה
--
-- ‏service_role בלבד. מחזירה כמה משרדים נפתרו ומאיזו שכבה, כדי שההרצה
-- תהיה ניתנת לבדיקה ולא רק "רץ".
-- ---------------------------------------------------------------------------
create or replace function public.agencies_backfill_city_id()
returns table (from_address integer, from_properties integer, still_null integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_addr integer := 0;
  v_prop integer := 0;
begin
  -- שכבה 1: הכתובת הרשומה
  update public.agencies a
     set city_id = public.city_id_from_address(a.address)
   where a.city_id is null
     and public.city_id_from_address(a.address) is not null;
  get diagnostics v_addr = row_count;

  -- שכבה 2: העיר השכיחה בנכסים הפעילים
  update public.agencies a
     set city_id = t.city_id
    from (
      select p.agency_id, p.city_id, count(*) as n,
             row_number() over (partition by p.agency_id order by count(*) desc, p.city_id) as rn
        from public.properties p
       where p.status = 'active' and p.city_id is not null
       group by p.agency_id, p.city_id
    ) t
   where t.agency_id = a.id and t.rn = 1 and a.city_id is null;
  get diagnostics v_prop = row_count;

  return query
    select v_addr, v_prop,
           (select count(*)::int from public.agencies where city_id is null);
end $$;

comment on function public.agencies_backfill_city_id() is
  'משלים agencies.city_id בשתי שכבות: כתובת רשומה, ואז העיר השכיחה בנכסים הפעילים. מחזירה פירוט לפי שכבה. service_role בלבד.';

revoke all on function public.agencies_backfill_city_id() from public, anon, authenticated;
grant execute on function public.agencies_backfill_city_id() to service_role;

-- ‏no-op בהרצה הראשונה: `cities` ריקה, ולכן שתי השכבות מחזירות null.
-- הקריאה נשארת כדי שהמיגרציה תהיה שלמה בפני עצמה — הרצה חוזרת אחרי
-- מיגרציית ההזנה תשלים בפועל.
do $$
declare r record;
begin
  select * into r from public.agencies_backfill_city_id();
  raise notice 'agencies.city_id: % מכתובת, % מנכסים, % נותרו ריקים',
    r.from_address, r.from_properties, r.still_null;
end $$;
