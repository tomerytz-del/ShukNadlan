-- יומן הוואטסאפ: לאיזה משני המספרים ההודעה הגיעה, ומאיזה יצאה
--
-- מ-17.11.2026 לגבריאלה שני מספרים באותו וובהוק: של הסוכנים (053-249-4740,
-- WHATSAPP_PHONE_NUMBER_ID) והציבורי (053-324-2100,
-- WHATSAPP_PUBLIC_PHONE_NUMBER_ID). Meta אומרת בכל הודעה נכנסת לאיזה מספר
-- היא הגיעה (value.metadata.phone_number_id), והתשובה יוצאת מאותו מספר דרך
-- AsyncLocalStorage (whatsapp.ts, withSender). אבל היומן whatsapp_messages
-- לא רשם את זה: בערב ההדלקה אפשר היה לדעת שהודעה הגיעה למספר החדש רק
-- מהתוכן של התשובה (פתיחת הבוט הציבורי). כשגולש/ת יקבל/תקבל תשובה
-- מהמספר הלא נכון - הכשל שהפיצול נועד למנוע - זו הדרך היחידה לחקור, והיא
-- לא אמינה.
--
-- מה נכנס: עמודה phone_number_id (המזהה של Meta, לא המספר עצמו) על כל
-- שורה שהוובהוק כותב, נכנסת ויוצאת. אינדקס חלקי לשאילתה "כל ההודעות במספר
-- הציבורי מאתמול".
--
-- מה null אומר: שורה מלפני המיגרציה, או הודעה שנכתבה מחוץ ל-whatsapp-webhook
-- (meeting-client, client-showcase, meta-leads) - אלה הודעות יזומות, ויזומות
-- יוצאות תמיד מהמספר של הסוכנים. null אינו "לא ידוע" אלא "המספר של
-- הסוכנים, לפי בנייה"; מי שרוצה ודאות מסנן phone_number_id is not null.
--
-- סדר הפריסה: המיגרציה ב-PR משלה, לפני הקוד שכותב את העמודה (deploy-path).

alter table public.whatsapp_messages
  add column if not exists phone_number_id text;

comment on column public.whatsapp_messages.phone_number_id is
  'מזהה המספר העסקי של Meta שההודעה הגיעה אליו (נכנסת) או יצאה ממנו (יוצאת). '
  'null = לפני 17.11.2026 או הודעה יזומה שנכתבה מחוץ לוובהוק, כלומר המספר של הסוכנים.';

-- חלקי: רק שורות עם מזהה, כי השאילתה היא תמיד "המספר הזה בחלון הזה".
create index if not exists whatsapp_messages_phone_number_created_idx
  on public.whatsapp_messages (phone_number_id, created_at desc)
  where phone_number_id is not null;
