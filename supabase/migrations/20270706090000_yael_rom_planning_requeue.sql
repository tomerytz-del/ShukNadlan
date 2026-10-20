-- ============================================================================
-- ניסיון אחד נוסף למידע התכנוני של "יעל רום 7" (מודעה 1142)
--
-- ‏planning-backfill שאל על הכתובת שלוש פעמים (16-18.9.2026), קיבל
-- address_not_found, והנכס יצא מהתור לתמיד. ב-21.9 הגאוקוד מצא את אותה
-- כתובת **באותה שכבה** (‏afl_bld:afl_bld-Address_Points_1) והנכס קיבל פין
-- ברובע יזרעאל. כלומר הנקודה נוספה לשכבה בין 18.9 ל-21.9 - רחוב חדש בשכונה
-- חדשה - והתור מיצה את הניסיונות שלושה ימים מוקדם מדי.
--
-- הרחוב כבר כתוב בשם הרשמי אות באות, ולכן 20270702090000 לא החזירה אותו.
-- ההכרעה התקבלה מול מנהל/ת הפלטפורמה. ניסיון אחד (‏attempts = 2), בלי DDL,
-- ומותנה במצב הנוכחי - הרצה חוזרת אינה נוגעת בנכס שכבר נפתר.
-- ============================================================================

update public.properties p
   set planning_attempted_at = null,
       planning_attempts     = least(planning_attempts, 2),
       planning_error        = null
 where p.id = '040a95f4-a064-40bb-8f19-bf3799ef5fa2'
   and p.planning_error = 'address_not_found'
   and not exists (select 1 from public.property_planning_info i
                    where i.property_id = p.id and i.gush is not null);
