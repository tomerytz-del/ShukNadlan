-- ============================================================================
-- הקשר הנכס בליד המשכנתא
--
-- מחשבון המשכנתא יושב עכשיו גם בעמוד הנכס, שם המחיר אינו בחירה של המשתמש/ת
-- אלא המחיר של הנכס הספציפי. ליד שנולד שם נושא איתו את מזהה הנכס: זה ההבדל
-- בין "מישהו מתעניין במשכנתא" לבין "מישהו מתעניין במימון הדירה הזו", וזה מה
-- שהופך את הליד לשווה יותר עבור היועצ/ת.
--
-- ‏on delete set null ולא cascade: הסרת מודעה מהאתר לא אמורה למחוק ליד שכבר
-- נמכר ושולם עליו. הליד שורד, ההקשר מתרוקן.
-- ============================================================================

alter table public.mortgage_leads
  add column if not exists property_id uuid references public.properties(id) on delete set null;

comment on column public.mortgage_leads.property_id is
  'הנכס שממנו נפתח הטופס. null כשהליד הגיע ממחשבון דף הבית.';

create index if not exists mortgage_leads_property_idx
  on public.mortgage_leads (property_id)
  where property_id is not null;

-- ---------------------------------------------------------------------------
-- ה-view מקבל את הקשר הנכס ואת המקור
--
-- שניהם אינם PII: ‏property_id הוא מזהה של מודעה פומבית, ו-source הוא תווית
-- פנימית. היועצ/ת צריכ/ה אותם *לפני* התשלום — ליד עם נכס מוגדר שווה אחרת
-- מליד כללי, וזה בדיוק סוג המידע שהמדף אמור להציג.
--
-- שתי העמודות נוספות *בסוף* ולא במקומן ההגיוני באמצע: ‏create or replace view
-- מתיר רק הוספה בזנב, וכל סידור אחר נכשל ב-42P16. החלופה — drop + create —
-- הייתה מפילה את ה-grants ואת ה-view לרגע, וזה לא שווה את הסדר האסתטי.
-- ---------------------------------------------------------------------------
create or replace view public.mortgage_leads_public as
select
  id,
  owns_property,
  property_price,
  equity,
  loan_amount,
  interest_rate,
  years,
  monthly_payment,
  ltv_pct,
  (email is not null and btrim(email) <> '') as has_email,
  status,
  created_at,
  property_id,
  source
from public.mortgage_leads
where status in ('new','sold');

comment on view public.mortgage_leads_public is
  'מדף לידי המשכנתאות — נתוני המחשבון והקשר הנכס בלבד. ללא שם, ללא טלפון, ללא אימייל.';

revoke select on public.mortgage_leads_public from anon;
grant select on public.mortgage_leads_public to authenticated;
