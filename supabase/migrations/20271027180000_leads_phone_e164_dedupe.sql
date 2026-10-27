-- ============================================================================
-- כפילות לידים בין טופס מטא לבין פייסבוק/אינסטגרם - טלפון מנורמל
--
-- עד כאן שתי שכבות בלבד, ושתיהן בתוך מסלול אחד:
--   * ads_leads.meta_lead_id / social_leads.zernio_id - אותו אירוע פעמיים
--   * leads (source, external_ref) - אותו מזהה ספק באותו source
--
-- אין עמודה או אינדקס על הטלפון ב-leads, ולכן אותו אדם שמילא טופס מיידי
-- וגם כתב לגבריאלה בפייסבוק נולד כשני לידים, שתי התראות ושתי רוטציות.
-- ‏owner-lead-intake גם לא כתב source ל-meta_ads_owner_form (רק למקור
-- חברתי), אז הליד ממטא נספר כליד בלי מקור.
--
-- מה נכנס:
--   1. leads.phone_e164 - generated מ-raw_phone דרך normalize_msisdn(),
--      אותה פונקציה של saved_searches.phone_e164. אין ב-leads עמודת טלפון
--      אחרת, אז המילוי של השורות הקיימות הוא העמודה המחושבת עצמה.
--   2. אינדקס לא ייחודי. ייחוד על טלפון היה חוסם מחפש/ת שהפך/ה לבעלים,
--      וליד חדש אחרי 30 יום או אחרי סגירה. החלון והסטטוס נבדקים בקליטה.
--   3. leads.source_touches - מערך קטן של מקורות נוספים שצורפו לליד פתוח
--      ({source, external_ref, at}), בלי להחליף את source של השורה.
--      לא ב-leads_masked: המזהה אצל הספק אינו מוצג לסוכן/ת.
--      ההודעה החדשה מצטרפת ל-raw_message, שכבר מוצג אחרי פתיחה.
--
-- "פתוח" בקליטה: status ב-masked / unlocked / pending_charge, לא בארכיון,
-- והשלב של הסוכן/ת המשויך/ת אינו not_relevant (לא רלוונטי) או won (נסגר).
-- ‏docs/lead-card.md, docs/social-leads.md, docs/marketing-console.md.
-- ============================================================================

alter table public.leads
  add column if not exists phone_e164 text
  generated always as (public.normalize_msisdn(raw_phone)) stored;

comment on column public.leads.phone_e164 is
  'טלפון הפונה בפורמט E.164 בלי פלוס (972521112222), נגזר מ-raw_phone דרך normalize_msisdn כמו saved_searches.phone_e164. לא ייחודי: זיהוי כפילות של ליד פתוח מ-30 הימים האחרונים נעשה בקליטה. docs/social-leads.md';

create index if not exists leads_phone_e164_type_created_idx
  on public.leads (phone_e164, lead_type, created_at desc)
  where phone_e164 is not null;

alter table public.leads
  add column if not exists source_touches jsonb not null default '[]'::jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'leads_source_touches_array') then
    alter table public.leads add constraint leads_source_touches_array
      check (jsonb_typeof(source_touches) = 'array');
  end if;
end $$;

comment on column public.leads.source_touches is
  'מקורות נוספים שצורפו לליד קיים (טופס מטא אחרי הודעה בפייסבוק, ולהפך) בלי ליד שני ובלי התראה שנייה. כל איבר: source, external_ref, at. לא מוצג בכרטיס. docs/social-leads.md';
