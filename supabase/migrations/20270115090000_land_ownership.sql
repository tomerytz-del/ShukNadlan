-- ============================================================================
-- סוג הבעלות בקרקע, לפי גוש/חלקה - מפנקסי המקרקעין (טאבו)
--
-- מקור: משרד המשפטים, "סוג בעלות בנכסים הרשומים בפנקסי המקרקעין",
-- ‏data.gov.il (‏tabu_asset). הטעינה: ‏`land_ownership_loader.py` מ-
-- ‏`.github/workflows/land_ownership.yml`. הפירוט: ‏`docs/land-ownership.md`.
--
-- ## למה זה שווה טבלה
--
-- "קרקע מדינה" פירושה בפועל חכירה מרמ"י ולא בעלות: הסכמת רמ"י להעברה,
-- לפעמים דמי היתר, והשפעה על המשכנתא. ב-26.9.2026 נמצאו במאגר 90.7% מ-
-- 15,191 העסקאות שלנו, וכ-35% מהן על קרקע מדינה - בכרמיאל יותר ממחצית.
-- כלומר זה שדה שמבדיל בפועל בין עסקאות, ולא הערת שוליים.
--
-- ## שורה לחלקה, לא לתת-חלקה
--
-- הקובץ המקורי הוא 2.87 מיליון שורות - שורה לכל דירה. ב-96.5% מהחלקות
-- כל התת-חלקות באותו סוג בעלות, ולכן נשמרת שורה לחלקה (‏1.13 מיליון),
-- עם הסוג הנפוץ ו-`mixed_units` כשיש יותר מסוג אחד.
--
-- ## רק "מוסדר"
--
-- שורות עם "תיאור שיטה" (גוש שומה, ספר-דף, זכויות ירדני) הן מספור אחר.
-- ‏171 מהן מתנגשות במספר גוש/חלקה מוסדר, ו-116 מהן בסוג בעלות **אחר** -
-- כלומר צירוף שלהן היה מחזיר לעסקה בעלות של חלקה אחרת. הטוען מדלג עליהן
-- וסופר אותן; העסקאות, ה-GIS ו-GovMap משתמשים במספור המוסדר.
-- ============================================================================

create table if not exists public.land_ownership (
  gush        integer  not null,
  helka       integer  not null,
  -- ‏P פרטית · S מדינה · L רשות מקומית · M מעורב · O אחר (הקטגוריות של המקור)
  ownership   char(1)  not null,
  -- יש בחלקה תת-חלקות בסוג בעלות אחר מזה שב-`ownership`
  mixed_units boolean  not null default false,
  -- ההרצה שכתבה את השורה. שורה שאינה מההרצה האחרונה שהסתיימה נמחקת בסופה.
  batch       text     not null,
  primary key (gush, helka)
);

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.land_ownership'::regclass
                    and conname  = 'land_ownership_kind_chk') then
    alter table public.land_ownership
      add constraint land_ownership_kind_chk check (ownership in ('P','S','L','M','O'));
  end if;
end $$;

comment on table public.land_ownership is
  'סוג בעלות לפי גוש/חלקה מפנקסי המקרקעין (משרד המשפטים). אינו קובע זכות משפטית. docs/land-ownership.md';

-- יומן טעינה. ‏source_modified הוא מה שמונע טעינה חוזרת של אותו קובץ:
-- ‏1.13 מיליון upsert בכל חודש על נתונים שלא השתנו הם רק bloat.
create table if not exists public.land_ownership_loads (
  id              bigserial    primary key,
  batch           text         not null unique,
  source_url      text,
  source_modified timestamptz,
  status          text         not null default 'running',
  rows_read       integer,
  rows_skipped    integer,       -- לא מוסדר: נספר, לא נטען
  rows_rejected   integer,       -- פגום: גוש/חלקה לא מספרי, סוג לא מוכר
  parcels         integer,
  error           text,
  started_at      timestamptz  not null default now(),
  finished_at     timestamptz
);

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.land_ownership_loads'::regclass
                    and conname  = 'land_ownership_loads_status_chk') then
    alter table public.land_ownership_loads
      add constraint land_ownership_loads_status_chk check (status in ('running','done','failed'));
  end if;
end $$;

