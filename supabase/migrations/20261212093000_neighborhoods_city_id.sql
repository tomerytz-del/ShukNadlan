-- ============================================================================
-- ‏neighborhoods.city_id — הזנב השלישי של רישום הערים
--
-- ## למה זה לא יכול להישאר טקסט
--
-- ‏`neighborhoods.city` הוא טקסט חופשי, בדיוק כמו `properties.city` היה לפני
-- ‏M2 ו-`agencies` לפני M3. אבל כאן יש סיבה נוספת וספציפית:
--
-- ‏`ssaCityFromText()` (‏`assets/home.js:4235`) גוזרת את **רשימת הערים של
-- החיפוש החכם** מהטבלה הזו, ו-`renderHoodFilter()` (3488) מסתירה את סרגל
-- השכונות כשאין בה שורות. כלומר עיר בלי שכונות אינה קיימת מבחינת החיפוש
-- החכם והחיפושים השמורים — בלי שגיאה, בלי אזהרה, פשוט יכולת שאינה שם.
--
-- ברגע שהאתר ארצי, "איזו עיר" חייבת להיות שאלה עם תשובה אחת. השוואת
-- מחרוזות תיתן שתי תשובות ל-"עפולה" ו-"עפולה עילית" ביום שבו מישהו יקליד
-- את השנייה בשדה `city` של שכונה.
--
-- ## מה שונה כאן מ-M2
--
-- אין כאן מלכודת backfill: על `neighborhoods` אין 21 טריגרים, והטבלה מונה
-- ‏14 שורות. לכן `update` אחד גורף הוא הדבר הנכון, ומנות היו סיבוך בלי
-- סיבה. ‏M2 נכתב במנות בגלל `properties`, לא בגלל העיקרון.
--
-- תיעוד: docs/cities-and-regions.md
-- ============================================================================

alter table public.neighborhoods
  add column if not exists city_id uuid references public.cities(id) on delete set null;

comment on column public.neighborhoods.city_id is
  'העיר מרישום הערים. nullable לעד — שכונה בעיר שטרם הוזנה לרישום אינה נחסמת. neighborhoods.city נשאר מקור התצוגה.';

create index if not exists neighborhoods_city_id_idx
  on public.neighborhoods (city_id) where city_id is not null;

-- ---------------------------------------------------------------------------
-- הטריגר
--
-- ‏before insert or update **of city** — אותה תבנית בדיוק של
-- ‏`properties_set_city_id`. טריגר `before` שכותב ל-NEW בלבד, בלי update נוסף.
--
-- וכמו שם: **הטריגר אינו משכתב את `neighborhoods.city`.** מי שמפרסם נכס
-- בוחר שכונה לפי `neighborhood_id`, אבל `hoodState` ב-`home.js` עדיין קורא
-- את השם ואת העיר כטקסט, ויישור כתיב בצד אחד בלי השני הוא בדיוק סוג השינוי
-- השקט ש-M2 נמנע ממנו.
-- ---------------------------------------------------------------------------
create or replace function public.neighborhoods_set_city_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.city_id := public.city_id_for_name(new.city);
  return new;
end $$;

comment on function public.neighborhoods_set_city_id() is
  'פותר city_id משם העיר של השכונה בשמירה. אינו משכתב את neighborhoods.city.';

drop trigger if exists neighborhoods_set_city_id_trg on public.neighborhoods;
create trigger neighborhoods_set_city_id_trg
  before insert or update of city on public.neighborhoods
  for each row execute function public.neighborhoods_set_city_id();

-- ---------------------------------------------------------------------------
-- ההשלמה
--
-- ‏`cities` ריקה ברגע כתיבת המיגרציה, ולכן זהו no-op בהרצה הראשונה. הקריאה
-- נשארת כדי שהקובץ יהיה שלם בפני עצמו: הרצה חוזרת אחרי מיגרציית ההזנה
-- תשלים את כל השורות. אידמפוטנטי — ה-`where` מסנן מה שכבר נפתר.
-- ---------------------------------------------------------------------------
do $$
declare
  v_done integer;
begin
  update public.neighborhoods n
     set city_id = public.city_id_for_name(n.city)
   where n.city_id is null
     and public.city_id_for_name(n.city) is not null;
  get diagnostics v_done = row_count;
  raise notice 'neighborhoods.city_id: הושלמו % שורות', v_done;
end $$;
