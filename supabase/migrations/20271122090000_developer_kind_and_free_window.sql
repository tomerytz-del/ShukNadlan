-- ---------------------------------------------------------------------------
-- יזמים, קבלנים ומשווקי פרויקטים: סוג המפרסם, ושישה חודשי פרסום בחינם (20.11.2026)
--
-- החלטות תומר:
--   1. קטגוריה חדשה: "משווק נדל״ן לפרויקטים חדשים", לצד יזם וקבלן. לא חשבון נפרד:
--      אותה טבלה, אותו ארנק, אותם דפים. עמודה `kind` בלבד.
--   2. פרסום פרויקטים בחינם לכל המפרסמים ל-6 חודשים. מחזור התשלום הקודם (350 ₪ לחודש
--      לכל דף נחיתה, מהארנק) יוצא. אחרי התקופה: מסלול ברמת החשבון, לפי מספר הפרויקטים -
--      199 עד 10, 278 עד 20, 397 מ-21 (כולם לפני מע״מ, לחודש).
--
-- **מה נבנה כאן ומה לא.** כאן: הסוג, חלון החינם, והמחירים ב-pricing_config. **לא נבנה
-- החיוב בפועל של המסלולים**: הוא דורש מנוי ברמת החשבון (לא ברמת הפרויקט), ויש לו חצי
-- שנה עד שיידרש. עד אז `project_activate_page` אחרי סוף החלון **אינה גובה דבר** ומחזירה
-- `plan_required`: לגבות 350 ₪ לפרויקט אחרי שהבטחנו מסלול אחר היה גרוע מלא לגבות כלל.
-- פרויקט שעלה בחלון החינמי יורד מהאתר ביום שהחלון נגמר (`subscription_expires_at`), עד
-- שיהיה מסלול. ‏docs/new-projects.md, "מסלולי מחיר".
--
-- אידמפוטנטית. אין שינוי בקידום (50 ₪ לשבוע) וברכישת ליד (50 ₪): הם נשארים כמו שהם.
-- ---------------------------------------------------------------------------

-- 1. סוג המפרסם
alter table public.developers add column if not exists kind text not null default 'developer';

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.developers'::regclass
                    and conname = 'developers_kind_check') then
    alter table public.developers
      add constraint developers_kind_check
      check (kind in ('developer', 'contractor', 'marketer'));
  end if;
end $$;

comment on column public.developers.kind is
  'סוג המפרסם: developer (יזם), contractor (קבלן), marketer (משווק נדל״ן לפרויקטים חדשים). לא משנה הרשאות או חיוב; מוצג למנהל/ת הפלטפורמה ולדשבורד.';

-- 2. המחירים והחלון (pricing_config הוא מקור האמת; scripts/check_pricing.py מצליב)
insert into public.pricing_config (key, value, description) values
  ('project_free_months',        6,   'חודשי פרסום פרויקטים בחינם לכל חשבון יזם/קבלן/משווק, מרגע פתיחת החשבון'),
  ('project_plan_tier1_max',     10,  'מסלול 1 אחרי התקופה החינמית: עד כמה פרויקטים בחשבון'),
  ('project_plan_tier1_price',   199, '₪ לחודש לחשבון, לפני מע״מ - מסלול 1 (עד project_plan_tier1_max פרויקטים)'),
  ('project_plan_tier2_max',     20,  'מסלול 2 אחרי התקופה החינמית: עד כמה פרויקטים בחשבון'),
  ('project_plan_tier2_price',   278, '₪ לחודש לחשבון, לפני מע״מ - מסלול 2 (עד project_plan_tier2_max פרויקטים)'),
  ('project_plan_tier3_price',   397, '₪ לחודש לחשבון, לפני מע״מ - מסלול 3 (יותר מ-project_plan_tier2_max פרויקטים)')
on conflict (key) do nothing;

-- 3. חלון החינם לכל חשבון
alter table public.developers add column if not exists free_until timestamptz;

-- חשבונות קיימים: 6 חודשים ממועד הכניסה לתוקף של ההחלטה, ולא מיום הפתיחה שלהם
update public.developers
   set free_until = now() + make_interval(months => coalesce(
         (select value::int from public.pricing_config where key = 'project_free_months'), 6))
 where free_until is null;

alter table public.developers alter column free_until set not null;

comment on column public.developers.free_until is
  'סוף חלון הפרסום החינמי של החשבון. נקבע בטריגר בפתיחת החשבון (project_free_months חודשים). פרויקט שעלה בחלון פג ביום הזה.';

-- חשבון חדש: החלון מתחיל בפתיחה. הערך נקבע בטריגר ולא ב-default, כי הוא תלוי ב-pricing_config
create or replace function public.developers_set_free_until()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.free_until is null then
    new.free_until := now() + make_interval(months => coalesce(
      (select value::int from public.pricing_config where key = 'project_free_months'), 6));
  end if;
  return new;
end;
$$;

-- הטריגר אינו נקרא ישירות, ואין סיבה שתפקיד כלשהו יוכל לקרוא לו
revoke execute on function public.developers_set_free_until() from public, anon, authenticated;
grant execute on function public.developers_set_free_until() to service_role;

drop trigger if exists developers_set_free_until on public.developers;
create trigger developers_set_free_until
  before insert on public.developers
  for each row execute function public.developers_set_free_until();

-- 4. הפעלת דף נחיתה: חינם בחלון, ואחריו מסלול (עוד לא נגבה)
create or replace function public.project_activate_page(p_project_id uuid, p_developer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_free_until timestamptz;
begin
  if not exists (select 1 from public.projects
                  where id = p_project_id and developer_id = p_developer_id) then
    return jsonb_build_object('error', 'not_your_project');
  end if;

  select free_until into v_free_until from public.developers where id = p_developer_id;

  -- חלון החינם: הפרויקט באוויר עד סוף החלון, בלי חיוב ובלי שורה ב-project_charges
  if v_free_until is not null and v_free_until > now() then
    update public.projects
       set subscription_status = 'active',
           subscription_started_at = coalesce(subscription_started_at, now()),
           subscription_expires_at = v_free_until,
           status = case when status = 'draft' then 'active' else status end
     where id = p_project_id;
    return jsonb_build_object('success', true, 'price_charged', 0, 'free', true, 'expires_at', v_free_until);
  end if;

  -- אחרי החלון: מסלול ברמת החשבון (עוד לא נבנה). לא גובים 350 ₪ לפרויקט
  return jsonb_build_object('error', 'plan_required', 'free_until', v_free_until);
end;
$$;

revoke execute on function public.project_activate_page(uuid, uuid) from public, anon, authenticated;
grant execute on function public.project_activate_page(uuid, uuid) to service_role;