-- ‏RLS בלי policy: אין קריאה מהדפדפן. הבוט והטוען רצים ב-service_role,
-- ודוח ה-CMA קורא דרך פונקציה security definer.
alter table public.land_ownership       enable row level security;
alter table public.land_ownership_loads enable row level security;
revoke all on table public.land_ownership       from anon, authenticated;
revoke all on table public.land_ownership_loads from anon, authenticated;

-- ---------------------------------------------------------------------------
-- סיום טעינה: מחליף את הנתונים הישנים רק אם החדשים שלמים
--
-- הטוען כותב במנות, ולכן בזמן הטעינה הטבלה מערבבת שתי הרצות. זה בסדר:
-- כל שורה נכונה לעצמה. מה שאסור הוא למחוק את הישנות לפני שהחדשות כולן
-- נכתבו - ולכן המחיקה כאן, בסוף, ורק אחרי בדיקת סף.
--
-- ‏**הסף הוא מה שמגן מקובץ חלקי.** הורדה שנקטעה מחזירה CSV תקין עם חצי
-- מהשורות; בלי הסף, סיום "מוצלח" היה מוחק חצי מדינה.
-- ---------------------------------------------------------------------------
create or replace function public.land_ownership_finish(
  p_batch       text,
  p_min_parcels integer default 900000
)
returns jsonb
language plpgsql
security definer
set search_path to ''
set statement_timeout to '120s'
as $$
declare
  v_count   integer;
  v_deleted integer;
begin
  select count(*) into v_count from public.land_ownership where batch = p_batch;

  if v_count < p_min_parcels then
    update public.land_ownership_loads
       set status = 'failed', finished_at = now(),
           error = format('רק %s חלקות נכתבו, הסף %s. הנתונים הקודמים נשארו.', v_count, p_min_parcels)
     where batch = p_batch;
    return jsonb_build_object('ok', false, 'parcels', v_count, 'min', p_min_parcels);
  end if;

  delete from public.land_ownership where batch <> p_batch;
  get diagnostics v_deleted = row_count;

  update public.land_ownership_loads
     set status = 'done', finished_at = now(), parcels = v_count
   where batch = p_batch;

  return jsonb_build_object('ok', true, 'parcels', v_count, 'deleted', v_deleted);
end;
$$;

revoke all on function public.land_ownership_finish(text, integer) from public, anon, authenticated;
grant execute on function public.land_ownership_finish(text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- שאילתה לחלקה אחת - לעוזר בוואטסאפ
--
-- מקבלת text כי כך הגוש והחלקה מגיעים מכל מקור (‏market_deals_official
-- מחזיקה אותם כ-text, ה-WFS כמחרוזת). הנרמול כאן: ספרות בלבד, בלי אפסים
-- מובילים - "016742" ו-"16742" הם אותו גוש.
--
-- ‏null = אין במאגר (קרקע לא מוסדרת, חלקה שעוד לא נרשמה, או שאין טעינה).
-- זו לא "פרטית": היעדר אינו ראיה לסוג בעלות.
-- ---------------------------------------------------------------------------
create or replace function public.land_ownership_of(p_gush text, p_helka text)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select jsonb_build_object(
           'ownership',   o.ownership,
           'mixed_units', o.mixed_units,
           'as_of',       (select l.source_modified from public.land_ownership_loads l
                            where l.status = 'done' order by l.finished_at desc limit 1))
    from public.land_ownership o
   -- ‏nullif לפני ה-cast, ו-left(…, 9) לפניו: SQL אינו מבטיח סדר הערכה בין
   -- תנאים, ולכן בדיקה נפרדת "שלא ריק" לא הייתה מונעת cast של '' שזורק.
   -- גוש ארוך מתשע ספרות אינו קיים (המקסימום במקור הוא שמונה).
   where o.gush  = nullif(left(regexp_replace(coalesce(p_gush,  ''), '\D', '', 'g'), 9), '')::integer
     and o.helka = nullif(left(regexp_replace(coalesce(p_helka, ''), '\D', '', 'g'), 9), '')::integer;
$$;

revoke all on function public.land_ownership_of(text, text) from public, anon, authenticated;
grant execute on function public.land_ownership_of(text, text) to service_role;
