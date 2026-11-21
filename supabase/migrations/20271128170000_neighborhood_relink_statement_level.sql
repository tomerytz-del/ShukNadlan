-- קישור מחדש של עסקאות לשכונה: פעם אחת לכל עיר בפקודה, ולא פעם לכל שורה
--
-- הטריגרים neighborhoods_relink_deals ו-neighborhood_aliases_relink_deals
-- (20270114091000) היו FOR EACH ROW, וכל שורה הריצה את
-- market_deals_official_relink_city על כל עסקאות העיר. ברמת גן זה כ-9 שניות
-- (1,623 עסקאות עם שם שכונה, ‏neighborhood_ids_for בכל אחת), ולכן insert של
-- 11 שכונות עבר את שתי הדקות של db push. ההרצה אחרי #1378 (21.11.2026)
-- נכשלה כך, בלי להחיל דבר, ופוצלה לארבעה קבצים כעקיפה (#1384). השורש כאן.
--
-- מה משתנה: אותם שני טריגרים, ברמת פקודה עם טבלת מעבר (REFERENCING). פקודה
-- שנוגעת בכמה שורות של אותה עיר מקשרת מחדש את העיר פעם אחת, ופקודה שלא נגעה
-- בשום שורה (INSERT ... ON CONFLICT DO NOTHING שהכול בו קיים) לא מקשרת כלום.
-- התוצאה הסופית זהה: הקישור מחושב מכל השכונות והכינויים של העיר אחרי הפקודה,
-- ולא מהמצב באמצע, ולכן אין הבדל במה שנכתב בעסקאות.
--
-- שני הבדלים קטנים, שניהם לכיוון הנכון:
--   * טבלת מעבר אסורה יחד עם רשימת עמודות (UPDATE OF name, city_id), ולכן
--     ה-UPDATE יורה על כל עדכון שורה, והפונקציה מסננת: רק שינוי בשם, בעיר
--     (בשכונה) או בכינוי, בשכונה ובדגל המשותף (בכינוי) מקשר מחדש.
--     עדכון של גבול או קואורדינטות לא מקשר כלום, כמו קודם.
--   * מעבר שכונה או כינוי בין ערים מקשר מחדש גם את העיר הישנה. קודם רק החדשה,
--     והעסקאות בעיר הישנה נשארו מצביעות על מה שכבר אינו שלה.
--
-- אין השפעה על הנתונים בהרצה: רק הגדרות. אידמפוטנטית.

-- ---------------------------------------------------------------------------
-- שכונות
-- ---------------------------------------------------------------------------
create or replace function public.neighborhoods_relink_deals_stmt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_city uuid;
begin
  -- שמות טבלאות המעבר (new_rows, old_rows) מוגדרים בטריגר; ל-INSERT אין old_rows.
  if tg_op = 'INSERT' then
    for v_city in
      select distinct n.city_id from new_rows n where n.city_id is not null
    loop
      perform public.market_deals_official_relink_city(v_city);
    end loop;
  else
    for v_city in
      select c.city_id
        from new_rows n
        join old_rows o on o.id = n.id
        cross join lateral (values (n.city_id), (o.city_id)) as c(city_id)
       where c.city_id is not null
         and (n.name is distinct from o.name or n.city_id is distinct from o.city_id)
       group by c.city_id
    loop
      perform public.market_deals_official_relink_city(v_city);
    end loop;
  end if;
  return null;
end;
$$;

revoke all on function public.neighborhoods_relink_deals_stmt() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- כינויי שכונה
-- ---------------------------------------------------------------------------
create or replace function public.neighborhood_aliases_relink_deals_stmt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_city uuid;
begin
  if tg_op = 'INSERT' then
    for v_city in
      select distinct h.city_id
        from new_rows a
        join public.neighborhoods h on h.id = a.neighborhood_id
       where h.city_id is not null
    loop
      perform public.market_deals_official_relink_city(v_city);
    end loop;
  else
    for v_city in
      select h.city_id
        from new_rows a
        join old_rows o on o.id = a.id
        cross join lateral (values (a.neighborhood_id), (o.neighborhood_id)) as x(neighborhood_id)
        join public.neighborhoods h on h.id = x.neighborhood_id
       where h.city_id is not null
         and (a.alias is distinct from o.alias
              or a.neighborhood_id is distinct from o.neighborhood_id
              or a.shared is distinct from o.shared)
       group by h.city_id
    loop
      perform public.market_deals_official_relink_city(v_city);
    end loop;
  end if;
  return null;
end;
$$;

revoke all on function public.neighborhood_aliases_relink_deals_stmt() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- החלפת הטריגרים. הישנים נופלים קודם, כדי שאף פקודה לא תירה פעמיים.
-- ---------------------------------------------------------------------------
drop trigger if exists neighborhoods_relink_deals on public.neighborhoods;
drop trigger if exists neighborhood_aliases_relink_deals on public.neighborhood_aliases;
drop trigger if exists neighborhoods_relink_deals_ins on public.neighborhoods;
drop trigger if exists neighborhoods_relink_deals_upd on public.neighborhoods;
drop trigger if exists neighborhood_aliases_relink_deals_ins on public.neighborhood_aliases;
drop trigger if exists neighborhood_aliases_relink_deals_upd on public.neighborhood_aliases;

create trigger neighborhoods_relink_deals_ins
  after insert on public.neighborhoods
  referencing new table as new_rows
  for each statement execute function public.neighborhoods_relink_deals_stmt();

create trigger neighborhoods_relink_deals_upd
  after update on public.neighborhoods
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.neighborhoods_relink_deals_stmt();

create trigger neighborhood_aliases_relink_deals_ins
  after insert on public.neighborhood_aliases
  referencing new table as new_rows
  for each statement execute function public.neighborhood_aliases_relink_deals_stmt();

create trigger neighborhood_aliases_relink_deals_upd
  after update on public.neighborhood_aliases
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.neighborhood_aliases_relink_deals_stmt();

-- הפונקציה הישנה (ברמת שורה) אינה בשימוש אחרי ההחלפה.
drop function if exists public.neighborhood_relink_deals();

do $$
declare v_n integer;
begin
  select count(*) into v_n
    from pg_trigger t
   where not t.tgisinternal
     and t.tgname in ('neighborhoods_relink_deals_ins', 'neighborhoods_relink_deals_upd',
                      'neighborhood_aliases_relink_deals_ins', 'neighborhood_aliases_relink_deals_upd')
     and (t.tgtype & 1) = 0;   -- ביט 1 = FOR EACH ROW
  if v_n <> 4 then
    raise warning 'צפויים 4 טריגרים ברמת פקודה לקישור עסקאות לשכונה; נמצאו %', v_n;
  else
    raise notice 'קישור עסקאות לשכונה: 4 טריגרים ברמת פקודה';
  end if;
end $$;
