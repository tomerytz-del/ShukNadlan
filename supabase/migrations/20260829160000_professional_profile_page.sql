-- ============================================================================
-- עמוד בעל-מקצוע — התוכן שממלא אותו
--
-- הכרטיסייה ברצועה בדף הבית היא אריח: תמונה, שם ושם עסק. עד עכשיו זה היה
-- *כל* מה שבעל/ת המקצוע יכול/ה להראות, והלחיצה עליה יצאה מהאתר לקישור
-- חיצוני. העמוד הייעודי (professional.html) הופך אותה לכניסה לפרופיל מלא,
-- והעמודות כאן הן התוכן שלו: תיאור, רשימת שירותים, גלריה, וידאו, תמונת
-- נושא ופרטי יצירת קשר.
--
-- שתי הערות על מה שכבר היה:
--   * ‎creative_url‎ נשאר תמונת הפרופיל (הוא גם מה שמופיע על האריח).
--   * ‎click_url‎ נשאר האתר החיצוני, אבל הוא כבר לא היעד של הכרטיסייה —
--     היא מובילה עכשיו פנימה, לעמוד, והאתר החיצוני הוא כפתור בתוכו.
--
-- אידמפוטנטי — אפשר להריץ שוב.
-- ============================================================================

alter table public.ad_placements
  add column if not exists slug             text,
  add column if not exists headline         text,
  add column if not exists description      text,
  add column if not exists services         text[],
  add column if not exists gallery_urls     text[],
  add column if not exists video_url        text,
  add column if not exists cover_url        text,
  add column if not exists phone_e164       text,
  add column if not exists public_email     text,
  add column if not exists license_number   text,
  add column if not exists years_experience integer,
  add column if not exists service_areas    text[];

comment on column public.ad_placements.slug is
  'הכתובת הקריאה של עמוד בעל/ת המקצוע (professional.html?slug=…). נגזר מהשם עם סיומת מזהה, ולכן ייחודי בלי לולאת ניסיונות.';
comment on column public.ad_placements.headline is 'משפט פתיחה קצר מתחת לשם בעמוד.';
comment on column public.ad_placements.description is 'טקסט חופשי — מי הם ומה הם עושים.';
comment on column public.ad_placements.services is 'רשימת השירותים, פריט בשורה. מוצגת כתגיות.';
comment on column public.ad_placements.gallery_urls is 'תמונות הגלריה, לפי הסדר. יושבות ב-bucket property-images תחת professionals/<id>/.';
comment on column public.ad_placements.video_url is 'סרטון — קישור YouTube/Vimeo (מוטמע) או קובץ mp4 ישיר (נגן וידאו).';
comment on column public.ad_placements.cover_url is 'תמונת הנושא ברוחב העמוד.';
comment on column public.ad_placements.phone_e164 is
  'ספרות בלבד בפורמט 972521112222 — בדיוק מה ש-wa.me ו-tel: מצפים לו, כמו agency_members.phone_e164. זה מה שמפעיל את כפתור הוואטסאפ.';
comment on column public.ad_placements.public_email is
  'אימייל להצגה בעמוד. נפרד מ-contact_email, שהוא כתובת החיוב ולא נחשף לגולשים.';

-- ‏slug ייחודי, אבל רק כשהוא קיים: לבאנרים ולשורות ישנות אין אחד.
create unique index if not exists ad_placements_slug_key
  on public.ad_placements(slug) where slug is not null;

-- ---------------------------------------------------------------------------
-- מה שהאתר קורא
--
-- ‏‎ad_placements‎ נושאת גם ‎contact_email‎ (כתובת החיוב), ‎monthly_price‎
-- ו-‎test_mode‎, וה-policy הציבורית עליה (`status = 'active'`) היא ברמת שורה
-- ולכן חלה על *כל* העמודות — כלומר האימייל של כל בעל/ת מקצוע היה נקרא
-- בדפדפן של כל גולש. ה-view מגדיר את מה שבאמת ציבורי, וההרשאה על העמודות
-- הרגישות נשללת מהתפקידים הציבוריים כדי שלא תהיה דרך לעקוף אותו.
--
-- ‏security_invoker=true בכוונה: ה-view לא אמור להיות פרצה מעל RLS — הוא
-- רץ בהרשאות הקורא, ה-policy של הטבלה עדיין חלה, ותפקידו כאן הוא לצמצם
-- עמודות ולרכז את תנאי ה"פעיל", לא להרחיב גישה.
-- ---------------------------------------------------------------------------
create or replace view public.professional_cards_public
with (security_invoker = true) as
select
  id, slug, advertiser_name, business_name, advertiser_type, target_region,
  headline, description, services, creative_url, cover_url, gallery_urls,
  video_url, click_url, phone_e164, public_email, license_number,
  years_experience, service_areas, starts_at, ends_at
from public.ad_placements
where placement_type = 'professional_card'
  and status = 'active'
  -- ‏status לבדו לא מספיק: כרטיסייה שתקופת הפרסום שלה הסתיימה נשארת
  -- active בטבלה, ובלי התנאי הזה היא המשיכה להופיע.
  and (starts_at is null or starts_at <= current_date)
  and (ends_at   is null or ends_at   >= current_date);

comment on view public.professional_cards_public is
  'כרטיסיות בעלי מקצוע פעילות — מה שהאתר הציבורי קורא. בלי contact_email ובלי נתוני חיוב.';

grant select on public.professional_cards_public to anon, authenticated;

revoke select (contact_email, monthly_price, price_model, test_mode)
  on public.ad_placements from anon, authenticated;

-- ---------------------------------------------------------------------------
-- ‏slug לכרטיסיות שכבר קיימות
--
-- ‏[:alnum:] ב-UTF-8 כולל אותיות עבריות, ולכן הביטוי משאיר את השם כמו שהוא
-- ורק מחליף את המפרידים. הסיומת היא שישה תווים מה-id — היא מה שמבטיח
-- ייחודיות בלי לבדוק התנגשויות.
-- ---------------------------------------------------------------------------
update public.ad_placements
set slug = nullif(trim(both '-' from
      regexp_replace(coalesce(nullif(business_name, ''), advertiser_name, ''), '[^[:alnum:]]+', '-', 'g')
    ), '') || '-' || left(id::text, 6)
where placement_type = 'professional_card' and slug is null;
