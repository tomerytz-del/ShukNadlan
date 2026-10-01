-- ---------------------------------------------------------------------------
-- יומן שיחות: סוגי שמע נוספים בדלי call-recordings
--
-- הדלי נפתח (20270202090000) ל-mp3 ול-wav בלבד - מה ש-Twilio מייצרת. סימולציית
-- השיחה (twilio-voice?task=simulate, למנהל/ת הפלטפורמה) מקבלת הקלטה שמעלים
-- מהטלפון: הודעה קולית של וואטסאפ היא ogg, הקלטה של אייפון היא m4a, ושל
-- הדפדפן webm. בלי ההרחבה ההעלאה נדחית ב-Storage והסימולציה נכשלת.
-- docs/call-tracking.md
-- ---------------------------------------------------------------------------

update storage.buckets
   set allowed_mime_types = array[
         'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav',
         'audio/ogg', 'audio/mp4', 'audio/x-m4a', 'audio/webm', 'audio/aac'
       ]
 where id = 'call-recordings';
