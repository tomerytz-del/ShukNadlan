-- ============================================================================
-- ‏visualization_job_status מחזיר גם את תמונת המקור
-- ----------------------------------------------------------------------------
-- הווילון של "לפני ואחרי" בדף הנכס משווה את ההדמיה לצילום שהיא נוצרה ממנו —
-- ‏source_image_url של אותה שורה בדיוק. את הצילום הזה הדף מקבל בטעינה, מתוך
-- ‏property_visualizations_recent.
--
-- מה שלא היה בו: המסלול של הדמיה שנוצרת *עכשיו*. ה-polling עובר דרך ה-RPC
-- הזה, וה-RPC החזיר ‎target, style_key, result_url‎ בלבד. התוצאה נכנסה לדף בלי
-- תמונת מקור, הווילון נפל לתמונה הראשונה בגלריית הנכס — ובנכס מסחרי זו החזית
-- — ומי שהרגע הזמין/ה הדמיה לחלל העסק ראה/תה את חזית הבניין בצד ה"לפני" מול
-- פנים העסק בצד ה"אחרי". שתי תמונות של שני מקומות שונים, מוצגות כאותו מקום
-- לפני ואחרי.
--
-- ‏source_image_url הוא ‎not null‎ בטבלה, ולכן ההחזרה שלו כאן סוגרת את הפער:
-- הדמיה שהרגע נוצרה מגיעה לדף עם אותו מידע שיש להדמיה שנטענה מהשרת.
--
-- מה שלא נוסף: ‎job_id‎ ו-‎error_detail‎ נשארים בחוץ מאותה סיבה כמו קודם.
-- ============================================================================

drop function if exists public.visualization_job_status(uuid);

create function public.visualization_job_status(p_job_id uuid)
returns table (
  job_status text,
  target     text,
  style_key  text,
  source_image_url text,
  result_url text,
  item_status text,
  error_detail text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    j.status,
    v.target,
    v.style_key,
    v.source_image_url,
    v.result_url,
    v.status,
    v.error_detail
  from public.visualization_jobs j
  left join public.property_visualizations v on v.job_id = j.id
  where j.id = p_job_id
  order by v.target;
$$;

comment on function public.visualization_job_status(uuid) is
  'מעקב אחרי בקשת הדמיה. ה-job_id הוא הרשאת הגישה — אין דרך לגלות אותו מהאתר. מחזיר גם את תמונת המקור, כדי שווילון ה"לפני ואחרי" יציג את הצילום שההדמיה נוצרה ממנו.';

grant execute on function public.visualization_job_status(uuid) to anon, authenticated;
