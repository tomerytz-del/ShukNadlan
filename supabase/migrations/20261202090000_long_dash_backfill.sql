-- ============================================================================
-- ניקוי מקף ארוך מטקסט שכבר יושב במסד
--
-- מה שבור היום
-- ------------
-- ‏#342 הוריד את המקף הארוך (— ו-–) מכל טקסט שמתפרסם, בשלוש חזיתות: הקבצים
-- בריפו, הפרומפט של התיאור השיווקי, ו-noLongDash() על מה שהמודל מחזיר.
-- שלושתן מסתכלות **קדימה** בלבד. טקסט שנכתב למסד לפני כן נשאר כמו שהוא,
-- וממשיך להופיע באתר — כותרות של 51 נכסים, 14 תיאורים שיווקיים, 17 פוסטים
-- לפייסבוק, מחירון, כתבות וביו של מתווך/ת.
--
-- זה מה שהמיגרציה הזו מנקה, פעם אחת, למפרע.
--
-- מה **לא** נוגעים בו, ולמה
-- -------------------------
-- הכלל הוא "טקסט שהאתר מציג", ולא "כל עמודת טקסט". שלוש קבוצות נשארות:
--
--   • **רשומות היסטוריות.** ‏whatsapp_messages.body (111 שורות),
--     property_publications.message (3), notifications.body (61),
--     lead_routing_log.summary. אלה תיעוד של מה ש**כבר נשלח או פורסם**.
--     לשכתב אותן זה לזייף את היומן: הפוסט שעלה לפייסבוק עלה עם מקף ארוך,
--     וההיסטוריה צריכה לומר את זה.
--   • **תוכן פנימי.** ‏ops_findings (98 שורות), tier_changes.note,
--     property_video_clips.prompt. נראה רק למנהל/ת הפלטפורמה, לא לגולשים.
--   • **טקסט פרטי של משתמש/ת.** ‏agent_clients.notes (הערות של סוכן/ת על
--     הלקוח/ה שלו/ה), saved_searches.label. לא שלנו לערוך.
--     ‏reviews.text ממילא נקי — ואם לא היה, גם הוא לא היה נכנס לכאן.
--
-- המלכודת שכמעט נדרסה כאן
-- ------------------------
-- ‏property_marketing_fingerprint() היא md5 של **title ו-description** ועוד
-- שדות. ניקוי תמים של הכותרת משנה את טביעת האצבע, ואז 50 נכסים שהתיאור
-- שלהם היה עדכני מסומנים בבת אחת כמתיישנים — כלומר 50 קריאות Claude
-- מיותרות, על שינוי של תו אחד שאינו שינוי תוכן.
--
-- לכן השלב השלישי: מי שהיה **טרי לפני** הניקוי מקבל טביעת אצבע מעודכנת,
-- ומי שכבר היה מתיישן (4 נכסים) נשאר מתיישן. ההתיישנות נשמרת בדיוק כפי
-- שהייתה.
--
-- ומה שנבדק ונשלל
-- ----------------
-- ‏properties.title **אינו** משפיע על זיהוי הכפילויות. הטריגר
-- ‏properties_guard_duplicate בונה מפתח מ-property_dedupe_key(city, street,
-- house_number, rooms, floor, deal_type) בלבד, ובאף אחת מהעמודות האלה אין
-- מקף ארוך (נספר: אפס). ‏property_text_key(), שכן רגיש להבדל — הוא מסיר
-- מקף רגיל ולא מקף ארוך — פועל על שמות רחוב, ולא על כותרות.
--
-- אידמפוטנטית: הרצה שנייה לא מוצאת מקף ארוך, מעדכנת אפס שורות, ואינה נוגעת
-- בטביעות האצבע.
-- ============================================================================

do $$
declare
  -- em dash, en dash, horizontal bar
  c_dash constant text := '[—–―]';
  v_fresh uuid[];
  v_rows  bigint;
begin
  -- 1. מי טרי לפני הניקוי. נאסף **לפני** ה-update, אחרת אי אפשר להבדיל
  --    בין "התיישן עכשיו בגלל המקף" לבין "כבר היה מתיישן".
  select array_agg(p.id) into v_fresh
    from public.properties p
   where p.marketing_description_fingerprint is not null
     and p.marketing_description_fingerprint = public.property_marketing_fingerprint(p);

  -- 2. הנכסים: כותרת, תיאור הסוכן/ת, התיאור השיווקי והפוסט לפייסבוק
  update public.properties set
    title                 = regexp_replace(title,                 c_dash, '-', 'g'),
    description           = regexp_replace(description,           c_dash, '-', 'g'),
    marketing_description = regexp_replace(marketing_description, c_dash, '-', 'g'),
    post_text             = regexp_replace(post_text,             c_dash, '-', 'g')
  where title ~ c_dash
     or description ~ c_dash
     or marketing_description ~ c_dash
     or post_text ~ c_dash;
  get diagnostics v_rows = row_count;
  raise notice 'properties: % שורות', v_rows;

  -- 3. החזרת טביעת האצבע למי שהיה טרי. מי שלא היה ברשימה נשאר מתיישן.
  --
  --    ‏`from public.properties src` ולא הפניה לכינוי היעד בתוך ה-set:
  --    ‏f(alias) על שורה שלמה בתוך UPDATE הוא בדיוק הסוג של בנייה שמתפרשת
  --    אחרת ממה שנראה (ולמעשה קוראת את השורה *לפני* העדכון). כאן זה לא
  --    היה משנה — שלב 2 הוא הצהרה נפרדת ולכן השורה כבר נקייה — אבל צורת
  --    ה-join מפורשת, נבדקה כ-select לפני הדחיפה, ואינה תלויה בדקוּת הזו.
  update public.properties p
     set marketing_description_fingerprint = public.property_marketing_fingerprint(src)
    from public.properties src
   where src.id = p.id
     and p.id = any(coalesce(v_fresh, '{}'::uuid[]))
     and p.marketing_description_fingerprint is distinct from
         public.property_marketing_fingerprint(src);
  get diagnostics v_rows = row_count;
  raise notice 'טביעות אצבע שהוחזרו: % שורות', v_rows;

  -- 4. שאר התוכן שמתפרסם
  update public.articles
     set body     = regexp_replace(body,     c_dash, '-', 'g'),
         subtitle = regexp_replace(subtitle, c_dash, '-', 'g')
   where body ~ c_dash or subtitle ~ c_dash;

  update public.pricing_config
     set description = regexp_replace(description, c_dash, '-', 'g')
   where description ~ c_dash;

  update public.agency_members
     set bio = regexp_replace(bio, c_dash, '-', 'g')
   where bio ~ c_dash;

  -- שם המקור מוצג לצד כל מבזק ברצועת החדשות, ו-news_sources.name הוא
  -- מה שמזין אותו בסריקה הבאה. השניים מנוקים יחד, אחרת הוא יחזור.
  update public.news_items
     set source_name = regexp_replace(source_name, c_dash, '-', 'g')
   where source_name ~ c_dash;

  update public.news_sources
     set name = regexp_replace(name, c_dash, '-', 'g')
   where name ~ c_dash;
end $$;
