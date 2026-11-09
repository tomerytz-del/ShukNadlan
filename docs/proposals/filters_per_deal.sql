-- ============================================================================
-- שדות מקצועיים לסינון לפי עסקה, ותיקון price_per_sqm (PR 1010, P1-N2, ד-8, ד-9).
-- הצעה (‏docs/proposals): לא רצה. תומר מאשר ומעביר ל-supabase/migrations עם version חדש.
--
-- לבדוק לפני ההרצה:
--   * ‏alter column ... set expression דורש Postgres 17 ומשכתב את הטבלה (נעילה) - בשעה שקטה.
--   * ה-check על project_status מתיר כאן null (במקור לא; שורות בלי סטטוס היו נכשלות).
--   * ‏public.developers חייבת להתקיים (‏developer_id).
--   * בלי מילוי לאחור מהטקסט ובלי ניחוש (‏high_ceiling לא הופך ל-4 מ'). המילוי מיועצי הנדל״ן.
--   * ל-anon יש SELECT ברמת הטבלה, ולכן העמודות נקראות בלי grant. להוסיף אותן ל-PROPERTY_SELECT
--     (‏assets/home.js) ולשליפה של /swipe **רק אחרי** ההרצה - אחרת PostgREST מחזיר 400.
-- ============================================================================

-- P1-N: שדות לסינון מתקדם לפי עסקה. נכתב ולא הורץ.
begin;
alter table public.properties
  -- מסחרי
  add column if not exists ceiling_height_m  numeric(4,2) check (ceiling_height_m is null or ceiling_height_m between 2 and 30),
  add column if not exists floor_load_kg_m2  integer      check (floor_load_kg_m2 is null or floor_load_kg_m2 between 100 and 20000),
  add column if not exists power_amps        smallint     check (power_amps is null or power_amps between 16 and 4000),
  add column if not exists power_phases      smallint     check (power_phases is null or power_phases in (1, 3)),
  add column if not exists parking_spaces    smallint     check (parking_spaces is null or parking_spaces between 0 and 1000),
  add column if not exists min_unit_sqm      numeric      check (min_unit_sqm is null or min_unit_sqm > 0),
  add column if not exists permitted_uses    text[] not null default '{}'
    check (permitted_uses <@ array['offices','retail','industry','crafts','storage','food','clinic','events']::text[]),
  add column if not exists business_license  text check (business_license is null or business_license in ('possible','exists','not_possible')),
  add column if not exists office_layout     text check (office_layout is null or office_layout in ('open','rooms','mixed')),
  -- שכירות
  add column if not exists rent_term         text check (rent_term is null or rent_term in ('long','short','sublet')),
  add column if not exists min_lease_months  smallint check (min_lease_months is null or min_lease_months between 1 and 120),
  add column if not exists price_includes    text[] not null default '{}'
    check (price_includes <@ array['water','arnona','vaad','electricity','internet','gas']::text[]),
  add column if not exists electricity_allowance_kwh smallint check (electricity_allowance_kwh is null or electricity_allowance_kwh between 1 and 5000),
  add column if not exists electricity_allowance_ils smallint check (electricity_allowance_ils is null or electricity_allowance_ils between 1 and 5000),
  add column if not exists furnishing        text check (furnishing is null or furnishing in ('none','partial','full')),
  add column if not exists furniture_items   text[] not null default '{}'
    check (furniture_items <@ array['fridge','washer','ac','bed','sofa','oven','microwave','closets']::text[]),
  add column if not exists pets_allowed      boolean,
  add column if not exists smoking_allowed   boolean,
  add column if not exists roommates_ok      boolean,
  add column if not exists guarantees        text[] not null default '{}'
    check (guarantees <@ array['checks','bank_guarantee','guarantors','deposit']::text[]),
  add column if not exists payments_count    smallint check (payments_count is null or payments_count between 1 and 12),
  add column if not exists no_broker_fee     boolean,   -- חדש: החלטת תומר 3 (הצהרת הסוכן, לא היריד)
  -- מכירה
  add column if not exists developer_id      uuid references public.developers(id) on delete set null,
  add column if not exists developer_name    text check (developer_name is null or char_length(developer_name) <= 80),
  add column if not exists payment_plan      text check (payment_plan is null or payment_plan in ('standard','20_80','10_90','other')),
  add column if not exists index_linked      boolean,
  add column if not exists discount_program  text check (discount_program is null or discount_program in ('mechir_lamishtaken','dira_behanaha','mechir_matara')),
  add column if not exists renewal_type      text check (renewal_type is null or renewal_type in ('tama38_1','tama38_2','pinui_binui')),
  add column if not exists land_registration text check (land_registration is null or land_registration in ('tabu','rmi','housing_company','other'));

-- "בבנייה" נוסף לסטטוס הפרויקט
alter table public.properties drop constraint if exists properties_project_status_check;
alter table public.properties add constraint properties_project_status_check
  check (project_status is null or project_status = any (array['planning','permit_requested','permit_issued','under_construction','construction_complete']::text[]));

-- מחיר למ"ר: ב-price_unit='sqm' המחיר כבר למ"ר (13 נכסים מסחריים יצאו 0–2 ₪)
alter table public.properties alter column price_per_sqm set expression as (
  case
    when price_unit = 'sqm' then round(price)
    when size_sqm is not null and size_sqm > 0 then round(price / size_sqm)
    else null
  end);

comment on column public.properties.power_amps is 'אמפר לפאזה (3×63 ← 63, power_phases=3)';
comment on column public.properties.price_includes is 'שכירות: מה כלול במחיר החודשי';
commit;
